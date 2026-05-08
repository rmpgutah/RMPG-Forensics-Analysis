import { create } from 'zustand';
import type { DeviceInfo } from '../types/global';

export interface DeviceProfile {
  platform: 'android' | 'ios';
  serial: string;
  scannedAt: string;
  scanning: boolean;
  error?: string;

  // Identity
  deviceName: string;
  model: string;
  manufacturer: string;
  serialNumber?: string;
  phoneNumber?: string;
  imei?: string;
  androidVersion?: string;
  productVersion?: string;
  buildVersion?: string;
  buildId?: string;
  sdkVersion?: string;
  cpuAbi?: string;
  cpuInfo?: string;
  hardwareModel?: string;
  wifiAddress?: string;
  bluetoothAddress?: string;
  uniqueDeviceID?: string;

  // Battery
  battery?: {
    level: number;
    status?: string;
    health?: string;
    temperature?: string;
    voltage?: string;
    charging?: boolean;
  };

  // Storage
  storage?: Record<string, string> | string;

  // Memory
  memory?: Record<string, string>;

  // Network
  wifi?: { ssid?: string; bssid?: string; channel?: string };
  ipAddresses?: string[];

  // Location
  lastLocation?: { lat: number; lon: number } | null;

  // Apps
  installedAppCount?: number;
  installedApps?: string[];

  // Accounts
  accounts?: string[];

  // System
  uptimeHours?: string;
  securityPatch?: string;
  encrypted?: string;
  bootloaderStatus?: string;

  // Raw properties (all key-value pairs from device)
  allProperties?: Record<string, string>;
}

export interface ConnectionNotice {
  serial: string;
  label: string;
  platform: 'android' | 'ios';
  connectedAt: number;
}

export interface DeviceState {
  androidDevices: DeviceInfo[];
  iosDevices: DeviceInfo[];
  selectedDevice: DeviceInfo | null;
  isPolling: boolean;
  lastPollTime: number | null;

  // Auto-scan profiles keyed by device serial
  deviceProfiles: Record<string, DeviceProfile>;

  // Connection acknowledgement notices (cleared after display)
  connectionNotices: ConnectionNotice[];

  setAndroidDevices: (devices: DeviceInfo[]) => void;
  setIosDevices: (devices: DeviceInfo[]) => void;
  selectDevice: (device: DeviceInfo | null) => void;
  setPolling: (polling: boolean) => void;
  setLastPollTime: (time: number) => void;
  setDeviceProfile: (serial: string, profile: Partial<DeviceProfile>) => void;
  setDeviceScanning: (serial: string, scanning: boolean) => void;
  clearDeviceProfile: (serial: string) => void;
  addConnectionNotice: (notice: ConnectionNotice) => void;
  dismissConnectionNotice: (serial: string) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  androidDevices: [],
  iosDevices: [],
  selectedDevice: null,
  isPolling: false,
  lastPollTime: null,
  deviceProfiles: {},
  connectionNotices: [],

  setAndroidDevices: (devices) => set({ androidDevices: devices }),
  setIosDevices: (devices) => set({ iosDevices: devices }),
  selectDevice: (device) => set({ selectedDevice: device }),
  setPolling: (polling) => set({ isPolling: polling }),
  setLastPollTime: (time) => set({ lastPollTime: time }),

  setDeviceProfile: (serial, profile) =>
    set((state) => ({
      deviceProfiles: {
        ...state.deviceProfiles,
        [serial]: { serial, ...(state.deviceProfiles[serial] ?? {}), ...profile } as DeviceProfile,
      },
    })),

  setDeviceScanning: (serial, scanning) =>
    set((state) => ({
      deviceProfiles: {
        ...state.deviceProfiles,
        [serial]: { ...(state.deviceProfiles[serial] ?? {}), serial, scanning } as DeviceProfile,
      },
    })),

  clearDeviceProfile: (serial) =>
    set((state) => {
      const profiles = { ...state.deviceProfiles };
      delete profiles[serial];
      return { deviceProfiles: profiles };
    }),

  addConnectionNotice: (notice) =>
    set((state) => ({
      connectionNotices: [
        notice,
        ...state.connectionNotices.filter((n) => n.serial !== notice.serial),
      ].slice(0, 5), // keep at most 5
    })),

  dismissConnectionNotice: (serial) =>
    set((state) => ({
      connectionNotices: state.connectionNotices.filter((n) => n.serial !== serial),
    })),
}));
