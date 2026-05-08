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
      // FileExtraction page sends `formats`/`remotePath`/`outputPath`; older
      // callers use `extensions`/`searchPath`/`outputDir`. Accept both so
      // the handler doesn't crash with `outputDir` undefined.
      options: {
        serial: string;
        extensions?: string[];
        searchPath?: string;
        outputDir?: string;
        formats?: string[];
        remotePath?: string;
        outputPath?: string;
        maxFiles?: number;
      }
    ) => {
      const serial = options.serial;
      const extensions = options.extensions ?? options.formats ?? [];
      const searchPath = options.searchPath ?? options.remotePath ?? '/sdcard/';
      const outputDir = options.outputDir ?? options.outputPath;
      const maxFiles = options.maxFiles ?? 10000;
      if (!outputDir) throw new Error('No output folder selected.');
      if (extensions.length === 0) throw new Error('No file formats selected.');
      const win = BrowserWindow.getAllWindows()[0] ?? null;

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

      // Sanitize: extensions must be alphanum+dot only; searchPath must be absolute
      const safeExts = extensions.map((ext) => {
        const normalized = (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase();
        if (!/^\.[a-z0-9]+$/i.test(normalized)) throw new Error(`Invalid extension: ${ext}`);
        return normalized;
      });
      if (!/^\//.test(searchPath)) throw new Error('searchPath must be an absolute path');
      const safeMax = Math.max(1, Math.min(Number(maxFiles) || 10000, 100000));

      // Use adb shell with explicit argument list to avoid shell injection
      const findArgs = [searchPath, '(', ...safeExts.flatMap((ext, i) => i > 0 ? ['-o', '-iname', `*${ext}`] : ['-iname', `*${ext}`]), ')', '-type', 'f'];
      const findOutput = await adbService.shell(serial, `find ${findArgs.map(a => JSON.stringify(a)).join(' ')} | head -${safeMax}`);
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
        // Handle paths from any mount point, not just /sdcard/
        const relativePath = remotePath.startsWith(searchPath)
          ? remotePath.slice(searchPath.length).replace(/^\//, '')
          : remotePath.replace(/^\/+/, '');
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
