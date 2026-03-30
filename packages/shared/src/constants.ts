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
  IOS_FILE_EXTRACT: 'ios:file-extract',
  IOS_FILE_EXTRACT_PROGRESS: 'ios:file-extract-progress',
  IOS_FILE_BROWSE: 'ios:file-browse',
  IOS_MESSAGES_EXTRACT: 'ios:messages-extract',
  IOS_MESSAGES_EXTRACT_PROGRESS: 'ios:messages-extract-progress',
  IOS_CALLS_EXTRACT: 'ios:calls-extract',
  IOS_CALLS_EXTRACT_PROGRESS: 'ios:calls-extract-progress',
  IOS_CONTACTS_EXTRACT: 'ios:contacts-extract',
  IOS_CONTACTS_EXTRACT_PROGRESS: 'ios:contacts-extract-progress',
  IOS_PHOTOS_EXTRACT: 'ios:photos-extract',
  IOS_PHOTOS_EXTRACT_PROGRESS: 'ios:photos-extract-progress',
  IOS_PHOTOS_THUMBNAILS: 'ios:photos-thumbnails',
  IOS_APP_DATA: 'ios:app-data',
  IOS_APP_DATA_PROGRESS: 'ios:app-data-progress',
  IOS_APP_DATA_EXTRACT: 'ios:app-data-extract',
  IOS_LOCATION_EXTRACT: 'ios:location-extract',
  IOS_LOCATION_EXTRACT_PROGRESS: 'ios:location-extract-progress',
  IOS_DELETED_RECOVER: 'ios:deleted-recover',
  IOS_DELETED_RECOVER_PROGRESS: 'ios:deleted-recover-progress',

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

  // Auth / 2FA
  AUTH_CHECK_STATUS: 'auth:check-status',
  AUTH_LOGIN: 'auth:login',
  AUTH_SETUP_2FA: 'auth:setup-2fa',
  AUTH_VERIFY_2FA: 'auth:verify-2fa',
  AUTH_RESET_ALL_2FA: 'auth:reset-all-2fa',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_CREATE_USER: 'auth:create-user',
  AUTH_LIST_USERS: 'auth:list-users',

  // Device Mirror
  DEVICE_MIRROR_START: 'device:mirror-start',
  DEVICE_MIRROR_STOP: 'device:mirror-stop',
  DEVICE_MIRROR_STATUS: 'device:mirror-status',

  // File Explorer
  FILE_EXPLORE: 'file:explore',
  FILE_PULL: 'file:pull',
  FILE_PUSH: 'file:push',
  FILE_DELETE: 'file:delete',

  // Geolocation
  GEO_EXTRACT: 'geo:extract',
  GEO_GENERATE_KML: 'geo:generate-kml',

  // Report
  REPORT_GENERATE: 'report:generate',

  // Contacts & SMS
  CONTACTS_EXTRACT: 'contacts:extract',
  SMS_EXTRACT: 'sms:extract',

  // APK Downgrade
  APK_DOWNGRADE: 'apk:downgrade',
  APK_DOWNGRADE_PROGRESS: 'apk:downgrade-progress',

  // Miscellaneous Collections
  MISC_COLLECT: 'misc:collect',

  // WiFi Debug
  WIFI_PAIR: 'wifi:pair',
  WIFI_CONNECT: 'wifi:connect',
  WIFI_DISCONNECT: 'wifi:disconnect',

  // JADX Decompiler
  JADX_DECOMPILE: 'jadx:decompile',

  // MVT Scanner
  MVT_SCAN: 'mvt:scan',

  // Image Finder
  IMAGE_SEARCH: 'image:search',

  // Multi-Device
  MULTI_DEVICE_LIST: 'multi-device:list',
  MULTI_DEVICE_EXECUTE: 'multi-device:execute',

  // Device Reboot / PIN
  DEVICE_REBOOT: 'device:reboot',
  DEVICE_PIN: 'device:pin',

  // SQLite Browser
  SQLITE_OPEN: 'sqlite:open',
  SQLITE_QUERY: 'sqlite:query',

  // EXIF Viewer
  EXIF_READ: 'exif:read',

  // WhatsApp Merge
  WHATSAPP_MERGE: 'whatsapp:merge',

  // App
  APP_GET_PLATFORM: 'app:get-platform',
  APP_GET_VERSION: 'app:get-version',
} as const;

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const;

export const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff'] as const;
export const SUPPORTED_AUDIO_FORMATS = ['.opus', '.mp3', '.wav', '.ogg', '.m4a'] as const;
export const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.avi', '.mkv', '.mov', '.3gp'] as const;
