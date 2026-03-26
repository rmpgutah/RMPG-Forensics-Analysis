export interface AndroidDevice {
  serial: string;
  model: string;
  manufacturer: string;
  product: string;
  osVersion: string;
  sdkVersion: string;
  buildId: string;
  imei?: string;
  wifiMac?: string;
  cpuInfo?: string;
  memoryInfo?: string;
  diskStats?: string;
  locationProviders?: string;
  installedPackages?: string[];
  status: 'device' | 'unauthorized' | 'offline' | 'recovery';
}

export interface IOSDevice {
  udid: string;
  name: string;
  productVersion: string;
  productType: string;
  serialNumber?: string;
  phoneNumber?: string;
  buildVersion?: string;
}

export interface DeviceListResult {
  android: AndroidDevice[];
  ios: IOSDevice[];
}
