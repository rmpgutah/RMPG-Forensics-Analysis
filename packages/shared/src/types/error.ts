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
