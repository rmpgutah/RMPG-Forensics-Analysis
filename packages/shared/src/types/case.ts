export interface ForensicCase {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  localPath: string;
  examinerName: string;
  caseNumber: string;
  description: string;
  device?: DeviceSummary;
  acquisitions: Acquisition[];
  syncStatus: SyncStatus;
}

export interface DeviceSummary {
  model: string;
  manufacturer: string;
  serial: string;
  osVersion: string;
  platform: 'android' | 'ios';
}

export interface Acquisition {
  id: string;
  caseId: string;
  type: AcquisitionType;
  timestamp: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  fileCount: number;
  totalSize: number;
  hashLog?: HashLogEntry[];
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

export interface HashLogEntry {
  filePath: string;
  algorithm: HashAlgorithm;
  hash: string;
  timestamp: string;
}

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512';

export type SyncStatus = 'local_only' | 'syncing' | 'synced' | 'conflict' | 'error';
