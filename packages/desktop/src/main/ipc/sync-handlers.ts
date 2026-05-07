import * as fs from 'fs/promises';
import * as path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import {
  syncCaseToCloud,
  fetchCaseFromCloud,
  uploadCaseFile,
  listCaseFiles,
  downloadCaseFile,
} from '@rmpg/shared';
import * as caseManager from '../services/case-manager';

/**
 * Register Firebase sync IPC handlers.
 *
 * Provides case upload/download to and from Firebase Cloud Storage,
 * allowing examiners to share and synchronize case data across devices.
 */
export function registerSyncHandlers(): void {
  // ---------------------------------------------------------------------------
  // SYNC_UPLOAD - Upload a local case to Firebase
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.SYNC_UPLOAD,
    async (
      _event,
      options: {
        userId: string;
        casePath: string;
      }
    ) => {
      const { userId, casePath } = options;
      const win = BrowserWindow.getAllWindows()[0] ?? null;

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.SYNC_STATUS, progress);
        }
      };

      sendProgress('Reading case manifest...');

      // Open the local case
      const forensicCase = await caseManager.openCase(casePath);

      sendProgress('Syncing case metadata to cloud...');

      // Upload the case manifest/metadata to Firestore
      await syncCaseToCloud(userId, forensicCase);

      // Collect and upload all files in the case directory
      sendProgress('Uploading case files...');
      const allFiles = await collectAllFiles(casePath);

      let uploadedCount = 0;
      for (const filePath of allFiles) {
        // Firebase Storage paths use forward slashes universally — normalise
        // the OS-specific separator so Windows-uploaded files can be located
        // by listCaseFiles on download.
        const relativePath = path
          .relative(casePath, filePath)
          .split(path.sep)
          .join('/');
        const fileBuffer = await fs.readFile(filePath);

        await uploadCaseFile(userId, forensicCase.id, relativePath, fileBuffer);
        uploadedCount++;

        if (uploadedCount % 10 === 0) {
          sendProgress(
            `Uploaded ${uploadedCount}/${allFiles.length} files...`
          );
        }
      }

      sendProgress(`Upload complete. ${uploadedCount} files synced.`);

      return {
        success: true,
        caseId: forensicCase.id,
        filesUploaded: uploadedCount,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // SYNC_DOWNLOAD - Download a case from Firebase to local storage
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.SYNC_DOWNLOAD,
    async (
      _event,
      options: {
        userId: string;
        caseId: string;
        outputDir: string;
      }
    ) => {
      const { userId, caseId, outputDir } = options;
      const win = BrowserWindow.getAllWindows()[0] ?? null;

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.SYNC_STATUS, progress);
        }
      };

      sendProgress('Fetching case metadata from cloud...');

      // Download the case manifest from Firestore
      const cloudCase = await fetchCaseFromCloud(userId, caseId);
      if (!cloudCase) {
        throw new Error(`Case ${caseId} not found in cloud storage.`);
      }

      sendProgress(`Case "${cloudCase.name}" found. Preparing local directory...`);

      // Create the local case structure
      const localCase = await caseManager.createCase({
        examinerName: cloudCase.examinerName,
        caseNumber: cloudCase.caseNumber,
        description: `${cloudCase.description} [Downloaded from cloud]`,
        outputDir,
      });

      sendProgress(`Local case created at: ${localCase.localPath}`);

      // Pull every uploaded artifact down to the local case folder. The
      // relative paths returned by listCaseFiles match what uploadCaseFile
      // wrote, so we can rebuild the directory layout 1:1.
      sendProgress('Listing remote case files...');
      const remoteFiles = await listCaseFiles(userId, caseId);

      let downloadedCount = 0;
      for (const relativePath of remoteFiles) {
        const bytes = await downloadCaseFile(userId, caseId, relativePath);
        const destPath = path.join(localCase.localPath, relativePath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, bytes);
        downloadedCount++;

        if (downloadedCount % 10 === 0) {
          sendProgress(
            `Downloaded ${downloadedCount}/${remoteFiles.length} files...`
          );
        }
      }

      sendProgress(`Download complete. ${downloadedCount} files synced.`);

      return {
        success: true,
        localCase,
        filesDownloaded: downloadedCount,
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all file paths in a directory.
 */
async function collectAllFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectAllFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}
