import React, { useState, useEffect } from 'react';
import {
  ArrowDownCircle,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
  Smartphone,
  Shield,
  Info,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, DeviceSelector } from '../components/common';
import { useDeviceStatus } from '../hooks';

interface SupportedApp {
  id: string;
  name: string;
  packageName: string;
  category: string;
  minAndroid: number;
}

type DowngradeStatus = 'idle' | 'running' | 'success' | 'error';

interface ProgressInfo {
  app: string;
  step: string;
  percent: number;
}

const SUPPORTED_APPS: SupportedApp[] = [
  { id: 'whatsapp', name: 'WhatsApp', packageName: 'com.whatsapp', category: 'Messaging', minAndroid: 5 },
  { id: 'whatsapp_business', name: 'WhatsApp Business', packageName: 'com.whatsapp.w4b', category: 'Messaging', minAndroid: 5 },
  { id: 'telegram', name: 'Telegram', packageName: 'org.telegram.messenger', category: 'Messaging', minAndroid: 6 },
  { id: 'signal', name: 'Signal', packageName: 'org.thoughtcrime.securesms', category: 'Messaging', minAndroid: 5 },
  { id: 'facebook_messenger', name: 'Facebook Messenger', packageName: 'com.facebook.orca', category: 'Messaging', minAndroid: 5 },
  { id: 'instagram', name: 'Instagram', packageName: 'com.instagram.android', category: 'Social', minAndroid: 5 },
  { id: 'facebook', name: 'Facebook', packageName: 'com.facebook.katana', category: 'Social', minAndroid: 5 },
  { id: 'twitter', name: 'X (Twitter)', packageName: 'com.twitter.android', category: 'Social', minAndroid: 5 },
  { id: 'tiktok', name: 'TikTok', packageName: 'com.zhiliaoapp.musically', category: 'Social', minAndroid: 5 },
  { id: 'snapchat', name: 'Snapchat', packageName: 'com.snapchat.android', category: 'Social', minAndroid: 5 },
  { id: 'discord', name: 'Discord', packageName: 'com.discord', category: 'Messaging', minAndroid: 5 },
  { id: 'wechat', name: 'WeChat', packageName: 'com.tencent.mm', category: 'Messaging', minAndroid: 5 },
  { id: 'line', name: 'LINE', packageName: 'jp.naver.line.android', category: 'Messaging', minAndroid: 5 },
  { id: 'viber', name: 'Viber', packageName: 'com.viber.voip', category: 'Messaging', minAndroid: 5 },
  { id: 'kik', name: 'Kik Messenger', packageName: 'kik.android', category: 'Messaging', minAndroid: 5 },
  { id: 'threema', name: 'Threema', packageName: 'ch.threema.app', category: 'Messaging', minAndroid: 5 },
  { id: 'skype', name: 'Skype', packageName: 'com.skype.raider', category: 'Messaging', minAndroid: 6 },
  { id: 'imo', name: 'imo', packageName: 'com.imo.android.imoim', category: 'Messaging', minAndroid: 5 },
];

const ANDROID_VERSIONS = [
  { value: 12, label: 'Android 12 (API 31)' },
  { value: 13, label: 'Android 13 (API 33)' },
  { value: 14, label: 'Android 14 (API 34)' },
  { value: 15, label: 'Android 15 (API 35)' },
  { value: 16, label: 'Android 16 (API 36)' },
];

const CATEGORIES = ['All', ...Array.from(new Set(SUPPORTED_APPS.map((a) => a.category)))];

export const ApkDowngrade: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [androidVersion, setAndroidVersion] = useState(14);
  const [status, setStatus] = useState<DowngradeStatus>('idle');
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [overallPercent, setOverallPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [searchFilter, setSearchFilter] = useState('');

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  useEffect(() => {
    const cleanup = window.api.on?.(IPC_CHANNELS.APK_DOWNGRADE_PROGRESS, (_: unknown, data: ProgressInfo & { overall: number; log?: string }) => {
      setProgress({ app: data.app, step: data.step, percent: data.percent });
      setOverallPercent(data.overall ?? 0);
      if (data.log) addLog(data.log);
    });
    return () => { cleanup?.(); };
  }, []);

  const toggleApp = (id: string) => {
    setSelectedApps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const visible = filteredApps.map((a) => a.id);
    setSelectedApps(new Set(visible));
  };

  const deselectAll = () => {
    setSelectedApps(new Set());
  };

  const handleStartDowngrade = async () => {
    if (!selectedDevice || selectedApps.size === 0) return;
    setStatus('running');
    setError(null);
    setOverallPercent(0);
    setProgress(null);
    setLogs([]);

    const apps = SUPPORTED_APPS.filter((a) => selectedApps.has(a.id));
    addLog(`Starting APK downgrade for ${apps.length} app(s)...`);
    addLog(`Target Android version: ${androidVersion}`);
    addLog(`Device: ${selectedDevice.serial}`);

    try {
      await window.api.invoke(IPC_CHANNELS.APK_DOWNGRADE, {
        serial: selectedDevice.serial,
        apps: apps.map((a) => ({
          id: a.id,
          packageName: a.packageName,
          name: a.name,
        })),
        androidVersion,
      });
      setStatus('success');
      setOverallPercent(100);
      addLog('All APK downgrades completed successfully.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      addLog(`Error: ${msg}`);
    }
  };

  const filteredApps = SUPPORTED_APPS.filter((app) => {
    const matchCategory = categoryFilter === 'All' || app.category === categoryFilter;
    const matchSearch =
      !searchFilter ||
      app.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      app.packageName.toLowerCase().includes(searchFilter.toLowerCase());
    return matchCategory && matchSearch;
  });

  const isRunning = status === 'running';

  return (
    <div className="space-y-6">
      <PageHeader
        title="APK Downgrade"
        description="Downgrade app versions for forensic data extraction (AvillaForensics method)"
        icon={<ArrowDownCircle size={24} />}
      />

      {/* Warning banner */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
        <div>
          <h4 className="text-sm font-semibold text-amber-800">USB Debugging Required</h4>
          <p className="mt-1 text-xs text-amber-700 leading-relaxed">
            This feature requires USB Debugging enabled on the target device. The downgrade process
            will uninstall the current app version, install an older version that allows ADB backup,
            extract the data, then restore the original version. <strong>Do not disconnect the device
            during this process.</strong> Ensure the device has sufficient battery life before starting.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* Sidebar - Device & Config */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Device</h3>
            <DeviceSelector
              devices={allDevices}
              selected={selectedDevice}
              onSelect={selectDevice}
              onRefresh={refresh}
              filter="android"
              disabled={isRunning}
            />
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Android Version</h3>
            <select
              value={androidVersion}
              onChange={(e) => setAndroidVersion(Number(e.target.value))}
              disabled={isRunning}
              className="input-field text-sm"
            >
              {ANDROID_VERSIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Select the Android version running on the target device.
            </p>
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Selection</h3>
            <div className="flex gap-2">
              <button onClick={selectAll} disabled={isRunning} className="btn-ghost flex-1 text-xs !px-2 !py-1">
                Select All
              </button>
              <button onClick={deselectAll} disabled={isRunning} className="btn-ghost flex-1 text-xs !px-2 !py-1">
                Deselect All
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {selectedApps.size} of {SUPPORTED_APPS.length} apps selected
            </p>
          </div>

          <button
            onClick={handleStartDowngrade}
            disabled={isRunning || !selectedDevice || selectedApps.size === 0}
            className="btn-primary flex w-full items-center justify-center gap-2 text-sm"
          >
            {isRunning ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ArrowDownCircle size={16} />
            )}
            {isRunning ? 'Downgrading...' : 'Start Downgrade'}
          </button>

          {/* Status indicator */}
          {status !== 'idle' && (
            <div
              className={`rounded-lg border p-3 ${
                status === 'running'
                  ? 'border-blue-200 bg-blue-50'
                  : status === 'success'
                  ? 'border-green-200 bg-green-50'
                  : 'border-red-200 bg-red-50'
              }`}
            >
              <div className="flex items-center gap-2">
                {status === 'running' && <Loader2 size={14} className="animate-spin text-[#6495ED]" />}
                {status === 'success' && <CheckCircle2 size={14} className="text-green-600" />}
                {status === 'error' && <XCircle size={14} className="text-red-600" />}
                <span
                  className={`text-xs font-medium ${
                    status === 'running'
                      ? 'text-[#6495ED]'
                      : status === 'success'
                      ? 'text-green-700'
                      : 'text-red-700'
                  }`}
                >
                  {status === 'running'
                    ? `Processing: ${progress?.app ?? '...'}`
                    : status === 'success'
                    ? 'Downgrade Complete'
                    : 'Downgrade Failed'}
                </span>
              </div>
              {status === 'running' && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
                    <span>{progress?.step ?? 'Preparing...'}</span>
                    <span>{overallPercent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-hover)]">
                    <div
                      className="h-full rounded-full bg-[#6495ED] transition-all duration-300"
                      style={{ width: `${overallPercent}%` }}
                    />
                  </div>
                </div>
              )}
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>
          )}
        </div>

        {/* App list */}
        <div className="col-span-2 space-y-4">
          <div className="card !p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-hover)] p-0.5">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      categoryFilter === cat
                        ? 'bg-[#6495ED] text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search apps..."
                className="input-field flex-1 text-sm"
              />
            </div>

            <div className="max-h-[480px] overflow-y-auto space-y-2">
              {filteredApps.map((app) => {
                const isSelected = selectedApps.has(app.id);
                return (
                  <label
                    key={app.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-[#6495ED] bg-blue-50 shadow-sm'
                        : 'border-[var(--border-color)] hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
                    } ${isRunning ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleApp(app.id)}
                      disabled={isRunning}
                      className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
                    />
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-primary)] text-[#6495ED]">
                      <Smartphone size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">{app.name}</span>
                        <span className="badge badge-info">{app.category}</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] font-mono truncate">{app.packageName}</p>
                    </div>
                    {isSelected && (
                      <CheckCircle2 size={16} className="shrink-0 text-[#6495ED]" />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Log output */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Process Log</h3>
            <div className="h-[360px] overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-hover)] p-3 font-mono text-xs text-[var(--text-secondary)]">
              {logs.length === 0 ? (
                <p className="text-[var(--text-muted)]">Waiting to start...</p>
              ) : (
                logs.map((line, i) => (
                  <div key={i} className="py-0.5 break-words">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <div className="flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0 text-[#6495ED]" />
              <div className="text-xs text-[var(--text-muted)] leading-relaxed">
                <p className="font-medium text-[var(--text-primary)] mb-1">How It Works</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Backs up current app data</li>
                  <li>Uninstalls the current version</li>
                  <li>Installs an older, backup-compatible version</li>
                  <li>Extracts app data via ADB backup</li>
                  <li>Reinstalls the original version</li>
                  <li>Restores original app data</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-start gap-2">
              <Shield size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="text-xs text-[var(--text-muted)] leading-relaxed">
                <p className="font-medium text-[var(--text-primary)] mb-1">Important Notes</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Requires Android 12 or higher</li>
                  <li>USB debugging must be enabled</li>
                  <li>Device must remain connected</li>
                  <li>Process may take 5-15 min per app</li>
                  <li>Ensure 50%+ battery before starting</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
