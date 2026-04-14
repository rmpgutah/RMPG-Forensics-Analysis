import { create } from 'zustand';
import type { ErrorEvent } from '@rmpg/shared';

const MAX_ERRORS_IN_STORE = 50;

interface ErrorState {
  /** Newest first. Bounded by MAX_ERRORS_IN_STORE; older errors live only in the audit log. */
  errors: ErrorEvent[];

  /** Add an event. Dedupes by id (no-op if id already present). */
  addError: (event: ErrorEvent) => void;

  /** Remove a specific error from the store. Audit log retains it. */
  dismiss: (id: string) => void;

  /**
   * Acknowledge a critical error — same operation as dismiss, named for UI
   * clarity since the modal Acknowledge button reads better than "Dismiss".
   */
  acknowledgeCritical: (id: string) => void;

  /** Wipe everything from the in-memory store. Audit log retains all entries. */
  clearAll: () => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  errors: [],

  addError: (event) =>
    set((state) => {
      if (state.errors.some((e) => e.id === event.id)) return state;
      return { errors: [event, ...state.errors].slice(0, MAX_ERRORS_IN_STORE) };
    }),

  dismiss: (id) =>
    set((state) => ({ errors: state.errors.filter((e) => e.id !== id) })),

  acknowledgeCritical: (id) =>
    set((state) => ({ errors: state.errors.filter((e) => e.id !== id) })),

  clearAll: () => set({ errors: [] }),
}));
