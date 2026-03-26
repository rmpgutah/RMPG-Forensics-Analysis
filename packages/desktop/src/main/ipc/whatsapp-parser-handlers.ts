import * as path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as sqliteService from '../services/sqlite-service';
import * as reportGenerator from '../services/report-generator';

/**
 * Register WhatsApp database parsing IPC handlers.
 *
 * Maps to the original WhatsParser.cs and WhatsParserAntigocs.cs functionality.
 * Reads WhatsApp msgstore.db files (both modern and legacy schemas) and
 * generates HTML reports with chat conversations.
 */
export function registerWhatsAppParserHandlers(): void {
  // ---------------------------------------------------------------------------
  // WHATSAPP_PARSE_DB - Parse a modern WhatsApp msgstore.db
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_PARSE_DB,
    async (
      _event,
      options: {
        dbPath: string;
        outputDir: string;
      }
    ) => {
      const { dbPath, outputDir } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PROCESS_PROGRESS, progress);
        }
      };

      let db: ReturnType<typeof sqliteService.openDatabase> | null = null;

      try {
        sendProgress('Opening WhatsApp database...');
        db = sqliteService.openDatabase(dbPath, true);

        // Read chats
        sendProgress('Reading chats...');
        const chats = sqliteService.getWhatsAppChats(db);
        sendProgress(`Found ${chats.length} chats.`);

        // Read messages for each chat
        sendProgress('Reading messages...');
        const messages = new Map<number, ReturnType<typeof sqliteService.getWhatsAppMessages>>();
        let totalMessages = 0;

        for (const chat of chats) {
          const chatMessages = sqliteService.getWhatsAppMessages(db, chat.id);
          messages.set(chat.id, chatMessages);
          totalMessages += chatMessages.length;
        }

        sendProgress(`Parsed ${totalMessages} messages across ${chats.length} chats.`);

        // Read contacts if a contacts database exists alongside
        let contacts: ReturnType<typeof sqliteService.getWhatsAppContacts> = [];
        try {
          const contactsDbPath = path.join(path.dirname(dbPath), 'wa.db');
          const contactsDb = sqliteService.openDatabase(contactsDbPath, true);
          contacts = sqliteService.getWhatsAppContacts(contactsDb);
          contactsDb.close();
          sendProgress(`Found ${contacts.length} contacts.`);
        } catch {
          sendProgress('No separate contacts database found. Proceeding without contact names.');
        }

        // Enrich messages with contact display names
        const contactMap = new Map(contacts.map((c) => [c.jid, c.displayName]));
        for (const [, chatMessages] of messages) {
          for (const msg of chatMessages) {
            if (!msg.senderName && msg.senderJid) {
              msg.senderName = contactMap.get(msg.senderJid) ?? '';
            }
          }
        }

        return {
          chats,
          messages: Object.fromEntries(messages),
          contacts,
          totalMessages,
        };
      } finally {
        if (db) {
          db.close();
        }
      }
    }
  );

  // ---------------------------------------------------------------------------
  // WHATSAPP_PARSE_LEGACY_DB - Parse a legacy WhatsApp msgstore.db
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_PARSE_LEGACY_DB,
    async (
      _event,
      options: {
        dbPath: string;
        outputDir: string;
      }
    ) => {
      const { dbPath } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PROCESS_PROGRESS, progress);
        }
      };

      let db: ReturnType<typeof sqliteService.openDatabase> | null = null;

      try {
        sendProgress('Opening legacy WhatsApp database...');
        db = sqliteService.openDatabase(dbPath, true);

        // Read chats using legacy schema
        sendProgress('Reading chats (legacy schema)...');
        const chats = sqliteService.getLegacyWhatsAppChats(db);
        sendProgress(`Found ${chats.length} chats.`);

        // Read messages for each chat
        sendProgress('Reading messages (legacy schema)...');
        const messages = new Map<number, ReturnType<typeof sqliteService.getLegacyWhatsAppMessages>>();
        let totalMessages = 0;

        for (const chat of chats) {
          const chatMessages = sqliteService.getLegacyWhatsAppMessages(db, chat.id);
          messages.set(chat.id, chatMessages);
          totalMessages += chatMessages.length;
        }

        sendProgress(`Parsed ${totalMessages} messages across ${chats.length} chats (legacy).`);

        return {
          chats,
          messages: Object.fromEntries(messages),
          contacts: [],
          totalMessages,
        };
      } finally {
        if (db) {
          db.close();
        }
      }
    }
  );

  // ---------------------------------------------------------------------------
  // WHATSAPP_GENERATE_REPORT - Generate an HTML report from parsed data
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_GENERATE_REPORT,
    async (
      _event,
      options: {
        dbPath: string;
        outputPath: string;
        title?: string;
        legacy?: boolean;
      }
    ) => {
      const { dbPath, outputPath, title, legacy } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.PROCESS_PROGRESS, progress);
        }
      };

      let db: ReturnType<typeof sqliteService.openDatabase> | null = null;

      try {
        sendProgress('Opening database for report generation...');
        db = sqliteService.openDatabase(dbPath, true);

        const chats = legacy
          ? sqliteService.getLegacyWhatsAppChats(db)
          : sqliteService.getWhatsAppChats(db);

        const messages = new Map<number, ReturnType<typeof sqliteService.getWhatsAppMessages>>();
        for (const chat of chats) {
          const chatMessages = legacy
            ? sqliteService.getLegacyWhatsAppMessages(db, chat.id)
            : sqliteService.getWhatsAppMessages(db, chat.id);
          messages.set(chat.id, chatMessages);
        }

        sendProgress(`Generating report for ${chats.length} chats...`);

        const reportPath = await reportGenerator.generateWhatsAppReport({
          chats,
          messages,
          outputPath,
          title: title ?? 'WhatsApp Forensic Report',
        });

        sendProgress(`Report generated: ${reportPath}`);

        return { success: true, reportPath };
      } finally {
        if (db) {
          db.close();
        }
      }
    }
  );
}
