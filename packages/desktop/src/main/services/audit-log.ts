import * as path from 'path';
import * as fs from 'fs/promises';
import type { ErrorEvent } from '@rmpg/shared';
import { getAppDataPath } from './platform-service';

const AUDIT_SUBDIR = 'audit';
const ERRORS_FILE = 'errors.jsonl';

export interface AuditLogResult {
  /** True if the global mirror write succeeded. */
  globalOk: boolean;
  /**
   * True if the per-case write succeeded.
   * False if attempted and failed.
   * Null if no per-case write was attempted (no valid case dir).
   */
  caseOk: boolean | null;
}

/**
 * Append an error event to the global audit log AND, if a valid case directory
 * is provided, to that case's per-case audit log.
 *
 * Both writes are append-only JSONL (one JSON object per line, LF-terminated).
 * The `audit/` subdirectory is created on first use.
 *
 * Atomicity: writes use `fs.open(path, 'a')` (O_APPEND) followed by a single
 * `fileHandle.write()`. On APFS, O_APPEND gives kernel-level atomic append
 * for writes up to one filesystem block (≥4096 bytes), so concurrent writers
 * do not interleave for typical line lengths. Lines larger than the block
 * size may theoretically split, but ErrorEvent serializations rarely exceed
 * that — and the IPC broadcast is the authoritative user-visible signal
 * regardless.
 *
 * Concurrency:
 * - Ordering between concurrent calls is NOT guaranteed; consumers should
 *   sort by `event.timestampIso` rather than file order.
 * - Writes are page-cache durable, not fsync-durable. A hard crash within
 *   ~30s of an append can lose recent entries. Acceptable for our use case;
 *   if stricter durability is needed, fsync on case close.
 * - No cross-process serialization. If multiple Electron processes ever
 *   write the same audit file, no guarantees apply.
 *
 * `activeCaseDir` is validated: must be a non-empty trimmed absolute path.
 * Invalid values are silently treated as "no case dir" (only the global log
 * is written) — the caller does not need to pre-validate.
 *
 * Returns an AuditLogResult so callers (e.g., error-reporter) can escalate
 * a per-case write failure as a chain-of-custody concern.
 */
export async function recordError(
  event: ErrorEvent,
  activeCaseDir?: string
): Promise<AuditLogResult> {
  const line = JSON.stringify(event) + '\n';

  // Global mirror — always
  const globalPath = path.join(getAppDataPath(), AUDIT_SUBDIR, ERRORS_FILE);
  const globalOk = await safeAppend(globalPath, line);

  // Per-case — only if the dir is a real, absolute, non-empty path.
  // Reject whitespace-only or relative paths to prevent accidental writes
  // to CWD-relative locations.
  let caseOk: boolean | null = null;
  if (
    typeof activeCaseDir === 'string' &&
    activeCaseDir.trim().length > 0 &&
    path.isAbsolute(activeCaseDir)
  ) {
    const casePath = path.join(activeCaseDir, AUDIT_SUBDIR, ERRORS_FILE);
    caseOk = await safeAppend(casePath, line);
  }

  return { globalOk, caseOk };
}

/**
 * Append a single line, creating the parent directory if needed.
 * Uses `fs.open(path, 'a')` for true O_APPEND atomicity at the kernel level.
 *
 * Returns true on success, false on any I/O failure. Failures are logged to
 * console — the caller decides whether to escalate further (e.g., per-case
 * failure deserves a louder signal than global-mirror failure).
 */
async function safeAppend(filePath: string, line: string): Promise<boolean> {
  let fileHandle: fs.FileHandle | undefined;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    fileHandle = await fs.open(filePath, 'a');
    await fileHandle.write(line, null, 'utf-8');
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit-log] failed to append', filePath, err);
    return false;
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {
        /* swallow close-time errors — primary write outcome already known */
      });
    }
  }
}
