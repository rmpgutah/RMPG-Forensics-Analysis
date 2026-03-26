import React, { useEffect, useState, useRef } from 'react';
import { Loader2, X } from 'lucide-react';

interface ProgressIndicatorProps {
  percent: number;
  message?: string;
  isRunning?: boolean;
  showPercentage?: boolean;
  showElapsed?: boolean;
  onCancel?: () => void;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  percent,
  message,
  isRunning = false,
  showPercentage = true,
  showElapsed = false,
  onCancel,
}) => {
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
      if (startRef.current) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isRunning]);

  const formatElapsed = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-slate-300">
          {isRunning && <Loader2 size={14} className="animate-spin text-blue-400" />}
          <span>{message || (isRunning ? 'Processing...' : 'Ready')}</span>
        </div>
        <div className="flex items-center gap-3">
          {showElapsed && isRunning && (
            <span className="font-mono text-xs text-slate-500">
              {formatElapsed(elapsed)}
            </span>
          )}
          {showPercentage && (
            <span className="font-mono text-xs text-slate-500">
              {Math.round(percent)}%
            </span>
          )}
          {onCancel && isRunning && (
            <button
              onClick={onCancel}
              className="rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-red-400"
              title="Cancel"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-300"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
};
