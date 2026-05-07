import React, { useState } from 'react';
import { Apple, Play, Lock } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  ProgressIndicator,
} from '../components/common';
import { useProcess } from '../hooks';

export const IosBackupDecrypt: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.IOS_BACKUP_DECRYPT,
    progressChannel: IPC_CHANNELS.IOS_BACKUP_DECRYPT_PROGRESS,
  });

  const [backupFolder, setBackupFolder] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [password, setPassword] = useState('');

  const handleStart = async () => {
    if (!backupFolder || !outputFolder || !password) return;
    await process.start({
      backupPath: backupFolder,
      outputPath: outputFolder,
      password,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Backup Decrypt"
        description="Decrypt encrypted iOS backups using the backup password"
        icon={<Apple size={24} />}
      />

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <FolderPicker
              label="Encrypted Backup Folder"
              value={backupFolder}
              onChange={setBackupFolder}
              placeholder="Select encrypted iOS backup folder..."
              disabled={process.isRunning}
            />

            <FolderPicker
              label="Decrypted Output Folder"
              value={outputFolder}
              onChange={setOutputFolder}
              placeholder="Select output folder for decrypted files..."
              disabled={process.isRunning}
            />

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">
                Backup Password
              </label>
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter backup password..."
                  disabled={process.isRunning}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
            </div>

            <button
              onClick={handleStart}
              disabled={process.isRunning || !backupFolder || !outputFolder || !password}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              {process.isRunning ? 'Decrypting...' : 'Start Decryption'}
            </button>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
              <h4 className="mb-2 text-sm font-medium text-white">Instructions</h4>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>1. Select the encrypted iOS backup folder (contains Manifest.db).</li>
                <li>2. Choose an output folder for decrypted files.</li>
                <li>3. Enter the backup password set on the device.</li>
                <li>4. Click Start Decryption to begin the process.</li>
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
    </div>
  );
};
