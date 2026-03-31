import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as iosService from '../services/ios-service';

/**
 * Register all iOS operation IPC handlers.
 *
 * Covers device enumeration, backup, and all backup-based data extraction
 * features using libimobiledevice and better-sqlite3 backup parsing.
 */
export function registerIosHandlers(): void {

  // ---------------------------------------------------------------------------
  // IOS_LIST_DEVICES - Enumerate connected iOS devices
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.IOS_LIST_DEVICES, async () => {
    return iosService.listDevices();
  });

  // ---------------------------------------------------------------------------
  // IOS_FIND_BACKUP_PATH - Locate the on-disk backup folder for a UDID
  // Returns { path: string, found: boolean, lastModified?: string }
  // Checks macOS (~/Library/Application Support/MobileSync/Backup/{udid})
  // and Windows (%APPDATA%\Apple Computer\MobileSync\Backup\{udid})
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.IOS_FIND_BACKUP_PATH, async (_event, udid: string) => {
    const candidates: string[] = [];
    const home = app.getPath('home');

    if (process.platform === 'darwin') {
      candidates.push(
        path.join(home, 'Library', 'Application Support', 'MobileSync', 'Backup', udid),
        path.join(home, 'Library', 'Application Support', 'MobileSync', 'Backup', udid.toUpperCase()),
      );
    } else if (process.platform === 'win32') {
      const appData = process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
      candidates.push(
        path.join(appData, 'Apple Computer', 'MobileSync', 'Backup', udid),
        path.join(appData, 'Apple', 'MobileSync', 'Backup', udid),
      );
    }

    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, 'Manifest.db'))) {
        const stat = fs.statSync(candidate);
        return { found: true, path: candidate, lastModified: stat.mtime.toISOString() };
      }
    }

    return { found: false, path: '', lastModified: null };
  });

  // ---------------------------------------------------------------------------
  // IOS_GET_INFO - Get detailed device info (all domains)
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.IOS_GET_INFO, async (_event, options: { udid: string } | string) => {
    const udid = typeof options === 'string' ? options : options.udid;
    try {
      const [deviceInfo, diagnostics] = await Promise.all([
        iosService.getDeviceInfo(udid),
        iosService.getDeviceDiagnostics(udid).catch(() => ({})),
      ]);
      return { ...deviceInfo, ...(diagnostics as object) };
    } catch (err) {
      throw new Error((err as Error).message);
    }
  });

  // ---------------------------------------------------------------------------
  // IOS_BACKUP - Create a full iOS backup with progress reporting
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_BACKUP,
    async (event, options: { udid: string; outputPath: string; encrypted?: boolean }) => {
      const { udid, outputPath, encrypted } = options;
      // Use the sender's window — getFocusedWindow() returns null when the app
      // is in the background, which silently drops all progress events.
      const win = BrowserWindow.fromWebContents(event.sender);

      let lastPercent = 0;
      let lastBytes = 0;
      let lastSpeedTs = Date.now();
      let lastSpeedBytes = 0;

      // 5-phase model state — persists across onProgress calls
      let phase = 1;
      let phaseLabel = 'Connecting to device…';
      let backupOutputPath: string | undefined;

      const onProgress = (p: ProcessProgress): void => {
        if (!win || win.isDestroyed()) return;

        // Parse idevicebackup2 stdout for rich progress data
        const line = p.data || '';

        // --- Phase detection (evaluated before percent/file parsing) ---
        if (/verif/i.test(line)) {
          phase = 4;
          phaseLabel = 'Verifying backup integrity…';
        } else if (/backup successful/i.test(line)) {
          phase = 5;
          phaseLabel = 'Backup complete';
          backupOutputPath = path.join(outputPath, udid);
        } else if (/sending file/i.test(line) || /^\d+\.\d+%/.test(line.trim())) {
          if (phase < 3) {
            phase = 3;
            phaseLabel = 'Transferring files…';
          }
        } else if (/backup directory|starting backup/i.test(line)) {
          if (phase < 2) {
            phase = 2;
            phaseLabel = 'Building backup manifest…';
          }
        }

        // "5.23% done" or "Sending file 5 of 120 (5.23% done)"
        const pctMatch = line.match(/(\d+(?:\.\d+)?)%/);
        if (pctMatch) lastPercent = parseFloat(pctMatch[1]);

        // "Sending file N of M" → file count
        const fileMatch = line.match(/file (\d+) of (\d+)/i);

        // "X.X MB/s" or "X bytes in Y.YYs" → speed/bytes
        const speedMatch = line.match(/([\d.]+)\s*MB\/s/i);
        const bytesMatch = line.match(/\((\d+)\s*bytes?\s+in/i);
        const kbMatch = line.match(/([\d.]+)\s*KB\/s/i);

        let speed: number | undefined;
        if (speedMatch) speed = parseFloat(speedMatch[1]) * 1024 * 1024;
        else if (kbMatch) speed = parseFloat(kbMatch[1]) * 1024;

        let bytes: number | undefined;
        if (bytesMatch) {
          bytes = parseInt(bytesMatch[1], 10);
          lastBytes = bytes;
        } else if (lastBytes > 0) {
          bytes = lastBytes;
        }

        // Auto-calculate speed from elapsed if not given by output
        if (!speed && bytes && bytes > lastSpeedBytes) {
          const now = Date.now();
          const dt = (now - lastSpeedTs) / 1000;
          if (dt > 1) {
            speed = (bytes - lastSpeedBytes) / dt;
            lastSpeedTs = now;
            lastSpeedBytes = bytes;
          }
        }

        const rich: ProcessProgress = {
          ...p,
          percent: lastPercent,
          message: line.trim() || `Backing up… ${lastPercent.toFixed(0)}%`,
          bytes,
          speed,
          filesCount: fileMatch ? parseInt(fileMatch[1], 10) : undefined,
          totalFiles: fileMatch ? parseInt(fileMatch[2], 10) : undefined,
        };

        win.webContents.send(IPC_CHANNELS.IOS_BACKUP_PROGRESS, {
          ...rich,
          phase,
          phaseLabel,
          message: phaseLabel,
          ...(phase === 5 ? { outputPath: backupOutputPath } : {}),
        });
      };

      try {
        const result = await iosService.backup(udid, outputPath, encrypted, onProgress);

        // idevicebackup2 creates: {outputPath}/{udid}/ as the backup directory
        const backupDir = path.join(outputPath, udid);
        const backupExists = fs.existsSync(path.join(backupDir, 'Manifest.db'));

        if (result.exitCode === 0 || backupExists) {
          return { success: true, backupPath: backupExists ? backupDir : outputPath };
        } else {
          const errMsg = result.stderr?.trim() || result.stdout?.trim() || 'Backup failed';
          return { success: false, error: errMsg };
        }
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_FILE_BROWSE - Browse files in an iOS backup via Manifest.db
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_FILE_BROWSE,
    async (_event, options: { backupDir: string; domain?: string }) => {
      return iosService.browseBackupFiles(options.backupDir, options.domain);
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_FILE_EXTRACT - Extract a specific file from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_FILE_EXTRACT,
    async (
      _event,
      options: { backupDir: string; domain: string; relativePath: string; outputPath: string }
    ) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      const progress = (msg: string): void => {
        win?.webContents.send(IPC_CHANNELS.IOS_FILE_EXTRACT_PROGRESS, { type: 'status', data: msg });
      };
      progress(`Extracting ${options.relativePath}...`);
      const result = await iosService.extractBackupFile(
        options.backupDir,
        options.domain,
        options.relativePath,
        options.outputPath
      );
      progress(result.success ? 'Extraction complete.' : `Error: ${result.error}`);
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_MESSAGES_EXTRACT - Extract iMessage/SMS messages from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_MESSAGES_EXTRACT,
    async (_event, options: { backupDir: string; limit?: number; filter?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      const ts = Date.now();
      win?.webContents.send(IPC_CHANNELS.IOS_MESSAGES_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Messages database…', timestamp: ts, percent: 10, message: 'Opening Messages database…',
      });
      const result = await iosService.extractMessages(options.backupDir, {
        limit: options.limit,
        filter: options.filter,
      });
      const msg = result.error ? `Error: ${result.error}` : `Extracted ${result.messages.length} messages`;
      win?.webContents.send(IPC_CHANNELS.IOS_MESSAGES_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg,
        filesCount: result.messages?.length,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_CALLS_EXTRACT - Extract call history from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_CALLS_EXTRACT,
    async (_event, options: { backupDir: string; limit?: number }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_CALLS_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Call History database…', timestamp: Date.now(), percent: 10, message: 'Opening Call History database…',
      });
      const result = await iosService.extractCallHistory(options.backupDir, { limit: options.limit });
      const msg = result.error ? `Error: ${result.error}` : `Extracted ${result.calls.length} calls`;
      win?.webContents.send(IPC_CHANNELS.IOS_CALLS_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg,
        filesCount: result.calls?.length,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_CONTACTS_EXTRACT - Extract contacts from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_CONTACTS_EXTRACT,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_CONTACTS_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Contacts database…', timestamp: Date.now(), percent: 10, message: 'Opening Contacts database…',
      });
      const result = await iosService.extractContacts(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Extracted ${result.contacts.length} contacts`;
      win?.webContents.send(IPC_CHANNELS.IOS_CONTACTS_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg,
        filesCount: result.contacts?.length,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_PHOTOS_EXTRACT - Extract photo/video assets from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_PHOTOS_EXTRACT,
    async (_event, options: { backupDir: string; limit?: number; mediaType?: 'photo' | 'video' | 'all' }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_PHOTOS_EXTRACT_PROGRESS, {
        type: 'status', data: 'Scanning photo library…', timestamp: Date.now(), percent: 10, message: 'Scanning photo library…',
      });
      const result = await iosService.extractPhotos(options.backupDir, {
        limit: options.limit,
        mediaType: options.mediaType,
      });
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.assets.length} assets`;
      win?.webContents.send(IPC_CHANNELS.IOS_PHOTOS_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg,
        filesCount: result.assets?.length,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_PHOTOS_THUMBNAILS - Get thumbnail paths from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_PHOTOS_THUMBNAILS,
    async (_event, options: { backupDir: string }) => {
      return iosService.browseBackupFiles(options.backupDir, 'CameraRollDomain');
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_APP_DATA - List app data from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_APP_DATA,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_APP_DATA_PROGRESS, {
        type: 'status', data: 'Scanning backup file list…', timestamp: Date.now(), percent: 10, message: 'Scanning backup file list…',
      });
      const result = await iosService.browseBackupFiles(options.backupDir);
      const msg = `Found ${result.total} total files`;
      win?.webContents.send(IPC_CHANNELS.IOS_APP_DATA_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_APP_DATA_EXTRACT - Extract app-specific data by bundle ID
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_APP_DATA_EXTRACT,
    async (_event, options: { backupDir: string; bundleId: string; outputPath: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      const msg = `Extracting ${options.bundleId} data…`;
      win?.webContents.send(IPC_CHANNELS.IOS_APP_DATA_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 10, message: msg,
      });
      const result = await iosService.browseBackupFiles(
        options.backupDir,
        `AppDomain-${options.bundleId}`
      );
      const doneMsg = `Found ${result.total} files for ${options.bundleId}`;
      win?.webContents.send(IPC_CHANNELS.IOS_APP_DATA_PROGRESS, {
        type: 'status', data: doneMsg, timestamp: Date.now(), percent: 100, message: doneMsg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_LOCATION_EXTRACT - Extract location history from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_LOCATION_EXTRACT,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_LOCATION_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Location databases…', timestamp: Date.now(), percent: 10, message: 'Opening Location databases…',
      });
      const result = await iosService.extractLocationHistory(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} location records`;
      win?.webContents.send(IPC_CHANNELS.IOS_LOCATION_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_DELETED_RECOVER - Attempt recovery of deleted data from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_DELETED_RECOVER,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_DELETED_RECOVER_PROGRESS, {
        type: 'status', data: 'Scanning databases for deleted records…', timestamp: Date.now(), percent: 10, message: 'Scanning databases for deleted records…',
      });
      const result = await iosService.recoverDeletedData(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} recoverable records`;
      win?.webContents.send(IPC_CHANNELS.IOS_DELETED_RECOVER_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_SAFARI_EXTRACT - Extract Safari history, bookmarks, tabs
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_SAFARI_EXTRACT,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_SAFARI_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Safari history database…', timestamp: Date.now(), percent: 10, message: 'Opening Safari history database…',
      });
      const result = await iosService.extractSafariHistory(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} history entries`;
      win?.webContents.send(IPC_CHANNELS.IOS_SAFARI_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_NOTES_EXTRACT - Extract Notes app data
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_NOTES_EXTRACT,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_NOTES_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Notes database…', timestamp: Date.now(), percent: 10, message: 'Opening Notes database…',
      });
      const result = await iosService.extractNotes(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} notes`;
      win?.webContents.send(IPC_CHANNELS.IOS_NOTES_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_VOICEMAIL_EXTRACT - Extract voicemail entries
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_VOICEMAIL_EXTRACT,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_VOICEMAIL_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening voicemail database…', timestamp: Date.now(), percent: 10, message: 'Opening voicemail database…',
      });
      const result = await iosService.extractVoicemail(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} voicemail entries`;
      win?.webContents.send(IPC_CHANNELS.IOS_VOICEMAIL_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_HEALTH_EXTRACT - Extract health metrics from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_HEALTH_EXTRACT,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_HEALTH_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Health database…', timestamp: Date.now(), percent: 10, message: 'Opening Health database…',
      });
      const result = await iosService.extractHealthData(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} health samples`;
      win?.webContents.send(IPC_CHANNELS.IOS_HEALTH_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_SCREENTIME_EXTRACT - Extract Screen Time usage data
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_SCREENTIME_EXTRACT,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_SCREENTIME_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Screen Time database…', timestamp: Date.now(), percent: 10, message: 'Opening Screen Time database…',
      });
      const result = await iosService.extractScreenTime(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Screen Time data extracted`;
      win?.webContents.send(IPC_CHANNELS.IOS_SCREENTIME_EXTRACT_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_INTELLIGENCE_TIMELINE - Merge all iOS data sources into timeline
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_INTELLIGENCE_TIMELINE,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_INTELLIGENCE_TIMELINE_PROGRESS, {
        type: 'status', data: 'Extracting all iOS data sources…', timestamp: Date.now(), percent: 10, message: 'Extracting all iOS data sources…',
      });
      const result = await iosService.extractActivityTimeline(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} timeline events`;
      win?.webContents.send(IPC_CHANNELS.IOS_INTELLIGENCE_TIMELINE_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_LOCATION_ACCESS - Parse locationd/clients.plist for app access log
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_LOCATION_ACCESS,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_LOCATION_ACCESS_PROGRESS, {
        type: 'status', data: 'Reading location access logs…', timestamp: Date.now(), percent: 10, message: 'Reading location access logs…',
      });
      const result = await iosService.extractLocationAccessLogs(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} app location access entries`;
      win?.webContents.send(IPC_CHANNELS.IOS_LOCATION_ACCESS_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_NETWORK_TRACE - Extract WiFi network history from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_NETWORK_TRACE,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_NETWORK_TRACE_PROGRESS, {
        type: 'status', data: 'Parsing WiFi network history…', timestamp: Date.now(), percent: 10, message: 'Parsing WiFi network history…',
      });
      const result = await iosService.extractNetworkTrace(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} known networks`;
      win?.webContents.send(IPC_CHANNELS.IOS_NETWORK_TRACE_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );
}
