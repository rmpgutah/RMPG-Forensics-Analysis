export const APP_NAME = 'RMPG Forensics Analysis';
// Version is injected by Vite (define plugin) from desktop/package.json at build time.
// Falls back to a literal for unit-test environments where the define is absent.
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.56';
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
  CASE_SAVE_NOTES: 'case:save-notes',
  CASE_EXPORT_PDF: 'case:export-pdf',

  // Error reporting (main -> renderer push)
  ERROR_REPORT: 'error:report',

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
  WHATSAPP_DECRYPT_PROGRESS: 'whatsapp:decrypt-progress',
  WHATSAPP_DECRYPT_MEDIA: 'whatsapp:decrypt-media',
  WHATSAPP_DECRYPT_MEDIA_PROGRESS: 'whatsapp:decrypt-media-progress',
  WHATSAPP_PARSE_DB: 'whatsapp:parse-db',
  WHATSAPP_PARSE_LEGACY_DB: 'whatsapp:parse-legacy-db',
  WHATSAPP_GENERATE_REPORT: 'whatsapp:generate-report',

  // Audio Transcription
  AUDIO_TRANSCRIBE: 'audio:transcribe',
  AUDIO_TRANSCRIBE_PROGRESS: 'audio:transcribe-progress',

  // iOS
  IOS_LIST_DEVICES: 'ios:list-devices',
  IOS_FIND_BACKUP_PATH: 'ios:find-backup-path',
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
  IOS_SAFARI_EXTRACT: 'ios:safari-extract',
  IOS_SAFARI_EXTRACT_PROGRESS: 'ios:safari-extract-progress',
  IOS_NOTES_EXTRACT: 'ios:notes-extract',
  IOS_NOTES_EXTRACT_PROGRESS: 'ios:notes-extract-progress',
  IOS_VOICEMAIL_EXTRACT: 'ios:voicemail-extract',
  IOS_VOICEMAIL_EXTRACT_PROGRESS: 'ios:voicemail-extract-progress',
  IOS_HEALTH_EXTRACT: 'ios:health-extract',
  IOS_HEALTH_EXTRACT_PROGRESS: 'ios:health-extract-progress',
  IOS_SCREENTIME_EXTRACT: 'ios:screentime-extract',
  IOS_SCREENTIME_EXTRACT_PROGRESS: 'ios:screentime-extract-progress',
  IOS_INTELLIGENCE_TIMELINE: 'ios:intelligence-timeline',
  IOS_INTELLIGENCE_TIMELINE_PROGRESS: 'ios:intelligence-timeline-progress',
  IOS_LOCATION_ACCESS: 'ios:location-access',
  IOS_LOCATION_ACCESS_PROGRESS: 'ios:location-access-progress',
  IOS_NETWORK_TRACE: 'ios:network-trace',
  IOS_NETWORK_TRACE_PROGRESS: 'ios:network-trace-progress',

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
  INSTAGRAM_2FA_PROMPT: 'instagram:2fa-prompt',
  INSTAGRAM_2FA_SUBMIT: 'instagram:2fa-submit',

  // Special Dump
  DUMP_LIST_SERVICES: 'dump:list-services',
  DUMP_EXTRACT: 'dump:extract',

  // Trash Recovery
  TRASH_SCAN: 'trash:scan',
  TRASH_RECOVER: 'trash:recover',

  // Samsung Unlock
  SAMSUNG_DETECT_PORT: 'samsung:detect-port',
  SAMSUNG_UNLOCK: 'samsung:unlock',

  // Breach & Bypass — Android lock-screen credential recovery (pure offline)
  LOCKSCREEN_RECOVER: 'breach:lockscreen-recover',
  LOCKSCREEN_RECOVER_PROGRESS: 'breach:lockscreen-recover:progress',

  // Breach & Bypass — Qualcomm EDL Mode imager (wraps edl.py)
  EDL_IMAGE: 'breach:edl-image',
  EDL_IMAGE_PROGRESS: 'breach:edl-image:progress',

  // Breach & Bypass — MediaTek BROM exploit (wraps mtkclient)
  MTK_DUMP: 'breach:mtk-dump',
  MTK_DUMP_PROGRESS: 'breach:mtk-dump:progress',

  // Breach & Bypass — iOS encrypted backup decryptor + keychain extractor
  IOS_BACKUP_DECRYPT: 'breach:ios-backup-decrypt',
  IOS_BACKUP_DECRYPT_PROGRESS: 'breach:ios-backup-decrypt:progress',
  IOS_KEYCHAIN_EXTRACT: 'breach:ios-keychain-extract',

  // Forensic correctness — chain-of-custody viewer
  COC_LIST: 'coc:list',
  COC_EXPORT_PDF: 'coc:export-pdf',

  // Forensic correctness — write-blocker policy notification
  WRITE_BLOCKER_SET: 'write-blocker:set',
  WRITE_BLOCKER_GET: 'write-blocker:get',

  // Hash database matcher (NSRL / Project VIC / custom SQLite)
  HASH_DB_OPEN: 'hash-db:open',
  HASH_DB_LOOKUP: 'hash-db:lookup',
  HASH_DB_SCAN_DIR: 'hash-db:scan-dir',
  HASH_DB_SCAN_DIR_PROGRESS: 'hash-db:scan-dir:progress',

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
  TOOLS_INSTALL: 'tools:install',
  TOOLS_INSTALL_PROGRESS: 'tools:install-progress',

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

  // File system helpers
  FILE_WRITE: 'fs:write-file',

  // Auth extras
  AUTH_TRUST_DEVICE: 'auth:trust-device',

  // (IOS_BACKUP_DECRYPT defined above under Breach & Bypass)

  // Lock Screen Recovery
  LOCK_SCREEN_RECOVER: 'lock-screen:recover',
  LOCK_SCREEN_RECOVER_PROGRESS: 'lock-screen:recover-progress',

  // EDL Imager (Qualcomm)
  EDL_READ: 'edl:read',
  EDL_READ_PROGRESS: 'edl:read-progress',

  // MTK Imager (MediaTek)
  MTK_READ: 'mtk:read',
  MTK_READ_PROGRESS: 'mtk:read-progress',

  // Advanced Decrypt
  ADVANCED_DECRYPT: 'advanced-decrypt:run',
  ADVANCED_DECRYPT_PROGRESS: 'advanced-decrypt:run-progress',

  // Brute Force Attack
  BRUTE_FORCE: 'brute-force:run',
  BRUTE_FORCE_PROGRESS: 'brute-force:run-progress',

  // Network Breach
  NETWORK_BREACH: 'network-breach:run',
  NETWORK_BREACH_PROGRESS: 'network-breach:run-progress',

  // Spy Tactical
  SPY_TACTICAL: 'spy-tactical:run',
  SPY_TACTICAL_PROGRESS: 'spy-tactical:run-progress',

  // iOS Trust & Unlock Bypass
  IOS_TRUST_BYPASS: 'ios-trust:bypass',
  IOS_TRUST_BYPASS_PROGRESS: 'ios-trust:bypass-progress',

  // Android ADB Bypass (no dev mode)
  ANDROID_ADB_BYPASS: 'android-adb:bypass',
  ANDROID_ADB_BYPASS_PROGRESS: 'android-adb:bypass-progress',

  // Force Compliance (full data release)
  FORCE_COMPLIANCE: 'compliance:force',
  FORCE_COMPLIANCE_PROGRESS: 'compliance:force-progress',

  // Live Device View (no backup needed)
  LIVE_VIEW_BROWSE: 'live-view:browse',
  LIVE_VIEW_READ_FILE: 'live-view:read-file',
  LIVE_VIEW_READ_LOGS: 'live-view:read-logs',
  LIVE_VIEW_STREAM: 'live-view:stream',
  LIVE_VIEW_STREAM_PROGRESS: 'live-view:stream-progress',

  // Selective Extraction (no full backup)
  SELECTIVE_EXTRACT: 'selective:extract',
  SELECTIVE_EXTRACT_PROGRESS: 'selective:extract-progress',
  SELECTIVE_SCAN: 'selective:scan',

  // Website Breach
  WEB_BREACH: 'web-breach:run',
  WEB_BREACH_PROGRESS: 'web-breach:run-progress',
  WEB_BREACH_SCAN: 'web-breach:scan',

  // PII Polling
  PII_POLL: 'pii:poll',
  PII_POLL_PROGRESS: 'pii:poll-progress',
  PII_SCAN: 'pii:scan',

  // People Search / Data Collection
  PEOPLE_SEARCH: 'people:search',
  PEOPLE_SEARCH_PROGRESS: 'people:search-progress',
  PEOPLE_SEARCH_BATCH: 'people:search-batch',

  // Python Security Toolkit (open-source tools integration)
  TOOLKIT_RUN: 'toolkit:run',
  TOOLKIT_PROGRESS: 'toolkit:run-progress',
  TOOLKIT_INSTALL: 'toolkit:install',
  TOOLKIT_STATUS: 'toolkit:status',

  // App Downloads
  DOWNLOAD_LIST: 'download:list',
  DOWNLOAD_START: 'download:start',
  DOWNLOAD_PROGRESS: 'download:progress',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_OPEN_FOLDER: 'download:open-folder',

  // App
  APP_GET_PLATFORM: 'app:get-platform',
  APP_GET_VERSION: 'app:get-version',

  // Auto-scan on device connection
  DEVICE_AUTO_SCAN: 'device:auto-scan',

  // AI Forensic Agent
  AI_AGENT_QUERY: 'ai:agent-query',
  AI_AGENT_STREAM: 'ai:agent-stream',

  // Deep iOS extraction — high-value artefacts beyond the standard set:
  // app usage timeline (knowledgeC), calendar, reminders, wallet passes,
  // cellular data usage, bluetooth pairing history.
  IOS_APP_USAGE_EXTRACT: 'ios:app-usage-extract',
  IOS_CALENDAR_EXTRACT: 'ios:calendar-extract',
  IOS_REMINDERS_EXTRACT: 'ios:reminders-extract',
  IOS_WALLET_EXTRACT: 'ios:wallet-extract',
  IOS_CELLULAR_USAGE_EXTRACT: 'ios:cellular-usage-extract',
  IOS_BLUETOOTH_EXTRACT: 'ios:bluetooth-extract',
  // Round 2 deep extractors — high-value forensic artefacts.
  IOS_WHATSAPP_EXTRACT: 'ios:whatsapp-extract',
  IOS_MESSAGE_ATTACHMENTS_EXTRACT: 'ios:message-attachments-extract',
  IOS_APP_INSTALLS_EXTRACT: 'ios:app-installs-extract',
  IOS_KEYBOARD_CACHE_EXTRACT: 'ios:keyboard-cache-extract',
  IOS_AIRDROP_EXTRACT: 'ios:airdrop-extract',
  // Generic registry-driven artefact puller — list & pull any of 20+
  // forensic-relevant files from an iOS backup by id.
  IOS_ARTEFACT_LIST: 'ios:artefact-list',
  IOS_ARTEFACT_PULL: 'ios:artefact-pull',
  // Live iOS — read directly from a connected device, no backup needed.
  // Limited by Apple's sandbox; useful for triage/quick-look.
  IOS_LIVE_INFO: 'ios:live-info',
  IOS_LIVE_DIAGNOSTICS: 'ios:live-diagnostics',
  IOS_LIVE_CRASH_REPORTS: 'ios:live-crash-reports',
  IOS_LIVE_INSTALLED_APPS: 'ios:live-installed-apps',
  IOS_LIVE_SYSLOG: 'ios:live-syslog',

  // Acquisition report — synthesise a single HTML + Markdown report from
  // an acquisition folder's MANIFEST.json + structured artefact JSONs.
  ACQUISITION_REPORT_BUILD: 'acquisition:report-build',

  // Forensic decryption — local-evidence only. Each channel operates on
  // files already on the examiner's disk (acquired backups, forensic
  // copies under their authorisation). No online attacks.
  DECRYPT_IOS_BACKUP_TRY: 'decrypt:ios-backup-try',
  DECRYPT_IOS_BACKUP_DICT: 'decrypt:ios-backup-dict',
  DECRYPT_IOS_BACKUP_DICT_PROGRESS: 'decrypt:ios-backup-dict-progress',
  DECRYPT_ZIP_TRY: 'decrypt:zip-try',
  DECRYPT_ZIP_DICT: 'decrypt:zip-dict',
  DECRYPT_ZIP_DICT_PROGRESS: 'decrypt:zip-dict-progress',
  DECRYPT_ANDROID_GESTURE: 'decrypt:android-gesture',
  DECRYPT_ANDROID_PIN: 'decrypt:android-pin',
  // Incremental brute force — iterate every candidate over a charset
  // (digits / letters / alphanumeric / printable) up to a max length.
  // Target is one of 'ios-backup' | 'zip' (extensible later).
  DECRYPT_BRUTE_FORCE: 'decrypt:brute-force',
  DECRYPT_BRUTE_FORCE_PROGRESS: 'decrypt:brute-force-progress',
  // Estimate the search-space size for a charset+range without running.
  // Powers the UI's "X.YT candidates — infeasible on CPU" warning.
  DECRYPT_BRUTE_FORCE_ESTIMATE: 'decrypt:brute-force-estimate',
  // Live-device lockscreen extraction: pull /data/system/ artefacts via
  // ADB then crack offline. Requires root or recovery-mode access; no
  // bypass of on-device rate limiters.
  DECRYPT_LIVE_ANDROID: 'decrypt:live-android',

  // OSINT & Reconnaissance tools
  SHERLOCK_RUN: 'sherlock:run',
  SHERLOCK_PROGRESS: 'sherlock:progress',
  SPIDERFOOT_RUN: 'spiderfoot:run',
  SPIDERFOOT_PROGRESS: 'spiderfoot:progress',
  HARVESTER_RUN: 'harvester:run',
  HARVESTER_PROGRESS: 'harvester:progress',
  PHONEINFOGA_RUN: 'phoneinfoga:run',
  PHONEINFOGA_PROGRESS: 'phoneinfoga:progress',
  GHUNT_RUN: 'ghunt:run',
  GHUNT_PROGRESS: 'ghunt:progress',
  MAIGRET_RUN: 'maigret:run',
  MAIGRET_PROGRESS: 'maigret:progress',
  HOLEHE_RUN: 'holehe:run',
  HOLEHE_PROGRESS: 'holehe:progress',
  SOCIAL_ANALYZER_RUN: 'social-analyzer:run',
  SOCIAL_ANALYZER_PROGRESS: 'social-analyzer:progress',
  PHOTON_RUN: 'photon:run',
  PHOTON_PROGRESS: 'photon:progress',
  SKIPTRACER_RUN: 'skiptracer:run',
  SKIPTRACER_PROGRESS: 'skiptracer:progress',
  RECONNG_RUN: 'reconng:run',
  RECONNG_PROGRESS: 'reconng:progress',
  MALTEGO_RUN: 'maltego:run',
  MALTEGO_PROGRESS: 'maltego:progress',
  METAGOOFIL_RUN: 'metagoofil:run',
  METAGOOFIL_PROGRESS: 'metagoofil:progress',
  CREEPY_RUN: 'creepy:run',
  CREEPY_PROGRESS: 'creepy:progress',
  TINEYE_RUN: 'tineye:run',
  TINEYE_PROGRESS: 'tineye:progress',
  PLATE_READER_RUN: 'plate-reader:run',
  PLATE_READER_PROGRESS: 'plate-reader:progress',
  COUNTER_SURV_RUN: 'counter-surv:run',
  COUNTER_SURV_PROGRESS: 'counter-surv:progress',
  VEHICLE_TRACK_RUN: 'vehicle-track:run',
  VEHICLE_TRACK_PROGRESS: 'vehicle-track:progress',
  STAKEOUT_RUN: 'stakeout:run',
  STAKEOUT_PROGRESS: 'stakeout:progress',
  DEAD_DROP_RUN: 'dead-drop:run',
  DEAD_DROP_PROGRESS: 'dead-drop:progress',
} as const;

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const;

export const SUPPORTED_IMAGE_FORMATS = ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff'] as const;
export const SUPPORTED_AUDIO_FORMATS = ['.opus', '.mp3', '.wav', '.ogg', '.m4a'] as const;
export const SUPPORTED_VIDEO_FORMATS = ['.mp4', '.avi', '.mkv', '.mov', '.3gp'] as const;
