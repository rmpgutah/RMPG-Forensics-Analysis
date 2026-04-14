import React, { useState } from 'react';
import { AlertOctagon, ChevronDown, ChevronRight } from 'lucide-react';
import { useErrorStore } from '../../store/error-store';

/**
 * Renders the FIRST severity:'critical' event as a blocking modal overlay.
 * The modal cannot be dismissed without clicking Acknowledge — once
 * acknowledged, it removes the event from the store and the next critical
 * event (if any) becomes visible.
 *
 * Mounts once in AppLayout. Position:fixed full-screen overlay.
 */
export const ErrorModal: React.FC = () => {
  const critical = useErrorStore((s) => s.errors.find((e) => e.severity === 'critical'));
  const acknowledge = useErrorStore((s) => s.acknowledgeCritical);
  const [showDetail, setShowDetail] = useState(false);

  if (!critical) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.65)' }}
    >
      <div
        className="card max-w-2xl w-full"
        style={{ borderColor: 'rgba(248,113,113,0.5)' }}
      >
        <div className="flex items-start gap-3">
          <AlertOctagon size={24} className="mt-0.5 flex-shrink-0 text-red-400" />
          <div className="flex-1">
            <h2 className="mb-2 text-lg font-bold text-red-400">Critical Error</h2>
            <p className="mb-2 text-sm" style={{ color: 'var(--text-primary)' }}>
              {critical.message}
            </p>
            <div className="text-xs opacity-60">
              <span>{critical.source}</span>
              {' • '}
              <span>{new Date(critical.timestampIso).toLocaleString()}</span>
            </div>
            {critical.detail && (
              <button
                onClick={() => setShowDetail((v) => !v)}
                className="mt-2 flex items-center gap-1 text-xs opacity-70 hover:opacity-100"
              >
                {showDetail ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {showDetail ? 'Hide details' : 'Show details'}
              </button>
            )}
            {showDetail && critical.detail && (
              <pre
                className="mt-2 max-h-64 overflow-auto rounded p-2 text-left text-[10px]"
                style={{ background: 'rgba(0,0,0,0.3)', color: '#f87171', whiteSpace: 'pre-wrap' }}
              >
                {critical.detail}
              </pre>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => acknowledge(critical.id)}
            className="btn-primary"
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};
