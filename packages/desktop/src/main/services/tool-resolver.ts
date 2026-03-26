import * as path from 'path';
import * as fs from 'fs/promises';
import type { ToolName, ToolInfo } from '@rmpg/shared';
import { runCommand } from './process-runner';
import { getPlatform, isWindows, getToolsDir, getAppDataPath } from './platform-service';

/** File name where user-configured tool paths are persisted. */
const SETTINGS_FILE = 'tool-paths.json';

/**
 * Map of tool names to their expected binary names per platform.
 * On Windows, .exe is appended automatically where appropriate.
 */
const TOOL_BINARIES: Record<ToolName, { win32: string; posix: string }> = {
  adb:              { win32: 'adb.exe',              posix: 'adb' },
  tesseract:        { win32: 'tesseract.exe',        posix: 'tesseract' },
  python:           { win32: 'python.exe',           posix: 'python3' },
  java:             { win32: 'java.exe',             posix: 'java' },
  idevicebackup2:   { win32: 'idevicebackup2.exe',   posix: 'idevicebackup2' },
  idevicename:      { win32: 'idevicename.exe',      posix: 'idevicename' },
  idevice_id:       { win32: 'idevice_id.exe',       posix: 'idevice_id' },
  ideviceinfo:      { win32: 'ideviceinfo.exe',      posix: 'ideviceinfo' },
  ideviceinstaller: { win32: 'ideviceinstaller.exe', posix: 'ideviceinstaller' },
  scrcpy:           { win32: 'scrcpy.exe',           posix: 'scrcpy' },
  instaloader:      { win32: 'instaloader.exe',      posix: 'instaloader' },
  odin:             { win32: 'Odin3.exe',            posix: 'odin' },
};

/**
 * Version flags used to detect tool version.
 * Some tools use --version, some use -v, some use -version.
 */
const VERSION_FLAGS: Partial<Record<ToolName, string[]>> = {
  adb:        ['version'],
  tesseract:  ['--version'],
  python:     ['--version'],
  java:       ['-version'],
  scrcpy:     ['--version'],
  instaloader: ['--version'],
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.X_OK);
    return true;
  } catch {
    // Fallback: on Windows, .exe files may not have execute bit
    if (isWindows()) {
      try {
        await fs.access(p, fs.constants.F_OK);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function loadUserPaths(): Promise<Record<string, string>> {
  const settingsPath = path.join(getAppDataPath(), SETTINGS_FILE);
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Save user-configured tool paths to the settings JSON file.
 */
export async function saveUserToolPath(toolName: ToolName, toolPath: string): Promise<void> {
  const settingsPath = path.join(getAppDataPath(), SETTINGS_FILE);
  const current = await loadUserPaths();
  current[toolName] = toolPath;
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(current, null, 2), 'utf-8');
}

function getBinaryName(toolName: ToolName): string {
  return isWindows() ? TOOL_BINARIES[toolName].win32 : TOOL_BINARIES[toolName].posix;
}

/**
 * Attempt to find the tool on the system PATH using `which` (posix) or `where` (windows).
 */
async function findOnPath(binaryName: string): Promise<string | null> {
  const cmd = isWindows() ? 'where' : 'which';
  try {
    const result = await runCommand(cmd, [binaryName], { timeout: 5000 });
    if (result.exitCode === 0) {
      const firstLine = result.stdout.trim().split(/\r?\n/)[0];
      if (firstLine && (await fileExists(firstLine))) {
        return firstLine;
      }
    }
  } catch {
    // Tool not found on PATH
  }
  return null;
}

/**
 * Attempt to extract the version string from a tool.
 */
async function getToolVersion(toolPath: string, toolName: ToolName): Promise<string | undefined> {
  const flags = VERSION_FLAGS[toolName];
  if (!flags) return undefined;
  try {
    const result = await runCommand(toolPath, flags, { timeout: 10000 });
    const output = (result.stdout + result.stderr).trim();
    // Extract the first line which usually contains the version
    const firstLine = output.split(/\r?\n/)[0];
    return firstLine || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a single tool's location.
 *
 * Resolution order:
 * 1. User-configured paths (from tool-paths.json in the app data directory)
 * 2. Bundled tools shipped inside the app resources directory
 * 3. System PATH (via `which` on posix or `where` on Windows)
 *
 * Returns a ToolInfo even when the tool is not found (found: false).
 */
export async function resolveTool(name: ToolName): Promise<ToolInfo> {
  const platform = getPlatform();
  const binaryName = getBinaryName(name);

  const notFound: ToolInfo = {
    name,
    path: '',
    found: false,
    platform,
  };

  // 1. Check user-configured path
  const userPaths = await loadUserPaths();
  if (userPaths[name]) {
    const userPath = userPaths[name];
    if (await fileExists(userPath)) {
      const version = await getToolVersion(userPath, name);
      return { name, path: userPath, found: true, version, platform };
    }
  }

  // 2. Check bundled tools in app resources
  const bundledPath = path.join(getToolsDir(), binaryName);
  if (await fileExists(bundledPath)) {
    const version = await getToolVersion(bundledPath, name);
    return { name, path: bundledPath, found: true, version, platform };
  }

  // Also check tool-specific subdirectory (e.g. tools/adb/adb.exe)
  const bundledSubdirPath = path.join(getToolsDir(), name, binaryName);
  if (await fileExists(bundledSubdirPath)) {
    const version = await getToolVersion(bundledSubdirPath, name);
    return { name, path: bundledSubdirPath, found: true, version, platform };
  }

  // 3. Check system PATH
  const systemPath = await findOnPath(binaryName);
  if (systemPath) {
    const version = await getToolVersion(systemPath, name);
    return { name, path: systemPath, found: true, version, platform };
  }

  // On Windows, also try without .exe extension in case it's a .cmd or .bat
  if (isWindows()) {
    const nameWithoutExt = binaryName.replace(/\.exe$/, '');
    const altPath = await findOnPath(nameWithoutExt);
    if (altPath) {
      const version = await getToolVersion(altPath, name);
      return { name, path: altPath, found: true, version, platform };
    }
  }

  return notFound;
}

/**
 * Resolve all known tools at once. Returns a map keyed by ToolName.
 */
export async function resolveAllTools(): Promise<Record<ToolName, ToolInfo>> {
  const toolNames: ToolName[] = Object.keys(TOOL_BINARIES) as ToolName[];
  const results = await Promise.all(toolNames.map((n) => resolveTool(n)));
  const record = {} as Record<ToolName, ToolInfo>;
  for (let i = 0; i < toolNames.length; i++) {
    record[toolNames[i]] = results[i];
  }
  return record;
}
