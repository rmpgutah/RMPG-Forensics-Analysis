import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SettingsState {
  toolPaths: {
    adb: string;
    java: string;
    iped: string;
    tesseract: string;
    ffmpeg: string;
    scrcpy: string;
  };
  preferences: {
    autoDetectDevices: boolean;
    devicePollInterval: number;
    defaultOutputDir: string;
    hashAlgorithm: 'md5' | 'sha1' | 'sha256';
    logLevel: 'info' | 'debug' | 'warning' | 'error';
    theme: 'dark' | 'light';
    /**
     * Examination-mode write blocker. When true, any IPC operation that
     * would write to or modify a connected device is refused at the
     * renderer side AND surfaces a banner. This is policy-level
     * enforcement (matches UFED PA "examination mode") — the kernel-level
     * read-only mount is out of scope for an Electron app.
     */
    writeBlocker: boolean;
  };

  setToolPath: (tool: keyof SettingsState['toolPaths'], path: string) => void;
  setPreference: <K extends keyof SettingsState['preferences']>(
    key: K,
    value: SettingsState['preferences'][K]
  ) => void;
  resetToolPaths: () => void;
}

const defaultToolPaths = {
  adb: '',
  java: '',
  iped: '',
  tesseract: '',
  ffmpeg: '',
  scrcpy: '',
};

const defaultPreferences = {
  autoDetectDevices: true,
  devicePollInterval: 3000,
  defaultOutputDir: '',
  hashAlgorithm: 'sha256' as const,
  logLevel: 'info' as const,
  theme: 'dark' as const,
  writeBlocker: true, // Default ON — courtroom-safe by default; analyst opts out for restoration tasks.
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      toolPaths: { ...defaultToolPaths },
      preferences: { ...defaultPreferences },

      setToolPath: (tool, path) =>
        set((state) => ({
          toolPaths: { ...state.toolPaths, [tool]: path },
        })),

      setPreference: (key, value) =>
        set((state) => ({
          preferences: { ...state.preferences, [key]: value },
        })),

      resetToolPaths: () => set({ toolPaths: { ...defaultToolPaths } }),
    }),
    {
      name: 'rmpg-forensics-settings',
    }
  )
);
