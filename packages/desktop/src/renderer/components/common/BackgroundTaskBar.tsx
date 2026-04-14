import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Apple, CheckCircle, XCircle, Loader2, X, ExternalLink } from 'lucide-react';
import { useBackupStore } from '../../store';
import { ProgressIndicator } from './ProgressIndicator';

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s % 60}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const BackgroundTaskBar: React.FC = () => {
  const { task, dismiss } = useBackupStore();
  const navigate = useNavigate();

  if (!task || task.dismissed) return null;
  if (task.status === 'idle') return null;

  const elapsed = Date.now() - task.startTime;
  const isRunning = task.status === 'running';
  const isDone = task.status === 'done';
  const isError = task.status === 'error';

  const statusColor = isDone ? '#4ade80' : isError ? '#f87171' : '#6495ED';
  const borderColor = isDone ? 'rgba(74,222,128,0.3)' : isError ? 'rgba(248,113,113,0.3)' : 'rgba(100,149,237,0.3)';
  const bgColor = isDone ? 'rgba(74,222,128,0.06)' : isError ? 'rgba(248,113,113,0.06)' : 'rgba(100,149,237,0.06)';

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 text-sm"
      style={{
        background: bgColor,
        borderTop: `1px solid ${borderColor}`,
      }}
    >
      {/* Status icon */}
      <div className="mt-0.5 shrink-0">
        {isRunning && <Loader2 size={14} className="animate-spin" style={{ color: statusColor }} />}
        {isDone  && <CheckCircle size={14} style={{ color: statusColor }} />}
        {isError && <XCircle size={14} style={{ color: statusColor }} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Apple size={12} style={{ color: statusColor }} className="shrink-0" />
            <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {task.deviceName}
            </span>
            <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
              {isRunning && `· ${fmtElapsed(elapsed)} elapsed`}
              {isDone && '· Backup complete'}
              {isError && `· ${task.error}`}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isDone && (
              <button
                onClick={() => navigate('/ios/quick-extract')}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition hover:opacity-80"
                style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80' }}
              >
                <ExternalLink size={10} />
                Extract Data
              </button>
            )}
            {!isRunning && (
              <button
                onClick={dismiss}
                className="rounded p-0.5 transition hover:text-white"
                style={{ color: 'var(--text-muted)' }}
                title="Dismiss"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Progress bar — only while running */}
        {isRunning && (
          <ProgressIndicator
            percent={task.progress.percent}
            message={task.progress.message}
            isRunning
            showElapsed={false}
            bytes={task.progress.bytes}
            totalBytes={task.progress.totalBytes}
            speed={task.progress.speed}
            eta={task.progress.eta}
            filesCount={task.progress.filesCount}
            totalFiles={task.progress.totalFiles}
          />
        )}
      </div>
    </div>
  );
};
