import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import * as caseManager from '../services/case-manager';

/**
 * Register case management IPC handlers.
 *
 * These expose the case-manager service to the renderer for creating, opening,
 * listing, exporting, and importing forensic case folders.
 */
export function registerCaseHandlers(): void {
  // ---------------------------------------------------------------------------
  // CASE_CREATE - Create a new forensic case
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_CREATE,
    async (_event, config: {
      examinerName: string;
      caseNumber: string;
      description: string;
      outputDir: string;
    }) => {
      return caseManager.createCase(config);
    }
  );

  // ---------------------------------------------------------------------------
  // CASE_OPEN - Open an existing case from its folder path
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_OPEN,
    async (_event, casePath: string) => {
      return caseManager.openCase(casePath);
    }
  );

  // ---------------------------------------------------------------------------
  // CASE_LIST - List all cases in a given base directory
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_LIST,
    async (_event, baseDir: string) => {
      return caseManager.getCaseList(baseDir);
    }
  );

  // ---------------------------------------------------------------------------
  // CASE_EXPORT - Export a case to a compressed archive
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_EXPORT,
    async (_event, casePath: string, outputZipPath: string) => {
      await caseManager.exportCase(casePath, outputZipPath);
      return { success: true, outputPath: outputZipPath };
    }
  );

  // ---------------------------------------------------------------------------
  // CASE_IMPORT - Import a previously exported case archive
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_IMPORT,
    async (_event, zipPath: string, outputDir: string) => {
      return caseManager.importCase(zipPath, outputDir);
    }
  );
}
