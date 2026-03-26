import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as adbService from '../services/adb-service';

/**
 * Register screenshot capture IPC handlers.
 *
 * Maps to the original FormPrint.cs functionality. Captures screenshots
 * from connected Android devices via ADB, including a scroll-and-capture
 * mode that takes multiple screenshots while scrolling the screen.
 */
export function registerScreenshotHandlers(): void {
  // ---------------------------------------------------------------------------
  // SCREEN_CAPTURE - Take a single screenshot of the device screen
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.SCREEN_CAPTURE,
    async (
      _event,
      options: {
        serial: string;
        outputPath: string;
      }
    ) => {
      const { serial, outputPath } = options;
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const savedPath = await adbService.screencap(serial, outputPath);
      return { success: true, outputPath: savedPath };
    }
  );

  // ---------------------------------------------------------------------------
  // SCREEN_SCROLL_CAPTURE - Capture multiple screenshots with auto-scroll
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.SCREEN_SCROLL_CAPTURE,
    async (
      _event,
      options: {
        serial: string;
        outputDir: string;
        scrollCount: number;
        delayMs?: number;
        swipeStartY?: number;
        swipeEndY?: number;
      }
    ) => {
      const {
        serial,
        outputDir,
        scrollCount,
        delayMs = 1000,
        swipeStartY = 1500,
        swipeEndY = 500,
      } = options;
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

      const capturedFiles: string[] = [];

      sendProgress(`Starting scroll capture: ${scrollCount} screenshots...`);

      for (let i = 0; i < scrollCount; i++) {
        const fileName = `screenshot_${String(i + 1).padStart(3, '0')}.png`;
        const outputPath = path.join(outputDir, fileName);

        sendProgress(`[${i + 1}/${scrollCount}] Capturing screenshot...`);

        // Take screenshot
        await adbService.screencap(serial, outputPath);
        capturedFiles.push(outputPath);

        // Scroll down if not the last capture
        if (i < scrollCount - 1) {
          sendProgress(`[${i + 1}/${scrollCount}] Scrolling...`);
          // ADB swipe: input swipe x1 y1 x2 y2 [duration_ms]
          await adbService.shell(
            serial,
            `input swipe 500 ${swipeStartY} 500 ${swipeEndY} 300`
          );
          // Wait for the scroll animation to settle
          await sleep(delayMs);
        }
      }

      sendProgress(`Scroll capture complete. ${capturedFiles.length} screenshots saved.`);

      return {
        success: true,
        outputDir,
        files: capturedFiles,
        totalCaptures: capturedFiles.length,
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
