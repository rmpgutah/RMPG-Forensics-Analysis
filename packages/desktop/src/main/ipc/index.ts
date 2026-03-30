import { registerDialogHandlers } from './dialog-handlers';
import { registerCaseHandlers } from './case-handlers';
import { registerAdbHandlers } from './adb-handlers';
import { registerDeviceInfoHandlers } from './device-info-handlers';
import { registerWhatsAppHandlers } from './whatsapp-handlers';
import { registerWhatsAppBrowserHandlers } from './whatsapp-browser-handlers';
import { registerWhatsAppDecryptHandlers } from './whatsapp-decrypt-handlers';
import { registerWhatsAppParserHandlers } from './whatsapp-parser-handlers';
import { registerAudioTranscriptionHandlers } from './audio-transcription-handlers';
import { registerIosHandlers } from './ios-handlers';
import { registerIpedHandlers } from './iped-handlers';
import { registerOcrHandlers } from './ocr-handlers';
import { registerScreenshotHandlers } from './screenshot-handlers';
import { registerMediaProcessHandlers } from './media-process-handlers';
import { registerInstagramHandlers } from './instagram-handlers';
import { registerSpecialDumpHandlers } from './special-dump-handlers';
import { registerTrashRecoveryHandlers } from './trash-recovery-handlers';
import { registerSamsungUnlockHandlers } from './samsung-unlock-handlers';
import { registerAbTarHandlers } from './ab-tar-handlers';
import { registerApkHandlers } from './apk-handlers';
import { registerCopyAllHandlers } from './copy-all-handlers';
import { registerFileExtractHandlers } from './file-extract-handlers';
import { registerHashHandlers } from './hash-handlers';
import { registerToolsHandlers } from './tools-handlers';
import { registerSyncHandlers } from './sync-handlers';
import { registerAuthHandlers } from './auth-handlers';

/**
 * Register all IPC handlers for the main process.
 *
 * This function must be called once during application startup (after
 * Electron's `app.whenReady()` resolves) to wire up every ipcMain.handle()
 * that the renderer process may invoke via ipcRenderer.invoke().
 *
 * Each module registers handlers for a specific domain of functionality,
 * mapping IPC channel names from `@rmpg/shared/constants` to the
 * corresponding service methods in `../services/`.
 */
export function registerAllIpcHandlers(): void {
  // Native dialogs
  registerDialogHandlers();

  // Case management
  registerCaseHandlers();

  // Android Debug Bridge (ADB)
  registerAdbHandlers();
  registerDeviceInfoHandlers();

  // WhatsApp forensics
  registerWhatsAppHandlers();
  registerWhatsAppBrowserHandlers();
  registerWhatsAppDecryptHandlers();
  registerWhatsAppParserHandlers();

  // Audio transcription
  registerAudioTranscriptionHandlers();

  // iOS forensics
  registerIosHandlers();

  // IPED integration
  registerIpedHandlers();

  // OCR processing
  registerOcrHandlers();

  // Screen capture
  registerScreenshotHandlers();

  // Media processing and reporting
  registerMediaProcessHandlers();

  // Instagram scraping
  registerInstagramHandlers();

  // Android dumpsys extraction
  registerSpecialDumpHandlers();

  // Trash/deleted file recovery
  registerTrashRecoveryHandlers();

  // Samsung device operations (Windows only)
  registerSamsungUnlockHandlers();

  // AB to TAR conversion
  registerAbTarHandlers();

  // APK management
  registerApkHandlers();

  // Bulk file copy from device
  registerCopyAllHandlers();

  // File format extraction
  registerFileExtractHandlers();

  // Hash computation and verification
  registerHashHandlers();

  // Tool management and app info
  registerToolsHandlers();

  // Firebase cloud sync
  registerSyncHandlers();

  // Authentication & 2FA
  registerAuthHandlers();
}
