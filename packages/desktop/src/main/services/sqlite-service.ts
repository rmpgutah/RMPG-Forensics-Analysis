import Database from 'better-sqlite3';
import type { WhatsAppChat, WhatsAppMessage, WhatsAppContact, WhatsAppMediaType } from '@rmpg/shared';

// Re-export the Database type for callers that need to pass the handle around
export type { Database } from 'better-sqlite3';

/**
 * Open a SQLite database file (read-only by default).
 *
 * WhatsApp databases are typically named msgstore.db or wa.db.
 */
export function openDatabase(dbPath: string, readOnly = true): Database.Database {
  return new Database(dbPath, {
    readonly: readOnly,
    fileMustExist: true,
  });
}

// ---------------------------------------------------------------------------
// Modern schema (WhatsApp ~2021+) - uses chat_view / message_view
// Mirrors the queries from the original C# WhatsParser.cs
// ---------------------------------------------------------------------------

/**
 * Read all chats from a modern WhatsApp msgstore.db.
 *
 * Modern WhatsApp stores chats in the `chat` table joined with `jid` table.
 * chat_view is a common view; we fall back to raw tables if the view is missing.
 */
export function getWhatsAppChats(db: Database.Database): WhatsAppChat[] {
  // Try the view first, then fall back to raw table join
  if (tableExists(db, 'chat_view')) {
    const rows = db
      .prepare(
        `SELECT
           _id AS id,
           raw_string_jid AS jid,
           subject,
           COALESCE(subject, raw_string_jid) AS displayName,
           sort_timestamp AS lastMessageTimestamp,
           0 AS messageCount,
           CASE WHEN raw_string_jid LIKE '%@g.us' THEN 1 ELSE 0 END AS isGroup,
           COALESCE(locked, 0) AS isLocked
         FROM chat_view
         ORDER BY sort_timestamp DESC`
      )
      .all() as RawChatRow[];

    return rows.map(mapChatRow);
  }

  // Fallback: join chat + jid tables directly
  const rows = db
    .prepare(
      `SELECT
         c._id AS id,
         j.raw_string AS jid,
         c.subject,
         COALESCE(c.subject, j.raw_string) AS displayName,
         c.sort_timestamp AS lastMessageTimestamp,
         0 AS messageCount,
         CASE WHEN j.type = 1 THEN 1 ELSE 0 END AS isGroup,
         0 AS isLocked
       FROM chat c
       LEFT JOIN jid j ON c.jid_row_id = j._id
       ORDER BY c.sort_timestamp DESC`
    )
    .all() as RawChatRow[];

  return rows.map(mapChatRow);
}

/**
 * Read messages for a specific chat from modern WhatsApp schema.
 *
 * Modern WhatsApp stores messages in `message` table joined with `jid`.
 * message_view is used when available.
 */
export function getWhatsAppMessages(db: Database.Database, chatId: number): WhatsAppMessage[] {
  if (tableExists(db, 'message_view')) {
    const rows = db
      .prepare(
        `SELECT
           mv._id AS id,
           mv.chat_row_id AS chatId,
           mv.sender_jid_raw_string AS senderJid,
           mv.text_data AS text,
           mv.timestamp,
           mv.from_me AS isFromMe,
           mv.message_type AS mediaTypeCode,
           mv.status,
           mv.quoted_row_id AS quotedMessageId,
           mv.latitude,
           mv.longitude
         FROM message_view mv
         WHERE mv.chat_row_id = ?
         ORDER BY mv.timestamp ASC`
      )
      .all(chatId) as RawMessageRow[];

    return rows.map((row) => mapMessageRow(db, row));
  }

  // Fallback: raw message + jid tables
  const rows = db
    .prepare(
      `SELECT
         m._id AS id,
         m.chat_row_id AS chatId,
         j.raw_string AS senderJid,
         m.text_data AS text,
         m.timestamp,
         m.from_me AS isFromMe,
         m.message_type AS mediaTypeCode,
         m.status,
         m.quoted_row_id AS quotedMessageId,
         m.latitude,
         m.longitude
       FROM message m
       LEFT JOIN jid j ON m.sender_jid_row_id = j._id
       WHERE m.chat_row_id = ?
       ORDER BY m.timestamp ASC`
    )
    .all(chatId) as RawMessageRow[];

  return rows.map((row) => mapMessageRow(db, row));
}

/**
 * Read contacts from WhatsApp's wa_contacts table.
 */
export function getWhatsAppContacts(db: Database.Database): WhatsAppContact[] {
  const tableName = tableExists(db, 'wa_contacts') ? 'wa_contacts' : 'wa_contact';
  if (!tableExists(db, tableName)) {
    return [];
  }

  const rows = db
    .prepare(
      `SELECT
         jid,
         COALESCE(display_name, '') AS displayName,
         COALESCE(number, '') AS phoneNumber,
         COALESCE(status, '') AS statusMessage,
         CASE WHEN is_whatsapp_user = 1 THEN 1 ELSE 0 END AS isWhatsAppUser
       FROM ${tableName}
       ORDER BY display_name ASC`
    )
    .all() as RawContactRow[];

  return rows.map((row) => ({
    jid: row.jid ?? '',
    displayName: row.displayName ?? '',
    phoneNumber: row.phoneNumber ?? '',
    statusMessage: row.statusMessage || undefined,
    isWhatsAppUser: row.isWhatsAppUser === 1,
  }));
}

// ---------------------------------------------------------------------------
// Legacy schema (older WhatsApp versions) - uses messages / chat_list
// ---------------------------------------------------------------------------

/**
 * Read chats from the legacy WhatsApp schema.
 *
 * Legacy versions store chats in `chat_list` with JID directly as a column.
 */
export function getLegacyWhatsAppChats(db: Database.Database): WhatsAppChat[] {
  const tableName = tableExists(db, 'chat_list') ? 'chat_list' : 'wa_chats';

  if (!tableExists(db, tableName)) {
    // Oldest schema: fall back to the "messages" table, group by key_remote_jid
    const rows = db
      .prepare(
        `SELECT
           key_remote_jid AS jid,
           COUNT(*) AS messageCount,
           MAX(timestamp) AS lastMessageTimestamp
         FROM messages
         GROUP BY key_remote_jid
         ORDER BY lastMessageTimestamp DESC`
      )
      .all() as Array<{ jid: string; messageCount: number; lastMessageTimestamp: number }>;

    return rows.map((row, idx) => ({
      id: idx + 1,
      jid: row.jid ?? '',
      subject: '',
      displayName: row.jid ?? '',
      messageCount: row.messageCount ?? 0,
      lastMessageTimestamp: row.lastMessageTimestamp ?? 0,
      isGroup: (row.jid ?? '').includes('@g.us'),
      isLocked: false,
    }));
  }

  const rows = db
    .prepare(
      `SELECT
         _id AS id,
         key_remote_jid AS jid,
         subject,
         COALESCE(subject, key_remote_jid) AS displayName,
         COALESCE(message_count, 0) AS messageCount,
         COALESCE(sort_timestamp, 0) AS lastMessageTimestamp,
         CASE WHEN key_remote_jid LIKE '%@g.us' THEN 1 ELSE 0 END AS isGroup,
         0 AS isLocked
       FROM ${tableName}
       ORDER BY sort_timestamp DESC`
    )
    .all() as RawChatRow[];

  return rows.map(mapChatRow);
}

/**
 * Read messages from the legacy WhatsApp schema.
 *
 * Legacy schema uses the `messages` table with key_remote_jid to identify the chat.
 */
export function getLegacyWhatsAppMessages(
  db: Database.Database,
  chatId: number
): WhatsAppMessage[] {
  // In legacy schema, chatId is often a row index. We look up the JID first.
  // If chat_list exists, use it to map chatId -> jid
  let jid: string | undefined;

  if (tableExists(db, 'chat_list')) {
    const chatRow = db
      .prepare('SELECT key_remote_jid FROM chat_list WHERE _id = ?')
      .get(chatId) as { key_remote_jid: string } | undefined;
    jid = chatRow?.key_remote_jid;
  }

  // If we couldn't resolve jid from chat_list, try wa_chats
  if (!jid && tableExists(db, 'wa_chats')) {
    const chatRow = db
      .prepare('SELECT key_remote_jid FROM wa_chats WHERE _id = ?')
      .get(chatId) as { key_remote_jid: string } | undefined;
    jid = chatRow?.key_remote_jid;
  }

  // Fallback: use chatId as-is if it looks like a jid was passed
  const whereClause = jid
    ? `key_remote_jid = ?`
    : `key_remote_jid = (SELECT key_remote_jid FROM messages GROUP BY key_remote_jid LIMIT 1 OFFSET ?)`;
  const param = jid || chatId - 1;

  const rows = db
    .prepare(
      `SELECT
         _id AS id,
         key_remote_jid AS chatJid,
         COALESCE(remote_resource, key_remote_jid) AS senderJid,
         COALESCE(data, '') AS text,
         timestamp,
         key_from_me AS isFromMe,
         media_wa_type AS mediaTypeCode,
         media_url AS mediaUrl,
         media_mime_type AS mediaMimeType,
         media_size AS mediaSize,
         status,
         quoted_row_id AS quotedMessageId,
         latitude,
         longitude
       FROM messages
       WHERE ${whereClause}
       ORDER BY timestamp ASC`
    )
    .all(param) as RawLegacyMessageRow[];

  return rows.map((row) => ({
    id: row.id,
    chatId,
    senderJid: row.senderJid ?? '',
    senderName: '',
    timestamp: row.timestamp ?? 0,
    text: row.text ?? '',
    mediaType: mapLegacyMediaType(row.mediaTypeCode),
    mediaUrl: row.mediaUrl || undefined,
    mediaMimeType: row.mediaMimeType || undefined,
    mediaSize: row.mediaSize || undefined,
    isFromMe: row.isFromMe === 1,
    quotedMessageId: row.quotedMessageId || undefined,
    latitude: row.latitude || undefined,
    longitude: row.longitude || undefined,
    status: row.status ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

interface RawChatRow {
  id: number;
  jid: string;
  subject: string | null;
  displayName: string;
  messageCount: number;
  lastMessageTimestamp: number;
  isGroup: number;
  isLocked: number;
}

interface RawMessageRow {
  id: number;
  chatId: number;
  senderJid: string | null;
  text: string | null;
  timestamp: number;
  isFromMe: number;
  mediaTypeCode: number | null;
  status: number;
  quotedMessageId: number | null;
  latitude: number | null;
  longitude: number | null;
}

interface RawLegacyMessageRow {
  id: number;
  chatJid: string;
  senderJid: string | null;
  text: string | null;
  timestamp: number;
  isFromMe: number;
  mediaTypeCode: number | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaSize: number | null;
  status: number;
  quotedMessageId: number | null;
  latitude: number | null;
  longitude: number | null;
}

interface RawContactRow {
  jid: string;
  displayName: string;
  phoneNumber: string;
  statusMessage: string | null;
  isWhatsAppUser: number;
}

function mapChatRow(row: RawChatRow): WhatsAppChat {
  return {
    id: row.id,
    jid: row.jid ?? '',
    subject: row.subject ?? '',
    displayName: row.displayName ?? row.jid ?? '',
    messageCount: row.messageCount ?? 0,
    lastMessageTimestamp: row.lastMessageTimestamp ?? 0,
    isGroup: row.isGroup === 1,
    isLocked: row.isLocked === 1,
  };
}

/**
 * Map modern message_type codes to WhatsAppMediaType.
 * Codes from WhatsApp's protobuf schema.
 */
function mapModernMediaType(code: number | null): WhatsAppMediaType | undefined {
  if (code === null || code === undefined) return undefined;
  switch (code) {
    case 0:  return undefined; // text
    case 1:  return 'image';
    case 2:  return 'audio';
    case 3:  return 'video';
    case 4:  return 'contact';
    case 5:  return 'location';
    case 8:  return 'document';
    case 9:  return 'voice_note';
    case 13: return 'sticker';
    case 15: return 'location'; // live location
    default: return undefined;
  }
}

/**
 * Map legacy media_wa_type codes to WhatsAppMediaType.
 */
function mapLegacyMediaType(code: number | null): WhatsAppMediaType | undefined {
  if (code === null || code === undefined) return undefined;
  switch (code) {
    case 0:  return undefined; // text
    case 1:  return 'image';
    case 2:  return 'audio';
    case 3:  return 'video';
    case 4:  return 'contact';
    case 5:  return 'location';
    case 8:  return 'document';
    case 9:  return 'document'; // misc file
    case 13: return 'sticker';
    default: return undefined;
  }
}

/**
 * Try to look up media info from the message_media table (modern schema).
 */
function getMediaInfo(
  db: Database.Database,
  messageId: number
): { mediaUrl?: string; mediaMimeType?: string; mediaSize?: number; mediaLocalPath?: string } {
  if (!tableExists(db, 'message_media')) return {};
  const row = db
    .prepare(
      `SELECT
         file_path AS mediaLocalPath,
         mime_type AS mediaMimeType,
         file_length AS mediaSize,
         media_key_timestamp
       FROM message_media
       WHERE message_row_id = ?`
    )
    .get(messageId) as
    | { mediaLocalPath: string | null; mediaMimeType: string | null; mediaSize: number | null }
    | undefined;

  if (!row) return {};
  return {
    mediaLocalPath: row.mediaLocalPath || undefined,
    mediaMimeType: row.mediaMimeType || undefined,
    mediaSize: row.mediaSize || undefined,
  };
}

function mapMessageRow(db: Database.Database, row: RawMessageRow): WhatsAppMessage {
  const media = getMediaInfo(db, row.id);

  return {
    id: row.id,
    chatId: row.chatId,
    senderJid: row.senderJid ?? '',
    senderName: '',
    timestamp: row.timestamp ?? 0,
    text: row.text ?? '',
    mediaType: mapModernMediaType(row.mediaTypeCode),
    mediaUrl: media.mediaUrl,
    mediaLocalPath: media.mediaLocalPath,
    mediaMimeType: media.mediaMimeType,
    mediaSize: media.mediaSize,
    isFromMe: row.isFromMe === 1,
    quotedMessageId: row.quotedMessageId || undefined,
    latitude: row.latitude || undefined,
    longitude: row.longitude || undefined,
    status: row.status ?? 0,
  };
}
