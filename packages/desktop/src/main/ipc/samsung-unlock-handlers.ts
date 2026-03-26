import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import { isWindows } from '../services/platform-service';
import { resolveTool } from '../services/tool-resolver';
import { runCommand, runCommandWithProgress } from '../services/process-runner';

/**
 * Register Samsung unlock IPC handlers.
 *
 * Maps to the original FormUnlock.cs functionality. Detects the Samsung
 * device COM port and runs Odin for firmware flashing/unlocking.
 *
 * NOTE: This functionality is Windows-only. On other platforms the
 * handlers return errors indicating platform incompatibility.
 */
export function registerSamsungUnlockHandlers(): void {
  // ---------------------------------------------------------------------------
  // SAMSUNG_DETECT_PORT - Detect the Samsung device COM port
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.SAMSUNG_DETECT_PORT, async () => {
    if (!isWindows()) {
      throw new Error('Samsung port detection is only available on Windows.');
    }

    // Use Windows Management Instrumentation (WMI) to find Samsung USB ports
    const result = await runCommand('powershell', [
      '-Command',
      `Get-WmiObject Win32_PnPEntity | Where-Object { $_.Name -match 'SAMSUNG' -and $_.Name -match 'COM' } | Select-Object -ExpandProperty Name`,
    ]);

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      // Try alternative detection via device manager
      const altResult = await runCommand('powershell', [
        '-Command',
        `Get-WmiObject Win32_SerialPort | Where-Object { $_.Description -match 'Samsung' } | Select-Object DeviceID, Description | ConvertTo-Json`,
      ]);

      if (altResult.exitCode === 0 && altResult.stdout.trim()) {
        try {
          const ports = JSON.parse(altResult.stdout.trim());
          const portList = Array.isArray(ports) ? ports : [ports];
          return portList.map((p: { DeviceID: string; Description: string }) => ({
            port: p.DeviceID,
            description: p.Description,
          }));
        } catch {
          return [];
        }
      }

      return [];
    }

    // Parse COM port from the output (e.g., "Samsung Mobile USB Serial Port (COM5)")
    const lines = result.stdout
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);

    return lines.map((line) => {
      const comMatch = line.match(/\(COM(\d+)\)/);
      return {
        port: comMatch ? `COM${comMatch[1]}` : '',
        description: line.trim(),
      };
    });
  });

  // ---------------------------------------------------------------------------
  // SAMSUNG_UNLOCK - Run Odin for Samsung device operations
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.SAMSUNG_UNLOCK,
    async (
      _event,
      options: {
        comPort: string;
        firmwarePath?: string;
        pitFilePath?: string;
      }
    ) => {
      if (!isWindows()) {
        throw new Error('Samsung unlock via Odin is only available on Windows.');
      }

      const { comPort, firmwarePath, pitFilePath } = options;
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

      // Resolve Odin
      const odinTool = await resolveTool('odin');
      if (!odinTool.found) {
        throw new Error(
          'Odin not found. Please place Odin3.exe in the tools directory or configure the path in Settings.'
        );
      }

      sendProgress(`Connecting to Samsung device on ${comPort}...`);

      // Build Odin command arguments
      const args: string[] = [];

      if (firmwarePath) {
        args.push('-b', firmwarePath);
      }

      if (pitFilePath) {
        args.push('-pit', pitFilePath);
      }

      sendProgress('Starting Odin process...');

      const result = await runCommandWithProgress(
        odinTool.path,
        args,
        {},
        (p) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.PROCESS_PROGRESS, p);
          }
        }
      );

      if (result.exitCode !== 0) {
        throw new Error(
          `Odin process failed: ${result.stderr.trim() || result.stdout.trim() || 'Unknown error'}`
        );
      }

      sendProgress('Odin process complete.');

      return {
        success: true,
        exitCode: result.exitCode,
        output: result.stdout,
      };
    }
  );
}
