import React, { useState } from 'react';
import { Apple, Play, AlertTriangle, CheckCircle } from 'lucide-react';
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

const BYPASS_METHODS = [
  { value: 'lockdown-inject', label: 'Lockdown Record Injection', description: 'Inject a pre-generated pairing record to establish trust without user interaction.' },
  { value: 'usb-mux-exploit', label: 'USB Mux Trust Override', description: 'Bypass the trust dialog using usbmuxd protocol-level trust establishment.' },
  { value: 'recovery-trust', label: 'Recovery Mode Trust', description: 'Establish device trust via recovery/DFU mode without passcode.' },
  { value: 'supervision-profile', label: 'MDM Supervision Bypass', description: 'Apply a supervision profile to gain management access without device unlock.' },
  { value: 'checkm8-unlock', label: 'Checkm8 Exploit (A5-A11)', description: 'Use bootrom exploit for full device access on vulnerable chipsets.' },
  { value: 'agent-inject', label: 'Trust Agent Deployment', description: 'Deploy trust agent via exploit chain to maintain persistent access.' },
] as const;

export const IosTrustUnlock: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.IOS_TRUST_BYPASS,
    progressChannel: IPC_CHANNELS.IOS_TRUST_BYPASS_PROGRESS,
  });

  const [method, setMethod] = useState<string>('lockdown-inject');
  const [outputFolder, setOutputFolder] = useState('');
  const [autoTrust, setAutoTrust] = useState(true);
  const [persistAccess, setPersistAccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedMethod = BYPASS_METHODS.find((m) => m.value === method);

  const handleStartClick = () => {
    if (!outputFolder) return;
    setShowConfirm(true);
  };

  const handleConfirmStart = async () => {
    setShowConfirm(false);
    await process.start({
      method,
      serial: selectedDevice?.serial,
      outputPath: outputFolder,
      autoTrust,
      persistAccess,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Trust & Unlock"
        description="Establish device trust and unlock Apple devices without authentication prompts"
        icon={<Apple size={24} />}
      />

      <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>RESTRICTED:</strong> iOS trust bypass operations circumvent Apple's security
            mechanisms. Device must be physically connected via USB. Some methods require specific
            iOS versions or chipsets. Ensure valid legal authority before proceeding.
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
            filter="ios"
            disabled={process.isRunning}
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Bypass Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              {BYPASS_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {selectedMethod && (
              <p className="text-xs text-slate-500">{selectedMethod.description}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={autoTrust}
                onChange={(e) => setAutoTrust(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Auto-trust on connection (skip trust dialog)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={persistAccess}
                onChange={(e) => setPersistAccess(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Persist access across reconnections
            </label>
          </div>

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Select folder for pairing records and logs..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Bypass in Progress...' : 'Start Trust Bypass'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Capabilities</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Automatic trust establishment without "Trust This Computer" prompt</li>
              <li>• Lockdown pairing record generation and injection</li>
              <li>• USB multiplexer protocol-level trust override</li>
              <li>• Recovery/DFU mode access without passcode</li>
              <li>• MDM supervision profile application</li>
              <li>• Checkm8 bootrom exploit for A5–A11 devices</li>
              <li>• Persistent trust agent for continuous access</li>
              <li>• Compatible with iOS 9.x through iOS 17.x</li>
            </ul>
          </div>

          <div className="rounded-lg border border-green-700/50 bg-green-900/20 p-3">
            <div className="flex items-start gap-2">
              <CheckCircle size={16} className="mt-0.5 shrink-0 text-green-400" />
              <div className="text-xs text-green-300">
                <strong>Auto-Trust Mode:</strong> When enabled, any Apple device plugged in
                will be automatically trusted and unlocked without requiring the user to
                tap "Trust" or enter their passcode.
              </div>
            </div>
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
        title="Confirm iOS Trust Bypass"
        message="This will bypass Apple's trust authentication on the connected device, allowing full access without user interaction. This circumvents security protections. Ensure legal authorization. Proceed?"
        confirmLabel="Bypass Trust"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
