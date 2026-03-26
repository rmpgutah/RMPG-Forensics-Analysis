import React, { useState } from 'react';
import { Film, Play, FileText } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

export const MediaProcessing: React.FC = () => {
  const ipc = useIpc();

  const [sourceFolder, setSourceFolder] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleProcess = async () => {
    if (!sourceFolder || !outputFolder) return;
    setIsProcessing(true);
    addLog('Starting media processing...');
    try {
      await ipc.invoke(IPC_CHANNELS.MEDIA_PROCESS, {
        sourcePath: sourceFolder,
        outputPath: outputFolder,
      });
      addLog('Media processing completed.');
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!outputFolder) return;
    setIsGenerating(true);
    addLog('Generating report...');
    try {
      await ipc.invoke(IPC_CHANNELS.MEDIA_GENERATE_REPORT, {
        outputPath: outputFolder,
      });
      addLog('Report generated successfully.');
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const clearLogs = () => setLogs([]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media Processing"
        description="Process media files and generate forensic reports"
        icon={<Film size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <FolderPicker
            label="Media Source Folder"
            value={sourceFolder}
            onChange={setSourceFolder}
            disabled={isProcessing}
          />

          <FolderPicker
            label="Output / Report Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={isProcessing}
          />

          <div className="flex gap-3">
            <button
              onClick={handleProcess}
              disabled={isProcessing || isGenerating || !sourceFolder || !outputFolder}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              {isProcessing ? 'Processing...' : 'Process Media'}
            </button>

            <button
              onClick={handleGenerateReport}
              disabled={isProcessing || isGenerating || !outputFolder}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText size={16} />
              {isGenerating ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Instructions</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>1. Select the folder containing media files to process.</li>
              <li>2. Choose an output folder for processed files and reports.</li>
              <li>3. Click "Process Media" to analyze and organize files.</li>
              <li>4. Click "Generate Report" to create a forensic report.</li>
            </ul>
          </div>
        </div>
      </div>

      <LogConsole logs={logs} onClear={clearLogs} />
    </div>
  );
};
