import React, { useState } from 'react';
import { FileArchive, Play } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FilePicker, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

export const AbToTar: React.FC = () => {
  const ipc = useIpc();

  const [abFilePath, setAbFilePath] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleConvert = async () => {
    if (!abFilePath || !outputFolder) return;
    setIsConverting(true);
    addLog(`Converting: ${abFilePath}`);
    try {
      await ipc.invoke(IPC_CHANNELS.AB_CONVERT, {
        abFilePath,
        outputPath: outputFolder,
      });
      addLog('Conversion completed successfully.');
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsConverting(false);
    }
  };

  const clearLogs = () => setLogs([]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AB to TAR Converter"
        description="Convert Android .ab backup files to .tar format for extraction"
        icon={<FileArchive size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <FilePicker
            label="Android Backup File (.ab)"
            value={abFilePath}
            onChange={setAbFilePath}
            placeholder="Select .ab file..."
            filters={[{ name: 'Android Backup', extensions: ['ab'] }]}
            disabled={isConverting}
          />

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={isConverting}
          />

          <button
            onClick={handleConvert}
            disabled={isConverting || !abFilePath || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {isConverting ? 'Converting...' : 'Convert to TAR'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">About AB to TAR</h4>
            <p className="text-xs text-slate-400">
              Android backup (.ab) files are encrypted/compressed archives created
              by ADB. This tool converts them into standard .tar archives that can
              be opened with any archive manager for forensic analysis.
            </p>
          </div>
        </div>
      </div>

      <LogConsole logs={logs} onClear={clearLogs} />
    </div>
  );
};
