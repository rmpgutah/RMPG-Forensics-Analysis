export interface WhatsAppChat {
  id: number;
  jid: string;
  subject: string;
  displayName: string;
  messageCount: number;
  lastMessageTimestamp: number;
  isGroup: boolean;
  isLocked: boolean;
}

export interface WhatsAppMessage {
  id: number;
  chatId: number;
  senderJid: string;
  senderName: string;
  timestamp: number;
  text: string;
  mediaType?: WhatsAppMediaType;
  mediaUrl?: string;
  mediaLocalPath?: string;
  mediaMimeType?: string;
  mediaSize?: number;
  isFromMe: boolean;
  quotedMessageId?: number;
  latitude?: number;
  longitude?: number;
  status: number;
}

export type WhatsAppMediaType =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'contact'
  | 'location'
  | 'voice_note';

export interface WhatsAppContact {
  jid: string;
  displayName: string;
  phoneNumber: string;
  statusMessage?: string;
  profilePicturePath?: string;
  isWhatsAppUser: boolean;
}

export interface WhatsAppExtractionConfig {
  packageName: string;
  downgradApkPath?: string;
  extractContacts: boolean;
  extractMedia: boolean;
  extractDatabases: boolean;
}

export const WHATSAPP_PACKAGES = [
  'com.whatsapp',
  'com.whatsapp.w4b',
  'com.gbwhatsapp',
] as const;

export interface WhatsAppDecryptConfig {
  cryptFilePath: string;
  keyFilePath: string;
  outputPath: string;
  cryptVersion: 'crypt14' | 'crypt15';
}

export interface WhatsAppParseResult {
  chats: WhatsAppChat[];
  totalMessages: number;
  reportPath: string;
  databasePath: string;
}
