import React, { useState } from 'react';
import { Zap, Play, AlertTriangle } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  FilePicker,
  ProgressIndicator,
  DeviceSelector,
  ConfirmDialog,
} from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

const ATTACK_MODES = [
  { value: 'pin-numeric', label: 'PIN Brute Force (Numeric)', description: 'Iterate all numeric PIN combinations (4-8 digits).' },
  { value: 'pattern-all', label: 'Pattern Lock Exhaustive', description: 'Enumerate all valid Android pattern lock combinations.' },
  { value: 'password-dict', label: 'Password Dictionary Attack', description: 'Use wordlists to try common passwords against lock screen.' },
  { value: 'password-hybrid', label: 'Hybrid Attack (Dict + Rules)', description: 'Dictionary attack with mutation rules (l33t, case, appends).' },
  { value: 'hash-crack', label: 'Hash Cracking', description: 'Crack extracted password hashes using GPU-accelerated methods.' },
  { value: 'token-replay', label: 'Auth Token Replay', description: 'Replay captured authentication tokens to bypass lock.' },
] as const;

export const BruteForceAttack: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.BRUTE_FORCE,
    progressChannel: IPC_CHANNELS.BRUTE_FORCE_PROGRESS,
  });

  const [mode, setMode] = useState<string>('pin-numeric');
  const [outputFolder, setOutputFolder] = useState('');
  const [wordlistPath, setWordlistPath] = useState('');
  const [pinLength, setPinLength] = useState('4');
  const [maxAttempts, setMaxAttempts] = useState('10000');
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedMode = ATTACK_MODES.find((m) => m.value === mode);

  const handleStartClick = () => {
    if (!outputFolder) return;
    setShowConfirm(true);
  };

  const handleConfirmStart = async () => {
    setShowConfirm(false);
    await process.start({
      mode,
      serial: selectedDevice?.serial,
      outputPath: outputFolder,
      wordlistPath: wordlistPath || undefined,
      pinLength: parseInt(pinLength, 10),
      maxAttempts: parseInt(maxAttempts, 10),
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brute Force Attack"
        description="Systematically attempt credential combinations to bypass device lock screens and authentication"
        icon={<Zap size={24} />}
      />

      <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Brute force attacks may trigger device lockout or data wipe after too many failed attempts.
            Some devices implement exponential backoff delays. Use with extreme caution and only
            with proper legal authorization. Monitor attempt counts carefully.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            disabled={process.isRunning}
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Attack Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              {ATTACK_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {selectedMode && (
              <p className="text-xs text-slate-500">{selectedMode.description}</p>
            )}
          </div>

          {(mode === 'pin-numeric') && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">PIN Length</label>
              <select
                value={pinLength}
                onChange={(e) => setPinLength(e.target.value)}
                disabled={process.isRunning}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="4">4 digits (10,000 combinations)</option>
                <option value="5">5 digits (100,000 combinations)</option>
                <option value="6">6 digits (1,000,000 combinations)</option>
                <option value="8">8 digits (100,000,000 combinations)</option>
              </select>
            </div>
          )}

          {(mode === 'password-dict' || mode === 'password-hybrid') && (
            <FilePicker
              label="Wordlist File"
              value={wordlistPath}
              onChange={setWordlistPath}
              placeholder="Select password wordlist..."
              disabled={process.isRunning}
            />
          )}

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Max Attempts</label>
            <input
              type="number"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
              min="100"
              max="100000000"
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
            <p className="text-xs text-slate-500">Limit attempts to prevent device lockout.</p>
          </div>

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Select folder to save results..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Attack in Progress...' : 'Start Attack'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Attack Capabilities</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Numeric PIN brute force with timing bypass</li>
              <li>• Android pattern lock enumeration (389,112 valid patterns)</li>
              <li>• Dictionary attacks with common password lists</li>
              <li>• Rule-based mutations (capitalisation, leet speak, number appends)</li>
              <li>• GPU-accelerated hash cracking (MD5, SHA, bcrypt)</li>
              <li>• Smart delay management to avoid lockout triggers</li>
            </ul>
          </div>

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

      <ConfirmDialog
        open={showConfirm}
        title="Confirm Brute Force Attack"
        message="WARNING: This operation will attempt to brute-force the device credentials. Excessive attempts may trigger device lockout or factory reset protections. Ensure you have legal authority and understand the risks. Proceed?"
        confirmLabel="Start Attack"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
