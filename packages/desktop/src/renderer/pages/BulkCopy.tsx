import React, { useState } from 'react';
import { Copy, Play, Square } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, ProgressIndicator, FolderPicker, DeviceSelector } from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

export const BulkCopy: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.BULK_COPY,
    progressChannel: IPC_CHANNELS.BULK_COPY_PROGRESS,
  });

  const [outputFolder, setOutputFolder] = useState('');

  const handleStart = async () => {
    if (!selectedDevice || !outputFolder) return;
    await process.start({
      serial: selectedDevice.serial,
      outputPath: outputFolder,
    });
  };

  const handleCancel = () => {
    process.cancel();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Copy"
        description="Copy the entire SD card contents from an Android device"
        icon={<Copy size={24} />}
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

          <div className="flex gap-3">
            <button
              onClick={handleStart}
              disabled={process.isRunning || !selectedDevice || !outputFolder}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              {process.isRunning ? 'Copying...' : 'Start Copy'}
            </button>

            {process.isRunning && (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 rounded-md border border-red-700/50 bg-red-900/20 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-900/40"
              >
                <Square size={16} />
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
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
  );
};
