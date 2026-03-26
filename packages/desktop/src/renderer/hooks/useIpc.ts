import { useState, useCallback } from 'react';

interface UseIpcReturn {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T | null>;
  loading: boolean;
  error: string | null;
  reset: () => void;
}

/**
 * Generic IPC invoke hook.
 * Returns a reusable invoke function, loading state, and error state.
 */
export function useIpc(): UseIpcReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(
    async <T = unknown>(channel: string, ...args: unknown[]): Promise<T | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = (await window.api.invoke(channel, ...args)) as T;
        setLoading(false);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setLoading(false);
        return null;
      }
    },
    []
  );

  const reset = useCallback(() => {
    setError(null);
    setLoading(false);
  }, []);

  return { invoke, loading, error, reset };
}
