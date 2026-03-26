import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as adbService from '../services/adb-service';

/**
 * Register file format extraction IPC handlers.
 *
 * Maps to the original Form4.cs functionality. Searches for files of
 * specific formats (extensions) on the device and pulls them to a
 * local case directory.
 */
export function registerFileExtractHandlers(): void {
  // ---------------------------------------------------------------------------
  // FILE_EXTRACT_FORMAT - Find and pull files by extension
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.FILE_EXTRACT_FORMAT,
    async (
      _event,
      options: {
        serial: string;
        extensions: string[];
        searchPath: string;
        outputDir: string;
        maxFiles?: number;
      }
    ) => {
      const {
        serial,
        extensions,
        searchPath = '/sdcard/',
        outputDir,
        maxFiles = 10000,
      } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.FILE_EXTRACT_PROGRESS, progress);
        }
      };

      await fs.mkdir(outputDir, { recursive: true });

      sendProgress(
        `Searching for files with extensions: ${extensions.join(', ')}...`
      );

      // Build the find command with -iname for case-insensitive matching
      const nameFilters = extensions
        .map((ext) => {
          const normalized = ext.startsWith('.') ? ext : `.${ext}`;
          return `-iname "*${normalized}"`;
        })
        .join(' -o ');

      const findCommand = `find ${searchPath} \\( ${nameFilters} \\) -type f 2>/dev/null | head -${maxFiles}`;

      const findOutput = await adbService.shell(serial, findCommand);
      const remoteFiles = findOutput
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);

      sendProgress(`Found ${remoteFiles.length} file(s). Starting extraction...`);

      let extractedCount = 0;
      let failedCount = 0;
      const extractedFiles: Array<{
        remotePath: string;
        localPath: string;
        success: boolean;
        error?: string;
      }> = [];

      for (let i = 0; i < remoteFiles.length; i++) {
        const remotePath = remoteFiles[i].trim();
        // Preserve relative directory structure under the output directory
        const relativePath = remotePath.replace(/^\/sdcard\/?/, '');
        const localPath = path.join(outputDir, relativePath || path.basename(remotePath));

        if ((i + 1) % 10 === 0 || i === 0) {
          sendProgress(
            `[${i + 1}/${remoteFiles.length}] Extracting: ${path.basename(remotePath)}`
          );
        }

        try {
          await fs.mkdir(path.dirname(localPath), { recursive: true });
          await adbService.pull(serial, remotePath, localPath);
          extractedCount++;
          extractedFiles.push({ remotePath, localPath, success: true });
        } catch (err) {
          failedCount++;
          extractedFiles.push({
            remotePath,
            localPath,
            success: false,
            error: (err as Error).message,
          });
        }
      }

      sendProgress(
        `Extraction complete. ${extractedCount} file(s) extracted, ${failedCount} failed.`
      );

      return {
        success: true,
        outputDir,
        totalFound: remoteFiles.length,
        extractedCount,
        failedCount,
        files: extractedFiles,
      };
    }
  );
}
