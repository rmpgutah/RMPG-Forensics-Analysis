import * as fs from 'fs/promises';
import * as path from 'path';
import type { AndroidDevice, IOSDevice } from '@rmpg/shared';
import { isoNow, formatDisplayDate } from '@rmpg/shared';
import { APP_NAME, APP_VERSION } from '@rmpg/shared';

/**
 * Create the initial collection log file for a forensic case.
 *
 * Replaces the original C# "Logs_Coleta.txt" pattern. The log is a
 * plain-text file with a header block containing device information,
 * examiner details, and timestamped entries appended as the collection
 * proceeds.
 *
 * @returns The absolute path of the created log file.
 */
export async function createCollectionLog(config: {
  casePath: string;
  device: AndroidDevice | IOSDevice;
  examiner: string;
}): Promise<string> {
  const { casePath, device, examiner } = config;

  const logDir = path.join(casePath, 'collection_logs');
  await fs.mkdir(logDir, { recursive: true });

  const timestamp = new Date();
  const fileName = `collection_log_${timestamp.getTime()}.txt`;
  const logPath = path.join(logDir, fileName);

  const headerLines: string[] = [
    `${'='.repeat(70)}`,
    `  ${APP_NAME} v${APP_VERSION}`,
    `  Collection Log`,
    `${'='.repeat(70)}`,
    '',
    `Date/Time      : ${formatDisplayDate(timestamp)}`,
    `Examiner       : ${examiner}`,
    '',
  ];

  // Add device-specific information
  if (isAndroidDevice(device)) {
    headerLines.push(
      'Device Platform: Android',
      `Serial         : ${device.serial}`,
      `Model          : ${device.model}`,
      `Manufacturer   : ${device.manufacturer}`,
      `OS Version     : ${device.osVersion}`,
      `SDK Version    : ${device.sdkVersion}`,
      `Build ID       : ${device.buildId}`,
      `Product        : ${device.product}`,
    );
    if (device.imei) headerLines.push(`IMEI           : ${device.imei}`);
    if (device.wifiMac) headerLines.push(`WiFi MAC       : ${device.wifiMac}`);
  } else {
    headerLines.push(
      'Device Platform: iOS',
      `UDID           : ${device.udid}`,
      `Name           : ${device.name}`,
      `Product Version: ${device.productVersion}`,
      `Product Type   : ${device.productType}`,
    );
    if (device.serialNumber) headerLines.push(`Serial Number  : ${device.serialNumber}`);
    if (device.phoneNumber) headerLines.push(`Phone Number   : ${device.phoneNumber}`);
    if (device.buildVersion) headerLines.push(`Build Version  : ${device.buildVersion}`);
  }

  headerLines.push(
    '',
    `${'='.repeat(70)}`,
    '  Collection Events',
    `${'='.repeat(70)}`,
    '',
    `[${isoNow()}] Collection log initialized`,
    '',
  );

  await fs.writeFile(logPath, headerLines.join('\n'), 'utf-8');
  return logPath;
}

/**
 * Append a timestamped entry to an existing collection log.
 *
 * Each entry is written as:
 *   [ISO_TIMESTAMP] <message text>
 */
export async function appendToLog(logPath: string, entry: string): Promise<void> {
  const line = `[${isoNow()}] ${entry}\n`;
  await fs.appendFile(logPath, line, 'utf-8');
}

/**
 * Append a section header to the log for visual grouping.
 */
export async function appendSectionHeader(logPath: string, sectionName: string): Promise<void> {
  const lines = [
    '',
    `--- ${sectionName} ${'---'.repeat(10)}`,
    '',
  ].join('\n');
  await fs.appendFile(logPath, lines, 'utf-8');
}

/**
 * Append a completion summary to the log file.
 */
export async function appendCompletionSummary(
  logPath: string,
  summary: { totalFiles: number; totalSize: number; durationMs: number; errors: number }
): Promise<void> {
  const lines = [
    '',
    `${'='.repeat(70)}`,
    '  Collection Summary',
    `${'='.repeat(70)}`,
    '',
    `Completed At   : ${formatDisplayDate(new Date())}`,
    `Total Files    : ${summary.totalFiles}`,
    `Total Size     : ${formatBytes(summary.totalSize)}`,
    `Duration       : ${formatDuration(summary.durationMs)}`,
    `Errors         : ${summary.errors}`,
    '',
    `${'='.repeat(70)}`,
    '',
  ].join('\n');
  await fs.appendFile(logPath, lines, 'utf-8');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isAndroidDevice(device: AndroidDevice | IOSDevice): device is AndroidDevice {
  return 'serial' in device && 'sdkVersion' in device;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
