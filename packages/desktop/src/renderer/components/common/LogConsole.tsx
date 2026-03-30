import React, { useEffect, useRef } from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import type { LogEntry } from '../../types/global';

interface LogConsoleProps {
  logs: LogEntry[];
  maxHeight?: string;
  onClear?: () => void;
  title?: string;
}

const levelColors: Record<LogEntry['level'], string> = {
  info: 'text-slate-300',
  warning: 'text-yellow-400',
  error: 'text-red-400',
  success: 'text-green-400',
};

const levelLabels: Record<LogEntry['level'], string> = {
  info: 'INFO',
  warning: 'WARN',
  error: 'ERR ',
  success: ' OK ',
};

export const LogConsole: React.FC<LogConsoleProps> = ({
  logs,
  maxHeight = '300px',
  onClear,
  title = 'Console Output',
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Terminal size={14} />
          <span>{title}</span>
          <span className="text-xs text-slate-600">({logs.length} lines)</span>
        </div>
        {onClear && (
          <button
            onClick={onClear}
            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            title="Clear logs"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div
        className="overflow-y-auto p-3 font-mono text-xs leading-5"
        style={{ maxHeight }}
      >
        {logs.length === 0 ? (
          <span className="text-slate-600">Waiting for output...</span>
        ) : (
          logs.map((entry, idx) => {
            const d = new Date(entry.timestamp);
            const time = isNaN(d.getTime()) ? new Date().toLocaleTimeString() : d.toLocaleTimeString();
            return (
              <div key={idx} className="whitespace-pre-wrap">
                <span className="text-slate-600">[{time}]</span>{' '}
                <span className={levelColors[entry.level]}>
                  [{levelLabels[entry.level]}]
                </span>{' '}
                <span className={levelColors[entry.level]}>{entry.message}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
