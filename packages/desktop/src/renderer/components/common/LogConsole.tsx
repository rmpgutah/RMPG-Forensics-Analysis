import React, { useEffect, useRef } from 'react';
import { Terminal, Trash2, Copy, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import type { LogEntry } from '../../types/global';

type LogItem = LogEntry | string;

interface LogConsoleProps {
  /** May be undefined when the parent forgets to pass it (e.g. a hook
   *  return that hadn't been destructured cleanly). We coerce to []
   *  in the body so the component never crashes from missing input —
   *  the WhatsAppParser page surfaced this when its `useIpc()` returned
   *  no `logs` field, taking the entire renderer down. */
  logs?: LogItem[] | null;
  maxHeight?: string;
  onClear?: () => void;
  title?: string;
}

// ─── Level config ──────────────────────────────────────────────────────────────
// Badge: the level label pill background + foreground
// Text: the message body color — lighter than the badge so content is easy to read
const LEVEL_CONFIG: Record<string, {
  badge: string;   // badge background + text (Tailwind classes)
  text: string;    // message body color
  label: string;
  icon: React.ReactNode;
}> = {
  info: {
    badge: 'bg-slate-700 text-slate-300',
    text: 'text-slate-200',
    label: 'INFO',
    icon: <Info size={10} />,
  },
  warning: {
    badge: 'bg-yellow-900/60 text-yellow-300',
    text: 'text-yellow-100',
    label: 'WARN',
    icon: <AlertTriangle size={10} />,
  },
  error: {
    badge: 'bg-red-900/60 text-red-300',
    text: 'text-red-100',
    label: 'ERROR',
    icon: <XCircle size={10} />,
  },
  success: {
    badge: 'bg-green-900/60 text-green-300',
    text: 'text-green-100',
    label: 'DONE',
    icon: <CheckCircle2 size={10} />,
  },
};

const DEFAULT_CONFIG = LEVEL_CONFIG.info;

/** Normalise any log item into a display-ready object. */
function normalise(item: LogItem): {
  time: string;
  config: typeof DEFAULT_CONFIG;
  message: string;
} {
  if (typeof item === 'string') {
    const stripped = item.replace(/^\[\d{1,2}:\d{2}:\d{2}.*?\]\s*/, '').trim();
    return {
      time: new Date().toLocaleTimeString(),
      config: DEFAULT_CONFIG,
      message: stripped || item,
    };
  }

  const level = item.level ?? 'info';
  const d = new Date(item.timestamp ?? Date.now());
  const time = isNaN(d.getTime()) ? new Date().toLocaleTimeString() : d.toLocaleTimeString();
  return {
    time,
    config: LEVEL_CONFIG[level] ?? DEFAULT_CONFIG,
    message: item.message ?? '',
  };
}

export const LogConsole: React.FC<LogConsoleProps> = ({
  logs: rawLogs,
  maxHeight = '300px',
  onClear,
  title = 'Console Output',
}) => {
  // Coerce missing/null/non-array inputs to []. Several pages (WhatsApp
  // Parser, AcquisitionWizard wired through useIpc) can pass undefined
  // when a hook hasn't initialised yet — without this guard every
  // `logs.filter` call below threw and bubbled up to the page error
  // boundary, blanking the entire route.
  const logs: LogItem[] = Array.isArray(rawLogs) ? rawLogs : [];
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleCopy = () => {
    const text = logs
      .map((item) => {
        const { time, config, message } = normalise(item);
        return `[${time}] [${config.label}] ${message}`;
      })
      .join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  // Count warnings and errors for the summary badge
  const warnCount = logs.filter((l) => typeof l !== 'string' && (l as LogEntry).level === 'warning').length;
  const errorCount = logs.filter((l) => typeof l !== 'string' && (l as LogEntry).level === 'error').length;

  return (
    <div className="log-console rounded-lg border border-slate-700 bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Terminal size={14} />
          <span>{title}</span>
          <span className="text-xs text-slate-600">({logs.length} lines)</span>
          {errorCount > 0 && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-900/50 text-red-300">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && errorCount === 0 && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-yellow-900/50 text-yellow-300">
              {warnCount} warning{warnCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {logs.length > 0 && (
            <button
              onClick={handleCopy}
              className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              title="Copy all to clipboard"
            >
              <Copy size={13} />
            </button>
          )}
          {onClear && (
            <button
              onClick={onClear}
              className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              title="Clear logs"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="overflow-y-auto p-3 font-mono text-xs leading-5" style={{ maxHeight }}>
        {logs.length === 0 ? (
          <div className="flex items-center gap-2 text-slate-600">
            <Terminal size={12} />
            <span>Waiting for output — run a tool to see results here.</span>
          </div>
        ) : (
          logs.map((item, idx) => {
            const { time, config, message } = normalise(item);
            if (!message) return null;
            return (
              <div
                key={`log-${idx}-${(item as LogEntry)?.timestamp ?? idx}`}
                className="flex items-start gap-2 py-px hover:bg-white/[0.02] rounded"
              >
                {/* Timestamp */}
                <span className="shrink-0 text-slate-600">[{time}]</span>
                {/* Level badge */}
                <span className={`shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold ${config.badge}`}>
                  {config.icon}
                  {config.label}
                </span>
                {/* Message — distinct color from badge so content is easy to read */}
                <span className={`whitespace-pre-wrap break-all ${config.text}`}>{message}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
