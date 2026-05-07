import { ipcMain, BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IPC_CHANNELS } from '@rmpg/shared';
import { resolveTool } from '../services/tool-resolver';
import { runCommandWithProgress } from '../services/process-runner';

/**
 * Breach & Bypass IPC handlers.
 *
 * Four tools:
 *   1. LOCKSCREEN_RECOVER       — pure-Node recovery of Android lock-screen
 *                                 secret from a pulled /data/system/.
 *   2. EDL_IMAGE                — wraps `edl` (pip edlclient) for Qualcomm
 *                                 Emergency Download mode imaging.
 *   3. MTK_DUMP                 — wraps `mtk` (pip mtkclient) for MediaTek
 *                                 BROM/Preloader imaging.
 *   4. IOS_BACKUP_DECRYPT       — wraps `iphone_backup_decrypt` for full
 *                                 backup decryption + keychain extraction.
 */

function pushProgress(channel: string, payload: unknown): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

// ============================================================================
// 1. Lock-Screen Recovery — pure-Node, no external tools.
// ============================================================================

/** Android < 6: gesture.key is the SHA-1 of the pattern bytes (no salt). */
function recoverPatternFromGestureKey(gestureKey: Buffer): string | null {
  if (gestureKey.length !== 20) return null;
  const target = gestureKey.toString('hex');
  // Patterns are sequences of 4-9 unique cells, each 0-8.
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  function* permutations(remaining: number[], pick: number, used: number[] = []): Generator<number[]> {
    if (used.length >= 4 && used.length <= pick) yield [...used];
    if (used.length >= pick) return;
    for (const c of remaining) {
      yield* permutations(remaining.filter((x) => x !== c), pick, [...used, c]);
    }
  }
  for (const perm of permutations(cells, 9)) {
    const buf = Buffer.from(perm);
    const hash = crypto.createHash('sha1').update(buf).digest('hex');
    if (hash === target) {
      return perm.join('-');
    }
  }
  return null;
}

/** Android 5: password.key is SHA-1+MD5 of (salt + password). Salt lives in locksettings.db. */
function recoverPinFromPasswordKey(passwordKey: Buffer, salt: string, maxDigits: number, onLog: (m: string) => void): string | null {
  // password.key is 72 bytes: 40 bytes SHA-1 hex + 32 bytes MD5 hex (legacy double-hash).
  if (passwordKey.length < 40) return null;
  const targetSha1 = passwordKey.subarray(0, 40).toString('ascii').toLowerCase();
  for (let len = 4; len <= maxDigits; len++) {
    const max = Math.pow(10, len);
    onLog(`Trying ${len}-digit PINs (${max.toLocaleString()} candidates)…`);
    for (let i = 0; i < max; i++) {
      const pin = i.toString().padStart(len, '0');
      const candidate = salt + pin;
      const sha1 = crypto.createHash('sha1').update(candidate, 'utf8').digest('hex');
      if (sha1 === targetSha1) return pin;
    }
  }
  return null;
}

/** Read salt from locksettings.db's `lockscreen.password_salt` row. Plain SQLite. */
async function readSaltFromLockSettings(dbPath: string): Promise<string | null> {
  try {
    // Minimal SQLite read — open the file and grep the binary for the marker.
    // Avoids requiring a sqlite3 native module dep at runtime; the locksettings
    // payload is small and the salt key is easy to find.
    const buf = await fs.readFile(dbPath);
    const idx = buf.indexOf('lockscreen.password_salt');
    if (idx < 0) return null;
    // The salt is stored as a stringified signed long. Find next ASCII digit run.
    let i = idx + 'lockscreen.password_salt'.length;
    while (i < buf.length && (buf[i] < 0x2d /* '-' */ || buf[i] > 0x39 /* '9' */)) i++;
    let j = i;
    while (j < buf.length && ((buf[j] >= 0x30 && buf[j] <= 0x39) || buf[j] === 0x2d)) j++;
    if (j > i) {
      const num = BigInt(buf.subarray(i, j).toString('ascii'));
      // Convert signed long → unsigned hex (Android stores as Long.toHexString).
      const unsigned = num < 0n ? num + (1n << 64n) : num;
      return unsigned.toString(16);
    }
    return null;
  } catch {
    return null;
  }
}

ipcMain.handle(IPC_CHANNELS.LOCKSCREEN_RECOVER, async (_e, opts: { systemDir: string; wordlistPath?: string; maxPinDigits: number }) => {
  const log = (m: string) => pushProgress(IPC_CHANNELS.LOCKSCREEN_RECOVER_PROGRESS, { type: 'log', message: m });
  log(`Scanning ${opts.systemDir}…`);

  try {
    const gesturePath = path.join(opts.systemDir, 'gesture.key');
    const passwordPath = path.join(opts.systemDir, 'password.key');
    const lockSettingsPath = path.join(opts.systemDir, 'locksettings.db');

    let foundAny = false;

    // Pattern recovery
    try {
      const gesture = await fs.readFile(gesturePath);
      log(`Found gesture.key (${gesture.length} bytes). Brute-forcing pattern…`);
      const pattern = recoverPatternFromGestureKey(gesture);
      if (pattern) {
        log(`✓ PATTERN RECOVERED: ${pattern}`);
        log(`  (cells numbered 0=top-left → 8=bottom-right, row-major)`);
        foundAny = true;
      } else {
        log('  Pattern not recovered — gesture.key may be corrupt or unsupported format.');
      }
    } catch {
      log('No gesture.key found (device used PIN/password, not pattern).');
    }

    // PIN/password recovery
    try {
      const pwKey = await fs.readFile(passwordPath);
      log(`Found password.key (${pwKey.length} bytes).`);
      const salt = await readSaltFromLockSettings(lockSettingsPath);
      if (!salt) {
        log('  Could not read salt from locksettings.db — PIN brute-force requires the salt.');
      } else {
        log(`  Salt: ${salt}`);
        log(`  Brute-forcing PINs up to ${opts.maxPinDigits} digits…`);
        const pin = recoverPinFromPasswordKey(pwKey, salt, opts.maxPinDigits, log);
        if (pin) {
          log(`✓ PIN RECOVERED: ${pin}`);
          foundAny = true;
        } else {
          log('  PIN not in candidate space — try increasing max digits, or use the wordlist for password attacks.');
        }
      }
    } catch {
      log('No password.key found (device may use Android 6+ Gatekeeper, which requires online attack against the secure element).');
    }

    if (!foundAny) {
      log('');
      log('Nothing recovered. Possible reasons:');
      log('  • Device runs Android 6+ with Gatekeeper (locksettings.db only contains a synthetic-password handle, not a hash).');
      log('  • Lock screen was disabled at acquisition time.');
      log('  • /data/system/ was not pulled — verify the input directory contains gesture.key/password.key/locksettings.db.');
    }

    return { success: true };
  } catch (err) {
    log(`ERROR: ${(err as Error).message}`);
    return { success: false, error: (err as Error).message };
  }
});

// ============================================================================
// Generic CLI-spawn helper for the wrapper tools.
// ============================================================================

async function runWrappedCli(opts: {
  toolName: 'edl' | 'mtk' | 'iphone_backup_decrypt';
  args: string[];
  progressChannel: string;
  cwd?: string;
}): Promise<{ success: boolean; error?: string }> {
  const tool = await resolveTool(opts.toolName);
  if (!tool.found) {
    return { success: false, error: `${opts.toolName} not found. Install via Tool Configuration.` };
  }
  const log = (m: string) => pushProgress(opts.progressChannel, { type: 'log', message: m });
  log(`$ ${tool.path} ${opts.args.join(' ')}`);
  try {
    const result = await runCommandWithProgress(
      tool.path,
      opts.args,
      { cwd: opts.cwd },
      (p) => log(p.data || p.message || ''),
    );
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr.trim() || `${opts.toolName} exited with code ${result.exitCode}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 2. EDL Imager (Qualcomm)
// ============================================================================

ipcMain.handle(IPC_CHANNELS.EDL_IMAGE, async (_e, opts: { mode: string; outputDir?: string; loaderPath?: string }) => {
  const args: string[] = [];
  if (opts.loaderPath) args.push('--loader', opts.loaderPath);
  switch (opts.mode) {
    case 'printgpt':
      args.push('printgpt');
      break;
    case 'rl-userdata':
      args.push('r', 'userdata', path.join(opts.outputDir!, 'userdata.bin'));
      break;
    case 'rl-all':
      args.push('rl', opts.outputDir!);
      break;
    case 'rs-emmc':
      args.push('rs', '0', '0', path.join(opts.outputDir!, 'full-emmc.bin'));
      break;
    default:
      return { success: false, error: `Unknown mode: ${opts.mode}` };
  }
  return runWrappedCli({ toolName: 'edl', args, progressChannel: IPC_CHANNELS.EDL_IMAGE_PROGRESS });
});

// ============================================================================
// 3. MTK Client (MediaTek)
// ============================================================================

ipcMain.handle(IPC_CHANNELS.MTK_DUMP, async (_e, opts: { mode: string; outputDir?: string }) => {
  const args: string[] = [];
  switch (opts.mode) {
    case 'printgpt':
      args.push('printgpt');
      break;
    case 'r-userdata':
      args.push('r', 'userdata', path.join(opts.outputDir!, 'userdata.bin'));
      break;
    case 'r-all':
      args.push('rl', opts.outputDir!);
      break;
    case 'rl':
      args.push('rf', path.join(opts.outputDir!, 'full-flash.bin'));
      break;
    case 'da-seccfg':
      args.push('r', 'seccfg', path.join(opts.outputDir!, 'seccfg.bin'));
      break;
    default:
      return { success: false, error: `Unknown mode: ${opts.mode}` };
  }
  return runWrappedCli({ toolName: 'mtk', args, progressChannel: IPC_CHANNELS.MTK_DUMP_PROGRESS });
});

// ============================================================================
// 4. iOS Backup Decrypt + Keychain
// ============================================================================

ipcMain.handle(IPC_CHANNELS.IOS_BACKUP_DECRYPT, async (_e, opts: { backupDir: string; outputDir: string; password: string; op: 'decrypt-backup' | 'extract-keychain' }) => {
  await fs.mkdir(opts.outputDir, { recursive: true });
  const args: string[] = [];
  if (opts.op === 'decrypt-backup') {
    args.push('--backup', opts.backupDir, '--output', opts.outputDir, '--password', opts.password);
  } else {
    args.push('--backup', opts.backupDir, '--keychain-only', '--output', opts.outputDir, '--password', opts.password);
  }
  return runWrappedCli({ toolName: 'iphone_backup_decrypt', args, progressChannel: IPC_CHANNELS.IOS_BACKUP_DECRYPT_PROGRESS });
});

export function registerBreachHandlers(): void {
  // All ipcMain.handle calls above run at module load. This export is just a
  // marker so ipc/index.ts can import + invoke for symmetry with the other
  // handler files.
}
