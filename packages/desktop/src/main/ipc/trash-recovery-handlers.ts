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
      const win = BrowserWindow.getAllWindows()[0] ?? null;

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

      // Search multiple known trash/recycle locations. The set covers
      // stock-Android conventions (.Trash, .Trashes), Samsung/MIUI
      // recycle bins (.recycle, .Recycle), Android 11+ MediaStore
      // trashed-items convention (`.trashed-*` files anywhere in
      // /sdcard), Google Photos local trash, WhatsApp chat backups
      // pending recovery, and per-app cache dirs whose names tend to
      // hold deleted artefacts. Empty paths fail silently in the
      // per-path try/catch below.
      const searchPaths = [
        '/sdcard/.Trash',
        '/sdcard/.trash',
        '/sdcard/.Trashes',
        '/sdcard/.RecycleBin',
        '/sdcard/.recycle',
        '/sdcard/.Recycle',
        '/sdcard/DCIM/.trashed',
        '/sdcard/DCIM/.thumbnails',
        '/sdcard/Pictures/.trashed',
        '/sdcard/Android/data/.trash',
        '/sdcard/Android/data/com.google.android.apps.photos/cache',
        '/sdcard/Android/data/com.whatsapp/cache',
        '/sdcard/Android/media/com.whatsapp/WhatsApp/Media/.Statuses',
        '/sdcard/MIUI/Gallery/cloud/.trashBin',
        '/sdcard/Pictures/.thumbnails',
      ];

      const foundFiles: Array<{
        remotePath: string;
        size: string;
        source: string;
      }> = [];

      for (const searchPath of searchPaths) {
        try {
          // `find -ls` prints a long listing per file in one round-trip:
          //   inode blocks perms links user group SIZE date time year PATH
          // Field 7 is the size in bytes; everything from field 11 onwards
          // is the path (and may legitimately contain spaces). toybox /
          // busybox / GNU all support `-ls`; on the rare device that doesn't
          // we'll see fewer than 11 fields and treat the line as a plain
          // path with empty size.
          const output = await adbService.shell(
            serial,
            `find ${searchPath} -type f -ls 2>/dev/null`
          );
          for (const rawLine of output.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const parts = line.split(/\s+/);
            if (parts.length < 11) {
              foundFiles.push({ remotePath: line, size: '', source: searchPath });
              continue;
            }
            foundFiles.push({
              remotePath: parts.slice(10).join(' '),
              size: parts[6] ?? '',
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
          'find /sdcard/ \\( -name "*.trashed*" -o -name ".trash*" \\) -type f -ls 2>/dev/null | head -500'
        );
        for (const rawLine of output.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          const parts = line.split(/\s+/);
          let remotePath: string;
          let size: string;
          if (parts.length < 11) {
            remotePath = line;
            size = '';
          } else {
            remotePath = parts.slice(10).join(' ');
            size = parts[6] ?? '';
          }
          if (!foundFiles.some((f) => f.remotePath === remotePath)) {
            foundFiles.push({ remotePath, size, source: 'broad search' });
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
      const win = BrowserWindow.getAllWindows()[0] ?? null;

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
