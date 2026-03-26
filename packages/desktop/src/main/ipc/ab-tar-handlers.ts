import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommandWithProgress } from '../services/process-runner';
import { isWindows } from '../services/platform-service';

/**
 * Register AB to TAR conversion IPC handlers.
 *
 * Maps to the original FormAbTar.cs functionality. Converts Android
 * Backup (.ab) files to TAR archives using either:
 *  - java -jar abe.jar (Android Backup Extractor)
 *  - abu.exe (Windows-only native tool)
 */
export function registerAbTarHandlers(): void {
  // ---------------------------------------------------------------------------
  // AB_CONVERT - Convert an .ab file to .tar
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.AB_CONVERT,
    async (
      _event,
      options: {
        inputPath: string;
        outputPath: string;
        password?: string;
      }
    ) => {
      const { inputPath, outputPath, password } = options;
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

      // Verify input file exists
      await fs.access(inputPath).catch(() => {
        throw new Error(`Input file not found: ${inputPath}`);
      });

      // Ensure output directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      sendProgress('Starting AB to TAR conversion...');

      // Try Java + abe.jar first
      const javaTool = await resolveTool('java');
      if (javaTool.found) {
        // Search for abe.jar in common locations
        const abeJarPaths = [
          path.join(process.resourcesPath ?? '', 'tools', 'abe.jar'),
          path.join(process.resourcesPath ?? '', 'tools', 'abe', 'abe.jar'),
          path.join(__dirname, '..', '..', '..', 'resources', 'tools', 'abe.jar'),
        ];

        let abeJarPath: string | null = null;
        for (const candidate of abeJarPaths) {
          try {
            await fs.access(candidate);
            abeJarPath = candidate;
            break;
          } catch {
            continue;
          }
        }

        if (abeJarPath) {
          sendProgress('Using Android Backup Extractor (abe.jar)...');

          const args = ['-jar', abeJarPath, 'unpack', inputPath, outputPath];
          if (password) {
            args.push(password);
          }

          const result = await runCommandWithProgress(
            javaTool.path,
            args,
            {},
            (p) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send(IPC_CHANNELS.PROCESS_PROGRESS, p);
              }
            }
          );

          if (result.exitCode === 0) {
            const stat = await fs.stat(outputPath);
            sendProgress(`Conversion complete. Output: ${outputPath} (${stat.size} bytes)`);
            return { success: true, outputPath, size: stat.size };
          }

          sendProgress(`abe.jar failed: ${result.stderr.trim()}. Trying alternative method...`);
        }
      }

      // Fallback: try abu.exe on Windows
      if (isWindows()) {
        const abuPaths = [
          path.join(process.resourcesPath ?? '', 'tools', 'abu.exe'),
          path.join(__dirname, '..', '..', '..', 'resources', 'tools', 'abu.exe'),
        ];

        let abuPath: string | null = null;
        for (const candidate of abuPaths) {
          try {
            await fs.access(candidate);
            abuPath = candidate;
            break;
          } catch {
            continue;
          }
        }

        if (abuPath) {
          sendProgress('Using abu.exe for conversion...');

          const args = [inputPath, outputPath];
          if (password) {
            args.push('-p', password);
          }

          const result = await runCommandWithProgress(
            abuPath,
            args,
            {},
            (p) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send(IPC_CHANNELS.PROCESS_PROGRESS, p);
              }
            }
          );

          if (result.exitCode === 0) {
            const stat = await fs.stat(outputPath);
            sendProgress(`Conversion complete. Output: ${outputPath} (${stat.size} bytes)`);
            return { success: true, outputPath, size: stat.size };
          }

          throw new Error(
            `AB conversion failed: ${result.stderr.trim() || result.stdout.trim() || 'Unknown error'}`
          );
        }
      }

      // Last resort: manual decompression using Node.js zlib
      // Android backup format: 24-byte header + zlib-compressed tar
      sendProgress('No external tools found. Attempting manual decompression...');

      try {
        const inputBuffer = await fs.readFile(inputPath);

        // Parse the AB header (text lines terminated by \n)
        // Line 1: "ANDROID BACKUP"
        // Line 2: version number
        // Line 3: is compressed (0 or 1)
        // Line 4: encryption type ("none" or "AES-256")
        let headerEnd = 0;
        let lineCount = 0;
        let isCompressed = true;

        for (let i = 0; i < Math.min(inputBuffer.length, 200); i++) {
          if (inputBuffer[i] === 0x0a) {
            lineCount++;
            if (lineCount === 3) {
              isCompressed = inputBuffer.slice(headerEnd, i).toString().trim() === '1';
            }
            if (lineCount === 4) {
              headerEnd = i + 1;
              break;
            }
            if (lineCount < 4) {
              headerEnd = i + 1;
            }
          }
        }

        const payload = inputBuffer.slice(headerEnd);
        const { inflateRaw } = await import('zlib');
        const { promisify } = await import('util');

        if (isCompressed) {
          const inflate = promisify(inflateRaw);
          const decompressed = await inflate(payload);
          await fs.writeFile(outputPath, decompressed);
        } else {
          await fs.writeFile(outputPath, payload);
        }

        const stat = await fs.stat(outputPath);
        sendProgress(`Manual conversion complete. Output: ${outputPath} (${stat.size} bytes)`);
        return { success: true, outputPath, size: stat.size };
      } catch (err) {
        throw new Error(
          `AB to TAR conversion failed. Please ensure Java and abe.jar are available. Error: ${(err as Error).message}`
        );
      }
    }
  );
}
