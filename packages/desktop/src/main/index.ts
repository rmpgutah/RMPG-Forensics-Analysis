import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { is } from '@electron-toolkit/utils';
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerAllIpcHandlers();
  createWindow();

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
