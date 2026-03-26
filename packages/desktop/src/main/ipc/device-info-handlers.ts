import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import * as adbService from '../services/adb-service';

/**
 * Register device information IPC handlers.
 *
 * Maps to the original Form3.cs device property extraction functionality.
 * Each handler queries the connected Android device for specific system
 * information using ADB shell commands.
 */
export function registerDeviceInfoHandlers(): void {
  // ---------------------------------------------------------------------------
  // DEVICE_GET_PROPERTIES - Full device property set via getprop
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_GET_PROPERTIES,
    async (_event, serial: string) => {
      return adbService.getDeviceProperties(serial);
    }
  );

  // ---------------------------------------------------------------------------
  // DEVICE_GET_IMEI - Extract IMEI via service call iphonesubinfo
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_GET_IMEI,
    async (_event, serial: string) => {
      try {
        const output = await adbService.shell(serial, 'service call iphonesubinfo 1');
        // Parse hex output to extract IMEI digits
        const matches = output.match(/\d+/g);
        if (matches) {
          const digits = matches.join('').replace(/\D/g, '');
          if (digits.length >= 15) return digits.substring(0, 15);
        }
      } catch {
        // IMEI access may be restricted on the device
      }

      // Fallback: try getprop
      try {
        const output = await adbService.shell(serial, 'getprop persist.radio.imei');
        const trimmed = output.trim();
        if (trimmed.length >= 15) return trimmed;
      } catch {
        // Not available
      }

      return null;
    }
  );

  // ---------------------------------------------------------------------------
  // DEVICE_GET_LOCATION - Get location provider information
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_GET_LOCATION,
    async (_event, serial: string) => {
      try {
        const providers = await adbService.shell(
          serial,
          'settings get secure location_providers_allowed'
        );
        const gmsVersion = await adbService.shell(
          serial,
          'getprop ro.com.google.gmsversion'
        ).catch(() => '');

        return {
          providers: providers.trim(),
          gmsVersion: gmsVersion.trim(),
        };
      } catch (err) {
        throw new Error(`Failed to get location info: ${(err as Error).message}`);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // DEVICE_GET_WIFI - Get WiFi MAC address and network info
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_GET_WIFI,
    async (_event, serial: string) => {
      try {
        const macAddress = await adbService.shell(serial, 'cat /sys/class/net/wlan0/address').catch(() => '');
        const wifiInfo = await adbService.shell(serial, 'dumpsys wifi | head -30').catch(() => '');
        const ipConfig = await adbService.shell(serial, 'ip addr show wlan0').catch(() => '');

        return {
          macAddress: macAddress.trim(),
          wifiInfo: wifiInfo.trim(),
          ipConfig: ipConfig.trim(),
        };
      } catch (err) {
        throw new Error(`Failed to get WiFi info: ${(err as Error).message}`);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // DEVICE_GET_CPU - Get CPU information
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_GET_CPU,
    async (_event, serial: string) => {
      try {
        const cpuInfo = await adbService.shell(serial, 'cat /proc/cpuinfo');
        return cpuInfo.trim();
      } catch (err) {
        throw new Error(`Failed to get CPU info: ${(err as Error).message}`);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // DEVICE_GET_MEMORY - Get memory (RAM) information
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_GET_MEMORY,
    async (_event, serial: string) => {
      try {
        const memInfo = await adbService.shell(serial, 'cat /proc/meminfo');
        return memInfo.trim();
      } catch (err) {
        throw new Error(`Failed to get memory info: ${(err as Error).message}`);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // DEVICE_GET_DISKSTATS - Get disk usage statistics
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_GET_DISKSTATS,
    async (_event, serial: string) => {
      try {
        const dfOutput = await adbService.shell(serial, 'df -h');
        return dfOutput.trim();
      } catch (err) {
        throw new Error(`Failed to get disk stats: ${(err as Error).message}`);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // DEVICE_GET_PACKAGES - List all installed packages
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DEVICE_GET_PACKAGES,
    async (_event, serial: string) => {
      return adbService.listPackages(serial);
    }
  );
}
