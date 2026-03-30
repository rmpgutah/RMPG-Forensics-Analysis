import React, { useState, useEffect } from 'react';
import { MonitorSmartphone, Play, Square, Loader2, RefreshCw, Wifi } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, DeviceSelector } from '../components/common';
import { useDeviceStatus } from '../hooks';

type MirrorStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

interface MirrorConfig {
  maxSize: string;
  bitRate: string;
  maxFps: string;
  borderless: boolean;
  alwaysOnTop: boolean;
  turnScreenOff: boolean;
}

const DEFAULT_CONFIG: MirrorConfig = {
  maxSize: '1024',
  bitRate: '8',
  maxFps: '60',
  borderless: false,
  alwaysOnTop: false,
  turnScreenOff: false,
};

export const DeviceMirror: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const [status, setStatus] = useState<MirrorStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<MirrorConfig>(DEFAULT_CONFIG);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  useEffect(() => {
    const checkStatus = async () => {
      if (!selectedDevice) return;
      try {
        const result = await window.api.invoke(IPC_CHANNELS.DEVICE_MIRROR_STATUS, {
          serial: selectedDevice.serial,
        }) as { running: boolean };
        if (result?.running) setStatus('running');
      } catch {
        // Mirror not running
      }
    };
    checkStatus();
  }, [selectedDevice]);

  const handleStart = async () => {
    if (!selectedDevice) return;
    setStatus('starting');
    setError(null);
    addLog(`Starting scrcpy mirror for ${selectedDevice.serial}...`);
    try {
      await window.api.invoke(IPC_CHANNELS.DEVICE_MIRROR_START, {
        serial: selectedDevice.serial,
        maxSize: parseInt(config.maxSize) || 1024,
        bitRate: (parseInt(config.bitRate) || 8) * 1_000_000,
        maxFps: parseInt(config.maxFps) || 60,
        borderless: config.borderless,
        alwaysOnTop: config.alwaysOnTop,
        turnScreenOff: config.turnScreenOff,
      });
      setStatus('running');
      addLog('Mirror started successfully.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      addLog(`Error: ${msg}`);
    }
  };

  const handleStop = async () => {
    if (!selectedDevice) return;
    setStatus('stopping');
    addLog('Stopping scrcpy mirror...');
    try {
      await window.api.invoke(IPC_CHANNELS.DEVICE_MIRROR_STOP, {
        serial: selectedDevice.serial,
      });
      setStatus('idle');
      addLog('Mirror stopped.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      addLog(`Error stopping: ${msg}`);
    }
  };

  const isRunning = status === 'running';
  const isBusy = status === 'starting' || status === 'stopping';

  const statusColors: Record<MirrorStatus, string> = {
    idle: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]',
    starting: 'bg-yellow-100 text-yellow-700',
    running: 'bg-green-100 text-green-700',
    stopping: 'bg-yellow-100 text-yellow-700',
    error: 'bg-red-100 text-red-700',
  };

  const statusLabels: Record<MirrorStatus, string> = {
    idle: 'Not Running',
    starting: 'Starting...',
    running: 'Mirroring Active',
    stopping: 'Stopping...',
    error: 'Error',
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Mirror"
        description="Mirror an Android device screen using scrcpy"
        icon={<MonitorSmartphone size={24} />}
      />

      <div className="grid grid-cols-3 gap-6">
        {/* Left column - Device & Controls */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Device</h3>
            <DeviceSelector
              devices={allDevices}
              selected={selectedDevice}
              onSelect={selectDevice}
              onRefresh={refresh}
              filter="android"
              disabled={isBusy || isRunning}
            />
          </div>

          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Mirror Status</h3>
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${statusColors[status]}`}>
              {status === 'running' && <Wifi size={12} className="animate-pulse" />}
              {isBusy && <Loader2 size={12} className="animate-spin" />}
              {statusLabels[status]}
            </div>

            {error && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {error}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleStart}
              disabled={!selectedDevice || isBusy || isRunning}
              className="btn-primary flex flex-1 items-center justify-center gap-2 text-sm"
            >
              {status === 'starting' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              Start Mirror
            </button>

            <button
              onClick={handleStop}
              disabled={!isRunning || isBusy}
              className="btn-danger flex flex-1 items-center justify-center gap-2 text-sm"
            >
              {status === 'stopping' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Square size={16} />
              )}
              Stop Mirror
            </button>
          </div>
        </div>

        {/* Middle column - Configuration */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Scrcpy Configuration</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Max Resolution (px)</label>
                <input
                  type="number"
                  value={config.maxSize}
                  onChange={(e) => setConfig({ ...config, maxSize: e.target.value })}
                  disabled={isRunning || isBusy}
                  className="input-field text-sm"
                  placeholder="1024"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Bit Rate (Mbps)</label>
                <input
                  type="number"
                  value={config.bitRate}
                  onChange={(e) => setConfig({ ...config, bitRate: e.target.value })}
                  disabled={isRunning || isBusy}
                  className="input-field text-sm"
                  placeholder="8"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Max FPS</label>
                <input
                  type="number"
                  value={config.maxFps}
                  onChange={(e) => setConfig({ ...config, maxFps: e.target.value })}
                  disabled={isRunning || isBusy}
                  className="input-field text-sm"
                  placeholder="60"
                />
              </div>

              <div className="space-y-2 pt-2">
                {[
                  { key: 'borderless' as const, label: 'Borderless Window' },
                  { key: 'alwaysOnTop' as const, label: 'Always on Top' },
                  { key: 'turnScreenOff' as const, label: 'Turn Screen Off' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config[key]}
                      onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}
                      disabled={isRunning || isBusy}
                      className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right column - Log output */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Activity Log</h3>
              <button
                onClick={() => setLogs([])}
                className="btn-ghost flex items-center gap-1 px-2 py-1 text-xs"
              >
                <RefreshCw size={12} />
                Clear
              </button>
            </div>
            <div className="h-[360px] overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-hover)] p-3 font-mono text-xs text-[var(--text-secondary)]">
              {logs.length === 0 ? (
                <p className="text-[var(--text-muted)]">No activity yet. Start a mirror session to see logs.</p>
              ) : (
                logs.map((line, i) => (
                  <div key={i} className="py-0.5">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
