/**
 * Register stub IPC handlers for channels that are used in the renderer
 * but don't yet have full implementations. This prevents "No handler registered"
 * errors and provides informative responses.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { IPC_CHANNELS } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommand } from '../services/process-runner';

const execFileAsync = promisify(execFile);

function stub(channel: string, description: string) {
  if (!ipcMain.listenerCount(channel)) {
    ipcMain.handle(channel, async () => {
      return { success: false, error: `${description}: Not yet implemented on this platform` };
    });
  }
}

export function registerMissingHandlers(): void {
  // ---- Geolocation (working implementation) ----
  ipcMain.handle(IPC_CHANNELS.GEO_EXTRACT, async (_e, options: { source: string; inputPath: string }) => {
    const { source, inputPath } = options;
    if (source === 'exif') {
      // Extract EXIF GPS from images using python/exiftool
      try {
        const result = await runCommand('python3', [
          '-c',
          `import json, subprocess, sys
result = subprocess.run(['mdls', '-name', 'kMDItemLatitude', '-name', 'kMDItemLongitude', sys.argv[1]], capture_output=True, text=True)
lines = result.stdout.strip().split('\\n')
data = {}
for line in lines:
    if '=' in line:
        key, val = line.split('=', 1)
        key = key.strip()
        val = val.strip()
        if val != '(null)':
            data[key] = float(val)
if 'kMDItemLatitude' in data and 'kMDItemLongitude' in data:
    print(json.dumps([{'lat': data['kMDItemLatitude'], 'lon': data['kMDItemLongitude'], 'name': sys.argv[1]}]))
else:
    print('[]')`,
          inputPath,
        ], { timeout: 10000 });
        const points = JSON.parse(result.stdout.trim() || '[]');
        return { success: true, points };
      } catch (err) {
        return { success: false, error: (err as Error).message, points: [] };
      }
    }
    return { success: false, error: `Source "${source}" not yet supported`, points: [] };
  });

  ipcMain.handle(IPC_CHANNELS.GEO_GENERATE_KML || 'geo:generate-kml', async (_e, options: {
    points: { lat: number; lon: number; name?: string }[];
    outputPath: string;
    fileName: string;
  }) => {
    const { points, outputPath, fileName } = options;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${fileName}</name>
${points.map((p, i) => `<Placemark><name>${p.name || `Point ${i + 1}`}</name><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`).join('\n')}
</Document>
</kml>`;
    const filePath = path.join(outputPath, `${fileName}.kml`);
    await fs.writeFile(filePath, kml, 'utf-8');
    return { success: true, path: filePath };
  });

  // ---- SQLite Browser (working implementation) ----
  ipcMain.handle(IPC_CHANNELS.SQLITE_OPEN, async (_e, dbPath: string) => {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      db.close();
      return { success: true, tables: tables.map((t: any) => t.name) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SQLITE_QUERY, async (_e, dbPath: string, query: string) => {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const stmt = db.prepare(query);
      const rows = stmt.all();
      const columns = stmt.columns().map((c: any) => c.name);
      db.close();
      return { success: true, columns, rows };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ---- EXIF Viewer (working implementation) ----
  ipcMain.handle(IPC_CHANNELS.EXIF_READ, async (_e, filePath: string) => {
    try {
      const result = await runCommand('mdls', [filePath], { timeout: 10000 });
      const metadata: Record<string, string> = {};
      for (const line of result.stdout.split('\n')) {
        const match = line.match(/^(\w+)\s+=\s+(.+)$/);
        if (match && match[2] !== '(null)') {
          metadata[match[1]] = match[2].trim();
        }
      }
      return { success: true, metadata };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // ---- Device Mirror (scrcpy) ----
  ipcMain.handle(IPC_CHANNELS.DEVICE_MIRROR_START, async (_e, serial: string, options?: any) => {
    const scrcpy = await resolveTool('scrcpy');
    if (!scrcpy.found) return { success: false, error: 'Scrcpy not found' };
    const args = ['-s', serial];
    if (options?.maxResolution) args.push('--max-size', String(options.maxResolution));
    if (options?.bitRate) args.push('--video-bit-rate', `${options.bitRate}M`);
    if (options?.maxFps) args.push('--max-fps', String(options.maxFps));
    if (options?.borderless) args.push('--window-borderless');
    if (options?.alwaysOnTop) args.push('--always-on-top');
    if (options?.turnScreenOff) args.push('--turn-screen-off');
    try {
      const { spawn } = require('child_process');
      spawn(scrcpy.path, args, { detached: true, stdio: 'ignore' }).unref();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_MIRROR_STOP, async () => {
    try {
      const { execFileSync } = require('child_process');
      execFileSync('pkill', ['-f', 'scrcpy'], { timeout: 5000 });
      return { success: true };
    } catch { return { success: true }; }
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_MIRROR_STATUS, async () => {
    try {
      const { execFileSync } = require('child_process');
      execFileSync('pgrep', ['-f', 'scrcpy'], { timeout: 3000 });
      return { running: true };
    } catch { return { running: false }; }
  });

  // ---- Case operations ----
  ipcMain.handle(IPC_CHANNELS.CASE_SET_PATH, async (_e, casePath: string) => {
    return { success: true, path: casePath };
  });

  ipcMain.handle(IPC_CHANNELS.CASE_DELETE, async (_e, casePath: string) => {
    return { success: false, error: 'Case deletion must be done manually for safety' };
  });

  // ---- Report generation ----
  ipcMain.handle(IPC_CHANNELS.REPORT_GENERATE, async (_e, options: any) => {
    return { success: false, error: 'Report generation not yet implemented' };
  });

  // ---- Stubs for features that need platform tools ----
  stub(IPC_CHANNELS.APK_DOWNGRADE, 'APK Downgrade');
  stub(IPC_CHANNELS.CONTACTS_EXTRACT, 'Contacts Extraction');
  stub(IPC_CHANNELS.SMS_EXTRACT, 'SMS Extraction');
  stub(IPC_CHANNELS.DEVICE_PIN, 'Device PIN');
  stub(IPC_CHANNELS.DEVICE_REBOOT, 'Device Reboot');
  stub(IPC_CHANNELS.FILE_EXPLORE, 'File Explorer');
  stub(IPC_CHANNELS.FILE_PULL, 'File Pull');
  stub(IPC_CHANNELS.FILE_PUSH, 'File Push');
  stub(IPC_CHANNELS.FILE_DELETE, 'File Delete');
  stub(IPC_CHANNELS.IMAGE_SEARCH, 'Image Search');
  stub(IPC_CHANNELS.JADX_DECOMPILE, 'JADX Decompile');
  stub(IPC_CHANNELS.MISC_COLLECT, 'Misc Collections');
  stub(IPC_CHANNELS.MULTI_DEVICE_LIST, 'Multi-Device List');
  stub(IPC_CHANNELS.MULTI_DEVICE_EXECUTE, 'Multi-Device Execute');
  stub(IPC_CHANNELS.MVT_SCAN, 'MVT Scan');
  stub(IPC_CHANNELS.WHATSAPP_MERGE, 'WhatsApp Merge');
  stub(IPC_CHANNELS.WIFI_PAIR, 'WiFi Pair');
  stub(IPC_CHANNELS.WIFI_CONNECT, 'WiFi Connect');
  stub(IPC_CHANNELS.WIFI_DISCONNECT, 'WiFi Disconnect');

  // iOS stubs
  stub(IPC_CHANNELS.IOS_FILE_BROWSE, 'iOS File Browse');
  stub(IPC_CHANNELS.IOS_FILE_EXTRACT, 'iOS File Extract');
  stub(IPC_CHANNELS.IOS_MESSAGES_EXTRACT, 'iOS Messages');
  stub(IPC_CHANNELS.IOS_CALLS_EXTRACT, 'iOS Call History');
  stub(IPC_CHANNELS.IOS_CONTACTS_EXTRACT, 'iOS Contacts');
  stub(IPC_CHANNELS.IOS_PHOTOS_EXTRACT, 'iOS Photos');
  stub(IPC_CHANNELS.IOS_APP_DATA, 'iOS App Data');
  stub(IPC_CHANNELS.IOS_APP_DATA_EXTRACT, 'iOS App Data Extract');
  stub(IPC_CHANNELS.IOS_LOCATION_EXTRACT, 'iOS Location');
  stub(IPC_CHANNELS.IOS_DELETED_RECOVER, 'iOS Deleted Recovery');
}
