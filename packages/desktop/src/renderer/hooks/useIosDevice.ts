import { useState, useEffect } from 'react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { useDeviceStore } from '../store/device-store';

export interface IosDeviceOption {
  udid: string;
  label: string;
  backupPath: string;
  backupFound: boolean;
  backupDate: string | null;
}

/**
 * Watches the Zustand device store for connected iOS devices.
 * For each iOS device, resolves its local iTunes/Finder backup path.
 * Returns an array of IosDeviceOption so the UI can display a picker
 * and auto-populate backupPath without any manual folder browsing.
 */
export function useIosDevice() {
  const { deviceProfiles } = useDeviceStore();
  const [iosDevices, setIosDevices] = useState<IosDeviceOption[]>([]);

  useEffect(() => {
    const profiles = Object.values(deviceProfiles).filter((p) => p.platform === 'ios');

    if (profiles.length === 0) {
      setIosDevices([]);
      return;
    }

    let cancelled = false;

    Promise.all(
      profiles.map(async (p) => {
        const udid = p.uniqueDeviceID ?? p.serial;
        const label =
          p.deviceName || p.model || `iPhone (${udid.substring(0, 8)}…)`;

        try {
          const result = (await window.api.invoke(IPC_CHANNELS.IOS_FIND_BACKUP_PATH, udid)) as {
            found: boolean;
            path: string;
            lastModified: string | null;
          };
          return {
            udid,
            label,
            backupPath: result.path,
            backupFound: result.found,
            backupDate: result.lastModified,
          } satisfies IosDeviceOption;
        } catch {
          return {
            udid,
            label,
            backupPath: '',
            backupFound: false,
            backupDate: null,
          } satisfies IosDeviceOption;
        }
      })
    ).then((opts) => {
      if (!cancelled) setIosDevices(opts);
    });

    return () => { cancelled = true; };
  }, [deviceProfiles]);

  return { iosDevices };
}
