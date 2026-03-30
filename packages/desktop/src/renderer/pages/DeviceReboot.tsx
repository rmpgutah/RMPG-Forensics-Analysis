import React, { useState } from 'react';
import {
  Power,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Shield,
  Wrench,
  Zap,
  Lock,
  Unlock,
  KeyRound,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, DeviceSelector, ConfirmDialog } from '../components/common';
import { useDeviceStatus, useIpc } from '../hooks';

type RebootMode = 'normal' | 'recovery' | 'bootloader' | 'fastboot';

interface RebootOption {
  mode: RebootMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  warning: string;
  dangerLevel: 'low' | 'medium' | 'high';
}

const REBOOT_OPTIONS: RebootOption[] = [
  {
    mode: 'normal',
    label: 'Normal Reboot',
    description: 'Standard device restart. Safe for all scenarios.',
    icon: <RotateCcw size={24} />,
    warning: 'The device will restart normally. Any unsaved data may be lost.',
    dangerLevel: 'low',
  },
  {
    mode: 'recovery',
    label: 'Recovery Mode',
    description: 'Boot into Android recovery environment for maintenance.',
    icon: <Wrench size={24} />,
    warning:
      'The device will boot into recovery mode. This provides access to factory reset, sideloading, and cache wipe operations.',
    dangerLevel: 'medium',
  },
  {
    mode: 'bootloader',
    label: 'Bootloader Mode',
    description: 'Boot into the bootloader for flashing and low-level access.',
    icon: <Shield size={24} />,
    warning:
      'The device will enter bootloader mode. Incorrect operations in this mode can brick the device.',
    dangerLevel: 'high',
  },
  {
    mode: 'fastboot',
    label: 'Fastboot Mode',
    description: 'Boot into fastboot for partition flashing and device unlocking.',
    icon: <Zap size={24} />,
    warning:
      'The device will enter fastboot mode. This is used for flashing partitions and can permanently modify the device.',
    dangerLevel: 'high',
  },
];

const DANGER_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  low: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', badge: 'badge-success' },
  medium: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', badge: 'badge-warning' },
  high: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'badge-danger' },
};

export const DeviceReboot: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const ipc = useIpc();

  const [rebooting, setRebooting] = useState(false);
  const [confirmMode, setConfirmMode] = useState<RebootMode | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // PIN management
  const [pinAction, setPinAction] = useState<'add' | 'remove'>('add');
  const [pinValue, setPinValue] = useState('');
  const [pinProcessing, setPinProcessing] = useState(false);

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleReboot = async (mode: RebootMode) => {
    setConfirmMode(null);
    if (!selectedDevice) return;
    setRebooting(true);
    addLog(`Rebooting device into ${mode} mode...`);

    try {
      const result = await ipc.invoke<{ success: boolean; message?: string }>(
        IPC_CHANNELS.DEVICE_REBOOT,
        {
          serial: selectedDevice.serial,
          mode,
        }
      );

      if (result?.success) {
        addLog(`Device reboot (${mode}) command sent successfully.`);
      } else {
        addLog(`Reboot failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRebooting(false);
    }
  };

  const handlePinAction = async () => {
    if (!selectedDevice) return;
    if (pinAction === 'add' && !pinValue) return;

    setPinProcessing(true);
    addLog(`${pinAction === 'add' ? 'Setting' : 'Removing'} device PIN...`);

    try {
      const result = await ipc.invoke<{ success: boolean; message?: string }>(
        IPC_CHANNELS.DEVICE_PIN,
        {
          serial: selectedDevice.serial,
          action: pinAction,
          pin: pinAction === 'add' ? pinValue : undefined,
        }
      );

      if (result?.success) {
        addLog(`PIN ${pinAction === 'add' ? 'set' : 'removed'} successfully.`);
        setPinValue('');
      } else {
        addLog(`PIN operation failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPinProcessing(false);
    }
  };

  const activeConfirmOption = REBOOT_OPTIONS.find((o) => o.mode === confirmMode);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Reboot"
        description="Reboot connected devices into various modes for maintenance and forensic operations"
        icon={<Power size={24} />}
      />

      {/* Device selection */}
      <div className="card">
        <DeviceSelector
          devices={allDevices}
          selected={selectedDevice}
          onSelect={selectDevice}
          onRefresh={refresh}
          filter="android"
          disabled={rebooting || pinProcessing}
        />
      </div>

      {/* Reboot mode buttons */}
      <div className="grid grid-cols-2 gap-4">
        {REBOOT_OPTIONS.map((opt) => {
          const colors = DANGER_COLORS[opt.dangerLevel];
          return (
            <div
              key={opt.mode}
              className={`card ${colors.bg} ${colors.border} border transition-all`}
            >
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-lg bg-[var(--bg-card)] shadow-sm ${colors.text}`}>
                  {opt.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">{opt.label}</h3>
                    <span className={`${colors.badge} text-[10px]`}>
                      {opt.dangerLevel === 'low'
                        ? 'Safe'
                        : opt.dangerLevel === 'medium'
                          ? 'Caution'
                          : 'Danger'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mb-3">{opt.description}</p>
                  <button
                    onClick={() => setConfirmMode(opt.mode)}
                    disabled={!selectedDevice || rebooting}
                    className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                      opt.dangerLevel === 'high'
                        ? 'btn-danger'
                        : opt.dangerLevel === 'medium'
                          ? 'bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg px-4 py-2 font-medium text-sm disabled:opacity-50'
                          : 'btn-primary'
                    }`}
                  >
                    {rebooting ? (
                      <span className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Rebooting...
                      </span>
                    ) : (
                      `Reboot to ${opt.label}`
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* PIN Management */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <KeyRound size={16} className="text-[#6495ED]" />
          PIN Management
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setPinAction('add')}
                className={`flex items-center gap-2 flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  pinAction === 'add'
                    ? 'bg-[#6495ED] text-white'
                    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
                disabled={pinProcessing}
              >
                <Lock size={14} />
                Add PIN
              </button>
              <button
                onClick={() => setPinAction('remove')}
                className={`flex items-center gap-2 flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  pinAction === 'remove'
                    ? 'bg-[#6495ED] text-white'
                    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
                disabled={pinProcessing}
              >
                <Unlock size={14} />
                Remove PIN
              </button>
            </div>

            {pinAction === 'add' && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">PIN Code</label>
                <input
                  type="password"
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value)}
                  placeholder="Enter PIN..."
                  maxLength={8}
                  className="input-field font-mono tracking-widest"
                  disabled={pinProcessing}
                />
              </div>
            )}

            <button
              onClick={handlePinAction}
              disabled={!selectedDevice || pinProcessing || (pinAction === 'add' && !pinValue)}
              className="btn-primary flex items-center gap-2 w-full justify-center"
            >
              {pinProcessing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : pinAction === 'add' ? (
                <Lock size={14} />
              ) : (
                <Unlock size={14} />
              )}
              {pinProcessing
                ? 'Processing...'
                : pinAction === 'add'
                  ? 'Set PIN'
                  : 'Remove PIN'}
            </button>
          </div>

          <div className="rounded-lg bg-[var(--bg-primary)] p-4 text-xs text-[var(--text-secondary)] leading-relaxed">
            <p className="font-medium text-[var(--text-primary)] mb-2 flex items-center gap-1">
              <AlertTriangle size={12} className="text-yellow-600" />
              Important Notes
            </p>
            <ul className="space-y-1 list-disc ml-4">
              <li>PIN operations require ADB debugging to be enabled on the device.</li>
              <li>Setting a PIN will lock the device with the specified code.</li>
              <li>Removing a PIN requires the device to be unlocked or have ADB root access.</li>
              <li>Some devices may not support remote PIN management.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmMode && activeConfirmOption && (
        <ConfirmDialog
          title={`Confirm: ${activeConfirmOption.label}`}
          message={activeConfirmOption.warning}
          confirmLabel={`Reboot to ${activeConfirmOption.label}`}
          variant={activeConfirmOption.dangerLevel === 'high' ? 'danger' : 'warning'}
          onConfirm={() => handleReboot(confirmMode)}
          onCancel={() => setConfirmMode(null)}
        />
      )}

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
