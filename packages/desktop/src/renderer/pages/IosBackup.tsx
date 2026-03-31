import React, { useState, useEffect } from 'react';
import { Apple, Play, Loader2, Info, CheckCircle2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  ProgressIndicator,
  FolderPicker,
  DeviceSelector,
  PlatformGuard,
} from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

interface DeviceInfoResult {
  [key: string]: string;
}

export const IosBackup: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.IOS_BACKUP,
    progressChannel: IPC_CHANNELS.IOS_BACKUP_PROGRESS,
  });

  const [outputFolder, setOutputFolder] = useState('');
  const [encrypted, setEncrypted] = useState(false);
  const [password, setPassword] = useState('');
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfoResult | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [phase, setPhase] = useState(1);
  const [phaseLabel, setPhaseLabel] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [lastProgressTime, setLastProgressTime] = useState(0);
  const [isStalled, setIsStalled] = useState(false);

  useEffect(() => {
    const cleanup = window.api.on(IPC_CHANNELS.IOS_BACKUP_PROGRESS, (data: Record<string, unknown>) => {
      if (typeof data.phase === 'number') setPhase(data.phase as number);
      if (typeof data.phaseLabel === 'string') setPhaseLabel(data.phaseLabel as string);
      if (typeof data.outputPath === 'string' && data.outputPath) setOutputPath(data.outputPath as string);
      setLastProgressTime(Date.now());
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!process.isRunning) {
      setIsStalled(false);
      return;
    }
    const interval = setInterval(() => {
      setIsStalled(Date.now() - lastProgressTime > 3000);
    }, 1000);
    return () => clearInterval(interval);
  }, [process.isRunning, lastProgressTime]);

  const handleGetInfo = async () => {
    if (!selectedDevice) return;
    setLoadingInfo(true);
    setDeviceInfo(null);
    try {
      const result = (await window.api.invoke(
        IPC_CHANNELS.IOS_GET_INFO,
        { udid: selectedDevice.serial }
      )) as DeviceInfoResult;
      setDeviceInfo(result);
    } catch {
      // Error handled by logs
    } finally {
      setLoadingInfo(false);
    }
  };

  const handleStartBackup = async () => {
    if (!selectedDevice || !outputFolder) return;
    setPhase(1);
    setPhaseLabel('Connecting to device…');
    setOutputPath('');
    setLastProgressTime(Date.now());
    setIsStalled(false);
    await process.start({
      udid: selectedDevice.serial,
      outputPath: outputFolder,
      encrypted,
      password: encrypted ? password : undefined,
    });
  };

  return (
    <PlatformGuard requiredTools={['idevicebackup2']}>
      <div className="space-y-6">
        <PageHeader
          title="iOS Backup"
          description="Create forensic backups of iOS devices using libimobiledevice"
          icon={<Apple size={24} />}
        />

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <DeviceSelector
              devices={allDevices}
              selected={selectedDevice}
              onSelect={selectDevice}
              onRefresh={refresh}
              filter="ios"
              disabled={process.isRunning}
            />

            <button
              onClick={handleGetInfo}
              disabled={loadingInfo || !selectedDevice || process.isRunning}
              className="btn-secondary flex w-full items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingInfo ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Info size={14} />
              )}
              {loadingInfo ? 'Fetching Info...' : 'Get Device Info'}
            </button>

            <FolderPicker
              label="Backup Output Folder"
              value={outputFolder}
              onChange={setOutputFolder}
              disabled={process.isRunning}
            />

            <div className="space-y-3">
              <label className="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-secondary)]">
                <input
                  type="checkbox"
                  checked={encrypted}
                  onChange={(e) => setEncrypted(e.target.checked)}
                  disabled={process.isRunning}
                  className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
                />
                Encrypted Backup
              </label>

              {encrypted && (
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-[var(--text-primary)]">
                    Backup Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter backup password..."
                    disabled={process.isRunning}
                    className="input-field w-full"
                  />
                </div>
              )}
            </div>

            <button
              onClick={handleStartBackup}
              disabled={
                process.isRunning ||
                !selectedDevice ||
                !outputFolder ||
                (encrypted && !password)
              }
              className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              {process.isRunning ? 'Backup in Progress...' : 'Start Backup'}
            </button>
          </div>

          <div className="space-y-4">
            {/* Device info key-value display */}
            {deviceInfo && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                <h4 className="mb-3 text-sm font-medium text-[var(--text-primary)]">Device Information</h4>
                <div className="max-h-[300px] space-y-1 overflow-y-auto">
                  {Object.entries(deviceInfo).map(([key, value]) => (
                    <div key={key} className="flex gap-2 py-1 text-xs">
                      <span className="shrink-0 font-medium text-[var(--text-secondary)] w-40 truncate">
                        {key}
                      </span>
                      <span className="text-[var(--text-primary)] break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(process.isRunning || process.progress.percent > 0) && (
              <div className="space-y-4">
                {/* Phase stepper + label */}
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className={`text-sm font-medium ${isStalled && process.isRunning ? 'animate-pulse text-amber-400' : 'text-[var(--text-primary)]'}`}>
                      {phaseLabel || process.progress.message || 'Starting…'}
                    </span>
                    {process.isRunning && (
                      <span className="text-xs text-[var(--text-muted)]">Phase {phase} / 5</span>
                    )}
                  </div>

                  {/* 5-segment progress bar */}
                  <div className="mb-3 flex gap-1">
                    {[1, 2, 3, 4, 5].map((p) => (
                      <div
                        key={p}
                        className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                          p < phase
                            ? 'bg-green-500'
                            : p === phase
                            ? process.isRunning
                              ? 'bg-blue-500'
                              : 'bg-green-500'
                            : 'bg-[var(--border-color)]'
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
                    <p className="mb-1 text-xs font-semibold text-green-400">Backup saved to:</p>
                    <p className="break-all font-mono text-xs text-[var(--text-primary)]">{outputPath}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <LogConsole logs={process.logs} onClear={process.clearLogs} />
      </div>
    </PlatformGuard>
  );
};
