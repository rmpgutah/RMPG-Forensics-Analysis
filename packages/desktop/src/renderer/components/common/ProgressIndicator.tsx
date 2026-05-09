import React, { useEffect, useState, useRef } from 'react';
import { Loader2, X, CheckCircle2 } from 'lucide-react';

export interface ProgressDetails {
  bytes?: number;
  totalBytes?: number;
  speed?: number;       // bytes/sec
  eta?: number;         // seconds remaining
  filesCount?: number;
  totalFiles?: number;
}

interface ProgressIndicatorProps extends ProgressDetails {
  percent: number;
  message?: string;
  isRunning?: boolean;
  showPercentage?: boolean;
  showElapsed?: boolean;
  onCancel?: () => void;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function fmtTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}:${s.toString().padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  percent: rawPercent,
  message,
  isRunning = false,
  showPercentage = true,
  showElapsed = true,
  onCancel,
  bytes,
  totalBytes,
  speed,
  eta,
  filesCount,
  totalFiles,
}) => {
  // Guard against NaN / undefined / Infinity so the UI never shows "NaN%".
  const percent = Number.isFinite(rawPercent) ? rawPercent : 0;
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning && !startRef.current) {
      startRef.current = Date.now();
    }
    if (!isRunning) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => {
      if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [isRunning]);

  // Build stats tokens for the detail row
  const stats: string[] = [];

  if (bytes !== undefined && totalBytes !== undefined && totalBytes > 0) {
    stats.push(`${fmtBytes(bytes)} / ${fmtBytes(totalBytes)}`);
  } else if (bytes !== undefined && bytes > 0) {
    stats.push(fmtBytes(bytes));
  }

  if (speed !== undefined && speed > 0) {
    stats.push(fmtSpeed(speed));
  }

  if (eta !== undefined && eta > 0 && isRunning) {
    stats.push(`ETA ${fmtTime(eta)}`);
  }

  if (showElapsed && isRunning && elapsed > 0) {
    stats.push(`Elapsed ${fmtTime(elapsed)}`);
  }

  if (filesCount !== undefined && totalFiles !== undefined && totalFiles > 0) {
    stats.push(`${filesCount.toLocaleString()} / ${totalFiles.toLocaleString()} files`);
  } else if (filesCount !== undefined && filesCount > 0) {
    stats.push(`${filesCount.toLocaleString()} files`);
  }

  const hasStats = stats.length > 0;

  return (
    <div className="space-y-1.5">
      {/* Top row: message + percent + cancel */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 min-w-0" style={{ color: 'var(--text-secondary)' }}>
          {isRunning && <Loader2 size={14} className="animate-spin text-[#6495ED] shrink-0" />}
          {!isRunning && percent >= 100 && (
            <CheckCircle2 size={14} className="text-green-400 shrink-0" />
          )}
          <span className="truncate">
            {!isRunning && percent >= 100
              ? (message ? `${message} — complete` : 'Complete')
              : message || (isRunning ? 'Processing…' : 'Ready')}
          </span>
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          {showPercentage && (
            <span className="font-mono text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {Math.round(Math.min(100, Math.max(0, percent)))}%
            </span>
          )}
          {onCancel && isRunning && (
            <button
              onClick={onCancel}
              className="rounded p-0.5 transition hover:text-red-400"
              style={{ color: 'var(--text-muted)' }}
              title="Cancel"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-hover)' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(100, Math.max(0, percent))}%`,
            background: isRunning
              ? 'linear-gradient(90deg, #6495ED, #4A7BD9)'
              : percent >= 100
              ? '#4ade80'
              : '#6495ED',
          }}
        />
      </div>

      {/* Stats row */}
      {hasStats && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {stats.map((token, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <span className="text-[10px] select-none" style={{ color: 'var(--border-color)' }}>·</span>
              )}
              <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {token}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
