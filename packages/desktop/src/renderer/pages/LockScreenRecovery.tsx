import React, { useState } from 'react';
import { Unlock, Play, AlertTriangle } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  ProgressIndicator,
  DeviceSelector,
  ConfirmDialog,
} from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

export const LockScreenRecovery: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.LOCK_SCREEN_RECOVER,
    progressChannel: IPC_CHANNELS.LOCK_SCREEN_RECOVER_PROGRESS,
  });

  const [outputFolder, setOutputFolder] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const handleStartClick = () => {
    if (!selectedDevice || !outputFolder) return;
    setShowConfirm(true);
  };

  const handleConfirmStart = async () => {
    setShowConfirm(false);
    if (!selectedDevice || !outputFolder) return;
    await process.start({
      serial: selectedDevice.serial,
      outputPath: outputFolder,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lock Screen Recovery"
        description="Attempt to bypass or recover lock screen credentials from Android devices"
        icon={<Unlock size={24} />}
      />

      <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            This tool attempts lock screen credential recovery via ADB. The device must have
            USB debugging enabled or be in recovery mode. Success is not guaranteed and depends
            on device model and Android version.
          </span>
        </div>
      </div>

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
            placeholder="Select folder to save recovered data..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !selectedDevice || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Recovery in Progress...' : 'Start Recovery'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Supported Methods</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Pattern/PIN/Password extraction from locksettings.db</li>
              <li>• Gesture pattern file recovery</li>
              <li>• Samsung FRP bypass (select models)</li>
              <li>• Lock file deletion via recovery mode</li>
            </ul>
          </div>

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

      <ConfirmDialog
        open={showConfirm}
        title="Confirm Lock Screen Recovery"
        message="This operation may modify device files and could affect device state. Ensure you have proper authorization to access this device. Proceed?"
        confirmLabel="Proceed with Recovery"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
