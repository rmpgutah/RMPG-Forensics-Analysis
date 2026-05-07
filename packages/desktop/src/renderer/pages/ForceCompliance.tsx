import React, { useState } from 'react';
import { DatabaseZap, Play, AlertTriangle, CheckCircle } from 'lucide-react';
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

const DATA_CATEGORIES = [
  { id: 'all', label: 'All Data (Full Extraction)', checked: true },
  { id: 'contacts', label: 'Contacts & Address Book', checked: true },
  { id: 'messages', label: 'SMS / MMS / iMessage', checked: true },
  { id: 'calls', label: 'Call Logs & Voicemail', checked: true },
  { id: 'media', label: 'Photos, Videos & Audio', checked: true },
  { id: 'apps', label: 'App Data & Databases', checked: true },
  { id: 'location', label: 'Location History & GPS', checked: true },
  { id: 'browser', label: 'Browser History & Bookmarks', checked: true },
  { id: 'social', label: 'Social Media & Messaging Apps', checked: true },
  { id: 'email', label: 'Email Accounts & Messages', checked: true },
  { id: 'wifi', label: 'WiFi & Network Credentials', checked: true },
  { id: 'accounts', label: 'Stored Accounts & Passwords', checked: true },
  { id: 'system', label: 'System Logs & Configuration', checked: true },
  { id: 'deleted', label: 'Deleted / Recoverable Data', checked: true },
];

export const ForceCompliance: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.FORCE_COMPLIANCE,
    progressChannel: IPC_CHANNELS.FORCE_COMPLIANCE_PROGRESS,
  });

  const [outputFolder, setOutputFolder] = useState('');
  const [categories, setCategories] = useState(DATA_CATEGORIES.map((c) => ({ ...c })));
  const [bypassEncryption, setBypassEncryption] = useState(true);
  const [includeDeleted, setIncludeDeleted] = useState(true);
  const [forceRoot, setForceRoot] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  const toggleCategory = (id: string) => {
    if (id === 'all') {
      const allChecked = categories[0].checked;
      setCategories(categories.map((c) => ({ ...c, checked: !allChecked })));
    } else {
      setCategories(categories.map((c) => c.id === id ? { ...c, checked: !c.checked } : c));
    }
  };

  const handleStartClick = () => {
    if (!selectedDevice || !outputFolder) return;
    setShowConfirm(true);
  };

  const handleConfirmStart = async () => {
    setShowConfirm(false);
    if (!selectedDevice || !outputFolder) return;
    await process.start({
      serial: selectedDevice.serial,
      outputPath: outputFolder,
      categories: categories.filter((c) => c.checked && c.id !== 'all').map((c) => c.id),
      bypassEncryption,
      includeDeleted,
      forceRoot,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Force Compliance"
        description="Force device to release all requested data categories — full extraction without restrictions"
        icon={<DatabaseZap size={24} />}
      />

      <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>FULL EXTRACTION:</strong> This operation forces the device to comply and
            release all selected data categories without user consent or interaction. Encryption
            bypass and root escalation will be attempted automatically. Ensure proper legal
            authority (warrant/court order) before proceeding.
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

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-3 text-sm font-medium text-white">Data Categories</h4>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {categories.map((cat) => (
                <label
                  key={cat.id}
                  className={`flex items-center gap-2 text-xs ${cat.id === 'all' ? 'font-bold text-white' : 'text-slate-300'}`}
                >
                  <input
                    type="checkbox"
                    checked={cat.checked}
                    onChange={() => toggleCategory(cat.id)}
                    disabled={process.isRunning}
                    className="rounded border-slate-600 bg-slate-800"
                  />
                  {cat.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={bypassEncryption}
                onChange={(e) => setBypassEncryption(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Auto-bypass encryption (FDE/FBE)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Include deleted / recoverable data
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={forceRoot}
                onChange={(e) => setForceRoot(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Force root/jailbreak escalation if needed
            </label>
          </div>

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Select folder to save extracted data..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !selectedDevice || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Extraction in Progress...' : 'Force Full Extraction'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-green-700/50 bg-green-900/20 p-3">
            <div className="flex items-start gap-2">
              <CheckCircle size={16} className="mt-0.5 shrink-0 text-green-400" />
              <div className="text-xs text-green-300">
                <strong>Full Compliance Mode:</strong> The device will release all requested
                data without prompts, passcodes, or user interaction. All data categories
                are extracted in a single pass with automatic privilege escalation.
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Extraction Methods</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Root/jailbreak escalation for unrestricted access</li>
              <li>• Encryption bypass (hardware key extraction)</li>
              <li>• Direct filesystem read (bypasses app sandboxing)</li>
              <li>• Database extraction from all apps</li>
              <li>• Keychain / credential store dumping</li>
              <li>• Deleted file carving and journal recovery</li>
              <li>• Protected storage access (secure enclave where possible)</li>
              <li>• Cloud token extraction for remote data access</li>
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
        title="Confirm Forced Data Extraction"
        message="This will force the device to release ALL selected data without any user interaction or consent prompts. This includes encrypted data, deleted files, and protected credentials. This is an invasive full extraction. Ensure legal authorization exists. Proceed?"
        confirmLabel="Force Extraction"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
