import { useEffect, useCallback, useRef } from 'react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { useIpc } from './useIpc';
import { useDeviceStore } from '../store/device-store';
import type { DeviceInfo } from '../types/global';

/**
 * Hook for device polling, selection, and automatic scanning on connection.
 *
 * When a new device is detected (serial not seen in previous poll), it
 * immediately triggers DEVICE_AUTO_SCAN to collect all available info.
 * Profiles are stored in the device-store and displayed on the Dashboard.
 *
 * Default poll interval is 2 seconds for fast detection.
 */
export function useDeviceStatus(pollInterval = 2000) {
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
    setDeviceProfile,
    setDeviceScanning,
    clearDeviceProfile,
    addConnectionNotice,
  } = useDeviceStore();

  // Track which serials we've already seen so we can detect new connections
  const knownSerials = useRef<Set<string>>(new Set());
  // Track first poll to suppress notifications on app startup
  const isFirstPoll = useRef(true);

  const runAutoScan = useCallback(
    async (serial: string, platform: 'android' | 'ios') => {
      setDeviceScanning(serial, true);
      try {
        const profile = await invoke(IPC_CHANNELS.DEVICE_AUTO_SCAN, { serial, platform });
        if (profile) {
          setDeviceProfile(serial, { ...(profile as object), scanning: false });
        } else {
          setDeviceScanning(serial, false);
        }
      } catch (err) {
        setDeviceProfile(serial, {
          serial,
          platform,
          scanning: false,
          error: err instanceof Error ? err.message : String(err),
          scannedAt: new Date().toISOString(),
          deviceName: '',
          model: '',
          manufacturer: platform === 'ios' ? 'Apple' : '',
        });
      }
    },
    [invoke, setDeviceProfile, setDeviceScanning]
  );

  const poll = useCallback(async () => {
    try {
      const result = (await invoke(IPC_CHANNELS.ADB_LIST_DEVICES)) as {
        android: DeviceInfo[];
        ios: DeviceInfo[];
      };

      const android: DeviceInfo[] = (result.android ?? []).map((d) => ({ ...d, type: 'android' as const }));
      const ios: DeviceInfo[] = (result.ios ?? []).map((d) => ({ ...d, type: 'ios' as const }));

      setAndroidDevices(android);
      setIosDevices(ios);
      setLastPollTime(Date.now());

      const allCurrent = [...android, ...ios];
      const currentSerials = new Set(allCurrent.map((d) => d.serial));

      // Detect newly connected devices
      for (const device of allCurrent) {
        if (!knownSerials.current.has(device.serial)) {
          const platform = device.type ?? (device.manufacturer === 'Apple' ? 'ios' : 'android');

          // Notify on subsequent polls (not app startup)
          if (!isFirstPoll.current) {
            const label = device.model || device.name || device.serial;
            addConnectionNotice({
              serial: device.serial,
              label,
              platform,
              connectedAt: Date.now(),
            });
          }

          runAutoScan(device.serial, platform);
        }
      }

      // Remove profiles for disconnected devices
      for (const serial of knownSerials.current) {
        if (!currentSerials.has(serial)) {
          clearDeviceProfile(serial);
        }
      }

      knownSerials.current = currentSerials;
      isFirstPoll.current = false;
    } catch (err) {
      // Main process already reported via ERROR_REPORT IPC and audit log
      // (see error-reporter.ts + the migrated adb-handlers ADB_LIST_DEVICES).
      // Local console output here is for renderer-side debugging only —
      // do NOT show UI from this catch, the main-process error system is
      // the single source of truth for user-visible error surfacing.
      // eslint-disable-next-line no-console
      console.error('[useDeviceStatus] poll() failed', err);
    }
  }, [invoke, setAndroidDevices, setIosDevices, setLastPollTime, runAutoScan, clearDeviceProfile, addConnectionNotice]);

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
