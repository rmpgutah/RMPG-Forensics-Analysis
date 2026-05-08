/**
 * IPC handlers for all remaining channels — device operations, file ops,
 * extraction helpers, multi-device commands, and report generation.
 *
 * All external processes are invoked via runCommand() (spawn-based),
 * which prevents shell injection and streams output safely.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import { IPC_CHANNELS } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommand } from '../services/process-runner';
import { buildAcquisitionReport } from '../services/acquisition-report';
// Static imports — runtime `require('../services/...')` breaks inside
// the asar bundle because the relative path layout doesn't exist after
// vite/esbuild bundles the main process. Prefer top-level imports.
import { readImageExif, isImageFile, haversineKm } from '../services/image-exif';
import * as forensicOutput from '../services/forensic-output';

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

  // GEO_EXTRACT — the GeolocationMapper page invokes this with one of four
  // source types. Each branch returns a flat GeoPoint[] (the renderer reads
  // result.length, not result.points); empty array means "no data found".
  ipcMain.handle(IPC_CHANNELS.GEO_EXTRACT, async (_e, options: {
    source: 'device' | 'images' | 'database' | 'csv';
    serial?: string;
    filePath?: string;
  }) => {
    interface GeoPoint {
      latitude: number;
      longitude: number;
      altitude?: number;
      timestamp?: string;
      source: string;
      label?: string;
    }
    const points: GeoPoint[] = [];

    try {
      switch (options.source) {
        case 'device': {
          if (!options.serial) throw new Error('No device selected.');
          const adb = await adbPath();
          // dumpsys location includes a "Last Known Locations" block with
          // one line per provider: gps: Location[gps 37.42,-122.08 ... ]
          const r = await runCommand(
            adb,
            ['-s', options.serial, 'shell', 'dumpsys', 'location'],
            { timeout: 15000 }
          );
          if (r.exitCode !== 0) throw new Error(r.stderr.trim() || 'adb dumpsys failed');
          const re = /Location\[(\w+)\s+([-\d.]+),\s*([-\d.]+)(?:[^\]]*alt=([-\d.]+))?[^\]]*\]/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(r.stdout)) !== null) {
            const [, provider, latStr, lonStr, altStr] = m;
            const lat = Number(latStr);
            const lon = Number(lonStr);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            points.push({
              latitude: lat,
              longitude: lon,
              altitude: altStr ? Number(altStr) : undefined,
              source: `device:${provider}`,
              label: `Last known (${provider})`,
            });
          }
          break;
        }

        case 'images': {
          if (!options.filePath) throw new Error('No image file or folder selected.');
          const targets: string[] = [];
          const stat = await fs.stat(options.filePath).catch(() => null);
          if (!stat) throw new Error(`Path not found: ${options.filePath}`);
          if (stat.isDirectory()) {
            async function walk(dir: string): Promise<void> {
              const entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as import('fs').Dirent[];
              for (const e of entries) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) await walk(full);
                else if (isImageFile(full)) targets.push(full);
              }
            }
            await walk(options.filePath);
          } else if (isImageFile(options.filePath)) {
            targets.push(options.filePath);
          }
          for (const file of targets) {
            const exif = await readImageExif(file);
            if (exif.latitude == null || exif.longitude == null) continue;
            points.push({
              latitude: exif.latitude,
              longitude: exif.longitude,
              altitude: exif.altitude,
              timestamp: exif.dateTaken,
              source: 'image:exif',
              label: path.basename(file),
            });
          }
          break;
        }

        case 'database': {
          if (!options.filePath) throw new Error('No database file selected.');
          // Open SQLite read-only and scan tables for lat/lon-shaped columns.
          // Forensic SQLite databases (Maps, Photos, third-party apps) almost
          // always name them latitude/longitude or lat/lon.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Database = require('better-sqlite3');
          const db = new Database(options.filePath, { readonly: true });
          try {
            const tables = db
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
              .all() as { name: string }[];
            for (const { name } of tables) {
              const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[];
              const colNames = cols.map((c) => c.name);
              const latCol = colNames.find((c) => /^(latitude|lat)$/i.test(c));
              const lonCol = colNames.find((c) => /^(longitude|lon|lng|long)$/i.test(c));
              if (!latCol || !lonCol) continue;
              const altCol = colNames.find((c) => /^(altitude|alt|elevation)$/i.test(c));
              const tsCol = colNames.find((c) => /(timestamp|date|time|created)/i.test(c));
              const select = [latCol, lonCol, altCol, tsCol].filter(Boolean).map((c) => `"${c}"`).join(', ');
              const rows = db.prepare(`SELECT ${select} FROM "${name}" WHERE "${latCol}" IS NOT NULL AND "${lonCol}" IS NOT NULL LIMIT 5000`).all() as Record<string, unknown>[];
              for (const row of rows) {
                const lat = Number(row[latCol]);
                const lon = Number(row[lonCol]);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                const altRaw = altCol ? row[altCol] : undefined;
                const tsRaw = tsCol ? row[tsCol] : undefined;
                points.push({
                  latitude: lat,
                  longitude: lon,
                  altitude: altRaw != null && Number.isFinite(Number(altRaw)) ? Number(altRaw) : undefined,
                  timestamp: tsRaw != null ? String(tsRaw) : undefined,
                  source: `database:${name}`,
                  label: name,
                });
              }
            }
          } finally {
            db.close();
          }
          break;
        }

        case 'csv': {
          if (!options.filePath) throw new Error('No CSV file selected.');
          const raw = await fs.readFile(options.filePath, 'utf-8');
          const lines = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
          if (lines.length < 2) throw new Error('CSV is empty or has no data rows.');
          const delim = (() => {
            const head = lines[0];
            if (head.includes('\t')) return '\t';
            if (head.includes(';') && !head.includes(',')) return ';';
            return ',';
          })();
          const header = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
          const latIdx = header.findIndex((h) => /^(latitude|lat)$/.test(h));
          const lonIdx = header.findIndex((h) => /^(longitude|lon|lng|long)$/.test(h));
          if (latIdx < 0 || lonIdx < 0) {
            throw new Error('CSV needs lat/lon columns (e.g. "latitude,longitude").');
          }
          const altIdx = header.findIndex((h) => /^(altitude|alt|elevation)$/.test(h));
          const tsIdx = header.findIndex((h) => /^(timestamp|date|time)$/.test(h));
          const labelIdx = header.findIndex((h) => /^(name|label|title|address)$/.test(h));
          for (let i = 1; i < lines.length; i++) {
            const cells = lines[i].split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
            const lat = Number(cells[latIdx]);
            const lon = Number(cells[lonIdx]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            points.push({
              latitude: lat,
              longitude: lon,
              altitude: altIdx >= 0 && Number.isFinite(Number(cells[altIdx])) ? Number(cells[altIdx]) : undefined,
              timestamp: tsIdx >= 0 ? cells[tsIdx] : undefined,
              source: 'csv',
              label: labelIdx >= 0 ? cells[labelIdx] : `Row ${i}`,
            });
          }
          break;
        }
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }

    return points;
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

  ipcMain.handle(IPC_CHANNELS.DEVICE_MIRROR_START, async (_e, ...rawArgs: unknown[]) => {
    // DeviceMirror page sends a single object containing `serial`, `maxSize`,
    // `bitRate` (Mbps as integer), `maxFps`, plus boolean toggles. Legacy
    // callers used positional `(serial, options)`. Field names also drift —
    // accept `maxSize` and `maxResolution` as aliases.
    let serial: string;
    let opts: Record<string, unknown>;
    if (rawArgs.length === 1 && typeof rawArgs[0] === 'object' && rawArgs[0] !== null) {
      const o = rawArgs[0] as Record<string, unknown> & { serial?: string };
      serial = (o.serial as string) ?? '';
      opts = o;
    } else {
      [serial, opts] = rawArgs as [string, Record<string, unknown>];
      opts = opts ?? {};
    }
    if (!serial) return { success: false, message: 'No device selected.' };
    const scrcpy = await resolveTool('scrcpy');
    if (!scrcpy.found) return { success: false, message: 'Scrcpy not found — install from https://github.com/Genymobile/scrcpy' };
    const args = ['-s', serial];
    const maxSize = opts.maxSize ?? opts.maxResolution;
    if (maxSize) args.push('--max-size', String(maxSize));
    if (opts.bitRate) {
      // Renderer sends bitRate either as plain Mbps int or already-multiplied
      // bits. If the value is "absurdly high" treat it as bps; else as Mbps.
      const br = Number(opts.bitRate);
      args.push('--video-bit-rate', br >= 1_000_000 ? String(br) : `${br}M`);
    }
    if (opts.maxFps) args.push('--max-fps', String(opts.maxFps));
    if (opts.borderless) args.push('--window-borderless');
    if (opts.alwaysOnTop) args.push('--always-on-top');
    if (opts.turnScreenOff) args.push('--turn-screen-off');
    try {
      const { spawn } = await import('child_process');
      spawn(scrcpy.path, args, { detached: true, stdio: 'ignore' }).unref();
      return { success: true, message: 'Mirror started.' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
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
  ipcMain.handle(IPC_CHANNELS.DEVICE_REBOOT, async (_e, ...args: unknown[]) => {
    // DeviceReboot page sends `{serial, mode}`; legacy callers used
    // positional `(serial, mode)`. Accept both. Renderer reads `message`
    // not `error` — emit the latter as both for backward compat.
    let serial: string;
    let mode: string | undefined;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { serial: string; mode?: string };
      serial = o.serial;
      mode = o.mode;
    } else {
      [serial, mode] = args as [string, string | undefined];
    }
    if (!serial) return { success: false, message: 'No device selected.' };
    try {
      const adb = await adbPath();
      const adbArgs = ['-s', serial, 'reboot'];
      if (mode === 'recovery' || mode === 'bootloader') adbArgs.push(mode);
      const r = await runCommand(adb, adbArgs, { timeout: 15000 });
      if (r.exitCode !== 0) {
        const msg = r.stderr.trim() || `adb reboot exit ${r.exitCode}`;
        return { success: false, message: msg, error: msg };
      }
      return { success: true, message: `Rebooted to ${mode ?? 'system'}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg, error: msg };
    }
  });

  // Device PIN / lock-screen status
  ipcMain.handle(IPC_CHANNELS.DEVICE_PIN, async (_e, ...args: unknown[]) => {
    // DeviceReboot page sends `{serial, action, pin?}`.
    let serial: string;
    let action: string;
    let pin: string | undefined;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { serial: string; action: string; pin?: string };
      serial = o.serial;
      action = o.action;
      pin = o.pin;
    } else {
      [serial, action, pin] = args as [string, string, string | undefined];
    }
    if (!serial) return { success: false, message: 'No device selected.' };
    try {
      const adb = await adbPath();
      if (action === 'clear' && pin) {
        const r = await runCommand(adb, ['-s', serial, 'shell', 'locksettings', 'clear', '--old', pin], { timeout: 10000 });
        const msg = r.exitCode === 0 ? 'PIN cleared.' : (r.stderr.trim() || `exit ${r.exitCode}`);
        return { success: r.exitCode === 0, message: msg, output: r.stdout };
      }
      if (action === 'add' && pin) {
        const r = await runCommand(adb, ['-s', serial, 'shell', 'locksettings', 'set-pin', pin], { timeout: 10000 });
        const msg = r.exitCode === 0 ? 'PIN set.' : (r.stderr.trim() || `exit ${r.exitCode}`);
        return { success: r.exitCode === 0, message: msg, output: r.stdout };
      }
      if (action === 'status') {
        const r = await runCommand(adb, ['-s', serial, 'shell', 'locksettings', 'get-disabled'], { timeout: 10000 });
        return { success: true, message: r.stdout.includes('true') ? 'Lock disabled' : 'Lock active', disabled: r.stdout.includes('true') };
      }
      return { success: false, message: `Unknown action: ${action}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg, error: msg };
    }
  });
}

// ---------------------------------------------------------------------------
// File Operations
// ---------------------------------------------------------------------------

function registerFileHandlers(): void {
  // List directory
  // FILE_EXPLORE — list device files. The DeviceExplorer page sends
  // `{serial, path}` as a single object and reads the result as a bare
  // FileEntry[]. Older callers used positional `(serial, remotePath)`.
  // Accept both; throw on adb failure so the renderer's catch block
  // handles it (returning a `{success:false, error}` object made the
  // page crash later with "entries is not iterable" because it spread
  // the object as an array).
  ipcMain.handle(IPC_CHANNELS.FILE_EXPLORE, async (_e, ...args: unknown[]) => {
    let serial: string;
    let remotePath: string;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { serial: string; path?: string; remotePath?: string };
      serial = o.serial;
      remotePath = (o.path ?? o.remotePath) as string;
    } else {
      [serial, remotePath] = args as [string, string];
    }
    if (!serial) throw new Error('No device selected.');
    if (!remotePath) throw new Error('No path provided.');
    const adb = await adbPath();
    const r = await runCommand(adb, ['-s', serial, 'shell', 'ls', '-la', remotePath], { timeout: 15000 });
    if (r.exitCode !== 0) {
      throw new Error(`adb ls failed: ${r.stderr.trim() || `exit ${r.exitCode}`}`);
    }
    return r.stdout
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('total'))
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        const permissions = parts[0] ?? '';
        const sizeStr = parts[4] ?? '0';
        const name = parts.slice(8).join(' ');
        const isDir = permissions.startsWith('d');
        // FileEntry shape the renderer expects — `type` not `isDir`,
        // `size` as number for sorting, plus mtime where available.
        return {
          name,
          permissions,
          size: Number(sizeStr) || 0,
          type: isDir ? 'directory' : 'file',
          isDir,
          mtime: parts.slice(5, 8).join(' '),
        };
      })
      .filter((e) => e.name && e.name !== '.' && e.name !== '..');
  });

  // Pull file from device. Accepts both shapes; throws on failure.
  ipcMain.handle(IPC_CHANNELS.FILE_PULL, async (_e, ...args: unknown[]) => {
    let serial: string;
    let remotePath: string;
    let localDir: string;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { serial: string; remotePath?: string; path?: string; localDir?: string; localPath?: string; outputPath?: string };
      serial = o.serial;
      remotePath = (o.remotePath ?? o.path) as string;
      localDir = (o.localDir ?? o.localPath ?? o.outputPath) as string;
    } else {
      [serial, remotePath, localDir] = args as [string, string, string];
    }
    if (!serial || !remotePath || !localDir) {
      throw new Error('FILE_PULL requires serial, remotePath, and localDir.');
    }
    const adb = await adbPath();
    await fs.mkdir(localDir, { recursive: true });
    const r = await runCommand(adb, ['-s', serial, 'pull', remotePath, localDir], { timeout: 120000 });
    if (r.exitCode !== 0) throw new Error(`adb pull failed: ${r.stderr.trim()}`);
    const fileName = path.basename(remotePath);
    const localPath = path.join(localDir, fileName);
    return { success: true, localPath, output: r.stdout };
  });

  // Push file to device. Accepts both shapes; throws on failure.
  ipcMain.handle(IPC_CHANNELS.FILE_PUSH, async (_e, ...args: unknown[]) => {
    let serial: string;
    let localPath: string;
    let remotePath: string;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { serial: string; localPath: string; remotePath: string };
      serial = o.serial;
      localPath = o.localPath;
      remotePath = o.remotePath;
    } else {
      [serial, localPath, remotePath] = args as [string, string, string];
    }
    if (!serial || !localPath || !remotePath) {
      throw new Error('FILE_PUSH requires serial, localPath, and remotePath.');
    }
    const adb = await adbPath();
    const r = await runCommand(adb, ['-s', serial, 'push', localPath, remotePath], { timeout: 120000 });
    if (r.exitCode !== 0) throw new Error(`adb push failed: ${r.stderr.trim()}`);
    return { success: true, output: r.stdout };
  });

  // Delete on device. Accepts both shapes; throws on failure.
  ipcMain.handle(IPC_CHANNELS.FILE_DELETE, async (_e, ...args: unknown[]) => {
    let serial: string;
    let remotePath: string;
    let recursive: boolean | undefined;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { serial: string; path?: string; remotePath?: string; recursive?: boolean };
      serial = o.serial;
      remotePath = (o.path ?? o.remotePath) as string;
      recursive = o.recursive;
    } else {
      [serial, remotePath, recursive] = args as [string, string, boolean | undefined];
    }
    if (!serial || !remotePath) {
      throw new Error('FILE_DELETE requires serial and remotePath.');
    }
    const adb = await adbPath();
    const rmArgs = recursive ? ['-rf'] : ['-f'];
    const r = await runCommand(adb, ['-s', serial, 'shell', 'rm', ...rmArgs, remotePath], { timeout: 30000 });
    if (r.exitCode !== 0) throw new Error(`adb rm failed: ${r.stderr.trim()}`);
    return { success: true };
  });
}

// ---------------------------------------------------------------------------
// Data Extraction
// ---------------------------------------------------------------------------

function registerExtractionHandlers(): void {
  // Contacts — accepts serial string OR { serial } object
  // CONTACTS_EXTRACT — renderer expects a Contact[] back, with thrown
  // errors surfaced to its catch block. Previously this returned a
  // {success:false, error} object on adb failure (renderer crashed
  // iterating it as an array) or an empty array (silent failure that
  // looked like "no contacts on device"). Now: throw on real failures,
  // return empty array only when the device actually has no contacts.
  ipcMain.handle(IPC_CHANNELS.CONTACTS_EXTRACT, async (_e, arg: string | { serial: string }) => {
    const serial = typeof arg === 'string' ? arg : arg.serial;
    if (!serial) throw new Error('No device selected.');
    const adb = await adbPath();
    const r = await runCommand(
      adb,
      ['-s', serial, 'shell', 'content', 'query', '--uri', 'content://contacts/phones',
        '--projection', 'display_name:number:type'],
      { timeout: 30000 }
    );
    if (r.exitCode !== 0) {
      throw new Error(`adb content query failed: ${r.stderr.trim() || `exit ${r.exitCode}`}`);
    }
    return r.stdout
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
  });

  // SMS_EXTRACT — same fix: surface adb errors instead of swallowing.
  ipcMain.handle(IPC_CHANNELS.SMS_EXTRACT, async (_e, arg: string | { serial: string }) => {
    const serial = typeof arg === 'string' ? arg : arg.serial;
    if (!serial) throw new Error('No device selected.');
    const adb = await adbPath();
    const r = await runCommand(
      adb,
      ['-s', serial, 'shell', 'content', 'query', '--uri', 'content://sms',
        '--projection', 'address:body:date:type:read'],
      { timeout: 60000 }
    );
    if (r.exitCode !== 0) {
      throw new Error(`adb content query failed: ${r.stderr.trim() || `exit ${r.exitCode}`}`);
    }
    return r.stdout
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
  });

  // APK_DOWNGRADE — accepts BOTH:
  //  - Renderer (ApkDowngrade page): { serial, apps:[{packageName,...}], androidVersion }
  //    → for each app, dump current APK from device and re-install with
  //      --allow-version-downgrade. This covers the real-world forensic
  //      use case ("re-install older signing of installed app to read its
  //      data without app-side migration").
  //  - Legacy: (serial, apkPath) → install a single .apk at the given path.
  //
  // Note: this does NOT fetch older APK versions from a third-party source
  // (APKMirror, etc) — that would need a per-app version database. For
  // re-installing a known APK file path use the legacy form.
  ipcMain.handle(IPC_CHANNELS.APK_DOWNGRADE, async (_event, ...args: unknown[]) => {
    const win = BrowserWindow.getAllWindows()[0] ?? null;
    const sendProgress = (overall: number, log: string): void => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.APK_DOWNGRADE_PROGRESS, { overall, log });
      }
    };

    // Legacy positional shape
    if (args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
      const [serial, apkPath] = args as [string, string];
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
    }

    // Object shape from the page
    const opts = (args[0] ?? {}) as {
      serial?: string;
      apps?: Array<{ id?: string; packageName: string; name?: string }>;
      androidVersion?: string;
    };
    const serial = opts.serial;
    const apps = opts.apps ?? [];
    if (!serial) throw new Error('No device selected.');
    if (apps.length === 0) throw new Error('No apps selected to downgrade.');

    const adb = await adbPath();
    const tmpDir = path.join(require('os').tmpdir(), `rmpg-apk-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const perApp: Array<{ packageName: string; status: 'success' | 'failed'; error?: string }> = [];
    for (let i = 0; i < apps.length; i++) {
      const app = apps[i];
      const pct = Math.round((i / apps.length) * 100);
      sendProgress(pct, `[${i + 1}/${apps.length}] ${app.packageName}: locating APK on device…`);

      try {
        // 1. Find the APK file path on device for this package.
        const lookup = await runCommand(adb, ['-s', serial, 'shell', 'pm', 'path', app.packageName], { timeout: 15000 });
        if (lookup.exitCode !== 0) throw new Error(`pm path failed: ${lookup.stderr.trim() || `exit ${lookup.exitCode}`}`);
        const remote = lookup.stdout.split('\n').find((l) => l.startsWith('package:'))?.replace('package:', '').trim();
        if (!remote) throw new Error('Package not installed on device.');

        // 2. Pull the APK locally so we can re-install it with --allow-version-downgrade.
        sendProgress(pct, `  pulling ${remote}…`);
        const localApk = path.join(tmpDir, `${app.packageName}.apk`);
        const pull = await runCommand(adb, ['-s', serial, 'pull', remote, localApk], { timeout: 120000 });
        if (pull.exitCode !== 0) throw new Error(`pull failed: ${pull.stderr.trim()}`);

        // 3. Re-install with downgrade allowance.
        sendProgress(pct, `  reinstalling ${app.packageName}…`);
        const install = await runCommand(adb, ['-s', serial, 'install', '-r', '--allow-version-downgrade', localApk], { timeout: 120000 });
        if (!install.stdout.includes('Success') && install.exitCode !== 0) {
          throw new Error(`install failed: ${install.stderr.trim() || install.stdout.trim()}`);
        }
        perApp.push({ packageName: app.packageName, status: 'success' });
      } catch (err) {
        perApp.push({
          packageName: app.packageName,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    sendProgress(100, 'Done');

    const failures = perApp.filter((r) => r.status === 'failed');
    return {
      success: failures.length === 0,
      results: perApp,
      successCount: perApp.length - failures.length,
      failureCount: failures.length,
    };
  });

  // Misc data collection (call log, calendar, browser history)
  // MISC_COLLECT — single-item dispatcher used by the Misc Collections
  // page. The renderer iterates 31 different `item` ids one IPC call at a
  // time; the original handler took an array of types and only knew 3 of
  // them, so every Misc Collect run reported all 31 as "Unknown error".
  //
  // Each entry in ITEMS maps an item id to an adb shell command (or
  // sequence) plus a file extension. The handler runs the command, writes
  // stdout to `<outputPath>/<itemId>.<ext>`, and returns a per-item
  // `{success, message}` matching the page's contract.
  //
  // Where possible commands use `content query` (no root) over `dumpsys`
  // (often gated). Pure `getprop` / `settings list` work on every device.
  interface MiscItem {
    args: string[];                        // adb args after `-s <serial>`
    ext: 'txt' | 'json' | 'log';
    timeoutMs?: number;                    // some dumps are slow
    /** Optional post-processor; default writes raw stdout. */
    transform?: (stdout: string) => string;
  }
  const MISC_ITEMS: Record<string, MiscItem> = {
    system_properties:    { args: ['shell', 'getprop'], ext: 'txt' },
    dumpsys:              { args: ['shell', 'dumpsys'], ext: 'txt', timeoutMs: 120000 },
    disk_info:            { args: ['shell', 'df', '-h'], ext: 'txt' },
    geolocation:          { args: ['shell', 'dumpsys', 'location'], ext: 'txt' },
    imei_01:              { args: ['shell', 'service', 'call', 'iphonesubinfo', '1'], ext: 'txt' },
    imei_02:              { args: ['shell', 'service', 'call', 'iphonesubinfo', '3'], ext: 'txt' },
    serial_number:        { args: ['shell', 'getprop', 'ro.serialno'], ext: 'txt' },
    active_processes:     { args: ['shell', 'ps', '-A'], ext: 'txt' },
    tcp_connections:      { args: ['shell', 'cat', '/proc/net/tcp'], ext: 'txt' },
    account_info:         { args: ['shell', 'dumpsys', 'account'], ext: 'txt' },
    wifi_dumps:           { args: ['shell', 'dumpsys', 'wifi'], ext: 'txt', timeoutMs: 60000 },
    cpu_info:             { args: ['shell', 'cat', '/proc/cpuinfo'], ext: 'txt' },
    memory_info:          { args: ['shell', 'cat', '/proc/meminfo'], ext: 'txt' },
    display_info:         { args: ['shell', 'dumpsys', 'display'], ext: 'txt' },
    logcat:               { args: ['logcat', '-d', '-v', 'threadtime'], ext: 'log', timeoutMs: 60000 },
    disk_usage:           { args: ['shell', 'du', '-sh', '/sdcard/'], ext: 'txt', timeoutMs: 60000 },
    carrier_info:         { args: ['shell', 'dumpsys', 'telephony.registry'], ext: 'txt' },
    bluetooth_status:     { args: ['shell', 'dumpsys', 'bluetooth_manager'], ext: 'txt' },
    face_recognition:     { args: ['shell', 'dumpsys', 'face'], ext: 'txt' },
    global_settings:      { args: ['shell', 'settings', 'list', 'global'], ext: 'txt' },
    security_settings:    { args: ['shell', 'settings', 'list', 'secure'], ext: 'txt' },
    system_settings:      { args: ['shell', 'settings', 'list', 'system'], ext: 'txt' },
    android_version:      { args: ['shell', 'getprop', 'ro.build.version.release'], ext: 'txt' },
    on_off_history:       { args: ['shell', 'dumpsys', 'power'], ext: 'txt' },
    active_users:         { args: ['shell', 'pm', 'list', 'users'], ext: 'txt' },
    system_events:        { args: ['shell', 'dumpsys', 'activity', 'broadcasts'], ext: 'txt', timeoutMs: 60000 },
    power_history:        { args: ['shell', 'dumpsys', 'batterystats'], ext: 'txt', timeoutMs: 60000 },
    installed_apps_3rd:   { args: ['shell', 'pm', 'list', 'packages', '-3'], ext: 'txt' },
    installed_apps_native:{ args: ['shell', 'pm', 'list', 'packages', '-s'], ext: 'txt' },
    database_info:        { args: ['shell', 'dumpsys', 'dbinfo'], ext: 'txt' },
    adb_status:           { args: ['shell', 'getprop', 'ro.adb.secure'], ext: 'txt' },
  };

  ipcMain.handle(IPC_CHANNELS.MISC_COLLECT, async (_e, ...args: unknown[]) => {
    // Object-shape (renderer): single-item collection.
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { serial: string; item: string; outputPath: string };
      const { serial, item, outputPath } = o;
      if (!serial) return { success: false, message: 'No device selected.' };
      if (!item)   return { success: false, message: 'No item id provided.' };
      if (!outputPath) return { success: false, message: 'No output folder.' };
      const spec = MISC_ITEMS[item];
      if (!spec) return { success: false, message: `Unknown collection item: ${item}` };

      try {
        const adb = await adbPath();
        const r = await runCommand(adb, ['-s', serial, ...spec.args], { timeout: spec.timeoutMs ?? 30000 });
        if (r.exitCode !== 0 && !r.stdout.trim()) {
          throw new Error(r.stderr.trim() || `adb exit ${r.exitCode}`);
        }
        // Platform-aware folder layout — drop into android/<serial>/<item>.<ext>
        // so the output root can host multi-device or mixed-platform cases
        // without collisions. Sanitise the serial for FS safety even though
        // Android serials are normally alphanumeric.
        const safeSerial = serial.replace(/[^a-zA-Z0-9._-]/g, '_');
        const deviceDir = path.join(outputPath, 'android', safeSerial);
        await fs.mkdir(deviceDir, { recursive: true });

        // forensicOutput imported at top of file (was a runtime require
        // before — broke inside the asar bundle).

        // Always write the raw text with a header banner — keeps it
        // human-readable + self-describing if shared standalone.
        const banner = forensicOutput.bannerForText({
          artefactName: item,
          device: { platform: 'android', id: serial },
        });
        const rawPayload = banner + (spec.transform ? spec.transform(r.stdout) : r.stdout);
        const rawDest = path.join(deviceDir, `${item}.${spec.ext}`);
        await fs.writeFile(rawDest, rawPayload, 'utf-8');

        // If a parser exists for this item, also emit a structured JSON
        // companion so analysts can grep / pipe / load into spreadsheets
        // without re-parsing the dump themselves.
        let structuredDest: string | undefined;
        const parsed = forensicOutput.parseByItemId(item, r.stdout);
        if (parsed != null) {
          const structured = {
            artefact: item,
            platform: 'android',
            deviceId: serial,
            extractedAt: new Date().toISOString(),
            data: parsed,
          };
          structuredDest = path.join(deviceDir, `${item}.json`);
          await fs.writeFile(structuredDest, JSON.stringify(structured, null, 2), 'utf-8');
        }

        const written = structuredDest
          ? `${rawDest} + ${structuredDest}`
          : rawDest;
        return {
          success: true,
          message: `Saved → ${written}`,
          path: rawDest,
          structuredPath: structuredDest,
          bytes: Buffer.byteLength(rawPayload),
        };
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    }

    // Legacy positional shape: (serial, types[]) — kept for any old caller
    // that batched a small set of types in one call. Current renderer
    // never hits this branch.
    try {
      const [serial, types] = args as [string, string[]];
      const adb = await adbPath();
      const results: Record<string, unknown> = {};
      for (const t of types ?? []) {
        const spec = MISC_ITEMS[t];
        if (!spec) continue;
        const r = await runCommand(adb, ['-s', serial, ...spec.args], { timeout: spec.timeoutMs ?? 30000 });
        results[t] = r.stdout;
      }
      return { success: true, data: results };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ---------------------------------------------------------------------------
// WiFi / ADB over TCP
// ---------------------------------------------------------------------------

function registerWifiHandlers(): void {
  // Helper — accept either a positional `"ip:port"` string or an object
  // `{ip, port}` (renderer's WifiDebug page sends the object form). Returns
  // a single "ip:port" string ready for adb's pair/connect commands.
  const resolveIpPort = (arg: unknown): string => {
    if (typeof arg === 'string') return arg;
    if (arg && typeof arg === 'object') {
      const o = arg as { ip?: string; port?: string | number; ipPort?: string };
      if (o.ipPort) return o.ipPort;
      if (o.ip && o.port) return `${o.ip}:${o.port}`;
    }
    return '';
  };

  ipcMain.handle(IPC_CHANNELS.WIFI_PAIR, async (_e, ...args: unknown[]) => {
    // Renderer: { ip, port, code }; legacy: (ipPort, pairingCode).
    let ipPort: string;
    let code: string;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { ip?: string; port?: string | number; code?: string; pairingCode?: string };
      ipPort = resolveIpPort(o);
      code = (o.code ?? o.pairingCode) as string;
    } else {
      [ipPort, code] = args as [string, string];
    }
    if (!ipPort || !code) return { success: false, message: 'IP:port and pairing code required.' };
    try {
      const adb = await adbPath();
      const r = await runCommand(adb, ['pair', ipPort, code], { timeout: 30000 });
      const success = r.stdout.toLowerCase().includes('successfully') || r.exitCode === 0;
      return success
        ? { success: true, message: 'Paired.', output: r.stdout }
        : { success: false, message: r.stderr.trim() || 'Pairing failed.', output: r.stdout };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WIFI_CONNECT, async (_e, ...args: unknown[]) => {
    // Renderer: { action: 'connect', ip, port } or { ip, port }; legacy:
    // (ipPort) string.
    let ipPort: string;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      ipPort = resolveIpPort(args[0]);
    } else {
      [ipPort] = args as [string];
    }
    if (!ipPort) return { success: false, message: 'IP:port required.' };
    try {
      const adb = await adbPath();
      const r = await runCommand(adb, ['connect', ipPort], { timeout: 15000 });
      const success = r.stdout.toLowerCase().includes('connected') || r.exitCode === 0;
      return success
        ? { success: true, message: 'Connected.', ip: ipPort, output: r.stdout }
        : { success: false, message: r.stderr.trim() || 'Connection failed.' };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WIFI_DISCONNECT, async (_e, ...args: unknown[]) => {
    let ipPort: string | undefined;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      ipPort = resolveIpPort(args[0]) || undefined;
    } else {
      [ipPort] = args as [string | undefined];
    }
    try {
      const adb = await adbPath();
      const adbArgs = ipPort ? ['disconnect', ipPort] : ['disconnect'];
      const r = await runCommand(adb, adbArgs, { timeout: 10000 });
      return { success: r.exitCode === 0, message: r.exitCode === 0 ? 'Disconnected.' : (r.stderr.trim() || 'Disconnect failed.'), output: r.stdout };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ---------------------------------------------------------------------------
// APK Analysis (JADX)
// ---------------------------------------------------------------------------

function registerJadxHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.JADX_DECOMPILE, async (_e, ...args: unknown[]) => {
    // JadxDecompiler page sends `{apkPath, outputPath, options}`. Legacy
    // callers used positional `(apkPath, outputDir)`. Renderer reads
    // `{success, outputPath, message, classCount}` so emit those fields.
    let apkPath: string;
    let outputDir: string;
    let options: { showSource?: boolean; deobfuscate?: boolean; exportAsGradleProject?: boolean } = {};
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { apkPath: string; outputPath?: string; outputDir?: string; options?: typeof options };
      apkPath = o.apkPath;
      outputDir = (o.outputPath ?? o.outputDir) as string;
      options = o.options ?? {};
    } else {
      [apkPath, outputDir] = args as [string, string];
    }
    if (!apkPath || !outputDir) return { success: false, message: 'APK path and output folder required.' };
    try {
      const jadx = await resolveTool('jadx');
      if (!jadx.found) return { success: false, message: 'JADX not found — install from https://github.com/skylot/jadx' };
      await fs.mkdir(outputDir, { recursive: true });
      const jadxArgs: string[] = ['--output-dir', outputDir];
      // Map the renderer's options to jadx CLI flags. `--show-bad-code`
      // is mostly cosmetic; deobfuscate uses `--deobf`; gradle export uses
      // `--export-gradle`.
      if (options.deobfuscate) jadxArgs.push('--deobf');
      if (options.exportAsGradleProject) jadxArgs.push('--export-gradle');
      jadxArgs.push(apkPath);
      const r = await runCommand(jadx.path, jadxArgs, { timeout: 300000 });
      // jadx may exit non-zero even on partial success (some classes failed
      // to decompile). Treat any output as success but surface a warning.
      const partial = r.exitCode !== 0 && r.stdout.includes('INFO');
      if (r.exitCode !== 0 && !partial) {
        return { success: false, message: r.stderr.trim() || `jadx exit ${r.exitCode}` };
      }
      // Best-effort class count parse from jadx's stdout summary.
      const classMatch = r.stdout.match(/(\d+)\s+\(\d+%\)\s+saved\s+classes/i);
      const classCount = classMatch ? Number(classMatch[1]) : undefined;
      return {
        success: true,
        outputPath: outputDir,
        message: partial ? `Decompiled with warnings → ${outputDir}` : `Decompiled → ${outputDir}`,
        classCount,
      };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ---------------------------------------------------------------------------
// MVT (Mobile Verification Toolkit)
// ---------------------------------------------------------------------------

function registerMvtHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MVT_SCAN, async (_e, options: { type: 'ios' | 'android'; backupPath?: string; serial?: string; outputDir: string; iocFile?: string }) => {
    try {
      const { type, backupPath, serial, outputDir, iocFile } = options;
      await fs.mkdir(outputDir, { recursive: true });

      // MVT writes per-check JSON files to the output directory. We invoke
      // the appropriate sub-command (check-backup for iOS, check-adb for
      // Android) and then walk the output dir parsing each `*.json` /
      // `*_detected.json` file into the ScanResult shape the renderer
      // expects. mvt may exit non-zero on warnings even when output is
      // valid, so don't treat exitCode != 0 as fatal — let the parsed
      // results speak for themselves.
      const args = type === 'ios'
        ? ['check-backup', '--output', outputDir, ...(iocFile ? ['--iocs', iocFile] : []), backupPath ?? '']
        : ['check-adb', '--output', outputDir, ...(iocFile ? ['--iocs', iocFile] : []), ...(serial ? ['--serial', serial] : [])];
      const cmd = type === 'ios' ? 'mvt-ios' : 'mvt-android';
      const r = await runCommand(cmd, args.filter(Boolean), { timeout: 600000 });

      const results = await parseMvtResults(outputDir);

      return {
        success: r.exitCode === 0 || results.length > 0,
        results,
        output: r.stdout,
        error: r.exitCode !== 0 && results.length === 0 ? (r.stderr.trim() || `mvt exited with code ${r.exitCode}`) : undefined,
      };
    } catch (err) {
      return { success: false, results: [], error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

/**
 * Walk an MVT output directory and convert per-check JSON artefacts into
 * the renderer's ScanResult shape. MVT writes one JSON per check (e.g.
 * `sms.json`, `safari_browser_state.json`) plus `*_detected.json` for
 * matches against IOCs. We treat detected entries as `high` severity and
 * everything else as `info` — mvt itself doesn't tag severity, so this is
 * the most useful default until per-module rules are added.
 */
async function parseMvtResults(outputDir: string): Promise<Array<{
  id: string;
  indicator: string;
  module: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  matchedData: string;
  timestamp?: string;
}>> {
  const out: Array<{ id: string; indicator: string; module: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; description: string; matchedData: string; timestamp?: string }> = [];
  let entries: import('fs').Dirent[];
  try {
    entries = (await fs.readdir(outputDir, { withFileTypes: true })) as unknown as import('fs').Dirent[];
  } catch {
    return out;
  }

  let counter = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const detected = entry.name.endsWith('_detected.json');
    const moduleName = entry.name.replace(/(_detected)?\.json$/, '');

    let raw: string;
    try {
      raw = await fs.readFile(path.join(outputDir, entry.name), 'utf-8');
    } catch { continue; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }

    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      // Best-effort field discovery — mvt module schemas vary per check.
      const indicator = String(rec.matched_indicator ?? rec.indicator ?? rec.url ?? rec.domain ?? rec.address ?? rec.path ?? rec.name ?? '');
      const description = String(rec.description ?? rec.body ?? rec.message ?? rec.text ?? rec.summary ?? '');
      const matchedData = String(rec.matched_data ?? rec.data ?? rec.value ?? indicator ?? '');
      const timestamp = (rec.isodate ?? rec.timestamp ?? rec.date ?? rec.created) as string | undefined;
      out.push({
        id: `${moduleName}-${counter++}`,
        indicator: indicator || '(no indicator)',
        module: moduleName,
        severity: detected ? 'high' : 'info',
        description: description || (detected ? 'IOC match' : 'Module artefact'),
        matchedData,
        timestamp: typeof timestamp === 'string' ? timestamp : undefined,
      });
    }
  }
  return out;
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
    // Renderer (ImageFinder.tsx) contract — these are what actually arrive.
    sourceDir?: string;
    mode?: 'hash' | 'exif' | 'geolocation';
    hash?: string;
    exifQuery?: string;
    dateFrom?: string;
    dateTo?: string;
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
    // Legacy aliases — kept so older callers don't break.
    rootDir?: string;
    hashList?: string[];
    nearLat?: number;
    nearLon?: number;
    extensions?: string[];
  }) => {
    // Helpers come from the static import at the top of the file —
    // runtime require breaks inside the asar bundle.
    const sourceDir = options.sourceDir ?? options.rootDir;
    if (!sourceDir) {
      return { success: false, message: 'No source directory provided.' };
    }
    const mode: 'hash' | 'exif' | 'geolocation' = options.mode ?? 'hash';
    const exts = options.extensions;

    // Pre-compute the hash filter once so the inner loop stays cheap.
    const hashFilter = (() => {
      if (mode !== 'hash') return undefined;
      if (options.hashList && options.hashList.length > 0) return new Set(options.hashList.map((h) => h.toLowerCase()));
      const single = options.hash?.trim();
      return single ? new Set([single.toLowerCase()]) : undefined;
    })();

    const lat = options.latitude ?? options.nearLat;
    const lon = options.longitude ?? options.nearLon;
    const radiusKm = options.radiusKm ?? 1;
    const exifNeedle = options.exifQuery?.trim().toLowerCase();
    const dateFromMs = options.dateFrom ? Date.parse(options.dateFrom) : NaN;
    const dateToMs = options.dateTo ? Date.parse(options.dateTo) : NaN;

    interface ImageRecord {
      id: string;
      path: string;
      filename: string;
      hash: string;
      size: number;
      width: number;
      height: number;
      mimeType: string;
      dateTaken?: string;
      cameraMake?: string;
      cameraModel?: string;
      latitude?: number;
      longitude?: number;
    }
    const images: ImageRecord[] = [];

    async function walk(dir: string): Promise<void> {
      let entries: import('fs').Dirent[];
      try {
        entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as import('fs').Dirent[];
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
          continue;
        }
        if (exts ? !exts.includes(path.extname(e.name).toLowerCase()) : !isImageFile(full)) continue;

        // Hash + size — needed for every record.
        const hash = await hashFile(full);
        if (hashFilter && !hashFilter.has(hash.toLowerCase())) continue;
        const stat = await fs.stat(full).catch(() => ({ size: 0 }));

        // EXIF read is optional per mode but cheap on macOS (mdls is sub-100ms).
        const exif = mode === 'hash' ? {} : await readImageExif(full);

        // Geolocation filter: must have GPS *and* be within radius.
        if (mode === 'geolocation') {
          if (typeof lat !== 'number' || typeof lon !== 'number') continue;
          if (exif.latitude == null || exif.longitude == null) continue;
          if (haversineKm(lat, lon, exif.latitude, exif.longitude) > radiusKm) continue;
        }

        // EXIF text filter: case-insensitive substring across make/model.
        if (mode === 'exif' && exifNeedle) {
          const haystack = `${exif.cameraMake ?? ''} ${exif.cameraModel ?? ''}`.toLowerCase();
          if (!haystack.includes(exifNeedle)) continue;
        }

        // Date range filter (only meaningful in EXIF mode, requires dateTaken).
        if (mode === 'exif' && (Number.isFinite(dateFromMs) || Number.isFinite(dateToMs))) {
          const dt = exif.dateTaken ? Date.parse(exif.dateTaken) : NaN;
          if (Number.isFinite(dateFromMs) && (!Number.isFinite(dt) || dt < dateFromMs)) continue;
          if (Number.isFinite(dateToMs) && (!Number.isFinite(dt) || dt > dateToMs)) continue;
        }

        images.push({
          id: hash,
          path: full,
          filename: path.basename(full),
          hash,
          size: stat.size,
          width: exif.width ?? 0,
          height: exif.height ?? 0,
          mimeType: `image/${path.extname(full).slice(1).toLowerCase()}`,
          dateTaken: exif.dateTaken,
          cameraMake: exif.cameraMake,
          cameraModel: exif.cameraModel,
          latitude: exif.latitude,
          longitude: exif.longitude,
        });
      }
    }

    try {
      await walk(sourceDir);
      return { success: true, images, count: images.length };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      };
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

  // MULTI_DEVICE_EXECUTE — fan out a high-level operation across N devices
  // in parallel. The MultiDevice page sends `{serials, operation, outputPath}`
  // where operation ∈ 'backup' | 'file_extract' | 'contacts'; legacy callers
  // sent positional `(serials, command[])` to run a raw shell command.
  // Both shapes are honoured.
  ipcMain.handle(IPC_CHANNELS.MULTI_DEVICE_EXECUTE, async (_e, ...args: unknown[]) => {
    // Object-shape (renderer): dispatch per-operation per-device.
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as { serials: string[]; operation: string; outputPath?: string };
      const { serials, operation, outputPath } = o;
      if (!Array.isArray(serials) || serials.length === 0) {
        return { success: false, message: 'No devices selected.' };
      }
      const adb = await adbPath();
      // Per-device dispatcher — each operation maps to a sequence of adb
      // calls. Wrapped per-device so one failure doesn't take down the
      // batch; per-device {success, message} bubbles to the renderer.
      const runOne = async (serial: string): Promise<{ serial: string; success: boolean; message: string }> => {
        try {
          if (operation === 'backup') {
            if (!outputPath) throw new Error('Output folder required for backup.');
            const dest = path.join(outputPath, `${serial}.ab`);
            await fs.mkdir(path.dirname(dest), { recursive: true });
            const r = await runCommand(adb, ['-s', serial, 'backup', '-all', '-f', dest], { timeout: 600000 });
            if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `adb backup exit ${r.exitCode}`);
            return { serial, success: true, message: `Backup → ${dest}` };
          }
          if (operation === 'file_extract') {
            // Pull common evidence dirs (DCIM, Download, WhatsApp media)
            // for every device — gives a baseline artefact set without
            // requiring per-device format selection.
            if (!outputPath) throw new Error('Output folder required for file extraction.');
            const dest = path.join(outputPath, serial);
            await fs.mkdir(dest, { recursive: true });
            const targets = ['/sdcard/DCIM', '/sdcard/Download', '/sdcard/WhatsApp', '/sdcard/Pictures'];
            const pulled: string[] = [];
            for (const t of targets) {
              const r = await runCommand(adb, ['-s', serial, 'pull', t, dest], { timeout: 300000 });
              if (r.exitCode === 0) pulled.push(t);
            }
            if (pulled.length === 0) throw new Error('No accessible source dirs on device.');
            return { serial, success: true, message: `Pulled: ${pulled.join(', ')} → ${dest}` };
          }
          if (operation === 'contacts') {
            if (!outputPath) throw new Error('Output folder required for contacts.');
            // Pull contacts2.db from the contacts provider DB location.
            // Requires root or accessible content provider; falls back to
            // `content query` if the file pull fails.
            const dest = path.join(outputPath, `${serial}-contacts.txt`);
            await fs.mkdir(path.dirname(dest), { recursive: true });
            const r = await runCommand(adb, [
              '-s', serial, 'shell', 'content', 'query',
              '--uri', 'content://contacts/phones',
              '--projection', 'display_name:number:type',
            ], { timeout: 60000 });
            if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `content query exit ${r.exitCode}`);
            await fs.writeFile(dest, r.stdout, 'utf-8');
            const rows = r.stdout.split('\n').filter((l) => l.includes('Row:')).length;
            return { serial, success: true, message: `${rows} contacts → ${dest}` };
          }
          throw new Error(`Unknown operation: ${operation}`);
        } catch (err) {
          return { serial, success: false, message: err instanceof Error ? err.message : String(err) };
        }
      };

      const results = await Promise.all(serials.map(runOne));
      const allOk = results.every((r) => r.success);
      return { success: allOk, results };
    }

    // Legacy positional-shape: (serials, shellCommand[])
    try {
      const [serials, command] = args as [string[], string[]];
      const adb = await adbPath();
      const results = await Promise.all(
        serials.map(async (serial) => {
          const r = await runCommand(adb, ['-s', serial, 'shell', ...command], { timeout: 60000 });
          return { serial, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
        })
      );
      return { success: true, results };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ---------------------------------------------------------------------------
// WhatsApp DB Merge
// ---------------------------------------------------------------------------

function registerWhatsAppMergeHandler(): void {
  ipcMain.handle(IPC_CHANNELS.WHATSAPP_MERGE, async (
    _e,
    // The WhatsAppMerge page sends `{ dbPaths: string[], outputPath, options }`
    // and reads back `{ success, outputPath, stats, message? }`. Older callers
    // pass two positional db paths. Both shapes work.
    ...args: unknown[]
  ) => {
    let dbPaths: string[];
    let outputPath: string | undefined;
    let dedupMessages = true;

    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      const o = args[0] as {
        dbPaths?: string[];
        outputPath?: string;
        options?: { deduplicateMessages?: boolean };
      };
      dbPaths = (o.dbPaths ?? []).filter(Boolean);
      outputPath = o.outputPath;
      if (o.options && typeof o.options.deduplicateMessages === 'boolean') {
        dedupMessages = o.options.deduplicateMessages;
      }
    } else {
      const [primaryDb, secondaryDb] = args as [string, string];
      dbPaths = [primaryDb, secondaryDb].filter(Boolean);
    }

    if (dbPaths.length < 2) {
      return { success: false, message: 'Need at least 2 WhatsApp databases to merge.' };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');

      // Resolve target output path. If outputPath is a folder (or missing),
      // copy the first db into it as `merged.db`. If outputPath is a file
      // path, use it directly. Either way the merged DB is the *first*
      // input copied, then subsequent inputs INSERT OR IGNORE into it.
      let mergedDbPath: string;
      if (outputPath) {
        let isDir = false;
        try {
          const st = await fs.stat(outputPath);
          isDir = st.isDirectory();
        } catch { /* doesn't exist; treat as file path */ }
        mergedDbPath = isDir ? path.join(outputPath, 'merged.db') : outputPath;
        await fs.mkdir(path.dirname(mergedDbPath), { recursive: true });
      } else {
        mergedDbPath = path.join(path.dirname(dbPaths[0]), 'merged.db');
      }
      await fs.copyFile(dbPaths[0], mergedDbPath);

      const merged = new Database(mergedDbPath);
      const tables: { name: string }[] = merged
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all();

      // Tally pre-merge so the renderer can report duplicates removed.
      const messagesTable = tables.find((t) => /^messages?$/i.test(t.name))?.name;
      const baselineMessages = messagesTable
        ? (merged.prepare(`SELECT COUNT(*) as c FROM "${messagesTable}"`).get() as { c: number }).c
        : 0;

      let totalRowsMerged = 0;
      let chatsFound = 0;
      let contactsMerged = 0;

      for (let i = 1; i < dbPaths.length; i++) {
        merged.prepare('ATTACH DATABASE ? AS secondary').run(dbPaths[i]);
        merged.transaction(() => {
          for (const { name } of tables) {
            try {
              const cols: { name: string }[] = merged.prepare(`PRAGMA table_info("${name}")`).all();
              const colNames = cols.map((c) => `"${c.name}"`).join(', ');
              const verb = dedupMessages ? 'INSERT OR IGNORE' : 'INSERT';
              const info = merged.prepare(`${verb} INTO "${name}" (${colNames}) SELECT ${colNames} FROM secondary."${name}"`).run();
              totalRowsMerged += info.changes;
            } catch { /* schema mismatch / missing table — skip */ }
          }
        })();
        merged.prepare('DETACH DATABASE secondary').run();
      }

      const totalMessages = messagesTable
        ? (merged.prepare(`SELECT COUNT(*) as c FROM "${messagesTable}"`).get() as { c: number }).c
        : 0;
      // Best-effort chat / contact counts so the UI's stats cards render.
      const chatsTable = tables.find((t) => /^chats?$/i.test(t.name) || /chat_list/i.test(t.name))?.name;
      if (chatsTable) {
        chatsFound = (merged.prepare(`SELECT COUNT(*) as c FROM "${chatsTable}"`).get() as { c: number }).c;
      }
      const contactsTable = tables.find((t) => /contacts?/i.test(t.name) || /jid/i.test(t.name))?.name;
      if (contactsTable) {
        contactsMerged = (merged.prepare(`SELECT COUNT(*) as c FROM "${contactsTable}"`).get() as { c: number }).c;
      }

      merged.close();

      return {
        success: true,
        outputPath: mergedDbPath,
        stats: {
          totalMessages,
          uniqueMessages: totalMessages,
          duplicatesRemoved: Math.max(0, baselineMessages + totalRowsMerged - totalMessages),
          contactsMerged,
          chatsFound,
        },
        rowsMerged: totalRowsMerged,
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Case Management
// ---------------------------------------------------------------------------

function registerCaseHandlers(): void {
  // CASE_SET_PATH is owned by case-handlers.ts (it actually updates the
  // active-case state used by the audit logger). The no-op stub that used
  // to live here would race with that real handler if missing-handlers
  // happened to register first, so it's been removed.
  if (ipcMain.listenerCount(IPC_CHANNELS.CASE_DELETE)) return;

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

  // ACQUISITION_REPORT_BUILD — read the MANIFEST.json + parsed artefact
  // JSONs in an acquisition folder and emit AcquisitionReport.html /
  // AcquisitionReport.md. Returns the produced file paths so the
  // renderer can offer "Open" / "Reveal in Finder" actions.
  ipcMain.handle(IPC_CHANNELS.ACQUISITION_REPORT_BUILD, async (_e, options: {
    acquisitionDir: string;
    outputDir?: string;
    computeHashes?: boolean;
  }) => {
    if (!options?.acquisitionDir) {
      return { success: false, message: 'No acquisition folder provided.' };
    }
    try {
      // Static import (top of file) — runtime `require('../services/...')`
      // fails inside the asar bundle because post-bundling there's no
      // such relative path on disk anymore. Vite resolves the static
      // import at build time and bundles the implementation.
      const r = await buildAcquisitionReport(options);
      return { success: true, ...r };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

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
  // THROW on write failure so renderer-side `try { invoke(FILE_WRITE) }
  // catch { addLog('Export failed') }` actually fires. Previously this
  // returned `{success:false, error}` silently — none of the export
  // buttons (CSV, KML, hashes, contacts, image-finder) checked `success`,
  // so they all logged "Export complete" even when the write didn't
  // happen. Throwing flips the failure path to the catch block where
  // logging already lives.
  ipcMain.handle(channel, async (_e, filePath: string, content: string) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, filePath };
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
