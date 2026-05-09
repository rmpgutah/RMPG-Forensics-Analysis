import { useState, useCallback, useRef, useEffect } from 'react';

export interface LogLine {
  timestamp: number;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface ProcessState {
  percent: number;
  message: string;
  phase?: string;
  bytes?: number;
  totalBytes?: number;
  speed?: number;       // bytes/sec
  eta?: number;         // seconds remaining
  filesCount?: number;
  totalFiles?: number;
}

interface UseProcessOptions {
  channel: string;
  progressChannel?: string;
  logChannel?: string;
}

interface UseProcessResult {
  /**
   * Invoke the IPC channel and return whatever the handler resolved with.
   * Returns `undefined` if the call threw (the error is also exposed via
   * `error`). Returning the value lets pages read structured handler output
   * — e.g. the OCR page binds `result.text` straight to its viewer textarea.
   */
  start: (...args: unknown[]) => Promise<unknown>;
  cancel: () => void;
  progress: ProcessState;
  logs: LogLine[];
  isRunning: boolean;
  error: string | null;
  clearLogs: () => void;
}

/**
 * Parse an incoming progress event into ProcessState.
 *
 * Handlers emit one of two shapes:
 *   A) Rich:   { percent, message?, bytes?, speed?, eta?, ... }
 *   B) Legacy: { type, data, timestamp }  (raw ProcessProgress line)
 *
 * Both are accepted; legacy events update the message but leave
 * percent/bytes unchanged so the bar doesn't jump to 0.
 */
function parseProgressEvent(raw: Record<string, unknown>, prev: ProcessState): ProcessState {
  if (typeof raw.percent === 'number' && Number.isFinite(raw.percent as number)) {
    // Rich format
    return {
      percent: raw.percent as number,
      message: (raw.message as string) || (raw.data as string) || prev.message,
      phase: (raw.phase as string) ?? prev.phase,
      bytes: (raw.bytes as number) ?? prev.bytes,
      totalBytes: (raw.totalBytes as number) ?? prev.totalBytes,
      speed: (raw.speed as number) ?? undefined,
      eta: (raw.eta as number) ?? undefined,
      filesCount: (raw.filesCount as number) ?? prev.filesCount,
      totalFiles: (raw.totalFiles as number) ?? prev.totalFiles,
    };
  }
  // Legacy ProcessProgress — update message only
  if (raw.data !== undefined) {
    return { ...prev, message: String(raw.data) };
  }
  return prev;
}

/**
 * Hook for long-running IPC processes with progress and log streaming.
 */
export function useProcess(options: UseProcessOptions): UseProcessResult {
  const { channel, progressChannel, logChannel } = options;

  const [progress, setProgress] = useState<ProcessState>({ percent: 0, message: '' });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const cleanupFns = useRef<(() => void)[]>([]);

  const addLog = useCallback((level: LogLine['level'], message: string) => {
    setLogs((prev) => [...prev, { timestamp: Date.now(), level, message }]);
  }, []);

  const start = useCallback(
    async (...args: unknown[]) => {
      setIsRunning(true);
      setError(null);
      cancelledRef.current = false;
      setProgress({ percent: 0, message: 'Starting…' });

      const pChannel = progressChannel || `${channel}:progress`;
      const lChannel = logChannel || `${channel}:log`;

      const removeProgress = window.api.on(pChannel, (...progressArgs: unknown[]) => {
        if (cancelledRef.current) return;
        const raw = progressArgs[0] as Record<string, unknown>;
        setProgress((prev) => parseProgressEvent(raw, prev));
      });

      const removeLog = window.api.on(lChannel, (...logArgs: unknown[]) => {
        const entry = logArgs[0] as LogLine;
        if (!cancelledRef.current) setLogs((prev) => [...prev, entry]);
      });

      cleanupFns.current = [removeProgress, removeLog];

      try {
        addLog('info', `Process started: ${channel}`);
        const result = await window.api.invoke(channel, ...args);

        if (!cancelledRef.current) {
          // Check if the handler returned a failure result instead of throwing
          if (
            result &&
            typeof result === 'object' &&
            'success' in result &&
            result.success === false
          ) {
            const message = (result as { error?: string }).error || 'Process failed';
            setError(message);
            addLog('error', `Process failed: ${message}`);
          } else {
            setProgress({ percent: 100, message: 'Complete' });
            addLog('success', 'Process completed successfully');
          }
        }
        return result;
      } catch (err) {
        if (!cancelledRef.current) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setProgress({ percent: 0, message: '' });
          addLog('error', `Process failed: ${msg}`);
        }
        return undefined;
      } finally {
        setIsRunning(false);
        cleanupFns.current.forEach((fn) => typeof fn === 'function' && fn());
        cleanupFns.current = [];
      }
    },
    [channel, progressChannel, logChannel, addLog]
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    addLog('warning', 'Process cancelled by user');
    window.api.invoke(`${channel}:cancel`).catch(() => {});
    setIsRunning(false);
    cleanupFns.current.forEach((fn) => typeof fn === 'function' && fn());
    cleanupFns.current = [];
  }, [channel, addLog]);

  const clearLogs = useCallback(() => setLogs([]), []);

  useEffect(() => {
    return () => {
      cleanupFns.current.forEach((fn) => typeof fn === 'function' && fn());
    };
  }, []);

  return { start, cancel, progress, logs, isRunning, error, clearLogs };
}
