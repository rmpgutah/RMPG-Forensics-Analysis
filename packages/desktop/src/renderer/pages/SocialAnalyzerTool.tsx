import React, { useState } from 'react';
import { Users, Play } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, ProgressIndicator, FolderPicker } from '../components/common';
import { useProcess } from '../hooks';

export const SocialAnalyzerTool: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.SOCIAL_ANALYZER_RUN,
    progressChannel: IPC_CHANNELS.SOCIAL_ANALYZER_PROGRESS,
  });
  const [target, setTarget] = useState('');
  const [outputFolder, setOutputFolder] = useState('');

  const handleStart = async () => {
    if (!target || !outputFolder) return;
    await process.start({ target, outputPath: outputFolder });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Social Analyzer"
        description="Analyze and find a person's profile across 1000+ social media sites (github.com/qeeqbox/social-analyzer)"
        icon={<Users size={24} />}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Username or Name</label>
            <input type="text" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Enter username or name to analyze" disabled={process.isRunning} className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50" />
          </div>
          <FolderPicker role="output" label="Output Folder" value={outputFolder} onChange={setOutputFolder} disabled={process.isRunning} />
          <button onClick={handleStart} disabled={process.isRunning || !target || !outputFolder} className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
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
              <li>• Profile detection on 1000+ platforms</li>
              <li>• Metadata extraction from profiles</li>
              <li>• Similar username suggestions</li>
              <li>• Confidence scoring per match</li>
            </ul>
          </div>
        </div>
      </div>
      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
