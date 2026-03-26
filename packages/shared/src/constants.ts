export const APP_NAME = 'RMPG Forensics Analysis';
export const APP_VERSION = '1.0.0';
export const APP_AUTHOR = 'RMPG';

export const IPC_CHANNELS = {
  // Case management
  CASE_CREATE: 'case:create',
  CASE_OPEN: 'case:open',
  CASE_LIST: 'case:list',
  CASE_DELETE: 'case:delete',
  CASE_EXPORT: 'case:export',
  CASE_IMPORT: 'case:import',
  CASE_SET_PATH: 'case:set-path',

  // Dialog
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',
  DIALOG_OPEN_FILE: 'dialog:open-file',
  DIALOG_SAVE_FILE: 'dialog:save-file',

  // ADB
  ADB_LIST_DEVICES: 'adb:list-devices',
  ADB_BACKUP: 'adb:backup',
  ADB_BACKUP_PROGRESS: 'adb:backup-progress',
  ADB_RESTORE: 'adb:restore',
  ADB_SHELL: 'adb:shell',
  ADB_PULL: 'adb:pull',
  ADB_PUSH: 'adb:push',
  ADB_INSTALL: 'adb:install',
  ADB_UNINSTALL: 'adb:uninstall',

  // Device Info
  DEVICE_GET_PROPERTIES: 'device:get-properties',
  DEVICE_GET_IMEI: 'device:get-imei',
  DEVICE_GET_LOCATION: 'device:get-location',
  DEVICE_GET_DISKSTATS: 'device:get-diskstats',
  DEVICE_GET_WIFI: 'device:get-wifi',
  DEVICE_GET_CPU: 'device:get-cpu',
  DEVICE_GET_MEMORY: 'device:get-memory',
  DEVICE_GET_PACKAGES: 'device:get-packages',

  // File Extraction
  FILE_EXTRACT_FORMAT: 'file:extract-format',
  FILE_EXTRACT_PROGRESS: 'file:extract-progress',

  // WhatsApp
  WHATSAPP_EXTRACT: 'whatsapp:extract',
  WHATSAPP_EXTRACT_PROGRESS: 'whatsapp:extract-progress',
  WHATSAPP_LIST_PACKAGES: 'whatsapp:list-packages',
  WHATSAPP_BROWSE_CONTACTS: 'whatsapp:browse-contacts',
  WHATSAPP_DECRYPT: 'whatsapp:decrypt',
  WHATSAPP_DECRYPT_MEDIA: 'whatsapp:decrypt-media',
  WHATSAPP_PARSE_DB: 'whatsapp:parse-db',
  WHATSAPP_PARSE_LEGACY_DB: 'whatsapp:parse-legacy-db',
  WHATSAPP_GENERATE_REPORT: 'whatsapp:generate-report',

  // Audio Transcription
  AUDIO_TRANSCRIBE: 'audio:transcribe',
  AUDIO_TRANSCRIBE_PROGRESS: 'audio:transcribe-progress',

  // iOS
  IOS_LIST_DEVICES: 'ios:list-devices',
  IOS_BACKUP: 'ios:backup',
  IOS_BACKUP_PROGRESS: 'ios:backup-progress',
  IOS_GET_INFO: 'ios:get-info',

  // IPED
  IPED_RUN: 'iped:run',
  IPED_PROGRESS: 'iped:progress',

  // OCR
  OCR_PROCESS: 'ocr:process',
  OCR_PROCESS_PROGRESS: 'ocr:process-progress',

  // Screen Capture
  SCREEN_CAPTURE: 'screen:capture',
  SCREEN_SCROLL_CAPTURE: 'screen:scroll-capture',

  // Media Processing
  MEDIA_PROCESS: 'media:process',
  MEDIA_GENERATE_REPORT: 'media:generate-report',

  // Instagram
  INSTAGRAM_SCRAPE: 'instagram:scrape',
  INSTAGRAM_PROGRESS: 'instagram:progress',

  // Special Dump
  DUMP_LIST_SERVICES: 'dump:list-services',
  DUMP_EXTRACT: 'dump:extract',

  // Trash Recovery
  TRASH_SCAN: 'trash:scan',
  TRASH_RECOVER: 'trash:recover',

  // Samsung Unlock
  SAMSUNG_DETECT_PORT: 'samsung:detect-port',
  SAMSUNG_UNLOCK: 'samsung:unlock',

  // AB to TAR
  AB_CONVERT: 'ab:convert',

  // APK Manager
  APK_INSTALL: 'apk:install',
  APK_UNINSTALL: 'apk:uninstall',
  APK_LIST: 'apk:list',

  // Bulk Copy
  BULK_COPY: 'bulk:copy',
  BULK_COPY_PROGRESS: 'bulk:copy-progress',

  // Hash
  HASH_COMPUTE_FILE: 'hash:compute-file',
  HASH_COMPUTE_DIRECTORY: 'hash:compute-directory',
  HASH_VERIFY: 'hash:verify',

  // Process events (main → renderer)
  PROCESS_LOG: 'process:log',
  PROCESS_PROGRESS: 'process:progress',
  PROCESS_COMPLETE: 'process:complete',
  PROCESS_ERROR: 'process:error',

  // Sync
  SYNC_STATUS: 'sync:status',
  SYNC_UPLOAD: 'sync:upload',
  SYNC_DOWNLOAD: 'sync:download',

  // Tools
  TOOLS_CHECK: 'tools:check',
  TOOLS_CONFIGURE: 'tools:configure',

  // App
  APP_GET_PLATFORM: 'app:get-platform',
  APP_GET_VERSION: 'app:get-version',
} as const;

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const;

export const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff'] as const;
export const SUPPORTED_AUDIO_FORMATS = ['.opus', '.mp3', '.wav', '.ogg', '.m4a'] as const;
export const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.avi', '.mkv', '.mov', '.3gp'] as const;
