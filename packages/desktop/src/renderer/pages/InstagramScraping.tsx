import React, { useState, useEffect, useRef } from 'react';
import { Instagram, Play, KeyRound, ShieldCheck } from 'lucide-react';
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
  const [loginUser, setLoginUser] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [twoFaPrompted, setTwoFaPrompted] = useState(false);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaSubmitting, setTwoFaSubmitting] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const twoFaInputRef = useRef<HTMLInputElement>(null);

  // Listen for the main process's 2FA-required signal.
  useEffect(() => {
    const cleanup = window.api.on(IPC_CHANNELS.INSTAGRAM_2FA_PROMPT, () => {
      setTwoFaPrompted(true);
      setTwoFaError(null);
      setTwoFaCode('');
      setTimeout(() => twoFaInputRef.current?.focus(), 50);
    });
    return cleanup;
  }, []);

  // When the process stops, dismiss the 2FA prompt.
  useEffect(() => {
    if (!process.isRunning) {
      setTwoFaPrompted(false);
      setTwoFaCode('');
    }
  }, [process.isRunning]);

  const handleSubmit2FA = async () => {
    if (twoFaCode.length < 6) return;
    setTwoFaSubmitting(true);
    setTwoFaError(null);
    try {
      const result = (await window.api.invoke(IPC_CHANNELS.INSTAGRAM_2FA_SUBMIT, twoFaCode)) as {
        ok: boolean;
        error?: string;
      };
      if (!result?.ok) {
        setTwoFaError(result?.error || 'Failed to submit code');
      } else {
        setTwoFaPrompted(false);
        setTwoFaCode('');
      }
    } catch (err) {
      setTwoFaError((err as Error).message);
    } finally {
      setTwoFaSubmitting(false);
    }
  };
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
      // Instagram requires login for almost all profile content as of 2024+;
      // pass credentials through to instaloader's --login/--password flags.
      loginUser: loginUser.trim() || undefined,
      loginPassword: loginPassword || undefined,
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
          <ToolStatus toolName="instaloader" />

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

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">
              Login Username <span className="text-xs text-slate-500">(optional — needed only for private/protected profiles)</span>
            </label>
            <input
              type="text"
              value={loginUser}
              onChange={(e) => setLoginUser(e.target.value)}
              placeholder="Your Instagram login username"
              autoComplete="off"
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">
              Login Password
            </label>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="off"
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="text-[11px] text-slate-500">
              Credentials are passed to <code>instaloader</code> for this run only. Not persisted.
              For 2FA-protected accounts, run <code>instaloader --login &lt;user&gt;</code> once in a terminal to cache a session, then leave password blank here.
            </p>
          </div>

          <FolderPicker
            role="output"
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
          {/* 2FA verification panel — visible whenever a scrape is running so the
              user can submit a code immediately, even if auto-detection of the
              instaloader prompt misses (e.g. due to Python output buffering). */}
          {(twoFaPrompted || process.isRunning) && (
            <div
              className="relative overflow-hidden rounded-xl border p-5"
              style={{
                background:
                  'radial-gradient(120% 80% at 50% 0%, rgba(100,149,237,0.18), rgba(13,59,94,0.15) 50%, rgba(0,0,0,0) 100%), var(--bg-card)',
                borderColor: 'rgba(100,149,237,0.45)',
                boxShadow: '0 12px 40px -12px rgba(100,149,237,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#6495ED] to-transparent" />
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-[#6495ED]/15 p-1.5">
                    <ShieldCheck size={16} className="text-[#6495ED]" />
                  </div>
                  <h4 className="text-sm font-bold text-white">
                    {twoFaPrompted ? 'Two-Factor Code Required' : 'Two-Factor Code (if prompted)'}
                  </h4>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest"
                  style={{
                    background: twoFaPrompted ? 'rgba(74,222,128,0.15)' : 'rgba(100,149,237,0.15)',
                    color: twoFaPrompted ? '#4ade80' : '#9bb8ee',
                    border: `1px solid ${twoFaPrompted ? 'rgba(74,222,128,0.4)' : 'rgba(100,149,237,0.3)'}`,
                  }}
                >
                  {twoFaPrompted ? '● Awaiting code' : 'Standby'}
                </span>
              </div>
              <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                {twoFaPrompted
                  ? 'Instaloader is waiting for the 6-digit code from your authenticator app. Enter it below to continue.'
                  : 'If your account has 2FA enabled, enter the 6-digit code here as soon as you have it. The code will be forwarded to instaloader the moment it asks.'}
              </p>
              <div className="relative">
                <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6495ED]" />
                <input
                  ref={twoFaInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFaCode}
                  onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit2FA(); }}
                  placeholder="000000"
                  disabled={twoFaSubmitting}
                  maxLength={8}
                  className="w-full rounded-lg border border-[#6495ED]/40 bg-[#0f2238]/70 py-3 pl-10 pr-4 text-center text-2xl font-mono tracking-[0.5em] text-white placeholder-gray-600 outline-none transition focus:border-[#6495ED] focus:ring-2 focus:ring-[#6495ED]/30"
                />
              </div>
              {twoFaError && (
                <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {twoFaError}
                </div>
              )}
              <button
                onClick={handleSubmit2FA}
                disabled={twoFaSubmitting || twoFaCode.length < 6}
                className="btn-primary mt-3 flex w-full items-center justify-center gap-2"
              >
                <KeyRound size={14} />
                {twoFaSubmitting ? 'Submitting…' : 'Submit Code'}
              </button>
              <p className="mt-2 text-center text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Code is forwarded directly to instaloader · never stored
              </p>
            </div>
          )}

          {(process.isRunning || process.progress.percent > 0) && (
            <ProgressIndicator
              percent={process.progress.percent}
              bytes={process.progress.bytes}
              totalBytes={process.progress.totalBytes}
              speed={process.progress.speed}
              eta={process.progress.eta}
              filesCount={process.progress.filesCount}
              totalFiles={process.progress.totalFiles}
              message={process.progress.message}
              isRunning={process.isRunning}
            />
          )}

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">About Instaloader</h4>
            <p className="text-xs text-slate-400">
              Instaloader is used to download public profile data including posts,
              stories, highlights, and metadata. If Instaloader is not installed,
              a built-in HTTP scraper will extract publicly available profile data
              without requiring any credentials or tools.
            </p>
          </div>
        </div>
      </div>

      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
