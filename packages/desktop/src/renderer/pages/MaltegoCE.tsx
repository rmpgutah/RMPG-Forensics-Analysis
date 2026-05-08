import React, { useState } from 'react';
import { Share2, Play } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, ProgressIndicator, FolderPicker } from '../components/common';
import { useProcess } from '../hooks';

export const MaltegoCE: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.MALTEGO_RUN,
    progressChannel: IPC_CHANNELS.MALTEGO_PROGRESS,
  });
  const [seedEntity, setSeedEntity] = useState('');
  const [outputFolder, setOutputFolder] = useState('');

  const handleStart = async () => {
    if (!seedEntity || !outputFolder) return;
    await process.start({ seedEntity, outputPath: outputFolder });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maltego CE Integration"
        description="Link analysis and data mining for investigative intelligence (github.com/paterva/maltego-trx)"
        icon={<Share2 size={24} />}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Seed Entity (email/domain/name)</label>
            <input type="text" value={seedEntity} onChange={(e) => setSeedEntity(e.target.value)} placeholder="Enter seed entity" disabled={process.isRunning} className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50" />
          </div>
          <FolderPicker role="output" label="Output Folder" value={outputFolder} onChange={setOutputFolder} disabled={process.isRunning} />
          <button onClick={handleStart} disabled={process.isRunning || !seedEntity || !outputFolder} className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            <Play size={16} />
            {process.isRunning ? 'Analyzing...' : 'Start Analysis'}
          </button>
        </div>
        <div className="space-y-4">
          {(process.isRunning || process.progress.percent > 0) && (
            <ProgressIndicator percent={process.progress.percent} message={process.progress.message} isRunning={process.isRunning} />
          )}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Capabilities</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Relationship and link analysis</li>
              <li>• Visual graph-based investigation</li>
              <li>• Transform-based data enrichment</li>
              <li>• Entity correlation and clustering</li>
            </ul>
          </div>
        </div>
      </div>
      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
