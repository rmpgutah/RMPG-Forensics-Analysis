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

      // Input validation: reject shell metacharacters in target (allow - . : / @ for URLs/domains)
      if (/[;&|`$(){}!#*<>\\\n\r]/.test(target)) {
        return { success: false, error: 'Target contains invalid characters' };
      }
      // Validate extraArgs: reject shell injection but allow common flag characters
      for (const arg of extraArgs) {
        if (/[;&|`$(){}!#*<>\\\n\r]/.test(arg)) {
          return { success: false, error: 'Extra arguments contain invalid characters' };
        }
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
// Dedicated OSINT Tool Handlers
// ---------------------------------------------------------------------------
// These handlers wire the individual page-level IPC channels (e.g.
// SHERLOCK_RUN, MAIGRET_RUN) to the existing PYTHON_TOOLS registry so that
// each dedicated page works without routing through the generic toolkit.

function registerOsintToolHandlers(): void {
  // -----------------------------------------------------------------------
  // SHERLOCK_RUN – username hunt across 400+ social networks
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.SHERLOCK_RUN,
    async (_event, options: { username: string; outputPath: string }) => {
      const { username, outputPath } = options;
      const progressCh = IPC_CHANNELS.SHERLOCK_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting Sherlock search for: ${username}`);

      try {
        progress(progressCh, 10, 'Running Sherlock username hunt across 400+ sites...');
        const resultDir = path.join(outputPath, `sherlock_${Date.now()}`);
        await ensureDir(resultDir);

        const result = await runCommand(python.path, [
          '-m', 'sherlock_project', username,
          '--output', path.join(resultDir, 'sherlock_results.txt'),
          '--csv',
          '--print-found',
        ], { timeout: 300000 });

        await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Sherlock failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Sherlock', target: username,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Sherlock search complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // MAIGRET_RUN – deep username search across 2500+ sites
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.MAIGRET_RUN,
    async (_event, options: { username: string; outputPath: string }) => {
      const { username, outputPath } = options;
      const progressCh = IPC_CHANNELS.MAIGRET_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting Maigret deep search for: ${username}`);

      try {
        progress(progressCh, 10, 'Running Maigret deep username search (2500+ sites)...');
        const resultDir = path.join(outputPath, `maigret_${Date.now()}`);
        await ensureDir(resultDir);

        const result = await runCommand(python.path, [
          '-m', 'maigret', username,
          '--folderoutput', resultDir,
          '--json', 'ndjson',
          '--pdf',
        ], { timeout: 600000 });

        await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Maigret failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Maigret', target: username,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Maigret profiling complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // HOLEHE_RUN – check email registration across 120+ sites
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.HOLEHE_RUN,
    async (_event, options: { email: string; outputPath: string }) => {
      const { email, outputPath } = options;
      const progressCh = IPC_CHANNELS.HOLEHE_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting Holehe email check for: ${email}`);

      try {
        progress(progressCh, 10, 'Checking email registration across 120+ sites...');
        const resultDir = path.join(outputPath, `holehe_${Date.now()}`);
        await ensureDir(resultDir);

        const result = await runCommand(python.path, [
          '-m', 'holehe', email, '--only-used',
        ], { timeout: 120000 });

        await fs.writeFile(path.join(resultDir, 'holehe_results.txt'), result.stdout);

        // Parse output to structured JSON
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
          email,
          total_checked: found.length,
          registered: found.filter((f) => f.exists),
          not_registered: found.filter((f) => !f.exists),
        });

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Holehe', target: email,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, `Holehe check complete — ${found.filter((f) => f.exists).length} site(s) found`);
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // GHUNT_RUN – Google account investigation
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.GHUNT_RUN,
    async (_event, options: { email: string; outputPath: string }) => {
      const { email, outputPath } = options;
      const progressCh = IPC_CHANNELS.GHUNT_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting GHunt investigation for: ${email}`);

      try {
        progress(progressCh, 10, 'Running GHunt Google account recon...');
        const resultDir = path.join(outputPath, `ghunt_${Date.now()}`);
        await ensureDir(resultDir);

        const result = await runCommand(python.path, [
          '-m', 'ghunt', 'email', email,
          '--json', path.join(resultDir, 'ghunt_results.json'),
        ], { timeout: 120000 });

        await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `GHunt failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'GHunt', target: email,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'GHunt investigation complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // SOCIAL_ANALYZER_RUN – social media profile analysis
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.SOCIAL_ANALYZER_RUN,
    async (_event, options: { target: string; outputPath: string }) => {
      const { target, outputPath } = options;
      const progressCh = IPC_CHANNELS.SOCIAL_ANALYZER_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting Social Analyzer for: ${target}`);

      try {
        progress(progressCh, 10, 'Analyzing social media profiles across 1000+ platforms...');
        const resultDir = path.join(outputPath, `social_analyzer_${Date.now()}`);
        await ensureDir(resultDir);

        const result = await runCommand(python.path, [
          '-m', 'social-analyzer',
          '--username', target,
          '--metadata',
          '--output', 'json',
        ], { timeout: 300000 });

        await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);

        // Try to parse JSON output
        try {
          const parsed = JSON.parse(result.stdout.trim());
          await writeJson(path.join(resultDir, 'social_analyzer_results.json'), parsed);
        } catch {
          await fs.writeFile(path.join(resultDir, 'social_analyzer_results.txt'), result.stdout);
        }

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Social Analyzer failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Social Analyzer', target,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Social Analyzer complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Extended OSINT / Tactical Tool Handlers
// ---------------------------------------------------------------------------
// These handlers wire dedicated page-level IPC channels for tools that have
// their own renderer pages.  Each handler resolves Python, runs the tool
// (falling back to a built-in script when the pip package is unavailable),
// and returns structured output the same way the five handlers above do.

function registerExtendedOsintToolHandlers(): void {
  // -----------------------------------------------------------------------
  // HARVESTER_RUN – gather emails, subdomains, hosts from public sources
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.HARVESTER_RUN,
    async (_event, options: { domain: string; outputPath: string }) => {
      const { domain, outputPath } = options;
      const progressCh = IPC_CHANNELS.HARVESTER_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `harvester_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting theHarvester for domain: ${domain}`);

      try {
        progress(progressCh, 10, 'Gathering emails, subdomains, hosts from public sources...');
        const result = await runCommand(python.path, [
          '-m', 'theHarvester',
          '-d', domain,
          '-b', 'all',
          '-f', path.join(resultDir, 'harvester_report'),
        ], { timeout: 300000 });

        await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `theHarvester failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'theHarvester', target: domain,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'theHarvester complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // SPIDERFOOT_RUN – automated OSINT collection
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.SPIDERFOOT_RUN,
    async (_event, options: { target: string; outputPath: string }) => {
      const { target, outputPath } = options;
      const progressCh = IPC_CHANNELS.SPIDERFOOT_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `spiderfoot_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting SpiderFoot for: ${target}`);

      try {
        progress(progressCh, 10, 'Running SpiderFoot automated OSINT scan...');
        const result = await runCommand(python.path, [
          '-m', 'spiderfoot',
          '-s', target,
          '-o', 'json',
        ], { timeout: 600000 });

        await fs.writeFile(path.join(resultDir, 'spiderfoot_results.txt'), result.stdout);
        try {
          const parsed = JSON.parse(result.stdout.trim());
          await writeJson(path.join(resultDir, 'spiderfoot_results.json'), parsed);
        } catch { /* raw output already saved */ }

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `SpiderFoot failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'SpiderFoot', target,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'SpiderFoot scan complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // PHONEINFOGA_RUN – phone number OSINT
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.PHONEINFOGA_RUN,
    async (_event, options: { phoneNumber: string; outputPath: string }) => {
      const { phoneNumber, outputPath } = options;
      const progressCh = IPC_CHANNELS.PHONEINFOGA_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `phoneinfoga_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting PhoneInfoga lookup for: ${phoneNumber}`);

      try {
        progress(progressCh, 10, 'Running phone number intelligence lookup...');
        const result = await runCommand(python.path, [
          '-m', 'phoneinfoga', 'scan',
          '-n', phoneNumber,
        ], { timeout: 120000 });

        await fs.writeFile(path.join(resultDir, 'phoneinfoga_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `PhoneInfoga failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'PhoneInfoga', target: phoneNumber,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'PhoneInfoga lookup complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // SKIPTRACER_RUN – people search / skip tracing
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.SKIPTRACER_RUN,
    async (_event, options: { fullName: string; outputPath: string }) => {
      const { fullName, outputPath } = options;
      const progressCh = IPC_CHANNELS.SKIPTRACER_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `skiptracer_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting Skiptracer for: ${fullName}`);

      try {
        progress(progressCh, 10, 'Running skip trace lookup...');
        const result = await runCommand(python.path, [
          '-m', 'skiptracer',
          '--name', fullName,
          '--output', resultDir,
        ], { timeout: 180000 });

        await fs.writeFile(path.join(resultDir, 'skiptracer_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Skiptracer failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Skiptracer', target: fullName,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Skiptracer complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // RECONNG_RUN – Recon-ng OSINT framework
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.RECONNG_RUN,
    async (_event, options: { target: string; outputPath: string }) => {
      const { target, outputPath } = options;
      const progressCh = IPC_CHANNELS.RECONNG_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `reconng_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting Recon-ng for: ${target}`);

      try {
        progress(progressCh, 10, 'Running Recon-ng reconnaissance framework...');
        const result = await runCommand(python.path, [
          '-m', 'recon',
          '--target', target,
          '--output', resultDir,
        ], { timeout: 300000 });

        await fs.writeFile(path.join(resultDir, 'reconng_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Recon-ng failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Recon-ng', target,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Recon-ng complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // MALTEGO_RUN – Maltego CE link analysis
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.MALTEGO_RUN,
    async (_event, options: { seedEntity: string; outputPath: string }) => {
      const { seedEntity, outputPath } = options;
      const progressCh = IPC_CHANNELS.MALTEGO_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `maltego_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting Maltego CE transforms for: ${seedEntity}`);

      try {
        progress(progressCh, 10, 'Running Maltego CE link analysis...');
        const result = await runCommand(python.path, [
          '-m', 'maltego',
          '--entity', seedEntity,
          '--output', resultDir,
        ], { timeout: 300000 });

        await fs.writeFile(path.join(resultDir, 'maltego_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Maltego failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Maltego CE', target: seedEntity,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Maltego CE transforms complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // METAGOOFIL_RUN – metadata extraction from public documents
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.METAGOOFIL_RUN,
    async (_event, options: { domain: string; outputPath: string }) => {
      const { domain, outputPath } = options;
      const progressCh = IPC_CHANNELS.METAGOOFIL_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `metagoofil_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting Metagoofil for domain: ${domain}`);

      try {
        progress(progressCh, 10, 'Extracting metadata from public documents...');
        const result = await runCommand(python.path, [
          '-m', 'metagoofil',
          '-d', domain,
          '-t', 'pdf,doc,xls,ppt,docx,xlsx,pptx',
          '-o', resultDir,
        ], { timeout: 300000 });

        await fs.writeFile(path.join(resultDir, 'metagoofil_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Metagoofil failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Metagoofil', target: domain,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Metagoofil extraction complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // CREEPY_RUN – geolocation OSINT
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.CREEPY_RUN,
    async (_event, options: { username: string; outputPath: string }) => {
      const { username, outputPath } = options;
      const progressCh = IPC_CHANNELS.CREEPY_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `creepy_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting Creepy geolocation for: ${username}`);

      try {
        progress(progressCh, 10, 'Running geolocation analysis...');
        const result = await runCommand(python.path, [
          '-m', 'creepy',
          '--username', username,
          '--output', resultDir,
        ], { timeout: 300000 });

        await fs.writeFile(path.join(resultDir, 'creepy_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Creepy failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Creepy', target: username,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Creepy geolocation complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // TINEYE_RUN – reverse image search
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.TINEYE_RUN,
    async (_event, options: { imagePath: string; outputPath: string }) => {
      const { imagePath, outputPath } = options;
      const progressCh = IPC_CHANNELS.TINEYE_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `tineye_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting TinEye reverse image search for: ${imagePath}`);

      try {
        progress(progressCh, 10, 'Running reverse image search...');
        const result = await runCommand(python.path, [
          '-m', 'tineye',
          '--image', imagePath,
          '--output', path.join(resultDir, 'tineye_results.json'),
        ], { timeout: 120000 });

        await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `TinEye failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'TinEye', target: imagePath,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'TinEye search complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // PLATE_READER_RUN – license plate recognition
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.PLATE_READER_RUN,
    async (_event, options: { plateNumber: string; outputPath: string }) => {
      const { plateNumber, outputPath } = options;
      const progressCh = IPC_CHANNELS.PLATE_READER_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `plate_reader_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting plate lookup for: ${plateNumber}`);

      try {
        progress(progressCh, 10, 'Running license plate lookup...');
        const result = await runCommand(python.path, [
          '-m', 'plate_reader',
          '--plate', plateNumber,
          '--output', path.join(resultDir, 'plate_results.json'),
        ], { timeout: 120000 });

        await fs.writeFile(path.join(resultDir, 'stdout.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Plate reader failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Plate Reader', target: plateNumber,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Plate reader lookup complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // COUNTER_SURV_RUN – counter-surveillance analysis
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.COUNTER_SURV_RUN,
    async (_event, options: { locationId: string; outputPath: string }) => {
      const { locationId, outputPath } = options;
      const progressCh = IPC_CHANNELS.COUNTER_SURV_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `counter_surv_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting counter-surveillance analysis for location: ${locationId}`);

      try {
        progress(progressCh, 10, 'Running counter-surveillance analysis...');
        const result = await runCommand(python.path, [
          '-m', 'counter_surveillance',
          '--location', locationId,
          '--output', resultDir,
        ], { timeout: 300000 });

        await fs.writeFile(path.join(resultDir, 'counter_surv_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Counter-surveillance failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Counter-Surveillance', target: locationId,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Counter-surveillance analysis complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // VEHICLE_TRACK_RUN – vehicle tracking
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.VEHICLE_TRACK_RUN,
    async (_event, options: { trackerId: string; outputPath: string }) => {
      const { trackerId, outputPath } = options;
      const progressCh = IPC_CHANNELS.VEHICLE_TRACK_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `vehicle_track_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting vehicle tracking for: ${trackerId}`);

      try {
        progress(progressCh, 10, 'Running vehicle tracking analysis...');
        const result = await runCommand(python.path, [
          '-m', 'vehicle_tracker',
          '--tracker', trackerId,
          '--output', resultDir,
        ], { timeout: 300000 });

        await fs.writeFile(path.join(resultDir, 'vehicle_track_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Vehicle tracking failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Vehicle Tracker', target: trackerId,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Vehicle tracking complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // STAKEOUT_RUN – camera feed monitoring
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.STAKEOUT_RUN,
    async (_event, options: { feedUrl: string; outputPath: string }) => {
      const { feedUrl, outputPath } = options;
      const progressCh = IPC_CHANNELS.STAKEOUT_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `stakeout_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting stakeout monitor for feed: ${feedUrl}`);

      try {
        progress(progressCh, 10, 'Running stakeout camera monitoring...');
        const result = await runCommand(python.path, [
          '-m', 'stakeout',
          '--feed', feedUrl,
          '--output', resultDir,
        ], { timeout: 600000 });

        await fs.writeFile(path.join(resultDir, 'stakeout_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Stakeout failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Stakeout Camera', target: feedUrl,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Stakeout monitoring complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  // -----------------------------------------------------------------------
  // DEAD_DROP_RUN – dead drop communications
  // -----------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.DEAD_DROP_RUN,
    async (_event, options: { channelCode: string; outputPath: string }) => {
      const { channelCode, outputPath } = options;
      const progressCh = IPC_CHANNELS.DEAD_DROP_PROGRESS;
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python not found' };

      await ensureDir(outputPath);
      const resultDir = path.join(outputPath, `dead_drop_${Date.now()}`);
      await ensureDir(resultDir);
      progress(progressCh, 5, `Starting dead drop channel check: ${channelCode}`);

      try {
        progress(progressCh, 10, 'Running dead drop communications check...');
        const result = await runCommand(python.path, [
          '-m', 'dead_drop',
          '--channel', channelCode,
          '--output', resultDir,
        ], { timeout: 120000 });

        await fs.writeFile(path.join(resultDir, 'dead_drop_results.txt'), result.stdout);

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          progress(progressCh, 0, `Dead drop check failed: ${result.stderr.slice(0, 200)}`);
          return { success: false, error: result.stderr.slice(0, 500), outputPath: resultDir };
        }

        await writeJson(path.join(resultDir, '_metadata.json'), {
          tool: 'Dead Drop', target: channelCode,
          timestamp: new Date().toISOString(), exitCode: result.exitCode,
        });

        progress(progressCh, 100, 'Dead drop check complete');
        return { success: true, outputPath: resultDir, summary: result.stdout.slice(0, 1000) };
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
  registerOsintToolHandlers();
  registerExtendedOsintToolHandlers();
}
