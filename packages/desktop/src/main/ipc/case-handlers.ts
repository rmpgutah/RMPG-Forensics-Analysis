import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from '@rmpg/shared';
import * as caseManager from '../services/case-manager';

export function registerCaseHandlers(): void {
  // CASE_CREATE - If no config provided, show folder picker dialog first
  ipcMain.handle(
    IPC_CHANNELS.CASE_CREATE,
    async (_event, config?: {
      // Support both naming conventions from CaseManager page
      examinerName?: string; name?: string;
      caseNumber?: string; number?: string;
      description?: string;
      outputDir?: string; path?: string;
    }) => {
      if (!config) {
        // Show folder picker for case output directory
        const win = BrowserWindow.getAllWindows()[0] ?? null;
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
      // Normalize field names from CaseManager page
      return caseManager.createCase({
        examinerName: config.examinerName ?? config.name ?? 'Examiner',
        caseNumber: config.caseNumber ?? config.number ?? `CASE-${Date.now().toString(36).toUpperCase()}`,
        description: config.description ?? '',
        outputDir: config.outputDir ?? config.path ?? app.getPath('documents'),
      });
    }
  );

  // CASE_OPEN - If no path provided, show folder picker
  ipcMain.handle(
    IPC_CHANNELS.CASE_OPEN,
    async (_event, casePath?: string | { path?: string }) => {
      // Support both string path and object { path }
      const resolvedPath = typeof casePath === 'object' ? casePath?.path : casePath;
      if (!resolvedPath) {
        const win = BrowserWindow.getAllWindows()[0] ?? null;
        const result = await dialog.showOpenDialog(win!, {
          title: 'Open existing case folder',
          properties: ['openDirectory'],
          buttonLabel: 'Open Case',
        });
        if (result.canceled || !result.filePaths[0]) {
          return { success: false, error: 'Cancelled' };
        }
        try {
          return caseManager.openCase(result.filePaths[0]);
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      try {
        return caseManager.openCase(resolvedPath);
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // CASE_LIST - List all cases in a given base directory
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_LIST,
    async (_event, baseDir?: string) => {
      const dir = baseDir ?? path.join(app.getPath('documents'), 'RMPG Forensics Cases');
      return caseManager.getCaseList(dir);
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

  // ---------------------------------------------------------------------------
  // CASE_SAVE_NOTES - Persist free-text notes to case.json
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_SAVE_NOTES,
    async (_event, casePath: string, notes: string) => {
      await caseManager.saveNotes(casePath, notes);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // CASE_EXPORT_PDF - Print case report to PDF using Electron's printToPDF
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_EXPORT_PDF,
    async (_event, html: string, outputPath: string) => {
      const { BrowserWindow: BW } = await import('electron');
      const win = new BW({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      win.destroy();
      const { writeFile } = await import('fs/promises');
      await writeFile(outputPath, data);
      return { success: true, outputPath };
    }
  );
}
