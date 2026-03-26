import React, { useState } from 'react';
import { Apple, Play, Loader2, Info } from 'lucide-react';
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
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
              <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 cursor-pointer hover:bg-slate-750">
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
                  <label className="block text-sm font-medium text-slate-300">
                    Backup Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter backup password..."
                    disabled={process.isRunning}
                    className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
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
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <h4 className="mb-3 text-sm font-medium text-white">Device Information</h4>
                <div className="max-h-[300px] space-y-1 overflow-y-auto">
                  {Object.entries(deviceInfo).map(([key, value]) => (
                    <div key={key} className="flex gap-2 py-1 text-xs">
                      <span className="shrink-0 font-medium text-slate-400 w-40 truncate">
                        {key}
                      </span>
                      <span className="text-slate-300 break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(process.isRunning || process.progress.percent > 0) && (
              <ProgressIndicator
                percent={process.progress.percent}
                message={process.progress.message}
                isRunning={process.isRunning}
              />
            )}
          </div>
        </div>

        <LogConsole logs={process.logs} onClear={process.clearLogs} />
      </div>
    </PlatformGuard>
  );
};
