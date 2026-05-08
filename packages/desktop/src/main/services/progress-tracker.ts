/**
 * ProgressTracker — converts a stream of "current bytes / current count"
 * samples into smoothed speed and ETA estimates suitable for the renderer's
 * ProgressIndicator component.
 *
 * Why a tracker instead of computing speed inline at every emission:
 * - **Smoothing**: instantaneous bytes/sec swings wildly during burst I/O
 *   (ADB pull, idevicebackup2, big-file copies). An exponential moving
 *   average across the last N samples gives a number users can read
 *   without it flickering 10×/second.
 * - **ETA needs both speed AND remaining**: with a smoothed speed and a
 *   known total, ETA is just `(total - current) / speed`. The tracker
 *   handles divide-by-zero, zero-totals, and the "first sample" case
 *   where there's nothing to extrapolate from yet.
 * - **Reusable across handlers**: every handler that does file iteration
 *   (iOS extract, ADB backup, file-extract-format, BulkCopy, hashing,
 *   etc.) computes the same fields the same way; centralising prevents
 *   per-handler arithmetic mistakes.
 *
 * Usage pattern:
 *   const tracker = new ProgressTracker({ totalBytes: 1234567 });
 *   for each chunk:
 *     const s = tracker.sample({ bytes: cumulativeBytes });
 *     send({ percent: s.percent, bytes: s.bytes, totalBytes, speed: s.speed, eta: s.eta });
 */

interface TrackerOptions {
  /** Optional known total in bytes — drives percent + ETA. */
  totalBytes?: number;
  /** Optional known total file count — drives percent if no byte total. */
  totalFiles?: number;
  /**
   * EMA decay factor (0 < α < 1). Larger = more weight on recent samples
   * (jumpier but more responsive). 0.3 is a reasonable forensic default —
   * fast enough to react to a stalled transfer, smooth enough to be
   * readable.
   */
  smoothing?: number;
}

interface Sample {
  bytes?: number;
  filesCount?: number;
}

export interface ProgressSnapshot {
  percent: number;
  bytes?: number;
  totalBytes?: number;
  filesCount?: number;
  totalFiles?: number;
  /** Smoothed bytes/sec; undefined until at least 2 samples seen. */
  speed?: number;
  /** Seconds remaining at current smoothed speed; undefined if unknown. */
  eta?: number;
}

export class ProgressTracker {
  private readonly opts: Required<Pick<TrackerOptions, 'smoothing'>> & TrackerOptions;
  private lastTimeMs: number | null = null;
  private lastBytes: number | null = null;
  private smoothedSpeed: number | null = null;

  constructor(opts: TrackerOptions = {}) {
    this.opts = {
      smoothing: 0.3,
      ...opts,
    };
  }

  /**
   * Feed in a cumulative sample and get back the snapshot suitable for
   * forwarding to the renderer. Cumulative (not delta) because callers
   * usually have a running counter handy and computing deltas inside the
   * tracker means a missed sample doesn't double-count.
   */
  sample(s: Sample): ProgressSnapshot {
    const now = Date.now();
    const totalBytes = this.opts.totalBytes;
    const totalFiles = this.opts.totalFiles;

    // Speed update — EMA over the per-sample byte delta.
    if (typeof s.bytes === 'number' && this.lastTimeMs !== null && this.lastBytes !== null) {
      const dt = (now - this.lastTimeMs) / 1000;
      const dB = s.bytes - this.lastBytes;
      if (dt > 0 && dB >= 0) {
        const instant = dB / dt;
        if (this.smoothedSpeed === null) {
          this.smoothedSpeed = instant;
        } else {
          const a = this.opts.smoothing;
          this.smoothedSpeed = a * instant + (1 - a) * this.smoothedSpeed;
        }
      }
    }

    if (typeof s.bytes === 'number') {
      this.lastBytes = s.bytes;
      this.lastTimeMs = now;
    }

    // Percent — prefer bytes-based when known, fall back to file-count.
    let percent = 0;
    if (totalBytes && totalBytes > 0 && typeof s.bytes === 'number') {
      percent = Math.min(100, (s.bytes / totalBytes) * 100);
    } else if (totalFiles && totalFiles > 0 && typeof s.filesCount === 'number') {
      percent = Math.min(100, (s.filesCount / totalFiles) * 100);
    }

    // ETA — only meaningful with a positive smoothed speed and a known total.
    let eta: number | undefined;
    if (
      this.smoothedSpeed && this.smoothedSpeed > 0 &&
      totalBytes && totalBytes > 0 && typeof s.bytes === 'number'
    ) {
      const remaining = Math.max(0, totalBytes - s.bytes);
      eta = remaining / this.smoothedSpeed;
    }

    return {
      percent,
      bytes: s.bytes,
      totalBytes,
      filesCount: s.filesCount,
      totalFiles,
      speed: this.smoothedSpeed ?? undefined,
      eta,
    };
  }

  /**
   * Update the totals after construction — useful when the total only
   * becomes known partway through (e.g. after ADB enumerates files).
   */
  setTotals(opts: { totalBytes?: number; totalFiles?: number }): void {
    if (typeof opts.totalBytes === 'number') this.opts.totalBytes = opts.totalBytes;
    if (typeof opts.totalFiles === 'number') this.opts.totalFiles = opts.totalFiles;
  }
}
