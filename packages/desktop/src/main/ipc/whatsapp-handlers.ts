import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as adbService from '../services/adb-service';
import { resolveTool } from '../services/tool-resolver';
import { runCommand } from '../services/process-runner';
import { getTempDir } from '../services/platform-service';

/** Known WhatsApp package identifiers. */
const WHATSAPP_PACKAGES = [
  'com.whatsapp',
  'com.whatsapp.w4b', // WhatsApp Business
  'com.gbwhatsapp',   // GBWhatsApp (modified client)
] as const;

/** The legacy APK version used for the downgrade extraction technique. */
const LEGACY_APK_VERSION = '2.11.431';

interface WhatsAppExtractOptions {
  serial: string;
  casePath: string;
  packageName: string;
  /** Path to a legacy APK for the downgrade technique. */
  legacyApkPath?: string;
}

/**
 * Register WhatsApp extraction IPC handlers.
 *
 * This is the most complex handler module - it orchestrates the full WhatsApp
 * database extraction workflow that was originally implemented in FormWhats.cs:
 *   1. List installed WhatsApp packages
 *   2. Back up the current APK
 *   3. Downgrade WhatsApp to a legacy version (to bypass encryption)
 *   4. Perform ADB backup of the downgraded app data
 *   5. Restore the original APK
 */
export function registerWhatsAppHandlers(): void {
  // ---------------------------------------------------------------------------
  // WHATSAPP_LIST_PACKAGES - List WhatsApp variants installed on the device
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_LIST_PACKAGES,
    async (_event, serial: string) => {
      const installedPackages = await adbService.listPackages(serial);
      return installedPackages.filter((pkg) =>
        WHATSAPP_PACKAGES.some((wa) => pkg.startsWith(wa))
      );
    }
  );

  // ---------------------------------------------------------------------------
  // WHATSAPP_EXTRACT - Full extraction workflow (downgrade technique)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_EXTRACT,
    async (_event, options: WhatsAppExtractOptions) => {
      const { serial, casePath, packageName, legacyApkPath } = options;
      const win = BrowserWindow.getFocusedWindow();

      const sendProgress = (message: string): void => {
        const progress: ProcessProgress = {
          type: 'status',
          data: message,
          timestamp: Date.now(),
        };
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.WHATSAPP_EXTRACT_PROGRESS, progress);
        }
      };

      const whatsappDir = path.join(casePath, 'whatsapp');
      const databasesDir = path.join(whatsappDir, 'databases');
      const tempDir = path.join(getTempDir(), `whatsapp_${Date.now()}`);
      await fs.mkdir(databasesDir, { recursive: true });
      await fs.mkdir(tempDir, { recursive: true });

      try {
        // Step 1: Verify the package is installed
        sendProgress(`Verifying ${packageName} is installed...`);
        const packages = await adbService.listPackages(serial);
        if (!packages.includes(packageName)) {
          throw new Error(`Package ${packageName} is not installed on the device.`);
        }

        // Step 2: Back up current APK
        sendProgress('Backing up current WhatsApp APK...');
        const apkPathOutput = await adbService.shell(serial, `pm path ${packageName}`);
        const apkDevicePath = apkPathOutput.trim().replace('package:', '');
        const originalApkPath = path.join(tempDir, 'original.apk');
        await adbService.pull(serial, apkDevicePath, originalApkPath);
        sendProgress('Original APK backed up successfully.');

        // Step 3: Attempt data backup via ADB backup
        sendProgress('Creating ADB backup of WhatsApp data...');
        const backupPath = path.join(tempDir, 'whatsapp_backup.ab');
        await adbService.backup(serial, backupPath, { packages: [packageName] }, (p) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.WHATSAPP_EXTRACT_PROGRESS, p);
          }
        });

        // Step 4: If a legacy APK is provided, attempt the downgrade technique
        if (legacyApkPath) {
          sendProgress(`Downgrading ${packageName} to legacy version (${LEGACY_APK_VERSION})...`);

          // Uninstall current version (preserving data if possible)
          await adbService.shell(serial, `pm uninstall -k ${packageName}`).catch(() => {
            // If -k is not supported, try standard uninstall
            return adbService.uninstall(serial, packageName);
          });

          // Install the legacy APK
          await adbService.install(serial, legacyApkPath);
          sendProgress('Legacy APK installed. Creating downgraded backup...');

          // Backup again with the legacy version
          const legacyBackupPath = path.join(tempDir, 'whatsapp_legacy_backup.ab');
          await adbService.backup(serial, legacyBackupPath, { packages: [packageName] }, (p) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send(IPC_CHANNELS.WHATSAPP_EXTRACT_PROGRESS, p);
            }
          });

          // Step 5: Restore the original APK
          sendProgress('Restoring original WhatsApp version...');
          await adbService.uninstall(serial, packageName).catch(() => {});
          await adbService.install(serial, originalApkPath);
          sendProgress('Original WhatsApp version restored.');
        }

        // Step 6: Convert AB backup to TAR and extract databases
        sendProgress('Converting backup and extracting databases...');
        const javaTool = await resolveTool('java');
        if (javaTool.found) {
          // Look for abe.jar in the tools directory
          const abeJarPath = path.join(path.dirname(javaTool.path), '..', 'tools', 'abe.jar');
          const tarPath = path.join(tempDir, 'whatsapp_backup.tar');

          try {
            await runCommand(javaTool.path, ['-jar', abeJarPath, 'unpack', backupPath, tarPath]);
            // Extract tar contents
            await runCommand('tar', ['-xf', tarPath, '-C', tempDir]);
            sendProgress('Backup extracted successfully.');
          } catch {
            sendProgress('Warning: Could not convert AB backup. Manual extraction may be required.');
          }
        }

        // Step 7: Copy databases to case directory
        sendProgress('Copying extracted databases to case folder...');
        const dbFiles = await findDatabaseFiles(tempDir);
        let copiedCount = 0;
        for (const dbFile of dbFiles) {
          const destPath = path.join(databasesDir, path.basename(dbFile));
          await fs.copyFile(dbFile, destPath);
          copiedCount++;
        }

        // Step 8: Also pull databases directly from device if accessible
        sendProgress('Attempting direct database pull from device storage...');
        const sdcardDbPaths = [
          `/sdcard/WhatsApp/Databases/`,
          `/sdcard/Android/media/${packageName}/WhatsApp/Databases/`,
        ];

        for (const remotePath of sdcardDbPaths) {
          try {
            await adbService.pull(serial, remotePath, databasesDir);
            sendProgress(`Pulled databases from ${remotePath}`);
          } catch {
            // Path may not exist or may not be accessible
          }
        }

        sendProgress(`Extraction complete. ${copiedCount} database files extracted.`);

        return {
          success: true,
          databasesDir,
          filesExtracted: copiedCount,
          backupPath,
        };
      } finally {
        // Clean up temp directory
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively find all .db and .crypt* files in a directory.
 */
async function findDatabaseFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];

  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDatabaseFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      const name = entry.name.toLowerCase();
      if (
        name.endsWith('.db') ||
        name.endsWith('.db-wal') ||
        name.endsWith('.db-shm') ||
        name.includes('.crypt')
      ) {
        results.push(fullPath);
      }
    }
  }

  return results;
}
