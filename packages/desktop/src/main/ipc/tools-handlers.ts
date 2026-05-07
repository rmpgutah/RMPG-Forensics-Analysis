import { ipcMain, BrowserWindow, shell } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ToolName } from '@rmpg/shared';
import { resolveAllTools, resolveTool, saveUserToolPath } from '../services/tool-resolver';
import { clearAdbPathCache } from '../services/adb-service';
import { getPlatform, isMac, isWindows } from '../services/platform-service';
import { APP_VERSION } from '@rmpg/shared';
import { runCommandWithProgress } from '../services/process-runner';

// ---------------------------------------------------------------------------
// Install recipes per tool
// ---------------------------------------------------------------------------

interface BrewRecipe {
  type: 'brew';
  package: string;
  /**
   * For "keg-only" brew formulae (like `openjdk`) Homebrew installs the binary
   * but does NOT symlink it into /opt/homebrew/bin. Listing the binaries here
   * causes the installer to create symlinks from `/<brew-prefix>/bin/<name>`
   * → `/<brew-prefix>/opt/<package>/bin/<name>` after install.
   */
  postInstallSymlinks?: string[];
}

interface PipRecipe {
  type: 'pip';
  package: string;
}

interface WingetRecipe {
  type: 'winget';
  id: string;
}

interface UrlRecipe {
  type: 'url';
  url: string;
  label: string;
}

type InstallRecipe = BrewRecipe | PipRecipe | WingetRecipe | UrlRecipe;

interface ToolInstallInfo {
  darwin?: InstallRecipe;
  linux?: InstallRecipe;
  win32?: InstallRecipe;
  /** Human-readable install note shown in the UI */
  note?: string;
}

const INSTALL_RECIPES: Record<string, ToolInstallInfo> = {
  adb: {
    darwin: { type: 'brew', package: 'android-platform-tools' },
    linux: { type: 'url', url: 'https://developer.android.com/tools/releases/platform-tools', label: 'Android Platform Tools' },
    win32: { type: 'url', url: 'https://developer.android.com/tools/releases/platform-tools', label: 'Android Platform Tools (Windows)' },
    note: 'ADB is part of Android Platform Tools',
  },
  java: {
    // openjdk is keg-only on Homebrew (Apple's /usr/bin/java stub takes
    // precedence), so the formula installs to /opt/homebrew/opt/openjdk/bin/
    // but never reaches PATH. We post-install symlink it ourselves.
    darwin: { type: 'brew', package: 'openjdk', postInstallSymlinks: ['java', 'javac', 'jar', 'jshell'] },
    linux: { type: 'url', url: 'https://adoptium.net/en-GB/temurin/releases/', label: 'Eclipse Temurin JRE' },
    win32: { type: 'winget', id: 'EclipseAdoptium.Temurin.21.JRE' },
    note: 'Java Runtime Environment — required for IPED and AB→TAR conversion',
  },
  python: {
    darwin: { type: 'brew', package: 'python@3' },
    linux: { type: 'url', url: 'https://www.python.org/downloads/', label: 'Python Downloads' },
    win32: { type: 'winget', id: 'Python.Python.3.12' },
    note: 'Python 3 — required for WhatsApp decryption and audio transcription',
  },
  tesseract: {
    darwin: { type: 'brew', package: 'tesseract' },
    linux: { type: 'url', url: 'https://tesseract-ocr.github.io/tessdoc/Installation.html', label: 'Tesseract Install Guide' },
    win32: { type: 'url', url: 'https://github.com/UB-Mannheim/tesseract/wiki', label: 'Tesseract Windows Installer' },
    note: 'Tesseract OCR — required for text extraction from images',
  },
  instaloader: {
    darwin: { type: 'pip', package: 'instaloader' },
    linux: { type: 'pip', package: 'instaloader' },
    win32: { type: 'pip', package: 'instaloader' },
    note: 'Requires Python to be installed first',
  },

  // Breach & Bypass — Qualcomm EDL Mode imager
  edl: {
    darwin: { type: 'pip', package: 'edlclient' },
    linux: { type: 'pip', package: 'edlclient' },
    win32: { type: 'pip', package: 'edlclient' },
    note: 'EDL (Emergency Download Mode) tool — Qualcomm chipset bootrom imager. Requires Python and (on Linux/macOS) usbserial drivers.',
  },

  // Breach & Bypass — MediaTek BROM exploit
  mtk: {
    darwin: { type: 'pip', package: 'mtkclient' },
    linux: { type: 'pip', package: 'mtkclient' },
    win32: { type: 'pip', package: 'mtkclient' },
    note: 'mtkclient — MediaTek BROM exploit + Preloader/DA mode tool. On Windows, requires the MTK USB driver.',
  },

  // Breach & Bypass — iOS encrypted backup decryptor
  iphone_backup_decrypt: {
    darwin: { type: 'pip', package: 'iphone_backup_decrypt' },
    linux: { type: 'pip', package: 'iphone_backup_decrypt' },
    win32: { type: 'pip', package: 'iphone_backup_decrypt' },
    note: 'iOS encrypted backup decryptor + keychain extractor (pip iphone_backup_decrypt).',
  },
  idevice_id: {
    darwin: { type: 'brew', package: 'libimobiledevice' },
    linux: { type: 'url', url: 'https://libimobiledevice.org', label: 'libimobiledevice' },
    win32: { type: 'url', url: 'https://github.com/libimobiledevice-win32/imobiledevice-net/releases', label: 'libimobiledevice Windows' },
    note: 'libimobiledevice — required for all iOS device features',
  },
  idevicebackup2: {
    darwin: { type: 'brew', package: 'libimobiledevice' },
    linux: { type: 'url', url: 'https://libimobiledevice.org', label: 'libimobiledevice' },
    win32: { type: 'url', url: 'https://github.com/libimobiledevice-win32/imobiledevice-net/releases', label: 'libimobiledevice Windows' },
    note: 'Part of libimobiledevice — installs together with idevice_id',
  },
  ideviceinfo: {
    darwin: { type: 'brew', package: 'libimobiledevice' },
    linux: { type: 'url', url: 'https://libimobiledevice.org', label: 'libimobiledevice' },
    win32: { type: 'url', url: 'https://github.com/libimobiledevice-win32/imobiledevice-net/releases', label: 'libimobiledevice Windows' },
    note: 'Part of libimobiledevice — installs together with idevice_id',
  },
  scrcpy: {
    darwin: { type: 'brew', package: 'scrcpy' },
    linux: { type: 'url', url: 'https://github.com/Genymobile/scrcpy', label: 'Scrcpy GitHub releases' },
    win32: { type: 'url', url: 'https://github.com/Genymobile/scrcpy/releases', label: 'Scrcpy Windows release' },
    note: 'Android screen mirroring — also requires ADB',
  },
  jadx: {
    darwin: { type: 'brew', package: 'jadx' },
    linux: { type: 'url', url: 'https://github.com/skylot/jadx/releases', label: 'JADX GitHub releases' },
    win32: { type: 'url', url: 'https://github.com/skylot/jadx/releases', label: 'JADX GitHub releases' },
    note: 'JADX decompiler — for APK analysis',
  },
};

/**
 * Register tool management IPC handlers.
 *
 * Provides the renderer with the ability to check which external tools
 * are installed and reachable, configure custom paths for tools not on
 * the system PATH, and auto-install tools via Homebrew/winget/pip.
 */
export function registerToolsHandlers(): void {
  // ---------------------------------------------------------------------------
  // TOOLS_CHECK - Resolve all known tools and return their status
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.TOOLS_CHECK, async (_event, toolName?: ToolName) => {
    if (toolName) return resolveTool(toolName);
    return resolveAllTools();
  });

  // ---------------------------------------------------------------------------
  // TOOLS_CONFIGURE - Save a user-configured path for a specific tool
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.TOOLS_CONFIGURE,
    async (_event, toolName: ToolName, toolPath: string) => {
      await saveUserToolPath(toolName, toolPath);

      // Clear cached paths so the new configuration takes effect immediately
      if (toolName === 'adb') {
        clearAdbPathCache();
      }

      return { success: true, toolName, toolPath };
    }
  );

  // ---------------------------------------------------------------------------
  // TOOLS_INSTALL - Auto-install a tool using the appropriate package manager
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.TOOLS_INSTALL,
    async (_event, toolName: string) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      const platform = getPlatform();

      const sendProgress = (message: string, percent?: number): void => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.TOOLS_INSTALL_PROGRESS, {
            toolName,
            message,
            percent,
            timestamp: Date.now(),
          });
        }
      };

      const recipe = INSTALL_RECIPES[toolName];
      if (!recipe) {
        throw new Error(`No install recipe found for tool: ${toolName}`);
      }

      const platformRecipe = recipe[platform as keyof ToolInstallInfo];
      if (!platformRecipe || typeof platformRecipe !== 'object' || !('type' in platformRecipe)) {
        throw new Error(
          `No install method available for ${toolName} on ${platform}. ` +
          (recipe.note ? recipe.note : 'Please install manually.')
        );
      }

      const installRecipe = platformRecipe as InstallRecipe;

      // URL-only platforms: open in browser and return guidance
      if (installRecipe.type === 'url') {
        await shell.openExternal(installRecipe.url);
        return {
          success: false,
          manualInstall: true,
          message: `Opened download page for ${installRecipe.label}. Please install and restart the app.`,
          url: installRecipe.url,
        };
      }

      // brew install
      if (installRecipe.type === 'brew') {
        sendProgress(`Installing ${toolName} via Homebrew (brew install ${installRecipe.package})...`, 10);

        // Ensure Homebrew is available
        const brewPaths = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
        let brewPath = 'brew';
        for (const bp of brewPaths) {
          const { existsSync } = await import('fs');
          if (existsSync(bp)) {
            brewPath = bp;
            break;
          }
        }

        try {
          sendProgress(`Running: brew install ${installRecipe.package}`, 20);
          const result = await runCommandWithProgress(
            brewPath,
            ['install', installRecipe.package],
            {},
            (p) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send(IPC_CHANNELS.TOOLS_INSTALL_PROGRESS, {
                  toolName,
                  message: p.data || p.message || '',
                  timestamp: Date.now(),
                });
              }
            }
          );

          if (result.exitCode !== 0) {
            throw new Error(result.stderr.trim() || result.stdout.trim() || 'brew install failed');
          }

          // Post-install symlinks for keg-only formulae (e.g. openjdk).
          if (installRecipe.postInstallSymlinks?.length) {
            const path = await import('path');
            const fs = await import('fs/promises');
            const brewPrefix = path.dirname(path.dirname(brewPath)); // /opt/homebrew/bin/brew → /opt/homebrew
            const optDir = path.join(brewPrefix, 'opt', installRecipe.package, 'bin');
            const binDir = path.join(brewPrefix, 'bin');
            for (const name of installRecipe.postInstallSymlinks) {
              const src = path.join(optDir, name);
              const dst = path.join(binDir, name);
              try {
                await fs.access(src);
                // Remove any existing entry first; ignore failure (likely doesn't exist).
                try { await fs.unlink(dst); } catch { /* ignore */ }
                await fs.symlink(src, dst);
                sendProgress(`Linked ${name} → ${src}`, 90);
              } catch (linkErr) {
                // Don't fail the whole install over a single missing binary —
                // some formulae don't ship every entry (e.g. JRE-only builds
                // skip javac). Surface a warning and continue.
                sendProgress(`Skipped ${name}: ${(linkErr as Error).message}`, 90);
              }
            }
          }

          sendProgress(`${toolName} installed successfully via Homebrew.`, 100);
          return { success: true, method: 'brew', package: installRecipe.package };
        } catch (err) {
          throw new Error(
            `Homebrew install failed: ${(err as Error).message}. ` +
            `Try manually: brew install ${installRecipe.package}`
          );
        }
      }

      // pip install
      if (installRecipe.type === 'pip') {
        sendProgress(`Installing ${toolName} via pip (pip install ${installRecipe.package})...`, 10);

        const pipCommands = isWindows()
          ? [['python', ['-m', 'pip', 'install', installRecipe.package]], ['pip', ['install', installRecipe.package]]]
          : [['python3', ['-m', 'pip', 'install', installRecipe.package]], ['pip3', ['install', installRecipe.package]], ['pip', ['install', installRecipe.package]]];

        for (const [cmd, args] of pipCommands) {
          try {
            sendProgress(`Running: ${cmd} ${(args as string[]).join(' ')}`, 20);
            const result = await runCommandWithProgress(
              cmd as string,
              args as string[],
              {},
              (p) => {
                if (win && !win.isDestroyed()) {
                  win.webContents.send(IPC_CHANNELS.TOOLS_INSTALL_PROGRESS, {
                    toolName,
                    message: p.data || p.message || '',
                    timestamp: Date.now(),
                  });
                }
              }
            );
            if (result.exitCode === 0) {
              sendProgress(`${toolName} installed successfully via pip.`, 100);
              return { success: true, method: 'pip', package: installRecipe.package };
            }
          } catch {
            // Try next pip command
          }
        }
        throw new Error(`pip install failed for ${installRecipe.package}. Ensure Python is installed.`);
      }

      // winget install
      if (installRecipe.type === 'winget') {
        sendProgress(`Installing ${toolName} via winget (winget install ${installRecipe.id})...`, 10);

        try {
          const result = await runCommandWithProgress(
            'winget',
            ['install', '--id', installRecipe.id, '--silent', '--accept-package-agreements', '--accept-source-agreements'],
            {},
            (p) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send(IPC_CHANNELS.TOOLS_INSTALL_PROGRESS, {
                  toolName,
                  message: p.data || p.message || '',
                  timestamp: Date.now(),
                });
              }
            }
          );

          if (result.exitCode !== 0) {
            throw new Error(result.stderr.trim() || result.stdout.trim() || 'winget install failed');
          }

          sendProgress(`${toolName} installed successfully via winget.`, 100);
          return { success: true, method: 'winget', id: installRecipe.id };
        } catch (err) {
          throw new Error(
            `winget install failed: ${(err as Error).message}. ` +
            `Try: winget install --id ${installRecipe.id}`
          );
        }
      }

      throw new Error(`Unsupported install type for ${toolName}`);
    }
  );

  // ---------------------------------------------------------------------------
  // TOOLS_GET_INSTALL_INFO - Return install recipes for all tools
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.APP_GET_PLATFORM, () => {
    return getPlatform();
  });

  // ---------------------------------------------------------------------------
  // APP_GET_VERSION - Return the application version
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return APP_VERSION;
  });
}
