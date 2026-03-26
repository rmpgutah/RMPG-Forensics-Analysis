import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as adbService from '../services/adb-service';

/**
 * Register trash recovery IPC handlers.
 *
 * Maps to the original FormTrash.cs functionality. Scans for files in
 * trash/recycle directories on the device and recovers them to a
 * local case folder.
 */
export function registerTrashRecoveryHandlers(): void {
  // ---------------------------------------------------------------------------
  // TRASH_SCAN - Scan device for files in trash/hidden directories
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.TRASH_SCAN,
    async (_event, serial: string) => {
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PROCESS_PROGRESS, progress);
        }
      };

      sendProgress('Scanning device for deleted/trash files...');

      // Search multiple known trash/recycle locations
      const searchPaths = [
        '/sdcard/.Trash',
        '/sdcard/.trash',
        '/sdcard/.Trashes',
        '/sdcard/DCIM/.thumbnails',
        '/sdcard/Android/data/.trash',
        '/sdcard/.recycle',
        '/sdcard/.Recycle',
      ];

      const foundFiles: Array<{
        remotePath: string;
        size: string;
        source: string;
      }> = [];

      for (const searchPath of searchPaths) {
        try {
          const output = await adbService.shell(
            serial,
            `find ${searchPath} -type f 2>/dev/null`
          );
          const files = output
            .trim()
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0);

          for (const file of files) {
            foundFiles.push({
              remotePath: file.trim(),
              size: '',
              source: searchPath,
            });
          }
        } catch {
          // Path does not exist or is not accessible
        }
      }

      // Also try a broader search for .trash patterns
      try {
        const output = await adbService.shell(
          serial,
          'find /sdcard/ -name "*.trashed*" -o -name ".trash*" -type f 2>/dev/null | head -500'
        );
        const files = output
          .trim()
          .split(/\r?\n/)
          .filter((line) => line.trim().length > 0);

        for (const file of files) {
          const trimmed = file.trim();
          // Avoid duplicates
          if (!foundFiles.some((f) => f.remotePath === trimmed)) {
            foundFiles.push({
              remotePath: trimmed,
              size: '',
              source: 'broad search',
            });
          }
        }
      } catch {
        // Search may fail on restricted devices
      }

      sendProgress(`Found ${foundFiles.length} potential trash files.`);

      return foundFiles;
    }
  );

  // ---------------------------------------------------------------------------
  // TRASH_RECOVER - Pull recovered files from the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.TRASH_RECOVER,
    async (
      _event,
      options: {
        serial: string;
        files: Array<{ remotePath: string }>;
        outputDir: string;
      }
    ) => {
      const { serial, files, outputDir } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PROCESS_PROGRESS, progress);
        }
      };

      await fs.mkdir(outputDir, { recursive: true });

      sendProgress(`Recovering ${files.length} file(s)...`);

      let recoveredCount = 0;
      let failedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const { remotePath } = files[i];
        const fileName = path.basename(remotePath);
        // Preserve some directory structure to avoid name collisions
        const relativePath = remotePath.replace(/^\/sdcard\/?/, '');
        const localPath = path.join(outputDir, relativePath || fileName);

        sendProgress(`[${i + 1}/${files.length}] Recovering: ${fileName}`);

        try {
          await fs.mkdir(path.dirname(localPath), { recursive: true });
          await adbService.pull(serial, remotePath, localPath);
          recoveredCount++;
        } catch {
          failedCount++;
        }
      }

      sendProgress(
        `Recovery complete. ${recoveredCount} file(s) recovered, ${failedCount} failed.`
      );

      return {
        success: true,
        outputDir,
        recoveredCount,
        failedCount,
        totalFiles: files.length,
      };
    }
  );
}
