import { spawn, ChildProcess } from 'child_process';
import type { ProcessResult, ProcessProgress, ProcessOptions } from '@rmpg/shared';
import { isWindows } from './platform-service';

/**
 * Run a command and return the collected stdout/stderr/exitCode.
 *
 * Replaces all C# Process.Start() calls with a unified cross-platform wrapper
 * around child_process.spawn.
 */
export function runCommand(
  binary: string,
  args: string[],
  options?: ProcessOptions & { signal?: AbortSignal }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const spawnOpts: Record<string, unknown> = {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      // On Windows, use shell mode when the binary is not an absolute path
      // so that .cmd/.bat wrappers (e.g. adb.cmd) are resolved correctly.
      shell: options?.shell ?? (isWindows() && !binary.includes('\\') && !binary.includes('/')),
      windowsHide: true,
    };

    let child: ChildProcess;
    try {
      child = spawn(binary, args, spawnOpts);
    } catch (err) {
      reject(new Error(`Failed to spawn "${binary}": ${(err as Error).message}`));
      return;
    }

    // Abort signal support
    if (options?.signal) {
      if (options.signal.aborted) {
        child.kill('SIGTERM');
        reject(new Error('Process was aborted before it started'));
        return;
      }
      options.signal.addEventListener('abort', () => {
        child.kill('SIGTERM');
        // Give a grace period, then SIGKILL
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 3000);
      });
    }

    // Timeout handling
    if (options?.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 3000);
      }, options.timeout);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Process error for "${binary}": ${err.message}`));
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code,
        timedOut,
      });
    });
  });
}

/**
 * Run a command and stream stdout/stderr progress events in real time.
 *
 * Useful for long-running operations (ADB backup, hashing, etc.)
 * where the renderer needs to display live output.
 */
export function runCommandWithProgress(
  binary: string,
  args: string[],
  options: ProcessOptions & { signal?: AbortSignal },
  onProgress: (p: ProcessProgress) => void
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const spawnOpts: Record<string, unknown> = {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: options.shell ?? (isWindows() && !binary.includes('\\') && !binary.includes('/')),
      windowsHide: true,
    };

    let child: ChildProcess;
    try {
      child = spawn(binary, args, spawnOpts);
    } catch (err) {
      reject(new Error(`Failed to spawn "${binary}": ${(err as Error).message}`));
      return;
    }

    onProgress({ type: 'status', data: `Started: ${binary} ${args.join(' ')}`, timestamp: Date.now() });

    // Abort signal support
    if (options.signal) {
      if (options.signal.aborted) {
        child.kill('SIGTERM');
        reject(new Error('Process was aborted before it started'));
        return;
      }
      options.signal.addEventListener('abort', () => {
        child.kill('SIGTERM');
        onProgress({ type: 'status', data: 'Process aborted by user', timestamp: Date.now() });
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 3000);
      });
    }

    // Timeout handling
    if (options.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        onProgress({ type: 'status', data: `Process timed out after ${options.timeout}ms`, timestamp: Date.now() });
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 3000);
      }, options.timeout);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      const text = chunk.toString('utf-8');
      // Emit each line as a separate progress event
      const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
      for (const line of lines) {
        onProgress({ type: 'stdout', data: line, timestamp: Date.now() });
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      const text = chunk.toString('utf-8');
      const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
      for (const line of lines) {
        onProgress({ type: 'stderr', data: line, timestamp: Date.now() });
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      onProgress({ type: 'status', data: `Error: ${err.message}`, timestamp: Date.now() });
      reject(new Error(`Process error for "${binary}": ${err.message}`));
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      onProgress({
        type: 'status',
        data: `Process exited with code ${code}${timedOut ? ' (timed out)' : ''}`,
        timestamp: Date.now(),
      });
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code,
        timedOut,
      });
    });
  });
}

/**
 * Convenience: run a command and throw if it exits with non-zero.
 */
export async function runCommandStrict(
  binary: string,
  args: string[],
  options?: ProcessOptions & { signal?: AbortSignal }
): Promise<ProcessResult> {
  const result = await runCommand(binary, args, options);
  if (result.exitCode !== 0) {
    const msg = result.stderr.trim() || result.stdout.trim() || `Exit code ${result.exitCode}`;
    throw new Error(`Command "${binary} ${args.join(' ')}" failed: ${msg}`);
  }
  return result;
}
