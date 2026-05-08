import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import * as decrypt from '../services/decryption-service';

/**
 * Decryption IPC handlers — thin wrappers around decryption-service.
 * All operations run against local files only.
 */
export function registerDecryptionHandlers(): void {
  const win = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null;

  // ── iOS backup: single attempt ────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DECRYPT_IOS_BACKUP_TRY, async (
    _e,
    options: { backupDir: string; password: string },
  ) => decrypt.tryIosBackupPassword(options));

  // ── iOS backup: dictionary attack ─────────────────────────────────────
  // Streams progress every ~25 candidates via DECRYPT_IOS_BACKUP_DICT_PROGRESS.
  ipcMain.handle(IPC_CHANNELS.DECRYPT_IOS_BACKUP_DICT, async (
    _e,
    options: { backupDir: string; wordlistPath: string; maxAttempts?: number; startIndex?: number },
  ) => {
    return decrypt.dictAttackIosBackup({
      ...options,
      onProgress: (snap) => {
        const w = win();
        if (w && !w.isDestroyed()) {
          w.webContents.send(IPC_CHANNELS.DECRYPT_IOS_BACKUP_DICT_PROGRESS, snap);
        }
      },
    });
  });

  // ── ZIP: single attempt ───────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DECRYPT_ZIP_TRY, async (
    _e,
    options: { zipPath: string; password: string },
  ) => decrypt.tryZipPassword(options));

  // ── ZIP: dictionary attack ────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.DECRYPT_ZIP_DICT, async (
    _e,
    options: { zipPath: string; wordlistPath: string; maxAttempts?: number; startIndex?: number },
  ) => {
    return decrypt.dictAttackZip({
      ...options,
      onProgress: (snap) => {
        const w = win();
        if (w && !w.isDestroyed()) {
          w.webContents.send(IPC_CHANNELS.DECRYPT_ZIP_DICT_PROGRESS, snap);
        }
      },
    });
  });

  // ── Android gesture (full pattern-space brute) ────────────────────────
  ipcMain.handle(IPC_CHANNELS.DECRYPT_ANDROID_GESTURE, async (
    _e,
    options: { hashHex: string },
  ) => decrypt.crackAndroidGesture(options.hashHex));

  // ── Android PIN (0000-9999 default; configurable digits) ──────────────
  ipcMain.handle(IPC_CHANNELS.DECRYPT_ANDROID_PIN, async (
    _e,
    options: { hashHex: string; saltHex: string; digits?: number },
  ) => decrypt.crackAndroidPin({
    targetHashHex: options.hashHex,
    saltHex: options.saltHex,
    digits: options.digits,
  }));

  // ── Estimate brute-force search space ─────────────────────────────────
  // Pure compute, no IO — used by the UI to render a feasibility hint
  // before the user fires off a real run.
  ipcMain.handle(IPC_CHANNELS.DECRYPT_BRUTE_FORCE_ESTIMATE, async (
    _e,
    options: { charset: decrypt.Charset; minLen: number; maxLen: number },
  ) => {
    const total = decrypt.estimateBruteForceSize(options.charset, options.minLen, options.maxLen);
    return {
      total: Number.isFinite(total) ? total : null,
      // Crude ceiling estimate — for slow hash (PBKDF2 / iOS backup) at
      // 100/sec/CPU, 12-char alphanumeric is geological time. Surface a
      // human-readable label that doesn't lie about feasibility.
      feasibility:
        !Number.isFinite(total) ? 'infeasible' :
        total < 1e7 ? 'fast' :
        total < 1e10 ? 'moderate' :
        total < 1e14 ? 'slow' :
        'infeasible',
    };
  });

  // ── Live Android device crack ─────────────────────────────────────────
  // Pull /data/system/ lockscreen artefacts from a connected, debug-
  // authorised, root-or-recovery Android device, then run the offline
  // crackers on whatever came through. No on-device bypass; if the
  // device is locked + not rooted we surface that clearly.
  ipcMain.handle(IPC_CHANNELS.DECRYPT_LIVE_ANDROID, async (
    _e,
    options: { serial: string; outputDir: string },
  ) => {
    const pull = await decrypt.pullAndroidLockArtefacts(options);
    if (!pull.success) {
      // Spread first then override — explicit `success`/`message`
      // settings should win over `pull`'s same-named fields.
      return { ...pull, success: false, message: pull.message };
    }
    const cracked = await decrypt.crackPulledLockArtefacts({
      gestureKeyPath: pull.pulled.gestureKey,
      passwordKeyPath: pull.pulled.passwordKey,
      lockSettingsDbPath: pull.pulled.lockSettingsDb,
    });
    return {
      success: true,
      message: pull.message,
      pulled: pull.pulled,
      rooted: pull.rooted,
      ...cracked,
    };
  });

  // ── Generic incremental brute force ───────────────────────────────────
  // Target-agnostic runner. The handler dispatches the per-target tester
  // and forwards progress events. Keep this one short — actual logic
  // lives in decryption-service.bruteForce().
  ipcMain.handle(IPC_CHANNELS.DECRYPT_BRUTE_FORCE, async (
    _e,
    options: {
      target: 'ios-backup' | 'zip';
      backupDir?: string;   // for ios-backup
      zipPath?: string;     // for zip
      charset: decrypt.Charset;
      minLen: number;
      maxLen: number;
      maxAttempts?: number;
    },
  ) => {
    const onProgress = (snap: { attempted: number; total: number; current: string }) => {
      const w = win();
      if (w && !w.isDestroyed()) w.webContents.send(IPC_CHANNELS.DECRYPT_BRUTE_FORCE_PROGRESS, snap);
    };

    if (options.target === 'ios-backup') {
      if (!options.backupDir) return { success: false, message: 'backupDir required.' };
      return decrypt.bruteForce({
        charset: options.charset,
        minLen: options.minLen,
        maxLen: options.maxLen,
        maxAttempts: options.maxAttempts,
        onProgress,
        test: async (candidate) => (await decrypt.tryIosBackupPassword({ backupDir: options.backupDir!, password: candidate })).success,
      });
    }
    if (options.target === 'zip') {
      if (!options.zipPath) return { success: false, message: 'zipPath required.' };
      return decrypt.bruteForce({
        charset: options.charset,
        minLen: options.minLen,
        maxLen: options.maxLen,
        maxAttempts: options.maxAttempts,
        onProgress,
        test: async (candidate) => (await decrypt.tryZipPassword({ zipPath: options.zipPath!, password: candidate })).success,
      });
    }
    return { success: false, message: `Unknown target: ${options.target}` };
  });
}
