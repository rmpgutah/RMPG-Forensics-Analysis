export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface ProcessProgress {
  type: 'stdout' | 'stderr' | 'status';
  data: string;
  timestamp: number;
}

export interface ProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  shell?: boolean;
}

export interface ToolInfo {
  name: string;
  path: string;
  found: boolean;
  version?: string;
  platform: 'win32' | 'darwin' | 'linux';
}

export type ToolName =
  | 'adb'
  | 'tesseract'
  | 'python'
  | 'java'
  | 'idevicebackup2'
  | 'idevicename'
  | 'idevice_id'
  | 'ideviceinfo'
  | 'ideviceinstaller'
  | 'scrcpy'
  | 'instaloader'
  | 'odin';
