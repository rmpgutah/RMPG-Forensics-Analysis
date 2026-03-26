import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import * as sqliteService from '../services/sqlite-service';

/**
 * Register WhatsApp contact/media browsing IPC handlers.
 *
 * Maps to the original FormColetasWhats.cs functionality for browsing
 * extracted WhatsApp databases to view contacts and related information.
 */
export function registerWhatsAppBrowserHandlers(): void {
  // ---------------------------------------------------------------------------
  // WHATSAPP_BROWSE_CONTACTS - Read contacts from a WhatsApp database
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_BROWSE_CONTACTS,
    async (_event, dbPath: string) => {
      let db: ReturnType<typeof sqliteService.openDatabase> | null = null;
      try {
        db = sqliteService.openDatabase(dbPath, true);
        return sqliteService.getWhatsAppContacts(db);
      } finally {
        if (db) {
          db.close();
        }
      }
    }
  );
}
