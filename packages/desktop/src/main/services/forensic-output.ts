import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';

/**
 * forensic-output — helpers for producing examiner-friendly, structured
 * artefacts instead of raw command output. Three jobs:
 *
 *   1. Parsers that turn the most common Android / iOS dump formats
 *      (`getprop`, `settings list`, `dumpsys X`, plists) into JSON
 *      trees so the analyst sees keys/values rather than a wall of text.
 *   2. Platform-aware folder layout: every acquisition lands under
 *      `<root>/<platform>/<deviceId>/<artefact>` with a sibling
 *      `MANIFEST.json` describing the acquisition's provenance — case,
 *      examiner, timestamp, tool versions, file index, hashes.
 *   3. Pretty file headers — every emitted text/JSON file gets a one-line
 *      banner at the top so a file dropped on a desk has its origin
 *      stamped in (case + device + extracted-at) without opening the
 *      manifest separately.
 */

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse `adb shell getprop` output. Each line is `[key]: [value]`.
 */
export function parseGetProp(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\[([^\]]+)\]:\s*\[([^\]]*)\]$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Parse `adb shell settings list <namespace>` output. Each line is
 * `key=value`; values can contain `=` so we split on the first one only.
 */
export function parseSettingsList(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

/**
 * Parse `pm list packages` output. Each line is `package:com.example`
 * optionally followed by `  installer=com.android.vending`.
 */
export function parsePmList(stdout: string): Array<{ packageName: string; installer?: string }> {
  const out: Array<{ packageName: string; installer?: string }> = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^package:(\S+?)(?:\s+installer=(\S+))?$/);
    if (m) out.push({ packageName: m[1], installer: m[2] });
  }
  return out;
}

/**
 * Best-effort PID list from `ps -A`.
 */
export function parsePsList(stdout: string): Array<{ user: string; pid: number; ppid: number; name: string }> {
  const lines = stdout.split('\n').slice(1); // skip header
  const out: Array<{ user: string; pid: number; ppid: number; name: string }> = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const pid = Number(parts[1]);
    const ppid = Number(parts[2]);
    if (!Number.isFinite(pid)) continue;
    const name = parts[parts.length - 1];
    out.push({ user: parts[0], pid, ppid, name });
  }
  return out;
}

/**
 * Parse `df -h` lines into `{filesystem, size, used, avail, usePct, mount}` rows.
 */
export function parseDfList(stdout: string): Array<{ filesystem: string; size: string; used: string; available: string; usePercent: string; mountPoint: string }> {
  const lines = stdout.split('\n').slice(1);
  const out: Array<{ filesystem: string; size: string; used: string; available: string; usePercent: string; mountPoint: string }> = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    out.push({
      filesystem: parts[0],
      size: parts[1],
      used: parts[2],
      available: parts[3],
      usePercent: parts[4],
      mountPoint: parts.slice(5).join(' '),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Acquisition manifest + folder layout
// ---------------------------------------------------------------------------

export interface DeviceFingerprint {
  platform: 'android' | 'ios' | 'unknown';
  /** Stable identifier for this device — Android serial or iOS UDID. */
  id: string;
  label?: string;
  manufacturer?: string;
  model?: string;
  osVersion?: string;
}

export interface AcquisitionManifest {
  id: string;
  startedAt: string;
  completedAt?: string;
  examiner: string;
  caseNumber?: string;
  caseName?: string;
  device: DeviceFingerprint;
  toolVersions?: Record<string, string>;
  artefacts: Array<{
    name: string;
    relativePath: string;
    bytes?: number;
    sha256?: string;
    extractedAt: string;
    notes?: string;
  }>;
}

/**
 * Build a per-acquisition output folder following the platform-aware
 * convention: `<root>/<platform>/<deviceId>`. Sanitises the id even
 * though Android serials / iOS UDIDs are normally clean — defensive in
 * case the caller passes a free-form label.
 */
export function acquisitionDir(rootOutput: string, device: DeviceFingerprint): string {
  const safeId = (device.id || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(rootOutput, device.platform, safeId);
}

export async function startAcquisition(opts: {
  rootOutput: string;
  device: DeviceFingerprint;
  examiner: string;
  caseNumber?: string;
  caseName?: string;
  toolVersions?: Record<string, string>;
}): Promise<{ dir: string; manifestPath: string; manifest: AcquisitionManifest }> {
  const dir = acquisitionDir(opts.rootOutput, opts.device);
  await fs.mkdir(dir, { recursive: true });
  const manifest: AcquisitionManifest = {
    id: randomBytes(16).toString('hex'),
    startedAt: new Date().toISOString(),
    examiner: opts.examiner,
    caseNumber: opts.caseNumber,
    caseName: opts.caseName,
    device: opts.device,
    toolVersions: opts.toolVersions,
    artefacts: [],
  };
  const manifestPath = path.join(dir, 'MANIFEST.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return { dir, manifestPath, manifest };
}

export async function appendArtefact(
  manifestPath: string,
  artefact: AcquisitionManifest['artefacts'][number] & { complete?: boolean },
): Promise<void> {
  let m: AcquisitionManifest;
  try {
    m = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as AcquisitionManifest;
  } catch {
    m = {
      id: randomBytes(16).toString('hex'),
      startedAt: new Date().toISOString(),
      examiner: 'unknown',
      device: { platform: 'unknown', id: 'unknown' },
      artefacts: [],
    };
  }
  m.artefacts.push({
    name: artefact.name,
    relativePath: artefact.relativePath,
    bytes: artefact.bytes,
    sha256: artefact.sha256,
    extractedAt: artefact.extractedAt,
    notes: artefact.notes,
  });
  if (artefact.complete) m.completedAt = new Date().toISOString();
  await fs.writeFile(manifestPath, JSON.stringify(m, null, 2), 'utf-8');
}

/**
 * One-line origin banner for plain-text artefacts. JSON artefacts should
 * embed equivalent metadata inside the JSON object instead.
 */
export function bannerForText(opts: {
  artefactName: string;
  device: DeviceFingerprint;
  caseNumber?: string;
  examiner?: string;
}): string {
  const lines = [
    `# RMPG Forensics — ${opts.artefactName}`,
    `# Platform : ${opts.device.platform}`,
    `# Device   : ${opts.device.id}${opts.device.label ? ` (${opts.device.label})` : ''}`,
    `# Extracted: ${new Date().toISOString()}`,
  ];
  if (opts.caseNumber) lines.push(`# Case     : ${opts.caseNumber}`);
  if (opts.examiner) lines.push(`# Examiner : ${opts.examiner}`);
  lines.push('# ---');
  return lines.join('\n') + '\n';
}

/**
 * Auto-pick the right parser for a Misc-Collections-style item id and
 * return the structured form. Falls back to `null` when no parser
 * matches — caller should write the raw text in that case.
 */
export function parseByItemId(itemId: string, stdout: string): unknown | null {
  switch (itemId) {
    case 'system_properties':  return parseGetProp(stdout);
    case 'global_settings':
    case 'security_settings':
    case 'system_settings':    return parseSettingsList(stdout);
    case 'installed_apps_3rd':
    case 'installed_apps_native': return parsePmList(stdout);
    case 'active_processes':   return parsePsList(stdout);
    case 'disk_info':          return parseDfList(stdout);
    default: return null;
  }
}
