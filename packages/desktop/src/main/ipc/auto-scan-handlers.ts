import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import { runCommand } from '../services/process-runner';
import { resolveTool } from '../services/tool-resolver';
import * as iosService from '../services/ios-service';

/**
 * DEVICE_AUTO_SCAN - Triggered automatically when a device connects.
 *
 * For Android: aggregates adb shell commands to collect all device info,
 * battery, memory, CPU, WiFi, disk, installed packages, location, IMEI.
 *
 * For iOS: uses ideviceinfo domain queries to collect all available info.
 *
 * Returns a unified DeviceProfile object for the dashboard.
 */
export function registerAutoScanHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_AUTO_SCAN,
    async (_event, options: { serial: string; platform: 'android' | 'ios' }) => {
      const { serial, platform } = options;

      if (platform === 'android') {
        return scanAndroidDevice(serial);
      } else {
        return scanIosDevice(serial);
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Android full scan
// ---------------------------------------------------------------------------

async function adbShell(serial: string, command: string): Promise<string> {
  const adb = await resolveTool('adb');
  if (!adb.found) return '';
  const result = await runCommand(adb.path, ['-s', serial, 'shell', command], { timeout: 8000 });
  return result.stdout.trim();
}

async function scanAndroidDevice(serial: string) {
  // Run all queries in parallel for speed
  const [
    propsRaw,
    batteryRaw,
    memRaw,
    diskRaw,
    cpuRaw,
    wifiRaw,
    imeiRaw,
    locationRaw,
    packagesRaw,
    buildRaw,
    uptimeRaw,
    accountsRaw,
    networkRaw,
  ] = await Promise.all([
    adbShell(serial, 'getprop').catch(() => ''),
    adbShell(serial, 'dumpsys battery').catch(() => ''),
    adbShell(serial, 'cat /proc/meminfo').catch(() => ''),
    adbShell(serial, 'df /data /sdcard 2>/dev/null || df /data 2>/dev/null').catch(() => ''),
    adbShell(serial, 'cat /proc/cpuinfo | grep -E "Hardware|processor|model name" | head -10').catch(() => ''),
    adbShell(serial, 'dumpsys wifi | head -80').catch(() => ''),
    adbShell(serial, 'service call iphonesubinfo 1 | awk -F"\'" \'NR==1{print $2}\'').catch(() => ''),
    adbShell(serial, 'dumpsys location | grep -E "mLastLocation|last known" | head -5').catch(() => ''),
    adbShell(serial, 'pm list packages -3').catch(() => ''),
    adbShell(serial, 'getprop ro.build.display.id').catch(() => ''),
    adbShell(serial, 'cat /proc/uptime').catch(() => ''),
    adbShell(serial, 'dumpsys account | grep "Account {" | head -20').catch(() => ''),
    adbShell(serial, 'ip addr show | grep -E "inet |link/ether" | head -10').catch(() => ''),
  ]);

  // Parse properties
  const props: Record<string, string> = {};
  for (const line of propsRaw.split('\n')) {
    const m = line.match(/^\[(.+?)\]:\s*\[(.*)]/);
    if (m) props[m[1]] = m[2];
  }

  // Parse battery
  const battery: Record<string, string> = {};
  for (const line of batteryRaw.split('\n')) {
    const m = line.match(/^\s+(\w[\w ]+):\s+(.+)/);
    if (m) battery[m[1].trim()] = m[2].trim();
  }

  // Parse memory
  const mem: Record<string, string> = {};
  for (const line of memRaw.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+\s*\w+)/);
    if (m) mem[m[1]] = m[2];
  }

  // Parse user-installed packages
  const packages = packagesRaw
    .split('\n')
    .map((l) => l.replace('package:', '').trim())
    .filter(Boolean);

  // Extract WiFi SSID
  const ssidMatch = wifiRaw.match(/mWifiInfo.*SSID:\s*"?([^",]+)"?/);
  const wifiSsid = ssidMatch ? ssidMatch[1] : '';

  // Parse network interfaces
  const ifaces: string[] = [];
  for (const line of networkRaw.split('\n')) {
    if (line.includes('inet ')) {
      const m = line.match(/inet\s+([\d.]+)/);
      if (m) ifaces.push(m[1]);
    }
  }

  // Parse location
  const locMatch = locationRaw.match(/lat=([\d.-]+).*?lon=([\d.-]+)/);

  // Parse uptime seconds
  const uptimeSecs = parseFloat(uptimeRaw.split(' ')[0] || '0');
  const uptimeHours = (uptimeSecs / 3600).toFixed(1);

  return {
    platform: 'android' as const,
    serial,
    scannedAt: new Date().toISOString(),

    // Identity
    deviceName: props['ro.product.name'] ?? props['ro.product.model'] ?? '',
    model: props['ro.product.model'] ?? '',
    manufacturer: props['ro.product.manufacturer'] ?? '',
    brand: props['ro.product.brand'] ?? '',
    androidVersion: props['ro.build.version.release'] ?? '',
    sdkVersion: props['ro.build.version.sdk'] ?? '',
    buildId: (buildRaw || props['ro.build.id']) ?? '',
    buildFingerprint: props['ro.build.fingerprint'] ?? '',
    kernelVersion: props['ro.kernel.version'] ?? '',
    cpuAbi: props['ro.product.cpu.abi'] ?? '',
    cpuInfo: cpuRaw.split('\n').find((l) => l.includes('Hardware') || l.includes('model name'))?.split(':')[1]?.trim() ?? '',
    screenResolution: props['ro.sf.lcd_density'] ? `${props['ro.sf.lcd_density']} dpi` : '',
    imei: imeiRaw.replace(/[^0-9]/g, '') || '',
    serialNumber: props['ro.serialno'] ?? serial,

    // Battery
    battery: {
      level: parseInt(battery['level'] ?? '0'),
      status: battery['status'] ?? '',
      health: battery['health'] ?? '',
      temperature: battery['temperature'] ? `${(parseInt(battery['temperature']) / 10).toFixed(1)}°C` : '',
      voltage: battery['voltage'] ? `${battery['voltage']}mV` : '',
      plugged: battery['plugged'] ?? '',
      technology: battery['technology'] ?? '',
    },

    // Memory
    memory: {
      total: mem['MemTotal'] ?? '',
      free: mem['MemFree'] ?? '',
      available: mem['MemAvailable'] ?? '',
      cached: mem['Cached'] ?? '',
    },

    // Storage
    storage: diskRaw,

    // Network
    wifi: { ssid: wifiSsid },
    ipAddresses: ifaces,

    // Location (last known)
    lastLocation: locMatch
      ? { lat: parseFloat(locMatch[1]), lon: parseFloat(locMatch[2]) }
      : null,

    // Apps
    installedApps: packages,
    installedAppCount: packages.length,

    // Accounts
    accounts: accountsRaw.split('\n').filter(Boolean).slice(0, 10),

    // System
    uptimeHours,
    securityPatch: props['ro.build.version.security_patch'] ?? '',
    bootloaderStatus: props['ro.boot.verifiedbootstate'] ?? '',
    selinuxStatus: props['ro.boot.selinux'] ?? '',
    encrypted: props['ro.crypto.state'] ?? '',
  };
}

// ---------------------------------------------------------------------------
// iOS full scan
// ---------------------------------------------------------------------------

async function scanIosDevice(udid: string) {
  const [deviceInfo, diagnostics] = await Promise.all([
    iosService.getDeviceInfo(udid).catch(() => null),
    iosService.getDeviceDiagnostics(udid).catch(() => ({})),
  ]);

  const diag = diagnostics as Record<string, Record<string, string>>;
  const dev = (diag.device ?? {}) as Record<string, string>;
  const batt = (diag.battery ?? {}) as Record<string, string>;
  const disk = (diag.disk ?? {}) as Record<string, string>;
  const wifi = (diag.wifi ?? {}) as Record<string, string>;

  return {
    platform: 'ios' as const,
    serial: udid,
    scannedAt: new Date().toISOString(),

    // Identity
    deviceName: deviceInfo?.name ?? dev['DeviceName'] ?? '',
    model: deviceInfo?.productType ?? dev['ProductType'] ?? '',
    manufacturer: 'Apple',
    productVersion: deviceInfo?.productVersion ?? dev['ProductVersion'] ?? '',
    buildVersion: deviceInfo?.buildVersion ?? dev['BuildVersion'] ?? '',
    serialNumber: deviceInfo?.serialNumber ?? dev['SerialNumber'] ?? '',
    phoneNumber: deviceInfo?.phoneNumber ?? dev['PhoneNumber'] ?? '',
    imei: dev['InternationalMobileEquipmentIdentity'] ?? dev['IMEI'] ?? '',
    meid: dev['MobileEquipmentIdentifier'] ?? '',
    iccid: dev['SIMStatus'] ?? '',
    wifiAddress: dev['WiFiAddress'] ?? '',
    bluetoothAddress: dev['BluetoothAddress'] ?? '',
    cpuArchitecture: dev['CPUArchitecture'] ?? '',
    hardwareModel: dev['HardwareModel'] ?? '',
    uniqueDeviceID: udid,

    // Battery
    battery: {
      level: parseInt(batt['BatteryCurrentCapacity'] ?? '0'),
      charging: batt['BatteryIsCharging'] === 'true',
      fullyCharged: batt['ExternalChargeCapable'] === 'true',
      bootVoltage: batt['BatteryBootVoltage'] ?? '',
    },

    // Storage
    storage: {
      totalDisk: disk['TotalDiskCapacity'] ?? '',
      availableDisk: disk['TotalSystemAvailable'] ?? '',
      usedDisk: disk['TotalDataCapacity'] ?? '',
      mediaAvailable: disk['MobileStorageInfo'] ?? '',
    },

    // WiFi
    wifi: {
      ssid: wifi['SSID'] ?? '',
      bssid: wifi['BSSID'] ?? '',
      channel: wifi['Channel'] ?? '',
    },

    // All raw properties
    allProperties: dev,
  };
}
