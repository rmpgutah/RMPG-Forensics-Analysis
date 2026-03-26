import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import * as adbService from '../services/adb-service';

/**
 * Register APK management IPC handlers.
 *
 * Maps to the original FormAPK.cs functionality. Provides install,
 * uninstall, and listing capabilities for APK packages on the device.
 */
export function registerApkHandlers(): void {
  // ---------------------------------------------------------------------------
  // APK_INSTALL - Install an APK on the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.APK_INSTALL,
    async (_event, serial: string, apkPath: string) => {
      return adbService.install(serial, apkPath);
    }
  );

  // ---------------------------------------------------------------------------
  // APK_UNINSTALL - Uninstall a package from the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.APK_UNINSTALL,
    async (_event, serial: string, packageName: string) => {
      return adbService.uninstall(serial, packageName);
    }
  );

  // ---------------------------------------------------------------------------
  // APK_LIST - List all installed packages on the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.APK_LIST,
    async (_event, serial: string) => {
      return adbService.listPackages(serial);
    }
  );
}
