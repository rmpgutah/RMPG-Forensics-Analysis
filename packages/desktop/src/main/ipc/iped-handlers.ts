import * as path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommandWithProgress } from '../services/process-runner';

/**
 * Register IPED integration IPC handlers.
 *
 * Maps to the original FormIPED.cs functionality. Launches the external
 * IPED (Indexador e Processador de Evidencias Digitais) Java application
 * for advanced forensic analysis and indexing.
 */
export function registerIpedHandlers(): void {
  // ---------------------------------------------------------------------------
  // IPED_RUN - Launch IPED processing on a target directory
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IPED_RUN,
    async (
      _event,
      options: {
        inputPath: string;
        outputPath: string;
        ipedJarPath?: string;
        profile?: string;
        additionalArgs?: string[];
      }
    ) => {
      const { inputPath, outputPath, ipedJarPath, profile, additionalArgs } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.IPED_PROGRESS, progress);
        }
      };

      // Resolve Java
      const javaTool = await resolveTool('java');
      if (!javaTool.found) {
        throw new Error(
          'Java not found. Please install Java Runtime Environment (JRE) and configure the path in Settings.'
        );
      }

      // Determine the IPED jar path
      let jarPath = ipedJarPath;
      if (!jarPath) {
        // Try to find IPED in common locations
        const commonPaths = [
          path.join(process.resourcesPath ?? '', 'tools', 'iped', 'iped.jar'),
          path.join(process.resourcesPath ?? '', 'tools', 'IPED', 'iped.jar'),
        ];
        jarPath = commonPaths[0]; // Default to first option
      }

      sendProgress(`Starting IPED analysis on: ${inputPath}`);

      // Build IPED command arguments
      const args: string[] = [
        '-jar', jarPath,
        '-d', inputPath,
        '-o', outputPath,
      ];

      // Add profile if specified
      if (profile) {
        args.push('-profile', profile);
      }

      // Add any additional command-line arguments
      if (additionalArgs && additionalArgs.length > 0) {
        args.push(...additionalArgs);
      }

      sendProgress('Launching IPED process...');

      const result = await runCommandWithProgress(
        javaTool.path,
        args,
        {},
        (p) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.IPED_PROGRESS, p);
          }
        }
      );

      if (result.exitCode !== 0) {
        throw new Error(
          `IPED processing failed: ${result.stderr.trim() || result.stdout.trim() || 'Unknown error'}`
        );
      }

      sendProgress('IPED analysis complete.');

      return {
        success: true,
        outputPath,
        exitCode: result.exitCode,
      };
    }
  );
}
