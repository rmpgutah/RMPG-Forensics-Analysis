# iOS Intelligence + Backup UX Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a three-tab iOS Intelligence page (Activity Timeline, Location Access Trace, Network Trace), overhaul iOS backup progress to show phases/ETA/heartbeat/output path, and fix the broken iOS location extraction backend.

**Architecture:** New `IosIntelligence.tsx` page with three independent tabs, each backed by its own IPC channel + service function. Backup progress is enhanced by parsing `idevicebackup2` stdout into a 5-phase model and enriching the UI with phase labels, ETA, a CSS heartbeat pulse on stall, and an output path banner on completion.

**Tech Stack:** React 18 + TypeScript, Electron IPC (ipcMain.handle / window.api.on), better-sqlite3, plist parsing, lucide-react icons, Tailwind CSS classes

---

## Task 1 — Add 6 IPC channels to constants.ts

**Files:**
- Modify: `packages/shared/src/constants.ts` (after line 96, inside the iOS section)

**Step 1: Add channels**

In `packages/shared/src/constants.ts`, after the `IOS_SCREENTIME_EXTRACT_PROGRESS` line (line 96), add:

```typescript
  IOS_INTELLIGENCE_TIMELINE:          'ios:intelligence-timeline',
  IOS_INTELLIGENCE_TIMELINE_PROGRESS: 'ios:intelligence-timeline-progress',
  IOS_LOCATION_ACCESS:                'ios:location-access',
  IOS_LOCATION_ACCESS_PROGRESS:       'ios:location-access-progress',
  IOS_NETWORK_TRACE:                  'ios:network-trace',
  IOS_NETWORK_TRACE_PROGRESS:         'ios:network-trace-progress',
```

**Step 2: Verify TypeScript compiles**

```bash
cd "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics"
pnpm --filter @rmpg/shared build 2>&1 | tail -5
```
Expected: no errors

**Step 3: Commit**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/shared/src/constants.ts
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "feat: add IPC channels for iOS Intelligence tabs"
```

---

## Task 2 — Fix IosLocationHistory.tsx parameter bug

**Files:**
- Modify: `packages/desktop/src/renderer/pages/IosLocationHistory.tsx`

**Background:** The component sends `{ backupPath }` but the handler at `IOS_LOCATION_EXTRACT` destructures `{ backupDir }`. This causes silent failure — the handler receives `undefined` as the backup directory.

**Step 1: Fix the invoke call**

Find all occurrences of `backupPath` in `IosLocationHistory.tsx` that are passed to the IPC invoke for `IOS_LOCATION_EXTRACT`. Change:
```typescript
window.api.invoke(IPC_CHANNELS.IOS_LOCATION_EXTRACT, { backupPath, ... })
```
to:
```typescript
window.api.invoke(IPC_CHANNELS.IOS_LOCATION_EXTRACT, { backupDir: backupPath, ... })
// or rename the state variable to backupDir throughout
```

The cleanest fix: rename the local state variable `backupPath` → `backupDir` throughout the file (replace_all), so the IPC payload key matches the handler's expected key.

**Step 2: Commit**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/desktop/src/renderer/pages/IosLocationHistory.tsx
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "fix: IosLocationHistory sends backupDir not backupPath"
```

---

## Task 3 — Fix extractLocationHistory() for modern iOS (ios-service.ts)

**Files:**
- Modify: `packages/desktop/src/main/services/ios-service.ts` — `extractLocationHistory()` function

**Background:** The function only checks `consolidated.db` which hasn't existed since iOS 6 (2012). Modern iOS (11+) stores location history in the `com.apple.routined` app domain under `RMAdminStore-Local.sqlite`.

**Step 1: Replace the candidates array inside `extractLocationHistory()`**

Find the section starting:
```typescript
  const candidates = [
    ['RootDomain', 'Library/Caches/locationd/consolidated.db'],
```

Replace the entire candidates array with a priority chain:
```typescript
  // Priority chain for iOS location databases:
  // 1. com.apple.routined (iOS 11+) — richest data
  // 2. legacy consolidated.db (iOS ≤ 6) — fallback
  const candidates = [
    ['AppDomain-com.apple.routined', 'RMAdminStore-Local.sqlite'],
    ['AppDomain-com.apple.routined', 'RMAdminStore-Shared.sqlite'],
    ['RootDomain', 'Library/Caches/locationd/consolidated.db'],
    ['HomeDomain', 'Library/Caches/locationd/consolidated.db'],
  ];
```

**Step 2: Fix the SQL query for routined databases**

The `routined` databases use a different table schema than `consolidated.db`. After finding a routined database, the query should be:

```sql
-- RMAdminStore-Local.sqlite table: ZRTLEARNEDLOCATIONOFINTERESTMO
SELECT ZLATITUDE, ZLONGITUDE, ZUNCERTAINTYRADIUSINMETERS, ZSTARTDATE, ZENDDATE, ZLOCATIONLATITUDE, ZLOCATIONLONGITUDE
FROM ZRTLEARNEDLOCATIONOFINTERESTMO
WHERE ZLATITUDE IS NOT NULL
```

Apple epoch offset for routined: timestamps are stored as CoreData epoch (seconds since Jan 1 2001). Convert to Unix: `timestamp + 978307200`.

The existing extraction code likely tries the same SQL on all candidates. Add a try/catch per candidate so if routined schema differs from consolidated schema, it falls through gracefully to the next candidate.

**Step 3: Normalize returned records**

Each record returned should match the `LocationRecord` interface expected by the UI:
```typescript
{
  id: string,           // rowid or generated UUID
  latitude: number,
  longitude: number,
  altitude: number | null,
  accuracy: number | null,
  timestamp: number,    // Unix timestamp ms
  source: 'routined' | 'consolidated' | 'photos',
  sourceName: string,   // human-readable
}
```

**Step 4: Commit**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/desktop/src/main/services/ios-service.ts
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "fix: extractLocationHistory supports modern iOS routined database"
```

---

## Task 4 — Add three new service functions to ios-service.ts

**Files:**
- Modify: `packages/desktop/src/main/services/ios-service.ts` — append at end of file

### 4a — `extractActivityTimeline(backupDir)`

Calls all existing extractors in parallel and merges results into a single chronological list.

```typescript
export interface TimelineEvent {
  id: string;
  type: 'message' | 'call' | 'location' | 'browse' | 'note' | 'photo' | 'voicemail';
  timestamp: number; // Unix ms
  summary: string;
  source: string;
  detail?: Record<string, unknown>;
}

export async function extractActivityTimeline(
  backupDir: string
): Promise<{ events: TimelineEvent[]; total: number; error?: string }> {
  const results = await Promise.allSettled([
    extractMessages(backupDir),
    extractCallHistory(backupDir),
    extractLocationHistory(backupDir),
    extractSafariHistory(backupDir),
    extractNotes(backupDir),
  ]);

  const events: TimelineEvent[] = [];

  // Map each result set into TimelineEvent[]
  // Messages
  if (results[0].status === 'fulfilled') {
    for (const msg of (results[0].value as { messages: unknown[] }).messages ?? []) {
      const m = msg as Record<string, unknown>;
      events.push({
        id: `msg-${m.rowid ?? Math.random()}`,
        type: 'message',
        timestamp: typeof m.date === 'number' ? m.date : 0,
        summary: `${m.sender ?? 'Unknown'}: ${String(m.text ?? '').substring(0, 80)}`,
        source: 'Messages',
        detail: m,
      });
    }
  }

  // Calls
  if (results[1].status === 'fulfilled') {
    for (const call of (results[1].value as { calls: unknown[] }).calls ?? []) {
      const c = call as Record<string, unknown>;
      events.push({
        id: `call-${c.rowid ?? Math.random()}`,
        type: 'call',
        timestamp: typeof c.date === 'number' ? c.date : 0,
        summary: `${c.answered ? 'Call' : 'Missed call'} ${c.duration ? `(${c.duration}s)` : ''} — ${c.address ?? 'Unknown'}`,
        source: 'Call History',
        detail: c,
      });
    }
  }

  // Location
  if (results[2].status === 'fulfilled') {
    for (const loc of (results[2].value as { locations: unknown[] }).locations ?? []) {
      const l = loc as Record<string, unknown>;
      events.push({
        id: `loc-${Math.random()}`,
        type: 'location',
        timestamp: typeof l.timestamp === 'number' ? l.timestamp : 0,
        summary: `Location: ${Number(l.latitude ?? 0).toFixed(5)}, ${Number(l.longitude ?? 0).toFixed(5)}`,
        source: 'Location History',
        detail: l,
      });
    }
  }

  // Safari
  if (results[3].status === 'fulfilled') {
    for (const visit of (results[3].value as { history: unknown[] }).history ?? []) {
      const v = visit as Record<string, unknown>;
      events.push({
        id: `safari-${Math.random()}`,
        type: 'browse',
        timestamp: typeof v.visit_time === 'number' ? v.visit_time : 0,
        summary: `Visited: ${v.title ?? v.url ?? 'Unknown'}`,
        source: 'Safari',
        detail: v,
      });
    }
  }

  // Notes
  if (results[4].status === 'fulfilled') {
    for (const note of (results[4].value as { notes: unknown[] }).notes ?? []) {
      const n = note as Record<string, unknown>;
      events.push({
        id: `note-${Math.random()}`,
        type: 'note',
        timestamp: typeof n.creation_date === 'number' ? n.creation_date : 0,
        summary: `Note: ${String(n.title ?? n.text ?? '').substring(0, 80)}`,
        source: 'Notes',
        detail: n,
      });
    }
  }

  // Sort chronologically (newest first for display)
  events.sort((a, b) => b.timestamp - a.timestamp);

  return { events, total: events.length };
}
```

### 4b — `extractLocationAccessLogs(backupDir)`

Parses `HomeDomain/Library/Caches/locationd/clients.plist` which records every app that requested location authorization.

```typescript
export interface LocationAccessEntry {
  bundleId: string;
  lastAccessTime: number; // Unix ms
  authorizationType: string; // 'Always' | 'WhenInUse' | 'Denied' | 'NotDetermined'
  accessCount: number;
  executable?: string;
}

export async function extractLocationAccessLogs(
  backupDir: string
): Promise<{ entries: LocationAccessEntry[]; total: number; error?: string }> {
  const plistPath = await findBackupFile(
    backupDir,
    'HomeDomain',
    'Library/Caches/locationd/clients.plist'
  );

  if (!plistPath) {
    return { entries: [], total: 0, error: 'clients.plist not found in backup' };
  }

  try {
    // Use plist npm package to parse binary/XML plist
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const plist = require('plist');
    const raw = await fs.readFile(plistPath);
    const parsed = plist.parse(raw.toString('binary')) as Record<string, unknown>;

    const entries: LocationAccessEntry[] = [];
    for (const [bundleId, data] of Object.entries(parsed)) {
      if (typeof data !== 'object' || data === null) continue;
      const d = data as Record<string, unknown>;
      const authStatus = Number(d['Authorized'] ?? d['kCLClientManagerStateAuthorizationStatus'] ?? 0);
      const authMap: Record<number, string> = { 0: 'NotDetermined', 1: 'Restricted', 2: 'Denied', 3: 'Always', 4: 'WhenInUse' };
      entries.push({
        bundleId,
        lastAccessTime: typeof d['LastTimeUsed'] === 'number'
          ? (d['LastTimeUsed'] as number + 978307200) * 1000
          : 0,
        authorizationType: authMap[authStatus] ?? `Status${authStatus}`,
        accessCount: Number(d['TimesInterrupted'] ?? 0),
        executable: typeof d['BundlePath'] === 'string' ? d['BundlePath'] as string : undefined,
      });
    }

    entries.sort((a, b) => b.lastAccessTime - a.lastAccessTime);
    return { entries, total: entries.length };
  } catch (err) {
    return { entries: [], total: 0, error: (err as Error).message };
  }
}
```

**Note:** The `plist` npm package must be available. Check `packages/desktop/package.json` — if not present, add it:
```bash
pnpm --filter @rmpg/desktop add plist
pnpm --filter @rmpg/desktop add -D @types/plist
```

### 4c — `extractNetworkTrace(backupDir)`

Parses WiFi plist files to show known networks with join timestamps.

```typescript
export interface NetworkEntry {
  ssid: string;
  bssid?: string;
  securityType?: string;
  firstJoined?: number; // Unix ms
  lastJoined?: number;  // Unix ms
  joinCount?: number;
}

export async function extractNetworkTrace(
  backupDir: string
): Promise<{ networks: NetworkEntry[]; total: number; error?: string }> {
  const networks: NetworkEntry[] = [];

  // Source 1: com.apple.wifi.plist
  const wifiPlistPath = await findBackupFile(
    backupDir,
    'SystemPreferencesDomain',
    'SystemConfiguration/com.apple.wifi.plist'
  );

  if (wifiPlistPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const plist = require('plist');
      const raw = await fs.readFile(wifiPlistPath);
      const parsed = plist.parse(raw.toString('binary')) as Record<string, unknown>;
      const knownNetworks = parsed['List of known networks'] as unknown[];
      if (Array.isArray(knownNetworks)) {
        for (const net of knownNetworks) {
          const n = net as Record<string, unknown>;
          networks.push({
            ssid: String(n['SSID_STR'] ?? n['SSID'] ?? 'Unknown'),
            bssid: typeof n['BSSID'] === 'string' ? n['BSSID'] : undefined,
            securityType: typeof n['SecurityType'] === 'string' ? n['SecurityType'] : undefined,
            lastJoined: typeof n['lastJoined'] === 'number'
              ? (n['lastJoined'] as number + 978307200) * 1000
              : undefined,
            joinCount: typeof n['joinCount'] === 'number' ? n['joinCount'] as number : undefined,
          });
        }
      }
    } catch {
      // continue to next source
    }
  }

  // Deduplicate by SSID
  const seen = new Set<string>();
  const deduped = networks.filter(n => {
    if (seen.has(n.ssid)) return false;
    seen.add(n.ssid);
    return true;
  });

  deduped.sort((a, b) => (b.lastJoined ?? 0) - (a.lastJoined ?? 0));
  return { networks: deduped, total: deduped.length };
}
```

**Step 5: Commit after all three functions added**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/desktop/src/main/services/ios-service.ts
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "feat: add extractActivityTimeline, extractLocationAccessLogs, extractNetworkTrace"
```

---

## Task 5 — Add three new IPC handlers to ios-handlers.ts

**Files:**
- Modify: `packages/desktop/src/main/ipc/ios-handlers.ts` — append inside `registerIosHandlers()` before the closing `}`

Add all three after the existing IOS_LOCATION_EXTRACT handler:

```typescript
  // ---------------------------------------------------------------------------
  // IOS_INTELLIGENCE_TIMELINE - Merge all iOS data sources into timeline
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_INTELLIGENCE_TIMELINE,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_INTELLIGENCE_TIMELINE_PROGRESS, {
        type: 'status', data: 'Extracting all iOS data sources…', timestamp: Date.now(), percent: 10, message: 'Extracting all iOS data sources…',
      });
      const result = await iosService.extractActivityTimeline(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} timeline events`;
      win?.webContents.send(IPC_CHANNELS.IOS_INTELLIGENCE_TIMELINE_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_LOCATION_ACCESS - Parse locationd/clients.plist for app access log
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_LOCATION_ACCESS,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_LOCATION_ACCESS_PROGRESS, {
        type: 'status', data: 'Reading location access logs…', timestamp: Date.now(), percent: 10, message: 'Reading location access logs…',
      });
      const result = await iosService.extractLocationAccessLogs(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} app location access entries`;
      win?.webContents.send(IPC_CHANNELS.IOS_LOCATION_ACCESS_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );

  // ---------------------------------------------------------------------------
  // IOS_NETWORK_TRACE - Extract WiFi network history from backup
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.IOS_NETWORK_TRACE,
    async (_event, options: { backupDir: string }) => {
      const win = BrowserWindow.getAllWindows()[0] ?? null;
      win?.webContents.send(IPC_CHANNELS.IOS_NETWORK_TRACE_PROGRESS, {
        type: 'status', data: 'Parsing WiFi network history…', timestamp: Date.now(), percent: 10, message: 'Parsing WiFi network history…',
      });
      const result = await iosService.extractNetworkTrace(options.backupDir);
      const msg = result.error ? `Error: ${result.error}` : `Found ${result.total} known networks`;
      win?.webContents.send(IPC_CHANNELS.IOS_NETWORK_TRACE_PROGRESS, {
        type: 'status', data: msg, timestamp: Date.now(), percent: 100, message: msg, filesCount: result.total,
      });
      return result;
    }
  );
```

**Commit:**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/desktop/src/main/ipc/ios-handlers.ts
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "feat: register IOS_INTELLIGENCE_TIMELINE, IOS_LOCATION_ACCESS, IOS_NETWORK_TRACE handlers"
```

---

## Task 6 — Overhaul iOS backup progress in ios-handlers.ts

**Files:**
- Modify: `packages/desktop/src/main/ipc/ios-handlers.ts` — `IOS_BACKUP` handler (around lines 72–160)

**Background:** The existing `onProgress` callback sends raw stdout lines as `message`. We need to parse `idevicebackup2` output into 5 phases and send a `phase` field alongside the standard progress fields.

**Step 1: Add phase detection to the `onProgress` callback**

Locate the `onProgress` function inside the `IOS_BACKUP` handler. Replace the entire callback body:

```typescript
let phase = 1;
let phaseLabel = 'Connecting to device…';
let outputPath = '';

const onProgress = (p: ProcessProgress) => {
  if (!win || win.isDestroyed()) return;

  const line = (p.data || p.message || '').trim();

  // Phase detection based on idevicebackup2 stdout patterns
  if (/Backup directory|Starting backup/i.test(line)) {
    phase = 2;
    phaseLabel = 'Building backup manifest…';
  } else if (/Sending file|^\d+\.\d+%/.test(line)) {
    phase = 3;
    phaseLabel = 'Transferring files…';
  } else if (/Verif/i.test(line)) {
    phase = 4;
    phaseLabel = 'Verifying backup integrity…';
  } else if (/Backup Successful/i.test(line)) {
    phase = 5;
    phaseLabel = 'Backup complete';
    outputPath = path.join(options.outputPath, options.udid);
  }

  // Existing percent/bytes/speed parsing (keep as-is from current code)
  let percent = lastPercent;
  const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
  if (percentMatch) {
    const parsed = parseFloat(percentMatch[1]);
    if (parsed >= 0 && parsed <= 100) {
      percent = Math.max(lastPercent, parsed);
      lastPercent = percent;
    }
  }

  const bytes = p.bytes ?? lastBytes;
  lastBytes = bytes > 0 ? bytes : lastBytes;
  const speed = p.speed;
  const fileMatch = line.match(/(\d+)\s*\/\s*(\d+)/);

  const rich = {
    type: 'progress' as const,
    data: line,
    timestamp: Date.now(),
    percent,
    phase,
    phaseLabel,
    outputPath: phase === 5 ? outputPath : undefined,
    message: phaseLabel,
    bytes,
    speed,
    filesCount: fileMatch ? parseInt(fileMatch[1], 10) : undefined,
    totalFiles: fileMatch ? parseInt(fileMatch[2], 10) : undefined,
  };

  win.webContents.send(IPC_CHANNELS.IOS_BACKUP_PROGRESS, rich);
};
```

**Commit:**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/desktop/src/main/ipc/ios-handlers.ts
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "feat: iOS backup progress shows phase labels and output path"
```

---

## Task 7 — Overhaul IosBackup.tsx UI

**Files:**
- Modify: `packages/desktop/src/renderer/pages/IosBackup.tsx`

**Step 1: Add phase state and heartbeat tracking**

Add to the component state:
```typescript
const [phase, setPhase] = useState(1);
const [phaseLabel, setPhaseLabel] = useState('');
const [outputPath, setOutputPath] = useState('');
const [lastProgressTime, setLastProgressTime] = useState(0);
```

**Step 2: Subscribe to IOS_BACKUP_PROGRESS for phase data**

The `useProcess` hook already handles standard progress fields (percent, bytes, speed, eta, message). We need to additionally listen for `phase`, `phaseLabel`, and `outputPath` which are custom fields not in the standard `ProcessProgress` type:

```typescript
useEffect(() => {
  const cleanup = window.api.on(IPC_CHANNELS.IOS_BACKUP_PROGRESS, (data: Record<string, unknown>) => {
    if (typeof data.phase === 'number') setPhase(data.phase as number);
    if (typeof data.phaseLabel === 'string') setPhaseLabel(data.phaseLabel as string);
    if (typeof data.outputPath === 'string' && data.outputPath) setOutputPath(data.outputPath as string);
    setLastProgressTime(Date.now());
  });
  return cleanup;
}, []);

// Reset phase state when a new backup starts
const handleStartBackup = async () => {
  if (!selectedDevice || !outputFolder) return;
  setPhase(1);
  setPhaseLabel('Connecting to device…');
  setOutputPath('');
  setLastProgressTime(Date.now());
  await process.start({
    udid: selectedDevice.serial,
    outputPath: outputFolder,
    encrypted,
    password: encrypted ? password : undefined,
  });
};
```

**Step 3: Heartbeat pulse — detect stall**

```typescript
const [isStalled, setIsStalled] = useState(false);

useEffect(() => {
  if (!process.isRunning) { setIsStalled(false); return; }
  const interval = setInterval(() => {
    setIsStalled(Date.now() - lastProgressTime > 3000);
  }, 1000);
  return () => clearInterval(interval);
}, [process.isRunning, lastProgressTime]);
```

Add CSS animation for the pulse in the component (inline style or Tailwind `animate-pulse`).

**Step 4: Phase stepper UI**

Replace the plain `ProgressIndicator` block with an enhanced display:

```tsx
{(process.isRunning || process.progress.percent > 0) && (
  <div className="space-y-4">
    {/* Phase stepper */}
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-medium ${isStalled && process.isRunning ? 'animate-pulse text-amber-400' : 'text-[var(--text-primary)]'}`}>
          {phaseLabel || process.progress.message || 'Starting…'}
        </span>
        {process.isRunning && (
          <span className="text-xs text-[var(--text-muted)]">Phase {phase} / 5</span>
        )}
      </div>

      {/* 5-phase progress bar */}
      <div className="flex gap-1 mb-3">
        {[1,2,3,4,5].map(p => (
          <div
            key={p}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              p < phase ? 'bg-green-500' :
              p === phase ? (process.isRunning ? 'bg-blue-500' : 'bg-green-500') :
              'bg-[var(--border-color)]'
            }`}
          />
        ))}
      </div>

      <ProgressIndicator
        percent={process.progress.percent}
        bytes={process.progress.bytes}
        totalBytes={process.progress.totalBytes}
        speed={process.progress.speed}
        eta={process.progress.eta}
        filesCount={process.progress.filesCount}
        totalFiles={process.progress.totalFiles}
        message=""
        isRunning={process.isRunning}
      />
    </div>

    {/* Output path banner — shown after completion */}
    {outputPath && !process.isRunning && (
      <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
        <p className="text-xs font-semibold text-green-400 mb-1">Backup saved to:</p>
        <p className="font-mono text-xs text-[var(--text-primary)] break-all">{outputPath}</p>
      </div>
    )}
  </div>
)}
```

**Commit:**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/desktop/src/renderer/pages/IosBackup.tsx
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "feat: IosBackup shows phase stepper, heartbeat pulse, output path banner"
```

---

## Task 8 — Enhance IosQuickExtract.tsx backup status card

**Files:**
- Modify: `packages/desktop/src/renderer/pages/IosQuickExtract.tsx`

**Background:** The quick extract page uses `useBackupStore` for global backup state. When a backup is in progress (shown via the global store), the backup card should show the current phase label, not just a percent number.

**Step 1: Read the current backup status card section**

Look for where the backup progress/status is rendered in `IosQuickExtract.tsx`. It likely renders `backupProgress.percent` or `backupStore.progress`.

**Step 2: Subscribe to phase data from backup progress events**

Add local state for phase label:
```typescript
const [backupPhaseLabel, setBackupPhaseLabel] = useState('');

useEffect(() => {
  const cleanup = window.api.on(IPC_CHANNELS.IOS_BACKUP_PROGRESS, (data: Record<string, unknown>) => {
    if (typeof data.phaseLabel === 'string') setBackupPhaseLabel(data.phaseLabel);
  });
  return cleanup;
}, []);
```

**Step 3: Display phase label in the backup status card**

Wherever the backup status card shows the progress message, add:
```tsx
{backupPhaseLabel && (
  <p className="text-xs text-blue-400 mt-1">{backupPhaseLabel}</p>
)}
```

**Commit:**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/desktop/src/renderer/pages/IosQuickExtract.tsx
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "feat: IosQuickExtract backup card shows phase label"
```

---

## Task 9 — Create IosIntelligence.tsx

**Files:**
- Create: `packages/desktop/src/renderer/pages/IosIntelligence.tsx`

**Step 1: Create the page**

```typescript
import React, { useState } from 'react';
import { Brain, Activity, MapPin, Wifi, FolderOpen, Download } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

// ── Types ──────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  type: 'message' | 'call' | 'location' | 'browse' | 'note' | 'photo' | 'voicemail';
  timestamp: number;
  summary: string;
  source: string;
  detail?: Record<string, unknown>;
}

interface LocationAccessEntry {
  bundleId: string;
  lastAccessTime: number;
  authorizationType: string;
  accessCount: number;
  executable?: string;
}

interface NetworkEntry {
  ssid: string;
  bssid?: string;
  securityType?: string;
  lastJoined?: number;
  joinCount?: number;
}

type TabId = 'timeline' | 'location-access' | 'network';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTs(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

const TYPE_COLORS: Record<string, string> = {
  message: 'bg-blue-500/20 text-blue-300',
  call: 'bg-green-500/20 text-green-300',
  location: 'bg-orange-500/20 text-orange-300',
  browse: 'bg-purple-500/20 text-purple-300',
  note: 'bg-yellow-500/20 text-yellow-300',
  photo: 'bg-pink-500/20 text-pink-300',
  voicemail: 'bg-cyan-500/20 text-cyan-300',
};

const AUTH_COLORS: Record<string, string> = {
  Always: 'text-red-400',
  WhenInUse: 'text-amber-400',
  Denied: 'text-green-400',
  NotDetermined: 'text-[var(--text-muted)]',
};

// ── Component ──────────────────────────────────────────────────────────────

export const IosIntelligence: React.FC = () => {
  const ipc = useIpc();
  const [activeTab, setActiveTab] = useState<TabId>('timeline');
  const [backupDir, setBackupDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Tab data
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [locationAccess, setLocationAccess] = useState<LocationAccessEntry[]>([]);
  const [networks, setNetworks] = useState<NetworkEntry[]>([]);

  // Search / filter
  const [search, setSearch] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);

  const canExtract = backupDir.trim().length > 0;

  const handleExtract = async () => {
    if (!canExtract) return;
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'timeline') {
        const result = await ipc.invoke(IPC_CHANNELS.IOS_INTELLIGENCE_TIMELINE, { backupDir }) as { events: TimelineEvent[]; error?: string };
        if (result.error) setError(result.error);
        setEvents(result.events ?? []);
      } else if (activeTab === 'location-access') {
        const result = await ipc.invoke(IPC_CHANNELS.IOS_LOCATION_ACCESS, { backupDir }) as { entries: LocationAccessEntry[]; error?: string };
        if (result.error) setError(result.error);
        setLocationAccess(result.entries ?? []);
      } else {
        const result = await ipc.invoke(IPC_CHANNELS.IOS_NETWORK_TRACE, { backupDir }) as { networks: NetworkEntry[]; error?: string };
        if (result.error) setError(result.error);
        setNetworks(result.networks ?? []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleType = (type: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const filteredEvents = events.filter(e => {
    if (selectedTypes.size > 0 && !selectedTypes.has(e.type)) return false;
    if (search && !e.summary.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'timeline', label: 'Activity Timeline', icon: <Activity size={14} /> },
    { id: 'location-access', label: 'Location Access Trace', icon: <MapPin size={14} /> },
    { id: 'network', label: 'Network Trace', icon: <Wifi size={14} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Intelligence"
        description="Correlate all iOS data sources into a unified forensic picture"
        icon={<Brain size={24} />}
      />

      {/* Backup directory picker */}
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <FolderPicker
            label="iOS Backup Directory"
            value={backupDir}
            onChange={setBackupDir}
            disabled={loading}
          />
        </div>
        <button
          onClick={handleExtract}
          disabled={!canExtract || loading}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <FolderOpen size={14} />
          )}
          {loading ? 'Extracting…' : 'Extract'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearch(''); setSelectedTypes(new Set()); }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Activity Timeline Tab ─────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div className="space-y-4">
          {events.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="Search events…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input-field flex-1 min-w-48"
              />
              <div className="flex flex-wrap gap-2">
                {(['message','call','location','browse','note','photo','voicemail'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-opacity ${
                      TYPE_COLORS[type] ?? ''
                    } ${selectedTypes.size > 0 && !selectedTypes.has(type) ? 'opacity-40' : ''}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <span className="text-xs text-[var(--text-muted)]">{filteredEvents.length} events</span>
            </div>
          )}

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
                {filteredEvents.length === 0 ? (
                  <div className="p-8 text-center text-sm text-[var(--text-muted)]">
                    {events.length === 0 ? 'Select a backup directory and click Extract' : 'No events match the current filter'}
                  </div>
                ) : (
                  <div className="max-h-[500px] overflow-y-auto">
                    {filteredEvents.map(event => (
                      <div
                        key={event.id}
                        onClick={() => setSelectedEvent(selectedEvent?.id === event.id ? null : event)}
                        className={`flex items-start gap-3 border-b border-[var(--border-color)] px-4 py-3 text-sm cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors ${
                          selectedEvent?.id === event.id ? 'bg-blue-500/10' : ''
                        }`}
                      >
                        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_COLORS[event.type] ?? ''}`}>
                          {event.type}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[var(--text-primary)]">{event.summary}</p>
                          <p className="text-xs text-[var(--text-muted)]">{formatTs(event.timestamp)} · {event.source}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Detail panel */}
            {selectedEvent && (
              <div className="w-72 shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                <h4 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Event Detail</h4>
                <div className="space-y-1 text-xs">
                  {Object.entries(selectedEvent.detail ?? {}).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="w-28 shrink-0 font-medium text-[var(--text-secondary)] truncate">{k}</span>
                      <span className="break-all text-[var(--text-primary)]">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Location Access Trace Tab ─────────────────────────────────── */}
      {activeTab === 'location-access' && (
        <div className="space-y-4">
          {locationAccess.length > 0 && (
            <p className="text-xs text-[var(--text-muted)]">{locationAccess.length} apps with location access history</p>
          )}
          <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
            {locationAccess.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--text-muted)]">
                Select a backup directory and click Extract
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  <tr>
                    <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">App Bundle ID</th>
                    <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Authorization</th>
                    <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Last Access</th>
                    <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {locationAccess.map((entry, i) => (
                    <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                      <td className="px-4 py-2 font-mono text-[var(--text-primary)]">{entry.bundleId}</td>
                      <td className={`px-4 py-2 font-medium ${AUTH_COLORS[entry.authorizationType] ?? ''}`}>
                        {entry.authorizationType}
                      </td>
                      <td className="px-4 py-2 text-[var(--text-secondary)]">{formatTs(entry.lastAccessTime)}</td>
                      <td className="px-4 py-2 text-[var(--text-muted)]">{entry.accessCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Network Trace Tab ─────────────────────────────────────────── */}
      {activeTab === 'network' && (
        <div className="space-y-4">
          {networks.length > 0 && (
            <p className="text-xs text-[var(--text-muted)]">{networks.length} known networks</p>
          )}
          <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
            {networks.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--text-muted)]">
                Select a backup directory and click Extract
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  <tr>
                    <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">SSID</th>
                    <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">BSSID</th>
                    <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Security</th>
                    <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Last Joined</th>
                    <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Joins</th>
                  </tr>
                </thead>
                <tbody>
                  {networks.map((net, i) => (
                    <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                      <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{net.ssid}</td>
                      <td className="px-4 py-2 font-mono text-[var(--text-muted)]">{net.bssid ?? '—'}</td>
                      <td className="px-4 py-2 text-[var(--text-secondary)]">{net.securityType ?? '—'}</td>
                      <td className="px-4 py-2 text-[var(--text-secondary)]">{net.lastJoined ? formatTs(net.lastJoined) : '—'}</td>
                      <td className="px-4 py-2 text-[var(--text-muted)]">{net.joinCount ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
```

**Commit:**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/desktop/src/renderer/pages/IosIntelligence.tsx
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "feat: add IosIntelligence page with Activity Timeline, Location Access, Network Trace tabs"
```

---

## Task 10 — Wire route and nav entry

**Files:**
- Modify: `packages/desktop/src/renderer/App.tsx`
- Modify: `packages/desktop/src/renderer/layouts/Sidebar.tsx`

### App.tsx

**Step 1: Add import** (after the existing `IosScreenTime` import, line ~77):
```typescript
import { IosIntelligence } from './pages/IosIntelligence';
```

**Step 2: Add route** (after the `/ios/screen-time` route, line ~235):
```typescript
<Route path="/ios/intelligence" element={<IosIntelligence />} />
```

### Sidebar.tsx

**Step 3: Add nav entry**

In the iOS Collections section, add as the first item (before Quick Extract or after it):
```typescript
{ label: 'iOS Intelligence', path: '/ios/intelligence', icon: <Brain size={16} />, badge: 'NEW' },
```

Add `Brain` to the lucide-react import at the top of Sidebar.tsx.

**Commit:**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/desktop/src/renderer/App.tsx packages/desktop/src/renderer/layouts/Sidebar.tsx
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "feat: add iOS Intelligence route and sidebar nav entry"
```

---

## Task 11 — Build and deploy

**Step 1: Bump version to 1.0.10**

In `packages/shared/src/constants.ts`, change:
```typescript
export const APP_VERSION = '1.0.9';
```
to:
```typescript
export const APP_VERSION = '1.0.10';
```

Also update `packages/desktop/package.json` version field to `1.0.10`.

**Step 2: Build**

```bash
cd "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics"
pnpm build 2>&1 | tail -20
```

**Step 3: Deploy**

```bash
cd "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics"
./deploy.sh 2>&1 | tail -30
```

**Step 4: Final commit**

```bash
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" add packages/shared/src/constants.ts packages/desktop/package.json
git -C "/Users/rmpgutah/RMPG Foresnics Analysis/rmpg-forensics" commit -m "chore: bump version to 1.0.10"
```

---

## Success Criteria

- [ ] iOS Intelligence page loads at `/ios/intelligence` with 3 tabs
- [ ] Activity Timeline aggregates events from at least 3 source types, sorted newest-first
- [ ] Location Access Trace renders app bundle IDs with auth status color-coded (red=Always, amber=WhenInUse, green=Denied)
- [ ] Network Trace shows WiFi SSIDs with timestamps
- [ ] iOS Backup page shows 5-phase progress bar (segments fill left-to-right)
- [ ] Phase label updates live (e.g. "Transferring files…") and never shows raw idevicebackup2 output
- [ ] Output path banner visible after backup completes
- [ ] `animate-pulse` active on phase label when no new output for >3s
- [ ] `IosLocationHistory.tsx` successfully extracts from iOS 11+ backup (routined DB)
- [ ] `IosQuickExtract.tsx` backup card shows current phase label
- [ ] v1.0.10 deployed successfully
