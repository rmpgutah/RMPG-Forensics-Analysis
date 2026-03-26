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

      sendProgress('Scanning directory for media files...');

      // Collect all files recursively
      const allFiles = await collectFiles(inputDir);
      sendProgress(`Found ${allFiles.length} files.`);

      const mediaEntries: MediaFileEntry[] = [];
      let totalSize = 0;

      for (let i = 0; i < allFiles.length; i++) {
        const filePath = allFiles[i];
        const fileName = path.basename(filePath);
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

        if ((i + 1) % 50 === 0) {
          sendProgress(`Scanned ${i + 1}/${allFiles.length} files...`);
        }
      }

      // Generate hash log if requested
      let hashLogPath: string | undefined;
      if (generateHashLog) {
        sendProgress(`Computing ${hashAlgorithm.toUpperCase()} hashes for ${allFiles.length} files...`);
        hashLogPath = path.join(outputDir, `hash_log_${hashAlgorithm}.txt`);
        await hashService.hashDirectory(inputDir, hashAlgorithm, hashLogPath);
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
        files: MediaFileEntry[];
        outputPath: string;
        title?: string;
      }
    ) => {
      const { files, outputPath, title = 'Media Processing Report' } = options;
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

      sendProgress(`Generating HTML report with ${files.length} files...`);

      const reportPath = await reportGenerator.generateMediaReport({
        title,
        files,
        outputPath,
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
