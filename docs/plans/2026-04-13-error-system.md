# Error System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a centralized, severity-tiered error system with a forensic audit log that records every error to per-case and global JSONL files, surfaces them in the UI as modal/banner/toast, and demonstrates the pattern on the two known issues from the 2026-04-13 debugging session.

**Architecture:** Main process emits errors via a single `reportError()` function that writes to two JSONL audit logs (per-case + global) AND broadcasts via IPC. Renderer holds a Zustand `error-store` populated by an IPC listener. UI components render based on severity. The existing class-based `ErrorBoundary` in `App.tsx` is augmented to also push render errors into the same store.

**Tech Stack:** TypeScript, Electron 41, React 18, Zustand 4.5, Tailwind, `uuid` (already installed), `fs.appendFile` for JSONL writes. No new dependencies needed.

**Reference design:** `docs/plans/2026-04-13-error-system-design.md`

**Verification approach:** No test framework currently exists in this repo (none of the packages have a `test` script). Each task verifies via TypeScript build + manual end-to-end check at the end. **Do not** add a test framework in this plan — that's a separate follow-up.

---

## Pre-flight: Handle existing uncommitted state

The repo at `rmpg-forensics/` currently has ~30 uncommitted modified files from prior work (iOS features, tool-resolver tweaks, etc.). The error-system commits should not mix with that work.

**Working directory for ALL tasks:** `cd "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics"`

**Step 1: Show current state**

```bash
git status
git diff --stat
```

Expected: ~30 modified files, ~3 untracked (`docs/plans/2026-04-13-*`). Confirm with the user before proceeding.

**Step 2: Decide isolation strategy**

Ask the user one question before continuing:

> Your repo has uncommitted prior work. Three options:
> a) Stash it (`git stash push -m "WIP before error-system"`), implement error system on clean tree, then `git stash pop` after
> b) Commit prior work as a checkpoint first (`git add -A && git commit -m "WIP: prior work checkpoint"`)
> c) Just commit the new error-system files specifically with `git add <only-new-files>` per task — never use `git add -A`. (Recommended — least risk of mixing scopes.)

**Wait for user choice.** All subsequent tasks assume option **(c)** — every commit uses explicit `git add <paths>`. If user picks (a) or (b), proceed accordingly.

---

## Task 1: Add `ErrorEvent` shared type

**Files:**
- Create: `packages/shared/src/types/error.ts`
- Modify: `packages/shared/src/types/index.ts` (or whatever the types barrel is — verify in step 1)

**Step 1: Inspect the types barrel**

```bash
ls packages/shared/src/types/
cat packages/shared/src/types/index.ts
```

Confirm the export pattern (likely `export * from './error'`).

**Step 2: Create the error type file**

Path: `packages/shared/src/types/error.ts`

```ts
/**
 * Severity tiers for an ErrorEvent.
 *
 * - `warning`: non-blocking degradation (1 of N files unreadable, optional tool missing).
 *              Renders as a 5-second auto-dismiss toast.
 * - `error`:   operation failed, user must address (ADB not found, extraction crashed).
 *              Renders as a persistent banner until dismissed.
 * - `critical`: app cannot continue (case database corrupted, evidence directory unwritable).
 *               Renders as a blocking modal that must be acknowledged.
 */
export type ErrorSeverity = 'warning' | 'error' | 'critical';

/**
 * A single error event flowing through the system.
 *
 * Used as both the IPC payload (main → renderer) and the JSONL line shape
 * for the per-case and global audit logs. Treated as immutable once emitted.
 */
export interface ErrorEvent {
  /** Stable uuid v4 — used for dedup + dismiss + audit cross-reference. */
  id: string;

  /** Severity tier, drives UI rendering. */
  severity: ErrorSeverity;

  /**
   * Dotted source path identifying where the error originated.
   * Examples: 'adb-handlers.ADB_LIST_DEVICES', 'ios-service.backup', 'react-render'.
   */
  source: string;

  /** Human-readable summary, suitable for display to the user. */
  message: string;

  /** Optional detailed payload — stack trace, full stderr, etc. */
  detail?: string;

  /** Active case ID at time of error, if any. */
  caseId?: string;

  /** ISO 8601 UTC timestamp, e.g. "2026-04-13T20:35:00.123Z". */
  timestampIso: string;

  /** Arbitrary structured context (serial, file path, etc.). */
  context?: Record<string, unknown>;

  /** UI hint: show a Retry button. Caller wires the handler. */
  retryable?: boolean;
}
```

**Step 3: Add to types barrel**

If `packages/shared/src/types/index.ts` exists, add the line:

```ts
export * from './error';
```

If no barrel exists, the parent `packages/shared/src/index.ts` already does `export * from './types'` — confirm `./types` is a directory with its own `index.ts`. If `./types` is a single file rather than a directory, this task changes: instead, append the contents of step 2's file to the existing types file. **Do not assume — read the structure first.**

**Step 4: Build shared package to typecheck**

```bash
pnpm --filter @rmpg/shared build
```

Expected: exit 0, no TS errors. If errors, fix path/syntax before continuing.

**Step 5: Commit**

```bash
git add packages/shared/src/types/error.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add ErrorEvent and ErrorSeverity types

Foundation type for the centralized error system. Used as both the IPC
payload (main->renderer) and JSONL line shape for audit logs.

See docs/plans/2026-04-13-error-system-design.md."
```

---

## Task 2: Add `ERROR_REPORT` IPC channel constant

**Files:**
- Modify: `packages/shared/src/constants.ts:8-N` (the `IPC_CHANNELS` object)

**Step 1: Open the file and find the right grouping**

The `IPC_CHANNELS` object is grouped by feature with `// Comment` headers (Case, Dialog, ADB, etc.). Add a new group near the top (after `Case management`, before `Dialog`):

```ts
  // Error reporting (main -> renderer push)
  ERROR_REPORT: 'error:report',
```

**Step 2: Build shared**

```bash
pnpm --filter @rmpg/shared build
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add packages/shared/src/constants.ts
git commit -m "feat(shared): add IPC_CHANNELS.ERROR_REPORT for error broadcast"
```

---

## Task 3: Create the audit-log service

**Files:**
- Create: `packages/desktop/src/main/services/audit-log.ts`

**Step 1: Read the case-manager to find the active-case API**

```bash
cat packages/desktop/src/main/services/case-manager.ts | head -80
```

Find the function that returns the currently-open case and its directory. Note the exact name (e.g., `getActiveCase()`, `getCurrentCaseDir()`). If no such function exists, the audit log service falls back to "global only" — that's acceptable for this pass; flag it to the user and proceed.

**Step 2: Create the file**

Path: `packages/desktop/src/main/services/audit-log.ts`

```ts
import * as path from 'path';
import * as fs from 'fs/promises';
import type { ErrorEvent } from '@rmpg/shared';
import { getAppDataPath } from './platform-service';

const AUDIT_SUBDIR = 'audit';
const ERRORS_FILE = 'errors.jsonl';

/**
 * Append an error event to the global audit log AND, if a case directory
 * is provided, to that case's per-case audit log.
 *
 * Both writes are append-only JSONL (one JSON object per line, newline-terminated).
 * Each write creates the `audit/` subdirectory on first use.
 *
 * Failures fall back to console.error so visibility is never lost — but the
 * caller (error-reporter) is also broadcasting via IPC, so the renderer sees
 * the error even if disk writes fail.
 *
 * Atomicity: fs.appendFile writes shorter than PIPE_BUF (4096 bytes on macOS)
 * are atomic per call. JSONL lines are always shorter than that, so concurrent
 * appends from multiple handlers will not interleave.
 */
export async function recordError(event: ErrorEvent, activeCaseDir?: string): Promise<void> {
  const line = JSON.stringify(event) + '\n';

  // Global mirror — always
  const globalPath = path.join(getAppDataPath(), AUDIT_SUBDIR, ERRORS_FILE);
  await safeAppend(globalPath, line);

  // Per-case — only if a real case directory is provided
  if (activeCaseDir) {
    const casePath = path.join(activeCaseDir, AUDIT_SUBDIR, ERRORS_FILE);
    await safeAppend(casePath, line);
  }
}

/** Append a single line, creating the parent directory if needed. */
async function safeAppend(filePath: string, line: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, line, 'utf-8');
  } catch (err) {
    // Last-ditch fallback. Intentionally console — the renderer is also
    // being notified via IPC, so the user still sees the error.
    // eslint-disable-next-line no-console
    console.error('[audit-log] failed to append', filePath, err);
  }
}
```

**Step 3: Build desktop**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 4: Commit**

```bash
git add packages/desktop/src/main/services/audit-log.ts
git commit -m "feat(desktop): add audit-log service for forensic error JSONL

Writes ErrorEvent records to two append-only JSONL files: a global mirror
in the app data path, and a per-case mirror in <caseDir>/audit/errors.jsonl
when a case is active. Atomic per-line via fs.appendFile."
```

---

## Task 4: Create the error-reporter service

**Files:**
- Create: `packages/desktop/src/main/services/error-reporter.ts`

**Step 1: Confirm uuid is available in main**

```bash
grep '"uuid"' packages/desktop/package.json
```

Expected: `"uuid": "^9.0.0"` already listed.

**Step 2: Confirm how main process broadcasts to renderer**

```bash
grep -rn "webContents.send\|BrowserWindow" packages/desktop/src/main/index.ts | head -10
```

Note: the existing `adb-handlers.ts` already uses `BrowserWindow.getAllWindows()[0] ?? null` for progress events. We'll use the same pattern.

**Step 3: Find or create the active-case lookup**

If `case-manager` exposes something like `getActiveCaseDir(): string | null`, use it. Otherwise, the reporter passes `undefined` for `activeCaseDir`. Decide which based on Task 3 step 1 finding.

**Step 4: Create the file**

Path: `packages/desktop/src/main/services/error-reporter.ts`

```ts
import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ErrorEvent } from '@rmpg/shared';
import { recordError } from './audit-log';
// import { getActiveCaseDir } from './case-manager';  // <-- adjust to actual API

/** Input for reportError — id and timestamp are filled in here. */
export type ReportInput = Omit<ErrorEvent, 'id' | 'timestampIso'>;

/**
 * Single entry point for any main-process error that should be visible to
 * the user and recorded to the audit log.
 *
 * Generates id + ISO timestamp, looks up the active case directory (if any),
 * writes to audit log, then broadcasts via IPC_CHANNELS.ERROR_REPORT to the
 * first BrowserWindow.
 *
 * Returns the full ErrorEvent so callers can chain (e.g., re-throw with id
 * for later cross-reference).
 */
export async function reportError(input: ReportInput): Promise<ErrorEvent> {
  const event: ErrorEvent = {
    ...input,
    id: uuidv4(),
    timestampIso: new Date().toISOString(),
  };

  // 1. Persist to audit log (per-case + global).
  // Replace `undefined` with `getActiveCaseDir()` once that API exists.
  await recordError(event, undefined);

  // 2. Broadcast to renderer.
  const win = BrowserWindow.getAllWindows()[0] ?? null;
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.ERROR_REPORT, event);
  }

  return event;
}
```

**Step 5: Build desktop**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 6: Commit**

```bash
git add packages/desktop/src/main/services/error-reporter.ts
git commit -m "feat(desktop): add reportError() main-process entry point

Generates uuid + ISO timestamp, persists via audit-log, broadcasts via
IPC_CHANNELS.ERROR_REPORT to the first BrowserWindow. Single function
any IPC handler can call from a catch block."
```

---

## Task 5: Create the renderer error-store

**Files:**
- Create: `packages/desktop/src/renderer/store/error-store.ts`
- Modify: `packages/desktop/src/renderer/store/index.ts` (re-export)

**Step 1: Inspect existing store pattern**

```bash
cat packages/desktop/src/renderer/store/index.ts
cat packages/desktop/src/renderer/store/device-store.ts | head -30
```

Confirm Zustand `create<T>(set => ({...}))` pattern.

**Step 2: Create the store**

Path: `packages/desktop/src/renderer/store/error-store.ts`

```ts
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

  /** Acknowledge a critical error — same as dismiss, named for UI clarity. */
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
```

**Step 3: Re-export from store barrel**

Add to `packages/desktop/src/renderer/store/index.ts`:

```ts
export * from './error-store';
```

**Step 4: Build desktop**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/store/error-store.ts packages/desktop/src/renderer/store/index.ts
git commit -m "feat(desktop): add error-store Zustand store

Holds up to 50 ErrorEvents. Older errors live only in the audit log.
Dedupes by id; provides dismiss / acknowledgeCritical / clearAll."
```

---

## Task 6: Create `ErrorBanner` component

**Files:**
- Create: `packages/desktop/src/renderer/components/common/ErrorBanner.tsx`
- Modify: `packages/desktop/src/renderer/components/common/index.ts` (re-export)

**Step 1: Read the existing index.ts to match export style**

```bash
cat packages/desktop/src/renderer/components/common/index.ts
```

Note the export pattern.

**Step 2: Create the component**

Path: `packages/desktop/src/renderer/components/common/ErrorBanner.tsx`

```tsx
import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useErrorStore } from '../../store/error-store';

/**
 * Renders all severity:'error' events as red banners stacked at the top of
 * the page. Each is dismissable. Persistent until the user dismisses or until
 * clearAll() is called.
 *
 * Mounts once in AppLayout above <main>.
 */
export const ErrorBanner: React.FC = () => {
  const errors = useErrorStore((s) => s.errors.filter((e) => e.severity === 'error'));
  const dismiss = useErrorStore((s) => s.dismiss);

  if (errors.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-6 py-2">
      {errors.map((err) => (
        <div
          key={err.id}
          className="flex items-start justify-between gap-3 rounded border px-3 py-2 text-xs"
          style={{
            background: 'rgba(248,113,113,0.08)',
            borderColor: 'rgba(248,113,113,0.35)',
            color: '#f87171',
          }}
        >
          <div className="flex flex-1 items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">{err.message}</div>
              <div className="opacity-70">
                <span>{err.source}</span>
                {' • '}
                <span>{new Date(err.timestampIso).toLocaleTimeString()}</span>
              </div>
              {err.detail && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] opacity-80">
                  {err.detail}
                </pre>
              )}
            </div>
          </div>
          <button
            onClick={() => dismiss(err.id)}
            className="rounded p-1 transition hover:bg-white/10"
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};
```

**Step 3: Re-export**

Add to `packages/desktop/src/renderer/components/common/index.ts`:

```ts
export { ErrorBanner } from './ErrorBanner';
```

**Step 4: Build desktop**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/common/ErrorBanner.tsx packages/desktop/src/renderer/components/common/index.ts
git commit -m "feat(desktop): add ErrorBanner component for severity:error events"
```

---

## Task 7: Create `ErrorToast` component

**Files:**
- Create: `packages/desktop/src/renderer/components/common/ErrorToast.tsx`
- Modify: `packages/desktop/src/renderer/components/common/index.ts`

**Step 1: Create the component**

Path: `packages/desktop/src/renderer/components/common/ErrorToast.tsx`

```tsx
import React, { useEffect } from 'react';
import { X, Info } from 'lucide-react';
import { useErrorStore } from '../../store/error-store';
import type { ErrorEvent } from '@rmpg/shared';

const TOAST_DURATION_MS = 5000;

/**
 * Renders all severity:'warning' events as auto-dismissing toasts in the
 * bottom-right corner. Each toast lives for 5 seconds.
 *
 * Mounts once in AppLayout (floating, position:fixed).
 */
export const ErrorToast: React.FC = () => {
  const warnings = useErrorStore((s) => s.errors.filter((e) => e.severity === 'warning'));

  return (
    <div
      className="fixed bottom-4 right-4 z-40 flex flex-col gap-2"
      style={{ pointerEvents: 'none' }}
    >
      {warnings.map((w) => (
        <ToastItem key={w.id} event={w} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ event: ErrorEvent }> = ({ event }) => {
  const dismiss = useErrorStore((s) => s.dismiss);

  useEffect(() => {
    const id = setTimeout(() => dismiss(event.id), TOAST_DURATION_MS);
    return () => clearTimeout(id);
  }, [event.id, dismiss]);

  return (
    <div
      className="flex items-start gap-2 rounded border px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'rgba(251,191,36,0.12)',
        borderColor: 'rgba(251,191,36,0.4)',
        color: '#fbbf24',
        pointerEvents: 'auto',
        minWidth: 240,
        maxWidth: 360,
      }}
    >
      <Info size={14} className="mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="font-medium">{event.message}</div>
        <div className="opacity-60">{event.source}</div>
      </div>
      <button
        onClick={() => dismiss(event.id)}
        className="rounded p-0.5 transition hover:bg-white/10"
        aria-label="Dismiss"
      >
        <X size={11} />
      </button>
    </div>
  );
};
```

**Step 2: Re-export**

Add to `components/common/index.ts`:

```ts
export { ErrorToast } from './ErrorToast';
```

**Step 3: Build**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/common/ErrorToast.tsx packages/desktop/src/renderer/components/common/index.ts
git commit -m "feat(desktop): add ErrorToast component for severity:warning events"
```

---

## Task 8: Create `ErrorModal` component

**Files:**
- Create: `packages/desktop/src/renderer/components/common/ErrorModal.tsx`
- Modify: `packages/desktop/src/renderer/components/common/index.ts`

**Step 1: Create the component**

Path: `packages/desktop/src/renderer/components/common/ErrorModal.tsx`

```tsx
import React, { useState } from 'react';
import { AlertOctagon, ChevronDown, ChevronRight } from 'lucide-react';
import { useErrorStore } from '../../store/error-store';

/**
 * Renders the FIRST severity:'critical' event as a blocking modal overlay.
 * The modal cannot be dismissed without clicking Acknowledge — once
 * acknowledged, it removes the event from the store and the next critical
 * event (if any) becomes visible.
 *
 * Mounts once in AppLayout. Position:fixed full-screen overlay.
 */
export const ErrorModal: React.FC = () => {
  const critical = useErrorStore((s) => s.errors.find((e) => e.severity === 'critical'));
  const acknowledge = useErrorStore((s) => s.acknowledgeCritical);
  const [showDetail, setShowDetail] = useState(false);

  if (!critical) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.65)' }}
    >
      <div
        className="card max-w-2xl w-full"
        style={{ borderColor: 'rgba(248,113,113,0.5)' }}
      >
        <div className="flex items-start gap-3">
          <AlertOctagon size={24} className="mt-0.5 flex-shrink-0 text-red-400" />
          <div className="flex-1">
            <h2 className="mb-2 text-lg font-bold text-red-400">Critical Error</h2>
            <p className="mb-2 text-sm" style={{ color: 'var(--text-primary)' }}>
              {critical.message}
            </p>
            <div className="text-xs opacity-60">
              <span>{critical.source}</span>
              {' • '}
              <span>{new Date(critical.timestampIso).toLocaleString()}</span>
            </div>
            {critical.detail && (
              <button
                onClick={() => setShowDetail((v) => !v)}
                className="mt-2 flex items-center gap-1 text-xs opacity-70 hover:opacity-100"
              >
                {showDetail ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {showDetail ? 'Hide details' : 'Show details'}
              </button>
            )}
            {showDetail && critical.detail && (
              <pre
                className="mt-2 max-h-64 overflow-auto rounded p-2 text-left text-[10px]"
                style={{ background: 'rgba(0,0,0,0.3)', color: '#f87171', whiteSpace: 'pre-wrap' }}
              >
                {critical.detail}
              </pre>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => acknowledge(critical.id)}
            className="btn-primary"
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};
```

**Step 2: Re-export**

Add to `components/common/index.ts`:

```ts
export { ErrorModal } from './ErrorModal';
```

**Step 3: Build**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/common/ErrorModal.tsx packages/desktop/src/renderer/components/common/index.ts
git commit -m "feat(desktop): add ErrorModal component for severity:critical events"
```

---

## Task 9: Wire IPC listener and augment App.tsx ErrorBoundary

**Files:**
- Modify: `packages/desktop/src/renderer/App.tsx`

The existing `ErrorBoundary` class (lines 10-42) keeps its current UI behavior — we only add a side effect that pushes render errors into the store for audit logging. We also register the `ERROR_REPORT` IPC listener inside the main `App` component.

**Step 1: Augment ErrorBoundary's componentDidCatch**

Find the existing `componentDidCatch` at App.tsx:15-19:

```ts
componentDidCatch(error: Error, info: { componentStack: string }) {
  console.error('[ErrorBoundary] Caught error:', error);
  console.error('[ErrorBoundary] Component stack:', info.componentStack);
  this.setState({ stack: info.componentStack });
}
```

Replace with (also push to store):

```ts
componentDidCatch(error: Error, info: { componentStack: string }) {
  console.error('[ErrorBoundary] Caught error:', error);
  console.error('[ErrorBoundary] Component stack:', info.componentStack);
  this.setState({ stack: info.componentStack });
  // Audit-log the render error via the central store. Generate id + iso here
  // since the boundary is purely client-side (no main process round-trip).
  try {
    const { useErrorStore } = require('./store/error-store');
    useErrorStore.getState().addError({
      id: crypto.randomUUID(),
      severity: 'critical',
      source: 'react-render',
      message: error.message,
      detail: info.componentStack,
      timestampIso: new Date().toISOString(),
    });
  } catch {
    // Store may not be available during very early render failures; safe to ignore.
  }
}
```

**Note:** `crypto.randomUUID()` is available in Electron 41's renderer (Web Crypto API). No new import needed.

**Step 2: Add IPC listener inside the App component**

Find the `useEffect` blocks inside `const App: React.FC = () => {...}` (around line 195). Add a new `useEffect` AFTER the existing ones:

```ts
// Subscribe to main-process error broadcasts
useEffect(() => {
  const off = window.api.on(IPC_CHANNELS.ERROR_REPORT, (event: unknown) => {
    const e = event as import('@rmpg/shared').ErrorEvent;
    console.error(`[${e.source}] ${e.message}`, e);
    useErrorStore.getState().addError(e);
  });
  return off;
}, []);
```

**Step 3: Add the imports**

At the top of App.tsx, add:

```ts
import { IPC_CHANNELS } from '@rmpg/shared';
import { useErrorStore } from './store/error-store';
```

(`IPC_CHANNELS` may already be imported — check first; if so, no-op. The `useErrorStore` import is new.)

**Step 4: Build**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): wire ERROR_REPORT IPC listener + audit render errors

App.tsx now listens for main-process error broadcasts and pushes them
into the error-store. The existing class-based ErrorBoundary is augmented
to also push caught render errors into the same store for audit logging."
```

---

## Task 10: Mount ErrorBanner / ErrorToast / ErrorModal in AppLayout

**Files:**
- Modify: `packages/desktop/src/renderer/layouts/AppLayout.tsx`

**Step 1: Add imports**

Replace the existing import on AppLayout.tsx:4:

```ts
import { DeviceStatus, BackgroundTaskBar } from '../components/common';
```

with:

```ts
import { DeviceStatus, BackgroundTaskBar, ErrorBanner, ErrorToast, ErrorModal } from '../components/common';
```

**Step 2: Mount the components in the layout JSX**

Find the JSX `return` block (~line 67). The order matters:

- `ErrorModal` and `ErrorToast` are floating overlays — they can mount anywhere inside the root div.
- `ErrorBanner` should sit between the auto-update banner and `<main>` so error banners appear at the top of page content.

Place inside the `<div className="flex flex-1 flex-col overflow-hidden">` wrapper, just after the auto-update banner block (around line 149) and before `<main>` (around line 152):

```tsx
{/* Error banners — persistent until dismissed */}
<ErrorBanner />
```

At the very end of the outer wrapper (just before the closing `</div>` of the top-level flex, around line 184), add the floating overlays:

```tsx
{/* Floating error UIs */}
<ErrorToast />
<ErrorModal />
```

**Step 3: Build**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/layouts/AppLayout.tsx
git commit -m "feat(desktop): mount ErrorBanner/Toast/Modal in AppLayout"
```

---

## Task 11: Demo migrate `adb-handlers.ts` ADB_LIST_DEVICES

**Files:**
- Modify: `packages/desktop/src/main/ipc/adb-handlers.ts:18-46`

**Step 1: Add the import**

At the top of the file (after existing imports):

```ts
import { reportError } from '../services/error-reporter';
```

**Step 2: Wrap the android.listDevices() call**

Replace lines 18-46 (the entire `ADB_LIST_DEVICES` handler body). The current body:

```ts
ipcMain.handle(IPC_CHANNELS.ADB_LIST_DEVICES, async () => {
  const android = await adbService.listDevices();

  // Detect iOS devices via ios-service ...
  let ios: ...[] = [];
  try {
    const iosDevices = await iosService.listDevices();
    ios = iosDevices.map(...);
  } catch {
    // libimobiledevice not installed or no iOS devices
  }

  return { android, ios };
});
```

Becomes:

```ts
ipcMain.handle(IPC_CHANNELS.ADB_LIST_DEVICES, async () => {
  // Android: wrap separately so an ADB failure (binary missing, permissions,
  // etc.) does NOT take iOS detection down with it. Surface the error via
  // reportError so the user sees a banner instead of a silent empty list.
  let android: Awaited<ReturnType<typeof adbService.listDevices>> = [];
  try {
    android = await adbService.listDevices();
  } catch (err) {
    await reportError({
      severity: 'error',
      source: 'adb-handlers.ADB_LIST_DEVICES',
      message: err instanceof Error ? err.message : String(err),
      detail: err instanceof Error ? err.stack : undefined,
      retryable: true,
    });
  }

  // iOS: already wrapped (libimobiledevice may be missing)
  let ios: { serial: string; model: string; manufacturer: string; product: string; version: string }[] = [];
  try {
    const iosDevices = await iosService.listDevices();
    ios = iosDevices.map((d) => ({
      serial: d.udid,
      model: d.name || d.productType || 'iPhone',
      manufacturer: 'Apple',
      product: d.productType || '',
      version: d.productVersion || '',
    }));
  } catch (err) {
    // iOS detection silent — only report if the error indicates a real
    // problem (not just "libimobiledevice not installed", which is benign).
    const msg = err instanceof Error ? err.message : String(err);
    if (!/ENOENT|not found|command not found/i.test(msg)) {
      await reportError({
        severity: 'warning',
        source: 'adb-handlers.ADB_LIST_DEVICES.ios',
        message: msg,
      });
    }
  }

  return { android, ios };
});
```

**Step 3: Build**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 4: Commit**

```bash
git add packages/desktop/src/main/ipc/adb-handlers.ts
git commit -m "fix(desktop): isolate ADB and iOS detection failures

ADB and iOS device enumeration now run independently. An ADB failure
(binary missing, etc.) reports as a user-visible error but no longer
takes iOS detection down with it. iOS failures that look like missing
libimobiledevice are silent (benign); other failures report as warnings."
```

---

## Task 12: Demo migrate `useDeviceStatus.ts` — un-silence the catch

**Files:**
- Modify: `packages/desktop/src/renderer/hooks/useDeviceStatus.ts:111-113`

**Step 1: Replace the silent catch**

Find lines 111-113:

```ts
} catch {
  // Silently fail on poll errors
}
```

Replace with:

```ts
} catch (err) {
  // Main process already reported via ERROR_REPORT IPC and audit log.
  // Local console output here is for renderer-side debugging only.
  // eslint-disable-next-line no-console
  console.error('[useDeviceStatus] poll() failed', err);
}
```

**Step 2: Build**

```bash
pnpm --filter @rmpg/desktop build
```

Expected: exit 0.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/hooks/useDeviceStatus.ts
git commit -m "fix(desktop): un-silence useDeviceStatus poll errors

Previously caught all poll errors silently. Main process now reports
via ERROR_REPORT IPC + audit log, so the renderer just needs to log
locally for client-side debugging. UI surfacing happens via the new
error system."
```

---

## Task 13: End-to-end manual verification

No automated tests exist; this task is a checklist the implementer runs and the user observes.

**Step 1: Start the app in dev mode**

```bash
pnpm --filter @rmpg/desktop dev
```

Wait for the Electron window to appear.

**Step 2: Verify happy path is unchanged**

- Plug in a known-good Android device (USB debugging on, authorized).
- Confirm Dashboard auto-detects it within 2 seconds.
- Confirm no error banner / toast / modal appears.

**Step 3: Verify ADB-missing error path**

- Quit the app.
- Temporarily rename adb: `sudo mv /opt/homebrew/bin/adb /opt/homebrew/bin/adb.bak`
- Restart the app.
- Expected: red **ErrorBanner** at top of Dashboard saying "ADB not found. Please install the Android SDK Platform Tools and configure the path in Settings." Source = `adb-handlers.ADB_LIST_DEVICES`.
- Confirm the banner has a working dismiss X.
- Expected: `~/Library/Application Support/RMPG Forensics Analysis/audit/errors.jsonl` contains a JSONL line with the same message and a uuid id.
- **Restore adb:** `sudo mv /opt/homebrew/bin/adb.bak /opt/homebrew/bin/adb`

**Step 4: Verify per-case audit log**

- Open or create a case in the app.
- Trigger an error (e.g., Tools Configuration → click "Refresh" with adb renamed away again).
- Confirm `<caseDir>/audit/errors.jsonl` contains the entry AND the global mirror does too.
- Restore adb.

**Step 5: Verify warning toast**

- Easiest way: temporarily inject a `reportError({ severity: 'warning', source: 'manual-test', message: 'Test toast' })` call in any handler and trigger it. Confirm yellow toast appears bottom-right and auto-dismisses after 5 seconds.
- **Remove the test injection before final commit.**

**Step 6: Verify critical modal**

- Same as step 5 but with `severity: 'critical'`. Confirm modal blocks the UI until Acknowledge clicked. Confirm Show details / Hide details toggle works on the stack-trace pane.
- Remove test injection.

**Step 7: Verify React render error capture**

- Temporarily add `throw new Error('test render boundary');` into Dashboard.tsx render.
- Restart app.
- Confirm: ErrorBoundary's existing inline UI still shows, AND a new entry appears in the global audit log with `source: 'react-render'`.
- Remove test throw.

**Step 8: Final commit (if you used test injections)**

If steps 5/6/7 left any test code in the repo, ensure it's all removed and run `git status` to confirm a clean tree before declaring done.

---

## Done criteria

- All 12 implementation tasks committed.
- All 7 manual verification steps pass.
- `git status` is clean.
- Audit log contains real entries from the verification run (not test injections).
- Existing app behavior (dashboard, device polling, all other pages) verified unchanged for the happy path.

## What's intentionally NOT in this plan

These are explicit non-goals per the design doc:
- Migrating other IPC handlers to use `reportError` — they keep their current ad-hoc handling and can opt in later.
- Adding a test framework.
- Implementing retry-button handlers (the `retryable` flag is shown but no-op).
- Log rotation / size limits.
- Cross-window error sharing (only `getAllWindows()[0]` receives broadcasts; the app appears to be single-window).

These are explicit follow-up candidates if value warrants:
- Migrate `case-handlers`, `whatsapp-handlers`, `ios-handlers`, `file-extract-handlers` next (they touch evidence directly).
- Add `vitest` + write tests for `audit-log.ts` and `error-reporter.ts` (pure functions, easy to test).
- Wire actual retry handlers per-error.
- Add a "View audit log" page at `/settings/audit-log`.
