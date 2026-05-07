import { app, BrowserWindow, shell, ipcMain, globalShortcut } from 'electron';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { is } from '@electron-toolkit/utils';
import { autoUpdater } from 'electron-updater';
import { registerAllIpcHandlers } from './ipc';

// Fix PATH for macOS — packaged Electron apps don't inherit shell PATH
if (process.platform === 'darwin') {
  try {
    const shellPath = execFileSync('/bin/zsh', ['-ilc', 'echo $PATH'], { encoding: 'utf-8' }).trim();
    if (shellPath) process.env.PATH = shellPath;
  } catch {
    const extra = '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin';
    process.env.PATH = `${extra}:${process.env.PATH || ''}`;
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'RMPG Forensics Analysis',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Fallback: always show the window after 3s even if ready-to-show never fires
  // (can happen when renderer crashes before first paint)
  setTimeout(() => { if (mainWindow && !mainWindow.isVisible()) mainWindow.show(); }, 3000);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Cmd+Option+I / F12 opens DevTools in packaged builds for diagnostics
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if ((input.meta && input.alt && input.key === 'i') || input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools();
    }
  });
}

function setupAutoUpdater(): void {
  // Only run auto-update in packaged builds
  if (is.dev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:download-progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update:error', { message: err.message });
  });

  // Check for updates once the window is shown, then every 4 hours.
  // `app.on('browser-window-show', ...)` was the original here but that's
  // not a valid Electron `app` event — TypeScript rejected it and the
  // initial check never fired. The right hook is BrowserWindow.on('show').
  // We attach lazily because `mainWindow` may not exist yet when this runs.
  const attachInitialCheck = (): void => {
    if (!mainWindow) {
      setTimeout(attachInitialCheck, 200);
      return;
    }
    mainWindow.once('show', () => {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
    });
    // If the window was already visible by the time we attached, the
    // `show` event won't fire — kick off the check now so we still run.
    if (mainWindow.isVisible()) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
    }
  };
  attachInitialCheck();
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);

  // Allow renderer to trigger install
  ipcMain.handle('update:install-now', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}

app.whenReady().then(() => {
  registerAllIpcHandlers();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
