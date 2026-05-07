export interface DeviceInfo {
  serial: string;
  model: string;
  manufacturer: string;
  androidVersion?: string;
  iosVersion?: string;
  type: 'android' | 'ios';
}

export interface ProcessProgress {
  percent: number;
  message: string;
  phase?: string;
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface CaseInfo {
  name: string;
  path: string;
  createdAt: string;
  examiner?: string;
  caseNumber?: string;
  description?: string;
}

export interface ToolPaths {
  adb: string;
  java: string;
  iped: string;
  tesseract: string;
  ffmpeg: string;
  scrcpy: string;
}

export interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
  removeAllListeners: (channel: string) => void;
  platform: NodeJS.Platform;
  /** Resolve a dropped File's host filesystem path. Electron 32+ replacement
   *  for the deprecated `File.path`. Empty string if the file has no path
   *  (e.g. clipboard-pasted blob with no disk backing). */
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

export {};
