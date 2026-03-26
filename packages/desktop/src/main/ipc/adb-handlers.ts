import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as adbService from '../services/adb-service';
import type { AdbBackupOptions } from '../services/adb-service';

/**
 * Register ADB operation IPC handlers.
 *
 * These expose adb-service methods to the renderer for device communication,
 * backup, file transfer, and package management.
 */
export function registerAdbHandlers(): void {
  // ---------------------------------------------------------------------------
  // ADB_LIST_DEVICES - Enumerate connected Android devices
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.ADB_LIST_DEVICES, async () => {
    return adbService.listDevices();
  });

  // ---------------------------------------------------------------------------
  // ADB_BACKUP - Create an ADB backup with progress reporting
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.ADB_BACKUP,
    async (
      _event,
      serial: string,
      outputPath: string,
      options?: AdbBackupOptions
    ) => {
      const win = BrowserWindow.getFocusedWindow();

      const onProgress = (p: ProcessProgress): void => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.ADB_BACKUP_PROGRESS, p);
        }
      };

      return adbService.backup(serial, outputPath, options, onProgress);
    }
  );

  // ---------------------------------------------------------------------------
  // ADB_SHELL - Run a shell command on the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.ADB_SHELL,
    async (_event, serial: string, command: string) => {
      return adbService.shell(serial, command);
    }
  );

  // ---------------------------------------------------------------------------
  // ADB_PULL - Pull a file or directory from the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.ADB_PULL,
    async (_event, serial: string, remotePath: string, localPath: string) => {
      return adbService.pull(serial, remotePath, localPath);
    }
  );

  // ---------------------------------------------------------------------------
  // ADB_PUSH - Push a file or directory to the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.ADB_PUSH,
    async (_event, serial: string, localPath: string, remotePath: string) => {
      return adbService.push(serial, localPath, remotePath);
    }
  );

  // ---------------------------------------------------------------------------
  // ADB_INSTALL - Install an APK on the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.ADB_INSTALL,
    async (_event, serial: string, apkPath: string) => {
      return adbService.install(serial, apkPath);
    }
  );

  // ---------------------------------------------------------------------------
  // ADB_UNINSTALL - Uninstall a package from the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.ADB_UNINSTALL,
    async (_event, serial: string, packageName: string) => {
      return adbService.uninstall(serial, packageName);
    }
  );
}
