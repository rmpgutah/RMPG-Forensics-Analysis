import * as path from 'path';
import * as fs from 'fs/promises';
import type { IOSDevice, ProcessResult, ProcessProgress } from '@rmpg/shared';
import { runCommand, runCommandWithProgress } from './process-runner';
import { resolveTool } from './tool-resolver';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getToolPath(
  toolName: 'idevice_id' | 'ideviceinfo' | 'idevicename' | 'idevicebackup2' | 'ideviceinstaller' | 'idevicescreenshot' | 'idevicediagnostics'
): Promise<string> {
  const tool = await resolveTool(toolName);
  if (!tool.found) {
    throw new Error(
      `${toolName} not found. Please install libimobiledevice and configure the path in Settings.`
    );
  }
  return tool.path;
}

function parseIdeviceInfoOutput(output: string): Record<string, string> {
  const map: Record<string, string> = {};
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim();
    if (key) map[key] = value;
  }
  return map;
}

/**
 * Find a file inside an iOS backup by its domain+relative path via Manifest.db.
 * Returns the absolute path to the hashed file, or null if not found.
 */
async function findBackupFile(
  backupDir: string,
  domain: string,
  relativePath: string
): Promise<string | null> {
  const manifestPath = path.join(backupDir, 'Manifest.db');
  try {
    await fs.access(manifestPath);
  } catch {
    return null;
  }

  try {
    // Use better-sqlite3 to query the manifest
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(manifestPath, { readonly: true });
    const row = db
      .prepare('SELECT fileID FROM Files WHERE domain = ? AND relativePath = ?')
      .get(domain, relativePath) as { fileID: string } | undefined;
    db.close();

    if (!row) return null;
    const fileId = row.fileID;
    // iOS backup stores files as backupDir/XX/XXXXXXX... (first 2 chars as subdir)
    const candidate = path.join(backupDir, fileId.substring(0, 2), fileId);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Find the most recent backup for a given UDID under a base directory.
 */
async function findBackupDir(baseDir: string, udid: string): Promise<string | null> {
  const deviceBackupDir = path.join(baseDir, udid);
  try {
    await fs.access(deviceBackupDir);
    return deviceBackupDir;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listDevices(): Promise<IOSDevice[]> {
  const ideviceIdPath = await getToolPath('idevice_id');
  const result = await runCommand(ideviceIdPath, ['-l'], { timeout: 15000 });

  if (result.exitCode !== 0) return [];

  const udids = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (udids.length === 0) return [];

  const devices: IOSDevice[] = [];
  for (const udid of udids) {
    try {
      const device = await getDeviceInfo(udid);
      devices.push(device);
    } catch {
      devices.push({ udid, name: 'Unknown', productVersion: '', productType: '' });
    }
  }
  return devices;
}

export async function getDeviceInfo(udid: string): Promise<IOSDevice> {
  const ideviceinfoPath = await getToolPath('ideviceinfo');
  const result = await runCommand(ideviceinfoPath, ['-u', udid], { timeout: 15000 });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to get info for iOS device ${udid}: ${result.stderr.trim()}`);
  }

  const props = parseIdeviceInfoOutput(result.stdout);
  let deviceName = props['DeviceName'] ?? '';
  if (!deviceName) {
    try {
      const idevicenamePath = await getToolPath('idevicename');
      const nameResult = await runCommand(idevicenamePath, ['-u', udid], { timeout: 10000 });
      if (nameResult.exitCode === 0) deviceName = nameResult.stdout.trim();
    } catch {
      // idevicename not available
    }
  }

  return {
    udid,
    name: deviceName || 'Unknown',
    productVersion: props['ProductVersion'] ?? '',
    productType: props['ProductType'] ?? '',
    serialNumber: props['SerialNumber'] ?? undefined,
    phoneNumber: props['PhoneNumber'] ?? undefined,
    buildVersion: props['BuildVersion'] ?? undefined,
  };
}

/**
 * Get extended live device diagnostics including battery, disk, and all properties.
 */
export async function getDeviceDiagnostics(udid: string): Promise<Record<string, unknown>> {
  const ideviceinfoPath = await getToolPath('ideviceinfo');

  // Get all properties
  const allResult = await runCommand(ideviceinfoPath, ['-u', udid], { timeout: 15000 });
  const allProps = allResult.exitCode === 0 ? parseIdeviceInfoOutput(allResult.stdout) : {};

  // Get battery domain
  const battResult = await runCommand(ideviceinfoPath, ['-u', udid, '-q', 'com.apple.mobile.battery'], { timeout: 10000 });
  const battProps = battResult.exitCode === 0 ? parseIdeviceInfoOutput(battResult.stdout) : {};

  // Get disk usage domain
  const diskResult = await runCommand(ideviceinfoPath, ['-u', udid, '-q', 'com.apple.disk_usage'], { timeout: 10000 });
  const diskProps = diskResult.exitCode === 0 ? parseIdeviceInfoOutput(diskResult.stdout) : {};

  // Get WiFi domain
  const wifiResult = await runCommand(ideviceinfoPath, ['-u', udid, '-q', 'com.apple.mobile.wifi'], { timeout: 10000 });
  const wifiProps = wifiResult.exitCode === 0 ? parseIdeviceInfoOutput(wifiResult.stdout) : {};

  return {
    device: allProps,
    battery: battProps,
    disk: diskProps,
    wifi: wifiProps,
  };
}

export async function backup(
  udid: string,
  outputPath: string,
  encrypted?: boolean,
  onProgress?: (p: ProcessProgress) => void
): Promise<ProcessResult> {
  const idevicebackup2Path = await getToolPath('idevicebackup2');

  // idevicebackup2 fails silently if the output directory does not exist
  await fs.mkdir(outputPath, { recursive: true });

  const args: string[] = ['-u', udid, 'backup', '--full', outputPath];
  if (onProgress) return runCommandWithProgress(idevicebackup2Path, args, {}, onProgress);
  return runCommand(idevicebackup2Path, args);
}

export async function restore(
  udid: string,
  backupPath: string,
  onProgress?: (p: ProcessProgress) => void
): Promise<ProcessResult> {
  const idevicebackup2Path = await getToolPath('idevicebackup2');
  const args = ['-u', udid, 'restore', '--system', '--settings', backupPath];
  if (onProgress) return runCommandWithProgress(idevicebackup2Path, args, {}, onProgress);
  return runCommand(idevicebackup2Path, args);
}

export async function listInstalledApps(udid: string): Promise<string[]> {
  const ideviceinstallerPath = await getToolPath('ideviceinstaller');
  const result = await runCommand(ideviceinstallerPath, ['-u', udid, '-l'], { timeout: 30000 });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to list apps for device ${udid}: ${result.stderr.trim()}`);
  }
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const parts = line.split(',');
      return parts[0]?.trim() ?? '';
    })
    .filter((bundleId) => bundleId.length > 0);
}

/**
 * Capture a screenshot from a connected iOS device.
 */
export async function captureScreenshot(udid: string, outputPath: string): Promise<ProcessResult> {
  const toolPath = await getToolPath('idevicescreenshot');
  return runCommand(toolPath, ['-u', udid, outputPath], { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Backup-based data extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract messages from an iOS backup (sms.db).
 */
export async function extractMessages(
  backupDir: string,
  options: { limit?: number; filter?: string } = {}
): Promise<{ messages: unknown[]; total: number; error?: string }> {
  const smsDbPath = await findBackupFile(backupDir, 'HomeDomain', 'Library/SMS/sms.db');
  if (!smsDbPath) {
    return { messages: [], total: 0, error: 'sms.db not found in backup. Run a backup first.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(smsDbPath, { readonly: true });

    let query = `
      SELECT
        m.ROWID as id,
        m.guid,
        m.text,
        m.date,
        m.date_read,
        m.is_from_me,
        m.is_read,
        m.is_delivered,
        m.service,
        m.account,
        h.id as contact_id,
        h.service as contact_service
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
    `;
    if (options.filter) {
      query += ` WHERE m.text LIKE '%' || ? || '%'`;
    }
    query += ' ORDER BY m.date DESC';
    if (options.limit) query += ` LIMIT ${options.limit}`;

    const messages = options.filter
      ? db.prepare(query).all(options.filter)
      : db.prepare(query).all();

    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM message').get() as { cnt: number };
    db.close();

    // Convert Apple epoch (seconds since 2001-01-01) to Unix ms
    const appleEpochOffset = 978307200;
    const normalized = (messages as Array<Record<string, unknown>>).map((m) => ({
      ...m,
      date: m.date ? new Date((Number(m.date) / 1e9 + appleEpochOffset) * 1000).toISOString() : null,
      date_read: m.date_read ? new Date((Number(m.date_read) / 1e9 + appleEpochOffset) * 1000).toISOString() : null,
    }));

    return { messages: normalized, total: countRow.cnt };
  } catch (err) {
    return { messages: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Extract call history from an iOS backup (CallHistory.storedata).
 */
export async function extractCallHistory(
  backupDir: string,
  options: { limit?: number } = {}
): Promise<{ calls: unknown[]; total: number; error?: string }> {
  const callDbPath = await findBackupFile(
    backupDir,
    'HomeDomain',
    'Library/CallHistoryDB/CallHistory.storedata'
  );
  if (!callDbPath) {
    return { calls: [], total: 0, error: 'CallHistory.storedata not found in backup.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(callDbPath, { readonly: true });

    let query = `
      SELECT
        ROWID as id,
        ZADDRESS as phone_number,
        ZDURATION as duration,
        ZDATE as date,
        ZORIGINATED as originated,
        ZANSWERED as answered,
        ZSERVICE_PROVIDER as service,
        ZISO_COUNTRY_CODE as country_code
      FROM ZCALLRECORD
      ORDER BY ZDATE DESC
    `;
    if (options.limit) query += ` LIMIT ${options.limit}`;

    const calls = db.prepare(query).all();
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM ZCALLRECORD').get() as { cnt: number };
    db.close();

    const appleEpochOffset = 978307200;
    const normalized = (calls as Array<Record<string, unknown>>).map((c) => ({
      ...c,
      date: c.date ? new Date((Number(c.date) + appleEpochOffset) * 1000).toISOString() : null,
    }));

    return { calls: normalized, total: countRow.cnt };
  } catch (err) {
    return { calls: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Extract contacts from an iOS backup (AddressBook.sqlitedb).
 */
export async function extractContacts(
  backupDir: string
): Promise<{ contacts: unknown[]; total: number; error?: string }> {
  const abPath = await findBackupFile(
    backupDir,
    'HomeDomain',
    'Library/AddressBook/AddressBook.sqlitedb'
  );
  if (!abPath) {
    return { contacts: [], total: 0, error: 'AddressBook.sqlitedb not found in backup.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(abPath, { readonly: true });

    const contacts = db.prepare(`
      SELECT
        ABPerson.ROWID as id,
        ABPerson.First as first_name,
        ABPerson.Last as last_name,
        ABPerson.Organization as organization,
        ABPerson.Birthday as birthday,
        ABPerson.Note as note,
        ABPerson.CreationDate as created,
        ABPerson.ModificationDate as modified
      FROM ABPerson
      ORDER BY ABPerson.Last, ABPerson.First
    `).all();

    // Get phone numbers
    const phones = db.prepare(`
      SELECT record_id, value, label FROM ABMultiValue
      WHERE property = 3
    `).all() as Array<{ record_id: number; value: string; label: string }>;

    // Get emails
    const emails = db.prepare(`
      SELECT record_id, value, label FROM ABMultiValue
      WHERE property = 4
    `).all() as Array<{ record_id: number; value: string; label: string }>;

    db.close();

    const phoneMap = new Map<number, string[]>();
    for (const p of phones) {
      if (!phoneMap.has(p.record_id)) phoneMap.set(p.record_id, []);
      phoneMap.get(p.record_id)!.push(p.value);
    }
    const emailMap = new Map<number, string[]>();
    for (const e of emails) {
      if (!emailMap.has(e.record_id)) emailMap.set(e.record_id, []);
      emailMap.get(e.record_id)!.push(e.value);
    }

    const appleEpochOffset = 978307200;
    const enriched = (contacts as Array<Record<string, unknown>>).map((c) => ({
      ...c,
      phones: phoneMap.get(c.id as number) ?? [],
      emails: emailMap.get(c.id as number) ?? [],
      created: c.created ? new Date((Number(c.created) + appleEpochOffset) * 1000).toISOString() : null,
      modified: c.modified ? new Date((Number(c.modified) + appleEpochOffset) * 1000).toISOString() : null,
    }));

    return { contacts: enriched, total: enriched.length };
  } catch (err) {
    return { contacts: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * List photo assets from an iOS backup (Photos.sqlite).
 */
export async function extractPhotos(
  backupDir: string,
  options: { limit?: number; mediaType?: 'photo' | 'video' | 'all' } = {}
): Promise<{ assets: unknown[]; total: number; error?: string }> {
  const photosDbPath = await findBackupFile(
    backupDir,
    'CameraRollDomain',
    'Media/PhotoData/Photos.sqlite'
  );
  if (!photosDbPath) {
    return { assets: [], total: 0, error: 'Photos.sqlite not found in backup.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(photosDbPath, { readonly: true });

    let query = `
      SELECT
        ZASSET.ROWID as id,
        ZASSET.ZFILENAME as filename,
        ZASSET.ZDIRECTORY as directory,
        ZASSET.ZKIND as kind,
        ZASSET.ZDURATION as duration,
        ZASSET.ZFILESIZE as file_size,
        ZASSET.ZWIDTH as width,
        ZASSET.ZHEIGHT as height,
        ZASSET.ZLATITUDE as latitude,
        ZASSET.ZLONGITUDE as longitude,
        ZASSET.ZDATECREATED as date_created,
        ZASSET.ZMODIFICATIONDATE as date_modified
      FROM ZASSET
    `;
    const params: unknown[] = [];
    if (options.mediaType === 'photo') {
      query += ' WHERE ZASSET.ZKIND = 0';
    } else if (options.mediaType === 'video') {
      query += ' WHERE ZASSET.ZKIND = 1';
    }
    query += ' ORDER BY ZASSET.ZDATECREATED DESC';
    if (options.limit) query += ` LIMIT ${options.limit}`;

    const assets = db.prepare(query).all(...params);
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM ZASSET').get() as { cnt: number };
    db.close();

    const appleEpochOffset = 978307200;
    const normalized = (assets as Array<Record<string, unknown>>).map((a) => ({
      ...a,
      date_created: a.date_created ? new Date((Number(a.date_created) + appleEpochOffset) * 1000).toISOString() : null,
      date_modified: a.date_modified ? new Date((Number(a.date_modified) + appleEpochOffset) * 1000).toISOString() : null,
    }));

    return { assets: normalized, total: countRow.cnt };
  } catch (err) {
    return { assets: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Copy actual photo/video files out of the backup hashed tree to a readable folder.
 * Files are named with their original filename and organized by date (YYYY-MM/).
 * Returns count of files copied and any errors.
 *
 * The progress callback now receives `(copied, total, bytes)` — bytes is
 * cumulative bytes copied so far. Callers can feed this into a
 * ProgressTracker to compute smoothed bytes/sec speed and a real ETA
 * instead of file-count fraction. Older callers that ignore the third
 * arg keep working unchanged.
 */
export async function copyPhotosToFolder(
  backupDir: string,
  outputDir: string,
  onProgress?: (copied: number, total: number, bytes?: number) => void
): Promise<{ copied: number; skipped: number; total: number; bytes: number; error?: string }> {
  const manifestPath = path.join(backupDir, 'Manifest.db');
  try {
    await fs.access(manifestPath);
  } catch {
    return { copied: 0, skipped: 0, total: 0, bytes: 0, error: 'Manifest.db not found' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(manifestPath, { readonly: true });

    // Query all media files from CameraRollDomain
    const rows = db.prepare(`
      SELECT fileID, relativePath
      FROM Files
      WHERE domain IN ('CameraRollDomain', 'MediaDomain')
        AND (
          relativePath LIKE '%.jpg' OR relativePath LIKE '%.jpeg' OR
          relativePath LIKE '%.png' OR relativePath LIKE '%.heic' OR
          relativePath LIKE '%.heif' OR relativePath LIKE '%.gif' OR
          relativePath LIKE '%.mp4' OR relativePath LIKE '%.mov' OR
          relativePath LIKE '%.m4v' OR relativePath LIKE '%.3gp' OR
          relativePath LIKE '%.aae' OR relativePath LIKE '%.tiff'
        )
    `).all() as Array<{ fileID: string; relativePath: string }>;
    db.close();

    const total = rows.length;
    let copied = 0;
    let skipped = 0;
    let cumulativeBytes = 0;

    await fs.mkdir(outputDir, { recursive: true });

    for (const row of rows) {
      const srcPath = path.join(backupDir, row.fileID.substring(0, 2), row.fileID);
      // Preserve original filename; use flat structure for cross-platform compatibility
      const originalName = path.basename(row.relativePath);
      const destPath = path.join(outputDir, originalName);

      try {
        // Stat first so we can both verify access and accumulate bytes
        // for speed/ETA computation. Cheap on macOS APFS (~50µs).
        const srcStat = await fs.stat(srcPath);
        // Avoid overwriting — append fileID prefix if name collides
        let finalDest = destPath;
        try {
          await fs.access(finalDest);
          const ext = path.extname(originalName);
          const base = path.basename(originalName, ext);
          finalDest = path.join(outputDir, `${base}_${row.fileID.substring(0, 8)}${ext}`);
        } catch { /* dest doesn't exist, use as-is */ }

        await fs.copyFile(srcPath, finalDest);
        cumulativeBytes += srcStat.size;
        copied++;
      } catch {
        skipped++;
      }

      // Throttle progress callbacks to ~10/sec by emitting every 10 files
      // — but always emit on the final file so the bar reaches 100%.
      if (onProgress && ((copied + skipped) % 10 === 0 || (copied + skipped) === total)) {
        onProgress(copied + skipped, total, cumulativeBytes);
      }
    }

    return { copied, skipped, total, bytes: cumulativeBytes };
  } catch (err) {
    return { copied: 0, skipped: 0, total: 0, bytes: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Extract Safari browsing history from an iOS backup.
 */
export async function extractSafariHistory(
  backupDir: string
): Promise<{ history: unknown[]; bookmarks: unknown[]; total: number; error?: string }> {
  const safariDbPath = await findBackupFile(
    backupDir,
    'HomeDomain',
    'Library/Safari/History.db'
  );
  if (!safariDbPath) {
    return { history: [], bookmarks: [], total: 0, error: 'Safari History.db not found in backup.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(safariDbPath, { readonly: true });

    const history = db.prepare(`
      SELECT
        hi.id,
        hi.url,
        hi.domain_expansion,
        hv.title,
        hv.load_successful,
        hv.visit_time
      FROM history_items hi
      LEFT JOIN history_visits hv ON hi.id = hv.history_item
      ORDER BY hv.visit_time DESC
      LIMIT 5000
    `).all();

    db.close();

    // Safari uses Mac absolute time (seconds since 2001-01-01)
    const appleEpochOffset = 978307200;
    const normalized = (history as Array<Record<string, unknown>>).map((h) => ({
      ...h,
      visit_time: h.visit_time ? new Date((Number(h.visit_time) + appleEpochOffset) * 1000).toISOString() : null,
    }));

    return { history: normalized, bookmarks: [], total: normalized.length };
  } catch (err) {
    return { history: [], bookmarks: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Extract Notes from an iOS backup (NoteStore.sqlite).
 */
export async function extractNotes(
  backupDir: string
): Promise<{ notes: unknown[]; total: number; error?: string }> {
  const notesDbPath = await findBackupFile(
    backupDir,
    'HomeDomain',
    'Library/Group Containers/group.com.apple.notes/NoteStore.sqlite'
  );

  // Fallback path
  const notesDbPathAlt = notesDbPath ?? await findBackupFile(
    backupDir,
    'AppDomainGroup-group.com.apple.notes',
    'NoteStore.sqlite'
  );

  if (!notesDbPathAlt) {
    return { notes: [], total: 0, error: 'NoteStore.sqlite not found in backup.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(notesDbPathAlt, { readonly: true });

    const notes = db.prepare(`
      SELECT
        n.Z_PK as id,
        n.ZTITLE1 as title,
        n.ZSNIPPET as snippet,
        n.ZCREATIONDATE1 as created,
        n.ZMODIFICATIONDATE1 as modified,
        n.ZISPASSWORDPROTECTED as password_protected,
        n.ZISPINNED as pinned
      FROM ZICNOTEDATA nd
      JOIN ZICCLOUDSYNCINGOBJECT n ON n.ZNOTEDATA = nd.Z_PK
      WHERE n.ZMARKEDFORDELETION = 0 OR n.ZMARKEDFORDELETION IS NULL
      ORDER BY n.ZMODIFICATIONDATE1 DESC
    `).all();

    db.close();

    const appleEpochOffset = 978307200;
    const normalized = (notes as Array<Record<string, unknown>>).map((n) => ({
      ...n,
      created: n.created ? new Date((Number(n.created) + appleEpochOffset) * 1000).toISOString() : null,
      modified: n.modified ? new Date((Number(n.modified) + appleEpochOffset) * 1000).toISOString() : null,
    }));

    return { notes: normalized, total: normalized.length };
  } catch (err) {
    return { notes: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Extract voicemail entries from an iOS backup.
 */
export async function extractVoicemail(
  backupDir: string
): Promise<{ voicemails: unknown[]; total: number; error?: string }> {
  const vmDbPath = await findBackupFile(
    backupDir,
    'HomeDomain',
    'Library/Voicemail/voicemail.db'
  );
  if (!vmDbPath) {
    return { voicemails: [], total: 0, error: 'voicemail.db not found in backup.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(vmDbPath, { readonly: true });

    // The transcript column name varies across iOS versions:
    //   - iOS 14+: `transcription` (in `voicemail` table)
    //   - iOS 10-13: stored in a separate `transcript` table joined by ROWID
    //   - older iOS: not present at all
    // Sniff PRAGMA to pick the right column rather than guessing.
    const voicemailCols = (db.prepare('PRAGMA table_info(voicemail)').all() as Array<{ name: string }>)
      .map((c) => c.name.toLowerCase());
    const transcriptCol = ['transcription', 'transcript', 'trans_text', 'text']
      .find((c) => voicemailCols.includes(c));

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map((t) => t.name.toLowerCase());
    const hasTranscriptTable = tables.includes('transcript');

    const transcriptSelect = transcriptCol
      ? `, "${transcriptCol}" as transcription`
      : hasTranscriptTable
        ? `, (SELECT text FROM transcript t WHERE t.voicemail_id = voicemail.ROWID LIMIT 1) as transcription`
        : `, NULL as transcription`;

    const voicemails = db.prepare(`
      SELECT
        ROWID as id,
        sender as phone_number,
        callback_num,
        duration,
        expiration,
        trashed_date,
        flags,
        date,
        token
        ${transcriptSelect}
      FROM voicemail
      ORDER BY date DESC
    `).all();

    db.close();

    const appleEpochOffset = 978307200;
    const normalized = (voicemails as Array<Record<string, unknown>>).map((v) => ({
      ...v,
      transcription: v.transcription ?? '',
      date: v.date ? new Date((Number(v.date) + appleEpochOffset) * 1000).toISOString() : null,
    }));

    return { voicemails: normalized, total: normalized.length };
  } catch (err) {
    return { voicemails: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Extract health data summary from an iOS backup (healthdb.sqlite).
 */
export async function extractHealthData(
  backupDir: string
): Promise<{ categories: unknown[]; samples: unknown[]; total: number; error?: string }> {
  const healthDbPath = await findBackupFile(
    backupDir,
    'HealthDomain',
    'Health/healthdb.sqlite'
  );
  if (!healthDbPath) {
    return { categories: [], samples: [], total: 0, error: 'healthdb.sqlite not found in backup.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(healthDbPath, { readonly: true });

    // Get recent samples with type names
    const samples = db.prepare(`
      SELECT
        s.ROWID as id,
        q.quantity as value,
        q.start_date as start,
        q.end_date as end,
        s.data_type as type_id
      FROM quantity_sample q
      JOIN samples s ON q.ROWID = s.ROWID
      ORDER BY q.start_date DESC
      LIMIT 1000
    `).all();

    // Get category samples (steps, sleep, etc.)
    const catSamples = db.prepare(`
      SELECT
        s.ROWID as id,
        c.value,
        c.start_date as start,
        c.end_date as end,
        s.data_type as type_id
      FROM category_sample c
      JOIN samples s ON c.ROWID = s.ROWID
      ORDER BY c.start_date DESC
      LIMIT 1000
    `).all();

    db.close();

    const appleEpochOffset = 978307200;
    const norm = (arr: Array<Record<string, unknown>>) => arr.map((s) => ({
      ...s,
      start: s.start ? new Date((Number(s.start) + appleEpochOffset) * 1000).toISOString() : null,
      end: s.end ? new Date((Number(s.end) + appleEpochOffset) * 1000).toISOString() : null,
    }));

    const allSamples = [...norm(samples as Array<Record<string, unknown>>), ...norm(catSamples as Array<Record<string, unknown>>)];
    return { categories: [], samples: allSamples, total: allSamples.length };
  } catch (err) {
    return { categories: [], samples: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Extract screen time / app usage from an iOS backup (DeviceUsage.sqlite).
 */
/**
 * Heuristic mapper from a bundle identifier to a high-level category.
 * Apple does not store category in the local Screen Time DB — the live
 * Screen Time UI calls App Store metadata for it. We approximate with a
 * lookup table covering the common social / messaging / streaming bundles
 * forensic examiners care about, falling back to substring matches that
 * catch broad genres ("game", "video", "shop"). Anything unmatched lands
 * in Other.
 */
function categorizeBundleId(bundleId: string): string {
  const id = bundleId.toLowerCase();
  const exact: Record<string, string> = {
    'com.facebook.facebook': 'Social',
    'com.facebook.messenger': 'Communication',
    'com.burbn.instagram': 'Social',
    'com.zhiliaoapp.musically': 'Social',
    'com.atebits.tweetie2': 'Social',
    'com.toyopagroup.picaboo': 'Social',
    'com.reddit.reddit': 'Social',
    'net.whatsapp.whatsapp': 'Communication',
    'org.telegram.telegramios': 'Communication',
    'com.google.gmail': 'Communication',
    'com.apple.mobilemail': 'Communication',
    'com.apple.mobilesafari': 'Utilities',
    'com.google.chrome.ios': 'Utilities',
    'com.google.ios.youtube': 'Entertainment',
    'com.netflix.netflix': 'Entertainment',
    'com.spotify.client': 'Entertainment',
    'com.apple.music': 'Entertainment',
    'com.amazon.aiv.aivapp': 'Entertainment',
    'com.apple.mobilenotes': 'Productivity',
    'com.microsoft.office.outlook': 'Productivity',
    'com.apple.maps': 'Travel',
    'com.google.maps': 'Travel',
  };
  if (exact[id]) return exact[id];
  if (/game|gameloft|playrix|supercell|com\.king\./.test(id)) return 'Games';
  if (/news|nyt|bbc|cnn|washingtonpost/.test(id)) return 'News';
  if (/finance|bank|invest|coinbase|robinhood|venmo|paypal/.test(id)) return 'Finance';
  if (/health|fitness|workout|nike\.run|strava/.test(id)) return 'Health & Fitness';
  if (/shop|amazon|ebay|etsy|shein/.test(id)) return 'Shopping';
  if (/edu|duolingo|kahoot|coursera|khan/.test(id)) return 'Education';
  return 'Other';
}

/**
 * Extract Screen Time usage from `ScreenTimeDeviceUsage.sqlite`. The
 * Apple schema is a Core Data store: ZOBJECT holds polymorphic rows for
 * apps, web domains, app limits, downtime, etc., joined to ZUSAGEBLOCK
 * (per-block usage seconds, with parent device pickup/notification counts).
 *
 * We return the full `{ appUsage, websites, dailySummaries, limits,
 * downtime, stats }` shape the IosScreenTime page expects so it actually
 * has data to display. Time conversion: ZUSAGEBLOCK.ZSTARTDATE is in
 * Apple's CoreData epoch (seconds since 2001-01-01).
 */
export async function extractScreenTime(
  backupDir: string
): Promise<{
  appUsage: unknown[];
  websites: unknown[];
  dailySummaries: unknown[];
  limits: unknown[];
  downtime: unknown[];
  stats: Record<string, unknown> | null;
  total: number;
  error?: string;
}> {
  const empty = {
    appUsage: [], websites: [], dailySummaries: [], limits: [], downtime: [],
    stats: null, total: 0,
  };
  const usageDbPath = await findBackupFile(
    backupDir,
    'HomeDomain',
    'Library/Application Support/com.apple.remotemanagementd/ScreenTimeDeviceUsage.sqlite'
  );
  // Some iOS versions use a slightly different path / filename
  const fallbackDbPath = !usageDbPath
    ? await findBackupFile(backupDir, 'HomeDomain', 'Library/Application Support/com.apple.remotemanagementd/RMAdminStore-Local.sqlite')
    : null;
  const dbPath = usageDbPath ?? fallbackDbPath;
  if (!dbPath) {
    return { ...empty, error: 'Screen Time database not found in backup.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    // Verify ZUSAGEBLOCK + ZOBJECT exist; otherwise we're looking at a
    // non-ScreenTime sqlite that happens to live at the same path.
    const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map((t) => t.name);
    if (!tableNames.includes('ZUSAGEBLOCK') || !tableNames.includes('ZOBJECT')) {
      db.close();
      return { ...empty, error: 'Screen Time schema not found (ZUSAGEBLOCK/ZOBJECT missing).' };
    }

    // Per-app usage rows. Schema notes:
    // - ZOBJECT.Z_ENT identifies the row type; ZCATEGORY 1 = bundle id record
    // - ZBUNDLEIDENTIFIER and ZNAME live on ZOBJECT for app records
    // - ZUSAGEBLOCK.ZSTARTDATE (CoreData epoch) and ZTOTALUSAGE (seconds)
    //   join via ZUSAGEBLOCK.ZUSAGE → ZUSAGE.ZBLOCK / ZUSAGEBLOCK.ZUSAGE
    let appRows: Array<Record<string, unknown>> = [];
    try {
      appRows = db.prepare(`
        SELECT
          ub.Z_PK as block_id,
          ub.ZSTARTDATE as start_date,
          ub.ZTOTALUSAGE as total_usage,
          ub.ZNUMBEROFNOTIFICATIONS as notifications,
          ub.ZNUMBEROFPICKUPS as pickups,
          o.ZBUNDLEIDENTIFIER as bundle_id,
          o.ZNAME as app_name,
          o.ZDOMAIN as domain
        FROM ZUSAGEBLOCK ub
        LEFT JOIN ZOBJECT o ON o.ZBLOCK = ub.Z_PK
        WHERE o.ZBUNDLEIDENTIFIER IS NOT NULL
        ORDER BY ub.ZSTARTDATE DESC
        LIMIT 50000
      `).all() as Array<Record<string, unknown>>;
    } catch {
      // Schema slightly different on this iOS version — fall back to a
      // simpler query that returns any ZUSAGEBLOCK rows we can find.
      try {
        appRows = db.prepare(`
          SELECT
            Z_PK as block_id,
            ZSTARTDATE as start_date,
            ZTOTALUSAGE as total_usage
          FROM ZUSAGEBLOCK
          ORDER BY ZSTARTDATE DESC
          LIMIT 50000
        `).all() as Array<Record<string, unknown>>;
      } catch { /* leave empty */ }
    }

    const appUsage: Array<{
      id: string;
      date: string;
      appName: string;
      bundleId: string;
      category: string;
      usageMinutes: number;
      notificationCount: number;
      pickupCount: number;
    }> = [];
    const websites: Array<{ id: string; date: string; domain: string; usageMinutes: number; category: string }> = [];

    for (const row of appRows) {
      const startSec = Number(row.start_date);
      if (!Number.isFinite(startSec)) continue;
      const date = new Date((startSec + CORE_DATA_EPOCH_OFFSET) * 1000)
        .toISOString()
        .slice(0, 10);
      const minutes = Math.round(Number(row.total_usage ?? 0) / 60);
      if (minutes <= 0) continue;

      const bundleId = String(row.bundle_id ?? '');
      const appName = String(row.app_name ?? bundleId.split('.').pop() ?? 'Unknown');
      const domain = row.domain ? String(row.domain) : '';

      if (domain) {
        websites.push({
          id: `web-${row.block_id}`,
          date,
          domain,
          usageMinutes: minutes,
          category: 'Utilities',
        });
        continue;
      }

      appUsage.push({
        id: `app-${row.block_id}`,
        date,
        appName,
        bundleId,
        category: categorizeBundleId(bundleId),
        usageMinutes: minutes,
        notificationCount: Number(row.notifications ?? 0),
        pickupCount: Number(row.pickups ?? 0),
      });
    }

    db.close();

    // Daily summaries — group appUsage by date and rank top apps + categories.
    const byDate = new Map<string, typeof appUsage>();
    for (const a of appUsage) {
      const list = byDate.get(a.date) ?? [];
      list.push(a);
      byDate.set(a.date, list);
    }
    const dailySummaries = Array.from(byDate.entries())
      .map(([date, dayApps]) => {
        const totalUsageMinutes = dayApps.reduce((s, a) => s + a.usageMinutes, 0);
        const pickupCount = dayApps.reduce((s, a) => s + a.pickupCount, 0);
        const notificationCount = dayApps.reduce((s, a) => s + a.notificationCount, 0);
        const topApps = [...dayApps]
          .sort((a, b) => b.usageMinutes - a.usageMinutes)
          .slice(0, 5)
          .map((a) => ({ appName: a.appName, minutes: a.usageMinutes }));
        const catMap = new Map<string, number>();
        for (const a of dayApps) catMap.set(a.category, (catMap.get(a.category) ?? 0) + a.usageMinutes);
        const categoryBreakdown = Array.from(catMap.entries())
          .map(([category, minutes]) => ({ category, minutes }))
          .sort((a, b) => b.minutes - a.minutes);
        return {
          date,
          totalUsageMinutes,
          pickupCount,
          notificationCount,
          firstPickupTime: '',
          topApps,
          categoryBreakdown,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalDays = dailySummaries.length || 1;
    const stats = {
      totalApps: new Set(appUsage.map((a) => a.bundleId)).size,
      totalDays,
      averageDailyUsage: Math.round(
        dailySummaries.reduce((s, d) => s + d.totalUsageMinutes, 0) / totalDays
      ),
      averageDailyPickups: Math.round(
        dailySummaries.reduce((s, d) => s + d.pickupCount, 0) / totalDays
      ),
      averageDailyNotifications: Math.round(
        dailySummaries.reduce((s, d) => s + d.notificationCount, 0) / totalDays
      ),
      totalWebsites: new Set(websites.map((w) => w.domain)).size,
      appLimitsCount: 0,
      downtimeEnabled: false,
    };

    return {
      appUsage,
      websites,
      dailySummaries,
      limits: [],
      downtime: [],
      stats,
      total: appUsage.length + websites.length,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Normalised location record returned by extractLocationHistory.
 */
interface LocationRecord {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number; // Unix ms
  source: string;
}

/**
 * CoreData / routined epoch offset: seconds between 2001-01-01 and 1970-01-01.
 */
const CORE_DATA_EPOCH_OFFSET = 978307200;

function coredateToUnixMs(coredate: number): number {
  return (coredate + CORE_DATA_EPOCH_OFFSET) * 1000;
}

/**
 * Extract location history from an iOS backup.
 * Supports modern iOS (11+) routined databases as well as the legacy consolidated.db.
 * Results are collected from ALL candidates that succeed and de-duplicated.
 */
export async function extractLocationHistory(
  backupDir: string
): Promise<{ locations: unknown[]; total: number; error?: string }> {
  // Priority chain: modern routined DBs first, legacy consolidated.db as fallback.
  const candidates: Array<[string, string]> = [
    ['AppDomain-com.apple.routined', 'RMAdminStore-Local.sqlite'],
    ['AppDomain-com.apple.routined', 'RMAdminStore-Shared.sqlite'],
    ['RootDomain', 'Library/Caches/locationd/consolidated.db'],
    ['HomeDomain', 'Library/Caches/locationd/consolidated.db'],
  ];

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');

  const allLocations: LocationRecord[] = [];
  const seen = new Set<string>();
  let anyFound = false;

  for (const [domain, relPath] of candidates) {
    const dbPath = await findBackupFile(backupDir, domain, relPath);
    if (!dbPath) continue;

    anyFound = true;
    const isRoutined = relPath.startsWith('RMAdminStore');

    let db: ReturnType<typeof Database> | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch {
      continue;
    }

    try {
      if (isRoutined) {
        // --- Schema A: visit-joined-to-learned-location (iOS 11–14+) ---
        let rows: Array<Record<string, unknown>> = [];
        let usedSchemaA = false;
        try {
          rows = db.prepare(`
            SELECT ZRTVISITMO.ZDEPARTUREDATE, ZRTVISITMO.ZARRIVALDATE,
                   ZRTLEARNEDLOCATIONOFINTERESTMO.ZLATITUDE,
                   ZRTLEARNEDLOCATIONOFINTERESTMO.ZLONGITUDE,
                   ZRTLEARNEDLOCATIONOFINTERESTMO.ZUNCERTAINTYRADIUSINMETERS
            FROM ZRTVISITMO
            JOIN ZRTLEARNEDLOCATIONOFINTERESTMO
              ON ZRTVISITMO.ZLOCATIONOFINTEREST = ZRTLEARNEDLOCATIONOFINTERESTMO.Z_PK
            WHERE ZRTLEARNEDLOCATIONOFINTERESTMO.ZLATITUDE IS NOT NULL
          `).all() as Array<Record<string, unknown>>;
          usedSchemaA = true;
        } catch {
          // table does not exist in this file — fall through to schema B
        }

        if (usedSchemaA) {
          for (const row of rows) {
            const lat = row['ZLATITUDE'] as number | null;
            const lon = row['ZLONGITUDE'] as number | null;
            if (lat == null || lon == null) continue;
            const accuracy = (row['ZUNCERTAINTYRADIUSINMETERS'] as number | null) ?? null;
            const tsRaw = (row['ZDEPARTUREDATE'] ?? row['ZARRIVALDATE']) as number | null;
            const timestamp = tsRaw != null ? coredateToUnixMs(tsRaw) : Date.now();
            const key = `${lat},${lon},${timestamp}`;
            if (!seen.has(key)) {
              seen.add(key);
              allLocations.push({ latitude: lat, longitude: lon, accuracy, timestamp, source: relPath });
            }
          }
        } else {
          // --- Schema B: flat learned-location table (older routined) ---
          try {
            rows = db.prepare(`
              SELECT ZLATITUDE, ZLONGITUDE, ZUNCERTAINTYRADIUSINMETERS, ZSTARTDATE, ZENDDATE
              FROM ZRTLEARNEDLOCATIONOFINTERESTMO
              WHERE ZLATITUDE IS NOT NULL
            `).all() as Array<Record<string, unknown>>;

            for (const row of rows) {
              const lat = row['ZLATITUDE'] as number | null;
              const lon = row['ZLONGITUDE'] as number | null;
              if (lat == null || lon == null) continue;
              const accuracy = (row['ZUNCERTAINTYRADIUSINMETERS'] as number | null) ?? null;
              const tsRaw = (row['ZSTARTDATE'] ?? row['ZENDDATE']) as number | null;
              const timestamp = tsRaw != null ? coredateToUnixMs(tsRaw) : Date.now();
              const key = `${lat},${lon},${timestamp}`;
              if (!seen.has(key)) {
                seen.add(key);
                allLocations.push({ latitude: lat, longitude: lon, accuracy, timestamp, source: relPath });
              }
            }
          } catch {
            // schema not found in this file — skip
          }
        }
      } else {
        // --- Legacy consolidated.db ---
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
        for (const t of tables) {
          try {
            const rows = db.prepare(`SELECT * FROM "${t.name}" LIMIT 500`).all() as Array<Record<string, unknown>>;
            if (!Array.isArray(rows) || rows.length === 0) continue;
            const first = rows[0];
            const hasLatKey = 'Latitude' in first || 'latitude' in first || 'lat' in first;
            const hasLonKey = 'Longitude' in first || 'longitude' in first || 'lon' in first;
            if (!hasLatKey || !hasLonKey) continue;
            for (const row of rows) {
              const lat = (row['Latitude'] ?? row['latitude'] ?? row['lat']) as number | null;
              const lon = (row['Longitude'] ?? row['longitude'] ?? row['lon']) as number | null;
              if (lat == null || lon == null) continue;
              const tsRaw = (row['Timestamp'] ?? row['timestamp'] ?? row['time']) as number | null;
              const timestamp = tsRaw != null ? tsRaw * 1000 : Date.now();
              const key = `${lat},${lon},${timestamp}`;
              if (!seen.has(key)) {
                seen.add(key);
                allLocations.push({ latitude: lat, longitude: lon, accuracy: null, timestamp, source: relPath });
              }
            }
          } catch { continue; }
        }
      }
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  }

  if (!anyFound) {
    return { locations: [], total: 0, error: 'Location database not found in backup. Run a backup and ensure location data is present.' };
  }

  return { locations: allLocations, total: allLocations.length };
}

/**
 * Attempt to find deleted/unallocated records in iOS SQLite databases.
 */
export async function recoverDeletedData(
  backupDir: string
): Promise<{ recovered: unknown[]; total: number; error?: string }> {
  // Query the sms.db for messages flagged as deleted
  const smsDbPath = await findBackupFile(backupDir, 'HomeDomain', 'Library/SMS/sms.db');
  if (!smsDbPath) {
    return { recovered: [], total: 0, error: 'sms.db not found. Run a backup first.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(smsDbPath, { readonly: true });

    // Attempt to read from deleted_messages table if it exists
    let recovered: unknown[] = [];
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    if (tableNames.includes('deleted_messages')) {
      recovered = db.prepare('SELECT * FROM deleted_messages ORDER BY ROWID DESC LIMIT 500').all();
    } else {
      // Look for messages with is_from_me = -1 or similar markers
      recovered = db.prepare(`
        SELECT * FROM message
        WHERE text IS NULL OR text = ''
        ORDER BY date DESC
        LIMIT 200
      `).all();
    }

    db.close();
    return { recovered, total: recovered.length };
  } catch (err) {
    return { recovered: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Browse files inside an iOS backup by listing all entries from Manifest.db.
 */
export async function browseBackupFiles(
  backupDir: string,
  domain?: string
): Promise<{ files: unknown[]; total: number; error?: string }> {
  const manifestPath = path.join(backupDir, 'Manifest.db');
  try {
    await fs.access(manifestPath);
  } catch {
    return { files: [], total: 0, error: 'Manifest.db not found. Run a backup first.' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(manifestPath, { readonly: true });

    let query = 'SELECT fileID, domain, relativePath, flags, file FROM Files';
    const params: unknown[] = [];
    if (domain) {
      query += ' WHERE domain = ?';
      params.push(domain);
    }
    query += ' ORDER BY domain, relativePath LIMIT 5000';

    const files = db.prepare(query).all(...params);
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM Files').get() as { cnt: number };
    db.close();

    return { files, total: countRow.cnt };
  } catch (err) {
    return { files: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Extract a specific file from an iOS backup to a destination path.
 */
export async function extractBackupFile(
  backupDir: string,
  domain: string,
  relativePath: string,
  outputPath: string
): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  const sourcePath = await findBackupFile(backupDir, domain, relativePath);
  if (!sourcePath) {
    return { success: false, error: `File not found: ${domain}/${relativePath}` };
  }

  const destPath = path.join(outputPath, path.basename(relativePath));
  await fs.mkdir(outputPath, { recursive: true });
  await fs.copyFile(sourcePath, destPath);
  return { success: true, outputPath: destPath };
}

// ---------------------------------------------------------------------------
// Activity timeline, location access logs, and network trace
// ---------------------------------------------------------------------------

export interface TimelineEvent {
  id: string;
  type: 'message' | 'call' | 'location' | 'browse' | 'note' | 'photo' | 'voicemail';
  timestamp: number; // Unix ms
  summary: string;
  source: string;
  detail?: Record<string, unknown>;
}

/**
 * Aggregates data from existing extractors into a unified chronological event
 * list sorted newest-first.
 */
export async function extractActivityTimeline(
  backupDir: string
): Promise<{ events: TimelineEvent[]; total: number; error?: string }> {
  const results = await Promise.allSettled([
    extractMessages(backupDir),
    extractCallHistory(backupDir),
    extractLocationHistory(backupDir),
    extractSafariHistory(backupDir),
    extractNotes(backupDir),
  ]);

  const events: TimelineEvent[] = [];

  // Messages — returns { messages: unknown[] }
  // date is already an ISO string after normalization
  if (results[0].status === 'fulfilled') {
    const val = results[0].value as Record<string, unknown>;
    const messages = (val.messages ?? []) as unknown[];
    for (const [idx, msg] of messages.entries()) {
      const m = msg as Record<string, unknown>;
      const ts = typeof m.date === 'string' ? Date.parse(m.date as string) : 0;
      const senderLabel =
        m.is_from_me === 1
          ? 'Me'
          : (typeof m.contact_id === 'string' && m.contact_id ? m.contact_id : 'Contact');
      events.push({
        id: `msg-${m.rowid ?? m.id ?? idx}`,
        type: 'message',
        timestamp: ts,
        summary: `${senderLabel}: ${String(m.text ?? '').substring(0, 80)}`,
        source: 'Messages',
        detail: m,
      });
    }
  }

  // Calls — returns { calls: unknown[] }
  // date is already an ISO string after normalization; address field is phone_number
  if (results[1].status === 'fulfilled') {
    const val = results[1].value as Record<string, unknown>;
    const calls = (val.calls ?? []) as unknown[];
    for (const [idx, call] of calls.entries()) {
      const c = call as Record<string, unknown>;
      const ts = typeof c.date === 'string' ? Date.parse(c.date as string) : 0;
      events.push({
        id: `call-${c.rowid ?? c.id ?? idx}`,
        type: 'call',
        timestamp: ts,
        summary: `${c.answered === 1 ? 'Call' : 'Missed'} ${c.duration ? `(${c.duration}s)` : ''} — ${c.phone_number ?? 'Unknown'}`,
        source: 'Call History',
        detail: c,
      });
    }
  }

  // Locations — returns { locations: unknown[] }
  // timestamp is already Unix ms (a number)
  if (results[2].status === 'fulfilled') {
    const val = results[2].value as Record<string, unknown>;
    const locs = (val.locations ?? []) as unknown[];
    for (const [idx, loc] of locs.entries()) {
      const l = loc as Record<string, unknown>;
      events.push({
        id: `loc-${l.id ?? idx}`,
        type: 'location',
        timestamp: typeof l.timestamp === 'number' ? l.timestamp : 0,
        summary: `Location: ${Number(l.latitude ?? 0).toFixed(5)}, ${Number(l.longitude ?? 0).toFixed(5)}`,
        source: 'Location History',
        detail: l,
      });
    }
  }

  // Safari — returns { history: unknown[] }
  // visit_time is already an ISO string after normalization
  if (results[3].status === 'fulfilled') {
    const val = results[3].value as Record<string, unknown>;
    const hist = (val.history ?? []) as unknown[];
    for (const [idx, visit] of hist.entries()) {
      const v = visit as Record<string, unknown>;
      const ts = typeof v.visit_time === 'string' ? Date.parse(v.visit_time as string) : 0;
      events.push({
        id: `safari-${v.id ?? v.rowid ?? idx}`,
        type: 'browse',
        timestamp: ts,
        summary: `Visited: ${String(v.title ?? v.url ?? 'Unknown').substring(0, 80)}`,
        source: 'Safari',
        detail: v,
      });
    }
  }

  // Notes — returns { notes: unknown[] }
  // created/modified are ISO strings; fields are title and snippet
  if (results[4].status === 'fulfilled') {
    const val = results[4].value as Record<string, unknown>;
    const notes = (val.notes ?? []) as unknown[];
    for (const [idx, note] of notes.entries()) {
      const n = note as Record<string, unknown>;
      const ts = typeof n.created === 'string' ? Date.parse(n.created as string) : 0;
      events.push({
        id: `note-${n.id ?? n.rowid ?? idx}`,
        type: 'note',
        timestamp: ts,
        summary: `Note: ${String(n.title ?? n.snippet ?? '').substring(0, 80)}`,
        source: 'Notes',
        detail: n,
      });
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp);
  return { events, total: events.length };
}

export interface LocationAccessEntry {
  bundleId: string;
  lastAccessTime: number; // Unix ms
  authorizationType: string;
  accessCount: number;
  executable?: string;
}

/**
 * Parses HomeDomain/Library/Caches/locationd/clients.plist which records
 * every app's location authorization status and last access time.
 */
export async function extractLocationAccessLogs(
  backupDir: string
): Promise<{ entries: LocationAccessEntry[]; total: number; error?: string }> {
  const plistPath = await findBackupFile(
    backupDir,
    'HomeDomain',
    'Library/Caches/locationd/clients.plist'
  );

  if (!plistPath) {
    return { entries: [], total: 0, error: 'clients.plist not found in backup' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const plist = require('plist');
    const rawBuffer = await fs.readFile(plistPath);
    // plist.parse accepts a UTF-8 string; works for XML plists and bplist
    const parsed = plist.parse(rawBuffer.toString()) as Record<string, unknown>;

    const entries: LocationAccessEntry[] = [];
    const authMap: Record<number, string> = {
      0: 'NotDetermined', 1: 'Restricted', 2: 'Denied', 3: 'Always', 4: 'WhenInUse',
    };

    for (const [bundleId, data] of Object.entries(parsed)) {
      if (typeof data !== 'object' || data === null) continue;
      const d = data as Record<string, unknown>;
      const authStatus = Number(
        d['Authorized'] ?? d['kCLClientManagerStateAuthorizationStatus'] ?? 0
      );
      const lastUsed = d['LastTimeUsed'] ?? d['lastUsed'];
      entries.push({
        bundleId,
        lastAccessTime: typeof lastUsed === 'number'
          ? (lastUsed + 978307200) * 1000
          : 0,
        authorizationType: authMap[authStatus] ?? `Status${authStatus}`,
        accessCount: Number(d['TimesInterrupted'] ?? d['accessCount'] ?? 0),
        executable: typeof d['BundlePath'] === 'string' ? String(d['BundlePath']) : undefined,
      });
    }

    entries.sort((a, b) => b.lastAccessTime - a.lastAccessTime);
    return { entries, total: entries.length };
  } catch (err) {
    return { entries: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}

export interface NetworkEntry {
  ssid: string;
  bssid?: string;
  securityType?: string;
  lastJoined?: number; // Unix ms
  joinCount?: number;
}

/**
 * Parses SystemPreferencesDomain/SystemConfiguration/com.apple.wifi.plist
 * for known WiFi networks joined by the device.
 */
export async function extractNetworkTrace(
  backupDir: string
): Promise<{ networks: NetworkEntry[]; total: number; error?: string }> {
  const networks: NetworkEntry[] = [];

  const wifiPlistPath = await findBackupFile(
    backupDir,
    'SystemPreferencesDomain',
    'SystemConfiguration/com.apple.wifi.plist'
  );

  if (!wifiPlistPath) {
    return { networks: [], total: 0, error: 'com.apple.wifi.plist not found in backup' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const plist = require('plist');
    const rawBuffer = await fs.readFile(wifiPlistPath);
    // plist.parse accepts a UTF-8 string; works for XML plists and bplist
    const parsed = plist.parse(rawBuffer.toString()) as Record<string, unknown>;

    const knownNetworks = parsed['List of known networks'] as unknown[] | undefined;
    if (Array.isArray(knownNetworks)) {
      for (const net of knownNetworks) {
        const n = net as Record<string, unknown>;
        const ssid = String(n['SSID_STR'] ?? n['SSID'] ?? 'Unknown');
        const lastJoined = n['lastJoined'];
        networks.push({
          ssid,
          bssid: typeof n['BSSID'] === 'string' ? String(n['BSSID']) : undefined,
          securityType: typeof n['SecurityType'] === 'string' ? String(n['SecurityType']) : undefined,
          lastJoined: typeof lastJoined === 'number'
            ? (lastJoined + 978307200) * 1000
            : undefined,
          joinCount: typeof n['joinCount'] === 'number' ? Number(n['joinCount']) : undefined,
        });
      }
    }

    // Deduplicate by SSID
    const seen = new Set<string>();
    const deduped = networks.filter(n => {
      if (seen.has(n.ssid)) return false;
      seen.add(n.ssid);
      return true;
    });

    deduped.sort((a, b) => (b.lastJoined ?? 0) - (a.lastJoined ?? 0));
    return { networks: deduped, total: deduped.length };
  } catch (err) {
    return { networks: [], total: 0, error: (err instanceof Error ? err.message : String(err)) };
  }
}
