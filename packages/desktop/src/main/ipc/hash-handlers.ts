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
  // HASH_COMPUTE_FILE - Compute the hash of a single file
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.HASH_COMPUTE_FILE,
    async (_event, filePath: string, algorithm: HashAlgorithm) => {
      const hash = await hashService.hashFile(filePath, algorithm);
      return { filePath, algorithm, hash };
    }
  );

  // ---------------------------------------------------------------------------
  // HASH_COMPUTE_DIRECTORY - Hash all files in a directory and write a log
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.HASH_COMPUTE_DIRECTORY,
    async (
      _event,
      dirPath: string,
      algorithm: HashAlgorithm,
      outputPath: string
    ) => {
      const entries = await hashService.hashDirectory(dirPath, algorithm, outputPath);
      return {
        entries,
        totalFiles: entries.length,
        outputPath,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // HASH_VERIFY - Verify a hash log against files on disk
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.HASH_VERIFY,
    async (_event, logPath: string, baseDirPath: string) => {
      return hashService.verifyHashLog(logPath, baseDirPath);
    }
  );
}
