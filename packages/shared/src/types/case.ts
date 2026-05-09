/**
 * A forensic case — the top-level container for all evidence, acquisitions,
 * and metadata associated with a single investigation.
 */
export interface ForensicCase {
  /** Unique identifier (UUID v4). */
  id: string;
  /** Human-readable case name. */
  name: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
  /** Absolute path to the case directory on disk. */
  localPath: string;
  /** Name of the forensic examiner who created the case. */
  examinerName: string;
  /** Case reference number (e.g. "CASE-2026-001"). */
  caseNumber: string;
  /** Free-text description of the case. */
  description: string;
  /** Optional examiner notes attached to the case. */
  notes?: string;
  /** Summary of the device under examination, if attached. */
  device?: DeviceSummary;
  /** Ordered list of data acquisitions performed in this case. */
  acquisitions: Acquisition[];
  /** Cloud sync status for this case. */
  syncStatus: SyncStatus;
}

/** Condensed device info stored within a {@link ForensicCase}. */
export interface DeviceSummary {
  /** Device model name (e.g. "Pixel 7", "iPhone 14 Pro"). */
  model: string;
  /** Device manufacturer (e.g. "Google", "Apple"). */
  manufacturer: string;
  /** Device serial number. */
  serial: string;
  /** Operating system version string. */
  osVersion: string;
  /** Mobile platform. */
  platform: 'android' | 'ios';
}

/**
 * A single data acquisition within a forensic case — represents one extraction
 * or processing operation performed on the target device.
 */
export interface Acquisition {
  /** Unique identifier (UUID v4). */
  id: string;
  /** Parent {@link ForensicCase.id}. */
  caseId: string;
  /** Type of acquisition performed. */
  type: AcquisitionType;
  /** ISO 8601 timestamp when the acquisition was started. */
  timestamp: string;
  /** Current status of this acquisition. */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Number of files extracted or processed. */
  fileCount: number;
  /** Total size in bytes of all extracted data. */
  totalSize: number;
  /** Integrity hash log — one entry per file for chain-of-custody verification. */
  hashLog?: HashLogEntry[];
  /** Examiner notes for this specific acquisition. */
  notes: string;
}

export type AcquisitionType =
  | 'adb_backup'
  | 'device_info'
  | 'file_extraction'
  | 'whatsapp_extraction'
  | 'whatsapp_contacts'
  | 'whatsapp_decrypt'
  | 'whatsapp_media'
  | 'whatsapp_parse'
  | 'whatsapp_legacy_parse'
  | 'audio_transcription'
  | 'ios_backup'
  | 'iped_analysis'
  | 'ocr_processing'
  | 'screen_capture'
  | 'media_processing'
  | 'instagram_scraping'
  | 'special_dump'
  | 'trash_recovery'
  | 'samsung_unlock'
  | 'ab_to_tar'
  | 'apk_management'
  | 'bulk_copy'
  | 'hash_generation';

/** A single file-level integrity hash for chain-of-custody verification. */
export interface HashLogEntry {
  /** Relative path of the hashed file within the case directory. */
  filePath: string;
  /** Hash algorithm used. */
  algorithm: HashAlgorithm;
  /** Hex-encoded hash digest. */
  hash: string;
  /** ISO 8601 timestamp when the hash was computed. */
  timestamp: string;
}

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512';

export type SyncStatus = 'local_only' | 'syncing' | 'synced' | 'conflict' | 'error';
