import { contextBridge, ipcRenderer } from 'electron';

export type IpcApi = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  /** Subscribe to an IPC event. Returns an unsubscribe function. */
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
  removeAllListeners: (channel: string) => void;
  platform: NodeJS.Platform;
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
};

contextBridge.exposeInMainWorld('api', api);
