import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import { runCommand } from '../services/process-runner';
import { resolveTool } from '../services/tool-resolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}

function sendEvent(channel: string, data: unknown): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

function progress(channel: string, percent: number, message: string): void {
  sendEvent(channel, { percent, message });
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Open-Source Tool Definitions
// ---------------------------------------------------------------------------

/**
 * Registry of open-source Python security/OSINT/hacking tools that can be
 * installed via pip and executed from the CLI.
 */
const PYTHON_TOOLS = {
  sherlock: {
    name: 'Sherlock',
    description: 'Hunt usernames across 400+ social networks',
    pipPackage: 'sherlock-project',
    command: 'sherlock',
    category: 'osint',
  },
  theharvester: {
    name: 'theHarvester',
    description: 'Gather emails, subdomains, hosts, names, open ports from public sources',
    pipPackage: 'theHarvester',
    command: 'theHarvester',
    category: 'recon',
  },
  holehe: {
    name: 'Holehe',
    description: 'Check if an email is used on 120+ websites (registration leaks)',
    pipPackage: 'holehe',
    command: 'holehe',
    category: 'osint',
  },
  photon: {
    name: 'Photon',
    description: 'Fast web crawler that extracts URLs, emails, social media, files, secrets',
    pipPackage: 'photon',
    command: 'photon',
    category: 'recon',
  },
  sublist3r: {
    name: 'Sublist3r',
    description: 'Enumerate subdomains using OSINT search engines',
    pipPackage: 'sublist3r',
    command: 'sublist3r',
    category: 'recon',
  },
  socialscan: {
    name: 'Social Scan',
    description: 'Check email/username availability across multiple platforms accurately',
    pipPackage: 'socialscan',
    command: 'socialscan',
    category: 'osint',
  },
  'hash-identifier': {
    name: 'Hash Identifier',
    description: 'Identify hash types (MD5, SHA, bcrypt, etc.)',
    pipPackage: 'hashid',
    command: 'hashid',
    category: 'crypto',
  },
  dirsearch: {
    name: 'Dirsearch',
    description: 'Web path/directory brute-forcer with recursive scanning',
    pipPackage: 'dirsearch',
    command: 'dirsearch',
    category: 'web',
  },
  wafw00f: {
    name: 'WAFw00f',
    description: 'Identify and fingerprint Web Application Firewalls (WAF)',
    pipPackage: 'wafw00f',
    command: 'wafw00f',
    category: 'web',
  },
  'xss-strike': {
    name: 'XSStrike',
    description: 'Advanced XSS detection and exploitation suite',
    pipPackage: 'xsstrike',
    command: 'xsstrike',
    category: 'web',
  },
  'cloud-enum': {
    name: 'Cloud Enum',
    description: 'Enumerate public cloud resources (AWS/Azure/GCP)',
    pipPackage: 'cloud_enum',
    command: 'cloud_enum',
    category: 'recon',
  },
  maigret: {
    name: 'Maigret',
    description: 'Collect user account information from 2500+ sites (Sherlock fork, more powerful)',
    pipPackage: 'maigret',
    command: 'maigret',
    category: 'osint',
  },
  fierce: {
    name: 'Fierce',
    description: 'DNS reconnaissance tool for locating non-contiguous IP space',
    pipPackage: 'fierce',
    command: 'fierce',
    category: 'recon',
  },
  'dorks-eye': {
    name: 'DorksEye',
    description: 'Google Dorks automation for finding sensitive data',
    pipPackage: 'dorkseye',
    command: 'dorkseye',
    category: 'osint',
  },
} as const;

type ToolId = keyof typeof PYTHON_TOOLS;

// ---------------------------------------------------------------------------
// Handler: Install Tool
// ---------------------------------------------------------------------------

function registerToolkitInstallHandler(): void {
  ipcMain.handle(
    IPC_CHANNELS.TOOLKIT_INSTALL,
    async (_event, options: { toolId: string }) => {
      const { toolId } = options;
      const toolDef = PYTHON_TOOLS[toolId as ToolId];
      if (!toolDef) {
        return { success: false, error: `Unknown tool: ${toolId}` };
      }

      const python = await resolveTool('python');
      if (!python.found) {
        return { success: false, error: 'Python not found. Install Python 3.8+ first.' };
      }

      const progressCh = IPC_CHANNELS.TOOLKIT_PROGRESS;
      progress(progressCh, 10, `Installing ${toolDef.name} (${toolDef.pipPackage})...`);

      try {
        const result = await runCommand(python.path, [
          '-m', 'pip', 'install', '--upgrade', toolDef.pipPackage,
        ], { timeout: 120000 });

        if (result.exitCode !== 0) {
          const errMsg = result.stderr.trim() || result.stdout.trim();
          progress(progressCh, 0, `Install failed: ${errMsg}`);
          return { success: false, error: errMsg };
        }

        progress(progressCh, 100, `${toolDef.name} installed successfully`);
        return { success: true, tool: toolDef.name };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Handler: Check Tool Status
// ---------------------------------------------------------------------------

function registerToolkitStatusHandler(): void {
  ipcMain.handle(IPC_CHANNELS.TOOLKIT_STATUS, async () => {
    const python = await resolveTool('python');
    if (!python.found) {
      return { success: false, error: 'Python not found', tools: {} };
    }

    const statuses: Record<string, { installed: boolean; version?: string }> = {};

    for (const [id, toolDef] of Object.entries(PYTHON_TOOLS)) {
      try {
        const result = await runCommand(python.path, [
          '-m', 'pip', 'show', toolDef.pipPackage,
        ], { timeout: 10000 });
        if (result.exitCode === 0) {
          const versionMatch = result.stdout.match(/Version:\s*(.+)/i);
          statuses[id] = { installed: true, version: versionMatch?.[1]?.trim() };
        } else {
          statuses[id] = { installed: false };
        }
      } catch {
        statuses[id] = { installed: false };
      }
    }

    return { success: true, tools: statuses, pythonVersion: python.version };
  });
}

// ---------------------------------------------------------------------------
// Handler: Run Tool
// ---------------------------------------------------------------------------

function registerToolkitRunHandler(): void {
  ipcMain.handle(
    IPC_CHANNELS.TOOLKIT_RUN,
    async (_event, options: {
      toolId: string;
      outputPath: string;
      target: string;
      extraArgs?: string[];
    }) => {
      const { toolId, outputPath, target, extraArgs = [] } = options;
      const toolDef = PYTHON_TOOLS[toolId as ToolId];
      if (!toolDef) {
        return { success: false, error: `Unknown tool: ${toolId}` };
      }

      const python = await resolveTool('python');
      if (!python.found) {
        return { success: false, error: 'Python not found' };
      }

      const progressCh = IPC_CHANNELS.TOOLKIT_PROGRESS;
      await ensureDir(outputPath);
      progress(progressCh, 5, `Running ${toolDef.name} against: ${target}`);

      try {
        let result;
        const resultDir = path.join(outputPath, `${toolId}_${Date.now()}`);
        await ensureDir(resultDir);

        switch (toolId) {
          // ---------------------------------------------------------------
          // OSINT: Username & Email Hunting
          // ---------------------------------------------------------------
          case 'sherlock': {
            progress(progressCh, 10, 'Running Sherlock username hunt across 400+ sites...');
            result = await runCommand(python.path, [
              '-m', 'sherlock_project', target,
              '--output', path.join(resultDir, 'sherlock_results.txt'),
              '--csv',
              '--print-found',
              ...extraArgs,
            ], { timeout: 300000 });
            // Also save JSON summary
            await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);
            break;
          }

          case 'maigret': {
            progress(progressCh, 10, 'Running Maigret deep username search (2500+ sites)...');
            result = await runCommand(python.path, [
              '-m', 'maigret', target,
              '--folderoutput', resultDir,
              '--json', 'ndjson',
              '--pdf',
              ...extraArgs,
            ], { timeout: 600000 });
            await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);
            break;
          }

          case 'holehe': {
            progress(progressCh, 10, 'Checking email registration across 120+ sites...');
            result = await runCommand(python.path, [
              '-m', 'holehe', target,
              '--only-used',
              ...extraArgs,
            ], { timeout: 120000 });
            await fs.writeFile(path.join(resultDir, 'holehe_results.txt'), result.stdout);
            // Parse output to JSON
            const lines = result.stdout.split('\n').filter(Boolean);
            const found: Array<{ site: string; exists: boolean }> = [];
            for (const line of lines) {
              if (line.includes('[+]')) {
                found.push({ site: line.replace(/\[\+\]\s*/, '').trim(), exists: true });
              } else if (line.includes('[-]')) {
                found.push({ site: line.replace(/\[-\]\s*/, '').trim(), exists: false });
              }
            }
            await writeJson(path.join(resultDir, 'holehe_parsed.json'), {
              email: target,
              total_checked: found.length,
              registered: found.filter((f) => f.exists),
            });
            break;
          }

          case 'socialscan': {
            progress(progressCh, 10, 'Scanning email/username availability...');
            result = await runCommand(python.path, [
              '-m', 'socialscan', '--email', target,
              ...extraArgs,
            ], { timeout: 60000 });
            await fs.writeFile(path.join(resultDir, 'socialscan_results.txt'), result.stdout);
            break;
          }

          // ---------------------------------------------------------------
          // Reconnaissance: Domains, Subdomains, Emails
          // ---------------------------------------------------------------
          case 'theharvester': {
            progress(progressCh, 10, 'Gathering emails, subdomains, hosts from public sources...');
            result = await runCommand(python.path, [
              '-m', 'theHarvester',
              '-d', target,
              '-b', 'all',
              '-f', path.join(resultDir, 'harvester_report'),
              ...extraArgs,
            ], { timeout: 300000 });
            await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);
            break;
          }

          case 'sublist3r': {
            progress(progressCh, 10, 'Enumerating subdomains via search engines...');
            result = await runCommand(python.path, [
              '-m', 'sublist3r',
              '-d', target,
              '-o', path.join(resultDir, 'subdomains.txt'),
              ...extraArgs,
            ], { timeout: 180000 });
            await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);
            break;
          }

          case 'fierce': {
            progress(progressCh, 10, 'Running DNS reconnaissance...');
            result = await runCommand(python.path, [
              '-m', 'fierce', '--domain', target,
              ...extraArgs,
            ], { timeout: 120000 });
            await fs.writeFile(path.join(resultDir, 'fierce_results.txt'), result.stdout);
            break;
          }

          case 'photon': {
            progress(progressCh, 10, 'Crawling target for URLs, emails, secrets...');
            result = await runCommand(python.path, [
              '-m', 'photon',
              '-u', target,
              '-o', resultDir,
              '--keys',
              '-l', '3',
              '-t', '10',
              ...extraArgs,
            ], { timeout: 300000 });
            await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);
            break;
          }

          case 'cloud-enum': {
            progress(progressCh, 10, 'Enumerating public cloud resources...');
            result = await runCommand(python.path, [
              '-m', 'cloud_enum',
              '-k', target,
              '-l', path.join(resultDir, 'cloud_enum_results.txt'),
              ...extraArgs,
            ], { timeout: 300000 });
            await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);
            break;
          }

          // ---------------------------------------------------------------
          // Web Attack: Directory/XSS/WAF
          // ---------------------------------------------------------------
          case 'dirsearch': {
            progress(progressCh, 10, 'Brute-forcing web paths and directories...');
            result = await runCommand(python.path, [
              '-m', 'dirsearch',
              '-u', target,
              '-o', path.join(resultDir, 'dirsearch_results.txt'),
              '--format', 'json',
              '-t', '20',
              ...extraArgs,
            ], { timeout: 300000 });
            await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);
            break;
          }

          case 'wafw00f': {
            progress(progressCh, 10, 'Fingerprinting Web Application Firewall...');
            result = await runCommand(python.path, [
              '-m', 'wafw00f', target,
              '-o', path.join(resultDir, 'waf_results.json'),
              '-f', 'json',
              ...extraArgs,
            ], { timeout: 60000 });
            await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);
            break;
          }

          case 'xss-strike': {
            progress(progressCh, 10, 'Running XSS detection suite...');
            result = await runCommand(python.path, [
              '-m', 'xsstrike',
              '-u', target,
              '--crawl',
              ...extraArgs,
            ], { timeout: 180000 });
            await fs.writeFile(path.join(resultDir, 'xsstrike_results.txt'), result.stdout);
            break;
          }

          // ---------------------------------------------------------------
          // Crypto: Hash Identification
          // ---------------------------------------------------------------
          case 'hash-identifier': {
            progress(progressCh, 10, 'Identifying hash type...');
            result = await runCommand(python.path, [
              '-m', 'hashid', target,
              '-m', '-j',
              ...extraArgs,
            ], { timeout: 15000 });
            await fs.writeFile(path.join(resultDir, 'hashid_results.txt'), result.stdout);
            break;
          }

          // ---------------------------------------------------------------
          // OSINT: Google Dorks
          // ---------------------------------------------------------------
          case 'dorks-eye': {
            progress(progressCh, 10, 'Generating Google dorks for target...');
            // DorksEye may not have a -m invocable module; use Python script
            const dorksScript = `
import sys, json, urllib.parse, os

target = sys.argv[1]
output_dir = sys.argv[2]

# Comprehensive Google dork templates for forensic/PI research
dork_templates = [
    # Personal info
    'intext:"{target}" filetype:pdf',
    'intext:"{target}" filetype:doc OR filetype:docx',
    'intext:"{target}" filetype:xls OR filetype:xlsx',
    'intitle:"{target}" site:linkedin.com',
    'intitle:"{target}" site:facebook.com',
    '"{target}" site:pastebin.com',
    '"{target}" inurl:cv OR inurl:resume',
    '"{target}" filetype:txt password OR passwd',
    # Technical recon
    'site:{target} inurl:admin',
    'site:{target} inurl:login',
    'site:{target} filetype:sql',
    'site:{target} filetype:env',
    'site:{target} filetype:log',
    'site:{target} ext:conf OR ext:cnf OR ext:cfg',
    'site:{target} intext:"index of /"',
    'site:{target} intitle:"index of" "parent directory"',
    'site:{target} filetype:bak OR filetype:old OR filetype:backup',
    'site:{target} inurl:wp-content OR inurl:wp-includes',
    'site:{target} filetype:xml inurl:sitemap',
    'site:{target} intitle:"phpMyAdmin"',
    # Credentials / leaks
    '"{target}" intext:password OR intext:passwd filetype:txt',
    '"{target}" intext:"api_key" OR intext:"apikey"',
    '"{target}" site:github.com password OR secret OR token',
    '"{target}" site:trello.com',
    '"{target}" site:docs.google.com',
    # Data breach
    '"{target}" site:haveibeenpwned.com',
    '"{target}" "breach" OR "leaked" OR "dump"',
]

results = []
for template in dork_templates:
    dork = template.replace('{target}', target)
    search_url = f'https://www.google.com/search?q={urllib.parse.quote(dork)}'
    results.append({{'dork': dork, 'search_url': search_url}})

output_file = os.path.join(output_dir, 'google_dorks.json')
with open(output_file, 'w') as f:
    json.dump({{'target': target, 'dorks_generated': len(results), 'dorks': results}}, f, indent=2)

print(f'Generated {{len(results)}} Google dorks for: {{target}}')
`;
            const scriptPath = path.join(resultDir, '_dorks_gen.py');
            await fs.writeFile(scriptPath, dorksScript, 'utf-8');
            result = await runCommand(python.path, [scriptPath, target, resultDir], { timeout: 30000 });
            await fs.unlink(scriptPath).catch(() => {});
            break;
          }

          default:
            return { success: false, error: `Tool "${toolId}" execution not configured` };
        }

        // Common post-processing
        const exitCode = result?.exitCode ?? 1;
        const output = result?.stdout ?? '';
        const stderr = result?.stderr ?? '';

        if (exitCode !== 0 && !output.trim()) {
          progress(progressCh, 0, `Tool failed: ${stderr.slice(0, 200)}`);
          return { success: false, error: stderr.slice(0, 500), outputPath: resultDir };
        }

        // Save execution metadata
        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: toolDef.name,
          toolId,
          target,
          extraArgs,
          timestamp: new Date().toISOString(),
          exitCode,
          outputLines: output.split('\n').length,
        });

        progress(progressCh, 100, `${toolDef.name} complete`);
        return { success: true, outputPath: resultDir, summary: output.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Export: Register All Python Toolkit Handlers
// ---------------------------------------------------------------------------

export function registerPythonToolkitHandlers(): void {
  registerToolkitRunHandler();
  registerToolkitInstallHandler();
  registerToolkitStatusHandler();
}
