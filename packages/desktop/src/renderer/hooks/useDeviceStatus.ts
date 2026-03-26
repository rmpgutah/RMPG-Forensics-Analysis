import { useEffect, useCallback } from 'react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { useIpc } from './useIpc';
import { useDeviceStore } from '../store/device-store';
import type { DeviceInfo } from '../types/global';

/**
 * Hook for device polling and selection.
 */
export function useDeviceStatus(pollInterval = 5000) {
  const { invoke } = useIpc();
  const {
    androidDevices,
    iosDevices,
    selectedDevice,
    isPolling,
    setAndroidDevices,
    setIosDevices,
    selectDevice,
    setPolling,
    setLastPollTime,
  } = useDeviceStore();

  const poll = useCallback(async () => {
    try {
      const result = (await invoke(IPC_CHANNELS.ADB_LIST_DEVICES)) as {
        android: DeviceInfo[];
        ios: DeviceInfo[];
      };
      setAndroidDevices(result.android ?? []);
      setIosDevices(result.ios ?? []);
      setLastPollTime(Date.now());
    } catch {
      // Silently fail on poll errors
    }
  }, [invoke, setAndroidDevices, setIosDevices, setLastPollTime]);

  useEffect(() => {
    poll(); // initial poll
    const interval = setInterval(poll, pollInterval);
    setPolling(true);
    return () => {
      clearInterval(interval);
      setPolling(false);
    };
  }, [poll, pollInterval, setPolling]);

  const allDevices: DeviceInfo[] = [...androidDevices, ...iosDevices];

  return {
    androidDevices,
    iosDevices,
    allDevices,
    selectedDevice,
    selectDevice,
    isPolling,
    refresh: poll,
  };
}
