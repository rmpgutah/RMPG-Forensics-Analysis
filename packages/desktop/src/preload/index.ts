import { contextBridge, ipcRenderer, webUtils } from 'electron';

export type IpcApi = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  /** Subscribe to an IPC event. Returns an unsubscribe function. */
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
  removeAllListeners: (channel: string) => void;
  platform: NodeJS.Platform;
  /**
   * Resolve a dropped File's absolute path on the host filesystem.
   *
   * Electron 32+ removed the deprecated `File.path` property; the
   * sanctioned replacement is `webUtils.getPathForFile()`, which lives in
   * the preload (renderer cannot import `electron` directly under
   * contextIsolation). Returns the path or '' if the file isn't disk-backed
   * (e.g. a clipboard drop with no underlying file).
   */
  getPathForFile: (file: File) => string;
};

const api: IpcApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    // Return unsubscribe so callers can clean up
    return () => ipcRenderer.removeListener(channel, listener);
  },
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback as never);
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  platform: process.platform,
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
};

contextBridge.exposeInMainWorld('api', api);
