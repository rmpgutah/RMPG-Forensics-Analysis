import React, { useState, useEffect } from 'react';
import { MessageSquare, Play, AlertTriangle, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  ProgressIndicator,
  FilePicker,
  DeviceSelector,
  ConfirmDialog,
} from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

const STEPS = [
  'Backup APK',
  'Downgrade WhatsApp',
  'Extract Data',
  'Restore Original',
];

export const WhatsAppExtraction: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.WHATSAPP_EXTRACT,
    progressChannel: IPC_CHANNELS.WHATSAPP_EXTRACT_PROGRESS,
  });

  const [packages, setPackages] = useState<string[]>([]);
  const [selectedPackage, setSelectedPackage] = useState('com.whatsapp');
  const [downgradeApk, setDowngradeApk] = useState('');
  const [extractOptions, setExtractOptions] = useState({
    contacts: true,
    media: true,
    databases: true,
  });
  const [currentStep, setCurrentStep] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [loadingPackages, setLoadingPackages] = useState(false);

  // Detect WhatsApp packages
  useEffect(() => {
    if (!selectedDevice) return;
    const detect = async () => {
      setLoadingPackages(true);
      try {
        const result = (await window.api.invoke(
          IPC_CHANNELS.WHATSAPP_LIST_PACKAGES,
          selectedDevice.serial
        )) as string[];
        setPackages(result ?? []);
        if (result && result.length > 0) setSelectedPackage(result[0]);
      } catch {
        setPackages([]);
      } finally {
        setLoadingPackages(false);
      }
    };
    detect();
  }, [selectedDevice]);

  // Track step from progress messages
  useEffect(() => {
    const msg = process.progress.message?.toLowerCase() ?? '';
    if (msg.includes('backup')) setCurrentStep(0);
    else if (msg.includes('downgrade')) setCurrentStep(1);
    else if (msg.includes('extract')) setCurrentStep(2);
    else if (msg.includes('restore')) setCurrentStep(3);
  }, [process.progress.message]);

  const handleStart = () => {
    setShowWarning(true);
  };

  const handleConfirmStart = async () => {
    setShowWarning(false);
    setCurrentStep(0);
    await process.start({
      serial: selectedDevice!.serial,
      packageName: selectedPackage,
      downgradApkPath: downgradeApk || undefined,
      extractContacts: extractOptions.contacts,
      extractMedia: extractOptions.media,
      extractDatabases: extractOptions.databases,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Extraction"
        description="Extract WhatsApp data using the downgrade method"
        icon={<MessageSquare size={24} />}
      />

      <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            The downgrade method temporarily replaces WhatsApp with an older version.
            App data may be affected during the process. A backup of the original APK
            is created first.
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
            <label className="block text-sm font-medium text-slate-300">
              WhatsApp Package
            </label>
            {loadingPackages ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                Detecting packages...
              </div>
            ) : (
              <select
                value={selectedPackage}
                onChange={(e) => setSelectedPackage(e.target.value)}
                disabled={process.isRunning}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                {packages.length === 0 && (
                  <option value="com.whatsapp">com.whatsapp (default)</option>
                )}
                {packages.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}
          </div>

          <FilePicker
            label="Downgrade APK (optional)"
            value={downgradeApk}
            onChange={setDowngradeApk}
            placeholder="Select older WhatsApp APK..."
            filters={[{ name: 'APK Files', extensions: ['apk'] }]}
            disabled={process.isRunning}
          />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-300">Extract Options</label>
            {[
              { key: 'contacts' as const, label: 'Extract Contacts' },
              { key: 'media' as const, label: 'Extract Media' },
              { key: 'databases' as const, label: 'Extract Databases' },
            ].map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center gap-2 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={extractOptions[key]}
                  onChange={() =>
                    setExtractOptions((prev) => ({ ...prev, [key]: !prev[key] }))
                  }
                  disabled={process.isRunning}
                  className="rounded border-slate-600 bg-slate-700 text-blue-500"
                />
                {label}
              </label>
            ))}
          </div>

          <button
            onClick={handleStart}
            disabled={process.isRunning || !selectedDevice}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Play size={16} />
            {process.isRunning ? 'Extraction in Progress...' : 'Start Extraction'}
          </button>
        </div>

        <div className="space-y-4">
          {/* Step progress */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-3 text-sm font-medium text-white">Extraction Steps</h4>
            <div className="space-y-2">
              {STEPS.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      i < currentStep
                        ? 'bg-green-600 text-white'
                        : i === currentStep && process.isRunning
                        ? 'bg-blue-600 text-white animate-pulse'
                        : 'bg-slate-700 text-slate-500'
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span
                    className={`text-sm ${
                      i <= currentStep && process.isRunning
                        ? 'text-white'
                        : 'text-slate-500'
                    }`}
                  >
                    {step}
                  </span>
                </div>
              ))}
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
        open={showWarning}
        title="Start WhatsApp Extraction?"
        message="This process will temporarily downgrade WhatsApp on the device. The original APK will be backed up first and restored afterward. App data may be temporarily inaccessible during extraction. Are you sure you want to proceed?"
        confirmLabel="Proceed"
        variant="warning"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowWarning(false)}
      />
    </div>
  );
};
