/**
 * IPC handlers for all remaining channels — device operations, file ops,
 * extraction helpers, multi-device commands, and report generation.
 *
 * All external processes are invoked via runCommand() (spawn-based),
 * which prevents shell injection and streams output safely.
 */

import { ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import { IPC_CHANNELS } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommand } from '../services/process-runner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function adbPath(): Promise<string> {
  const r = await resolveTool('adb');
  if (!r.found) throw new Error('ADB not found — install Android SDK Platform-Tools');
  return r.path;
}

function parseAdbDevices(output: string): { serial: string; state: string; model?: string }[] {
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const serial = parts[0];
      const state = parts[1] ?? 'unknown';
      const modelPart = line.match(/model:(\S+)/);
      return { serial, state, model: modelPart?.[1] };
    })
    .filter((d) => d.state === 'device' || d.state === 'offline');
}

// ---------------------------------------------------------------------------
// Geo / KML (already working — re-registered here for clarity)
// ---------------------------------------------------------------------------

function registerGeoHandlers(): void {
  if (ipcMain.listenerCount(IPC_CHANNELS.GEO_EXTRACT)) return;

  ipcMain.handle(IPC_CHANNELS.GEO_EXTRACT, async (_e, options: { source: string; inputPath: string }) => {
    const { source, inputPath } = options;
    if (source !== 'exif') return { success: false, error: `Source "${source}" not supported`, points: [] };
    try {
      const script = [
        'import json,subprocess,sys',
        'r=subprocess.run(["mdls","-name","kMDItemLatitude","-name","kMDItemLongitude",sys.argv[1]],capture_output=True,text=True)',
        'd={}',
        '[d.update({k.strip():float(v.strip())}) for l in r.stdout.strip().split("\\n") if "=" in l for k,v in [l.split("=",1)] if v.strip()!="(null)"]',
        'print(json.dumps([{"lat":d["kMDItemLatitude"],"lon":d["kMDItemLongitude"],"name":sys.argv[1]}]) if "kMDItemLatitude" in d else "[]")',
      ].join(';');
      const result = await runCommand('python3', ['-c', script, inputPath], { timeout: 10000 });
      return { success: true, points: JSON.parse(result.stdout.trim() || '[]') };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)), points: [] };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.GEO_GENERATE_KML,
    async (_e, opts: { points: { lat: number; lon: number; name?: string }[]; outputPath: string; fileName: string }) => {
      const { points, outputPath, fileName } = opts;
      const kml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
        `<name>${fileName}</name>`,
        ...points.map(
          (p, i) =>
            `<Placemark><name>${p.name ?? `Point ${i + 1}`}</name><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`
        ),
        '</Document></kml>',
      ].join('\n');
      const filePath = path.join(outputPath, `${fileName}.kml`);
      await fs.writeFile(filePath, kml, 'utf-8');
      return { success: true, path: filePath };
    }
  );
}

// ---------------------------------------------------------------------------
// SQLite Browser
// ---------------------------------------------------------------------------

function registerSqliteHandlers(): void {
  if (ipcMain.listenerCount(IPC_CHANNELS.SQLITE_OPEN)) return;

  // Accepts either a plain string path OR { dbPath } object (renderer sends object)
  ipcMain.handle(IPC_CHANNELS.SQLITE_OPEN, async (_e, arg: string | { dbPath: string }) => {
    const dbPath = typeof arg === 'string' ? arg : arg.dbPath;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const tables: { name: string }[] = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all();
      // Enrich with row count per table
      const enriched = tables.map((t) => {
        try {
          const count = (db.prepare(`SELECT COUNT(*) as n FROM "${t.name.replace(/"/g, '""')}"`).get() as { n: number }).n;
          return { name: t.name, rowCount: count, columns: [] as string[] };
        } catch {
          return { name: t.name, rowCount: 0, columns: [] as string[] };
        }
      });
      db.close();
      return { success: true, tables: enriched };
    } catch (err) {
      return { success: false, message: (err instanceof Error ? err.message : String(err)) };
    }
  });

  // Accepts either positional args OR { dbPath, query } object
  ipcMain.handle(IPC_CHANNELS.SQLITE_QUERY, async (
    _e,
    arg: string | { dbPath: string; query: string },
    secondArg?: string
  ) => {
    const dbPath = typeof arg === 'string' ? arg : arg.dbPath;
    const query  = typeof arg === 'string' ? (secondArg ?? '') : arg.query;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const start = Date.now();
      const stmt = db.prepare(query);
      const rows = stmt.all();
      const columns = stmt.columns().map((c: { name: string }) => c.name);
      const executionTime = Date.now() - start;
      db.close();
      return { success: true, result: { columns, rows, rowCount: rows.length, executionTime } };
    } catch (err) {
      return { success: false, message: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// EXIF Viewer
// ---------------------------------------------------------------------------

function registerExifHandlers(): void {
  if (ipcMain.listenerCount(IPC_CHANNELS.EXIF_READ)) return;

  // Accepts filePath: string OR { path, mode } object (renderer sends object)
  ipcMain.handle(IPC_CHANNELS.EXIF_READ, async (
    _e,
    arg: string | { path: string; mode?: string }
  ) => {
    const target = typeof arg === 'string' ? arg : arg.path;
    const mode   = typeof arg === 'object' ? (arg.mode ?? 'file') : 'file';

    async function readOneFile(filePath: string): Promise<{ success: boolean; data?: { id: string; filename: string; path: string; fields: Record<string, string>; hasThumbnail: boolean; hasGps: boolean }; message?: string }> {
      try {
        const result = await runCommand('mdls', [filePath], { timeout: 10000 });
        const fields: Record<string, string> = {};
        for (const line of result.stdout.split('\n')) {
          const m = line.match(/^(\w+)\s+=\s+(.+)$/);
          if (m && m[2] !== '(null)') fields[m[1]] = m[2].trim();
        }
        return {
          success: true,
          data: {
            id: filePath,
            filename: path.basename(filePath),
            path: filePath,
            fields,
            hasThumbnail: false,
            hasGps: 'kMDItemLatitude' in fields,
          },
        };
      } catch (err) {
        return { success: false, message: (err instanceof Error ? err.message : String(err)) };
      }
    }

    if (mode === 'directory') {
      try {
        const entries = await fs.readdir(target, { withFileTypes: true });
        const imageExts = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.heic', '.heif']);
        const imageFiles = entries
          .filter((e) => e.isFile() && imageExts.has(path.extname(e.name).toLowerCase()))
          .map((e) => path.join(target, e.name));
        const results = await Promise.all(imageFiles.map(readOneFile));
        const data = results.filter((r) => r.success && r.data).map((r) => r.data!);
        return { success: true, data };
      } catch (err) {
        return { success: false, message: (err instanceof Error ? err.message : String(err)) };
      }
    }

    const r = await readOneFile(target);
    return r.success ? { success: true, data: [r.data!] } : { success: false, message: r.message };
  });
}

// ---------------------------------------------------------------------------
// Device Mirror (scrcpy)
// ---------------------------------------------------------------------------

function registerMirrorHandlers(): void {
  if (ipcMain.listenerCount(IPC_CHANNELS.DEVICE_MIRROR_START)) return;

  ipcMain.handle(IPC_CHANNELS.DEVICE_MIRROR_START, async (_e, serial: string, options?: Record<string, unknown>) => {
    const scrcpy = await resolveTool('scrcpy');
    if (!scrcpy.found) return { success: false, error: 'Scrcpy not found — install from https://github.com/Genymobile/scrcpy' };
    const args = ['-s', serial];
    if (options?.maxResolution) args.push('--max-size', String(options.maxResolution));
    if (options?.bitRate) args.push('--video-bit-rate', `${options.bitRate}M`);
    if (options?.maxFps) args.push('--max-fps', String(options.maxFps));
    if (options?.borderless) args.push('--window-borderless');
    if (options?.alwaysOnTop) args.push('--always-on-top');
    if (options?.turnScreenOff) args.push('--turn-screen-off');
    try {
      const { spawn } = await import('child_process');
      spawn(scrcpy.path, args, { detached: true, stdio: 'ignore' }).unref();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_MIRROR_STOP, async () => {
    try {
      await runCommand('pkill', ['-f', 'scrcpy'], { timeout: 5000 });
    } catch { /* already stopped */ }
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_MIRROR_STATUS, async () => {
    try {
      const r = await runCommand('pgrep', ['-f', 'scrcpy'], { timeout: 3000 });
      return { running: r.exitCode === 0 };
    } catch {
      return { running: false };
    }
  });
}

// ---------------------------------------------------------------------------
// Device Operations
// ---------------------------------------------------------------------------

function registerDeviceHandlers(): void {
  // Reboot
  ipcMain.handle(IPC_CHANNELS.DEVICE_REBOOT, async (_e, serial: string, mode?: string) => {
    try {
      const adb = await adbPath();
      const args = ['-s', serial, 'reboot'];
      if (mode === 'recovery' || mode === 'bootloader') args.push(mode);
      const r = await runCommand(adb, args, { timeout: 15000 });
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });

  // Device PIN / lock-screen status
  ipcMain.handle(IPC_CHANNELS.DEVICE_PIN, async (_e, serial: string, action: string, pin?: string) => {
    try {
      const adb = await adbPath();
      if (action === 'clear' && pin) {
        const r = await runCommand(adb, ['-s', serial, 'shell', 'locksettings', 'clear', '--old', pin], { timeout: 10000 });
        return { success: r.exitCode === 0, output: r.stdout, error: r.stderr || undefined };
      }
      if (action === 'status') {
        const r = await runCommand(adb, ['-s', serial, 'shell', 'locksettings', 'get-disabled'], { timeout: 10000 });
        return { success: true, disabled: r.stdout.includes('true'), output: r.stdout };
      }
      return { success: false, error: `Unknown action: ${action}` };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// File Operations
// ---------------------------------------------------------------------------

function registerFileHandlers(): void {
  // List directory
  ipcMain.handle(IPC_CHANNELS.FILE_EXPLORE, async (_e, serial: string, remotePath: string) => {
    try {
      const adb = await adbPath();
      const r = await runCommand(adb, ['-s', serial, 'shell', 'ls', '-la', remotePath], { timeout: 15000 });
      if (r.exitCode !== 0) return { success: false, error: r.stderr };
      const entries = r.stdout
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('total'))
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          const permissions = parts[0] ?? '';
          const size = parts[4] ?? '0';
          const name = parts.slice(8).join(' ');
          return { name, permissions, size, isDir: permissions.startsWith('d') };
        })
        .filter((e) => e.name && e.name !== '.' && e.name !== '..');
      return { success: true, entries };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });

  // Pull file from device
  ipcMain.handle(IPC_CHANNELS.FILE_PULL, async (_e, serial: string, remotePath: string, localDir: string) => {
    try {
      const adb = await adbPath();
      await fs.mkdir(localDir, { recursive: true });
      const r = await runCommand(adb, ['-s', serial, 'pull', remotePath, localDir], { timeout: 120000 });
      if (r.exitCode !== 0) return { success: false, error: r.stderr };
      const fileName = path.basename(remotePath);
      const localPath = path.join(localDir, fileName);
      return { success: true, localPath, output: r.stdout };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });

  // Push file to device
  ipcMain.handle(IPC_CHANNELS.FILE_PUSH, async (_e, serial: string, localPath: string, remotePath: string) => {
    try {
      const adb = await adbPath();
      const r = await runCommand(adb, ['-s', serial, 'push', localPath, remotePath], { timeout: 120000 });
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined, output: r.stdout };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });

  // Delete file/directory on device
  ipcMain.handle(IPC_CHANNELS.FILE_DELETE, async (_e, serial: string, remotePath: string, recursive?: boolean) => {
    try {
      const adb = await adbPath();
      const rmArgs = recursive ? ['-rf'] : ['-f'];
      const r = await runCommand(adb, ['-s', serial, 'shell', 'rm', ...rmArgs, remotePath], { timeout: 30000 });
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// Data Extraction
// ---------------------------------------------------------------------------

function registerExtractionHandlers(): void {
  // Contacts — accepts serial string OR { serial } object
  ipcMain.handle(IPC_CHANNELS.CONTACTS_EXTRACT, async (_e, arg: string | { serial: string }) => {
    const serial = typeof arg === 'string' ? arg : arg.serial;
    try {
      const adb = await adbPath();
      const r = await runCommand(
        adb,
        ['-s', serial, 'shell', 'content', 'query', '--uri', 'content://contacts/phones',
          '--projection', 'display_name:number:type'],
        { timeout: 30000 }
      );
      if (r.exitCode !== 0) return { success: false, error: r.stderr };
      const contacts = r.stdout
        .split('\n')
        .filter((l) => l.includes('Row:'))
        .map((line, idx) => {
          const get = (key: string) => line.match(new RegExp(`${key}=([^,}]+)`))?.[1]?.trim() ?? '';
          return {
            id: String(idx),
            name: get('display_name') || 'Unknown',
            phone: get('number'),
            type: get('type'),
          };
        });
      return contacts; // renderer expects array directly
    } catch (err) {
      return [];
    }
  });

  // SMS — accepts serial string OR { serial } object
  ipcMain.handle(IPC_CHANNELS.SMS_EXTRACT, async (_e, arg: string | { serial: string }) => {
    const serial = typeof arg === 'string' ? arg : arg.serial;
    try {
      const adb = await adbPath();
      const r = await runCommand(
        adb,
        ['-s', serial, 'shell', 'content', 'query', '--uri', 'content://sms',
          '--projection', 'address:body:date:type:read'],
        { timeout: 60000 }
      );
      if (r.exitCode !== 0) return [];
      const messages = r.stdout
        .split('\n')
        .filter((l) => l.includes('Row:'))
        .map((line, idx) => {
          const get = (key: string) => line.match(new RegExp(`${key}=([^,}]+)`))?.[1]?.trim() ?? '';
          return {
            id: String(idx),
            address: get('address'),
            body: get('body'),
            date: get('date') ? new Date(Number(get('date'))).toISOString() : '',
            type: get('type') === '1' ? 'received' : ('sent' as 'received' | 'sent'),
            read: get('read') === '1',
          };
        });
      return messages; // renderer expects array directly
    } catch (err) {
      return [];
    }
  });

  // APK downgrade install
  ipcMain.handle(IPC_CHANNELS.APK_DOWNGRADE, async (_e, serial: string, apkPath: string) => {
    try {
      const adb = await adbPath();
      const r = await runCommand(
        adb,
        ['-s', serial, 'install', '-r', '--allow-version-downgrade', apkPath],
        { timeout: 120000 }
      );
      const success = r.stdout.includes('Success') || r.exitCode === 0;
      return { success, output: r.stdout, error: success ? undefined : r.stderr };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });

  // Misc data collection (call log, calendar, browser history)
  ipcMain.handle(IPC_CHANNELS.MISC_COLLECT, async (_e, serial: string, types: string[]) => {
    try {
      const adb = await adbPath();
      const results: Record<string, unknown> = {};

      if (types.includes('call_log')) {
        const r = await runCommand(adb, ['-s', serial, 'shell', 'content', 'query',
          '--uri', 'content://call_log/calls',
          '--projection', 'number:duration:date:type:name'], { timeout: 30000 });
        results.callLog = r.stdout.split('\n').filter((l) => l.includes('Row:')).map((line) => {
          const get = (key: string) => line.match(new RegExp(`${key}=([^,}]+)`))?.[1]?.trim() ?? '';
          return { number: get('number'), duration: get('duration'), date: get('date'), type: get('type'), name: get('name') };
        });
      }

      if (types.includes('calendar')) {
        const r = await runCommand(adb, ['-s', serial, 'shell', 'content', 'query',
          '--uri', 'content://com.android.calendar/events',
          '--projection', 'title:dtstart:dtend:description:eventLocation'], { timeout: 30000 });
        results.calendar = r.stdout.split('\n').filter((l) => l.includes('Row:')).map((line) => {
          const get = (key: string) => line.match(new RegExp(`${key}=([^,}]+)`))?.[1]?.trim() ?? '';
          return { title: get('title'), start: get('dtstart'), end: get('dtend'), description: get('description'), location: get('eventLocation') };
        });
      }

      if (types.includes('settings')) {
        const r = await runCommand(adb, ['-s', serial, 'shell', 'settings', 'list', 'global'], { timeout: 10000 });
        const settings: Record<string, string> = {};
        r.stdout.split('\n').forEach((line) => {
          const [k, v] = line.split('=');
          if (k && v !== undefined) settings[k.trim()] = v.trim();
        });
        results.settings = settings;
      }

      return { success: true, data: results };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// WiFi / ADB over TCP
// ---------------------------------------------------------------------------

function registerWifiHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WIFI_PAIR, async (_e, ipPort: string, pairingCode: string) => {
    try {
      const adb = await adbPath();
      const r = await runCommand(adb, ['pair', ipPort, pairingCode], { timeout: 30000 });
      const success = r.stdout.toLowerCase().includes('successfully') || r.exitCode === 0;
      return { success, output: r.stdout, error: success ? undefined : r.stderr };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WIFI_CONNECT, async (_e, ipPort: string) => {
    try {
      const adb = await adbPath();
      const r = await runCommand(adb, ['connect', ipPort], { timeout: 15000 });
      const success = r.stdout.toLowerCase().includes('connected') || r.exitCode === 0;
      return { success, output: r.stdout, error: success ? undefined : r.stderr };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WIFI_DISCONNECT, async (_e, ipPort?: string) => {
    try {
      const adb = await adbPath();
      const args = ipPort ? ['disconnect', ipPort] : ['disconnect'];
      const r = await runCommand(adb, args, { timeout: 10000 });
      return { success: r.exitCode === 0, output: r.stdout };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// APK Analysis (JADX)
// ---------------------------------------------------------------------------

function registerJadxHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.JADX_DECOMPILE, async (_e, apkPath: string, outputDir: string) => {
    try {
      const jadx = await resolveTool('jadx');
      if (!jadx.found) return { success: false, error: 'JADX not found — install from https://github.com/skylot/jadx' };
      await fs.mkdir(outputDir, { recursive: true });
      const r = await runCommand(jadx.path, ['--output-dir', outputDir, apkPath], { timeout: 300000 });
      if (r.exitCode !== 0) return { success: false, error: r.stderr };
      return { success: true, outputDir, output: r.stdout };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// MVT (Mobile Verification Toolkit)
// ---------------------------------------------------------------------------

function registerMvtHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MVT_SCAN, async (_e, options: { type: 'ios' | 'android'; backupPath?: string; serial?: string; outputDir: string }) => {
    try {
      const { type, backupPath, serial, outputDir } = options;
      await fs.mkdir(outputDir, { recursive: true });
      const r = type === 'ios' && backupPath
        ? await runCommand('mvt-ios', ['check-backup', '--output', outputDir, backupPath], { timeout: 600000 })
        : await runCommand('mvt-android', ['check-adb', '--output', outputDir, ...(serial ? ['-s', serial] : [])], { timeout: 600000 });
      return { success: r.exitCode === 0, output: r.stdout, error: r.exitCode !== 0 ? r.stderr : undefined };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// Image Search
// ---------------------------------------------------------------------------

async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function registerImageSearchHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.IMAGE_SEARCH, async (_e, options: {
    rootDir: string;
    query?: string;
    hashList?: string[];
    extensions?: string[];
    nearLat?: number;
    nearLon?: number;
    radiusKm?: number;
  }) => {
    try {
      const { rootDir, hashList, extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'] } = options;
      const found: { path: string; hash: string; size: number }[] = [];

      async function walk(dir: string): Promise<void> {
        let entries: import('fs').Dirent[];
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            await walk(full);
          } else if (extensions.includes(path.extname(e.name).toLowerCase())) {
            const hash = await hashFile(full);
            const stat = await fs.stat(full).catch(() => ({ size: 0 }));
            if (!hashList || hashList.includes(hash)) {
              found.push({ path: full, hash, size: stat.size });
            }
          }
        }
      }

      await walk(rootDir);
      return { success: true, results: found, count: found.length };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// Multi-Device Operations
// ---------------------------------------------------------------------------

function registerMultiDeviceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MULTI_DEVICE_LIST, async () => {
    try {
      const adb = await adbPath();
      const r = await runCommand(adb, ['devices', '-l'], { timeout: 10000 });
      return { success: true, devices: parseAdbDevices(r.stdout) };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MULTI_DEVICE_EXECUTE, async (_e, serials: string[], command: string[]) => {
    try {
      const adb = await adbPath();
      const results = await Promise.all(
        serials.map(async (serial) => {
          const r = await runCommand(adb, ['-s', serial, 'shell', ...command], { timeout: 60000 });
          return { serial, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
        })
      );
      return { success: true, results };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// WhatsApp DB Merge
// ---------------------------------------------------------------------------

function registerWhatsAppMergeHandler(): void {
  ipcMain.handle(IPC_CHANNELS.WHATSAPP_MERGE, async (_e, primaryDb: string, secondaryDb: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const primary = new Database(primaryDb);
      primary.prepare(`ATTACH DATABASE ? AS secondary`).run(secondaryDb);

      const tables: { name: string }[] = primary
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();

      let merged = 0;
      primary.transaction(() => {
        for (const { name } of tables) {
          try {
            const cols: { name: string }[] = primary.prepare(`PRAGMA table_info(${name})`).all();
            const colNames = cols.map((c) => c.name).join(', ');
            const info = primary.prepare(`INSERT OR IGNORE INTO ${name} (${colNames}) SELECT ${colNames} FROM secondary.${name}`).run();
            merged += info.changes;
          } catch { /* table may not exist in secondary — skip */ }
        }
      })();

      primary.prepare('DETACH DATABASE secondary').run();
      primary.close();
      return { success: true, rowsMerged: merged };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// Case Management
// ---------------------------------------------------------------------------

function registerCaseHandlers(): void {
  if (ipcMain.listenerCount(IPC_CHANNELS.CASE_SET_PATH)) return;

  ipcMain.handle(IPC_CHANNELS.CASE_SET_PATH, async (_e, casePath: string) => {
    return { success: true, path: casePath };
  });

  ipcMain.handle(IPC_CHANNELS.CASE_DELETE, async (_e, casePath: string) => {
    try {
      await fs.stat(casePath); // verify exists
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Delete', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Delete Case',
        message: 'Permanently delete this case folder?',
        detail: casePath,
      });
      if (response !== 0) return { success: false, cancelled: true };
      await fs.rm(casePath, { recursive: true, force: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

function registerReportHandlers(): void {
  if (ipcMain.listenerCount(IPC_CHANNELS.REPORT_GENERATE)) return;

  ipcMain.handle(IPC_CHANNELS.REPORT_GENERATE, async (_e, options: {
    title: string;
    sections: { heading: string; content: string }[];
    outputDir: string;
    fileName?: string;
  }) => {
    try {
      const { title, sections, outputDir, fileName = 'report' } = options;
      await fs.mkdir(outputDir, { recursive: true });
      const body = sections
        .map((s) => `<section><h2>${s.heading}</h2><div>${s.content}</div></section>`)
        .join('\n');
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body{font-family:system-ui,sans-serif;margin:2rem;color:#222}
    h1{border-bottom:2px solid #333;padding-bottom:.5rem}
    h2{color:#444;margin-top:2rem}
    section{margin-bottom:2rem}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #ccc;padding:.4rem .8rem;text-align:left}
    th{background:#f5f5f5}
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Generated: ${new Date().toISOString()} — RMPG Forensics Analysis</p>
  ${body}
</body>
</html>`;
      const filePath = path.join(outputDir, `${fileName}.html`);
      await fs.writeFile(filePath, html, 'utf-8');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// Main registration entry point
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// File Write Helper
// ---------------------------------------------------------------------------

function registerFileWriteHandler(): void {
  if (ipcMain.listenerCount(IPC_CHANNELS.FILE_WRITE)) return;
  const channel = IPC_CHANNELS.FILE_WRITE;
  ipcMain.handle(channel, async (_e, filePath: string, content: string) => {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

// ---------------------------------------------------------------------------
// Auth Trust Device
// ---------------------------------------------------------------------------

function registerAuthExtras(): void {
  const channel = IPC_CHANNELS.AUTH_TRUST_DEVICE;
  if (ipcMain.listenerCount(channel)) return;
  ipcMain.handle(channel, async () => {
    // No-op: trust state is managed client-side in localStorage.
    return { success: true };
  });
}

// ---------------------------------------------------------------------------
// Main registration entry point
// ---------------------------------------------------------------------------

export function registerMissingHandlers(): void {
  registerGeoHandlers();
  registerSqliteHandlers();
  registerExifHandlers();
  registerMirrorHandlers();
  registerDeviceHandlers();
  registerFileHandlers();
  registerExtractionHandlers();
  registerWifiHandlers();
  registerJadxHandlers();
  registerMvtHandlers();
  registerImageSearchHandlers();
  registerMultiDeviceHandlers();
  registerWhatsAppMergeHandler();
  registerCaseHandlers();
  registerReportHandlers();
  registerFileWriteHandler();
  // NOTE: AUTH_TRUST_DEVICE is already registered in auth-handlers.ts.
  // Do NOT call registerAuthExtras() here — duplicate ipcMain.handle() calls
  // throw "Attempted to register a second handler" and crash the main process.
}
