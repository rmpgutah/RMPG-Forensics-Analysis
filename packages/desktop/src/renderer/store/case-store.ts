import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { IPC_CHANNELS } from '@rmpg/shared';

/**
 * Fire-and-forget push of the active case dir to main, so per-case audit logs
 * land in the right folder. Failures are logged but never block the store
 * update — the global audit mirror still captures everything.
 */
function pushActiveCase(casePath: string | null): void {
  const api = (globalThis as { api?: { invoke: (ch: string, ...a: unknown[]) => Promise<unknown> } }).api;
  if (!api) return;
  api.invoke(IPC_CHANNELS.CASE_SET_PATH, casePath).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[case-store] failed to push active case to main', err);
  });
}

export interface Acquisition {
  id: string;
  type: string;
  timestamp: string;
  path: string;
  status: 'completed' | 'failed' | 'in-progress';
  hash?: string;
}

export interface CaseState {
  caseName: string;
  casePath: string;
  caseNumber: string;
  examiner: string;
  description: string;
  createdAt: string | null;
  deviceSerial: string;
  deviceModel: string;
  acquisitions: Acquisition[];

  setCaseInfo: (info: Partial<CaseState>) => void;
  addAcquisition: (acquisition: Acquisition) => void;
  updateAcquisition: (id: string, updates: Partial<Acquisition>) => void;
  clearCase: () => void;
}

const initialState = {
  caseName: '',
  casePath: '',
  caseNumber: '',
  examiner: '',
  description: '',
  createdAt: null as string | null,
  deviceSerial: '',
  deviceModel: '',
  acquisitions: [] as Acquisition[],
};

// Persist the active case so reopening the app lands the user back on
// the same case they were working on. The acquisitions array goes with
// it — they're an in-memory mirror of what the case folder already
// holds, so persisting them avoids a "your timeline is empty" surprise
// on relaunch even when the case folder is intact.
export const useCaseStore = create<CaseState>()(
  persist(
    (set) => ({
      ...initialState,

      setCaseInfo: (info) =>
        set((state) => {
          const next = { ...state, ...info };
          if ('casePath' in info && info.casePath !== state.casePath) {
            pushActiveCase(next.casePath || null);
            // When a fresh case becomes active, push it onto the
            // recent-cases ring buffer so the Dashboard can list it
            // without re-scanning the disk.
            if (next.casePath) {
              recordRecentCase({
                casePath: next.casePath,
                caseName: next.caseName || '',
                caseNumber: next.caseNumber || '',
                examiner: next.examiner || '',
                openedAt: new Date().toISOString(),
              });
            }
          }
          return next;
        }),

      addAcquisition: (acquisition) =>
        set((state) => ({
          acquisitions: [...state.acquisitions, acquisition],
        })),

      updateAcquisition: (id, updates) =>
        set((state) => ({
          acquisitions: state.acquisitions.map((a) =>
            a.id === id ? { ...a, ...updates } : a
          ),
        })),

      clearCase: () => {
        pushActiveCase(null);
        set(initialState);
      },
    }),
    {
      name: 'rmpg-active-case',
      // Push the persisted case dir to main on rehydration so per-case
      // audit logs resume targeting the right folder. Without this hook
      // the renderer remembers the case but main forgets between runs.
      onRehydrateStorage: () => (state) => {
        if (state?.casePath) pushActiveCase(state.casePath);
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Recent cases — small persisted ring buffer of the last 8 cases the user
// has opened or created. Drives the Dashboard's "Recent Cases" section so
// they can re-open without going through Case Manager. Stored separately
// from the active case so closing one case doesn't drop the breadcrumbs.
// ---------------------------------------------------------------------------

export interface RecentCase {
  casePath: string;
  caseName: string;
  caseNumber: string;
  examiner: string;
  openedAt: string;
}

interface RecentCasesState {
  cases: RecentCase[];
  add: (entry: RecentCase) => void;
  remove: (casePath: string) => void;
  clear: () => void;
}

export const useRecentCasesStore = create<RecentCasesState>()(
  persist(
    (set) => ({
      cases: [],
      add: (entry) =>
        set((s) => {
          const filtered = s.cases.filter((c) => c.casePath !== entry.casePath);
          return { cases: [entry, ...filtered].slice(0, 8) };
        }),
      remove: (casePath) =>
        set((s) => ({ cases: s.cases.filter((c) => c.casePath !== casePath) })),
      clear: () => set({ cases: [] }),
    }),
    { name: 'rmpg-recent-cases' },
  ),
);

function recordRecentCase(entry: RecentCase): void {
  // Schedule on a microtask so we don't recursively trigger a Zustand
  // setter from inside another Zustand setter (would warn in dev).
  Promise.resolve().then(() => useRecentCasesStore.getState().add(entry));
}
