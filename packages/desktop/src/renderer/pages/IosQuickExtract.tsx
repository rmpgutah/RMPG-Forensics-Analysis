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
          const count = Array.isArray(raw) ? raw.length : (typeof raw === 'number' ? raw : undefined);

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
    for (const mod of doneModules) {
      try {
        const json = JSON.stringify(results[mod.id]?.data, null, 2);
        await window.api.invoke(IPC_CHANNELS.FILE_WRITE, `${outputFolder}/${mod.id}.json`, json);
      } catch { /* continue */ }
    }
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
              label="Save backup & extracted data to"
              value={outputFolder}
              onChange={setOutputFolder}
              disabled={running}
            />

            {backupTask && backupTask.status !== 'idle' && !backupTask.dismissed && (
              <div className="rounded-lg border p-3 space-y-1"
                style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
                <div className="flex items-center gap-2 text-xs font-medium mb-2"
                  style={{ color: backupTask.status === 'error' ? '#f87171' : backupTask.status === 'done' ? '#4ade80' : '#6495ED' }}>
                  {backupTask.status === 'running' && <Loader2 size={12} className="animate-spin" />}
                  {backupTask.status === 'done'    && <CheckCircle size={12} />}
                  {backupTask.status === 'error'   && <XCircle size={12} />}
                  <span>
                    {backupTask.status === 'running' && 'Creating backup (navigating away is safe — backup continues in background)'}
                    {backupTask.status === 'done'    && 'Backup complete — extracting data…'}
                    {backupTask.status === 'error'   && `Backup error: ${backupTask.error}`}
                  </span>
                </div>
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
              label="iOS Backup Folder"
              value={backupPath}
              onChange={setBackupPath}
              disabled={running}
            />
            <FolderPicker
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
            <Download size={14} /> Export All as JSON
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
