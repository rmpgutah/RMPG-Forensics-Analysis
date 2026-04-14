import React, { useEffect } from 'react';
import { X, Info } from 'lucide-react';
import { useErrorStore } from '../../store/error-store';
import type { ErrorEvent } from '@rmpg/shared';

const TOAST_DURATION_MS = 5000;

/**
 * Renders all severity:'warning' events as auto-dismissing toasts in the
 * bottom-right corner. Each toast lives for 5 seconds.
 *
 * Mounts once in AppLayout (floating, position:fixed).
 */
export const ErrorToast: React.FC = () => {
  const warnings = useErrorStore((s) => s.errors.filter((e) => e.severity === 'warning'));

  return (
    <div
      className="fixed bottom-4 right-4 z-40 flex flex-col gap-2"
      style={{ pointerEvents: 'none' }}
    >
      {warnings.map((w) => (
        <ToastItem key={w.id} event={w} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ event: ErrorEvent }> = ({ event }) => {
  const dismiss = useErrorStore((s) => s.dismiss);

  useEffect(() => {
    const id = setTimeout(() => dismiss(event.id), TOAST_DURATION_MS);
    return () => clearTimeout(id);
  }, [event.id, dismiss]);

  return (
    <div
      className="flex items-start gap-2 rounded border px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'rgba(251,191,36,0.12)',
        borderColor: 'rgba(251,191,36,0.4)',
        color: '#fbbf24',
        pointerEvents: 'auto',
        minWidth: 240,
        maxWidth: 360,
      }}
    >
      <Info size={14} className="mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <div className="font-medium">{event.message}</div>
        <div className="opacity-60">{event.source}</div>
      </div>
      <button
        onClick={() => dismiss(event.id)}
        className="rounded p-0.5 transition hover:bg-white/10"
        aria-label="Dismiss"
      >
        <X size={11} />
      </button>
    </div>
  );
};
