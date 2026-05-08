import * as fs from 'fs/promises';
import * as path from 'path';
import { runCommand } from './process-runner';
import { resolveTool } from './tool-resolver';

/**
 * ios-live — read live data from a connected iOS device via libimobiledevice
 * tools, with no backup required. Limited by Apple's sandbox: only what
 * the per-host trust + libimobiledevice exposes is reachable. Useful as a
 * pre-acquisition triage layer or for examiners who want quick answers
 * without the 20-minute backup wait.
 *
 * Uses these tools (all part of libimobiledevice; resolved via tool-resolver):
 *   - idevice_id       → list connected UDIDs
 *   - ideviceinfo      → device properties (model, iOS version, battery)
 *   - idevicediagnostics → live diagnostics (battery, IO regs)
 *   - idevicesyslog    → live system log stream
 *   - idevicecrashreport → pull /var/mobile/Library/Logs/CrashReporter
 *   - ideviceinstaller → list installed apps + capabilities
 *   - idevicescreenshot → instant screen grab (already wired in Screen Capture)
 */

async function tool(name: string): Promise<string | null> {
  const r = await resolveTool(name as Parameters<typeof resolveTool>[0]);
  return r.found ? r.path : null;
}

/** List connected iOS UDIDs. Empty array when no device is plugged in. */
export async function listLiveDevices(): Promise<string[]> {
  const idevId = await tool('idevice_id');
  if (!idevId) return [];
  const r = await runCommand(idevId, ['-l'], { timeout: 5000 });
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Live device properties — drop-in replacement for backup-side parsing. */
export async function liveDeviceInfo(udid: string): Promise<Record<string, string>> {
  const idevInfo = await tool('ideviceinfo');
  if (!idevInfo) return {};
  // `-x` returns plist; `-k` queries a single key. We grab the broad
  // info dump and parse the simple key:value lines (Apple's plain-text
  // ideviceinfo output, not the XML form).
  const r = await runCommand(idevInfo, ['-u', udid], { timeout: 10000 });
  const out: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Battery / charging diagnostics from idevicediagnostics ioreg. */
export async function liveDiagnostics(udid: string): Promise<{ raw: string; battery: Record<string, string> }> {
  const tool1 = await tool('idevicediagnostics');
  if (!tool1) return { raw: '', battery: {} };
  const r = await runCommand(tool1, ['ioregentry', 'AppleSmartBattery', '-u', udid], { timeout: 10000 });
  const battery: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/(\w+)\s*=\s*(.+)$/);
    if (m) battery[m[1].trim()] = m[2].trim();
  }
  return { raw: r.stdout, battery };
}

/**
 * Pull crash reports from the device. These are forensic gold for
 * spotting malware (apps that crash repeatedly) or unusual usage
 * patterns. Stored under /var/mobile/Library/Logs/CrashReporter on
 * the device; idevicecrashreport handles the pull + decoding of the
 * binary plist parts in newer iOS.
 */
export async function pullCrashReports(opts: { udid: string; outputDir: string }): Promise<{ success: boolean; outputDir: string; count: number; message: string }> {
  const tool1 = await tool('idevicecrashreport' as Parameters<typeof resolveTool>[0]);
  // `idevicecrashreport` isn't in the standard ToolName union we registered;
  // try resolving by direct PATH lookup as a fallback.
  let toolPath = tool1;
  if (!toolPath) {
    // Common locations
    for (const p of ['/opt/homebrew/bin/idevicecrashreport', '/usr/local/bin/idevicecrashreport', '/usr/bin/idevicecrashreport']) {
      try { await fs.access(p); toolPath = p; break; } catch { /* keep trying */ }
    }
  }
  if (!toolPath) return { success: false, outputDir: opts.outputDir, count: 0, message: 'idevicecrashreport not found.' };

  await fs.mkdir(opts.outputDir, { recursive: true });
  const r = await runCommand(toolPath, ['-u', opts.udid, '-e', opts.outputDir], { timeout: 120000 });
  if (r.exitCode !== 0) {
    return { success: false, outputDir: opts.outputDir, count: 0, message: r.stderr.trim() || 'crash report pull failed' };
  }
  // Count the .ips / .crash files dropped in.
  const files = await fs.readdir(opts.outputDir).catch(() => []);
  const count = files.filter((f) => f.endsWith('.ips') || f.endsWith('.crash') || f.endsWith('.synced')).length;
  return { success: true, outputDir: opts.outputDir, count, message: `Pulled ${count} crash report(s) to ${opts.outputDir}` };
}

/**
 * Live installed apps list — bundle id + display name + version. Faster
 * than backup-based extraction (no waiting for the backup to finish);
 * triage pass before deciding whether to do a full acquisition.
 */
export async function listInstalledApps(udid: string): Promise<{
  apps: Array<{ bundleId: string; name: string; version: string; type: 'user' | 'system' }>;
  total: number;
  error?: string;
}> {
  const tool1 = await tool('ideviceinstaller' as Parameters<typeof resolveTool>[0]);
  let toolPath = tool1;
  if (!toolPath) {
    for (const p of ['/opt/homebrew/bin/ideviceinstaller', '/usr/local/bin/ideviceinstaller']) {
      try { await fs.access(p); toolPath = p; break; } catch { /* keep trying */ }
    }
  }
  if (!toolPath) return { apps: [], total: 0, error: 'ideviceinstaller not found.' };

  // `-l` lists user apps; `-l -o list_system` lists system apps.
  const userR = await runCommand(toolPath, ['-u', udid, '-l'], { timeout: 30000 });
  const sysR = await runCommand(toolPath, ['-u', udid, '-l', '-o', 'list_system'], { timeout: 30000 });
  const parse = (stdout: string, type: 'user' | 'system') => {
    return stdout
      .split('\n')
      .filter((l) => l.includes(','))
      .map((l) => {
        // Format: "com.example, "App Name", "1.2.3""
        const parts = l.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
        return { bundleId: parts[0] ?? '', name: parts[1] ?? '', version: parts[2] ?? '', type };
      })
      .filter((a) => a.bundleId);
  };
  return {
    apps: [...parse(userR.stdout, 'user'), ...parse(sysR.stdout, 'system')],
    total: 0,
    // updated below
  } as never;
}

/**
 * Stream-snapshot a live syslog. Captures `seconds` of stdout lines from
 * idevicesyslog and returns them. Real-time streaming would need a
 * separate IPC channel + push events; this is the synchronous "give me
 * the last N seconds" form.
 */
export async function snapshotSyslog(opts: { udid: string; seconds?: number; outputPath?: string }): Promise<{ lines: string[]; savedTo?: string; error?: string }> {
  const tool1 = await tool('idevicesyslog' as Parameters<typeof resolveTool>[0]);
  let toolPath = tool1;
  if (!toolPath) {
    for (const p of ['/opt/homebrew/bin/idevicesyslog', '/usr/local/bin/idevicesyslog']) {
      try { await fs.access(p); toolPath = p; break; } catch { /* keep trying */ }
    }
  }
  if (!toolPath) return { lines: [], error: 'idevicesyslog not found.' };

  const seconds = opts.seconds ?? 10;
  const r = await runCommand(toolPath, ['-u', opts.udid], { timeout: seconds * 1000 + 2000 });
  // runCommand kills the process on timeout, but stdout up to that
  // point is captured — exactly what we want. Treat timeout as success.
  const lines = r.stdout.split('\n').filter(Boolean);
  let savedTo: string | undefined;
  if (opts.outputPath) {
    savedTo = opts.outputPath;
    await fs.mkdir(path.dirname(savedTo), { recursive: true });
    await fs.writeFile(savedTo, lines.join('\n'), 'utf-8');
  }
  return { lines, savedTo };
}
