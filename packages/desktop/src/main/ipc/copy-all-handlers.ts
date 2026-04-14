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
      const win = BrowserWindow.getAllWindows()[0] ?? null;

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
      let totalBytes = 0;

      for (let i = 0; i < pullPaths.length; i++) {
        const currentRemotePath = pullPaths[i];
        const dirName = path.basename(currentRemotePath) || 'sdcard';
        const destPath = path.join(localPath, dirName);

        const overallPercent = Math.round((i / pullPaths.length) * 100);
        const startMsg = `[${i + 1}/${pullPaths.length}] Pulling: ${currentRemotePath}…`;
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.BULK_COPY_PROGRESS, {
            type: 'status', data: startMsg, timestamp: Date.now(),
            percent: overallPercent, message: startMsg,
            filesCount: totalPulled,
          } as ProcessProgress);
        }

        try {
          await fs.mkdir(destPath, { recursive: true });
          const result = await adbService.pull(serial, currentRemotePath, destPath);

          // Parse adb pull summary:
          // "X files pulled, Y skipped. X MB/s (Z bytes in N.NNs)"
          const pullMatch  = result.stdout.match(/(\d+) files? pulled/);
          const bytesMatch = result.stdout.match(/\((\d+)\s*bytes?\s+in/i);
          const speedMatch = result.stdout.match(/([\d.]+)\s*MB\/s/i);
          const kbMatch    = result.stdout.match(/([\d.]+)\s*KB\/s/i);

          const fileCount = pullMatch  ? parseInt(pullMatch[1], 10)  : 0;
          const bytes     = bytesMatch ? parseInt(bytesMatch[1], 10) : 0;
          let   speed: number | undefined;
          if (speedMatch)     speed = parseFloat(speedMatch[1]) * 1024 * 1024;
          else if (kbMatch)   speed = parseFloat(kbMatch[1]) * 1024;

          totalPulled += fileCount;
          totalBytes  += bytes;

          const doneMsg = `[${i + 1}/${pullPaths.length}] Pulled ${fileCount.toLocaleString()} file(s) from ${currentRemotePath}`;
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.BULK_COPY_PROGRESS, {
              type: 'status', data: doneMsg, timestamp: Date.now(),
              percent: Math.round(((i + 1) / pullPaths.length) * 100),
              message: doneMsg,
              bytes: totalBytes,
              speed,
              filesCount: totalPulled,
            } as ProcessProgress);
          }
        } catch (err) {
          totalFailed++;
          sendProgress(
            `[${i + 1}/${pullPaths.length}] Failed to pull ${currentRemotePath}: ${(err as Error).message}`
          );
        }
      }

      const durationMs = Date.now() - startTime;
      const overallSpeed = durationMs > 0 ? Math.round(totalBytes / (durationMs / 1000)) : 0;
      const summaryMsg = `Bulk copy complete — ${totalPulled.toLocaleString()} files, ${totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) + ' MB' : ''} in ${Math.round(durationMs / 1000)}s`;
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.BULK_COPY_PROGRESS, {
          type: 'status', data: summaryMsg, timestamp: Date.now(),
          percent: 100, message: summaryMsg,
          bytes: totalBytes, totalBytes,
          speed: overallSpeed > 0 ? overallSpeed : undefined,
          filesCount: totalPulled,
        } as ProcessProgress);
      }

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
