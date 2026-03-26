import * as path from 'path';
import type { AndroidDevice, ProcessResult, ProcessProgress, ProcessOptions } from '@rmpg/shared';
import { runCommand, runCommandWithProgress } from './process-runner';
import { resolveTool } from './tool-resolver';

export interface AdbBackupOptions {
  /** Include APK files in the backup. Default: false */
  apk?: boolean;
  /** Include shared storage / SD card. Default: false */
  shared?: boolean;
  /** Include all installed apps. Default: true */
  all?: boolean;
  /** Include system apps. Default: false */
  system?: boolean;
  /** Specific packages to back up (if not using all). */
  packages?: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let cachedAdbPath: string | null = null;

async function getAdbPath(): Promise<string> {
  if (cachedAdbPath) return cachedAdbPath;
  const tool = await resolveTool('adb');
  if (!tool.found) {
    throw new Error(
      'ADB not found. Please install the Android SDK Platform Tools and configure the path in Settings.'
    );
  }
  cachedAdbPath = tool.path;
  return tool.path;
}

async function adb(args: string[], options?: ProcessOptions): Promise<ProcessResult> {
  const adbPath = await getAdbPath();
  return runCommand(adbPath, args, options);
}

async function adbStrict(args: string[], options?: ProcessOptions): Promise<ProcessResult> {
  const result = await adb(args, options);
  if (result.exitCode !== 0) {
    const msg = result.stderr.trim() || result.stdout.trim() || `Exit code ${result.exitCode}`;
    throw new Error(`ADB command failed (${args.join(' ')}): ${msg}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List connected Android devices.
 *
 * Parses the output of `adb devices -l` to extract serial, model, product, etc.
 */
export async function listDevices(): Promise<AndroidDevice[]> {
  const result = await adbStrict(['devices', '-l']);
  const lines = result.stdout.trim().split(/\r?\n/).slice(1); // Skip header
  const devices: AndroidDevice[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('*')) continue;

    // Format: <serial> <status> [key:value ...]
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const serial = parts[0];
    const status = parts[1] as AndroidDevice['status'];

    // Extract key:value pairs
    const kvPairs: Record<string, string> = {};
    for (let i = 2; i < parts.length; i++) {
      const [key, val] = parts[i].split(':');
      if (key && val) kvPairs[key] = val;
    }

    devices.push({
      serial,
      model: kvPairs['model'] ?? '',
      manufacturer: '',
      product: kvPairs['product'] ?? '',
      osVersion: '',
      sdkVersion: '',
      buildId: '',
      status,
    });
  }

  return devices;
}

/**
 * Get detailed properties for a specific device by querying getprop.
 */
export async function getDeviceProperties(serial: string): Promise<AndroidDevice> {
  const props = await shell(serial, 'getprop');
  const propMap = parseGetprop(props);

  return {
    serial,
    model: propMap['ro.product.model'] ?? '',
    manufacturer: propMap['ro.product.manufacturer'] ?? '',
    product: propMap['ro.product.name'] ?? '',
    osVersion: propMap['ro.build.version.release'] ?? '',
    sdkVersion: propMap['ro.build.version.sdk'] ?? '',
    buildId: propMap['ro.build.display.id'] ?? '',
    imei: await getImei(serial),
    wifiMac: propMap['ro.boot.wifimacaddr'] ?? undefined,
    cpuInfo: await getShellOutput(serial, 'cat /proc/cpuinfo | head -20'),
    memoryInfo: await getShellOutput(serial, 'cat /proc/meminfo | head -5'),
    diskStats: await getShellOutput(serial, 'df -h'),
    locationProviders: propMap['ro.com.google.gmsversion'] ?? undefined,
    status: 'device',
  };
}

/**
 * Create an ADB backup.
 *
 * Runs `adb backup` with the specified options and streams progress events.
 */
export async function backup(
  serial: string,
  outputPath: string,
  options: AdbBackupOptions = {},
  onProgress?: (p: ProcessProgress) => void
): Promise<ProcessResult> {
  const args = ['-s', serial, 'backup', '-f', outputPath];

  if (options.apk) args.push('-apk');
  else args.push('-noapk');

  if (options.shared) args.push('-shared');
  else args.push('-noshared');

  if (options.system) args.push('-system');
  else args.push('-nosystem');

  if (options.all) {
    args.push('-all');
  }

  if (options.packages && options.packages.length > 0) {
    args.push(...options.packages);
  }

  const adbPath = await getAdbPath();

  if (onProgress) {
    return runCommandWithProgress(adbPath, args, {}, onProgress);
  }
  return runCommand(adbPath, args);
}

/**
 * Pull a file or directory from the device to local storage.
 */
export async function pull(
  serial: string,
  remotePath: string,
  localPath: string
): Promise<ProcessResult> {
  return adbStrict(['-s', serial, 'pull', remotePath, localPath]);
}

/**
 * Push a file or directory from local storage to the device.
 */
export async function push(
  serial: string,
  localPath: string,
  remotePath: string
): Promise<ProcessResult> {
  return adbStrict(['-s', serial, 'push', localPath, remotePath]);
}

/**
 * Run a shell command on the device and return the stdout text.
 */
export async function shell(serial: string, command: string): Promise<string> {
  const result = await adb(['-s', serial, 'shell', command]);
  if (result.exitCode !== 0 && result.stderr.trim()) {
    throw new Error(`ADB shell failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/**
 * Install an APK on the device.
 */
export async function install(serial: string, apkPath: string): Promise<ProcessResult> {
  return adbStrict(['-s', serial, 'install', '-r', apkPath]);
}

/**
 * Uninstall a package from the device.
 */
export async function uninstall(serial: string, packageName: string): Promise<ProcessResult> {
  return adbStrict(['-s', serial, 'uninstall', packageName]);
}

/**
 * Take a screenshot of the device screen and save it locally.
 *
 * Uses screencap on the device, then pulls the file to the local path.
 */
export async function screencap(serial: string, outputPath: string): Promise<string> {
  const remoteTmp = '/sdcard/rmpg_screencap.png';
  await shell(serial, `screencap -p ${remoteTmp}`);
  await pull(serial, remoteTmp, outputPath);
  // Clean up the temporary file on the device
  await shell(serial, `rm -f ${remoteTmp}`).catch(() => {});
  return outputPath;
}

/**
 * List installed packages on the device.
 */
export async function listPackages(serial: string): Promise<string[]> {
  const output = await shell(serial, 'pm list packages');
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.replace('package:', '').trim())
    .filter((pkg) => pkg.length > 0);
}

/**
 * Reboot the device. Mode can be 'system', 'recovery', or 'bootloader'.
 */
export async function reboot(
  serial: string,
  mode: 'system' | 'recovery' | 'bootloader' = 'system'
): Promise<ProcessResult> {
  const args = ['-s', serial, 'reboot'];
  if (mode !== 'system') args.push(mode);
  return adb(args);
}

/**
 * Clear the ADB path cache (e.g. after user reconfigures the tool path).
 */
export function clearAdbPathCache(): void {
  cachedAdbPath = null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseGetprop(output: string): Record<string, string> {
  const map: Record<string, string> = {};
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    // Format: [key]: [value]
    const match = line.match(/^\[(.+?)]\s*:\s*\[(.*)]/);
    if (match) {
      map[match[1]] = match[2];
    }
  }
  return map;
}

async function getImei(serial: string): Promise<string | undefined> {
  try {
    // Try service call iphonesubinfo (works on many devices)
    const output = await shell(serial, 'service call iphonesubinfo 1');
    // Parse the hex output to extract IMEI digits
    const matches = output.match(/\d+/g);
    if (matches) {
      const digits = matches.join('').replace(/\D/g, '');
      if (digits.length >= 15) return digits.substring(0, 15);
    }
  } catch {
    // IMEI access may be restricted
  }

  try {
    // Alternative: getprop approach
    const output = await shell(serial, 'getprop persist.radio.imei');
    const trimmed = output.trim();
    if (trimmed.length >= 15) return trimmed;
  } catch {
    // Not available
  }

  return undefined;
}

async function getShellOutput(serial: string, command: string): Promise<string | undefined> {
  try {
    const output = await shell(serial, command);
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}
