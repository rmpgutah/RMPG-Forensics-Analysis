import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as iosService from '../services/ios-service';

/**
 * Register iOS operation IPC handlers.
 *
 * Maps to the original FormIOS.cs functionality. Uses libimobiledevice
 * tools (idevice_id, ideviceinfo, idevicebackup2) to interact with
 * connected iOS devices.
 */
export function registerIosHandlers(): void {
  // ---------------------------------------------------------------------------
  // IOS_LIST_DEVICES - Enumerate connected iOS devices
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.IOS_LIST_DEVICES, async () => {
    return iosService.listDevices();
  });

  // ---------------------------------------------------------------------------
  // IOS_BACKUP - Create a full iOS backup with progress reporting
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_BACKUP,
    async (
      _event,
      options: {
        udid: string;
        outputPath: string;
        encrypted?: boolean;
      }
    ) => {
      const { udid, outputPath, encrypted } = options;
      const win = BrowserWindow.getFocusedWindow();

      const onProgress = (p: ProcessProgress): void => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.IOS_BACKUP_PROGRESS, p);
        }
      };

      return iosService.backup(udid, outputPath, encrypted, onProgress);
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_GET_INFO - Get detailed device information
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_GET_INFO,
    async (_event, udid: string) => {
      return iosService.getDeviceInfo(udid);
    }
  );
}
