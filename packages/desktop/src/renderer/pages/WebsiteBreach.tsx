import React, { useState } from 'react';
import { Globe, Play, AlertTriangle, Search, Download, CheckCircle } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  ProgressIndicator,
  ConfirmDialog,
} from '../components/common';
import { useProcess } from '../hooks';

const DATA_GOALS = [
  { id: 'user-accounts', label: 'User Accounts & Credentials', description: 'Usernames, emails, password hashes' },
  { id: 'personal-data', label: 'Personal Data (PII)', description: 'Names, addresses, phone numbers, DOB' },
  { id: 'financial', label: 'Financial Data', description: 'Payment info, transaction records' },
  { id: 'database', label: 'Full Database Dump', description: 'All accessible database tables and records' },
  { id: 'emails', label: 'Email Addresses', description: 'All email addresses from the target' },
  { id: 'api-keys', label: 'API Keys & Secrets', description: 'Exposed API keys, tokens, credentials' },
  { id: 'files', label: 'Sensitive Files', description: 'Config files, backups, documents' },
  { id: 'everything', label: 'Everything Available', description: 'Run all extraction methods' },
];

export const WebsiteBreach: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.WEB_BREACH,
    progressChannel: IPC_CHANNELS.WEB_BREACH_PROGRESS,
  });

  const [targetUrl, setTargetUrl] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [goals, setGoals] = useState(DATA_GOALS.map((g) => ({ ...g, checked: false })));
  const [loginUrl, setLoginUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [stealthMode, setStealthMode] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedGoals = goals.filter((g) => g.checked);

  const toggleGoal = (id: string) => {
    if (id === 'everything') {
      const allChecked = goals.find((g) => g.id === 'everything')?.checked;
      setGoals(goals.map((g) => ({ ...g, checked: !allChecked })));
    } else {
      setGoals(goals.map((g) => g.id === id ? { ...g, checked: !g.checked } : g));
    }
  };

  const handleStartClick = () => {
    if (!targetUrl || !outputFolder || selectedGoals.length === 0) return;
    setShowConfirm(true);
  };

  const handleConfirmStart = async () => {
    setShowConfirm(false);
    await process.start({
      targetUrl,
      attackVector: 'full-recon',
      outputPath: outputFolder,
      goals: selectedGoals.map((g) => g.id),
      credentials: (loginUrl && username) ? { loginUrl, username, password } : undefined,
      stealthMode,
      maxDepth: 3,
      threads: 10,
      followRedirects: true,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Website Data Extraction"
        description="Enter a website and select what data you want — the system handles the rest"
        icon={<Globe size={24} />}
      />

      <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>AUTHORIZED USE ONLY:</strong> Ensure you have explicit written authorization
            to access the target. All operations are logged.
          </span>
        </div>
      </div>

      {/* Simple 3-step UI */}
      <div className="space-y-6">
        {/* Step 1: Target */}
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">1</div>
            <h3 className="text-sm font-semibold text-white">Enter the Target Website</h3>
          </div>
          <input
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={process.isRunning}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-4 py-3 text-base text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
          />
          {/* Optional: credentials for authenticated access */}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
              + Add login credentials (optional — for authenticated pages)
            </summary>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <input
                type="text"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
                placeholder="Login page URL"
                disabled={process.isRunning}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username / Email"
                disabled={process.isRunning}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                disabled={process.isRunning}
                className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </details>
        </div>

        {/* Step 2: What do you want? */}
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">2</div>
            <h3 className="text-sm font-semibold text-white">What Data Do You Want?</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {goals.map((goal) => (
              <label
                key={goal.id}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                  goal.checked
                    ? 'border-blue-500 bg-blue-900/20'
                    : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={goal.checked}
                  onChange={() => toggleGoal(goal.id)}
                  disabled={process.isRunning}
                  className="rounded border-slate-600 bg-slate-800"
                />
                <div>
                  <span className="text-sm font-medium text-white">{goal.label}</span>
                  <p className="text-[11px] text-slate-500">{goal.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Step 3: Output & Go */}
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">3</div>
            <h3 className="text-sm font-semibold text-white">Save Results & Start</h3>
          </div>

          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <FolderPicker
                label="Save Results To"
                value={outputFolder}
                onChange={setOutputFolder}
                placeholder="Choose where to save extracted data..."
                disabled={process.isRunning}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400 pb-2">
              <input
                type="checkbox"
                checked={stealthMode}
                onChange={(e) => setStealthMode(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Stealth mode
            </label>
          </div>

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !targetUrl || !outputFolder || selectedGoals.length === 0}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {process.isRunning ? (
              <>
                <Search size={16} className="animate-spin" />
                Extracting Data...
              </>
            ) : (
              <>
                <Download size={16} />
                Extract Data from Website ({selectedGoals.length} target{selectedGoals.length !== 1 ? 's' : ''})
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress */}
      {(process.isRunning || process.progress.percent > 0) && (
        <ProgressIndicator
          percent={process.progress.percent}
          message={process.progress.message}
          isRunning={process.isRunning}
        />
      )}

      <LogConsole logs={process.logs} onClear={process.clearLogs} />

      <ConfirmDialog
        open={showConfirm}
        title="Confirm Website Data Extraction"
        message="This will actively probe and extract data from the target website. Ensure you have authorization. Proceed?"
        confirmLabel="Start Extraction"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
