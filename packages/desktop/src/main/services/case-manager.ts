import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import * as zlib from 'zlib';
import type { ForensicCase, Acquisition, AcquisitionType } from '@rmpg/shared';
import { formatCaseTimestamp, isoNow } from '@rmpg/shared';

/** Name of the JSON manifest file stored in the root of each case folder. */
const CASE_MANIFEST = 'case.json';

/**
 * Standard subdirectories created inside every case folder.
 * Each module writes its output into the matching subdirectory.
 */
const CASE_SUBDIRS = [
  'adb_backups',
  'device_info',
  'file_extractions',
  'whatsapp',
  'whatsapp/databases',
  'whatsapp/media',
  'whatsapp/contacts',
  'whatsapp/reports',
  'audio_transcriptions',
  'ios_backups',
  'iped_analysis',
  'ocr_output',
  'screen_captures',
  'media_reports',
  'instagram',
  'special_dump',
  'trash_recovery',
  'hash_logs',
  'collection_logs',
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new forensic case folder with the standard directory structure.
 *
 * Replaces the temp-file state pattern from the original C# codebase
 * (PathAcquisition.txt, PathCollectionLog.txt, etc.) with a single JSON
 * manifest that tracks everything about the case.
 */
export async function createCase(config: {
  examinerName: string;
  caseNumber: string;
  description: string;
  outputDir: string;
}): Promise<ForensicCase> {
  const folderName = formatCaseTimestamp(new Date());
  const casePath = path.join(config.outputDir, folderName);

  // Create the root case folder
  await fs.mkdir(casePath, { recursive: true });

  // Create all standard subdirectories
  for (const subdir of CASE_SUBDIRS) {
    await fs.mkdir(path.join(casePath, subdir), { recursive: true });
  }

  const forensicCase: ForensicCase = {
    id: crypto.randomUUID(),
    name: folderName,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    localPath: casePath,
    examinerName: config.examinerName,
    caseNumber: config.caseNumber,
    description: config.description,
    acquisitions: [],
    syncStatus: 'local_only',
  };

  // Write the manifest
  await writeManifest(casePath, forensicCase);

  return forensicCase;
}

/**
 * Open an existing case from its folder path by reading the manifest.
 */
export async function openCase(casePath: string): Promise<ForensicCase> {
  const manifestPath = path.join(casePath, CASE_MANIFEST);
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(raw) as ForensicCase;
    // Update localPath in case the folder was moved
    data.localPath = casePath;
    return data;
  } catch (err) {
    throw new Error(
      `Failed to open case at "${casePath}": ${(err as Error).message}. ` +
        `Make sure the folder contains a valid ${CASE_MANIFEST} file.`
    );
  }
}

/**
 * List all cases in a given base directory.
 *
 * Scans one level deep for directories containing a case.json manifest.
 */
export async function getCaseList(baseDir: string): Promise<ForensicCase[]> {
  const cases: ForensicCase[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(baseDir);
  } catch {
    return cases;
  }

  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isDirectory()) continue;

      const manifestPath = path.join(fullPath, CASE_MANIFEST);
      const manifestStat = await fs.stat(manifestPath).catch(() => null);
      if (!manifestStat) continue;

      const forensicCase = await openCase(fullPath);
      cases.push(forensicCase);
    } catch {
      // Skip directories that fail to parse
      continue;
    }
  }

  // Sort newest first
  cases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return cases;
}

/**
 * Add an acquisition record to an existing case.
 */
export async function addAcquisition(casePath: string, acquisition: Acquisition): Promise<void> {
  const forensicCase = await openCase(casePath);
  forensicCase.acquisitions.push(acquisition);
  forensicCase.updatedAt = isoNow();
  await writeManifest(casePath, forensicCase);
}

/**
 * Update the status of an existing acquisition within a case.
 */
export async function updateAcquisitionStatus(
  casePath: string,
  acquisitionId: string,
  status: Acquisition['status'],
  updates?: Partial<Pick<Acquisition, 'fileCount' | 'totalSize' | 'hashLog' | 'notes'>>
): Promise<void> {
  const forensicCase = await openCase(casePath);
  const acq = forensicCase.acquisitions.find((a) => a.id === acquisitionId);
  if (!acq) {
    throw new Error(`Acquisition "${acquisitionId}" not found in case.`);
  }
  acq.status = status;
  if (updates?.fileCount !== undefined) acq.fileCount = updates.fileCount;
  if (updates?.totalSize !== undefined) acq.totalSize = updates.totalSize;
  if (updates?.hashLog !== undefined) acq.hashLog = updates.hashLog;
  if (updates?.notes !== undefined) acq.notes = updates.notes;
  forensicCase.updatedAt = isoNow();
  await writeManifest(casePath, forensicCase);
}

/**
 * Create a new Acquisition object with a unique ID and timestamp.
 * Helper for callers that need to build the acquisition before adding it.
 */
export function buildAcquisition(
  caseId: string,
  type: AcquisitionType,
  notes = ''
): Acquisition {
  return {
    id: crypto.randomUUID(),
    caseId,
    type,
    timestamp: isoNow(),
    status: 'pending',
    fileCount: 0,
    totalSize: 0,
    notes,
  };
}

/**
 * Export a case folder to a zip archive.
 *
 * Uses Node.js built-in zlib (gzip) wrapped with tar-like archiving via
 * recursive file streaming. The zip file preserves the relative folder
 * structure so that importCase() can reconstruct it.
 *
 * Note: This uses a simple tar.gz approach. For a full .zip with directory
 * structure, a library like archiver would be more appropriate in production.
 * Here we implement a working gzipped tarball approach.
 */
export async function exportCase(casePath: string, outputZipPath: string): Promise<void> {
  // We use a simple approach: write a JSON index + gzip the folder contents
  const forensicCase = await openCase(casePath);
  const files = await collectAllFiles(casePath);

  // Build an archive manifest
  const archiveManifest = {
    case: forensicCase,
    files: files.map((f) => ({
      relativePath: path.relative(casePath, f),
      absolutePath: f,
    })),
    exportedAt: isoNow(),
  };

  // Write manifest as the first entry, then concatenate file contents
  // For a proper implementation, use the archiver npm package.
  // Here we write a JSON bundle with base64-encoded file contents.
  const bundle: ExportBundle = {
    version: 1,
    manifest: archiveManifest,
    fileData: {},
  };

  for (const file of archiveManifest.files) {
    const content = await fs.readFile(file.absolutePath);
    bundle.fileData[file.relativePath] = content.toString('base64');
  }

  const json = JSON.stringify(bundle);
  const gzip = zlib.createGzip({ level: 6 });
  const output = createWriteStream(outputZipPath);

  await pipeline(
    async function* () {
      yield Buffer.from(json, 'utf-8');
    },
    gzip,
    output
  );
}

/**
 * Import a previously exported case archive into a target directory.
 */
export async function importCase(zipPath: string, outputDir: string): Promise<ForensicCase> {
  // Read and decompress the gzipped bundle
  const compressed = await fs.readFile(zipPath);
  const decompressed = await new Promise<Buffer>((resolve, reject) => {
    zlib.gunzip(compressed, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  const bundle = JSON.parse(decompressed.toString('utf-8')) as ExportBundle;

  if (bundle.version !== 1) {
    throw new Error(`Unsupported export bundle version: ${bundle.version}`);
  }

  const forensicCase = bundle.manifest.case;
  const casePath = path.join(outputDir, forensicCase.name);

  // Recreate directory structure
  await fs.mkdir(casePath, { recursive: true });
  for (const subdir of CASE_SUBDIRS) {
    await fs.mkdir(path.join(casePath, subdir), { recursive: true });
  }

  // Write all files
  for (const [relativePath, base64Content] of Object.entries(bundle.fileData)) {
    const filePath = path.join(casePath, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(base64Content, 'base64'));
  }

  // Update the local path and re-write the manifest
  forensicCase.localPath = casePath;
  forensicCase.updatedAt = isoNow();
  await writeManifest(casePath, forensicCase);

  return forensicCase;
}

/**
 * Get the path to a specific subdirectory within a case folder.
 */
export function getCaseSubdir(
  casePath: string,
  subdir: (typeof CASE_SUBDIRS)[number]
): string {
  return path.join(casePath, subdir);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function writeManifest(casePath: string, forensicCase: ForensicCase): Promise<void> {
  const manifestPath = path.join(casePath, CASE_MANIFEST);
  await fs.writeFile(manifestPath, JSON.stringify(forensicCase, null, 2), 'utf-8');
}

async function collectAllFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  for (const dirent of dirents) {
    const fullPath = path.join(dirPath, dirent.name);
    if (dirent.isDirectory()) {
      const nested = await collectAllFiles(fullPath);
      results.push(...nested);
    } else if (dirent.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

interface ExportBundle {
  version: number;
  manifest: {
    case: ForensicCase;
    files: Array<{ relativePath: string; absolutePath: string }>;
    exportedAt: string;
  };
  fileData: Record<string, string>; // relativePath -> base64 content
}
