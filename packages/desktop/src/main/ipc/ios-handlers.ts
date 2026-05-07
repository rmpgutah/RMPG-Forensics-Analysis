import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as iosService from '../services/ios-service';
import * as iosDeep from '../services/ios-deep-extract';
import * as iosLive from '../services/ios-live';

/**
 * Normalise the backup-folder field across all iOS handlers. The renderer
 * pages standardised on `backupPath` (`useState('')` → `setBackupPath`)
 * while the handlers were originally typed with `backupDir`. Calling them
 * from the UI was sending `backupPath: "/Users/.../backup"` which got
 * destructured into `backupDir: undefined` — every iOS extractor then
 * silently failed with "file not found in backup".
 *
 * Centralising here so we don't have to remember the alias dance in each
 * handler. Also tolerates `path` as a third alias for older callers.
 */
function resolveBackupDir(options: Record<string, unknown> | undefined): string {
  if (!options) return '';
  const o = options as { backupDir?: unknown; backupPath?: unknown; path?: unknown };
  return String(o.backupDir ?? o.backupPath ?? o.path ?? '');
}

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
      return { ...deviceInfo, ...(diagnostics ?? {}) };
    } catch (err) {
      throw new Error((err instanceof Error ? err.message : String(err)));
    }
  });

  // ---------------------------------------------------------------------------
  // IOS_BACKUP - Create a full iOS backup with progress reporting
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_BACKUP,
    async (event, options: {
      udid?: string;
      outputPath?: string;
      // Acquisition Wizard sends `outputDir` instead of `outputPath`.
      // Accept either; the wizard also doesn't send `udid` because it
      // assumes "the connected device" — auto-resolve from the device
      // list in that case so the wizard's one-click backup works.
      outputDir?: string;
      encrypted?: boolean;
      password?: string;
    }) => {
      let udid = options.udid;
      const outputPath = options.outputPath ?? options.outputDir;
      const encrypted = options.encrypted;
      if (!outputPath) {
        return { success: false, error: 'No output folder selected.' };
      }
      // Resolve UDID lazily when caller didn't supply one — pick the
      // first connected iOS device. iosService.listDevices returns
      // `[{udid, name?, ...}]`; throwing here gives a clear message
      // instead of letting the spawn fail with EBADF / ENODEV.
      if (!udid) {
        try {
          const devices = await iosService.listDevices();
          const first = (devices as Array<{ udid?: string; serial?: string }>)[0];
          udid = first?.udid ?? first?.serial;
        } catch { /* fall through to error below */ }
        if (!udid) {
          return { success: false, error: 'No iOS device connected. Plug a device in and trust this computer.' };
        }
      }
      // Optional encrypted-backup password is set up via idevicebackup2's
      // `encryption on <password>` subcommand before the actual backup runs.
      // We only do this when both `encrypted` and `password` are present
      // so that an existing encrypted backup with a different password
      // isn't silently re-keyed.
      if (encrypted && options.password) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { resolveTool } = require('../services/tool-resolver');
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { runCommand } = require('../services/process-runner');
          const tool = await resolveTool('idevicebackup2');
          if (tool.found) {
            await runCommand(
              tool.path,
              ['-i', '-u', udid, 'encryption', 'on', options.password, outputPath],
              { timeout: 30000 },
            ).catch(() => { /* may already be encrypted; non-fatal */ });
          }
        } catch { /* tooling missing; backup itself will surface the error */ }
      }
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
          const detail = result.stderr?.trim() || result.stdout?.trim() || '';
          const friendly = classifyIdevicebackup2Error(detail, result.exitCode);
          return {
            success: false,
            error: friendly,
            // Preserve the raw output for chain-of-custody / vendor support.
            rawError: detail || `Exit code ${result.exitCode}`,
          };
        }
      } catch (err) {
        return { success: false, error: (err instanceof Error ? err.message : String(err)) };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_FILE_BROWSE - Browse files in an iOS backup via Manifest.db
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_FILE_BROWSE,
    async (_event, options: { backupDir?: string; backupPath?: string; domain?: string }) => {
      return iosService.browseBackupFiles(resolveBackupDir(options), options.domain);
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_FILE_EXTRACT - Extract a specific file from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_FILE_EXTRACT,
    async (
      _event,
      options: { backupDir?: string; backupPath?: string; domain: string; relativePath: string; outputPath: string }
    ) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      const progress = (msg: string): void => {
        win?.webContents.send(IPC_CHANNELS.IOS_FILE_EXTRACT_PROGRESS, { type: 'status', data: msg });
      };
      progress(`Extracting ${options.relativePath}...`);
      const result = await iosService.extractBackupFile(
        resolveBackupDir(options),
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
    async (_event, options: { backupDir?: string; backupPath?: string; limit?: number; filter?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      const ts = Date.now();
      win?.webContents.send(IPC_CHANNELS.IOS_MESSAGES_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Messages database…', timestamp: ts, percent: 10, message: 'Opening Messages database…',
      });
      const result = await iosService.extractMessages(resolveBackupDir(options), {
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
    async (_event, options: { backupDir?: string; backupPath?: string; limit?: number }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_CALLS_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Call History database…', timestamp: Date.now(), percent: 10, message: 'Opening Call History database…',
      });
      const result = await iosService.extractCallHistory(resolveBackupDir(options), { limit: options.limit });
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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_CONTACTS_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Contacts database…', timestamp: Date.now(), percent: 10, message: 'Opening Contacts database…',
      });
      const result = await iosService.extractContacts(resolveBackupDir(options));
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
    async (_event, options: { backupDir?: string; backupPath?: string; outputPath?: string; limit?: number; mediaType?: 'photo' | 'video' | 'all' }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      const send = (msg: string, percent: number, extra?: object) =>
        win?.webContents.send(IPC_CHANNELS.IOS_PHOTOS_EXTRACT_PROGRESS, {
          type: 'status', data: msg, timestamp: Date.now(), percent, message: msg, ...extra,
        });

      send('Scanning photo library…', 10);
      const result = await iosService.extractPhotos(resolveBackupDir(options), {
        limit: options.limit,
        mediaType: options.mediaType,
      });

      // If an output path is provided, copy actual media files out of the backup
      if (options.outputPath && !result.error && result.assets.length > 0) {
        const photosDir = path.join(options.outputPath, 'Photos');
        send(`Copying ${result.assets.length} media files to ${photosDir}…`, 30);
        // Track copy progress with ProgressTracker so the renderer shows
        // smoothed bytes/sec and a real ETA. We don't know totalBytes
        // upfront (would require an N-stat pre-pass), so the tracker
        // computes percent from filesCount and speed/eta from the
        // cumulative bytes the copy callback reports.
        const { ProgressTracker } = await import('../services/progress-tracker');
        const tracker = new ProgressTracker({ totalFiles: result.assets.length });
        const copyResult = await iosService.copyPhotosToFolder(
          resolveBackupDir(options),
          photosDir,
          (done, total, bytes) => {
            const snap = tracker.sample({ filesCount: done, bytes });
            const pct = 30 + (snap.percent * 0.65); // map 0–100% of copy → 30–95% of overall
            send(`Copying media files… ${done}/${total}`, pct, {
              filesCount: snap.filesCount,
              totalFiles: snap.totalFiles,
              bytes: snap.bytes,
              speed: snap.speed,
              eta: snap.eta,
            });
          }
        );
        const msg = copyResult.error
          ? `Metadata: ${result.assets.length} assets · Copy error: ${copyResult.error}`
          : `Copied ${copyResult.copied} media files to Photos/ folder`;
        send(msg, 100, { filesCount: result.assets?.length });
        return { ...result, copied: copyResult.copied, skipped: copyResult.skipped, photosDir };
      }

      const msg = result.error ? `Error: ${result.error}` : `Found ${result.assets.length} assets`;
      send(msg, 100, { filesCount: result.assets?.length });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_PHOTOS_THUMBNAILS - Get thumbnail paths from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_PHOTOS_THUMBNAILS,
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      return iosService.browseBackupFiles(resolveBackupDir(options), 'CameraRollDomain');
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_APP_DATA - List app data from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_APP_DATA,
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_APP_DATA_PROGRESS, {
        type: 'status', data: 'Scanning backup file list…', timestamp: Date.now(), percent: 10, message: 'Scanning backup file list…',
      });
      const result = await iosService.browseBackupFiles(resolveBackupDir(options));
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
    async (_event, options: { backupDir?: string; backupPath?: string; bundleId: string; outputPath: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      const msg = `Extracting ${options.bundleId} data…`;
      win?.webContents.send(IPC_CHANNELS.IOS_APP_DATA_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 10, message: msg,
      });
      const result = await iosService.browseBackupFiles(
        resolveBackupDir(options),
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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_LOCATION_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Location databases…', timestamp: Date.now(), percent: 10, message: 'Opening Location databases…',
      });
      const result = await iosService.extractLocationHistory(resolveBackupDir(options));
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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_DELETED_RECOVER_PROGRESS, {
        type: 'status', data: 'Scanning databases for deleted records…', timestamp: Date.now(), percent: 10, message: 'Scanning databases for deleted records…',
      });
      const result = await iosService.recoverDeletedData(resolveBackupDir(options));
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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_SAFARI_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Safari history database…', timestamp: Date.now(), percent: 10, message: 'Opening Safari history database…',
      });
      const result = await iosService.extractSafariHistory(resolveBackupDir(options));
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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_NOTES_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Notes database…', timestamp: Date.now(), percent: 10, message: 'Opening Notes database…',
      });
      const result = await iosService.extractNotes(resolveBackupDir(options));
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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_VOICEMAIL_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening voicemail database…', timestamp: Date.now(), percent: 10, message: 'Opening voicemail database…',
      });
      const result = await iosService.extractVoicemail(resolveBackupDir(options));
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
    async (_event, options: {
      backupDir?: string;
      backupPath?: string;
      // Export mode — when present, write the data to disk in the requested
      // format instead of returning it. The IosHealthData page reuses this
      // channel for both "load data" and "export data" so the same handler
      // has to do both jobs.
      exportPath?: string;
      exportFormat?: 'csv' | 'json' | 'xml';
      exportCategory?: string;
    }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_HEALTH_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Health database…', timestamp: Date.now(), percent: 10, message: 'Opening Health database…',
      });
      const result = await iosService.extractHealthData(resolveBackupDir(options));

      // Export branch — serialise the chosen category (or all data) and
      // write to disk. We don't gate on result.error so partial data still
      // exports if some queries failed.
      if (options.exportPath && options.exportFormat) {
        try {
          const fsp = await import('fs/promises');
          const samples = (result.samples ?? []) as Array<Record<string, unknown>>;
          const filtered = options.exportCategory && options.exportCategory !== 'all'
            ? samples.filter((s) => String(s.category ?? s.type ?? '').toLowerCase() === options.exportCategory!.toLowerCase())
            : samples;
          let payload: string;
          if (options.exportFormat === 'json') {
            payload = JSON.stringify(filtered, null, 2);
          } else if (options.exportFormat === 'xml') {
            const escape = (v: unknown): string => String(v ?? '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
            const items = filtered.map((row) => {
              const fields = Object.entries(row)
                .map(([k, v]) => `    <${k}>${escape(v)}</${k}>`)
                .join('\n');
              return `  <sample>\n${fields}\n  </sample>`;
            }).join('\n');
            payload = `<?xml version="1.0" encoding="UTF-8"?>\n<healthdata>\n${items}\n</healthdata>\n`;
          } else {
            // CSV with a stable column union across all rows.
            const cols = Array.from(filtered.reduce((set, row) => {
              for (const k of Object.keys(row)) set.add(k);
              return set;
            }, new Set<string>()));
            const escape = (v: unknown): string => {
              const s = String(v ?? '');
              return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            };
            payload = [
              cols.join(','),
              ...filtered.map((row) => cols.map((c) => escape(row[c])).join(',')),
            ].join('\n');
          }
          await fsp.writeFile(options.exportPath, payload, 'utf-8');
          const msg = `Exported ${filtered.length} samples to ${options.exportPath}`;
          win?.webContents.send(IPC_CHANNELS.IOS_HEALTH_EXTRACT_PROGRESS, {
            type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg,
          });
          return { ...result, exported: filtered.length, exportPath: options.exportPath };
        } catch (err) {
          const msg = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
          win?.webContents.send(IPC_CHANNELS.IOS_HEALTH_EXTRACT_PROGRESS, {
            type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg,
          });
          throw err;
        }
      }

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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_SCREENTIME_EXTRACT_PROGRESS, {
        type: 'status', data: 'Opening Screen Time database…', timestamp: Date.now(), percent: 10, message: 'Opening Screen Time database…',
      });
      const result = await iosService.extractScreenTime(resolveBackupDir(options));
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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_INTELLIGENCE_TIMELINE_PROGRESS, {
        type: 'status', data: 'Extracting all iOS data sources…', timestamp: Date.now(), percent: 10, message: 'Extracting all iOS data sources…',
      });
      const result = await iosService.extractActivityTimeline(resolveBackupDir(options));
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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_LOCATION_ACCESS_PROGRESS, {
        type: 'status', data: 'Reading location access logs…', timestamp: Date.now(), percent: 10, message: 'Reading location access logs…',
      });
      const result = await iosService.extractLocationAccessLogs(resolveBackupDir(options));
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
    async (_event, options: { backupDir?: string; backupPath?: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_NETWORK_TRACE_PROGRESS, {
        type: 'status', data: 'Parsing WiFi network history…', timestamp: Date.now(), percent: 10, message: 'Parsing WiFi network history…',
      });
      const result = await iosService.extractNetworkTrace(resolveBackupDir(options));
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} known networks`;
      win?.webContents.send(IPC_CHANNELS.IOS_NETWORK_TRACE_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // -------------------------------------------------------------------------
  // Deep extraction handlers — thin wrappers around ios-deep-extract.
  // All accept the standard `{ backupDir | backupPath }` shape so the
  // resolveBackupDir() alias dance applies. Each returns its records list
  // + a `total` for the renderer's stats card; errors surface in `error`.
  // -------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.IOS_APP_USAGE_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) => {
    return iosDeep.extractAppUsageHistory(resolveBackupDir(options));
  });
  ipcMain.handle(IPC_CHANNELS.IOS_CALENDAR_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) => {
    return iosDeep.extractCalendarEvents(resolveBackupDir(options));
  });
  ipcMain.handle(IPC_CHANNELS.IOS_REMINDERS_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) => {
    return iosDeep.extractReminders(resolveBackupDir(options));
  });
  ipcMain.handle(IPC_CHANNELS.IOS_WALLET_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) => {
    return iosDeep.extractWalletPasses(resolveBackupDir(options));
  });
  ipcMain.handle(IPC_CHANNELS.IOS_CELLULAR_USAGE_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) => {
    return iosDeep.extractCellularUsage(resolveBackupDir(options));
  });
  ipcMain.handle(IPC_CHANNELS.IOS_BLUETOOTH_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) => {
    return iosDeep.extractBluetoothPairings(resolveBackupDir(options));
  });

  // ── Round 2 deep extractors ────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.IOS_WHATSAPP_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) =>
    iosDeep.extractWhatsAppMessages(resolveBackupDir(options)));
  ipcMain.handle(IPC_CHANNELS.IOS_MESSAGE_ATTACHMENTS_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) =>
    iosDeep.extractMessageAttachments(resolveBackupDir(options)));
  ipcMain.handle(IPC_CHANNELS.IOS_APP_INSTALLS_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) =>
    iosDeep.extractAppInstalls(resolveBackupDir(options)));
  ipcMain.handle(IPC_CHANNELS.IOS_KEYBOARD_CACHE_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) =>
    iosDeep.extractKeyboardCache(resolveBackupDir(options)));
  ipcMain.handle(IPC_CHANNELS.IOS_AIRDROP_EXTRACT, async (_e, options: { backupDir?: string; backupPath?: string }) =>
    iosDeep.extractAirDropHistory(resolveBackupDir(options)));

  // ── Live iOS — read connected device directly, no backup required ─────
  ipcMain.handle(IPC_CHANNELS.IOS_LIVE_INFO, async (_e, options: { udid: string }) =>
    iosLive.liveDeviceInfo(options.udid));
  ipcMain.handle(IPC_CHANNELS.IOS_LIVE_DIAGNOSTICS, async (_e, options: { udid: string }) =>
    iosLive.liveDiagnostics(options.udid));
  ipcMain.handle(IPC_CHANNELS.IOS_LIVE_CRASH_REPORTS, async (_e, options: { udid: string; outputDir: string }) =>
    iosLive.pullCrashReports(options));
  ipcMain.handle(IPC_CHANNELS.IOS_LIVE_INSTALLED_APPS, async (_e, options: { udid: string }) => {
    const r = await iosLive.listInstalledApps(options.udid);
    // Recompute total here (the service signature returned a placeholder).
    return { ...r, total: (r as { apps?: unknown[] }).apps?.length ?? 0 };
  });
  ipcMain.handle(IPC_CHANNELS.IOS_LIVE_SYSLOG, async (_e, options: { udid: string; seconds?: number; outputPath?: string }) =>
    iosLive.snapshotSyslog(options));

  // ── Registry-driven generic artefact puller ────────────────────────────
  // List the 20+ forensic file targets the registry knows about; or pull
  // any of them by id from a given backup. The list is static (no IO),
  // so a UI can render it once and cache.
  ipcMain.handle(IPC_CHANNELS.IOS_ARTEFACT_LIST, async () => iosDeep.IOS_FORENSIC_ARTEFACTS);
  ipcMain.handle(IPC_CHANNELS.IOS_ARTEFACT_PULL, async (_e, options: { backupDir?: string; backupPath?: string; artefactId: string; outputDir: string }) =>
    iosDeep.pullForensicArtefact({
      backupDir: resolveBackupDir(options),
      artefactId: options.artefactId,
      outputDir: options.outputDir,
    }));
}

/**
 * Translate raw idevicebackup2 stderr/stdout into a user-actionable message.
 *
 * The libimobiledevice family surfaces the same generic codes for very
 * different real-world causes. Pattern-match the well-known ones; fall
 * through to the raw text otherwise so we never *hide* unfamiliar errors.
 *
 * Add new entries as you encounter them in the field — keeping the raw
 * output (returned separately as `rawError`) preserves forensic fidelity.
 */
function classifyIdevicebackup2Error(stderr: string, exitCode: number): string {
  const s = stderr.toLowerCase();

  // MBErrorDomain/105 is iOS's catch-all when the mobilebackup2 channel
  // tears down before transferring — most often because the user never
  // tapped Trust / entered the passcode within the timeout window.
  if (
    /mberrordomain[\/ ]?105/i.test(stderr) ||
    /insufficient free disk space/i.test(stderr) ||
    /received 0 files from device/i.test(stderr)
  ) {
    if (/waiting for passcode/i.test(stderr) || /trust this computer/i.test(stderr)) {
      return (
        'iOS backup failed: the device was not trusted in time. ' +
        'Unlock the iPhone, tap "Trust" on the prompt, enter the passcode, ' +
        'then click Run backup again. ' +
        '(The underlying MBErrorDomain/105 error from idevicebackup2 is iOS\'s ' +
        'generic catch-all — it is not actually about disk space.)'
      );
    }
    return (
      'iOS backup failed (MBErrorDomain/105). Common causes, in order of likelihood: ' +
      '(1) device was not unlocked / "Trust" was not tapped within ~30 seconds, ' +
      '(2) the destination folder is not writable, ' +
      '(3) actual disk full. Verify the device is unlocked and trusted, then retry.'
    );
  }

  // Lockdownd refused the pairing — usually because the host-side pairing
  // record was deleted or the device was just restored.
  if (/lockdown_e_pairing_failed|invalid_host_id|invalid pair record/i.test(stderr)) {
    return (
      'iOS backup failed: the pairing record between this Mac and the device is missing or invalid. ' +
      'Disconnect and reconnect the iPhone, tap Trust again when prompted, then retry.'
    );
  }

  // Device unplugged mid-backup or USB cable went bad.
  if (/lockdown_e_mux_error|usbmuxd|device disconnected|no device found/i.test(stderr)) {
    return (
      'iOS backup failed: lost connection to the device. ' +
      'Check the USB cable, reconnect the iPhone, and retry. ' +
      'If this happens repeatedly, try a different cable or USB port.'
    );
  }

  // Backup encryption mismatch — device has a backup password set but we
  // didn't supply one, or vice versa.
  if (/backup is encrypted|encrypted backup|set backup password|enable backup encryption/i.test(stderr)) {
    return (
      'iOS backup failed: this device has a backup password configured. ' +
      'Either enable "Encrypted backup" in the Acquisition Wizard and supply the password, ' +
      'or remove the backup password on the device under Settings → General → Transfer or Reset iPhone → Reset → Reset All Settings (advanced).'
    );
  }

  // Device storage low — actually a real iOS-side storage problem.
  if (/insufficient space on device|low disk space on device/i.test(stderr)) {
    return (
      'iOS backup failed: the iPhone itself is low on storage and cannot stage the backup. ' +
      'Free up space on the device (Settings → General → iPhone Storage) and retry.'
    );
  }

  // Fall through — return raw stderr so unknown failure modes are visible.
  return stderr.trim() || `idevicebackup2 exited with code ${exitCode}. Check that the device is unlocked and has trusted this computer.`;
}
