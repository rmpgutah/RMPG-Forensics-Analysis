import * as path from 'path';
import { runCommand } from './process-runner';
import { isMac } from './platform-service';

/**
 * Lightweight EXIF reader for forensic image search and geo extraction.
 *
 * Uses macOS's `mdls` (Spotlight metadata) on Darwin — the only platform
 * the existing handlers rely on — and returns a normalised subset of fields
 * the renderer cares about. Returning every field as optional means callers
 * can use the same code path for partially-tagged images (most photos in
 * the wild lack at least camera or GPS data).
 *
 * On non-macOS platforms this returns an empty object; callers fall back to
 * filename-only behaviour. A cross-platform replacement (exiftool / piexif)
 * is the next step if Linux/Windows support is needed.
 */
export interface ImageExif {
  latitude?: number;
  longitude?: number;
  altitude?: number;
  dateTaken?: string;
  cameraMake?: string;
  cameraModel?: string;
  width?: number;
  height?: number;
}

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.heic', '.heif', '.gif', '.webp',
]);

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

export async function readImageExif(filePath: string): Promise<ImageExif> {
  if (!isMac()) return {};

  try {
    const result = await runCommand('mdls', [filePath], { timeout: 10000 });
    if (result.exitCode !== 0) return {};

    const fields = parseMdlsOutput(result.stdout);
    return {
      latitude: numField(fields.kMDItemLatitude),
      longitude: numField(fields.kMDItemLongitude),
      altitude: numField(fields.kMDItemAltitude),
      dateTaken:
        strField(fields.kMDItemContentCreationDate) ??
        strField(fields.kMDItemFSCreationDate),
      cameraMake: strField(fields.kMDItemAcquisitionMake),
      cameraModel: strField(fields.kMDItemAcquisitionModel),
      width: numField(fields.kMDItemPixelWidth),
      height: numField(fields.kMDItemPixelHeight),
    };
  } catch {
    return {};
  }
}

/**
 * mdls emits one line per field: `keyName = value`. Quote-wrapped strings,
 * `(null)` for missing, and bare numbers/dates for everything else.
 */
function parseMdlsOutput(stdout: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(\w+)\s+=\s+(.+)$/);
    if (m && m[2] !== '(null)') fields[m[1]] = m[2].trim();
  }
  return fields;
}

function numField(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function strField(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/^"|"$/g, '');
}

/**
 * Great-circle distance in kilometres between two lat/lon points.
 * Standard haversine — accurate to <0.5% over typical search radii.
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
