import React, { useState } from 'react';
import { Instagram, Play } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  ProgressIndicator,
  FolderPicker,
  ToolStatus,
} from '../components/common';
import { useProcess } from '../hooks';

interface ScrapeOptions {
  comments: boolean;
  geotags: boolean;
  stories: boolean;
  highlights: boolean;
  taggedPosts: boolean;
  igtv: boolean;
}

export const InstagramScraping: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.INSTAGRAM_SCRAPE,
    progressChannel: IPC_CHANNELS.INSTAGRAM_PROGRESS,
  });

  const [username, setUsername] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [options, setOptions] = useState<ScrapeOptions>({
    comments: true,
    geotags: true,
    stories: true,
    highlights: true,
    taggedPosts: false,
    igtv: false,
  });

  const toggleOption = (key: keyof ScrapeOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStart = async () => {
    if (!username.trim() || !outputFolder) return;
    await process.start({
      username: username.trim(),
      outputPath: outputFolder,
      ...options,
    });
  };

  const optionItems: { key: keyof ScrapeOptions; label: string }[] = [
    { key: 'comments', label: 'Comments' },
    { key: 'geotags', label: 'Geotags' },
    { key: 'stories', label: 'Stories' },
    { key: 'highlights', label: 'Highlights' },
    { key: 'taggedPosts', label: 'Tagged Posts' },
    { key: 'igtv', label: 'IGTV' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Instagram Scraping"
        description="Scrape Instagram profiles using Instaloader"
        icon={<Instagram size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <ToolStatus tool="instaloader" />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">
              Target Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter Instagram username..."
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
            <label className="block text-sm font-medium text-slate-300">Scrape Options</label>
            <div className="grid grid-cols-2 gap-2">
              {optionItems.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-2 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 cursor-pointer hover:bg-slate-750"
                >
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={() => toggleOption(key)}
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
            disabled={process.isRunning || !username.trim() || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Scraping in Progress...' : 'Start Scraping'}
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

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">About Instaloader</h4>
            <p className="text-xs text-slate-400">
              Instaloader is used to download public profile data including posts,
              stories, highlights, and metadata. Ensure Instaloader is installed and
              accessible via the configured path.
            </p>
          </div>
        </div>
      </div>

      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
