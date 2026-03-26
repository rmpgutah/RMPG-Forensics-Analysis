import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommand, runCommandWithProgress } from '../services/process-runner';

/**
 * Register OCR processing IPC handlers.
 *
 * Maps to the original FormOCR.cs functionality. Runs Tesseract OCR
 * on image files to extract text content for forensic analysis.
 */
export function registerOcrHandlers(): void {
  // ---------------------------------------------------------------------------
  // OCR_PROCESS - Run Tesseract OCR on image files
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.OCR_PROCESS,
    async (
      _event,
      options: {
        inputPaths: string[];
        outputDir: string;
        language?: string;
        psm?: number;
      }
    ) => {
      const { inputPaths, outputDir, language = 'eng', psm = 3 } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.OCR_PROCESS_PROGRESS, progress);
        }
      };

      // Resolve Tesseract
      const tesseractTool = await resolveTool('tesseract');
      if (!tesseractTool.found) {
        throw new Error(
          'Tesseract OCR not found. Please install Tesseract and configure the path in Settings.'
        );
      }

      await fs.mkdir(outputDir, { recursive: true });

      sendProgress(`Starting OCR processing of ${inputPaths.length} file(s)...`);

      const results: Array<{
        inputPath: string;
        outputPath: string;
        text: string;
        success: boolean;
        error?: string;
      }> = [];

      for (let i = 0; i < inputPaths.length; i++) {
        const inputPath = inputPaths[i];
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const outputBase = path.join(outputDir, baseName);

        sendProgress(`[${i + 1}/${inputPaths.length}] Processing: ${path.basename(inputPath)}`);

        try {
          // Run tesseract: tesseract <input> <output_base> -l <lang> --psm <psm>
          // Tesseract automatically appends .txt to the output base path
          const result = await runCommandWithProgress(
            tesseractTool.path,
            [
              inputPath,
              outputBase,
              '-l', language,
              '--psm', String(psm),
            ],
            {},
            (p) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send(IPC_CHANNELS.OCR_PROCESS_PROGRESS, p);
              }
            }
          );

          if (result.exitCode === 0) {
            // Read the generated text file
            const txtPath = `${outputBase}.txt`;
            let text = '';
            try {
              text = await fs.readFile(txtPath, 'utf-8');
            } catch {
              text = '';
            }

            results.push({
              inputPath,
              outputPath: txtPath,
              text: text.trim(),
              success: true,
            });
          } else {
            results.push({
              inputPath,
              outputPath: `${outputBase}.txt`,
              text: '',
              success: false,
              error: result.stderr.trim() || 'Tesseract returned non-zero exit code',
            });
          }
        } catch (err) {
          results.push({
            inputPath,
            outputPath: `${outputBase}.txt`,
            text: '',
            success: false,
            error: (err as Error).message,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      sendProgress(
        `OCR complete. ${successCount}/${inputPaths.length} files processed successfully.`
      );

      return {
        results,
        totalFiles: inputPaths.length,
        successCount,
        failedCount: inputPaths.length - successCount,
      };
    }
  );
}
