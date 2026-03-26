import type { IOSDevice, ProcessResult, ProcessProgress, ProcessOptions } from '@rmpg/shared';
import { runCommand, runCommandWithProgress } from './process-runner';
import { resolveTool } from './tool-resolver';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getToolPath(
  toolName: 'idevice_id' | 'ideviceinfo' | 'idevicename' | 'idevicebackup2' | 'ideviceinstaller'
): Promise<string> {
  const tool = await resolveTool(toolName);
  if (!tool.found) {
    throw new Error(
      `${toolName} not found. Please install libimobiledevice and configure the path in Settings.`
    );
  }
  return tool.path;
}

/**
 * Parse the key-value output from ideviceinfo.
 * Format: "Key: Value" per line.
 */
function parseIdeviceInfoOutput(output: string): Record<string, string> {
  const map: Record<string, string> = {};
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim();
    if (key) map[key] = value;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List connected iOS devices.
 *
 * Uses `idevice_id -l` to enumerate UDIDs, then queries basic info for each.
 */
export async function listDevices(): Promise<IOSDevice[]> {
  const ideviceIdPath = await getToolPath('idevice_id');
  const result = await runCommand(ideviceIdPath, ['-l'], { timeout: 15000 });

  if (result.exitCode !== 0) {
    // No devices or tool error - return empty list rather than throwing
    return [];
  }

  const udids = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (udids.length === 0) return [];

  const devices: IOSDevice[] = [];
  for (const udid of udids) {
    try {
      const device = await getDeviceInfo(udid);
      devices.push(device);
    } catch {
      // If we can't get info for a device, include it with minimal data
      devices.push({
        udid,
        name: 'Unknown',
        productVersion: '',
        productType: '',
      });
    }
  }

  return devices;
}

/**
 * Get detailed information about a specific iOS device.
 *
 * Uses `ideviceinfo -u <udid>` to query device properties, and
 * `idevicename -u <udid>` to get the user-assigned device name.
 */
export async function getDeviceInfo(udid: string): Promise<IOSDevice> {
  const ideviceinfoPath = await getToolPath('ideviceinfo');

  // Get general device info
  const result = await runCommand(ideviceinfoPath, ['-u', udid], { timeout: 15000 });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to get info for iOS device ${udid}: ${result.stderr.trim()}`);
  }

  const props = parseIdeviceInfoOutput(result.stdout);

  // Get the user-assigned device name
  let deviceName = props['DeviceName'] ?? '';
  if (!deviceName) {
    try {
      const idevicenamePath = await getToolPath('idevicename');
      const nameResult = await runCommand(idevicenamePath, ['-u', udid], { timeout: 10000 });
      if (nameResult.exitCode === 0) {
        deviceName = nameResult.stdout.trim();
      }
    } catch {
      // idevicename not available, use what we have
    }
  }

  return {
    udid,
    name: deviceName || 'Unknown',
    productVersion: props['ProductVersion'] ?? '',
    productType: props['ProductType'] ?? '',
    serialNumber: props['SerialNumber'] ?? undefined,
    phoneNumber: props['PhoneNumber'] ?? undefined,
    buildVersion: props['BuildVersion'] ?? undefined,
  };
}

/**
 * Create an iOS device backup using idevicebackup2.
 *
 * Replaces the original C# libimobiledevice wrapper calls.
 *
 * @param udid - The device UDID
 * @param outputPath - Local directory where the backup will be stored
 * @param encrypted - Whether to enable backup encryption (default: false)
 * @param onProgress - Optional callback for real-time progress reporting
 */
export async function backup(
  udid: string,
  outputPath: string,
  encrypted?: boolean,
  onProgress?: (p: ProcessProgress) => void
): Promise<ProcessResult> {
  const idevicebackup2Path = await getToolPath('idevicebackup2');

  const args: string[] = [];

  // Set the target UDID
  args.push('-u', udid);

  // Enable encryption if requested
  if (encrypted) {
    args.push('encryption', 'on');
  }

  // Backup command and destination
  args.push('backup', '--full', outputPath);

  if (onProgress) {
    return runCommandWithProgress(idevicebackup2Path, args, {}, onProgress);
  }

  return runCommand(idevicebackup2Path, args);
}

/**
 * Restore a backup to an iOS device.
 */
export async function restore(
  udid: string,
  backupPath: string,
  onProgress?: (p: ProcessProgress) => void
): Promise<ProcessResult> {
  const idevicebackup2Path = await getToolPath('idevicebackup2');
  const args = ['-u', udid, 'restore', '--system', '--settings', backupPath];

  if (onProgress) {
    return runCommandWithProgress(idevicebackup2Path, args, {}, onProgress);
  }

  return runCommand(idevicebackup2Path, args);
}

/**
 * List installed apps on the iOS device.
 *
 * Uses ideviceinstaller to enumerate applications.
 */
export async function listInstalledApps(udid: string): Promise<string[]> {
  const ideviceinstallerPath = await getToolPath('ideviceinstaller');
  const result = await runCommand(ideviceinstallerPath, ['-u', udid, '-l'], { timeout: 30000 });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to list apps for device ${udid}: ${result.stderr.trim()}`);
  }

  return result.stdout
    .trim()
    .split(/\r?\n/)
    .slice(1) // Skip header line "Total: N apps"
    .map((line) => {
      // Format: "com.bundle.id, Version, DisplayName"
      const parts = line.split(',');
      return parts[0]?.trim() ?? '';
    })
    .filter((bundleId) => bundleId.length > 0);
}
