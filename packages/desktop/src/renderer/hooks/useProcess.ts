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
}

interface UseProcessOptions {
  channel: string;
  progressChannel?: string;
  logChannel?: string;
}

interface UseProcessResult {
  start: (...args: unknown[]) => Promise<void>;
  cancel: () => void;
  progress: ProcessState;
  logs: LogLine[];
  isRunning: boolean;
  error: string | null;
  clearLogs: () => void;
}

/**
 * Hook for long-running IPC processes with progress and log streaming.
 */
export function useProcess(options: UseProcessOptions): UseProcessResult {
  const { channel, progressChannel, logChannel } = options;

  const [progress, setProgress] = useState<ProcessState>({
    percent: 0,
    message: '',
  });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const cleanupFns = useRef<(() => void)[]>([]);

  const addLog = useCallback(
    (level: LogLine['level'], message: string) => {
      setLogs((prev) => [
        ...prev,
        { timestamp: Date.now(), level, message },
      ]);
    },
    []
  );

  const start = useCallback(
    async (...args: unknown[]) => {
      setIsRunning(true);
      setError(null);
      cancelledRef.current = false;
      setProgress({ percent: 0, message: 'Starting...' });

      const pChannel = progressChannel || `${channel}:progress`;
      const lChannel = logChannel || `${channel}:log`;

      const removeProgress = window.api.on(
        pChannel,
        (...progressArgs: unknown[]) => {
          const data = progressArgs[0] as ProcessState;
          if (!cancelledRef.current) {
            setProgress(data);
          }
        }
      );

      const removeLog = window.api.on(
        lChannel,
        (...logArgs: unknown[]) => {
          const entry = logArgs[0] as LogLine;
          if (!cancelledRef.current) {
            setLogs((prev) => [...prev, entry]);
          }
        }
      );

      cleanupFns.current = [removeProgress, removeLog];

      try {
        addLog('info', `Process started: ${channel}`);
        await window.api.invoke(channel, ...args);

        if (!cancelledRef.current) {
          setProgress({ percent: 100, message: 'Complete' });
          addLog('success', 'Process completed successfully');
        }
      } catch (err) {
        if (!cancelledRef.current) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          addLog('error', `Process failed: ${message}`);
        }
      } finally {
        setIsRunning(false);
        cleanupFns.current.forEach((fn) => fn());
        cleanupFns.current = [];
      }
    },
    [channel, progressChannel, logChannel, addLog]
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    addLog('warning', 'Process cancelled by user');
    window.api.invoke(`${channel}:cancel`).catch(() => {
      // Ignore cancel errors
    });
    setIsRunning(false);
    cleanupFns.current.forEach((fn) => fn());
    cleanupFns.current = [];
  }, [channel, addLog]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    return () => {
      cleanupFns.current.forEach((fn) => fn());
    };
  }, []);

  return { start, cancel, progress, logs, isRunning, error, clearLogs };
}
