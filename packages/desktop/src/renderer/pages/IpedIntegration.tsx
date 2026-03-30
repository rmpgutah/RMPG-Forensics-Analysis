import React, { useState } from 'react';
import { Search, Play } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  ProgressIndicator,
  FolderPicker,
  ToolStatus,
} from '../components/common';
import { useProcess } from '../hooks';

export const IpedIntegration: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.IPED_RUN,
    progressChannel: IPC_CHANNELS.IPED_PROGRESS,
  });

  const [evidenceFolder, setEvidenceFolder] = useState('');
  const [outputFolder, setOutputFolder] = useState('');

  const handleStart = async () => {
    if (!evidenceFolder || !outputFolder) return;
    await process.start({
      evidencePath: evidenceFolder,
      outputPath: outputFolder,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="IPED Integration"
        description="Run IPED (Indexador e Processador de Evidencias Digitais) for digital evidence indexing and processing"
        icon={<Search size={24} />}
      />

      <ToolStatus toolName="java" label="Java Runtime" />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <FolderPicker
            label="Evidence Source Folder"
            value={evidenceFolder}
            onChange={setEvidenceFolder}
            disabled={process.isRunning}
          />

          <FolderPicker
            label="IPED Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={process.isRunning}
          />

          <button
            onClick={handleStart}
            disabled={process.isRunning || !evidenceFolder || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Indexing in Progress...' : 'Start Indexing'}
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
        </div>
      </div>

      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
