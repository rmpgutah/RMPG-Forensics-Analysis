import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import * as caseManager from '../services/case-manager';

export function registerCaseHandlers(): void {
  // CASE_CREATE - If no config provided, show folder picker dialog first
  ipcMain.handle(
    IPC_CHANNELS.CASE_CREATE,
    async (_event, config?: {
      examinerName: string;
      caseNumber: string;
      description: string;
      outputDir: string;
    }) => {
      if (!config) {
        // Show folder picker for case output directory
        const win = BrowserWindow.getFocusedWindow();
        const result = await dialog.showOpenDialog(win!, {
          title: 'Select folder for new case',
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Create Case Here',
        });
        if (result.canceled || !result.filePaths[0]) {
          return { success: false, error: 'Cancelled' };
        }
        // Create with defaults
        const caseNum = `CASE-${Date.now().toString(36).toUpperCase()}`;
        return caseManager.createCase({
          examinerName: 'Examiner',
          caseNumber: caseNum,
          description: '',
          outputDir: result.filePaths[0],
        });
      }
      return caseManager.createCase(config);
    }
  );

  // CASE_OPEN - If no path provided, show folder picker
  ipcMain.handle(
    IPC_CHANNELS.CASE_OPEN,
    async (_event, casePath?: string) => {
      if (!casePath) {
        const win = BrowserWindow.getFocusedWindow();
        const result = await dialog.showOpenDialog(win!, {
          title: 'Open existing case folder',
          properties: ['openDirectory'],
          buttonLabel: 'Open Case',
        });
        if (result.canceled || !result.filePaths[0]) {
          return { success: false, error: 'Cancelled' };
        }
        return caseManager.openCase(result.filePaths[0]);
      }
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
