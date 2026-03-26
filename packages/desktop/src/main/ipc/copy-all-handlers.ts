import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as adbService from '../services/adb-service';

/**
 * Register bulk copy IPC handlers.
 *
 * Maps to the original FormCopyAll.cs functionality. Pulls entire
 * storage directories (e.g. /sdcard/) from the device with progress
 * reporting to the renderer.
 */
export function registerCopyAllHandlers(): void {
  // ---------------------------------------------------------------------------
  // BULK_COPY - Pull an entire directory from the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.BULK_COPY,
    async (
      _event,
      options: {
        serial: string;
        remotePath: string;
        localPath: string;
        paths?: string[];
      }
    ) => {
      const { serial, remotePath = '/sdcard/', localPath, paths } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.BULK_COPY_PROGRESS, progress);
        }
      };

      await fs.mkdir(localPath, { recursive: true });

      const pullPaths = paths && paths.length > 0 ? paths : [remotePath];
      const startTime = Date.now();
      let totalPulled = 0;
      let totalFailed = 0;

      for (let i = 0; i < pullPaths.length; i++) {
        const currentRemotePath = pullPaths[i];
        const dirName = path.basename(currentRemotePath) || 'sdcard';
        const destPath = path.join(localPath, dirName);

        sendProgress(
          `[${i + 1}/${pullPaths.length}] Pulling: ${currentRemotePath}...`
        );

        try {
          await fs.mkdir(destPath, { recursive: true });
          const result = await adbService.pull(serial, currentRemotePath, destPath);

          // Parse adb pull output to count files
          // Output format: "X files pulled, Y skipped. X MB/s (Y bytes in Zs)"
          const pullMatch = result.stdout.match(/(\d+) files? pulled/);
          const fileCount = pullMatch ? parseInt(pullMatch[1], 10) : 0;
          totalPulled += fileCount;

          sendProgress(
            `[${i + 1}/${pullPaths.length}] Pulled ${fileCount} file(s) from ${currentRemotePath}`
          );
        } catch (err) {
          totalFailed++;
          sendProgress(
            `[${i + 1}/${pullPaths.length}] Failed to pull ${currentRemotePath}: ${(err as Error).message}`
          );
        }
      }

      const durationMs = Date.now() - startTime;

      sendProgress(
        `Bulk copy complete. ${totalPulled} file(s) pulled in ${Math.round(durationMs / 1000)}s.`
      );

      return {
        success: true,
        localPath,
        totalPulled,
        totalFailed,
        durationMs,
      };
    }
  );
}
