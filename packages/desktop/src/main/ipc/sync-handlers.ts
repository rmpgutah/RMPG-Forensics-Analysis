import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress, ForensicCase } from '@rmpg/shared';
import {
  syncCaseToCloud,
  fetchCaseFromCloud,
  fetchAllCases,
  uploadCaseFile,
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
      const win = BrowserWindow.getFocusedWindow();

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
        const relativePath = filePath.replace(casePath, '').replace(/^[/\\]/, '');
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
      const win = BrowserWindow.getFocusedWindow();

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
      sendProgress('Download complete. Note: File attachments must be synced separately.');

      return {
        success: true,
        localCase,
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
    const fullPath = `${dirPath}/${entry.name}`;
    if (entry.isDirectory()) {
      const nested = await collectAllFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}
