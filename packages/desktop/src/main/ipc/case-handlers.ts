import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from '@rmpg/shared';
import * as caseManager from '../services/case-manager';
import { setActiveCaseDir } from '../services/active-case';

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
        const created = await caseManager.createCase({
          examinerName: 'Examiner',
          caseNumber: caseNum,
          description: '',
          outputDir: result.filePaths[0],
        });
        setActiveCaseDir(created.localPath);
        return created;
      }
      // Normalize field names from CaseManager page
      const created = await caseManager.createCase({
        examinerName: config.examinerName ?? config.name ?? 'Examiner',
        caseNumber: config.caseNumber ?? config.number ?? `CASE-${Date.now().toString(36).toUpperCase()}`,
        description: config.description ?? '',
        outputDir: config.outputDir ?? config.path ?? app.getPath('documents'),
      });
      setActiveCaseDir(created.localPath);
      return created;
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
          const opened = await caseManager.openCase(result.filePaths[0]);
          setActiveCaseDir(opened.localPath);
          return opened;
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      try {
        const opened = await caseManager.openCase(resolvedPath);
        setActiveCaseDir(opened.localPath);
        return opened;
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // CASE_SET_PATH - Renderer pushes the active case dir (or null to clear).
  // Used so per-case audit logs in main are written to the right folder when
  // the renderer changes/clears the active case via useCaseStore.
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_SET_PATH,
    async (_event, casePath: string | null | undefined) => {
      setActiveCaseDir(casePath);
      return { success: true };
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
  // CASE_IMPORT - Import a previously exported case archive.
  //
  // Three call shapes are tolerated:
  //   1. `()` (no args)               — show pickers for zip + output dir
  //   2. `({zipPath, outputDir})`     — object payload from the renderer
  //   3. `(zipPath, outputDir)`       — legacy positional form
  //
  // Without (1) the Case Manager's "Import Case" button (which currently
  // invokes with no args) crashed with `path argument undefined`.
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CASE_IMPORT,
    async (_event, ...args: unknown[]) => {
      let zipPath: string | undefined;
      let outputDir: string | undefined;

      if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const o = args[0] as { zipPath?: string; outputDir?: string };
        zipPath = o.zipPath;
        outputDir = o.outputDir;
      } else if (args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
        [zipPath, outputDir] = args as [string, string];
      }

      const win = BrowserWindow.getAllWindows()[0] ?? null;

      // Prompt for the archive if the caller didn't supply one.
      if (!zipPath) {
        const r = await dialog.showOpenDialog(win!, {
          title: 'Pick exported case archive',
          properties: ['openFile'],
          filters: [{ name: 'Case archive', extensions: ['zip', 'rmpgcase'] }],
        });
        if (r.canceled || !r.filePaths[0]) return { success: false, error: 'Cancelled' };
        zipPath = r.filePaths[0];
      }

      // Default output dir to ~/Documents/RMPG Forensics Cases. The user
      // can move the case folder afterwards; the manifest path is updated
      // on next openCase via localPath rewrite.
      if (!outputDir) {
        outputDir = path.join(app.getPath('documents'), 'RMPG Forensics Cases');
      }

      try {
        const imported = await caseManager.importCase(zipPath, outputDir);
        return imported;
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
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
