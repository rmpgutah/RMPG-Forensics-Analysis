import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ErrorEvent } from '@rmpg/shared';
import { recordError, type AuditLogResult } from './audit-log';

/** Input for reportError — id and timestamp are filled in here. */
export type ReportInput = Omit<ErrorEvent, 'id' | 'timestampIso'>;

/** What reportError returns to its caller for downstream chaining. */
export interface ReportOutcome {
  /** The fully-populated event that was emitted. */
  event: ErrorEvent;
  /** Result of the audit-log writes (global mirror + optional per-case). */
  audit: AuditLogResult;
  /** Whether the IPC broadcast actually reached a renderer window. */
  broadcasted: boolean;
}

/**
 * Single entry point for any main-process error that should be visible to
 * the user and recorded to the audit log.
 *
 * Generates id (uuid v4) + ISO timestamp, persists to the audit log, then
 * broadcasts via IPC_CHANNELS.ERROR_REPORT to the first BrowserWindow.
 *
 * Returns the full event + audit result + broadcast status so callers can
 * chain (e.g., re-throw with id for cross-reference, or escalate if the
 * per-case audit write failed).
 *
 * TODO: per-case audit logging is currently disabled — `activeCaseDir` is
 * always undefined. The active case is tracked in the renderer's
 * useCaseStore and not yet propagated to main. Wire that in a follow-up
 * (renderer pushes case-open / case-close events via a new IPC channel,
 * main holds the dir in a small module-level state).
 */
export async function reportError(input: ReportInput): Promise<ReportOutcome> {
  const event: ErrorEvent = {
    ...input,
    id: uuidv4(),
    timestampIso: new Date().toISOString(),
  };

  // 1. Persist to audit log. activeCaseDir intentionally undefined for now.
  const audit = await recordError(event, undefined);

  // 2. Broadcast to renderer (best-effort — window may not exist during
  //    early startup or shutdown). Wrapped in try/catch so reportError
  //    itself never throws when called from inside a catch block: the
  //    audit log already captured the event regardless of broadcast.
  const win = BrowserWindow.getAllWindows()[0] ?? null;
  let broadcasted = false;
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send(IPC_CHANNELS.ERROR_REPORT, event);
      broadcasted = true;
    } catch (err) {
      // TOCTOU: renderer may have been destroyed between the check and the
      // send, or webContents rejected the payload.
      // eslint-disable-next-line no-console
      console.error('[error-reporter] webContents.send failed', err);
    }
  }

  return { event, audit, broadcasted };
}
