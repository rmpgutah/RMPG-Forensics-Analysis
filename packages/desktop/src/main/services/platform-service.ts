import { app } from 'electron';
import * as os from 'os';
import * as path from 'path';

export type Platform = 'win32' | 'darwin' | 'linux';

/**
 * Returns the current OS platform.
 */
export function getPlatform(): Platform {
  return process.platform as Platform;
}

/**
 * Returns true if the current OS is Windows.
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Returns true if the current OS is macOS.
 */
export function isMac(): boolean {
  return process.platform === 'darwin';
}

/**
 * Returns true if the current OS is Linux.
 */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Returns the platform-specific application data path.
 * - Windows: %APPDATA%/RMPG Forensics Analysis
 * - macOS: ~/Library/Application Support/RMPG Forensics Analysis
 * - Linux: ~/.config/RMPG Forensics Analysis
 */
export function getAppDataPath(): string {
  try {
    return app.getPath('userData');
  } catch {
    // Fallback if electron app is not ready
    const home = os.homedir();
    switch (process.platform) {
      case 'win32':
        return path.join(process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming'), 'RMPG Forensics Analysis');
      case 'darwin':
        return path.join(home, 'Library', 'Application Support', 'RMPG Forensics Analysis');
      default:
        return path.join(home, '.config', 'RMPG Forensics Analysis');
    }
  }
}

/**
 * Returns the default output directory for forensic cases.
 * - Windows: C:\Users\<user>\Documents\RMPG Forensics
 * - macOS: ~/Documents/RMPG Forensics
 * - Linux: ~/Documents/RMPG Forensics
 */
export function getDefaultOutputDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(home, 'Documents', 'RMPG Forensics');
    case 'darwin':
      return path.join(home, 'Documents', 'RMPG Forensics');
    default:
      return path.join(home, 'Documents', 'RMPG Forensics');
  }
}

/**
 * Returns the path where bundled CLI tools are stored in the app resources.
 * In production: process.resourcesPath/tools
 * In dev: project root/resources/tools
 */
export function getToolsDir(): string {
  try {
    // In production Electron builds, resourcesPath points to the app.asar resources
    const resourcesPath = process.resourcesPath;
    return path.join(resourcesPath, 'tools');
  } catch {
    // Fallback for development
    return path.join(__dirname, '..', '..', '..', 'resources', 'tools');
  }
}

/**
 * Returns the temporary directory path for intermediate processing files.
 */
export function getTempDir(): string {
  return path.join(os.tmpdir(), 'rmpg-forensics');
}

/**
 * Returns the path separator for the current platform.
 */
export function getPathSeparator(): string {
  return path.sep;
}
