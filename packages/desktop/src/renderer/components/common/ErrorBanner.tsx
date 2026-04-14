import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useErrorStore } from '../../store/error-store';

/**
 * Renders all severity:'error' events as red banners stacked at the top of
 * the page. Each is dismissable. Persistent until the user dismisses or
 * until clearAll() is called.
 *
 * Mounts once in AppLayout above <main>, between the auto-update banner
 * and the page content.
 */
export const ErrorBanner: React.FC = () => {
  const errors = useErrorStore((s) => s.errors.filter((e) => e.severity === 'error'));
  const dismiss = useErrorStore((s) => s.dismiss);

  if (errors.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-6 py-2">
      {errors.map((err) => (
        <div
          key={err.id}
          className="flex items-start justify-between gap-3 rounded border px-3 py-2 text-xs"
          style={{
            background: 'rgba(248,113,113,0.08)',
            borderColor: 'rgba(248,113,113,0.35)',
            color: '#f87171',
          }}
        >
          <div className="flex flex-1 items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">{err.message}</div>
              <div className="opacity-70">
                <span>{err.source}</span>
                {' • '}
                <span>{new Date(err.timestampIso).toLocaleTimeString()}</span>
              </div>
              {err.detail && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] opacity-80">
                  {err.detail}
                </pre>
              )}
            </div>
          </div>
          <button
            onClick={() => dismiss(err.id)}
            className="rounded p-1 transition hover:bg-white/10"
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};
