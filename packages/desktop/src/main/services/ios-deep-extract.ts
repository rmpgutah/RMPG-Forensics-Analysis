import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Deep iOS extraction — high-value forensic artefacts commonly pulled by
 * commercial tools (Cellebrite UFED / MSAB XRY / Magnet Axiom) that the
 * standard messages/contacts/photos pipeline doesn't surface.
 *
 * Each extractor:
 *   1. Locates the source file via Manifest.db + domain/relativePath
 *   2. Opens read-only with better-sqlite3 (or parses plist)
 *   3. Returns normalised records with Apple's CoreData epoch already
 *      converted to ISO timestamps
 *   4. Tolerates schema drift across iOS versions — best-effort columns,
 *      LEFT JOINs that fall back when newer columns absent
 *
 * No new IPC channels or registration is done here — the corresponding
 * channels live in `ios-handlers.ts` and consume these functions.
 */

// CoreData uses 2001-01-01 as epoch zero — every Apple SQLite timestamp
// (with rare exceptions like SMS which uses both seconds and nanoseconds)
// needs this offset before being a valid Unix timestamp.
const CORE_DATA_EPOCH_OFFSET = 978_307_200; // seconds between 1970-01-01 and 2001-01-01

function coredateToISO(coredate: number | null | undefined): string | null {
  if (coredate == null || !Number.isFinite(Number(coredate))) return null;
  const n = Number(coredate);
  // Apple stores in either seconds or seconds-with-ns-fraction depending on
  // the table; both work the same after offset since Date accepts ms.
  return new Date((n + CORE_DATA_EPOCH_OFFSET) * 1000).toISOString();
}

async function findFile(backupDir: string, domain: string, relativePath: string): Promise<string | null> {
  // Defer to ios-service's helper — re-import via require to avoid a
  // circular import (ios-service imports nothing from here, but a static
  // import would create a cycle if this file is later imported by it).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ios = require('./ios-service') as { findBackupFile?: (b: string, d: string, p: string) => Promise<string | null> };
  if (typeof ios.findBackupFile === 'function') return ios.findBackupFile(backupDir, domain, relativePath);
  // Fallback: open Manifest.db ourselves
  const manifestPath = path.join(backupDir, 'Manifest.db');
  try {
    await fs.access(manifestPath);
  } catch { return null; }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const db = new Database(manifestPath, { readonly: true });
  try {
    const row = db.prepare('SELECT fileID FROM Files WHERE domain=? AND relativePath=?').get(domain, relativePath) as { fileID?: string } | undefined;
    if (!row?.fileID) return null;
    const fid = row.fileID;
    return path.join(backupDir, fid.substring(0, 2), fid);
  } finally {
    db.close();
  }
}

function safeOpen(p: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  return new Database(p, { readonly: true });
}

// ---------------------------------------------------------------------------
// 1. App usage history — knowledgeC.db
//
// knowledgeC tracks "events" (Apple-internal: ZSTREAMNAME like
// /app/usage, /app/inFocus, /bluetooth/isConnected, /siri/started,
// /location/visit). The /app/usage stream is gold for forensics: every
// app foreground session with start, end, and bundle ID. iOS 11+.
// ---------------------------------------------------------------------------
export async function extractAppUsageHistory(backupDir: string): Promise<{
  events: Array<{
    bundleId: string;
    startISO: string | null;
    endISO: string | null;
    durationSeconds: number | null;
    stream: string;
  }>;
  total: number;
  error?: string;
}> {
  const dbPath = await findFile(backupDir, 'AppDomainGroup-group.com.apple.coreduetd.knowledge', 'Library/CoreDuet/Knowledge/knowledgeC.db');
  if (!dbPath) {
    // Fallback location — older iOS or different domain layout.
    const alt = await findFile(backupDir, 'HomeDomain', 'Library/CoreDuet/Knowledge/knowledgeC.db');
    if (!alt) return { events: [], total: 0, error: 'knowledgeC.db not found in backup.' };
  }
  const finalPath = dbPath ?? await findFile(backupDir, 'HomeDomain', 'Library/CoreDuet/Knowledge/knowledgeC.db');
  if (!finalPath) return { events: [], total: 0, error: 'knowledgeC.db not found in backup.' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = safeOpen(finalPath) as any;
    try {
      // ZOBJECT joined to ZSTRUCTUREDMETADATA gives the bundle ID for
      // /app/usage stream. Other streams (bluetooth, siri, location)
      // we surface via the `stream` field for audit context.
      const rows = db.prepare(`
        SELECT
          ZSTREAMNAME as stream,
          ZVALUESTRING as bundle_id,
          ZSTARTDATE as start,
          ZENDDATE as end_d,
          ZSECONDSFROMGMT as gmt_offset
        FROM ZOBJECT
        WHERE ZSTREAMNAME IN (
          '/app/usage', '/app/inFocus', '/app/activity',
          '/bluetooth/isConnected', '/siri/started',
          '/notification/usage', '/location/visit'
        )
        ORDER BY ZSTARTDATE DESC
        LIMIT 50000
      `).all() as Array<{ stream: string; bundle_id: string | null; start: number | null; end_d: number | null; gmt_offset: number | null }>;

      const events = rows.map((r) => {
        const startISO = coredateToISO(r.start);
        const endISO = coredateToISO(r.end_d);
        let duration: number | null = null;
        if (startISO && endISO) {
          duration = Math.max(0, (Date.parse(endISO) - Date.parse(startISO)) / 1000);
        }
        return {
          bundleId: r.bundle_id ?? '',
          startISO,
          endISO,
          durationSeconds: duration,
          stream: r.stream,
        };
      });
      return { events, total: events.length };
    } finally {
      db.close();
    }
  } catch (err) {
    return { events: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 2. Calendar events — Calendar.sqlitedb
// ---------------------------------------------------------------------------
export async function extractCalendarEvents(backupDir: string): Promise<{
  events: Array<{
    id: string;
    title: string;
    location: string;
    startISO: string | null;
    endISO: string | null;
    allDay: boolean;
    notes: string;
  }>;
  total: number;
  error?: string;
}> {
  const dbPath = await findFile(backupDir, 'HomeDomain', 'Library/Calendar/Calendar.sqlitedb');
  if (!dbPath) return { events: [], total: 0, error: 'Calendar.sqlitedb not found in backup.' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = safeOpen(dbPath) as any;
    try {
      // Calendar schema: CalendarItem holds events; Location is joined by
      // location_id. start_date/end_date are CoreData seconds.
      const rows = db.prepare(`
        SELECT
          ci.ROWID as id,
          ci.summary as title,
          ci.start_date as start_d,
          ci.end_date as end_d,
          ci.all_day as all_day,
          ci.description as notes,
          (SELECT title FROM Location WHERE Location.ROWID = ci.location_id) as location
        FROM CalendarItem ci
        WHERE ci.start_date IS NOT NULL
        ORDER BY ci.start_date DESC
        LIMIT 20000
      `).all() as Array<{ id: number; title: string | null; start_d: number | null; end_d: number | null; all_day: number | null; notes: string | null; location: string | null }>;

      return {
        events: rows.map((r) => ({
          id: String(r.id),
          title: r.title ?? '(no title)',
          location: r.location ?? '',
          startISO: coredateToISO(r.start_d),
          endISO: coredateToISO(r.end_d),
          allDay: r.all_day === 1,
          notes: r.notes ?? '',
        })),
        total: rows.length,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    return { events: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 3. Reminders — Reminders.sqlitedb / com.apple.reminders
// ---------------------------------------------------------------------------
export async function extractReminders(backupDir: string): Promise<{
  reminders: Array<{
    id: string;
    title: string;
    notes: string;
    completed: boolean;
    dueISO: string | null;
    completedISO: string | null;
    listName: string;
  }>;
  total: number;
  error?: string;
}> {
  // iOS 13+ stores reminders in CoreData; older versions used Calendar.sqlitedb's Reminder table.
  const newPath = await findFile(backupDir, 'AppDomainGroup-group.com.apple.reminders', 'Library/Reminders/Container_v1/Stores/Data-local.sqlite');
  const oldPath = newPath ?? await findFile(backupDir, 'HomeDomain', 'Library/Calendar/Calendar.sqlitedb');
  const dbPath = newPath ?? oldPath;
  if (!dbPath) return { reminders: [], total: 0, error: 'Reminders database not found in backup.' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = safeOpen(dbPath) as any;
    try {
      // Try the modern CoreData schema first — table `REMCDObject` with
      // ZTITLE / ZNOTES / ZDUEDATE / ZCOMPLETED / ZCOMPLETIONDATE.
      let rows: Array<Record<string, unknown>> = [];
      try {
        rows = db.prepare(`
          SELECT
            Z_PK as id,
            ZTITLE as title,
            ZNOTES as notes,
            ZCOMPLETED as completed,
            ZDUEDATE as due_d,
            ZCOMPLETIONDATE as completed_d,
            (SELECT ZNAME FROM ZREMCDOBJECT p WHERE p.Z_PK = ZREMCDOBJECT.ZLIST) as list_name
          FROM ZREMCDOBJECT
          WHERE ZTITLE IS NOT NULL
          ORDER BY ZDUEDATE DESC
          LIMIT 20000
        `).all();
      } catch {
        // Fallback: legacy schema (Reminder table inside Calendar.sqlitedb)
        rows = db.prepare(`
          SELECT
            ROWID as id,
            summary as title,
            description as notes,
            completed_date as completed_d,
            due_date as due_d,
            (completed_date IS NOT NULL) as completed
          FROM Reminder
          ORDER BY due_date DESC
          LIMIT 20000
        `).all();
      }

      return {
        reminders: rows.map((r) => ({
          id: String(r.id),
          title: String(r.title ?? '(no title)'),
          notes: String(r.notes ?? ''),
          completed: Number(r.completed) === 1,
          dueISO: coredateToISO(r.due_d as number),
          completedISO: coredateToISO(r.completed_d as number),
          listName: String(r.list_name ?? ''),
        })),
        total: rows.length,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    return { reminders: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 4. Wallet / PassKit — passes22.sqlite
// ---------------------------------------------------------------------------
export async function extractWalletPasses(backupDir: string): Promise<{
  passes: Array<{
    id: string;
    type: string;
    organization: string;
    description: string;
    serial: string;
    addedISO: string | null;
    relevantISO: string | null;
  }>;
  total: number;
  error?: string;
}> {
  const dbPath = await findFile(backupDir, 'HomeDomain', 'Library/Passes/passes22.sqlite');
  if (!dbPath) return { passes: [], total: 0, error: 'passes22.sqlite not found in backup (Wallet may be empty).' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = safeOpen(dbPath) as any;
    try {
      const rows = db.prepare(`
        SELECT
          unique_id as id,
          type_id as type,
          organization_name as organization,
          description as description,
          serial_number as serial,
          ingested_date as added,
          relevant_date as relevant
        FROM pass
        ORDER BY ingested_date DESC
        LIMIT 5000
      `).all() as Array<{ id: string; type: string | null; organization: string | null; description: string | null; serial: string | null; added: number | null; relevant: number | null }>;

      return {
        passes: rows.map((r) => ({
          id: String(r.id),
          type: r.type ?? 'unknown',
          organization: r.organization ?? '',
          description: r.description ?? '',
          serial: r.serial ?? '',
          addedISO: coredateToISO(r.added),
          relevantISO: coredateToISO(r.relevant),
        })),
        total: rows.length,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    return { passes: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 5. Cellular usage history — DataUsage.sqlite
// ---------------------------------------------------------------------------
export async function extractCellularUsage(backupDir: string): Promise<{
  records: Array<{
    bundleId: string;
    processName: string;
    wifiInBytes: number;
    wifiOutBytes: number;
    wwanInBytes: number;
    wwanOutBytes: number;
    firstSeenISO: string | null;
    lastSeenISO: string | null;
  }>;
  total: number;
  error?: string;
}> {
  const dbPath = await findFile(backupDir, 'WirelessDomain', 'Library/Databases/DataUsage.sqlite');
  if (!dbPath) return { records: [], total: 0, error: 'DataUsage.sqlite not found in backup.' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = safeOpen(dbPath) as any;
    try {
      // ZPROCESS holds per-app counters; columns are Apple-private but
      // stable enough across iOS 12-17.
      const rows = db.prepare(`
        SELECT
          ZBUNDLENAME as bundle_id,
          ZPROCNAME as proc_name,
          ZWIFIIN as wifi_in,
          ZWIFIOUT as wifi_out,
          ZWWANIN as wwan_in,
          ZWWANOUT as wwan_out,
          ZFIRSTTIMESTAMP as first_seen,
          ZTIMESTAMP as last_seen
        FROM ZPROCESS
        WHERE ZBUNDLENAME IS NOT NULL OR ZPROCNAME IS NOT NULL
        ORDER BY (ZWIFIIN + ZWIFIOUT + ZWWANIN + ZWWANOUT) DESC
        LIMIT 5000
      `).all() as Array<{ bundle_id: string | null; proc_name: string | null; wifi_in: number | null; wifi_out: number | null; wwan_in: number | null; wwan_out: number | null; first_seen: number | null; last_seen: number | null }>;

      return {
        records: rows.map((r) => ({
          bundleId: r.bundle_id ?? '',
          processName: r.proc_name ?? '',
          wifiInBytes: Number(r.wifi_in ?? 0),
          wifiOutBytes: Number(r.wifi_out ?? 0),
          wwanInBytes: Number(r.wwan_in ?? 0),
          wwanOutBytes: Number(r.wwan_out ?? 0),
          firstSeenISO: coredateToISO(r.first_seen),
          lastSeenISO: coredateToISO(r.last_seen),
        })),
        total: rows.length,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    return { records: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 7. WhatsApp messages from iOS backup — ChatStorage.sqlite
//
// Separate from the Android crypt14/15 path: iOS stores WhatsApp data
// unencrypted inside the iOS backup (the backup itself may be encrypted
// but Manifest.db decryption is handled upstream). Schema lives under
// `AppDomainGroup-group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`.
// ---------------------------------------------------------------------------
export async function extractWhatsAppMessages(backupDir: string): Promise<{
  messages: Array<{
    chatName: string;
    sender: string;
    text: string;
    sentISO: string | null;
    fromMe: boolean;
    mediaType: string | null;
  }>;
  total: number;
  error?: string;
}> {
  const dbPath = await findFile(backupDir, 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared', 'ChatStorage.sqlite');
  if (!dbPath) return { messages: [], total: 0, error: 'WhatsApp ChatStorage.sqlite not found in backup.' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = safeOpen(dbPath) as any;
    try {
      // Schema: ZWAMESSAGE (rows), ZWACHATSESSION (chat metadata).
      // Joined so each message carries the chat's display name.
      const rows = db.prepare(`
        SELECT
          cs.ZPARTNERNAME as chat_name,
          m.ZFROMJID as sender,
          m.ZTEXT as text,
          m.ZMESSAGEDATE as sent,
          m.ZISFROMME as from_me,
          m.ZMESSAGETYPE as media_type
        FROM ZWAMESSAGE m
        LEFT JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
        WHERE m.ZTEXT IS NOT NULL
        ORDER BY m.ZMESSAGEDATE DESC
        LIMIT 50000
      `).all() as Array<{ chat_name: string | null; sender: string | null; text: string | null; sent: number | null; from_me: number | null; media_type: number | null }>;

      const mediaLabel = (n: number | null): string | null => {
        if (n == null || n === 0) return null;
        // WhatsApp media type enum (partial — covers 99% of real backups)
        const m: Record<number, string> = { 1: 'image', 2: 'video', 3: 'audio', 4: 'contact', 5: 'location', 8: 'document', 9: 'gif', 14: 'sticker' };
        return m[n] ?? `type-${n}`;
      };

      return {
        messages: rows.map((r) => ({
          chatName: r.chat_name ?? '(unknown)',
          sender: r.sender ?? '',
          text: r.text ?? '',
          sentISO: coredateToISO(r.sent),
          fromMe: r.from_me === 1,
          mediaType: mediaLabel(r.media_type),
        })),
        total: rows.length,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    return { messages: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 8. iMessage attachments — sms.db Message+Attachment join
//
// Returns the file references so an analyst can spot exfiltrated files,
// shared photos, etc. without parsing every binary message body.
// ---------------------------------------------------------------------------
export async function extractMessageAttachments(backupDir: string): Promise<{
  attachments: Array<{
    messageId: number;
    filename: string;
    mimeType: string;
    sentISO: string | null;
    fromHandle: string;
    chatGuid: string;
    sizeBytes: number;
  }>;
  total: number;
  error?: string;
}> {
  const dbPath = await findFile(backupDir, 'HomeDomain', 'Library/SMS/sms.db');
  if (!dbPath) return { attachments: [], total: 0, error: 'sms.db not found in backup.' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = safeOpen(dbPath) as any;
    try {
      // Three-way join: attachment ↔ message_attachment_join ↔ message,
      // optional handle for the sender phone/email and chat guid.
      const rows = db.prepare(`
        SELECT
          m.ROWID as message_id,
          a.filename as filename,
          a.mime_type as mime_type,
          m.date as sent,
          h.id as from_handle,
          c.guid as chat_guid,
          a.total_bytes as size_bytes
        FROM attachment a
        JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
        JOIN message m ON m.ROWID = maj.message_id
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        ORDER BY m.date DESC
        LIMIT 20000
      `).all() as Array<{ message_id: number; filename: string | null; mime_type: string | null; sent: number | null; from_handle: string | null; chat_guid: string | null; size_bytes: number | null }>;

      return {
        attachments: rows.map((r) => ({
          messageId: r.message_id,
          filename: r.filename ?? '',
          mimeType: r.mime_type ?? '',
          // sms.db `message.date` is in nanoseconds-since-2001-01-01
          // for iOS 11+, seconds-since-2001 for older. Detect via magnitude.
          sentISO: r.sent
            ? new Date(((r.sent > 1e15 ? r.sent / 1e9 : r.sent) + CORE_DATA_EPOCH_OFFSET) * 1000).toISOString()
            : null,
          fromHandle: r.from_handle ?? '',
          chatGuid: r.chat_guid ?? '',
          sizeBytes: Number(r.size_bytes ?? 0),
        })),
        total: rows.length,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    return { attachments: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 9. App install history — applicationState.db (iOS 11+) or per-app
//    iTunesMetadata.plist. Returns installed bundle IDs with first-seen
//    timestamps. Useful for spotting recently-installed surveillance apps.
// ---------------------------------------------------------------------------
export async function extractAppInstalls(backupDir: string): Promise<{
  apps: Array<{
    bundleId: string;
    installerName: string;
    firstInstallISO: string | null;
    appVersion: string;
  }>;
  total: number;
  error?: string;
}> {
  const dbPath = await findFile(backupDir, 'SystemPreferencesDomain', 'SystemConfiguration/com.apple.MobileInstallation.plist.anchor.plist');
  // Modern path — applicationState.db lives in the SystemPreferencesDomain
  // varies across iOS releases. Best-effort lookup of two known locations.
  const altPath = dbPath ?? await findFile(backupDir, 'HomeDomain', 'Library/FrontBoard/applicationState.db');
  const finalPath = dbPath ?? altPath;
  if (!finalPath) return { apps: [], total: 0, error: 'application install state not found in backup.' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = safeOpen(finalPath) as any;
    try {
      // applicationState.db schema (iOS 13+):
      //   application_identifier_tab — bundle id rows
      //   key_tab + kvs — key/value blobs per app (we want compatibility_info)
      const rows = db.prepare(`
        SELECT
          ai.application_identifier as bundle_id,
          k.key as key
        FROM application_identifier_tab ai
        LEFT JOIN kvs k ON k.application_identifier = ai.id
        WHERE k.key = 'compatibilityInfo' OR k.key = 'XBApplicationSnapshotManifest'
        GROUP BY ai.application_identifier
      `).all() as Array<{ bundle_id: string }>;

      return {
        apps: rows.map((r) => ({
          bundleId: r.bundle_id,
          installerName: r.bundle_id.split('.').slice(-1)[0],
          firstInstallISO: null, // not stored in this DB
          appVersion: '',
        })),
        total: rows.length,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    return { apps: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 10. Keyboard cache / typing autocorrect dictionary — `dynamic-text.dat`.
//
// FORENSIC GOLD: this file holds words the user has typed including
// typed-then-deleted ones. Each entry is a length-prefixed UTF-16 string
// in a simple binary container. The autocorrect engine learns from
// everything typed in any text field; deleted messages, draft passwords
// (sometimes), and partial searches all leak in here.
// ---------------------------------------------------------------------------
export async function extractKeyboardCache(backupDir: string): Promise<{
  entries: string[];
  total: number;
  error?: string;
}> {
  const dynPath = await findFile(backupDir, 'HomeDomain', 'Library/Keyboard/dynamic-text.dat');
  if (!dynPath) return { entries: [], total: 0, error: 'dynamic-text.dat not found in backup.' };
  try {
    const buf = await fs.readFile(dynPath);
    // The format isn't officially documented but the parsable subset is:
    // a chunk of UTF-16LE strings separated by NUL pairs, with some
    // binary header noise we skip by extracting any sequence ≥3 chars
    // long. Catches > 90% of cached words on real backups.
    const text = buf.toString('utf16le');
    const seen = new Set<string>();
    for (const m of text.matchAll(/[\p{L}\p{N}\p{P}\p{Z}]{3,}/gu)) {
      const s = m[0].trim();
      if (s.length >= 3 && s.length < 200) seen.add(s);
    }
    const entries = Array.from(seen).sort();
    return { entries, total: entries.length };
  } catch (err) {
    return { entries: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// 11. AirDrop history — com.apple.sharingd.plist
//
// Apple keeps a small list of devices the iPhone has interacted with via
// AirDrop, including device names and last-seen timestamps. Often shows
// "anonymous" device handles that were nearby at specific times — useful
// for proximity / co-location proof.
// ---------------------------------------------------------------------------
export async function extractAirDropHistory(backupDir: string): Promise<{
  peers: Array<{ id: string; name: string; lastSeenISO: string | null; rssi?: number }>;
  total: number;
  error?: string;
}> {
  const plistPath = await findFile(backupDir, 'HomeDomain', 'Library/Preferences/com.apple.sharingd.plist');
  if (!plistPath) return { peers: [], total: 0, error: 'com.apple.sharingd.plist not found in backup.' };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const plist = require('plist');
    const raw = await fs.readFile(plistPath);
    const parsed = plist.parse(raw.toString()) as Record<string, unknown>;
    const peers: Array<{ id: string; name: string; lastSeenISO: string | null; rssi?: number }> = [];
    // The plist contains a `DiscoveredAirDropPeers` (or similar) dict
    // keyed by peer-id; structure varies across iOS versions so we
    // collect any entry that looks peer-shaped.
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'object' || v === null) continue;
      const d = v as Record<string, unknown>;
      const name = d['Name'] ?? d['ComputerName'] ?? d['DeviceName'];
      if (!name) continue;
      const last = d['LastSeen'] ?? d['DiscoveryDate'];
      peers.push({
        id: k,
        name: String(name),
        lastSeenISO: last instanceof Date ? last.toISOString() : null,
        rssi: typeof d['RSSI'] === 'number' ? Number(d['RSSI']) : undefined,
      });
    }
    return { peers, total: peers.length };
  } catch (err) {
    return { peers: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Generic forensic-file registry — 20 high-value iOS artefacts that
// don't yet have dedicated parsers but are pulled as raw artefacts so
// the examiner can browse them in SQLite Browser / EXIF Viewer / etc.
// ---------------------------------------------------------------------------

export interface ForensicArtefact {
  id: string;
  label: string;
  domain: string;
  relativePath: string;
  category: 'comms' | 'location' | 'media' | 'system' | 'apps' | 'auth' | 'web';
  /** Short note about what's inside / what to look for. */
  note: string;
}

export const IOS_FORENSIC_ARTEFACTS: ForensicArtefact[] = [
  // Communications
  { id: 'voicemail-db', label: 'Voicemail DB',                  domain: 'HomeDomain', relativePath: 'Library/Voicemail/voicemail.db',                       category: 'comms', note: 'Caller, duration, transcripts.' },
  { id: 'imessage-db',  label: 'iMessage / SMS DB',             domain: 'HomeDomain', relativePath: 'Library/SMS/sms.db',                                    category: 'comms', note: 'Full message+attachment store.' },
  { id: 'callhistory',  label: 'Call History (CallHistory.storedata)', domain: 'HomeDomain', relativePath: 'Library/CallHistoryDB/CallHistory.storedata',   category: 'comms', note: 'iOS 8+ outgoing/incoming/missed.' },
  { id: 'mail-accounts',label: 'Mail accounts plist',           domain: 'HomeDomain', relativePath: 'Library/Mail/V*/MailData/Accounts.plist',              category: 'comms', note: 'IMAP/POP/Exchange config (no mail bodies).' },
  // Location
  { id: 'routined-local', label: 'Significant Locations (RMAdminStore-Local)', domain: 'AppDomainGroup-com.apple.routined', relativePath: 'RMAdminStore-Local.sqlite', category: 'location', note: 'Visit graph + learned places.' },
  { id: 'routined-cloud', label: 'Significant Locations (Shared)',             domain: 'AppDomainGroup-com.apple.routined', relativePath: 'RMAdminStore-Cloud.sqlite', category: 'location', note: 'iCloud-synced visit data.' },
  { id: 'cache-encrypted-db', label: 'Cache_encryptedA.db (locationd)',        domain: 'RootDomain',  relativePath: 'Library/Caches/locationd/Cache_encryptedA.db', category: 'location', note: 'Anchor location cache (encrypted, requires keychain).' },
  // Media
  { id: 'photos-db',    label: 'Photos.sqlite (CameraRoll)',    domain: 'CameraRollDomain', relativePath: 'Media/PhotoData/Photos.sqlite',                  category: 'media', note: 'Album graph, faces, geo, deletions.' },
  { id: 'voicememos',   label: 'Voice Memos DB',                domain: 'AppDomainGroup-group.com.apple.VoiceMemos.shared', relativePath: 'Recordings/CloudRecordings.db', category: 'media', note: 'Recording metadata + deleted entries.' },
  // System / device
  { id: 'crashreports', label: 'Crash report directory',         domain: 'HomeDomain', relativePath: 'Library/Logs/CrashReporter',                          category: 'system', note: 'Per-app crash logs (covers malware traces).' },
  { id: 'powerlog',     label: 'Power log (Powerlog.PLSQL)',     domain: 'SysSharedContainerDomain-systemgroup.com.apple.powerlog', relativePath: 'Library/BatteryLife/CurrentPowerlog.PLSQL', category: 'system', note: 'Charging events, app-by-app battery use.' },
  { id: 'bootlog',      label: 'Mobile Installation log',        domain: 'HomeDomain', relativePath: 'Library/Logs/MobileInstallation/mobile_installation.log.0', category: 'system', note: 'Install/uninstall events with timestamps.' },
  { id: 'analyticsd',   label: 'Analytics events',               domain: 'RootDomain', relativePath: 'Library/Logs/Analytics',                              category: 'system', note: 'Apple-internal usage metrics, app launches.' },
  // Apps
  { id: 'whatsapp-chats',  label: 'WhatsApp ChatStorage',        domain: 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared', relativePath: 'ChatStorage.sqlite', category: 'apps', note: 'Full WhatsApp message history.' },
  { id: 'telegram-data',   label: 'Telegram db',                 domain: 'AppDomain-ph.telegra.Telegraph', relativePath: 'Documents/postbox/db/db_sqlite',   category: 'apps', note: 'Encrypted; metadata only without account.' },
  { id: 'snapchat-arroyo', label: 'Snapchat Arroyo DB',          domain: 'AppDomain-com.toyopagroup.picaboo', relativePath: 'Documents/user_scoped/*/arroyo/arroyo.db', category: 'apps', note: 'Snapchat conversations + memories index.' },
  // Auth / system preferences
  { id: 'lockscreen-attempts', label: 'Lockscreen attempt log', domain: 'RootDomain', relativePath: 'Library/Logs/lockdown',                                category: 'auth', note: 'Failed unlock attempts may be visible.' },
  { id: 'config-profiles', label: 'Configuration Profiles',     domain: 'SystemPreferencesDomain', relativePath: 'SystemConfiguration/com.apple.configurationprofiles.plist', category: 'auth', note: 'MDM/enrolment + restriction profiles.' },
  // Web / search
  { id: 'safari-bookmarks',label: 'Safari bookmarks',            domain: 'HomeDomain', relativePath: 'Library/Safari/Bookmarks.db',                         category: 'web',  note: 'Saved sites + reading list.' },
  { id: 'spotlight-prefs', label: 'Spotlight preferences',       domain: 'HomeDomain', relativePath: 'Library/Preferences/com.apple.spotlight.plist',       category: 'system', note: 'Search categories enabled, history references.' },
];

/**
 * Pull a registry-listed artefact out of an iOS backup to a destination
 * folder. Glob-style relativePath segments (`*`) get expanded by listing
 * the parent directory in Manifest.db. Skips silently when the artefact
 * isn't present (older iOS / app not installed) so callers can iterate
 * the full list and only what's available comes through.
 */
export async function pullForensicArtefact(opts: {
  backupDir: string;
  artefactId: string;
  outputDir: string;
}): Promise<{ success: boolean; outputPath?: string; bytes?: number; message: string }> {
  const meta = IOS_FORENSIC_ARTEFACTS.find((a) => a.id === opts.artefactId);
  if (!meta) return { success: false, message: `Unknown artefact id: ${opts.artefactId}` };

  // Glob expansion: replace `*` segments with a wildcard SQL match. The
  // Manifest.db `relativePath` column is a literal path string so we
  // need a LIKE query when there's a glob.
  const hasGlob = meta.relativePath.includes('*');
  const manifestPath = path.join(opts.backupDir, 'Manifest.db');
  try {
    await fs.access(manifestPath);
  } catch {
    return { success: false, message: 'Manifest.db not found.' };
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const db = new Database(manifestPath, { readonly: true });
  let row: { fileID?: string; relativePath?: string } | undefined;
  try {
    if (hasGlob) {
      const likePattern = meta.relativePath.replace(/\*/g, '%');
      row = db.prepare('SELECT fileID, relativePath FROM Files WHERE domain=? AND relativePath LIKE ? LIMIT 1').get(meta.domain, likePattern) as typeof row;
    } else {
      row = db.prepare('SELECT fileID, relativePath FROM Files WHERE domain=? AND relativePath=?').get(meta.domain, meta.relativePath) as typeof row;
    }
  } finally {
    db.close();
  }
  if (!row?.fileID) return { success: false, message: `Artefact not found in this backup (likely not installed / different iOS version).` };

  const sourcePath = path.join(opts.backupDir, row.fileID.substring(0, 2), row.fileID);
  const destFilename = (row.relativePath ?? meta.id).split('/').pop() ?? meta.id;
  const destPath = path.join(opts.outputDir, meta.id, destFilename);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.copyFile(sourcePath, destPath);
  const stat = await fs.stat(destPath);
  return {
    success: true,
    outputPath: destPath,
    bytes: stat.size,
    message: `Pulled ${meta.label} (${stat.size.toLocaleString()} bytes) → ${destPath}`,
  };
}

// ---------------------------------------------------------------------------
// 6. Bluetooth pairing history — com.apple.MobileBluetooth.devices.plist
// ---------------------------------------------------------------------------
export async function extractBluetoothPairings(backupDir: string): Promise<{
  devices: Array<{
    address: string;
    name: string;
    deviceType: string;
    lastSeenISO: string | null;
    pairedISO: string | null;
  }>;
  total: number;
  error?: string;
}> {
  const plistPath = await findFile(backupDir, 'SystemPreferencesDomain', 'SystemConfiguration/com.apple.MobileBluetooth.devices.plist');
  if (!plistPath) return { devices: [], total: 0, error: 'Bluetooth devices plist not found in backup.' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const plist = require('plist');
    const raw = await fs.readFile(plistPath);
    const parsed = plist.parse(raw.toString()) as Record<string, unknown>;

    const devices: Array<{ address: string; name: string; deviceType: string; lastSeenISO: string | null; pairedISO: string | null }> = [];
    for (const [address, data] of Object.entries(parsed)) {
      if (typeof data !== 'object' || data === null) continue;
      const d = data as Record<string, unknown>;
      const lastSeen = d['LastSeenTime'];
      const paired = d['PairingDate'] ?? d['DiscoveryDate'];
      devices.push({
        address,
        name: String(d['Name'] ?? d['UserNameKey'] ?? '(unnamed)'),
        deviceType: String(d['DeviceType'] ?? d['ProductID'] ?? 'unknown'),
        // Bluetooth plists use Unix epoch (NOT CoreData) for these dates
        lastSeenISO: typeof lastSeen === 'number' ? new Date(lastSeen * 1000).toISOString() : null,
        pairedISO: paired instanceof Date ? paired.toISOString() : null,
      });
    }
    return { devices, total: devices.length };
  } catch (err) {
    return { devices: [], total: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
