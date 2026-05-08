import React, { useState, useCallback, useEffect } from 'react';
import {
  Apple,
  Zap,
  CheckCircle,
  XCircle,
  Loader2,
  MessageCircle,
  PhoneCall,
  Contact,
  ImagePlus,
  Globe,
  NotebookPen,
  Voicemail,
  Heart,
  Clock,
  Navigation,
  Eraser,
  FolderTree,
  AppWindow,
  Download,
  Smartphone,
  FolderOpen,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  HardDrive,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FolderPicker, ProgressIndicator } from '../components/common';
import { useIosDevice } from '../hooks/useIosDevice';
import { useBackupStore } from '../store';

// ─── Module definitions ────────────────────────────────────────────────────

interface ExtractModule {
  id: string;
  label: string;
  icon: React.ReactNode;
  channel: string;
  countKey?: string;
  description: string;
}

const MODULES: ExtractModule[] = [
  { id: 'messages',   label: 'Messages',        icon: <MessageCircle size={15} />, channel: IPC_CHANNELS.IOS_MESSAGES_EXTRACT,   countKey: 'messages',  description: 'iMessage & SMS threads' },
  { id: 'calls',      label: 'Call History',     icon: <PhoneCall size={15} />,     channel: IPC_CHANNELS.IOS_CALLS_EXTRACT,      countKey: 'calls',     description: 'Incoming, outgoing & missed' },
  { id: 'contacts',   label: 'Contacts',         icon: <Contact size={15} />,       channel: IPC_CHANNELS.IOS_CONTACTS_EXTRACT,   countKey: 'contacts',  description: 'Address book entries' },
  { id: 'photos',     label: 'Photos & Videos',  icon: <ImagePlus size={15} />,     channel: IPC_CHANNELS.IOS_PHOTOS_EXTRACT,     countKey: 'assets',    description: 'Camera roll assets' },
  { id: 'location',   label: 'Location History', icon: <Navigation size={15} />,    channel: IPC_CHANNELS.IOS_LOCATION_EXTRACT,   countKey: 'total',     description: 'GPS & cell tower records' },
  { id: 'safari',     label: 'Safari History',   icon: <Globe size={15} />,         channel: IPC_CHANNELS.IOS_SAFARI_EXTRACT,     countKey: 'total',     description: 'Browsing history & bookmarks' },
  { id: 'notes',      label: 'Notes',            icon: <NotebookPen size={15} />,   channel: IPC_CHANNELS.IOS_NOTES_EXTRACT,      countKey: 'total',     description: 'Notes app content' },
  { id: 'voicemail',  label: 'Voicemail',        icon: <Voicemail size={15} />,     channel: IPC_CHANNELS.IOS_VOICEMAIL_EXTRACT,  countKey: 'total',     description: 'Voicemail recordings' },
  { id: 'health',     label: 'Health Data',      icon: <Heart size={15} />,         channel: IPC_CHANNELS.IOS_HEALTH_EXTRACT,     countKey: 'total',     description: 'Activity, sleep, biometrics' },
  { id: 'screentime', label: 'Screen Time',      icon: <Clock size={15} />,         channel: IPC_CHANNELS.IOS_SCREENTIME_EXTRACT, countKey: 'total',     description: 'App usage & limits' },
  { id: 'deleted',    label: 'Deleted Data',     icon: <Eraser size={15} />,        channel: IPC_CHANNELS.IOS_DELETED_RECOVER,    countKey: 'total',     description: 'Recoverable deleted records' },
  { id: 'files',      label: 'File System',      icon: <FolderTree size={15} />,    channel: IPC_CHANNELS.IOS_FILE_BROWSE,        countKey: 'total',     description: 'Browse all backup files' },
  { id: 'appdata',    label: 'App Data',         icon: <AppWindow size={15} />,     channel: IPC_CHANNELS.IOS_APP_DATA,           countKey: 'total',     description: 'Third-party app containers' },
];

type ModuleStatus = 'idle' | 'running' | 'done' | 'error';

interface ModuleResult {
  status: ModuleStatus;
  count?: number;
  error?: string;
  data?: unknown;
  percent?: number;
  progressMessage?: string;
}

type Mode = 'device' | 'backup';

// ─── Error parsing ─────────────────────────────────────────────────────────
// mobilebackup2 embeds status in the raw stdout. Extract the key line and
// map known error codes to actionable messages so users don't have to read
// the raw protocol log.
const BACKUP_ERROR_MAP: Record<number, { summary: string; action: string }> = {
  105: {
    summary: 'Not enough disk space at the destination.',
    action:  'Free up space on the target drive, or choose a different output folder with more available storage.',
  },
  3: {
    summary: 'Connection to the device was lost.',
    action:  'Keep the device plugged in during backup. Make sure the screen stays on and the device stays unlocked.',
  },
  6: {
    summary: 'Device is locked or requires passcode entry.',
    action:  'Unlock the device and tap "Trust This Computer" when prompted, then try again.',
  },
  19: {
    summary: 'Device reported an unknown internal error.',
    action:  'Restart the device and try again. If the problem persists, try an unencrypted backup.',
  },
  21: {
    summary: 'Backup password mismatch.',
    action:  'The device has an existing encrypted backup with a different password. Enter the correct password or disable backup encryption on the device in iTunes/Finder.',
  },
};

function parseBackupError(raw: string): { headline: string; action?: string; code?: number; detail: string } {
  // Extract "ErrorCode NNN: message" line if present
  const codeMatch = raw.match(/ErrorCode\s+(\d+):[^\n.]*/i);
  const code = codeMatch ? parseInt(codeMatch[1], 10) : undefined;

  // Extract "Backup Failed (Error Code NNN)" line
  const failMatch = raw.match(/Backup Failed[^\n.]*/i);
  const detail = raw.trim();

  const known = code !== undefined ? BACKUP_ERROR_MAP[code] : undefined;
  if (known) {
    return { headline: known.summary, action: known.action, code, detail };
  }

  // Fall back to the explicit error line or a generic message
  const headline = codeMatch
    ? codeMatch[0].replace(/ErrorCode\s+\d+:\s*/i, '').trim() || failMatch?.[0] || 'Backup failed.'
    : failMatch?.[0] || 'Backup failed.';

  return { headline, code, detail };
}

// ─── Component ─────────────────────────────────────────────────────────────

export const IosQuickExtract: React.FC = () => {
  const { iosDevices } = useIosDevice();

  const [mode, setMode] = useState<Mode>('device');
  const [selectedUdid, setSelectedUdid] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(MODULES.map((m) => m.id)));
  const [results, setResults] = useState<Record<string, ModuleResult>>({});
  const [running, setRunning] = useState(false);
  const { task: backupTask, startBackup, reset: resetBackup } = useBackupStore();
  const [backupPhaseLabel, setBackupPhaseLabel] = useState('');
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  // Auto-select first device
  useEffect(() => {
    if (iosDevices.length > 0 && !selectedUdid) {
      setSelectedUdid(iosDevices[0].udid);
    }
  }, [iosDevices, selectedUdid]);

  // Auto-fill backup path when switching to backup mode
  useEffect(() => {
    if (mode === 'backup' && selectedUdid) {
      const dev = iosDevices.find((d) => d.udid === selectedUdid);
      if (dev?.backupFound && !backupPath) setBackupPath(dev.backupPath);
    }
  }, [mode, selectedUdid, iosDevices, backupPath]);

  // Subscribe to backup progress events to capture the phase label
  useEffect(() => {
    const cleanup = window.api.on(IPC_CHANNELS.IOS_BACKUP_PROGRESS, (data: Record<string, unknown>) => {
      if (typeof data.phaseLabel === 'string') setBackupPhaseLabel(data.phaseLabel);
    });
    return cleanup;
  }, []);

  // Clear phase label when backup is no longer running
  useEffect(() => {
    if (backupTask?.status !== 'running') {
      setBackupPhaseLabel('');
    }
  }, [backupTask?.status]);

  // Subscribe to per-module progress channels while extraction is running
  useEffect(() => {
    if (!running) return;
    const cleanups = MODULES.filter((m) => selected.has(m.id)).map((mod) => {
      const progressChannel = `${mod.channel}-progress`;
      return window.api.on(progressChannel, (data: Record<string, unknown>) => {
        const percent = typeof data.percent === 'number' ? data.percent : undefined;
        const msg = typeof data.message === 'string' ? data.message :
                    typeof data.data === 'string' ? data.data : undefined;
        setResults((prev) => {
          const cur = prev[mod.id];
          if (!cur || cur.status !== 'running') return prev;
          return { ...prev, [mod.id]: { ...cur, percent, progressMessage: msg } };
        });
      });
    });
    return () => cleanups.forEach((fn) => fn());
  }, [running, selected]);

  const toggleModule  = (id: string) => {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(MODULES.map((m) => m.id)));
  const clearAll  = () => setSelected(new Set());

  const setModuleResult = useCallback((id: string, result: ModuleResult) => {
    setResults((prev) => ({ ...prev, [id]: result }));
  }, []);

  const runExtraction = async (bPath: string) => {
    const modulesToRun = MODULES.filter((m) => selected.has(m.id));

    const initial: Record<string, ModuleResult> = {};
    modulesToRun.forEach((m) => { initial[m.id] = { status: 'running' }; });
    setResults(initial);

    await Promise.allSettled(
      modulesToRun.map(async (mod) => {
        try {
          const payload: Record<string, unknown> = { backupDir: bPath };
          if (outputFolder) payload.outputPath = outputFolder;

          const result = await window.api.invoke(mod.channel, payload) as Record<string, unknown>;
          const raw = mod.countKey ? result?.[mod.countKey] : undefined;
          const count = typeof result?.copied === 'number'
            ? result.copied  // prefer "files copied" count for photos
            : Array.isArray(raw) ? raw.length : (typeof raw === 'number' ? raw : undefined);

          setModuleResult(mod.id, {
            status: result?.error ? 'error' : 'done',
            count,
            error: result?.error as string | undefined,
            data: result,
          });
        } catch (err) {
          setModuleResult(mod.id, {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );
  };

  const handleExtract = async () => {
    setRunning(true);
    setResults({});
    setBackupPhaseLabel('');
    resetBackup();

    try {
      if (mode === 'device') {
        if (!outputFolder) { setRunning(false); return; }

        const deviceName = iosDevices.find((d) => d.udid === selectedUdid)?.label ?? selectedUdid;
        // startBackup uses the backup store — progress is tracked globally in AppLayout
        // User can navigate away and the backup continues in the main process
        const backupResult = await startBackup(selectedUdid, deviceName, outputFolder);

        if (!backupResult.success) {
          setRunning(false);
          return;
        }

        const bPath = backupResult.backupPath ?? outputFolder;
        await runExtraction(bPath);

      } else {
        // Existing backup mode — run extraction directly
        await runExtraction(backupPath);
      }
    } finally {
      setRunning(false);
    }
  };

  const handleExportAll = async () => {
    if (!outputFolder) return;
    const doneModules = MODULES.filter((m) => results[m.id]?.status === 'done' && results[m.id]?.data);
    const reportDir = `${outputFolder}/RMPG-Report`;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    // Write per-module CSV + JSON, collect HTML sections
    const sections: string[] = [];
    for (const mod of doneModules) {
      const data = results[mod.id]?.data as Record<string, unknown>;
      if (!data) continue;

      // Find the first array in the result (the records)
      const arrayKey = Object.keys(data).find((k) => Array.isArray(data[k]));
      const rows = arrayKey ? (data[arrayKey] as Record<string, unknown>[]) : [];

      // Write JSON
      await window.api.invoke(IPC_CHANNELS.FILE_WRITE, `${reportDir}/${mod.id}.json`, JSON.stringify(data, null, 2)).catch(() => {});

      // Write CSV if there are rows
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        const csvLines = [
          headers.join(','),
          ...rows.map((row) =>
            headers.map((h) => {
              const val = row[h] == null ? '' : String(row[h]);
              return val.includes(',') || val.includes('"') || val.includes('\n')
                ? `"${val.replace(/"/g, '""')}"`
                : val;
            }).join(',')
          ),
        ];
        await window.api.invoke(IPC_CHANNELS.FILE_WRITE, `${reportDir}/${mod.id}.csv`, csvLines.join('\n')).catch(() => {});
      }

      // Build HTML table section
      const tableRows = rows.slice(0, 500).map((row) =>
        `<tr>${Object.values(row).map((v) => `<td>${v == null ? '' : String(v).replace(/</g, '&lt;')}</td>`).join('')}</tr>`
      ).join('');
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      sections.push(`
        <section id="${mod.id}">
          <h2>${mod.label} <span class="count">${rows.length.toLocaleString()} records</span></h2>
          ${rows.length === 0
            ? '<p class="empty">No records found.</p>'
            : `<div class="table-wrap"><table>
                <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${tableRows}</tbody>
               </table>${rows.length > 500 ? `<p class="note">Showing first 500 of ${rows.length.toLocaleString()} records. See ${mod.id}.json for full data.</p>` : ''}</div>`}
        </section>`);
    }

    // Write master HTML report
    const nav = doneModules.map((m) => `<a href="#${m.id}">${m.label}</a>`).join('');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RMPG Forensics Report — ${ts}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e2e8f0;line-height:1.5}
  header{background:#1a1f2e;padding:20px 32px;border-bottom:1px solid #2d3748}
  header h1{font-size:1.4rem;color:#6495ED}header p{font-size:.85rem;color:#718096;margin-top:4px}
  nav{background:#141924;padding:12px 32px;display:flex;gap:16px;flex-wrap:wrap;border-bottom:1px solid #2d3748;position:sticky;top:0;z-index:10}
  nav a{color:#6495ED;text-decoration:none;font-size:.85rem;padding:4px 10px;border-radius:4px;background:rgba(100,149,237,.1)}
  nav a:hover{background:rgba(100,149,237,.2)}
  main{padding:32px;max-width:1400px;margin:0 auto}
  section{margin-bottom:48px}
  section h2{font-size:1.1rem;color:#e2e8f0;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #2d3748}
  .count{font-size:.75rem;color:#718096;font-weight:400;margin-left:8px}
  .table-wrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:.8rem}
  th{background:#1a1f2e;color:#a0aec0;padding:8px 12px;text-align:left;position:sticky;top:48px;white-space:nowrap}
  td{padding:6px 12px;border-bottom:1px solid #1e2433;color:#e2e8f0;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  tr:hover td{background:#1a1f2e}
  .empty{color:#718096;font-style:italic;padding:16px 0}
  .note{margin-top:8px;font-size:.75rem;color:#718096}
</style>
</head>
<body>
<header>
  <h1>RMPG Forensics Analysis — iOS Extraction Report</h1>
  <p>Generated: ${new Date().toLocaleString()} · ${doneModules.length} modules extracted</p>
</header>
<nav>${nav}</nav>
<main>${sections.join('\n')}</main>
</body>
</html>`;

    await window.api.invoke(IPC_CHANNELS.FILE_WRITE, `${reportDir}/report-${ts}.html`, html).catch(() => {});
  };

  const doneCount    = Object.values(results).filter((r) => r.status === 'done').length;
  const errorCount   = Object.values(results).filter((r) => r.status === 'error').length;
  const totalSelected = selected.size;
  const allDone      = !running && doneCount + errorCount === totalSelected && totalSelected > 0;

  // Overall extraction progress: completed modules + partial credit from in-progress percents
  const runningResults = Object.values(results).filter((r) => r.status === 'running');
  const partialCredit  = runningResults.reduce((sum, r) => sum + (r.percent ?? 0) / 100, 0);
  const overallPercent = totalSelected > 0
    ? Math.min(100, ((doneCount + errorCount + partialCredit) / totalSelected) * 100)
    : 0;
  const currentlyRunning = MODULES.filter((m) => results[m.id]?.status === 'running');
  const activeDevice = iosDevices.find((d) => d.udid === selectedUdid);
  const canStart     = mode === 'device'
    ? (selectedUdid !== '' && outputFolder !== '')
    : backupPath !== '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Quick Extract"
        description="Extract all iOS data in one click — from a connected device or existing backup"
        icon={<Zap size={24} />}
      />

      {/* ── Mode selector ─────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('device')}
            disabled={running}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'device' ? 'bg-[#6495ED] text-white' : 'btn-secondary'
            }`}
          >
            <Smartphone size={14} />
            Live Device
          </button>
          <button
            onClick={() => setMode('backup')}
            disabled={running}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'backup' ? 'bg-[#6495ED] text-white' : 'btn-secondary'
            }`}
          >
            <FolderOpen size={14} />
            Existing Backup
          </button>
        </div>

        {/* Live Device mode */}
        {mode === 'device' && (
          <div className="space-y-3">
            {iosDevices.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 px-4 py-3"
                style={{ background: 'rgba(234,179,8,0.08)' }}>
                <AlertCircle size={16} className="text-yellow-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-yellow-400">No iOS device detected</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Connect an iPhone or iPad via USB and trust this computer on the device.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {iosDevices.map((dev) => (
                  <button
                    key={dev.udid}
                    onClick={() => setSelectedUdid(dev.udid)}
                    disabled={running}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
                    style={{
                      borderColor: selectedUdid === dev.udid ? '#6495ED' : 'var(--border-color)',
                      background: selectedUdid === dev.udid ? 'rgba(100,149,237,0.12)' : 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <Apple size={13} className={selectedUdid === dev.udid ? 'text-[#6495ED]' : ''} />
                    <span className="font-medium">{dev.label}</span>
                    {dev.backupFound && (
                      <span className="text-xs text-green-400">backup exists</span>
                    )}
                  </button>
                ))}
                <button onClick={() => window.api.invoke(IPC_CHANNELS.IOS_LIST_DEVICES)}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
            )}

            <FolderPicker
            role="output"
              label="Save backup & extracted data to"
              value={outputFolder}
              onChange={setOutputFolder}
              disabled={running}
            />

            {backupTask && backupTask.status !== 'idle' && !backupTask.dismissed && (
              <div className="rounded-lg border space-y-2"
                style={{
                  borderColor: backupTask.status === 'error' ? 'rgba(239,68,68,0.3)' : 'var(--border-color)',
                  background: backupTask.status === 'error' ? 'rgba(239,68,68,0.06)' : 'var(--bg-secondary)',
                  padding: '12px',
                }}>

                {/* Status header */}
                <div className="flex items-center gap-2 text-xs font-medium"
                  style={{ color: backupTask.status === 'error' ? '#f87171' : backupTask.status === 'done' ? '#4ade80' : '#6495ED' }}>
                  {backupTask.status === 'running' && <Loader2 size={12} className="animate-spin" />}
                  {backupTask.status === 'done'    && <CheckCircle size={12} />}
                  {backupTask.status === 'error'   && <XCircle size={12} />}
                  <span>
                    {backupTask.status === 'running' && 'Backing up… (you can navigate away — backup continues in the background)'}
                    {backupTask.status === 'done'    && 'Backup complete — extracting data…'}
                    {backupTask.status === 'error'   && (() => {
                      const parsed = parseBackupError(backupTask.error ?? '');
                      return parsed.code !== undefined ? `Error ${parsed.code}: ${parsed.headline}` : parsed.headline;
                    })()}
                  </span>
                </div>

                {/* Parsed error details */}
                {backupTask.status === 'error' && (() => {
                  const parsed = parseBackupError(backupTask.error ?? '');
                  return (
                    <div className="space-y-2">
                      {parsed.action && (
                        <div className="flex items-start gap-2 rounded p-2 text-xs"
                          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          {parsed.code === 105
                            ? <HardDrive size={13} className="text-red-400 mt-0.5 shrink-0" />
                            : <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" />}
                          <span style={{ color: 'var(--text-secondary)' }}>{parsed.action}</span>
                        </div>
                      )}
                      {/* Collapsible raw output */}
                      <button
                        onClick={() => setShowErrorDetail((v) => !v)}
                        className="flex items-center gap-1 text-[11px] hover:underline"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {showErrorDetail ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        {showErrorDetail ? 'Hide' : 'Show'} technical output
                      </button>
                      {showErrorDetail && (
                        <pre className="rounded p-2 text-[10px] leading-4 overflow-x-auto whitespace-pre-wrap break-all"
                          style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', maxHeight: 160 }}>
                          {parsed.detail}
                        </pre>
                      )}
                    </div>
                  );
                })()}

                {backupTask.status === 'running' && (
                  <>
                    <ProgressIndicator
                      percent={backupTask.progress.percent}
                      message={backupTask.progress.message}
                      isRunning
                      showElapsed
                      bytes={backupTask.progress.bytes}
                      totalBytes={backupTask.progress.totalBytes}
                      speed={backupTask.progress.speed}
                      eta={backupTask.progress.eta}
                      filesCount={backupTask.progress.filesCount}
                      totalFiles={backupTask.progress.totalFiles}
                    />
                    {backupPhaseLabel && (
                      <p className="text-xs text-blue-400 mt-1">{backupPhaseLabel}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Existing Backup mode */}
        {mode === 'backup' && (
          <div className="space-y-3">
            {/* Quick-select from known device backups */}
            {iosDevices.filter((d) => d.backupFound).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  Known device backups:
                </p>
                <div className="flex flex-wrap gap-2">
                  {iosDevices.filter((d) => d.backupFound).map((dev) => (
                    <button
                      key={dev.udid}
                      onClick={() => setBackupPath(dev.backupPath)}
                      disabled={running}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
                      style={{
                        borderColor: backupPath === dev.backupPath ? '#6495ED' : 'var(--border-color)',
                        background: backupPath === dev.backupPath ? 'rgba(100,149,237,0.12)' : 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <CheckCircle size={13} className="text-green-400" />
                      <span className="font-medium">{dev.label}</span>
                      {dev.backupDate && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {new Date(dev.backupDate).toLocaleDateString()}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <FolderPicker
            role="backup"
              label="iOS Backup Folder"
              value={backupPath}
              onChange={setBackupPath}
              disabled={running}
            />
            <FolderPicker
            role="output"
              label="Save extracted data to (optional)"
              value={outputFolder}
              onChange={setOutputFolder}
              disabled={running}
            />
          </div>
        )}
      </div>

      {/* ── Module selection ──────────────────────────────────────────── */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Data Types ({selected.size} of {MODULES.length})
          </h3>
          <div className="flex gap-3">
            <button onClick={selectAll} disabled={running} className="text-xs text-[#6495ED] hover:underline">All</button>
            <button onClick={clearAll}  disabled={running} className="text-xs" style={{ color: 'var(--text-muted)' }}>None</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {MODULES.map((mod) => {
            const res = results[mod.id];
            const isSelected = selected.has(mod.id);
            return (
              <button
                key={mod.id}
                onClick={() => toggleModule(mod.id)}
                disabled={running}
                title={mod.description}
                className="relative flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors disabled:opacity-60"
                style={{
                  borderColor: isSelected ? '#6495ED' : 'var(--border-color)',
                  background: isSelected ? 'rgba(100,149,237,0.10)' : 'var(--bg-secondary)',
                }}
              >
                <div className="flex w-full items-center justify-between">
                  <span style={{ color: isSelected ? '#6495ED' : 'var(--text-muted)' }}>
                    {mod.icon}
                  </span>
                  {res?.status === 'running' && <Loader2 size={12} className="animate-spin text-[#6495ED]" />}
                  {res?.status === 'done'    && <CheckCircle size={12} className="text-green-400" />}
                  {res?.status === 'error'   && <XCircle size={12} className="text-red-400" />}
                </div>
                <span className="text-xs font-medium leading-tight"
                  style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {mod.label}
                </span>
                {res?.status === 'running' && (
                  <div className="w-full mt-0.5">
                    <div className="h-0.5 w-full rounded-full bg-[var(--border-color)] overflow-hidden">
                      {(res.percent ?? 0) > 0 ? (
                        <div
                          className="h-full rounded-full bg-[#6495ED] transition-all duration-300"
                          style={{ width: `${res.percent}%` }}
                        />
                      ) : (
                        <div className="h-full w-1/3 rounded-full bg-[#6495ED] animate-pulse" />
                      )}
                    </div>
                    {(res.percent ?? 0) > 0 && (
                      <span className="text-[9px] text-[#6495ED]">{res.percent?.toFixed(0)}%</span>
                    )}
                  </div>
                )}
                {res?.status === 'done' && res.count !== undefined && (
                  <span className="text-[10px] text-green-400">{res.count.toLocaleString()} records</span>
                )}
                {res?.status === 'error' && (
                  <span className="text-[10px] text-red-400 truncate w-full" title={res.error}>
                    {res.error?.slice(0, 28)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleExtract}
          disabled={running || !canStart || selected.size === 0}
          className="btn-primary flex items-center gap-2"
        >
          {running
            ? <Loader2 size={15} className="animate-spin" />
            : <Zap size={15} />}
          {running
            ? `${backupTask?.status === 'running' ? 'Backing up…' : `Extracting… (${doneCount + errorCount}/${totalSelected})`}`
            : mode === 'device'
              ? `Back Up & Extract ${selected.size} Module${selected.size !== 1 ? 's' : ''}`
              : `Extract ${selected.size} Module${selected.size !== 1 ? 's' : ''}`}
        </button>

        {allDone && outputFolder && (
          <button onClick={handleExportAll} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={14} /> Export Report (HTML + CSV)
          </button>
        )}

        {allDone && (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {doneCount > 0  && <span className="text-green-400">{doneCount} succeeded</span>}
            {errorCount > 0 && <span className="text-red-400 ml-2">{errorCount} failed</span>}
          </span>
        )}
      </div>

      {/* ── Overall extraction progress ───────────────────────────────── */}
      {running && Object.keys(results).length > 0 && (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--text-primary)]">
              Overall Progress — {doneCount + errorCount} of {totalSelected} complete
            </span>
            <span className="text-[var(--text-muted)]">{overallPercent.toFixed(0)}%</span>
          </div>

          {/* Overall bar */}
          <div className="h-2 w-full rounded-full bg-[var(--border-color)] overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${overallPercent}%` }}
            />
          </div>

          {/* Currently active modules */}
          {currentlyRunning.length > 0 && (
            <div className="space-y-2">
              {currentlyRunning.map((mod) => {
                const res = results[mod.id];
                const pct = res?.percent ?? 0;
                return (
                  <div key={mod.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                        <Loader2 size={11} className="animate-spin text-[#6495ED]" />
                        {mod.label}
                        {res?.progressMessage && (
                          <span className="text-[var(--text-muted)] truncate max-w-48">
                            — {res.progressMessage}
                          </span>
                        )}
                      </span>
                      <span className="text-[var(--text-muted)]">{pct > 0 ? `${pct.toFixed(0)}%` : '…'}</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-[var(--border-color)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#6495ED] transition-all duration-300"
                        style={{ width: pct > 0 ? `${pct}%` : '100%', opacity: pct > 0 ? 1 : 0.3 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────── */}
      {Object.keys(results).length > 0 && (
        <div className="card !p-0 overflow-hidden">
          <div className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
            style={{ borderColor: 'var(--border-color)', background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
            Extraction Results
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
            {MODULES.filter((m) => results[m.id]).map((mod) => {
              const res = results[mod.id];
              return (
                <div key={mod.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span style={{ color: 'var(--text-muted)' }}>{mod.icon}</span>
                  <span className="flex-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {mod.label}
                  </span>
                  {res.status === 'running' && (
                    <span className="flex items-center gap-1.5 text-xs text-[#6495ED]">
                      <Loader2 size={12} className="animate-spin" />
                      {res.percent != null && res.percent > 0
                        ? `${res.percent.toFixed(0)}%`
                        : 'Extracting…'}
                    </span>
                  )}
                  {res.status === 'done' && (
                    <span className="flex items-center gap-1.5 text-xs text-green-400">
                      <CheckCircle size={12} />
                      {res.count !== undefined ? `${res.count.toLocaleString()} records` : 'Done'}
                    </span>
                  )}
                  {res.status === 'error' && (
                    <span className="flex items-center gap-1.5 text-xs text-red-400 max-w-xs truncate" title={res.error}>
                      <XCircle size={12} /> {res.error}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
