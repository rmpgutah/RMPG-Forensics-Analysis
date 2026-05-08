import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as hashService from '../services/hash-service';
import * as reportGenerator from '../services/report-generator';
import type { MediaFileEntry } from '../services/report-generator';
/**
 * Minimal mime-type resolver using a built-in extension map.
 * Avoids the external mime-types dependency.
 */
function getMimeType(filePath: string): string {
  {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.bmp': 'image/bmp', '.tiff': 'image/tiff',
      '.mp4': 'video/mp4', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
      '.mov': 'video/quicktime', '.3gp': 'video/3gpp',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.opus': 'audio/opus', '.m4a': 'audio/mp4',
      '.pdf': 'application/pdf', '.doc': 'application/msword',
      '.txt': 'text/plain', '.html': 'text/html',
    };
    return mimeMap[ext] ?? 'application/octet-stream';
  }
}

/**
 * Categorize a file by its MIME type into a human-readable group.
 */
function categorizeFile(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'Images';
  if (mimeType.startsWith('video/')) return 'Videos';
  if (mimeType.startsWith('audio/')) return 'Audio';
  if (mimeType.startsWith('text/')) return 'Documents';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('spreadsheet')) {
    return 'Documents';
  }
  return 'Other';
}

/**
 * Register media processing IPC handlers.
 *
 * Maps to the original FormProcess.cs functionality. Scans directories
 * for media files, computes hashes, and generates Bootstrap HTML reports
 * with file listings, thumbnails, and metadata.
 */
export function registerMediaProcessHandlers(): void {
  // ---------------------------------------------------------------------------
  // MEDIA_PROCESS - Scan a directory, hash files, and collect metadata
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.MEDIA_PROCESS,
    async (
      _event,
      options: {
        inputDir: string;
        outputDir: string;
        hashAlgorithm?: 'md5' | 'sha1' | 'sha256';
        generateHashLog?: boolean;
      }
    ) => {
      const {
        inputDir,
        outputDir,
        hashAlgorithm = 'sha256',
        generateHashLog = true,
      } = options;
      const win = BrowserWindow.getAllWindows()[0] ?? null;

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

      sendProgress('Scanning directory for media files...');

      // Collect all files recursively
      const allFiles = await collectFiles(inputDir);
      sendProgress(`Found ${allFiles.length} files.`);

      const mediaEntries: MediaFileEntry[] = [];
      const skippedFiles: { filePath: string; reason: string }[] = [];
      let totalSize = 0;

      for (let i = 0; i < allFiles.length; i++) {
        const filePath = allFiles[i];
        const fileName = path.basename(filePath);
        try {
          const stat = await fs.stat(filePath);
          const mimeType = getMimeType(filePath);
          const category = categorizeFile(mimeType);

          mediaEntries.push({
            filePath,
            fileName,
            mimeType,
            size: stat.size,
            category,
          });

          totalSize += stat.size;
        } catch (err) {
          // Skip unreadable files (ENOENT from APFS clones / extracted iOS
          // backups where Manifest references blobs that weren't extracted,
          // EACCES on permission-restricted system files, etc). Record so the
          // analyst sees what was skipped.
          const reason = err instanceof Error ? err.message : String(err);
          skippedFiles.push({ filePath, reason });
        }

        if ((i + 1) % 50 === 0) {
          sendProgress(`Scanned ${i + 1}/${allFiles.length} files...`);
        }
      }

      if (skippedFiles.length > 0) {
        sendProgress(`Skipped ${skippedFiles.length} unreadable file(s) (see skipped_files.txt).`);
        const skipLogPath = path.join(outputDir, 'skipped_files.txt');
        const skipLines = skippedFiles
          .map((s) => `${s.filePath}\t${s.reason}`)
          .join('\n');
        await fs.writeFile(skipLogPath, skipLines + '\n', 'utf8');
      }

      // Generate hash log if requested
      let hashLogPath: string | undefined;
      if (generateHashLog) {
        sendProgress(`Computing ${hashAlgorithm.toUpperCase()} hashes for ${mediaEntries.length} files...`);
        hashLogPath = path.join(outputDir, `hash_log_${hashAlgorithm}.txt`);
        // Hash only the files we successfully stat'd, not the raw walk —
        // otherwise hashDirectory will re-fail on the same ENOENT entries.
        const hashLines: string[] = [];
        for (const entry of mediaEntries) {
          try {
            const h = await hashService.hashFile(entry.filePath, hashAlgorithm);
            hashLines.push(`${h}  ${entry.filePath}`);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            skippedFiles.push({ filePath: entry.filePath, reason: `hash failed: ${reason}` });
          }
        }
        await fs.writeFile(hashLogPath, hashLines.join('\n') + '\n', 'utf8');
        sendProgress('Hash log generated.');
      }

      sendProgress('Media scan complete.');

      return {
        files: mediaEntries,
        totalFiles: mediaEntries.length,
        totalSize,
        hashLogPath,
        categories: groupByCategory(mediaEntries),
      };
    }
  );

  // ---------------------------------------------------------------------------
  // MEDIA_GENERATE_REPORT - Generate a Bootstrap HTML media report
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.MEDIA_GENERATE_REPORT,
    async (
      _event,
      options: {
        files?: MediaFileEntry[];
        outputPath: string;
        title?: string;
      }
    ) => {
      const { outputPath, title = 'Media Processing Report' } = options;
      const win = BrowserWindow.getAllWindows()[0] ?? null;

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

      // The MediaProcessing page invokes this with just `{ outputPath }` after
      // it ran MEDIA_PROCESS — the file list was returned to the renderer but
      // not kept in component state. Rather than crash on `files.length` of
      // undefined, re-scan the output folder ourselves and reconstruct entries.
      let files = options.files;
      if (!files || files.length === 0) {
        sendProgress('Scanning output folder for media to report on...');
        const discovered = await collectFiles(outputPath);
        files = await Promise.all(
          discovered.map(async (filePath) => {
            const stat = await fs.stat(filePath);
            const mimeType = getMimeType(filePath);
            return {
              filePath,
              fileName: path.basename(filePath),
              mimeType,
              size: stat.size,
              category: categorizeFile(mimeType),
            };
          })
        );
      }

      sendProgress(`Generating HTML report with ${files.length} files...`);

      // The renderer passes a folder; the report generator expects a file
      // path. If we got a directory, write the report inside it with a
      // sensible default name. Detect by stat'ing — if it's missing or a
      // file, treat the value as the literal output file path.
      let reportFile = outputPath;
      try {
        const st = await fs.stat(outputPath);
        if (st.isDirectory()) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          reportFile = path.join(outputPath, `media-report-${stamp}.html`);
        }
      } catch {
        // Path doesn't exist yet — generator will create the parent dir
      }

      const reportPath = await reportGenerator.generateMediaReport({
        title,
        files,
        outputPath: reportFile,
      });

      sendProgress(`Report generated: ${reportPath}`);

      return { success: true, reportPath };
    }
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all file paths in a directory.
 */
async function collectFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Group media entries by category and return counts.
 */
function groupByCategory(
  entries: MediaFileEntry[]
): Record<string, { count: number; totalSize: number }> {
  const groups: Record<string, { count: number; totalSize: number }> = {};
  for (const entry of entries) {
    if (!groups[entry.category]) {
      groups[entry.category] = { count: 0, totalSize: 0 };
    }
    groups[entry.category].count++;
    groups[entry.category].totalSize += entry.size;
  }
  return groups;
}
