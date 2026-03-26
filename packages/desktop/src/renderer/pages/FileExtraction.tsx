import React, { useState } from 'react';
import { FileSearch, Play } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  ProgressIndicator,
  FolderPicker,
  DeviceSelector,
} from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

const FILE_FORMATS = [
  { ext: 'jpg', label: 'JPG Images' },
  { ext: 'png', label: 'PNG Images' },
  { ext: 'mp4', label: 'MP4 Videos' },
  { ext: 'opus', label: 'OPUS Audio' },
  { ext: 'mp3', label: 'MP3 Audio' },
  { ext: 'pdf', label: 'PDF Documents' },
  { ext: 'doc', label: 'DOC Files' },
  { ext: 'docx', label: 'DOCX Files' },
  { ext: 'xls', label: 'XLS Files' },
  { ext: 'xlsx', label: 'XLSX Files' },
  { ext: 'gif', label: 'GIF Images' },
  { ext: 'bmp', label: 'BMP Images' },
  { ext: '3gp', label: '3GP Videos' },
  { ext: 'amr', label: 'AMR Audio' },
  { ext: 'vcf', label: 'VCF Contacts' },
];

export const FileExtraction: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.FILE_EXTRACT_FORMAT,
    progressChannel: IPC_CHANNELS.FILE_EXTRACT_PROGRESS,
  });

  const [selectedFormats, setSelectedFormats] = useState<Set<string>>(
    new Set(['jpg', 'png', 'mp4', 'opus', 'pdf'])
  );
  const [remotePath, setRemotePath] = useState('/sdcard/');
  const [outputFolder, setOutputFolder] = useState('');

  const toggleFormat = (ext: string) => {
    setSelectedFormats((prev) => {
      const next = new Set(prev);
      if (next.has(ext)) next.delete(ext);
      else next.add(ext);
      return next;
    });
  };

  const selectAll = () => setSelectedFormats(new Set(FILE_FORMATS.map((f) => f.ext)));
  const selectNone = () => setSelectedFormats(new Set());

  const handleStart = async () => {
    if (!selectedDevice || !outputFolder || selectedFormats.size === 0) return;
    await process.start({
      serial: selectedDevice.serial,
      formats: Array.from(selectedFormats),
      remotePath,
      outputPath: outputFolder,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="File Extraction"
        description="Extract files by format from a connected Android device"
        icon={<FileSearch size={24} />}
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

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Remote Path</label>
            <input
              type="text"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={process.isRunning}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-300">File Formats</label>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAll} className="text-blue-400 hover:text-blue-300">
                  Select All
                </button>
                <span className="text-slate-600">|</span>
                <button onClick={selectNone} className="text-blue-400 hover:text-blue-300">
                  Clear All
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {FILE_FORMATS.map(({ ext, label }) => (
                <label
                  key={ext}
                  className="flex items-center gap-2 rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 cursor-pointer hover:bg-slate-750"
                >
                  <input
                    type="checkbox"
                    checked={selectedFormats.has(ext)}
                    onChange={() => toggleFormat(ext)}
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
            disabled={process.isRunning || !selectedDevice || !outputFolder || selectedFormats.size === 0}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Extracting...' : 'Start Extraction'}
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
          <LogConsole logs={process.logs} onClear={process.clearLogs} />
        </div>
      </div>
    </div>
  );
};
