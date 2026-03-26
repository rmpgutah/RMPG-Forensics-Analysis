import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as adbService from '../services/adb-service';

/**
 * Register Android dumpsys IPC handlers.
 *
 * Maps to the original FormSpecialDump.cs functionality. Extracts
 * detailed system service information from the device using the
 * `adb shell dumpsys` command for each available service.
 */
export function registerSpecialDumpHandlers(): void {
  // ---------------------------------------------------------------------------
  // DUMP_LIST_SERVICES - List all available dumpsys services
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DUMP_LIST_SERVICES,
    async (_event, serial: string) => {
      const output = await adbService.shell(serial, 'dumpsys -l');
      return output
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }
  );

  // ---------------------------------------------------------------------------
  // DUMP_EXTRACT - Extract dumps for selected services
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DUMP_EXTRACT,
    async (
      _event,
      options: {
        serial: string;
        services: string[];
        outputDir: string;
      }
    ) => {
      const { serial, services, outputDir } = options;
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

      sendProgress(`Extracting ${services.length} service dump(s)...`);

      const results: Array<{
        service: string;
        outputPath: string;
        success: boolean;
        error?: string;
        size: number;
      }> = [];

      for (let i = 0; i < services.length; i++) {
        const service = services[i];
        // Sanitize service name for use as a filename
        const safeServiceName = service.replace(/[^a-zA-Z0-9._-]/g, '_');
        const outputPath = path.join(outputDir, `dumpsys_${safeServiceName}.txt`);

        sendProgress(`[${i + 1}/${services.length}] Extracting: ${service}`);

        try {
          const output = await adbService.shell(serial, `dumpsys ${service}`);
          await fs.writeFile(outputPath, output, 'utf-8');

          const stat = await fs.stat(outputPath);
          results.push({
            service,
            outputPath,
            success: true,
            size: stat.size,
          });
        } catch (err) {
          results.push({
            service,
            outputPath,
            success: false,
            error: (err as Error).message,
            size: 0,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      sendProgress(
        `Dump extraction complete. ${successCount}/${services.length} services extracted.`
      );

      return {
        results,
        totalServices: services.length,
        successCount,
        failedCount: services.length - successCount,
        outputDir,
      };
    }
  );
}
