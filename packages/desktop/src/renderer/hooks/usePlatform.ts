import { useState, useEffect } from 'react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { useIpc } from './useIpc';

export type Platform = 'win32' | 'darwin' | 'linux';

/**
 * Hook to detect the host OS platform.
 */
export function usePlatform() {
  const { invoke } = useIpc();
  const [platform, setPlatform] = useState<Platform>(
    (window.api?.platform as Platform) ?? 'darwin'
  );

  useEffect(() => {
    invoke<string>(IPC_CHANNELS.APP_GET_PLATFORM).then((p) => {
      if (p) setPlatform(p as Platform);
    });
  }, [invoke]);

  return {
    platform,
    isWindows: platform === 'win32',
    isMac: platform === 'darwin',
    isLinux: platform === 'linux',
  };
}
