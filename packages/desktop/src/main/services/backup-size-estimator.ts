import * as fs from 'fs/promises';
import * as path from 'path';
import { runCommand } from './process-runner';
import { resolveTool } from './tool-resolver';

/**
 * backup-size-estimator — answer "how big will this backup be?" *before*
 * idevicebackup2 reveals the answer (which only happens partway through
 * the transfer phase). The caller uses the estimate to render a real
 * "X MB / Y GB" progress bar + ETA from the moment the run starts,
 * instead of "Building manifest…" with no time horizon.
 *
 * Why this is a real engineering choice (not a pure technical one):
 * different strategies trade accuracy vs. setup latency vs. honesty.
 * Pick the wrong one and the UI either stalls (waiting for a slow
 * device probe) or lies (shows "12 GB" when the actual backup is 4 GB
 * because we used a bad heuristic). See `estimateBackupSize` below.
 */

export interface SizeEstimate {
  /** Best-effort estimate in bytes. May be undefined if no strategy worked. */
  totalBytes?: number;
  /** Confidence label drives the UI: known/exact = no "~", estimate = "~". */
  confidence: 'exact' | 'estimate' | 'unknown';
  /** Source of the number, surfaced in tooltips for examiner trust. */
  source: 'previous-backup' | 'device-storage' | 'device-class' | 'unknown';
  /** Optional human-readable note. */
  note?: string;
}

/**
 * Strategy A — query the device's currently-used storage via
 * `idevicediagnostics ioregentry IODeviceTree:/options`. The free-space
 * delta gives us total user-data bytes; we then apply a typical
 * backup-coverage ratio.
 *
 * Returns undefined if the tool isn't installed or the device is locked.
 */
async function probeDeviceStorage(udid: string): Promise<number | undefined> {
  const tool = await resolveTool('idevicediagnostics' as Parameters<typeof resolveTool>[0]);
  // Fallback to PATH lookup since this tool isn't in our registered set
  let toolPath = tool.found ? tool.path : null;
  if (!toolPath) {
    for (const p of ['/opt/homebrew/bin/idevicediagnostics', '/usr/local/bin/idevicediagnostics']) {
      try { await fs.access(p); toolPath = p; break; } catch { /* try next */ }
    }
  }
  if (!toolPath) return undefined;

  const r = await runCommand(toolPath, ['-u', udid, 'diagnostics', 'WiFi'], { timeout: 5000 }).catch(() => null);
  if (!r) return undefined;

  // Storage info isn't directly exposed by `diagnostics WiFi` — we'd need a
  // different ioregentry path. For now, return undefined; the UI falls
  // through to Strategy B / C.
  return undefined;
}

/**
 * Strategy B — if a previous backup for this UDID already exists at
 * `outputPath/udid/Manifest.db`, sum its on-disk size. Re-acquisitions
 * will be very close to the prior size, so this is the most accurate
 * predictor when available.
 */
async function previousBackupSize(outputPath: string, udid: string): Promise<number | undefined> {
  const dir = path.join(outputPath, udid);
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return undefined;
  } catch {
    return undefined;
  }

  // Recursively sum file sizes. Capped at a reasonable depth to avoid
  // pathological cases (symlink loops, mounts).
  async function sumDir(p: string, depth: number): Promise<number> {
    if (depth > 4) return 0;
    let total = 0;
    let entries: import('fs').Dirent[] = [];
    try {
      entries = (await fs.readdir(p, { withFileTypes: true })) as unknown as import('fs').Dirent[];
    } catch { return 0; }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) total += await sumDir(full, depth + 1);
      else if (e.isFile()) {
        try { total += (await fs.stat(full)).size; } catch { /* ignore */ }
      }
    }
    return total;
  }
  const total = await sumDir(dir, 0);
  return total > 1024 * 1024 ? total : undefined; // ignore <1MB partials
}

/**
 * Public API: try strategies in order (most → least accurate) and return
 * the first one that yields a number.
 *
 * TODO(user-decision): Pick the BLEND/RATIO for combining strategies
 * when device-storage probing is implemented. See the function below.
 */
export async function estimateBackupSize(opts: {
  udid: string;
  outputPath: string;
}): Promise<SizeEstimate> {
  // 1. Previous backup at the same path — exact, when available.
  const prev = await previousBackupSize(opts.outputPath, opts.udid);
  if (prev) {
    return {
      totalBytes: prev,
      confidence: 'estimate',
      source: 'previous-backup',
      note: `Based on the prior backup at ${opts.outputPath}/${opts.udid} (${(prev / 1e9).toFixed(2)} GB).`,
    };
  }

  // 2. Device storage probe — heuristic, requires the device to be unlocked.
  const used = await probeDeviceStorage(opts.udid);
  if (used) {
    // TODO(user-decision): Apply the backup-coverage RATIO to convert
    // "device used storage" → "expected backup size". See applyBackupRatio()
    // below for the contribution point.
    const estimated = applyBackupRatio(used);
    return {
      totalBytes: estimated,
      confidence: 'estimate',
      source: 'device-storage',
      note: `Device reports ${(used / 1e9).toFixed(1)} GB used; backup typically covers a fraction of that.`,
    };
  }

  // 3. No prior info — UI shows "Calculating…" until idevicebackup2 emits
  //    its first byte total.
  return { confidence: 'unknown', source: 'unknown' };
}

/**
 * Convert "used device storage" into "expected backup size" using a
 * coverage ratio. iOS backups don't include everything: cached app data,
 * temp files, and (in non-encrypted mode) Health/Keychain are omitted.
 * Real-world ratios vary widely by usage pattern.
 *
 * TODO(user-decision): Implement this function. See the request below
 * for the trade-offs and approaches you should consider.
 */
function applyBackupRatio(usedBytes: number): number {
  // PLACEHOLDER — currently returns the raw used storage, which will
  // *over-estimate* nearly every backup (so the bar will sit at low
  // percentages until the actual transfer ends). Replace with a real
  // ratio strategy.
  return usedBytes;
}
