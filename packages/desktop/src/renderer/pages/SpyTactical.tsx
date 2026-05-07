import React, { useState } from 'react';
import { Eye, Play, AlertTriangle } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  ProgressIndicator,
  DeviceSelector,
  ConfirmDialog,
} from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

const SPY_OPERATIONS = [
  { value: 'live-screen', label: 'Live Screen Surveillance', description: 'Capture continuous screenshots of the device screen in real time.' },
  { value: 'keylogger-extract', label: 'Keylogger Data Extract', description: 'Extract keystroke logs from input method caches and prediction databases.' },
  { value: 'app-activity', label: 'App Activity Monitor', description: 'Monitor and log all application launches, foreground changes, and usage patterns.' },
  { value: 'location-track', label: 'Location Tracking', description: 'Continuously poll and record device GPS coordinates with timestamps.' },
  { value: 'call-intercept', label: 'Call Log & Recording Extract', description: 'Extract detailed call logs, voicemail, and any stored call recordings.' },
  { value: 'camera-capture', label: 'Camera Capture', description: 'Trigger silent camera captures from front/rear cameras (rooted devices).' },
  { value: 'notification-dump', label: 'Notification History Dump', description: 'Extract full notification history including message previews.' },
  { value: 'clipboard-extract', label: 'Clipboard History Extract', description: 'Recover clipboard history including copied passwords and sensitive data.' },
] as const;

export const SpyTactical: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.SPY_TACTICAL,
    progressChannel: IPC_CHANNELS.SPY_TACTICAL_PROGRESS,
  });

  const [operation, setOperation] = useState<string>('live-screen');
  const [outputFolder, setOutputFolder] = useState('');
  const [duration, setDuration] = useState('300');
  const [interval, setInterval] = useState('5');
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedOp = SPY_OPERATIONS.find((op) => op.value === operation);
  const isTimedOp = ['live-screen', 'app-activity', 'location-track'].includes(operation);

  const handleStartClick = () => {
    if (!selectedDevice || !outputFolder) return;
    setShowConfirm(true);
  };

  const handleConfirmStart = async () => {
    setShowConfirm(false);
    if (!selectedDevice || !outputFolder) return;
    await process.start({
      operation,
      serial: selectedDevice.serial,
      outputPath: outputFolder,
      duration: parseInt(duration, 10),
      interval: parseInt(interval, 10),
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spy Tactical Systems"
        description="Covert surveillance and monitoring capabilities for forensic device analysis"
        icon={<Eye size={24} />}
      />

      <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>RESTRICTED:</strong> Spy tactical operations are highly invasive surveillance
            tools. These must only be used under valid court orders or equivalent legal authority.
            Many operations require root/jailbreak access. All captured data is logged for
            chain-of-custody compliance.
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
            filter="android"
            disabled={process.isRunning}
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Operation</label>
            <select
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              {SPY_OPERATIONS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            {selectedOp && (
              <p className="text-xs text-slate-500">{selectedOp.description}</p>
            )}
          </div>

          {isTimedOp && (
            <>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">
                  Duration (seconds)
                </label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  min="10"
                  max="86400"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">
                  Capture Interval (seconds)
                </label>
                <input
                  type="number"
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                  min="1"
                  max="300"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
            </>
          )}

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Select folder to save surveillance data..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !selectedDevice || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Surveillance Active...' : 'Start Surveillance'}
          </button>

          {process.isRunning && (
            <button
              onClick={process.cancel}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
            >
              Stop Surveillance
            </button>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Tactical Capabilities</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Real-time screen capture at configurable intervals</li>
              <li>• Keystroke log extraction from IME caches</li>
              <li>• Application usage timeline generation</li>
              <li>• Continuous GPS coordinate logging</li>
              <li>• Call log and voicemail recovery</li>
              <li>• Silent camera capture (front/rear)</li>
              <li>• Full notification history with content preview</li>
              <li>• Clipboard data recovery including passwords</li>
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
        title="Confirm Spy Tactical Operation"
        message="WARNING: You are about to initiate covert surveillance on the target device. This is a highly invasive operation that must be authorized by valid court order or equivalent legal authority. All actions will be logged. Proceed?"
        confirmLabel="Initiate Surveillance"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
