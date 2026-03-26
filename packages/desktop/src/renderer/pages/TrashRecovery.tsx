import React, { useState } from 'react';
import { Trash2, Search, Play, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FolderPicker, DeviceSelector } from '../components/common';
import { useDeviceStatus, useIpc } from '../hooks';

interface RecoveredFile {
  path: string;
  name: string;
  size: number;
  type: string;
}

export const TrashRecovery: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const ipc = useIpc();

  const [foundFiles, setFoundFiles] = useState<RecoveredFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [outputFolder, setOutputFolder] = useState('');
  const [scanning, setScanning] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleScan = async () => {
    if (!selectedDevice) return;
    setScanning(true);
    setFoundFiles([]);
    setSelectedFiles(new Set());
    addLog('Scanning for deleted files...');
    const result = await ipc.invoke<RecoveredFile[]>(IPC_CHANNELS.TRASH_SCAN, {
      serial: selectedDevice.serial,
    });
    if (result) {
      setFoundFiles(result);
      addLog(`Found ${result.length} recoverable files.`);
    } else {
      addLog(`Scan failed: ${ipc.error ?? 'Unknown error'}`);
    }
    setScanning(false);
  };

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => setSelectedFiles(new Set(foundFiles.map((f) => f.path)));
  const selectNone = () => setSelectedFiles(new Set());

  const handleRecover = async () => {
    if (!selectedDevice || !outputFolder || selectedFiles.size === 0) return;
    setRecovering(true);
    addLog(`Recovering ${selectedFiles.size} files...`);
    const result = await ipc.invoke<{ success: boolean; recovered: number; message?: string }>(
      IPC_CHANNELS.TRASH_RECOVER,
      {
        serial: selectedDevice.serial,
        files: Array.from(selectedFiles),
        outputPath: outputFolder,
      }
    );
    if (result?.success) {
      addLog(`Successfully recovered ${result.recovered} files to ${outputFolder}.`);
    } else {
      addLog(`Recovery failed: ${result?.message ?? ipc.error ?? 'Unknown error'}`);
    }
    setRecovering(false);
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trash Recovery"
        description="Scan for and recover deleted files from an Android device"
        icon={<Trash2 size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Left column - controls */}
        <div className="space-y-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            filter="android"
            disabled={scanning || recovering}
          />

          <button
            onClick={handleScan}
            disabled={scanning || recovering || !selectedDevice}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scanning ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Search size={16} />
            )}
            {scanning ? 'Scanning...' : 'Scan for Deleted Files'}
          </button>

          <FolderPicker
            label="Recovery Destination"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={scanning || recovering}
          />

          <button
            onClick={handleRecover}
            disabled={recovering || scanning || !outputFolder || selectedFiles.size === 0}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {recovering ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {recovering ? 'Recovering...' : `Recover ${selectedFiles.size} File${selectedFiles.size !== 1 ? 's' : ''}`}
          </button>

          {ipc.error && (
            <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
              {ipc.error}
            </div>
          )}
        </div>

        {/* Right column - found files */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-300">
              Found Files
              {foundFiles.length > 0 && (
                <span className="ml-2 text-slate-500">
                  ({selectedFiles.size}/{foundFiles.length} selected)
                </span>
              )}
            </label>
            {foundFiles.length > 0 && (
              <div className="flex gap-2 text-xs">
                <button onClick={selectAll} className="text-blue-400 hover:text-blue-300">
                  Select All
                </button>
                <span className="text-slate-600">|</span>
                <button onClick={selectNone} className="text-blue-400 hover:text-blue-300">
                  Clear All
                </button>
              </div>
            )}
          </div>

          <div className="h-[360px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/50">
            {scanning ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : foundFiles.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">
                No deleted files found. Click "Scan" to search.
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {foundFiles.map((file) => (
                  <label
                    key={file.path}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(file.path)}
                      onChange={() => toggleFile(file.path)}
                      disabled={recovering}
                      className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-300">{file.name}</div>
                      <div className="text-xs text-slate-500">
                        {file.type} &middot; {formatSize(file.size)}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
