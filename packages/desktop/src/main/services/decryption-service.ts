import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { runCommand } from './process-runner';
import { resolveTool } from './tool-resolver';

// ---------------------------------------------------------------------------
// Live Android device — pull lockscreen artefacts via ADB
// ---------------------------------------------------------------------------

/**
 * Pull lockscreen artefacts from a connected Android device's
 * `/data/system/` directory and crack them offline.
 *
 * What this does:
 *   1. `adb pull /data/system/gesture.key` (legacy pattern, Android <6)
 *   2. `adb pull /data/system/password.key` (legacy PIN/password, <7)
 *   3. `adb pull /data/system/locksettings.db` (Android 7+: salt + meta)
 *   4. Hash inspection on the pulled files; auto-run crackAndroidGesture
 *      and crackAndroidPin on whichever artefacts came through.
 *
 * What this does NOT do: bypass the device's lockscreen rate limiter,
 * defeat KeyStore-backed authentication (Android Nougat+), or attempt
 * online attacks. Modern Android binds the keystore to the secure
 * enclave; offline brute-forcing is feasible only against the legacy
 * password.key/gesture.key formats. Newer devices simply won't have
 * those files outside of root / TWRP recovery.
 *
 * Requires:
 *   - USB Debugging enabled and host fingerprint authorised, AND
 *   - Either root (su present) OR a custom recovery (TWRP) with a
 *     world-readable /data partition. Stock locked Androids will return
 *     "Permission denied" for the pull commands.
 */
export async function pullAndroidLockArtefacts(opts: {
  serial: string;
  outputDir: string;
}): Promise<{
  success: boolean;
  pulled: { gestureKey?: string; passwordKey?: string; lockSettingsDb?: string };
  message: string;
  rooted: boolean;
}> {
  const adb = await resolveTool('adb');
  if (!adb.found) return { success: false, pulled: {}, message: 'ADB not found.', rooted: false };

  await fs.mkdir(opts.outputDir, { recursive: true });

  // Try `su -c` first; fall back to plain pull. Whichever yields a
  // non-empty file wins. Many Magisk-rooted phones won't authorise the
  // ADB su prompt instantly so we ALSO try the plain pull which works
  // on devices booted into TWRP / userdebug builds.
  const root = async (cmd: string): Promise<string> => {
    const r = await runCommand(adb.path, ['-s', opts.serial, 'shell', 'su', '-c', cmd], { timeout: 15000 });
    if (r.exitCode === 0 && r.stdout) return r.stdout;
    const r2 = await runCommand(adb.path, ['-s', opts.serial, 'shell', cmd], { timeout: 15000 });
    return r2.stdout || '';
  };

  // Detect root once — informs the UI message ("rooted device" vs "TWRP").
  const idOutput = await root('id');
  const rooted = /uid=0\(root\)/.test(idOutput);

  const tryPull = async (remote: string, localName: string): Promise<string | undefined> => {
    const local = path.join(opts.outputDir, localName);
    // Use `adb pull` directly — works when /data is readable. If it
    // fails, fall back to su+cat into a temp file then pull.
    let r = await runCommand(adb.path, ['-s', opts.serial, 'pull', remote, local], { timeout: 30000 });
    if (r.exitCode !== 0) {
      const tmpRemote = `/sdcard/.rmpg-${path.basename(remote)}`;
      const su = await runCommand(adb.path, ['-s', opts.serial, 'shell', 'su', '-c', `cp ${remote} ${tmpRemote} && chmod 644 ${tmpRemote}`], { timeout: 15000 });
      if (su.exitCode === 0) {
        r = await runCommand(adb.path, ['-s', opts.serial, 'pull', tmpRemote, local], { timeout: 30000 });
        await runCommand(adb.path, ['-s', opts.serial, 'shell', 'su', '-c', `rm -f ${tmpRemote}`], { timeout: 5000 }).catch(() => {});
      }
    }
    if (r.exitCode === 0) {
      try {
        const stat = await fs.stat(local);
        if (stat.size > 0) return local;
      } catch { /* ignore */ }
    }
    return undefined;
  };

  const pulled = {
    gestureKey: await tryPull('/data/system/gesture.key', 'gesture.key'),
    passwordKey: await tryPull('/data/system/password.key', 'password.key'),
    lockSettingsDb: await tryPull('/data/system/locksettings.db', 'locksettings.db'),
  };

  const got = Object.values(pulled).filter(Boolean).length;
  return {
    success: got > 0,
    pulled,
    rooted,
    message: got === 0
      ? 'Could not access /data/system/ — device is not rooted, not in recovery, or has Android-Nougat-style keystore-backed lockscreen (offline crack not feasible).'
      : `Pulled ${got} lockscreen artefact(s). Running offline cracker on each.`,
  };
}

/**
 * Inspect a pulled lockscreen artefact + try to crack it. The gesture
 * file is straight SHA-1 of the pattern bytes; password.key is the legacy
 * SHA-1+SHA-256 format that needs the salt from locksettings.db. Returns
 * a structured summary the UI can render directly.
 */
export async function crackPulledLockArtefacts(opts: {
  gestureKeyPath?: string;
  passwordKeyPath?: string;
  lockSettingsDbPath?: string;
}): Promise<{
  pattern?: { hash: string; recovered?: number[]; attempted: number; durationMs: number };
  pin?: { hash: string; salt?: string; recovered?: string; attempted: number; durationMs: number };
  notes: string[];
}> {
  const notes: string[] = [];
  const result: Awaited<ReturnType<typeof crackPulledLockArtefacts>> = { notes };

  // Pattern: 20 raw bytes → 40 hex
  if (opts.gestureKeyPath) {
    try {
      const buf = await fs.readFile(opts.gestureKeyPath);
      if (buf.length === 20) {
        const hash = buf.toString('hex');
        const r = crackAndroidGesture(hash);
        result.pattern = {
          hash,
          recovered: r.pattern,
          attempted: r.attempted,
          durationMs: r.durationMs,
        };
        notes.push(`gesture.key: ${r.pattern ? 'pattern recovered' : 'no match (likely a length-12+ pattern, infeasible)'} in ${r.durationMs}ms.`);
      } else {
        notes.push(`gesture.key has unexpected size (${buf.length}B); skipped.`);
      }
    } catch (err) {
      notes.push(`gesture.key read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // PIN/password: needs salt from locksettings.db (column key='lockscreen.password_salt')
  if (opts.passwordKeyPath && opts.lockSettingsDbPath) {
    try {
      const buf = await fs.readFile(opts.passwordKeyPath);
      const hash = buf.toString('utf-8').trim();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const db = new Database(opts.lockSettingsDbPath, { readonly: true });
      let salt: string | undefined;
      try {
        const row = db.prepare("SELECT value FROM locksettings WHERE name='lockscreen.password_salt'").get() as { value?: string } | undefined;
        if (row?.value) {
          // Salt stored as decimal; convert to lowercase hex (Android format).
          const big = BigInt(row.value);
          salt = (big < 0n ? big + (1n << 64n) : big).toString(16).padStart(16, '0');
        }
      } finally {
        db.close();
      }
      if (salt && /^[0-9a-fA-F]+$/.test(hash)) {
        // Try common digit lengths first (4, 5, 6) since most PINs are short.
        let pin: string | undefined;
        let attempted = 0;
        const start = Date.now();
        for (const digits of [4, 5, 6, 7, 8] as const) {
          const r = crackAndroidPin({ targetHashHex: hash, saltHex: salt, digits });
          attempted += r.attempted;
          if (r.success) { pin = r.pin; break; }
        }
        result.pin = {
          hash,
          salt,
          recovered: pin,
          attempted,
          durationMs: Date.now() - start,
        };
        notes.push(`password.key: ${pin ? `PIN recovered (${pin})` : 'no match in 4-8 digits (likely alphanumeric or modern keystore-backed)'}.`);
      } else if (!salt) {
        notes.push('password.key: salt not found in locksettings.db; cannot crack.');
      } else {
        notes.push('password.key: hash format unrecognised (likely modern scrypt — not feasible offline).');
      }
    } catch (err) {
      notes.push(`password.key read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (opts.passwordKeyPath) {
    notes.push('password.key found but locksettings.db missing — salt unavailable, cannot crack.');
  }

  return result;
}

/**
 * decryption-service — forensic decryption + offline password recovery
 * for evidence the examiner has lawful access to (their own acquired
 * backups, court-authorised forensic copies). All operations are LOCAL —
 * we never attempt online services, never bypass remote auth, never
 * generate malicious payloads.
 *
 * Coverage:
 *   - iOS encrypted backup: try a password, or dictionary attack against
 *     a wordlist. Uses idevicebackup2's decrypt-mode to verify since the
 *     BackupKeyBag PBKDF2 derivation matches the device's secure-enclave
 *     algorithm and writing it from scratch invites schema bugs.
 *   - Android lockscreen pattern: gesture.key is sha1(pattern_bytes).
 *     The full pattern space (3-9 dots from a 9-cell grid) is small
 *     enough to enumerate in milliseconds — full-space search, no need
 *     for a wordlist.
 *   - Android PIN: password.key for legacy lockscreen is sha1(salt + pin)
 *     truncated; brute-forcing 0000-9999 against an acquired hash takes
 *     under a second.
 *   - Encrypted ZIP: shells out to system `unzip -P` so we don't depend
 *     on a JS pure-zip implementation. Single try + dictionary mode.
 *
 * Authorisation framing: every public function takes a path to a local
 * file. We do not facilitate online attacks. The companion UI clearly
 * states "evidence under your authorisation" — see pages/Decryption.tsx.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttemptResult {
  success: boolean;
  /** The successful candidate when found; undefined on failure. */
  password?: string;
  /** Total candidates tested. */
  attempted: number;
  /** Total wordlist size (or candidate-space size) when known. */
  total?: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Free-form note — error / hash inspection / etc. */
  message?: string;
}

export interface DictionaryOptions {
  /** Path to a newline-delimited candidate file. UTF-8 only — for
   *  binary wordlists callers should pre-convert. */
  wordlistPath: string;
  /** Optional starting offset (resume support). */
  startIndex?: number;
  /** Stop after N candidates — useful for time-boxed tests. 0 = unlimited. */
  maxAttempts?: number;
  /** Progress reporter, called every ~100 candidates. */
  onProgress?: (snap: { attempted: number; total?: number; current: string }) => void;
}

// ---------------------------------------------------------------------------
// iOS encrypted backup
// ---------------------------------------------------------------------------

/**
 * Attempt a single password against an iOS encrypted backup. Returns
 * `{success}` based on whether `idevicebackup2 decrypt` accepts it —
 * decrypt-mode does the same PBKDF2 → AES-unwrap dance the device's
 * Secure Enclave does, so a successful decrypt is a positive result.
 *
 * We decrypt to a temp dir and immediately delete; this is detection
 * only, not extraction. Combine with manifest browsing for full data
 * access once the password is known.
 */
export async function tryIosBackupPassword(opts: {
  backupDir: string;
  password: string;
}): Promise<{ success: boolean; message?: string }> {
  const tool = await resolveTool('idevicebackup2');
  if (!tool.found) {
    return { success: false, message: 'idevicebackup2 not found — install libimobiledevice.' };
  }
  // Manifest.plist is the smallest password-gated file in the backup;
  // decrypting just that is enough to verify the password without
  // touching the per-app data. idevicebackup2 doesn't expose a
  // verify-only mode, so we decrypt to a tmpdir and rm it on completion.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmpg-bkp-try-'));
  try {
    const r = await runCommand(
      tool.path,
      ['-i', '-s', path.basename(opts.backupDir), 'decrypt', tmpDir, opts.password, path.dirname(opts.backupDir)],
      { timeout: 30000 },
    );
    // idevicebackup2 prints "Backup decrypted." on success, prints
    // "Wrong password" or non-zero exit on failure. Either signal works.
    const ok = r.exitCode === 0 || /backup decrypted/i.test(r.stdout);
    return ok
      ? { success: true, message: 'Password accepted.' }
      : { success: false, message: r.stderr.trim() || 'Password rejected.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* best effort */ });
  }
}

/**
 * Dictionary attack against an iOS encrypted backup. Iterates the
 * wordlist; stops on first hit. Throttling is the user's responsibility
 * via `maxAttempts` — we don't add artificial delays because forensic
 * tools are CPU-bound on PBKDF2 anyway (hundreds of thousands of
 * iterations per try), so the natural rate is already self-throttled.
 */
export async function dictAttackIosBackup(opts: {
  backupDir: string;
  wordlistPath: string;
  startIndex?: number;
  maxAttempts?: number;
  onProgress?: DictionaryOptions['onProgress'];
}): Promise<AttemptResult> {
  const start = Date.now();
  const words = await loadWordlist(opts.wordlistPath);
  const begin = opts.startIndex ?? 0;
  const cap = opts.maxAttempts && opts.maxAttempts > 0 ? Math.min(words.length, begin + opts.maxAttempts) : words.length;

  for (let i = begin; i < cap; i++) {
    const candidate = words[i];
    if (i % 25 === 0) opts.onProgress?.({ attempted: i - begin, total: cap - begin, current: candidate });
    const r = await tryIosBackupPassword({ backupDir: opts.backupDir, password: candidate });
    if (r.success) {
      return {
        success: true,
        password: candidate,
        attempted: i - begin + 1,
        total: cap - begin,
        durationMs: Date.now() - start,
        message: `Recovered in ${i - begin + 1} attempts.`,
      };
    }
  }
  return {
    success: false,
    attempted: cap - begin,
    total: cap - begin,
    durationMs: Date.now() - start,
    message: 'Wordlist exhausted; password not in list.',
  };
}

// ---------------------------------------------------------------------------
// Android lockscreen pattern (gesture.key)
// ---------------------------------------------------------------------------

/**
 * Crack an Android pattern lockscreen by exhaustively enumerating every
 * legal pattern (3-9 dots, no dot revisited) and SHA-1 hashing each.
 * Pattern-space is small (~389k patterns) — completes in well under a
 * second even on a laptop. Returns the matching pattern as the sequence
 * of dot indices (0-8, row-major from the top-left).
 *
 * The hash format on disk (`/data/system/gesture.key` on Android <6) is
 * a 20-byte raw SHA-1; pass it as 40-char hex.
 */
export function crackAndroidGesture(targetHashHex: string): {
  success: boolean;
  pattern?: number[];
  attempted: number;
  durationMs: number;
} {
  const target = targetHashHex.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(target)) {
    return { success: false, attempted: 0, durationMs: 0 };
  }
  const start = Date.now();
  let attempted = 0;
  const visited: boolean[] = new Array(9).fill(false);
  const path: number[] = [];

  // Apple-of-eye optimisation: enumerate via DFS with the visited array
  // so we don't allocate per-step. Patterns of length <3 aren't valid
  // on Android so we start emitting hashes once we've placed 3 dots.
  const dfs = (): number[] | null => {
    if (path.length >= 3) {
      attempted++;
      const buf = Buffer.from(path);
      const got = createHash('sha1').update(buf).digest('hex');
      if (got === target) return path.slice();
    }
    if (path.length >= 9) return null;
    for (let i = 0; i < 9; i++) {
      if (visited[i]) continue;
      visited[i] = true;
      path.push(i);
      const found = dfs();
      if (found) return found;
      path.pop();
      visited[i] = false;
    }
    return null;
  };

  const found = dfs();
  return {
    success: !!found,
    pattern: found ?? undefined,
    attempted,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Android PIN (password.key, legacy)
// ---------------------------------------------------------------------------

/**
 * Crack an Android numeric PIN by brute-forcing 0000-9999 (or wider if
 * the user passes a `digits` count) against the legacy `password.key`
 * format: SHA-1 of (salt_hex_lowercase || pin) AND SHA-256 of the same,
 * concatenated. Modern Android (Nougat+) uses scrypt/keystore which is
 * not feasible to brute-force without the device — returns failure with
 * a clear message in that case.
 *
 * Salt comes from the locksettings.db `lockscreen.password_salt` row
 * (decimal in older versions; needs hex conversion).
 */
export function crackAndroidPin(opts: {
  targetHashHex: string;
  saltHex: string;
  digits?: number;
}): { success: boolean; pin?: string; attempted: number; durationMs: number } {
  const start = Date.now();
  const digits = opts.digits ?? 4;
  if (digits < 1 || digits > 8) {
    return { success: false, attempted: 0, durationMs: 0 };
  }
  const target = opts.targetHashHex.trim().toLowerCase();
  const salt = opts.saltHex.trim().toLowerCase();
  // Legacy combined hash: hex(SHA-1(salt + pin)) + hex(SHA-256(salt + pin))
  const max = Math.pow(10, digits);
  for (let n = 0; n < max; n++) {
    const pin = String(n).padStart(digits, '0');
    const input = salt + pin;
    const sha1 = createHash('sha1').update(input).digest('hex');
    const sha256 = createHash('sha256').update(input).digest('hex');
    if (sha1 + sha256 === target || sha1 === target || sha256 === target) {
      return { success: true, pin, attempted: n + 1, durationMs: Date.now() - start };
    }
  }
  return { success: false, attempted: max, durationMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Encrypted ZIP
// ---------------------------------------------------------------------------

export async function tryZipPassword(opts: {
  zipPath: string;
  password: string;
}): Promise<{ success: boolean; message?: string }> {
  // `unzip -P pass -t archive` runs in test-mode (no extraction) and
  // exits 0 if the password works. Available on every Unix; Windows
  // users need the standalone unzip.exe in PATH.
  const r = await runCommand('unzip', ['-P', opts.password, '-t', '-q', opts.zipPath], { timeout: 60000 });
  return r.exitCode === 0
    ? { success: true, message: 'Password accepted.' }
    : { success: false, message: r.stderr.trim() || 'Password rejected.' };
}

export async function dictAttackZip(opts: {
  zipPath: string;
  wordlistPath: string;
  startIndex?: number;
  maxAttempts?: number;
  onProgress?: DictionaryOptions['onProgress'];
}): Promise<AttemptResult> {
  const start = Date.now();
  const words = await loadWordlist(opts.wordlistPath);
  const begin = opts.startIndex ?? 0;
  const cap = opts.maxAttempts && opts.maxAttempts > 0 ? Math.min(words.length, begin + opts.maxAttempts) : words.length;

  for (let i = begin; i < cap; i++) {
    if (i % 50 === 0) opts.onProgress?.({ attempted: i - begin, total: cap - begin, current: words[i] });
    const r = await tryZipPassword({ zipPath: opts.zipPath, password: words[i] });
    if (r.success) {
      return {
        success: true,
        password: words[i],
        attempted: i - begin + 1,
        total: cap - begin,
        durationMs: Date.now() - start,
      };
    }
  }
  return {
    success: false,
    attempted: cap - begin,
    total: cap - begin,
    durationMs: Date.now() - start,
    message: 'Wordlist exhausted; password not in list.',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadWordlist(p: string): Promise<string[]> {
  const raw = await fs.readFile(p, 'utf-8');
  // Strip BOM, split, dedupe blanks. Preserve case — many forensic
  // wordlists are case-sensitive (mixed, lower-case, with-numbers).
  return raw.replace(/^﻿/, '').split(/\r?\n/).filter((s) => s.length > 0);
}

/**
 * Tiny built-in PIN/password set for "common pins" quick check before
 * launching a full dictionary attack. Catches the easy cases (~80% of
 * real-world phone PINs in published surveys) in under a second.
 */
export const COMMON_PINS = [
  '0000', '1234', '1111', '2580', '0852', '1212', '5555', '5683',
  '0852', '2222', '1998', '1999', '2000', '2001', '2002', '2003',
  '2004', '2005', '4321', '6969', '7777', '8888', '9999', '1313',
  '6666', '4444', '3333', '1010', '0123', '2468',
];

// ---------------------------------------------------------------------------
// Incremental charset brute force
// ---------------------------------------------------------------------------

export type Charset =
  | 'digits'         // 0-9                        (10 chars)
  | 'lower'          // a-z                        (26)
  | 'upper'          // A-Z                        (26)
  | 'letters'        // a-zA-Z                     (52)
  | 'alphanumeric'   // a-zA-Z0-9                  (62)
  | 'printable';     // a-zA-Z0-9 + common symbols (95)

const CHARSETS: Record<Charset, string> = {
  digits:       '0123456789',
  lower:        'abcdefghijklmnopqrstuvwxyz',
  upper:        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  letters:      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alphanumeric: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  printable:    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:,.<>?/~`"\' ',
};

/**
 * Estimate the candidate count for a charset + length range. Surfaced to
 * the UI so users can see when a search is computationally infeasible
 * before they hit Run (printable × length 12 = 95^12 ≈ 5.4e23, well past
 * heat-death-of-the-sun on a CPU).
 */
export function estimateBruteForceSize(charset: Charset, minLen: number, maxLen: number): number {
  const n = CHARSETS[charset].length;
  let total = 0;
  for (let len = minLen; len <= maxLen; len++) {
    total += Math.pow(n, len);
    if (!Number.isFinite(total)) return Infinity;
  }
  return total;
}

/**
 * Generator that yields every candidate of length min..max over the
 * given charset, in lexicographic order. Implemented as an in-place
 * counter (no recursion) so memory stays O(maxLen) regardless of count
 * — a 12-char alphanumeric search would otherwise blow the stack at
 * 62^12 frames.
 */
export function* incrementalCandidates(
  charset: Charset,
  minLen: number,
  maxLen: number,
): Generator<string, void, void> {
  const chars = CHARSETS[charset];
  const n = chars.length;
  for (let len = Math.max(1, minLen); len <= Math.max(minLen, maxLen); len++) {
    const idx = new Array(len).fill(0);
    while (true) {
      // Materialise current candidate
      let s = '';
      for (let i = 0; i < len; i++) s += chars[idx[i]];
      yield s;
      // Increment counter (rightmost digit first); break when we wrap
      let pos = len - 1;
      while (pos >= 0) {
        idx[pos]++;
        if (idx[pos] < n) break;
        idx[pos] = 0;
        pos--;
      }
      if (pos < 0) break; // exhausted this length
    }
  }
}

/**
 * Generic brute-force runner — feeds candidates from `incrementalCandidates`
 * to a target-specific async tester. Used by the iOS/ZIP/Android-PIN
 * cracking handlers when the user opts into incremental brute force
 * over the dictionary attack.
 *
 * NB: practical viability is bounded by the per-target hash cost. For
 * Apple's PBKDF2-SHA256 backups (~100 candidates/sec/CPU-core) anything
 * over ~6 alphanumeric chars is days-to-weeks. For SHA-1 Android
 * patterns the whole space runs in <1 second. The UI surfaces the
 * estimated candidate count + a kludgy "this could take X" warning so
 * users don't kick off a heat-death-of-the-sun job by accident.
 */
export async function bruteForce(opts: {
  charset: Charset;
  minLen: number;
  maxLen: number;
  /** Tester returns true when a candidate is the password. */
  test: (candidate: string) => Promise<boolean>;
  onProgress?: (snap: { attempted: number; total: number; current: string }) => void;
  /** Stop after N candidates. 0 = unlimited (use with care). */
  maxAttempts?: number;
}): Promise<AttemptResult> {
  const start = Date.now();
  const total = estimateBruteForceSize(opts.charset, opts.minLen, opts.maxLen);
  const cap = opts.maxAttempts && opts.maxAttempts > 0 ? opts.maxAttempts : Infinity;
  let attempted = 0;

  for (const candidate of incrementalCandidates(opts.charset, opts.minLen, opts.maxLen)) {
    if (attempted >= cap) break;
    if (attempted % 100 === 0) {
      opts.onProgress?.({ attempted, total: Number.isFinite(total) ? total : 0, current: candidate });
    }
    attempted++;
    if (await opts.test(candidate)) {
      return {
        success: true,
        password: candidate,
        attempted,
        total: Number.isFinite(total) ? total : undefined,
        durationMs: Date.now() - start,
        message: `Recovered after ${attempted.toLocaleString()} candidates.`,
      };
    }
  }
  return {
    success: false,
    attempted,
    total: Number.isFinite(total) ? total : undefined,
    durationMs: Date.now() - start,
    message: 'Search space exhausted (or capped); no match.',
  };
}
