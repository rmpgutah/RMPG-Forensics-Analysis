/** Detected Android device connected via ADB. */
export interface AndroidDevice {
  /** ADB serial identifier. */
  serial: string;
  /** Device model name (ro.product.model). */
  model: string;
  /** Device manufacturer (ro.product.manufacturer). */
  manufacturer: string;
  /** Product codename (ro.product.name). */
  product: string;
  /** Android version string (e.g. "14"). */
  osVersion: string;
  /** Android SDK level (e.g. "34"). */
  sdkVersion: string;
  /** Build identifier. */
  buildId: string;
  /** IMEI if accessible. */
  imei?: string;
  /** Wi-Fi MAC address. */
  wifiMac?: string;
  /** CPU architecture info. */
  cpuInfo?: string;
  /** Memory statistics. */
  memoryInfo?: string;
  /** Disk usage statistics. */
  diskStats?: string;
  /** Enabled location providers. */
  locationProviders?: string;
  /** List of installed package names. */
  installedPackages?: string[];
  /** Current ADB connection status. */
  status: 'device' | 'unauthorized' | 'offline' | 'recovery';
}

/** Detected iOS device connected via libimobiledevice. */
export interface IOSDevice {
  /** Unique device identifier. */
  udid: string;
  /** User-assigned device name. */
  name: string;
  /** iOS version (e.g. "17.4.1"). */
  productVersion: string;
  /** Hardware model identifier (e.g. "iPhone15,2"). */
  productType: string;
  /** Hardware serial number. */
  serialNumber?: string;
  /** Phone number if accessible. */
  phoneNumber?: string;
  /** Build version string. */
  buildVersion?: string;
}

/** Result of a device listing operation — both platforms. */
export interface DeviceListResult {
  /** Connected Android devices. */
  android: AndroidDevice[];
  /** Connected iOS devices. */
  ios: IOSDevice[];
}
