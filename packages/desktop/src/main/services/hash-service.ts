import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { HashAlgorithm, HashLogEntry } from '@rmpg/shared';
import { isoNow } from '@rmpg/shared';

/**
 * Compute the hash of a single file using streaming reads.
 *
 * Replaces the C# System.Security.Cryptography and PowerShell Get-FileHash
 * usage from the original application. Streams the file in 64 KB chunks so
 * that multi-gigabyte forensic images do not consume excessive RAM.
 */
export function hashFile(filePath: string, algorithm: HashAlgorithm): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex').toUpperCase());
    });

    stream.on('error', (err) => {
      reject(new Error(`Failed to hash file "${filePath}": ${err.message}`));
    });
  });
}

/**
 * Hash every file in a directory (recursively) and write a hash log file.
 *
 * The output file is a UTF-8 text file with one entry per line in the format:
 *   HASH *relative/path/to/file
 *
 * Returns the array of HashLogEntry objects that were written.
 */
export async function hashDirectory(
  dirPath: string,
  algorithm: HashAlgorithm,
  outputPath: string
): Promise<HashLogEntry[]> {
  const entries: HashLogEntry[] = [];
  const files = await collectFiles(dirPath);

  // Sort for deterministic output
  files.sort();

  // Open the output file for streaming writes
  const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

  // Write header
  writeStream.write(`# Hash Log - Algorithm: ${algorithm.toUpperCase()}\n`);
  writeStream.write(`# Generated: ${isoNow()}\n`);
  writeStream.write(`# Source Directory: ${dirPath}\n`);
  writeStream.write(`# Total Files: ${files.length}\n`);
  writeStream.write('#\n');

  for (const filePath of files) {
    const hash = await hashFile(filePath, algorithm);
    const relativePath = path.relative(dirPath, filePath);

    const entry: HashLogEntry = {
      filePath: relativePath,
      algorithm,
      hash,
      timestamp: isoNow(),
    };
    entries.push(entry);

    // Write in BSD-style checksum format
    writeStream.write(`${hash} *${relativePath}\n`);
  }

  // Finalize the output file
  await new Promise<void>((resolve, reject) => {
    writeStream.end(() => resolve());
    writeStream.on('error', reject);
  });

  return entries;
}

/**
 * Verify a previously generated hash log against the files on disk.
 * Returns an array of entries that failed verification.
 */
export async function verifyHashLog(
  logPath: string,
  baseDirPath: string
): Promise<{ passed: HashLogEntry[]; failed: HashLogEntry[]; missing: string[] }> {
  const content = await fsPromises.readFile(logPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith('#'));

  const passed: HashLogEntry[] = [];
  const failed: HashLogEntry[] = [];
  const missing: string[] = [];

  // Detect algorithm from header
  const headerLine = content.split(/\r?\n/).find((l) => l.startsWith('# Hash Log - Algorithm:'));
  const algorithm: HashAlgorithm = headerLine
    ? (headerLine.replace('# Hash Log - Algorithm:', '').trim().toLowerCase() as HashAlgorithm)
    : 'sha256';

  for (const line of lines) {
    // Format: HASH *relative/path
    const match = line.match(/^([A-Fa-f0-9]+)\s+\*(.+)$/);
    if (!match) continue;

    const expectedHash = match[1].toUpperCase();
    const relativePath = match[2];
    const absolutePath = path.join(baseDirPath, relativePath);

    try {
      await fsPromises.access(absolutePath, fs.constants.R_OK);
    } catch {
      missing.push(relativePath);
      continue;
    }

    const actualHash = await hashFile(absolutePath, algorithm);

    const entry: HashLogEntry = {
      filePath: relativePath,
      algorithm,
      hash: actualHash,
      timestamp: isoNow(),
    };

    if (actualHash === expectedHash) {
      passed.push(entry);
    } else {
      failed.push(entry);
    }
  }

  return { passed, failed, missing };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all file paths under a directory.
 */
async function collectFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const dirents = await fsPromises.readdir(dirPath, { withFileTypes: true });

  for (const dirent of dirents) {
    const fullPath = path.join(dirPath, dirent.name);
    if (dirent.isDirectory()) {
      const nested = await collectFiles(fullPath);
      results.push(...nested);
    } else if (dirent.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}
