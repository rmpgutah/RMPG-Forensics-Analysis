import { create } from 'zustand';
import type { DeviceInfo } from '../types/global';

export interface DeviceState {
  androidDevices: DeviceInfo[];
  iosDevices: DeviceInfo[];
  selectedDevice: DeviceInfo | null;
  isPolling: boolean;
  lastPollTime: number | null;

  setAndroidDevices: (devices: DeviceInfo[]) => void;
  setIosDevices: (devices: DeviceInfo[]) => void;
  selectDevice: (device: DeviceInfo | null) => void;
  setPolling: (polling: boolean) => void;
  setLastPollTime: (time: number) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  androidDevices: [],
  iosDevices: [],
  selectedDevice: null,
  isPolling: false,
  lastPollTime: null,

  setAndroidDevices: (devices) => set({ androidDevices: devices }),
  setIosDevices: (devices) => set({ iosDevices: devices }),
  selectDevice: (device) => set({ selectedDevice: device }),
  setPolling: (polling) => set({ isPolling: polling }),
  setLastPollTime: (time) => set({ lastPollTime: time }),
}));
