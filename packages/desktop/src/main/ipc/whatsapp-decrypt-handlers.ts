import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommand, runCommandWithProgress } from '../services/process-runner';

/**
 * Register WhatsApp decryption IPC handlers.
 *
 * Maps to the original FormDecript.cs and FormMidias.cs functionality.
 * Uses the Python decrypt14_15.py script to decrypt WhatsApp .crypt12/.crypt14/.crypt15
 * database files, and handles media file decryption.
 */
export function registerWhatsAppDecryptHandlers(): void {
  // ---------------------------------------------------------------------------
  // WHATSAPP_DECRYPT - Decrypt a WhatsApp encrypted database file
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_DECRYPT,
    async (
      _event,
      options: {
        encryptedDbPath: string;
        keyFilePath: string;
        outputPath: string;
      }
    ) => {
      const { encryptedDbPath, keyFilePath, outputPath } = options;
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

      // Resolve Python
      const pythonTool = await resolveTool('python');
      if (!pythonTool.found) {
        throw new Error(
          'Python not found. Please install Python 3 and configure the path in Settings.'
        );
      }

      // Validate input files exist
      await fs.access(encryptedDbPath).catch(() => {
        throw new Error(`Encrypted database not found: ${encryptedDbPath}`);
      });
      await fs.access(keyFilePath).catch(() => {
        throw new Error(`Key file not found: ${keyFilePath}`);
      });

      // Ensure output directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Locate the decrypt14_15.py script in the tools directory
      const scriptPath = path.join(
        path.dirname(pythonTool.path),
        '..',
        'tools',
        'decrypt14_15.py'
      );

      // Try bundled script first, then fall back to looking in the app resources
      let finalScriptPath = scriptPath;
      try {
        await fs.access(scriptPath);
      } catch {
        // Search for the script in common locations
        const alternativePaths = [
          path.join(process.resourcesPath ?? '', 'tools', 'decrypt14_15.py'),
          path.join(__dirname, '..', '..', '..', 'resources', 'tools', 'decrypt14_15.py'),
        ];
        let found = false;
        for (const altPath of alternativePaths) {
          try {
            await fs.access(altPath);
            finalScriptPath = altPath;
            found = true;
            break;
          } catch {
            continue;
          }
        }
        if (!found) {
          throw new Error(
            'Decryption script (decrypt14_15.py) not found. ' +
            'Place it in the tools directory or configure the path in Settings.'
          );
        }
      }

      sendProgress('Starting WhatsApp database decryption...');

      // Run: python decrypt14_15.py <key_file> <encrypted_db> <output_db>
      const result = await runCommandWithProgress(
        pythonTool.path,
        [finalScriptPath, keyFilePath, encryptedDbPath, outputPath],
        {},
        (p) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.PROCESS_PROGRESS, p);
          }
        }
      );

      if (result.exitCode !== 0) {
        throw new Error(
          `Decryption failed: ${result.stderr.trim() || result.stdout.trim() || 'Unknown error'}`
        );
      }

      // Verify output file was created
      try {
        const stat = await fs.stat(outputPath);
        sendProgress(`Decryption complete. Output: ${outputPath} (${stat.size} bytes)`);
      } catch {
        throw new Error('Decryption produced no output file. The key file may be incorrect.');
      }

      return {
        success: true,
        outputPath,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // WHATSAPP_DECRYPT_MEDIA - Decrypt WhatsApp media files
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_DECRYPT_MEDIA,
    async (
      _event,
      options: {
        mediaDir: string;
        keyFilePath: string;
        outputDir: string;
      }
    ) => {
      const { mediaDir, keyFilePath, outputDir } = options;
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

      const pythonTool = await resolveTool('python');
      if (!pythonTool.found) {
        throw new Error('Python not found. Please install Python 3 and configure the path in Settings.');
      }

      await fs.mkdir(outputDir, { recursive: true });

      sendProgress('Scanning for encrypted media files...');

      // Find all .enc files in the media directory
      const encryptedFiles = await findEncryptedMediaFiles(mediaDir);
      sendProgress(`Found ${encryptedFiles.length} encrypted media files.`);

      let decryptedCount = 0;
      let failedCount = 0;

      for (const encFile of encryptedFiles) {
        const relativePath = path.relative(mediaDir, encFile);
        // Remove .enc extension for output
        const outputName = relativePath.replace(/\.enc$/i, '');
        const outputPath = path.join(outputDir, outputName);

        await fs.mkdir(path.dirname(outputPath), { recursive: true });

        try {
          // Use the Python decryption tool for each media file
          const result = await runCommand(pythonTool.path, [
            '-c',
            `
import sys
from Crypto.Cipher import AES
key = open(sys.argv[1], 'rb').read()
data = open(sys.argv[2], 'rb').read()
# Skip the first 67 bytes (header) and decrypt
iv = data[51:67]
cipher = AES.new(key[:32], AES.MODE_GCM, nonce=iv)
decrypted = cipher.decrypt(data[67:-16])
open(sys.argv[3], 'wb').write(decrypted)
`,
            keyFilePath,
            encFile,
            outputPath,
          ]);

          if (result.exitCode === 0) {
            decryptedCount++;
          } else {
            failedCount++;
          }
        } catch {
          failedCount++;
        }

        if ((decryptedCount + failedCount) % 10 === 0) {
          sendProgress(
            `Progress: ${decryptedCount + failedCount}/${encryptedFiles.length} ` +
            `(${decryptedCount} decrypted, ${failedCount} failed)`
          );
        }
      }

      sendProgress(
        `Media decryption complete. ${decryptedCount} decrypted, ${failedCount} failed.`
      );

      return {
        success: true,
        totalFiles: encryptedFiles.length,
        decryptedCount,
        failedCount,
        outputDir,
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively find all .enc files in a directory.
 */
async function findEncryptedMediaFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];

  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await findEncryptedMediaFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.enc')) {
      results.push(fullPath);
    }
  }

  return results;
}
