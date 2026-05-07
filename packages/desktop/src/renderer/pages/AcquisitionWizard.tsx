import React, { useEffect, useMemo, useState } from 'react';
import {
  Wand2,
  Smartphone,
  Apple,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  Play,
  ShieldCheck,
  FolderOpen,
  AlertCircle,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FolderPicker, ProgressIndicator } from '../components/common';
import { useCaseStore } from '../store';
import { useDeviceStatus } from '../hooks';

/**
 * AcquisitionWizard — opinionated 3-step flow for the most common
 * forensic intake:
 *   1) Pick the platform & device
 *   2) Open or create a case (if none active)
 *   3) Run the platform-appropriate full backup, then offer quick
 *      extractions of the most useful artefacts.
 *
 * Why a wizard at all: every individual page in the app exposes one
 * surgical tool, but examiners onboarding a fresh device want a single
 * "do the right thing" path. This wizard composes the existing IPC
 * channels (case:create, ios:backup, adb:backup, ios:messages-extract,
 * etc.) without duplicating their logic — so any later fixes to the
 * underlying handlers automatically improve the wizard too.
 *
 * Deliberately NOT covered (yet): per-platform encrypted backups,
 * branching by iOS version, cloud cases. Those live on dedicated pages
 * for now; wizard sticks to the 80% path.
 */

type Platform = 'android' | 'ios';
type Step = 1 | 2 | 3;
type ExtractKey =
  | 'messages' | 'contacts' | 'calls' | 'photos' | 'safari' | 'notes'
  // Deep-extract artefacts: app usage timeline (knowledgeC), calendar,
  // reminders, wallet, cellular data, bluetooth pairings — the high-value
  // forensic stuff commercial tools (Cellebrite, MSAB) commonly extract.
  | 'appUsage' | 'calendar' | 'reminders' | 'wallet' | 'cellular' | 'bluetooth';

interface ExtractOption {
  key: ExtractKey;
  label: string;
  channel: string;
  progressChannel: string;
}

// Quick-extract menu — only the artefacts most case-files want on day one.
// Keys map to existing iOS handlers; the wizard doesn't care about Android-side
// extraction yet because Android workflows are too varied to package into one
// "do it all" button (they go device-by-device in File Extraction / Misc).
const IOS_EXTRACTS: ExtractOption[] = [
  { key: 'messages',  label: 'Messages (iMessage / SMS)', channel: IPC_CHANNELS.IOS_MESSAGES_EXTRACT,        progressChannel: IPC_CHANNELS.IOS_MESSAGES_EXTRACT_PROGRESS },
  { key: 'contacts',  label: 'Contacts',                   channel: IPC_CHANNELS.IOS_CONTACTS_EXTRACT,        progressChannel: IPC_CHANNELS.IOS_CONTACTS_EXTRACT_PROGRESS },
  { key: 'calls',     label: 'Call history',               channel: IPC_CHANNELS.IOS_CALLS_EXTRACT,           progressChannel: IPC_CHANNELS.IOS_CALLS_EXTRACT_PROGRESS },
  { key: 'photos',    label: 'Photos & videos',            channel: IPC_CHANNELS.IOS_PHOTOS_EXTRACT,          progressChannel: IPC_CHANNELS.IOS_PHOTOS_EXTRACT_PROGRESS },
  { key: 'safari',    label: 'Safari history',             channel: IPC_CHANNELS.IOS_SAFARI_EXTRACT,          progressChannel: IPC_CHANNELS.IOS_SAFARI_EXTRACT_PROGRESS },
  { key: 'notes',     label: 'Notes',                      channel: IPC_CHANNELS.IOS_NOTES_EXTRACT,           progressChannel: IPC_CHANNELS.IOS_NOTES_EXTRACT_PROGRESS },
  { key: 'appUsage',  label: 'App usage timeline (knowledgeC)', channel: IPC_CHANNELS.IOS_APP_USAGE_EXTRACT,  progressChannel: IPC_CHANNELS.IOS_APP_USAGE_EXTRACT },
  { key: 'calendar',  label: 'Calendar events',            channel: IPC_CHANNELS.IOS_CALENDAR_EXTRACT,        progressChannel: IPC_CHANNELS.IOS_CALENDAR_EXTRACT },
  { key: 'reminders', label: 'Reminders',                  channel: IPC_CHANNELS.IOS_REMINDERS_EXTRACT,       progressChannel: IPC_CHANNELS.IOS_REMINDERS_EXTRACT },
  { key: 'wallet',    label: 'Wallet passes',              channel: IPC_CHANNELS.IOS_WALLET_EXTRACT,          progressChannel: IPC_CHANNELS.IOS_WALLET_EXTRACT },
  { key: 'cellular',  label: 'Cellular data usage',        channel: IPC_CHANNELS.IOS_CELLULAR_USAGE_EXTRACT,  progressChannel: IPC_CHANNELS.IOS_CELLULAR_USAGE_EXTRACT },
  { key: 'bluetooth', label: 'Bluetooth pairing history',  channel: IPC_CHANNELS.IOS_BLUETOOTH_EXTRACT,       progressChannel: IPC_CHANNELS.IOS_BLUETOOTH_EXTRACT },
];

export const AcquisitionWizard: React.FC = () => {
  const { allDevices, refresh } = useDeviceStatus();
  const caseStore = useCaseStore();
  const caseActive = !!caseStore.casePath;

  const [step, setStep] = useState<Step>(1);
  const [platform, setPlatform] = useState<Platform>('ios');
  const [selectedSerial, setSelectedSerial] = useState<string>('');
  const [examinerName, setExaminerName] = useState('Examiner');
  const [caseNumber, setCaseNumber] = useState('');
  const [caseOutputDir, setCaseOutputDir] = useState('');
  const [backupOutputDir, setBackupOutputDir] = useState('');
  const [encrypted, setEncrypted] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [selectedExtracts, setSelectedExtracts] = useState<Set<ExtractKey>>(
    new Set(['messages', 'contacts', 'calls']),
  );

  const [running, setRunning] = useState<'backup' | 'extract' | null>(null);
  const [progressMsg, setProgressMsg] = useState('');
  // Rich progress payload — populated by the IOS_BACKUP_PROGRESS /
  // ADB_BACKUP_PROGRESS streams. Drives the <ProgressIndicator/> bar so
  // users see percent + ETA + bytes/sec instead of an opaque spinner.
  const [progressDetail, setProgressDetail] = useState<{
    percent: number;
    bytes?: number;
    totalBytes?: number;
    speed?: number;
    eta?: number;
    filesCount?: number;
    totalFiles?: number;
  }>({ percent: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [backupCompletePath, setBackupCompletePath] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Auto-build report toggle — when checked, the wizard runs
  // ACQUISITION_REPORT_BUILD after Quick Extract completes, dropping
  // AcquisitionReport.html / .md alongside the per-artefact JSONs. On by
  // default because the report is the headline forensic output.
  const [autoBuildReport, setAutoBuildReport] = useState(true);
  const [reportPath, setReportPath] = useState<string | null>(null);

  // Manifest path is built lazily during Quick Extract so we don't
  // create empty acquisition folders if the user never runs an extract.
  const acquisitionRootRef = React.useRef<string>('');

  const filteredDevices = useMemo(
    // DeviceInfo uses `type`, not `platform` — the field was renamed in the
    // shared types. Cast access widens because device objects in flight may
    // also carry an extra `platform` from useDeviceStatus's enrichment.
    () => allDevices.filter((d) => (d.type ?? (d as { platform?: string }).platform) === platform),
    [allDevices, platform],
  );

  // Auto-pick the first device of the chosen platform so the user doesn't
  // have to click a single-option dropdown when they only have one phone
  // plugged in. They can still change it.
  useEffect(() => {
    if (filteredDevices.length > 0 && !filteredDevices.some((d) => d.serial === selectedSerial)) {
      setSelectedSerial(filteredDevices[0].serial);
    }
  }, [filteredDevices, selectedSerial]);

  const addLog = (msg: string): void => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Bridge progress events into the local message line. We attach once per
  // running backup/extract; subscriptions are cleaned up the moment we
  // know we're done so progress from one channel can't bleed into another.
  useEffect(() => {
    if (!running) return;
    const ch = running === 'backup'
      ? (platform === 'ios' ? IPC_CHANNELS.IOS_BACKUP_PROGRESS : IPC_CHANNELS.ADB_BACKUP_PROGRESS)
      : null;
    if (!ch) return;
    const unsub = window.api.on(ch, (...args: unknown[]) => {
      // The iOS backup handler emits a rich payload: {percent, message,
      // bytes, totalBytes, speed, eta, filesCount, totalFiles, ...}.
      // The ADB handler emits a smaller subset. Take whatever fields are
      // present and merge them into progressDetail; missing fields just
      // stay at their last known value so the bar doesn't flicker to 0.
      const data = (args[0] ?? {}) as {
        message?: string; data?: string; percent?: number;
        bytes?: number; totalBytes?: number; speed?: number; eta?: number;
        filesCount?: number; totalFiles?: number;
      };
      const msg = data.message ?? data.data ?? '';
      if (msg) setProgressMsg(msg);
      setProgressDetail((prev) => ({
        percent: typeof data.percent === 'number' ? data.percent : prev.percent,
        bytes: data.bytes ?? prev.bytes,
        totalBytes: data.totalBytes ?? prev.totalBytes,
        speed: data.speed ?? prev.speed,
        eta: data.eta ?? prev.eta,
        filesCount: data.filesCount ?? prev.filesCount,
        totalFiles: data.totalFiles ?? prev.totalFiles,
      }));
    });
    return () => unsub();
  }, [running, platform]);

  // Reset the rich progress block whenever a run starts/finishes so a
  // stale ETA from the previous run doesn't bleed into the next.
  useEffect(() => {
    if (running) setProgressDetail({ percent: 0 });
  }, [running]);

  // Step 3 → backup
  const handleBackup = async (): Promise<void> => {
    setError(null);
    if (!backupOutputDir) { setError('Pick a backup output folder.'); return; }

    setRunning('backup');
    addLog(`Starting ${platform.toUpperCase()} backup…`);
    try {
      if (platform === 'ios') {
        const result = await window.api.invoke(IPC_CHANNELS.IOS_BACKUP, {
          outputDir: backupOutputDir,
          encrypted,
          password: encrypted ? backupPassword : undefined,
        }) as { success?: boolean; backupDir?: string; outputPath?: string; error?: string };
        if (result?.error) throw new Error(result.error);
        const final = result?.backupDir ?? result?.outputPath ?? backupOutputDir;
        setBackupCompletePath(final);
        addLog(`Backup complete: ${final}`);
        // Push the resulting backup path into main so per-case audit
        // logging knows which case to write to.
        await window.api.invoke(IPC_CHANNELS.CASE_SET_PATH, caseStore.casePath || null).catch(() => {});
      } else {
        if (!selectedSerial) throw new Error('No device selected.');
        const result = await window.api.invoke(IPC_CHANNELS.ADB_BACKUP, {
          serial: selectedSerial,
          outputPath: backupOutputDir,
        }) as { success?: boolean; outputPath?: string; error?: string };
        if (result?.error) throw new Error(result.error);
        const final = result?.outputPath ?? backupOutputDir;
        setBackupCompletePath(final);
        addLog(`Backup complete: ${final}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      addLog(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(null);
      setProgressMsg('');
    }
  };

  // Step 3 → quick extract pass.
  //
  // For each selected artefact:
  //   1. Call the per-artefact IPC handler (already returns structured data)
  //   2. Write the result to <acquisitionDir>/<artefact>.json with a small
  //      envelope (artefact name, platform, deviceId, extractedAt, data)
  //   3. Append an entry to MANIFEST.json so the Acquisition Report
  //      builder finds it
  // After all extracts complete, optionally build the report.
  //
  // The acquisition folder lives at <caseRoot>/ios/<udid>/ — the renderer
  // builds the structure itself (no new IPC needed) by issuing FILE_WRITE
  // calls; main-side helpers exist for handlers that want to do this
  // themselves later.
  const handleQuickExtract = async (): Promise<void> => {
    if (!backupCompletePath) { setError('Run the backup first.'); return; }
    if (selectedExtracts.size === 0) { setError('Pick at least one artefact to extract.'); return; }

    setRunning('extract');
    setError(null);
    setReportPath(null);

    // Acquisition root: prefer the active case folder; fall back to the
    // backup output dir. Sanitise UDID for FS safety.
    const safeUdid = (selectedSerial || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
    const acquisitionRoot = caseStore.casePath || backupOutputDir;
    const acquisitionDir = `${acquisitionRoot}/ios/${safeUdid}`;
    acquisitionRootRef.current = acquisitionDir;
    addLog(`Writing artefacts to: ${acquisitionDir}`);

    // Initialise the MANIFEST envelope. Subsequent appends rewrite the
    // whole file (small JSON, fine to re-serialise).
    const manifest = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      startedAt: new Date().toISOString(),
      examiner: caseStore.examiner || examinerName || 'Examiner',
      caseNumber: caseStore.caseNumber,
      caseName: caseStore.caseName,
      device: {
        platform: 'ios' as const,
        id: selectedSerial,
        label: filteredDevices.find((d) => d.serial === selectedSerial)?.model,
      },
      artefacts: [] as Array<{ name: string; relativePath: string; bytes?: number; extractedAt: string; notes?: string }>,
    };
    const manifestPath = `${acquisitionDir}/MANIFEST.json`;
    await window.api.invoke(IPC_CHANNELS.FILE_WRITE, manifestPath, JSON.stringify(manifest, null, 2)).catch(() => {});

    const todo = IOS_EXTRACTS.filter((x) => selectedExtracts.has(x.key));
    for (const ext of todo) {
      addLog(`Extracting: ${ext.label}…`);
      setProgressMsg(ext.label);
      try {
        const result = (await window.api.invoke(ext.channel, { backupPath: backupCompletePath })) as Record<string, unknown> & { error?: string; total?: number };
        if (result?.error) throw new Error(result.error as string);

        // Wrap the handler's payload in a stable envelope, drop into
        // <acquisitionDir>/<key>.json. The Acquisition Report builder
        // looks for `data` inside the envelope, so the rendering stays
        // consistent across artefact types.
        const envelope = {
          artefact: ext.key,
          platform: 'ios' as const,
          deviceId: selectedSerial,
          extractedAt: new Date().toISOString(),
          data: result,
        };
        const payload = JSON.stringify(envelope, null, 2);
        const relativePath = `${ext.key}.json`;
        const fullPath = `${acquisitionDir}/${relativePath}`;
        await window.api.invoke(IPC_CHANNELS.FILE_WRITE, fullPath, payload);

        manifest.artefacts.push({
          name: ext.label,
          relativePath,
          bytes: payload.length,
          extractedAt: envelope.extractedAt,
        });
        // Persist the growing manifest after each artefact so a
        // mid-extract crash leaves a usable partial manifest behind.
        await window.api.invoke(IPC_CHANNELS.FILE_WRITE, manifestPath, JSON.stringify(manifest, null, 2)).catch(() => {});

        addLog(`  ✓ ${ext.label}${result?.total != null ? ` (${result.total} records)` : ''} → ${relativePath}`);
      } catch (err) {
        addLog(`  ✗ ${ext.label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    addLog('Quick extract complete.');

    // Auto-build report when toggle is on. Failures here are non-fatal —
    // user can always re-run via Case Timeline → Acquisition Report.
    if (autoBuildReport && manifest.artefacts.length > 0) {
      setProgressMsg('Building acquisition report…');
      try {
        const r = (await window.api.invoke(IPC_CHANNELS.ACQUISITION_REPORT_BUILD, {
          acquisitionDir,
          computeHashes: true,
        })) as { success?: boolean; htmlPath?: string; markdownPath?: string; message?: string };
        if (r?.success && r.htmlPath) {
          setReportPath(r.htmlPath);
          addLog(`Report ready: ${r.htmlPath}`);
        } else {
          addLog(`Report build skipped: ${r?.message ?? 'unknown reason'}`);
        }
      } catch (err) {
        addLog(`Report build failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    setRunning(null);
    setProgressMsg('');
  };

  const handleCreateCase = async (): Promise<void> => {
    setError(null);
    if (!caseOutputDir) { setError('Pick a folder for the new case.'); return; }
    try {
      const c = await window.api.invoke(IPC_CHANNELS.CASE_CREATE, {
        examinerName,
        caseNumber: caseNumber || `CASE-${Date.now().toString(36).toUpperCase()}`,
        description: `Created via Acquisition Wizard for ${platform.toUpperCase()} device`,
        outputDir: caseOutputDir,
      }) as { localPath?: string; name?: string; caseNumber?: string };
      if (c?.localPath) {
        caseStore.setCaseInfo({
          caseName: c.name || '',
          casePath: c.localPath,
          caseNumber: c.caseNumber || caseNumber,
          examiner: examinerName,
          createdAt: new Date().toISOString(),
        });
        addLog(`Case created: ${c.localPath}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const canAdvance = (): boolean => {
    if (step === 1) return platform !== undefined && (filteredDevices.length === 0 || !!selectedSerial);
    if (step === 2) return caseActive;
    return true;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acquisition Wizard"
        description="Guided 3-step flow: connect a device, open a case, back it up, and extract the most-used artefacts in one pass."
        icon={<Wand2 size={24} />}
      />

      {/* Step indicator — always visible so users can see progress and
          jump back to a prior step (forward navigation is gated by
          canAdvance() so they can't skip required setup). */}
      <div className="card flex items-center gap-2">
        {[1, 2, 3].map((n) => (
          <React.Fragment key={n}>
            <button
              onClick={() => setStep(n as Step)}
              disabled={n > step}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                step === n
                  ? 'bg-[#6495ED] text-white'
                  : n < step
                    ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                    : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'
              }`}
            >
              {n < step ? <CheckCircle2 size={14} /> : <span className="font-mono">{n}</span>}
              {n === 1 ? 'Device' : n === 2 ? 'Case' : 'Backup & Extract'}
            </button>
            {n < 3 && <ChevronRight size={14} className="text-[var(--text-muted)]" />}
          </React.Fragment>
        ))}
      </div>

      {error && (
        <div className="card flex items-start gap-2 border-red-500/40 bg-red-500/10">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
          <div className="text-sm text-red-300">{error}</div>
        </div>
      )}

      {/* === Step 1: platform + device =================================== */}
      {step === 1 && (
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Choose platform</h3>
          <div className="grid grid-cols-2 gap-3">
            {([
              { key: 'ios', label: 'iOS', Icon: Apple, blurb: 'iPhone or iPad via libimobiledevice' },
              { key: 'android', label: 'Android', Icon: Smartphone, blurb: 'Any device with USB Debugging' },
            ] as const).map(({ key, label, Icon, blurb }) => (
              <button
                key={key}
                onClick={() => setPlatform(key)}
                className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                  platform === key
                    ? 'border-[#6495ED] bg-[#6495ED]/10'
                    : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <Icon size={28} className={platform === key ? 'text-[#6495ED]' : 'text-[var(--text-muted)]'} />
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">{blurb}</div>
                </div>
              </button>
            ))}
          </div>

          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Device</h3>
          {filteredDevices.length === 0 ? (
            <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-300">
              No {platform.toUpperCase()} device connected.{' '}
              <button onClick={refresh} className="underline">Re-scan</button>
            </div>
          ) : (
            <select
              value={selectedSerial}
              onChange={(e) => setSelectedSerial(e.target.value)}
              className="input-field w-full"
            >
              {filteredDevices.map((d) => (
                <option key={d.serial} value={d.serial}>
                  {d.model || d.serial}{d.manufacturer ? ` — ${d.manufacturer}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* === Step 2: case ================================================= */}
      {step === 2 && (
        <div className="card space-y-4">
          {caseActive ? (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
              <ShieldCheck size={20} className="mt-0.5 shrink-0 text-emerald-400" />
              <div>
                <div className="text-sm font-medium text-[var(--text-primary)]">Case is active</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">{caseStore.casePath}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {caseStore.caseNumber} — examiner: {caseStore.examiner}
                </div>
              </div>
            </div>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Create new case</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Examiner</label>
                  <input value={examinerName} onChange={(e) => setExaminerName(e.target.value)} className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Case number</label>
                  <input value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} placeholder="auto" className="input-field w-full" />
                </div>
              </div>
              <FolderPicker
                role="case"
                label="Case folder location"
                value={caseOutputDir}
                onChange={setCaseOutputDir}
                hint="A new dated subfolder will be created inside this folder."
              />
              <button onClick={handleCreateCase} disabled={!caseOutputDir} className="btn-primary inline-flex items-center gap-2 text-sm">
                <ShieldCheck size={14} /> Create case
              </button>
            </>
          )}
        </div>
      )}

      {/* === Step 3: backup + extract ==================================== */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {platform === 'ios' ? 'iOS backup' : 'ADB backup'}
            </h3>
            <FolderPicker
              role="output"
              label="Backup output folder"
              value={backupOutputDir}
              onChange={setBackupOutputDir}
              disabled={!!running}
              hint="A timestamped subfolder will hold the raw backup artefacts."
            />
            {platform === 'ios' && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={encrypted} onChange={(e) => setEncrypted(e.target.checked)} disabled={!!running} />
                  Encrypted backup (recommended — captures Keychain, Health, call history)
                </label>
                {encrypted && (
                  <input
                    type="password"
                    value={backupPassword}
                    onChange={(e) => setBackupPassword(e.target.value)}
                    placeholder="Backup password"
                    disabled={!!running}
                    className="input-field w-full"
                  />
                )}
              </div>
            )}
            <button
              onClick={handleBackup}
              disabled={!!running || !backupOutputDir}
              className="btn-primary inline-flex items-center gap-2 text-sm"
            >
              {running === 'backup' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running === 'backup' ? 'Backing up…' : 'Run backup'}
            </button>
            {/*
              Rich backup progress. ProgressIndicator already renders
              percent + speed + ETA + elapsed + files-count using the
              fields we forwarded from IOS_BACKUP_PROGRESS, so the
              user sees a real bar instead of a spinner. We deliberately
              don't gate this on `progressMsg` so the bar appears the
              moment the run starts (at 0%/Connecting...) rather than
              waiting for the first stdout line from idevicebackup2.
            */}
            {running === 'backup' && (
              <ProgressIndicator
                percent={progressDetail.percent}
                message={progressMsg || 'Starting backup…'}
                isRunning
                bytes={progressDetail.bytes}
                totalBytes={progressDetail.totalBytes}
                speed={progressDetail.speed}
                eta={progressDetail.eta}
                filesCount={progressDetail.filesCount}
                totalFiles={progressDetail.totalFiles}
              />
            )}
          </div>

          {/* Quick extract — only for iOS for now (Android extraction is
              spread across many handlers and doesn't fit a single button). */}
          {platform === 'ios' && backupCompletePath && (
            <div className="card space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                <div>
                  Backup landed at <span className="font-mono text-xs">{backupCompletePath}</span>
                </div>
              </div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Quick extract artefacts</h3>
              <div className="grid grid-cols-2 gap-2">
                {IOS_EXTRACTS.map((ext) => {
                  const checked = selectedExtracts.has(ext.key);
                  return (
                    <label key={ext.key} className={`flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer ${checked ? 'border-[#6495ED] bg-[#6495ED]/10' : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedExtracts((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(ext.key);
                            else next.delete(ext.key);
                            return next;
                          });
                        }}
                        disabled={!!running}
                      />
                      <span className="text-[var(--text-primary)]">{ext.label}</span>
                    </label>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={autoBuildReport}
                  onChange={(e) => setAutoBuildReport(e.target.checked)}
                  disabled={!!running}
                />
                Build acquisition report (HTML + Markdown) when extraction finishes
              </label>
              <button
                onClick={handleQuickExtract}
                disabled={!!running || selectedExtracts.size === 0}
                className="btn-primary inline-flex items-center gap-2 text-sm"
              >
                {running === 'extract' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {running === 'extract' ? 'Extracting…' : `Extract ${selectedExtracts.size} artefact(s)`}
              </button>
              {!!progressMsg && running === 'extract' && (
                <div className="text-xs text-[var(--text-muted)]">Now: {progressMsg}</div>
              )}
              {reportPath && (
                <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 size={14} />
                  <span className="flex-1">Acquisition report ready</span>
                  <button
                    onClick={() => window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, { action: 'open-path', path: reportPath }).catch(() => {})}
                    className="rounded border border-emerald-400/40 px-2 py-0.5 hover:bg-emerald-500/20"
                  >
                    Open report
                  </button>
                </div>
              )}
            </div>
          )}

          {logs.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Wizard log</h3>
              <pre className="max-h-[240px] overflow-auto rounded bg-[var(--bg-secondary)] p-3 text-[11px] leading-relaxed text-[var(--text-muted)] whitespace-pre-wrap">
                {logs.join('\n')}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Bottom nav — Back/Next. Forward gated by canAdvance(); Back is
          always free so users can edit a previous step's selection. */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
          disabled={step === 1 || !!running}
          className="btn-secondary inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft size={14} /> Back
        </button>
        <button
          onClick={() => setStep((s) => (s < 3 ? ((s + 1) as Step) : s))}
          disabled={step === 3 || !canAdvance() || !!running}
          className="btn-primary inline-flex items-center gap-1 text-sm"
          title={!canAdvance() ? 'Complete this step first' : undefined}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>

      {step === 3 && backupCompletePath && (
        <div className="card flex items-center justify-between">
          <div className="text-sm text-[var(--text-secondary)]">All done. Open the case folder to inspect results.</div>
          <button
            onClick={() => window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, { action: 'open-path', path: caseStore.casePath || backupCompletePath })}
            className="btn-secondary inline-flex items-center gap-1 text-sm"
          >
            <FolderOpen size={14} /> Open
          </button>
        </div>
      )}
    </div>
  );
};
