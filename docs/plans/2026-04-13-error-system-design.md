# Centralized Error System with Forensic Audit Log

**Date:** 2026-04-13
**Status:** Approved (design phase complete)
**Scope:** Infrastructure only — no handler-by-handler migration in this pass

## Problem

Errors in the desktop app are silently swallowed in multiple places (e.g., `useDeviceStatus.ts:111-113` catches all polling errors with no logging). When ADB is missing or device polling fails, the UI shows "no devices" with no diagnostic. This:

1. Wastes investigator time during real cases (no error → no troubleshooting path).
2. Creates a chain-of-custody gap — if an extraction silently fails on file N of M, that gap is undefendable in court.
3. Conflates "operation succeeded with empty result" and "operation failed".

This system makes every error visible and persistently logged as a forensic artifact.

## Goals

- Every IPC handler error becomes (a) visible to the user with appropriate urgency, and (b) recorded to an append-only audit log.
- React render errors caught and recorded.
- Errors are attributed to a `source` (dotted path), associated with the active case if any, and timestamped.
- Per-case audit log lives with the case evidence; global mirror catches everything regardless of case state.
- Existing handlers can opt in over time; this pass demos the pattern on the two known issues only.

## Non-goals

- Migrating all ~30 IPC handlers in this pass.
- Adding a test framework (separate follow-up task).
- Persisting errors across app restarts in the renderer (audit log is the persistence layer).
- Real-time error analytics, metrics, telemetry, or external reporting.

## Architecture

Two tiers, joined by one IPC channel.

```
                  ┌──────────────────────────────────────┐
                  │ Main Process                         │
                  │                                      │
  any handler ───►│ reportError(event)                   │
                  │   ├─► audit-log.recordError(event)   │
                  │   │      ├─► <case>/audit/errors.jsonl
                  │   │      └─► <appData>/audit/errors.jsonl
                  │   └─► webContents.send(ERROR_REPORT) │
                  │                                      │
                  └────────────────┬─────────────────────┘
                                   │ IPC
                  ┌────────────────▼─────────────────────┐
                  │ Renderer Process                     │
                  │                                      │
                  │ App.tsx IPC listener ──► error-store │
                  │                              │       │
                  │  ErrorBoundary catches ─────►│       │
                  │  React render errors         │       │
                  │                              ▼       │
                  │   AppLayout renders by severity:     │
                  │     critical → <ErrorModal>          │
                  │     error    → <ErrorBanner>         │
                  │     warning  → <ErrorToast>          │
                  └──────────────────────────────────────┘
```

## Components

### 1. `ErrorEvent` type — `packages/shared/src/types/error.ts`

```ts
export type ErrorSeverity = 'warning' | 'error' | 'critical';

export interface ErrorEvent {
  id: string;                        // uuid v4
  severity: ErrorSeverity;
  source: string;                    // 'adb-handlers.ADB_LIST_DEVICES'
  message: string;                   // human-readable summary
  detail?: string;                   // stack trace, stderr, full error
  caseId?: string;                   // active case at time of error
  timestampIso: string;              // ISO 8601 UTC, e.g. "2026-04-13T20:35:00.123Z"
  context?: Record<string, unknown>; // serial, file path, etc.
  retryable?: boolean;               // hint for UI retry button
}
```

Severity guide:
- `critical` — case database corrupted, evidence directory unwritable, app cannot continue. Modal blocks UI.
- `error` — operation failed, user must address (ADB not found, extraction crashed, backup write failed). Persistent banner.
- `warning` — non-blocking degradation (1 of 1000 files unreadable, optional tool missing). 5-second toast.

### 2. Audit log — `packages/desktop/src/main/services/audit-log.ts`

```ts
async function recordError(event: ErrorEvent, activeCaseDir?: string): Promise<void>;
```

Behavior:
- Always append to `<appDataPath>/audit/errors.jsonl` (global mirror).
- If `activeCaseDir` is provided AND directory exists, also append to `<activeCaseDir>/audit/errors.jsonl`.
- Each line is one `JSON.stringify(event) + '\n'`. Append-only via `fs.appendFile`.
- Creates `audit/` subdirectory on first write.
- If write fails, falls back to `console.error(event)` so visibility is never lost.
- Active case directory looked up via existing `case-manager.getActiveCase()` (no new state).

### 3. Error reporter — `packages/desktop/src/main/services/error-reporter.ts`

```ts
function reportError(input: Omit<ErrorEvent, 'id' | 'timestampIso'>): Promise<ErrorEvent>;
```

Generates `id` (uuid) and `timestampIso`, looks up active case, calls `audit-log.recordError`, then broadcasts via `BrowserWindow.getAllWindows()[0].webContents.send(ERROR_REPORT, event)`. Returns the full event so callers can use it for chaining if needed.

### 4. IPC channel — `packages/shared/src/constants.ts`

Add to `IPC_CHANNELS`:
```ts
ERROR_REPORT: 'error:report',
```

Push channel only (main → renderer). No request-response.

### 5. Renderer error store — `packages/desktop/src/renderer/store/error-store.ts`

Zustand store:
```ts
interface ErrorState {
  errors: ErrorEvent[];                       // newest first, max 50
  addError: (event: ErrorEvent) => void;      // dedupes by id
  dismiss: (id: string) => void;
  clearAll: () => void;
  acknowledgeCritical: (id: string) => void;  // removes from store
}
```

Cap at 50 to prevent unbounded growth — older errors live in the audit log.

### 6. UI components — `packages/desktop/src/renderer/components/common/`

| File | Renders | Trigger |
|---|---|---|
| `ErrorBoundary.tsx` | nothing visible itself, catches React render errors via componentDidCatch → `addError({severity:'critical', source:'react-render', message: error.message, detail: errorInfo.componentStack})` | React render exception |
| `ErrorBanner.tsx` | All store events with `severity: 'error'`, stacked at top of viewport. Each: red bar, message, dismiss X. If `retryable`, Retry button (caller registers handler via context — initially no-op). | Persistent until dismissed |
| `ErrorToast.tsx` | All store events with `severity: 'warning'`, stacked bottom-right. Auto-dismisses after 5 seconds. | Auto-fade |
| `ErrorModal.tsx` | First store event with `severity: 'critical'`. Backdrop + modal with message, detail (collapsible), Acknowledge button. Cannot be closed otherwise. | Blocks until acknowledged |

### 7. Wiring — `App.tsx` and `AppLayout.tsx`

`App.tsx`:
```ts
useEffect(() => {
  const off = window.electronAPI.on(IPC_CHANNELS.ERROR_REPORT, (event: ErrorEvent) => {
    console.error(`[${event.source}] ${event.message}`, event);
    useErrorStore.getState().addError(event);
  });
  return off;
}, []);
```

`AppLayout.tsx` mounts inside the layout:
```tsx
<ErrorBoundary>
  <ErrorModal />
  <ErrorBanner />
  <ErrorToast />
  {children}
</ErrorBoundary>
```

## Demo migrations

### `adb-handlers.ts` — wrap android detection so iOS doesn't disappear

Before:
```ts
ipcMain.handle(IPC_CHANNELS.ADB_LIST_DEVICES, async () => {
  const android = await adbService.listDevices();  // throws → IPC rejects → iOS lost
  // ... iOS detection ...
  return { android, ios };
});
```

After:
```ts
ipcMain.handle(IPC_CHANNELS.ADB_LIST_DEVICES, async () => {
  let android: AndroidDevice[] = [];
  try {
    android = await adbService.listDevices();
  } catch (err) {
    await reportError({
      severity: 'error',
      source: 'adb-handlers.ADB_LIST_DEVICES',
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    });
  }
  // ... iOS detection (already wrapped) ...
  return { android, ios };
});
```

### `useDeviceStatus.ts` — un-silence the catch

Before:
```ts
} catch {
  // Silently fail on poll errors
}
```

After:
```ts
} catch (err) {
  // Main process already reported via ERROR_REPORT IPC.
  // Local console for renderer-side debugging only.
  console.error('Device poll failed in renderer', err);
}
```

## File change list

```
NEW   packages/shared/src/types/error.ts
EDIT  packages/shared/src/constants.ts                         (+ ERROR_REPORT)
EDIT  packages/shared/src/index.ts                             (export error types)
NEW   packages/desktop/src/main/services/audit-log.ts
NEW   packages/desktop/src/main/services/error-reporter.ts
EDIT  packages/desktop/src/main/ipc/adb-handlers.ts            (wrap listDevices)
NEW   packages/desktop/src/renderer/store/error-store.ts
NEW   packages/desktop/src/renderer/components/common/ErrorBoundary.tsx
NEW   packages/desktop/src/renderer/components/common/ErrorBanner.tsx
NEW   packages/desktop/src/renderer/components/common/ErrorToast.tsx
NEW   packages/desktop/src/renderer/components/common/ErrorModal.tsx
EDIT  packages/desktop/src/renderer/components/common/index.ts (re-export)
EDIT  packages/desktop/src/renderer/App.tsx                    (IPC listener)
EDIT  packages/desktop/src/renderer/layouts/AppLayout.tsx      (mount components)
EDIT  packages/desktop/src/renderer/hooks/useDeviceStatus.ts   (un-silence)
```

5 new files, 8 edits, 1 conditional new file (common/index.ts only if not present).

## Testing

No test framework currently exists. Manual verification plan:

1. **Cold start** — open app with no phone. Expect: no errors yet (adb returns empty list cleanly).
2. **Missing ADB** — temporarily rename `/opt/homebrew/bin/adb` to `adb.bak`. Expect: red banner "ADB command failed: ENOENT". Audit log entry in `~/Library/Application Support/RMPG Forensics Analysis/audit/errors.jsonl`. iOS detection still works.
3. **Critical case** — manually throw a `critical` event from any handler. Expect: blocking modal, must acknowledge.
4. **Warning toast** — emit a `warning` event. Expect: 5-second toast bottom-right.
5. **React render error** — temporarily throw in Dashboard.tsx render. Expect: ErrorBoundary catches, modal shows with stack trace.
6. **Per-case audit** — open a case, trigger error, verify `<caseDir>/audit/errors.jsonl` contains the line AND global mirror does too.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `webContents.send` fires before renderer is ready → event lost | Errors before window-ready are still in audit log. Renderer only misses errors during ~1-second startup window. Acceptable. |
| Audit log fills disk | Manual log rotation guidance in docs. Unbounded for now (errors are infrequent, lines are small). |
| `BrowserWindow.getAllWindows()[0]` is null during quit | Reporter checks for null window before send. Logging continues regardless. |
| Concurrent `appendFile` interleaving across calls | Node.js `fs.appendFile` writes are atomic per call when payload < `PIPE_BUF` (4096 bytes on macOS). Our JSONL lines are well under this. No file lock needed. |
| Error storms (e.g., 100 errors/sec from a runaway loop) | Renderer caps at 50 in store. Audit log accepts all (forensic record). UI dedupes by id. |

## Implementation order

1. Shared types + constants (foundation, no dependencies).
2. Audit log service (testable in isolation).
3. Error reporter (depends on audit log).
4. Renderer store (independent).
5. UI components (depend on store + types).
6. App + AppLayout wiring.
7. Demo migrations (validate end-to-end).
8. Manual verification per checklist above.

## Open questions resolved

- **Active case lookup:** use existing `case-manager.getActiveCase()` (no new state).
- **Retry button mechanism:** initially no-op (retryable hint shown but doesn't do anything). Wiring per-error retry callbacks is a follow-up.
- **Error log retention:** unbounded for now. Manual rotation if needed.
