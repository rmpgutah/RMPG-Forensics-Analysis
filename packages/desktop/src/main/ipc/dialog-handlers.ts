import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';

/**
 * Register native dialog IPC handlers.
 *
 * These expose Electron's dialog module to the renderer process so that
 * the UI can prompt the user to select folders, files, or save locations.
 */
export function registerDialogHandlers(): void {
  // ---------------------------------------------------------------------------
  // DIALOG_OPEN_FOLDER - Select a directory
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_OPEN_FOLDER,
    async (_event, options?: { title?: string; defaultPath?: string }) => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win!, {
        title: options?.title ?? 'Select Folder',
        defaultPath: options?.defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    }
  );

  // ---------------------------------------------------------------------------
  // DIALOG_OPEN_FILE - Select one or more files with optional filter
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_OPEN_FILE,
    async (
      _event,
      options?: {
        title?: string;
        defaultPath?: string;
        filters?: Electron.FileFilter[];
        multiple?: boolean;
      }
    ) => {
      const win = BrowserWindow.getFocusedWindow();
      const properties: Electron.OpenDialogOptions['properties'] = ['openFile'];
      if (options?.multiple) {
        properties.push('multiSelections');
      }

      const result = await dialog.showOpenDialog(win!, {
        title: options?.title ?? 'Select File',
        defaultPath: options?.defaultPath,
        filters: options?.filters ?? [{ name: 'All Files', extensions: ['*'] }],
        properties,
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return options?.multiple ? result.filePaths : result.filePaths[0];
    }
  );

  // ---------------------------------------------------------------------------
  // DIALOG_SAVE_FILE - Choose a save location
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_SAVE_FILE,
    async (
      _event,
      options?: {
        title?: string;
        defaultPath?: string;
        filters?: Electron.FileFilter[];
      }
    ) => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win!, {
        title: options?.title ?? 'Save File',
        defaultPath: options?.defaultPath,
        filters: options?.filters ?? [{ name: 'All Files', extensions: ['*'] }],
      });

      if (result.canceled || !result.filePath) {
        return null;
      }
      return result.filePath;
    }
  );
}
