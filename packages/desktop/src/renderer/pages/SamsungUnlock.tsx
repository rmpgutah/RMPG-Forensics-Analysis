import React, { useState } from 'react';
import { Unlock, Play, Search, AlertTriangle } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FilePicker,
  PlatformGuard,
  ConfirmDialog,
} from '../components/common';
import { useIpc } from '../hooks';

export const SamsungUnlock: React.FC = () => {
  const ipc = useIpc();

  const [comPort, setComPort] = useState('');
  const [isDetecting, setIsDetecting] = useState(false);
  const [firmwarePath, setFirmwarePath] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const handleDetectPort = async () => {
    setIsDetecting(true);
    addLog('Detecting COM port...');
    try {
      const result = (await ipc.invoke(IPC_CHANNELS.SAMSUNG_DETECT_PORT)) as {
        port: string;
      };
      setComPort(result.port);
      addLog(`Detected port: ${result.port}`);
    } catch (err) {
      addLog(`Error detecting port: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDetecting(false);
    }
  };

  const handleUnlockClick = () => {
    if (!comPort || !firmwarePath) return;
    setShowConfirm(true);
  };

  const handleConfirmUnlock = async () => {
    setShowConfirm(false);
    setIsUnlocking(true);
    addLog('Starting Samsung unlock via ODIN...');
    try {
      await ipc.invoke(IPC_CHANNELS.SAMSUNG_UNLOCK, {
        comPort,
        firmwarePath,
      });
      addLog('Unlock process completed.');
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsUnlocking(false);
    }
  };

  const clearLogs = () => setLogs([]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Samsung Unlock"
        description="Unlock Samsung devices via firmware flashing (ODIN)"
        icon={<Unlock size={24} />}
      />

      <PlatformGuard
        platform="win32"
        fallbackMessage="Samsung ODIN unlock is only available on Windows"
      >
        <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Flashing firmware carries risk of bricking the device. Ensure you have
              the correct firmware for your device model. Proceed with caution.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">COM Port</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={comPort}
                  onChange={(e) => setComPort(e.target.value)}
                  placeholder="e.g., COM3"
                  disabled={isUnlocking}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleDetectPort}
                  disabled={isDetecting || isUnlocking}
                  className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  <Search size={14} />
                  {isDetecting ? 'Detecting...' : 'Detect'}
                </button>
              </div>
            </div>

            <FilePicker
              label="ROM / Firmware File"
              value={firmwarePath}
              onChange={setFirmwarePath}
              placeholder="Select firmware file..."
              filters={[
                { name: 'Firmware Files', extensions: ['tar', 'md5', 'zip', 'bin'] },
              ]}
              disabled={isUnlocking}
            />

            <button
              onClick={handleUnlockClick}
              disabled={isUnlocking || !comPort || !firmwarePath}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              {isUnlocking ? 'Unlock in Progress...' : 'Start Unlock'}
            </button>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
              <h4 className="mb-2 text-sm font-medium text-white">Prerequisites</h4>
              <ul className="space-y-1 text-xs text-slate-400">
                <li>1. Samsung USB drivers must be installed.</li>
                <li>2. Device must be in Download Mode (Volume Down + Power).</li>
                <li>3. Use correct firmware for the exact device model.</li>
                <li>4. Ensure battery is above 50%.</li>
              </ul>
            </div>
          </div>
        </div>

        <LogConsole logs={logs} onClear={clearLogs} />
      </PlatformGuard>

      <ConfirmDialog
        open={showConfirm}
        title="Confirm Samsung Unlock"
        message="Flashing firmware to this device may void its warranty and carries risk of rendering the device inoperable. This action cannot be undone. Are you sure you want to proceed?"
        confirmLabel="Proceed with Unlock"
        variant="danger"
        onConfirm={handleConfirmUnlock}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
