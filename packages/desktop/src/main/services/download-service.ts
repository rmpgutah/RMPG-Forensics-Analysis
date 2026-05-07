import { app, BrowserWindow, shell } from 'electron';
import { createWriteStream, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { IncomingMessage } from 'http';
import * as https from 'https';
import * as http from 'http';
import { IPC_CHANNELS } from '@rmpg/shared';

export interface DownloadableApp {
  id: string;
  name: string;
  description: string;
  version: string;
  platforms: {
    win?: { url: string; filename: string; size: string };
    mac?: { url: string; filename: string; size: string };
  };
  badge: 'stable' | 'beta' | 'alpha';
}

export interface DownloadProgress {
  id: string;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  speed: string;
  status: 'idle' | 'downloading' | 'complete' | 'error' | 'cancelled';
  error?: string;
  filePath?: string;
}

const DOWNLOAD_CATALOG: DownloadableApp[] = [
  {
    id: 'rmpg-forensics',
    name: 'RMPG Forensics Analysis',
    description: 'Cross-platform mobile device forensics toolkit with ADB backup, iOS extraction, WhatsApp decryption, and court-ready reporting.',
    version: '1.0.0',
    platforms: {
      win: {
        url: 'https://github.com/rmpgutah/RMPG-Forensics-Analysis/releases/latest/download/RMPG-Forensics-Analysis-Setup.exe',
        filename: 'RMPG-Forensics-Analysis-Setup.exe',
        size: '~113 MB',
      },
      mac: {
        url: 'https://github.com/rmpgutah/RMPG-Forensics-Analysis/releases/latest/download/RMPG-Forensics-Analysis.dmg',
        filename: 'RMPG-Forensics-Analysis.dmg',
        size: '~130 MB',
      },
    },
    badge: 'stable',
  },
  {
    id: 'rmpg-osint',
    name: 'RMPG OSINT Intelligence',
    description: 'Open source intelligence gathering platform. Social media lookup, email/username search, domain recon, IP geolocation, and dark web monitoring.',
    version: '0.9.0',
    platforms: {
      win: {
        url: 'https://github.com/rmpgutah/RMPG-OSINT/releases/latest/download/RMPG-OSINT-Setup.exe',
        filename: 'RMPG-OSINT-Setup.exe',
        size: '~73 MB',
      },
      mac: {
        url: 'https://github.com/rmpgutah/RMPG-OSINT/releases/latest/download/RMPG-OSINT.dmg',
        filename: 'RMPG-OSINT.dmg',
        size: '~80 MB',
      },
    },
    badge: 'beta',
  },
  {
    id: 'rmpg-flex',
    name: 'RMPG Flex',
    description: 'Flexible investigation workspace and automation hub. Unified workflow connecting forensics, OSINT, and case management with pipeline automation.',
    version: '0.5.0',
    platforms: {
      win: {
        url: 'https://github.com/rmpgutah/RMPG-Flex/releases/latest/download/RMPG-Flex-Setup.exe',
        filename: 'RMPG-Flex-Setup.exe',
        size: '~85 MB',
      },
      mac: {
        url: 'https://github.com/rmpgutah/RMPG-Flex/releases/latest/download/RMPG-Flex.dmg',
        filename: 'RMPG-Flex.dmg',
        size: '~90 MB',
      },
    },
    badge: 'alpha',
  },
];

const activeDownloads = new Map<string, { request: http.ClientRequest; cancelled: boolean }>();

function getDownloadsDir(): string {
  const dir = join(app.getPath('userData'), 'downloads');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1048576) {
    return `${(bytesPerSecond / 1048576).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
  }
  return `${bytesPerSecond} B/s`;
}

function followRedirects(url: string, maxRedirects: number = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        followRedirects(response.headers.location, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      } else if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        resolve(response);
      } else {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
      }
    });

    request.on('error', reject);
  });
}

export function getDownloadCatalog(): DownloadableApp[] {
  return DOWNLOAD_CATALOG;
}

export function getLocalDownloadStatus(appId: string, platform: 'win' | 'mac'): { exists: boolean; filePath?: string; fileSize?: number } {
  const catalogEntry = DOWNLOAD_CATALOG.find((a) => a.id === appId);
  if (!catalogEntry) return { exists: false };

  const platformInfo = catalogEntry.platforms[platform];
  if (!platformInfo) return { exists: false };

  const filePath = join(getDownloadsDir(), platformInfo.filename);
  if (existsSync(filePath)) {
    const stats = statSync(filePath);
    return { exists: true, filePath, fileSize: stats.size };
  }
  return { exists: false };
}

export async function startDownload(
  appId: string,
  platform: 'win' | 'mac',
  window: BrowserWindow
): Promise<void> {
  const catalogEntry = DOWNLOAD_CATALOG.find((a) => a.id === appId);
  if (!catalogEntry) throw new Error(`Unknown app: ${appId}`);

  const platformInfo = catalogEntry.platforms[platform];
  if (!platformInfo) throw new Error(`App "${catalogEntry.name}" is not available for ${platform === 'win' ? 'Windows' : 'macOS'}`);

  const destPath = join(getDownloadsDir(), platformInfo.filename);
  const downloadId = `${appId}-${platform}`;

  // Cancel existing download for same app/platform if running
  if (activeDownloads.has(downloadId)) {
    const existing = activeDownloads.get(downloadId)!;
    existing.cancelled = true;
    existing.request.destroy();
    activeDownloads.delete(downloadId);
  }

  // Remove partial file if it exists
  if (existsSync(destPath)) {
    unlinkSync(destPath);
  }

  const sendProgress = (progress: DownloadProgress) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.DOWNLOAD_PROGRESS, progress);
    }
  };

  sendProgress({
    id: downloadId,
    percent: 0,
    bytesDownloaded: 0,
    totalBytes: 0,
    speed: '0 B/s',
    status: 'downloading',
  });

  try {
    const response = await followRedirects(platformInfo.url);
    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    let bytesDownloaded = 0;
    let lastTime = Date.now();
    let lastBytes = 0;

    const fileStream = createWriteStream(destPath);
    const downloadEntry = { request: response.socket?.destroyed ? null : (response as unknown as http.ClientRequest), cancelled: false };
    activeDownloads.set(downloadId, downloadEntry as { request: http.ClientRequest; cancelled: boolean });

    response.on('data', (chunk: Buffer) => {
      if (downloadEntry.cancelled) {
        response.destroy();
        return;
      }

      bytesDownloaded += chunk.length;
      fileStream.write(chunk);

      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;
      if (timeDiff >= 0.5) {
        const bytesDiff = bytesDownloaded - lastBytes;
        const speed = bytesDiff / timeDiff;
        lastTime = now;
        lastBytes = bytesDownloaded;

        sendProgress({
          id: downloadId,
          percent: totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0,
          bytesDownloaded,
          totalBytes,
          speed: formatSpeed(speed),
          status: 'downloading',
        });
      }
    });

    response.on('end', () => {
      fileStream.end();
      activeDownloads.delete(downloadId);

      if (downloadEntry.cancelled) {
        if (existsSync(destPath)) unlinkSync(destPath);
        sendProgress({
          id: downloadId,
          percent: 0,
          bytesDownloaded: 0,
          totalBytes: 0,
          speed: '0 B/s',
          status: 'cancelled',
        });
      } else {
        sendProgress({
          id: downloadId,
          percent: 100,
          bytesDownloaded,
          totalBytes: totalBytes || bytesDownloaded,
          speed: '0 B/s',
          status: 'complete',
          filePath: destPath,
        });
      }
    });

    response.on('error', (err) => {
      fileStream.end();
      activeDownloads.delete(downloadId);
      if (existsSync(destPath)) unlinkSync(destPath);

      sendProgress({
        id: downloadId,
        percent: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        speed: '0 B/s',
        status: 'error',
        error: err.message,
      });
    });
  } catch (err) {
    activeDownloads.delete(downloadId);
    const message = err instanceof Error ? err.message : String(err);
    sendProgress({
      id: downloadId,
      percent: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      speed: '0 B/s',
      status: 'error',
      error: message,
    });
    throw err;
  }
}

export function cancelDownload(appId: string, platform: 'win' | 'mac'): void {
  const downloadId = `${appId}-${platform}`;
  const entry = activeDownloads.get(downloadId);
  if (entry) {
    entry.cancelled = true;
    entry.request.destroy();
    activeDownloads.delete(downloadId);
  }
}

export function openDownloadsFolder(): void {
  shell.openPath(getDownloadsDir());
}
