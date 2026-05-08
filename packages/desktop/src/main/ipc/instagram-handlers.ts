import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';

// Holds the currently running instaloader child so the renderer can write
// the 2FA code into its stdin via INSTAGRAM_2FA_SUBMIT.
let activeChild: ChildProcess | null = null;
// If the user submits a 2FA code before instaloader asks for it, queue it and
// write as soon as the prompt is detected.
let pendingTwoFaCode: string | null = null;

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
      // The InstagramScraping page sends one shape; older callers use another.
      // Accept both — picking the first defined value per field — so the
      // handler doesn't crash with "path undefined" when called from the UI.
      options: {
        // Canonical names
        target?: string;
        outputDir?: string;
        loginUser?: string;
        loginPassword?: string;
        downloadStories?: boolean;
        downloadHighlights?: boolean;
        downloadTagged?: boolean;
        downloadIgtv?: boolean;
        downloadComments?: boolean;
        downloadGeotags?: boolean;
        postFilter?: string;
        // Renderer aliases
        username?: string;
        outputPath?: string;
        stories?: boolean;
        highlights?: boolean;
        taggedPosts?: boolean;
        igtv?: boolean;
        comments?: boolean;
        geotags?: boolean;
      }
    ) => {
      const target = options.target ?? options.username;
      const outputDir = options.outputDir ?? options.outputPath;
      if (!target || !outputDir) {
        throw new Error(
          'Instagram scrape requires both a target username and an output folder.'
        );
      }
      const {
        loginUser,
        loginPassword,
        postFilter,
      } = options;
      const downloadStories = options.downloadStories ?? options.stories ?? false;
      const downloadHighlights = options.downloadHighlights ?? options.highlights ?? false;
      const downloadTagged = options.downloadTagged ?? options.taggedPosts ?? false;
      const downloadIgtv = options.downloadIgtv ?? options.igtv ?? false;
      const downloadComments = options.downloadComments ?? options.comments ?? false;
      const downloadGeotags = options.downloadGeotags ?? options.geotags ?? false;
      const win = BrowserWindow.getAllWindows()[0] ?? null;

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
      if (downloadGeotags) args.push('--geotags');

      // Post filter (e.g., date range)
      if (postFilter) {
        args.push('--post-filter', postFilter);
      }

      // Metadata options for forensic use
      args.push('--no-captions'); // We save captions separately in JSON
      args.push('--metadata-json');

      sendProgress('Launching Instaloader...');

      const result = await runInstaloaderInteractive(
        instaloaderTool.path,
        args,
        win
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

  // Renderer submits the user-typed 2FA code. If the child is alive we write
  // immediately; otherwise we queue it for when the prompt actually arrives.
  ipcMain.handle(IPC_CHANNELS.INSTAGRAM_2FA_SUBMIT, async (_e, code: string) => {
    const trimmed = String(code ?? '').replace(/\D/g, '').slice(0, 8);
    if (!trimmed) return { ok: false, error: 'Empty 2FA code.' };
    if (!activeChild || !activeChild.stdin || activeChild.stdin.destroyed) {
      // Queue for the next prompt — useful if user pastes the code before
      // instaloader actually asks for it.
      pendingTwoFaCode = trimmed;
      return { ok: true, queued: true };
    }
    try {
      activeChild.stdin.write(trimmed + '\n');
      pendingTwoFaCode = null;
      return { ok: true, queued: false };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}

/**
 * Spawn instaloader directly so we can pipe stdin for interactive prompts
 * (notably the "Enter 2FA verification code:" challenge instaloader emits
 * to stderr when the configured account has 2FA enabled). When that prompt
 * is detected, we forward INSTAGRAM_2FA_PROMPT to the renderer; the renderer
 * shows an input UI and submits the code via INSTAGRAM_2FA_SUBMIT, which
 * writes it to the child's stdin.
 */
function runInstaloaderInteractive(
  binary: string,
  args: string[],
  win: BrowserWindow | null
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Force Python (instaloader is a Python script) to flush stdout/stderr
        // immediately so we can see the "Enter 2FA verification code:" prompt
        // the moment getpass writes it. Without this Python uses block buffering
        // for non-tty stderr and the prompt sits in a buffer indefinitely.
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      });
    } catch (err) {
      reject(new Error(`Failed to spawn "${binary}": ${(err as Error).message}`));
      return;
    }

    activeChild = child;

    const send = (p: ProcessProgress) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.INSTAGRAM_PROGRESS, p);
      }
    };
    send({ type: 'status', data: `Started: ${binary} ${args.join(' ')}`, timestamp: Date.now() });

    let stdoutAll = '';
    let stderrAll = '';
    // Buffer stderr because instaloader emits the 2FA prompt without a trailing
    // newline — it sits at the end of the buffer until the user types something.
    let stderrBuffer = '';
    let promptSent = false;

    const TWO_FA_RE = /(?:enter\s+(?:the\s+)?2fa|two[-\s]?factor|verification\s+code|2fa\s+code|enter\s+code|authenticator)/i;

    const checkPrompt = (chunkText: string) => {
      stderrBuffer += chunkText;
      if (!promptSent && TWO_FA_RE.test(stderrBuffer)) {
        promptSent = true;
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.INSTAGRAM_2FA_PROMPT, { reason: 'two-factor' });
        }
        send({ type: 'status', data: '2FA required — waiting for verification code from UI…', timestamp: Date.now() });
        // Auto-flush any queued code the user pasted before the prompt arrived.
        if (pendingTwoFaCode && child.stdin && !child.stdin.destroyed) {
          try {
            child.stdin.write(pendingTwoFaCode + '\n');
            send({ type: 'status', data: 'Submitted queued 2FA code.', timestamp: Date.now() });
          } catch {}
          pendingTwoFaCode = null;
        }
      }
      // Reset the prompt sentinel once instaloader produces a fresh newline.
      if (chunkText.includes('\n')) {
        stderrBuffer = stderrBuffer.split('\n').slice(-1)[0];
        promptSent = false;
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdoutAll += text;
      checkPrompt(text);
      for (const line of text.split(/\r\n|\n|\r/).filter((l) => l.length > 0)) {
        send({ type: 'stdout', data: line, timestamp: Date.now() });
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderrAll += text;
      checkPrompt(text);
      for (const line of text.split(/\r\n|\n|\r/).filter((l) => l.length > 0)) {
        send({ type: 'stderr', data: line, timestamp: Date.now() });
      }
    });

    child.on('error', (err) => {
      activeChild = null;
      send({ type: 'status', data: `Error: ${err.message}`, timestamp: Date.now() });
      reject(new Error(`Process error for "${binary}": ${err.message}`));
    });

    child.on('close', (code) => {
      activeChild = null;
      send({ type: 'status', data: `Process exited with code ${code}`, timestamp: Date.now() });
      resolve({ exitCode: code ?? 0, stdout: stdoutAll, stderr: stderrAll });
    });
  });
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
