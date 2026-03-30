import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import * as crypto from 'crypto';

interface UserRecord {
  username: string;
  passwordHash: string;
  salt: string;
  totpSecret: string | null;
  twoFactorEnabled: boolean;
  mustReset2FA: boolean;
  createdAt: string;
  lastLogin: string | null;
}

interface TrustedDevice {
  token: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

interface AuthDB {
  users: UserRecord[];
  trustedDevices: TrustedDevice[];
  version: number;
}

const AUTH_DB_FILE = 'auth.json';
const ENCRYPTION_KEY_LEN = 32;

function getAuthDbPath(): string {
  const dir = join(app.getPath('userData'), 'auth');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, AUTH_DB_FILE);
}

function loadDb(): AuthDB {
  const path = getAuthDbPath();
  if (!existsSync(path)) {
    const defaultDb: AuthDB = { users: [], trustedDevices: [], version: 1 };
    saveDb(defaultDb);
    return defaultDb;
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function saveDb(db: AuthDB): void {
  writeFileSync(getAuthDbPath(), JSON.stringify(db, null, 2));
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

// Base32 encoding/decoding for TOTP (RFC 4648)
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str: string): Buffer {
  const cleaned = str.replace(/[=\s]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_CHARS.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function verifyTOTP(base32Secret: string, token: string): boolean {
  const secretBuffer = base32Decode(base32Secret);
  // Allow 1 step drift (30s before or after)
  for (let drift = -1; drift <= 1; drift++) {
    const epoch = Math.floor(Date.now() / 1000) + drift * 30;
    const counter = Math.floor(epoch / 30);
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(0, 0);
    buffer.writeUInt32BE(counter, 4);

    const hmac = crypto.createHmac('sha1', secretBuffer).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    const expected = String(code % 1000000).padStart(6, '0');
    if (expected === token) return true;
  }
  return false;
}

export interface AuthStatus {
  hasUsers: boolean;
  isLoggedIn: boolean;
  currentUser: string | null;
  requires2FASetup: boolean;
  requires2FAVerify: boolean;
}

let currentSession: { username: string; authenticated: boolean; needs2FA: boolean } | null = null;

export function checkAuthStatus(): AuthStatus {
  const db = loadDb();
  return {
    hasUsers: db.users.length > 0,
    isLoggedIn: currentSession?.authenticated ?? false,
    currentUser: currentSession?.username ?? null,
    requires2FASetup: currentSession?.needs2FA
      ? (db.users.find((u) => u.username === currentSession!.username)?.mustReset2FA ?? false)
      : false,
    requires2FAVerify: currentSession !== null && !currentSession.authenticated,
  };
}

export function createUser(username: string, password: string): { success: boolean; error?: string } {
  const db = loadDb();
  if (db.users.find((u) => u.username === username)) {
    return { success: false, error: 'User already exists' };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  db.users.push({
    username,
    passwordHash: hashPassword(password, salt),
    salt,
    totpSecret: null,
    twoFactorEnabled: false,
    mustReset2FA: true, // Force 2FA setup on first login
    createdAt: new Date().toISOString(),
    lastLogin: null,
  });
  saveDb(db);
  return { success: true };
}

export function login(
  username: string,
  password: string,
): { success: boolean; needs2FASetup?: boolean; needs2FAVerify?: boolean; error?: string } {
  const db = loadDb();
  const user = db.users.find((u) => u.username === username);
  if (!user) return { success: false, error: 'Invalid credentials' };

  const hash = hashPassword(password, user.salt);
  if (hash !== user.passwordHash) return { success: false, error: 'Invalid credentials' };

  if (user.mustReset2FA || !user.twoFactorEnabled) {
    currentSession = { username, authenticated: false, needs2FA: true };
    return { success: true, needs2FASetup: true };
  }

  currentSession = { username, authenticated: false, needs2FA: true };
  return { success: true, needs2FAVerify: true };
}

export function setup2FA(username: string): { success: boolean; secret?: string; otpauthUrl?: string; error?: string } {
  const db = loadDb();
  const user = db.users.find((u) => u.username === username);
  if (!user) return { success: false, error: 'User not found' };

  const secretBytes = crypto.randomBytes(20);
  const base32Secret = base32Encode(secretBytes);
  user.totpSecret = base32Secret;
  saveDb(db);

  const otpauthUrl = `otpauth://totp/RMPG%20Forensics:${encodeURIComponent(username)}?secret=${base32Secret}&issuer=RMPG%20Forensics&algorithm=SHA1&digits=6&period=30`;

  return { success: true, secret: base32Secret, otpauthUrl };
}

export function verify2FA(
  username: string,
  token: string,
): { success: boolean; error?: string } {
  const db = loadDb();
  const user = db.users.find((u) => u.username === username);
  if (!user || !user.totpSecret) return { success: false, error: 'No 2FA configured' };

  if (!verifyTOTP(user.totpSecret, token)) {
    return { success: false, error: 'Invalid code' };
  }

  // Successful 2FA — mark as fully authenticated
  user.twoFactorEnabled = true;
  user.mustReset2FA = false;
  user.lastLogin = new Date().toISOString();
  saveDb(db);

  if (currentSession && currentSession.username === username) {
    currentSession.authenticated = true;
    currentSession.needs2FA = false;
  }

  return { success: true };
}

export function resetAll2FA(): { success: boolean; count: number } {
  const db = loadDb();
  let count = 0;
  for (const user of db.users) {
    user.mustReset2FA = true;
    user.twoFactorEnabled = false;
    user.totpSecret = null;
    count++;
  }
  saveDb(db);
  return { success: true, count };
}

export function listUsers(): { username: string; twoFactorEnabled: boolean; mustReset2FA: boolean; lastLogin: string | null }[] {
  const db = loadDb();
  return db.users.map((u) => ({
    username: u.username,
    twoFactorEnabled: u.twoFactorEnabled,
    mustReset2FA: u.mustReset2FA,
    lastLogin: u.lastLogin,
  }));
}

export function trustDevice(username: string): { token: string } {
  const db = loadDb();
  if (!db.trustedDevices) db.trustedDevices = [];
  // Remove old tokens for this user
  db.trustedDevices = db.trustedDevices.filter((t) => t.username !== username);
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  db.trustedDevices.push({
    token,
    username,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  });
  saveDb(db);
  return { token };
}

export function loginWithTrust(username: string, password: string, deviceToken?: string): {
  success: boolean;
  needs2FASetup?: boolean;
  needs2FAVerify?: boolean;
  error?: string;
} {
  const db = loadDb();
  const user = db.users.find((u) => u.username === username);
  if (!user) return { success: false, error: 'Invalid credentials' };

  const hash = hashPassword(password, user.salt);
  if (hash !== user.passwordHash) return { success: false, error: 'Invalid credentials' };

  if (user.mustReset2FA || !user.twoFactorEnabled) {
    currentSession = { username, authenticated: false, needs2FA: true };
    return { success: true, needs2FASetup: true };
  }

  // Check trusted device token
  if (deviceToken && db.trustedDevices) {
    const trusted = db.trustedDevices.find(
      (t) => t.token === deviceToken && t.username === username && new Date(t.expiresAt) > new Date()
    );
    if (trusted) {
      // Skip 2FA — device is trusted
      user.lastLogin = new Date().toISOString();
      saveDb(db);
      currentSession = { username, authenticated: true, needs2FA: false };
      return { success: true };
    }
  }

  currentSession = { username, authenticated: false, needs2FA: true };
  return { success: true, needs2FAVerify: true };
}

export function logout(): void {
  currentSession = null;
}
