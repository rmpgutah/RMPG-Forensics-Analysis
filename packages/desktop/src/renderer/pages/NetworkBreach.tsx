import React, { useState } from 'react';
import { Wifi, Play, AlertTriangle } from 'lucide-react';
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

const BREACH_OPERATIONS = [
  { value: 'wifi-credential', label: 'WiFi Credential Extraction', description: 'Extract stored WiFi passwords and network configurations from device.' },
  { value: 'network-intercept', label: 'Network Traffic Capture', description: 'Capture and analyze network traffic to/from the device.' },
  { value: 'ssl-strip', label: 'SSL/TLS Inspection', description: 'Inspect encrypted traffic using certificate injection (rooted devices).' },
  { value: 'bluetooth-enum', label: 'Bluetooth Enumeration', description: 'Enumerate paired Bluetooth devices and extract connection keys.' },
  { value: 'vpn-extract', label: 'VPN Configuration Extract', description: 'Extract VPN profiles, certificates, and stored credentials.' },
  { value: 'dns-history', label: 'DNS Query History', description: 'Recover DNS resolution history and browsing patterns.' },
] as const;

export const NetworkBreach: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.NETWORK_BREACH,
    progressChannel: IPC_CHANNELS.NETWORK_BREACH_PROGRESS,
  });

  const [operation, setOperation] = useState<string>('wifi-credential');
  const [outputFolder, setOutputFolder] = useState('');
  const [duration, setDuration] = useState('60');
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedOp = BREACH_OPERATIONS.find((op) => op.value === operation);

  const handleStartClick = () => {
    if (!outputFolder) return;
    setShowConfirm(true);
  };

  const handleConfirmStart = async () => {
    setShowConfirm(false);
    await process.start({
      operation,
      serial: selectedDevice?.serial,
      outputPath: outputFolder,
      duration: parseInt(duration, 10),
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Network Breach"
        description="Extract network credentials, capture traffic, and analyze communication patterns from devices"
        icon={<Wifi size={24} />}
      />

      <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Network breach operations may require root/jailbreak access on the target device.
            Traffic interception requires the device to be on the same network segment.
            Ensure proper legal authorization before conducting any network analysis.
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
            <label className="block text-sm font-medium text-slate-300">Operation</label>
            <select
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              {BREACH_OPERATIONS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            {selectedOp && (
              <p className="text-xs text-slate-500">{selectedOp.description}</p>
            )}
          </div>

          {(operation === 'network-intercept' || operation === 'ssl-strip') && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">
                Capture Duration (seconds)
              </label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min="10"
                max="3600"
                disabled={process.isRunning}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
          )}

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Select folder to save captured data..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Operation in Progress...' : 'Start Operation'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Network Capabilities</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• WiFi password extraction from wpa_supplicant / Keychain</li>
              <li>• Real-time packet capture with protocol analysis</li>
              <li>• SSL/TLS MITM inspection (requires cert install)</li>
              <li>• Bluetooth pairing key and device history extraction</li>
              <li>• VPN profile and certificate recovery</li>
              <li>• DNS cache and resolution history forensics</li>
              <li>• Network connection timeline reconstruction</li>
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
        title="Confirm Network Breach Operation"
        message="This operation will access network credentials and/or intercept communications on the target device. This may require elevated privileges. Ensure legal authorization exists. Proceed?"
        confirmLabel="Start Operation"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
