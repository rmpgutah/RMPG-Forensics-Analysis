import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  getDownloadCatalog,
  startDownload,
  cancelDownload,
  openDownloadsFolder,
  getLocalDownloadStatus,
} from '../services/download-service';
import { getPlatform } from '../services/platform-service';

/**
 * Register download management IPC handlers.
 *
 * Provides the renderer with the ability to list available apps,
 * download them, cancel downloads, and open the downloads folder.
 */
export function registerDownloadHandlers(): void {
  // ---------------------------------------------------------------------------
  // DOWNLOAD_LIST - Return catalog of available downloads with local status
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_LIST, async () => {
    const catalog = getDownloadCatalog();
    const currentPlatform = getPlatform() === 'darwin' ? 'mac' : 'win';

    return catalog.map((app) => ({
      ...app,
      localStatus: getLocalDownloadStatus(app.id, currentPlatform),
    }));
  });

  // ---------------------------------------------------------------------------
  // DOWNLOAD_START - Start downloading an app for the current platform
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DOWNLOAD_START,
    async (event, appId: string, platform?: 'win' | 'mac') => {
      const targetPlatform = platform || (getPlatform() === 'darwin' ? 'mac' : 'win');
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error('No window available');

      await startDownload(appId, targetPlatform, window);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // DOWNLOAD_CANCEL - Cancel an active download
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DOWNLOAD_CANCEL,
    async (_event, appId: string, platform?: 'win' | 'mac') => {
      const targetPlatform = platform || (getPlatform() === 'darwin' ? 'mac' : 'win');
      cancelDownload(appId, targetPlatform);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // DOWNLOAD_OPEN_FOLDER - Open the downloads folder in file explorer
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_OPEN_FOLDER, async () => {
    openDownloadsFolder();
    return { success: true };
  });
}
