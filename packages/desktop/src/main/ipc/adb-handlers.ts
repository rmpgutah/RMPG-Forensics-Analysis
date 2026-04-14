import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as adbService from '../services/adb-service';
import type { AdbBackupOptions } from '../services/adb-service';
import * as iosService from '../services/ios-service';
import { reportError } from '../services/error-reporter';

/**
 * Register ADB operation IPC handlers.
 *
 * These expose adb-service methods to the renderer for device communication,
 * backup, file transfer, and package management.
 */
export function registerAdbHandlers(): void {
  // ---------------------------------------------------------------------------
  // ADB_LIST_DEVICES - Enumerate connected Android + iOS devices
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.ADB_LIST_DEVICES, async () => {
    // Android: wrap separately so an ADB failure (binary missing, permissions,
    // etc.) does NOT take iOS detection down with it. Surface the error via
    // reportError so the user sees a banner instead of a silent empty list.
    let android: Awaited<ReturnType<typeof adbService.listDevices>> = [];
    try {
      android = await adbService.listDevices();
    } catch (err) {
      await reportError({
        severity: 'error',
        source: 'adb-handlers.ADB_LIST_DEVICES',
        message: err instanceof Error ? err.message : String(err),
        detail: err instanceof Error ? err.stack : undefined,
        retryable: true,
      });
    }

    // iOS: already wrapped (libimobiledevice may be missing).
    let ios: { serial: string; model: string; manufacturer: string; product: string; version: string }[] = [];
    try {
      const iosDevices = await iosService.listDevices();
      ios = iosDevices.map((d) => ({
        serial: d.udid,
        model: d.name || d.productType || 'iPhone',
        manufacturer: 'Apple',
        product: d.productType || '',
        version: d.productVersion || '',
      }));
    } catch (err) {
      // iOS detection silent for the benign "not installed" case (typical
      // on machines that don't have libimobiledevice). Other failures
      // surface as a non-blocking warning toast.
      const msg = err instanceof Error ? err.message : String(err);
      // Benign = libimobiledevice not installed (the only case worth silencing).
      // Match the specific sentinel from getToolPath in ios-service rather than
      // any "not found" substring, which would swallow real device errors like
      // "device not found" or "lockdownd: key not found".
      const isBenignToolMissing = /^(idevice_id|ideviceinfo|idevicebackup2)\s+not\s+found\b/i.test(msg)
        || /^ENOENT\b/i.test(msg)
        || /^Error:\s*spawn .* ENOENT$/i.test(msg);
      if (!isBenignToolMissing) {
        await reportError({
          severity: 'warning',
          source: 'adb-handlers.ADB_LIST_DEVICES.ios',
          message: msg,
        });
      }
    }

    return { android, ios };
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
      const win = BrowserWindow.getAllWindows()[0] ?? null;

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
