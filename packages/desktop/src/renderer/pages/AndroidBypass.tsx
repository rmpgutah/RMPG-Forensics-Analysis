import React, { useState } from 'react';
import { Smartphone, Play, AlertTriangle, CheckCircle } from 'lucide-react';
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
  { value: 'adb-push-exploit', label: 'ADB Enable Exploit', description: 'Force-enable ADB debugging without developer mode using system-level exploits.' },
  { value: 'oem-backdoor', label: 'OEM Service Port', description: 'Access manufacturer diagnostic ports that provide ADB-like access without dev mode.' },
  { value: 'fastboot-unlock', label: 'Fastboot OEM Unlock', description: 'Unlock bootloader via fastboot to gain system access without developer settings.' },
  { value: 'mtk-bypass', label: 'MediaTek BROM Bypass', description: 'Use MediaTek bootrom vulnerability to enable debug access without authentication.' },
  { value: 'qualcomm-edl', label: 'Qualcomm EDL Debug', description: 'Enter Qualcomm EDL mode to access device without USB debugging enabled.' },
  { value: 'samsung-jig', label: 'Samsung Download Mode', description: 'Force Samsung devices into download mode for direct access without ADB.' },
  { value: 'auth-bypass', label: 'USB Auth Bypass', description: 'Bypass USB debugging authorization prompt on already-enabled devices.' },
] as const;

export const AndroidBypass: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.ANDROID_ADB_BYPASS,
    progressChannel: IPC_CHANNELS.ANDROID_ADB_BYPASS_PROGRESS,
  });

  const [method, setMethod] = useState<string>('adb-push-exploit');
  const [outputFolder, setOutputFolder] = useState('');
  const [autoEnable, setAutoEnable] = useState(true);
  const [persistAdb, setPersistAdb] = useState(false);
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
      autoEnable,
      persistAdb,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Android ADB Bypass"
        description="Access Android devices without developer mode enabled or USB debugging active"
        icon={<Smartphone size={24} />}
      />

      <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>RESTRICTED:</strong> ADB bypass operations circumvent Android's security
            restrictions. Methods vary by manufacturer and chipset. Some exploits may require
            specific Android versions. Ensure valid legal authority before proceeding.
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
                checked={autoEnable}
                onChange={(e) => setAutoEnable(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Auto-enable ADB on device connection (no dev mode needed)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={persistAdb}
                onChange={(e) => setPersistAdb(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Persist ADB access across reboots
            </label>
          </div>

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Select folder for logs and exploit payloads..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Bypass in Progress...' : 'Start ADB Bypass'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Capabilities</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Force-enable ADB without developer settings access</li>
              <li>• OEM diagnostic port access (Samsung, LG, Huawei, Xiaomi)</li>
              <li>• Fastboot bootloader unlock for system access</li>
              <li>• MediaTek BROM exploit for MTK chipset devices</li>
              <li>• Qualcomm EDL mode for Snapdragon devices</li>
              <li>• Samsung download mode direct access</li>
              <li>• USB debugging auth prompt bypass</li>
              <li>• Persistent ADB access without user interaction</li>
            </ul>
          </div>

          <div className="rounded-lg border border-green-700/50 bg-green-900/20 p-3">
            <div className="flex items-start gap-2">
              <CheckCircle size={16} className="mt-0.5 shrink-0 text-green-400" />
              <div className="text-xs text-green-300">
                <strong>No Dev Mode Required:</strong> When enabled, Android devices plugged in
                will have ADB access established automatically without needing developer mode
                or USB debugging to be manually activated on the device.
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
        title="Confirm Android ADB Bypass"
        message="This will attempt to enable ADB access on the target device without developer mode. This bypasses Android's security protections and may modify system settings. Ensure legal authorization. Proceed?"
        confirmLabel="Start Bypass"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
