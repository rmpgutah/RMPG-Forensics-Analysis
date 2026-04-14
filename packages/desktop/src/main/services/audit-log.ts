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
