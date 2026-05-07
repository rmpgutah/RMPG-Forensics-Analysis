import React, { useState } from 'react';
import { KeyRound, Play, AlertTriangle } from 'lucide-react';
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

const DECRYPT_METHODS = [
  { value: 'aes-brute', label: 'AES Key Recovery', description: 'Attempt AES key extraction from memory dumps or key stores.' },
  { value: 'pattern-file', label: 'Pattern File Decrypt', description: 'Decrypt pattern/gesture lock files using known algorithms.' },
  { value: 'keystore-extract', label: 'Keystore Extraction', description: 'Extract and decrypt Android Keystore credentials.' },
  { value: 'fde-crack', label: 'Full Disk Encryption Crack', description: 'Attempt to recover FDE keys from device memory or footer.' },
  { value: 'file-decrypt', label: 'Encrypted File Decrypt', description: 'Decrypt encrypted files using dictionary/rainbow table attacks.' },
] as const;

export const AdvancedDecrypt: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.ADVANCED_DECRYPT,
    progressChannel: IPC_CHANNELS.ADVANCED_DECRYPT_PROGRESS,
  });

  const [method, setMethod] = useState<string>('aes-brute');
  const [outputFolder, setOutputFolder] = useState('');
  const [inputFile, setInputFile] = useState('');
  const [wordlistPath, setWordlistPath] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedMethod = DECRYPT_METHODS.find((m) => m.value === method);

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
      inputFile: inputFile || undefined,
      wordlistPath: wordlistPath || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advanced Decryption"
        description="Decrypt device credentials, encrypted files, and full-disk encryption using advanced cryptanalysis"
        icon={<KeyRound size={24} />}
      />

      <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Advanced decryption operations require proper authorization. These tools are designed
            for forensic analysis of seized devices where legal authority has been granted.
            Operations may take extended time depending on encryption strength.
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
            <label className="block text-sm font-medium text-slate-300">Decryption Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              {DECRYPT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            {selectedMethod && (
              <p className="text-xs text-slate-500">{selectedMethod.description}</p>
            )}
          </div>

          <FilePicker
            label="Input File (optional)"
            value={inputFile}
            onChange={setInputFile}
            placeholder="Select encrypted file or memory dump..."
            disabled={process.isRunning}
          />

          <FilePicker
            label="Wordlist / Key File (optional)"
            value={wordlistPath}
            onChange={setWordlistPath}
            placeholder="Select wordlist or key file..."
            disabled={process.isRunning}
          />

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Select folder to save decrypted data..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Decryption in Progress...' : 'Start Decryption'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Capabilities</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• AES-128/256 key brute force from memory dumps</li>
              <li>• Android gesture/PIN/password hash cracking</li>
              <li>• Keystore master key extraction</li>
              <li>• FDE footer analysis and key recovery</li>
              <li>• Dictionary and rainbow table attacks on encrypted files</li>
              <li>• Support for common encryption formats (dm-crypt, eCryptfs)</li>
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
        title="Confirm Advanced Decryption"
        message="This operation will attempt to crack encryption on the target. This may take significant time and computational resources. Ensure you have legal authority to decrypt this device/data. Proceed?"
        confirmLabel="Start Decryption"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
