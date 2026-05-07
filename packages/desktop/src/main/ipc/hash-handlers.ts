import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { HashAlgorithm } from '@rmpg/shared';
import * as hashService from '../services/hash-service';

/**
 * Register hash computation IPC handlers.
 *
 * Maps to the original Hash.cs functionality. Computes cryptographic
 * hashes for individual files and entire directories, and verifies
 * previously generated hash logs.
 */
export function registerHashHandlers(): void {
  // ---------------------------------------------------------------------------
  // HASH_COMPUTE_FILE - Compute one or more hashes of a single file.
  //
  // The HashGenerator page sends `{ filePath, algorithms: HashAlgorithm[] }`
  // and expects `Record<algorithm, hash>` back so the UI can render each
  // checked algorithm's digest. The legacy positional call shape is kept
  // for any older caller still in the tree.
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.HASH_COMPUTE_FILE,
    async (_event, ...args: unknown[]) => {
      const { filePath, algorithms } = normaliseFileArgs(args);
      const out: Record<string, string> = {};
      for (const alg of algorithms) {
        out[alg] = await hashService.hashFile(filePath, alg);
      }
      return out;
    }
  );

  // ---------------------------------------------------------------------------
  // HASH_COMPUTE_DIRECTORY - Hash every file in a directory.
  //
  // Renderer sends `{ directoryPath, algorithms[] }` and expects
  // `Record<filePath, Record<algorithm, hash>>` so it can table out each
  // file's digests. We walk the directory ourselves (no on-disk log) so
  // the renderer can render results without round-tripping through a file.
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.HASH_COMPUTE_DIRECTORY,
    async (_event, ...args: unknown[]) => {
      const { directoryPath, algorithms, outputPath } = normaliseDirArgs(args);
      const files = await collectFiles(directoryPath);
      const out: Record<string, Record<string, string>> = {};
      for (const file of files) {
        const perAlg: Record<string, string> = {};
        for (const alg of algorithms) {
          perAlg[alg] = await hashService.hashFile(file, alg);
        }
        out[file] = perAlg;
      }
      // If a log path was supplied, also write the legacy hash log so callers
      // that wanted it still get one.
      if (outputPath && algorithms[0]) {
        await hashService.hashDirectory(directoryPath, algorithms[0], outputPath);
      }
      return out;
    }
  );

  // ---------------------------------------------------------------------------
  // HASH_VERIFY - Verify either a hash log file OR a single expected hash.
  //
  // Renderer sends `{ filePath, expectedHash }` for the simple "does this
  // file match this hash?" workflow and reads `result.match`. Old callers
  // pass `(logPath, baseDirPath)` to verify a whole log; both shapes are
  // honoured here.
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.HASH_VERIFY,
    async (_event, ...args: unknown[]) => {
      // Single-file verify: { filePath, expectedHash, algorithm? }
      if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const opts = args[0] as { filePath: string; expectedHash: string; algorithm?: HashAlgorithm };
        const alg = opts.algorithm ?? guessAlgorithmFromHash(opts.expectedHash);
        const actual = await hashService.hashFile(opts.filePath, alg);
        return {
          match: actual.toLowerCase() === opts.expectedHash.trim().toLowerCase(),
          actual,
          algorithm: alg,
        };
      }
      // Legacy hash-log verify: (logPath, baseDirPath)
      const [logPath, baseDirPath] = args as [string, string];
      return hashService.verifyHashLog(logPath, baseDirPath);
    }
  );
}

// ---------------------------------------------------------------------------
// Argument normalisation helpers — accept both the renderer's object form
// and the legacy positional form so callers in either style keep working.
// ---------------------------------------------------------------------------

function normaliseFileArgs(args: unknown[]): { filePath: string; algorithms: HashAlgorithm[] } {
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    const o = args[0] as { filePath: string; algorithm?: HashAlgorithm; algorithms?: HashAlgorithm[] };
    return {
      filePath: o.filePath,
      algorithms: o.algorithms ?? (o.algorithm ? [o.algorithm] : ['sha256']),
    };
  }
  const [filePath, algorithm] = args as [string, HashAlgorithm];
  return { filePath, algorithms: [algorithm ?? 'sha256'] };
}

function normaliseDirArgs(args: unknown[]): { directoryPath: string; algorithms: HashAlgorithm[]; outputPath?: string } {
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    const o = args[0] as {
      directoryPath?: string;
      dirPath?: string;
      algorithm?: HashAlgorithm;
      algorithms?: HashAlgorithm[];
      outputPath?: string;
    };
    return {
      directoryPath: (o.directoryPath ?? o.dirPath) as string,
      algorithms: o.algorithms ?? (o.algorithm ? [o.algorithm] : ['sha256']),
      outputPath: o.outputPath,
    };
  }
  const [dirPath, algorithm, outputPath] = args as [string, HashAlgorithm, string];
  return { directoryPath: dirPath, algorithms: [algorithm ?? 'sha256'], outputPath };
}

/**
 * Best-effort algorithm sniff from hex length so the renderer can verify
 * a known hash without explicitly picking the algorithm. Lengths are the
 * standard hex-digest sizes for each algorithm.
 */
function guessAlgorithmFromHash(hash: string): HashAlgorithm {
  const len = hash.trim().length;
  if (len === 32) return 'md5';
  if (len === 40) return 'sha1';
  if (len === 64) return 'sha256';
  if (len === 96) return 'sha384';
  if (len === 128) return 'sha512';
  return 'sha256';
}

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as import('fs').Dirent[];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collectFiles(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}
