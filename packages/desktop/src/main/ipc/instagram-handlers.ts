import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommandWithProgress } from '../services/process-runner';

/**
 * Register Instagram scraping IPC handlers.
 *
 * Maps to the original FormRaspagemInstagram.cs functionality. Uses
 * Instaloader to download Instagram profiles, posts, stories, and
 * other content for forensic preservation.
 */
export function registerInstagramHandlers(): void {
  // ---------------------------------------------------------------------------
  // INSTAGRAM_SCRAPE - Run instaloader to download Instagram content
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.INSTAGRAM_SCRAPE,
    async (
      _event,
      options: {
        target: string;
        outputDir: string;
        loginUser?: string;
        loginPassword?: string;
        downloadStories?: boolean;
        downloadHighlights?: boolean;
        downloadTagged?: boolean;
        downloadIgtv?: boolean;
        downloadComments?: boolean;
        postFilter?: string;
      }
    ) => {
      const {
        target,
        outputDir,
        loginUser,
        loginPassword,
        downloadStories = false,
        downloadHighlights = false,
        downloadTagged = false,
        downloadIgtv = false,
        downloadComments = false,
        postFilter,
      } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.INSTAGRAM_PROGRESS, progress);
        }
      };

      // Resolve instaloader
      const instaloaderTool = await resolveTool('instaloader');
      if (!instaloaderTool.found) {
        throw new Error(
          'Instaloader not found. Please install it (pip install instaloader) and configure the path in Settings.'
        );
      }

      await fs.mkdir(outputDir, { recursive: true });

      sendProgress(`Starting Instagram scrape for: ${target}`);

      // Build instaloader command arguments
      const args: string[] = [
        target,
        '--dirname-pattern', path.join(outputDir, '{profile}'),
        '--no-compress-json',
      ];

      // Login credentials (required for private profiles and some features)
      if (loginUser) {
        args.push('--login', loginUser);
        if (loginPassword) {
          args.push('--password', loginPassword);
        }
      }

      // Optional content types
      if (downloadStories) args.push('--stories');
      if (downloadHighlights) args.push('--highlights');
      if (downloadTagged) args.push('--tagged');
      if (downloadIgtv) args.push('--igtv');
      if (downloadComments) args.push('--comments');

      // Post filter (e.g., date range)
      if (postFilter) {
        args.push('--post-filter', postFilter);
      }

      // Metadata options for forensic use
      args.push('--no-captions'); // We save captions separately in JSON
      args.push('--metadata-json');

      sendProgress('Launching Instaloader...');

      const result = await runCommandWithProgress(
        instaloaderTool.path,
        args,
        {},
        (p) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.INSTAGRAM_PROGRESS, p);
          }
        }
      );

      if (result.exitCode !== 0) {
        // Instaloader may exit non-zero for partial failures (e.g., some posts restricted)
        // Only throw if it looks like a complete failure
        const stderr = result.stderr.trim();
        if (stderr.includes('LoginRequiredException') || stderr.includes('ConnectionException')) {
          throw new Error(`Instagram scrape failed: ${stderr}`);
        }
        // Partial success - continue with warning
        sendProgress(`Warning: Instaloader exited with code ${result.exitCode}. Some content may not have been downloaded.`);
      }

      // Count downloaded files
      const downloadedFiles = await countFiles(outputDir);
      sendProgress(`Instagram scrape complete. ${downloadedFiles} files downloaded.`);

      return {
        success: true,
        outputDir,
        filesDownloaded: downloadedFiles,
        exitCode: result.exitCode,
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively count all files in a directory.
 */
async function countFiles(dirPath: string): Promise<number> {
  let count = 0;
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(fullPath);
    } else if (entry.isFile()) {
      count++;
    }
  }
  return count;
}
