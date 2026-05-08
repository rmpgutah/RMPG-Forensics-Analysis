import React, { useState, useMemo } from 'react';
import { Globe, Play, AlertTriangle, Settings } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, ProgressIndicator, FolderPicker } from '../components/common';
import { useProcess } from '../hooks';

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export const PhotonCrawler: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.PHOTON_RUN,
    progressChannel: IPC_CHANNELS.PHOTON_PROGRESS,
  });
  const [targetUrl, setTargetUrl] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [crawlDepth, setCrawlDepth] = useState(3);
  const [threads, setThreads] = useState(10);
  const [extractKeys, setExtractKeys] = useState(true);
  const [extractDns, setExtractDns] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const urlValid = useMemo(() => !targetUrl || isValidUrl(targetUrl), [targetUrl]);
  const canStart = targetUrl && outputFolder && urlValid && !process.isRunning;

  const handleStart = async () => {
    if (!canStart) return;
    await process.start({ targetUrl, outputPath: outputFolder, crawlDepth, threads, extractKeys, extractDns });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Photon Crawler"
        description="Fast OSINT web crawler for extracting URLs, emails, files, and accounts (github.com/s0md3v/Photon)"
        icon={<Globe size={24} />}
      />
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Target URL</label>
            <input
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={process.isRunning}
              className={`w-full rounded-md border ${!urlValid ? 'border-red-500' : 'border-slate-700'} bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50`}
            />
            {!urlValid && (
              <p className="flex items-center gap-1 text-xs text-red-400">
                <AlertTriangle size={12} />
                Enter a valid URL starting with http:// or https://
              </p>
            )}
          </div>
          <FolderPicker role="output" label="Output Folder" value={outputFolder} onChange={setOutputFolder} disabled={process.isRunning} />

          {/* Advanced options toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300"
          >
            <Settings size={12} />
            {showAdvanced ? 'Hide' : 'Show'} advanced options
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">Crawl Depth</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={crawlDepth}
                  onChange={(e) => setCrawlDepth(Math.max(1, Math.min(10, Number(e.target.value))))}
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">Threads</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={threads}
                  onChange={(e) => setThreads(Math.max(1, Math.min(30, Number(e.target.value))))}
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300 col-span-2">
                <input
                  type="checkbox"
                  checked={extractKeys}
                  onChange={(e) => setExtractKeys(e.target.checked)}
                  disabled={process.isRunning}
                  className="rounded border-slate-600 bg-slate-800"
                />
                Extract API keys &amp; secrets
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300 col-span-2">
                <input
                  type="checkbox"
                  checked={extractDns}
                  onChange={(e) => setExtractDns(e.target.checked)}
                  disabled={process.isRunning}
                  className="rounded border-slate-600 bg-slate-800"
                />
                Extract DNS information
              </label>
            </div>
          )}

          <button onClick={handleStart} disabled={!canStart} className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            <Play size={16} />
            {process.isRunning ? 'Crawling...' : 'Start Crawl'}
          </button>
        </div>
        <div className="space-y-4">
          {(process.isRunning || process.progress.percent > 0) && (
            <ProgressIndicator percent={process.progress.percent} message={process.progress.message} isRunning={process.isRunning} />
          )}
          {process.error && (
            <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{process.error}</span>
              </div>
            </div>
          )}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Capabilities</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Extract URLs, emails, and social accounts</li>
              <li>• Discover hidden files and endpoints</li>
              <li>• Intelligent form and API discovery</li>
              <li>• Detect API keys and secrets in page source</li>
              <li>• Export as JSON with full crawl map</li>
              <li>• Falls back to built-in crawler if Photon is not installed</li>
            </ul>
          </div>
        </div>
      </div>
      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
