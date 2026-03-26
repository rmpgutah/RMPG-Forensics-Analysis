import React, { useState } from 'react';
import { HardDrive, Play, Hash } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, ProgressIndicator, FolderPicker, DeviceSelector } from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

export const AdbBackup: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({ channel: IPC_CHANNELS.ADB_BACKUP, progressChannel: IPC_CHANNELS.ADB_BACKUP_PROGRESS });

  const [outputFolder, setOutputFolder] = useState('');
  const [options, setOptions] = useState({
    includeApks: true,
    includeObb: false,
    includeShared: true,
    includeSystem: false,
  });
  const [hashes, setHashes] = useState<{ md5: string; sha256: string } | null>(null);

  const toggleOption = (key: keyof typeof options) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStart = async () => {
    if (!selectedDevice || !outputFolder) return;
    setHashes(null);
    await process.start({
      serial: selectedDevice.serial,
      outputPath: outputFolder,
      ...options,
    });
    // After backup, compute hashes
    try {
      const hashResult = (await window.api.invoke(IPC_CHANNELS.HASH_COMPUTE_FILE, {
        filePath: `${outputFolder}/backup.ab`,
        algorithms: ['md5', 'sha256'],
      })) as { md5: string; sha256: string };
      setHashes(hashResult);
    } catch {
      // Hash computation may fail if no file produced
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="ADB Backup"
        description="Create a full Android device backup via ADB"
        icon={<HardDrive size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            filter="android"
            disabled={process.isRunning}
          />

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={process.isRunning}
          />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">Backup Options</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'includeApks' as const, label: 'Include APKs' },
                { key: 'includeObb' as const, label: 'Include OBB data' },
                { key: 'includeShared' as const, label: 'Include shared storage' },
                { key: 'includeSystem' as const, label: 'Include system apps' },
              ].map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 cursor-pointer hover:bg-slate-750"
                >
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={() => toggleOption(key)}
                    disabled={process.isRunning}
                    className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleStart}
            disabled={process.isRunning || !selectedDevice || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Backup in Progress...' : 'Start Backup'}
          </button>
        </div>

        <div className="space-y-4">
          {(process.isRunning || process.progress.percent > 0) && (
            <ProgressIndicator
              percent={process.progress.percent}
              message={process.progress.message}
              isRunning={process.isRunning}
            />
          )}

          {hashes && (
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-medium text-white">
                <Hash size={14} />
                Backup Hashes
              </h4>
              <div className="space-y-1 font-mono text-xs">
                <div className="flex gap-2">
                  <span className="text-slate-500">MD5:</span>
                  <span className="text-green-400 break-all">{hashes.md5}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-slate-500">SHA256:</span>
                  <span className="text-green-400 break-all">{hashes.sha256}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
