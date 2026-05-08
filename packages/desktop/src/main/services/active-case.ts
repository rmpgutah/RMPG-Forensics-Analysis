import * as path from 'path';

/**
 * Module-level holder for the currently-active case directory.
 *
 * The active case lives in the renderer's `useCaseStore`, but main needs to
 * know about it so per-case audit logs (chain-of-custody) can be written
 * alongside the global mirror. The renderer pushes updates via the
 * `CASE_SET_PATH` IPC channel, and the case open/create handlers also set it
 * directly so a freshly-opened case is immediately active without a
 * round-trip.
 *
 * Validation is intentionally permissive — the audit-log layer re-validates
 * before writing, so anything invalid here just becomes "no case" downstream.
 */

let activeCaseDir: string | undefined;

export function setActiveCaseDir(dir: string | null | undefined): void {
  if (typeof dir === 'string' && dir.trim().length > 0 && path.isAbsolute(dir)) {
    activeCaseDir = dir;
  } else {
    activeCaseDir = undefined;
  }
}

export function getActiveCaseDir(): string | undefined {
  return activeCaseDir;
}
