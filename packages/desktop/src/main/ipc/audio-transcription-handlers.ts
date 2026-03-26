import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommandWithProgress } from '../services/process-runner';
import { isWindows } from '../services/platform-service';

/**
 * Register audio transcription IPC handlers.
 *
 * Maps to the original FormOpus.cs functionality. Transcribes audio files
 * (typically WhatsApp voice notes in .opus format) to text using either
 * the bundled listen.exe (Windows) or whisper/whisper.cpp equivalent.
 */
export function registerAudioTranscriptionHandlers(): void {
  // ---------------------------------------------------------------------------
  // AUDIO_TRANSCRIBE - Transcribe audio files to text
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.AUDIO_TRANSCRIBE,
    async (
      _event,
      options: {
        inputPaths: string[];
        outputDir: string;
        language?: string;
        model?: string;
      }
    ) => {
      const { inputPaths, outputDir, language = 'pt', model = 'base' } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.AUDIO_TRANSCRIBE_PROGRESS, progress);
        }
      };

      // Resolve Python for whisper
      const pythonTool = await resolveTool('python');
      if (!pythonTool.found) {
        throw new Error(
          'Python not found. Please install Python 3 with the openai-whisper package and configure the path in Settings.'
        );
      }

      await fs.mkdir(outputDir, { recursive: true });

      sendProgress(`Starting transcription of ${inputPaths.length} file(s)...`);

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
        const txtOutputPath = path.join(outputDir, `${baseName}.txt`);

        sendProgress(`[${i + 1}/${inputPaths.length}] Transcribing: ${path.basename(inputPath)}`);

        try {
          // Attempt to use whisper via Python
          const result = await runCommandWithProgress(
            pythonTool.path,
            [
              '-c',
              `
import whisper
import sys
import json

model = whisper.load_model("${model}")
result = model.transcribe(sys.argv[1], language="${language}")
print(json.dumps({"text": result["text"], "segments": [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in result["segments"]]}))
`,
              inputPath,
            ],
            {},
            (p) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send(IPC_CHANNELS.AUDIO_TRANSCRIBE_PROGRESS, p);
              }
            }
          );

          if (result.exitCode === 0) {
            const output = JSON.parse(result.stdout.trim());
            const transcribedText = output.text ?? '';

            // Write the transcription to a text file
            const fullOutput = [
              `Transcription of: ${path.basename(inputPath)}`,
              `Language: ${language}`,
              `Model: ${model}`,
              `Date: ${new Date().toISOString()}`,
              '',
              '--- Full Text ---',
              transcribedText,
              '',
              '--- Segments ---',
              ...(output.segments ?? []).map(
                (s: { start: number; end: number; text: string }) =>
                  `[${formatTimestamp(s.start)} --> ${formatTimestamp(s.end)}] ${s.text}`
              ),
            ].join('\n');

            await fs.writeFile(txtOutputPath, fullOutput, 'utf-8');

            results.push({
              inputPath,
              outputPath: txtOutputPath,
              text: transcribedText,
              success: true,
            });
          } else {
            const errorMsg = result.stderr.trim() || 'Unknown transcription error';
            results.push({
              inputPath,
              outputPath: txtOutputPath,
              text: '',
              success: false,
              error: errorMsg,
            });
          }
        } catch (err) {
          results.push({
            inputPath,
            outputPath: txtOutputPath,
            text: '',
            success: false,
            error: (err as Error).message,
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      sendProgress(
        `Transcription complete. ${successCount}/${inputPaths.length} files transcribed successfully.`
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Format a timestamp in seconds to HH:MM:SS.mmm format.
 */
function formatTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
