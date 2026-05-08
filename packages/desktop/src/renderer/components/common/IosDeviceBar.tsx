import React from 'react';
import { Apple, Zap, FolderOpen, CheckCircle, AlertCircle } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { useIosDevice } from '../../hooks/useIosDevice';

interface IosDeviceBarProps {
  backupPath: string;
  onBackupPath: (path: string) => void;
  disabled?: boolean;
}

/**
 * Drop-in bar for every iOS data-extraction page.
 *
 * Shows any connected iOS device whose local iTunes/Finder backup was found
 * and offers one-click population of the backup path.  Falls back to a manual
 * folder-picker when no device is connected or no backup exists.
 */
export const IosDeviceBar: React.FC<IosDeviceBarProps> = ({
  backupPath,
  onBackupPath,
  disabled = false,
}) => {
  const { iosDevices } = useIosDevice();

  const handleBrowse = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, {
        title: 'Select iOS Backup Folder',
      });
      if (result) onBackupPath(result as string);
    } catch { /* cancelled */ }
  };

  return (
    <div className="space-y-2">
      {/* Connected device quick-select */}
      {iosDevices.length > 0 && (
        <div className="rounded-lg border p-3 space-y-2"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}>
            <Apple size={12} />
            Connected iOS Devices
          </div>
          <div className="flex flex-wrap gap-2">
            {iosDevices.map((dev) => {
              const isActive = backupPath === dev.backupPath && dev.backupFound;
              return (
                <button
                  key={dev.udid}
                  onClick={() => dev.backupFound && onBackupPath(dev.backupPath)}
                  disabled={disabled || !dev.backupFound}
                  title={dev.backupFound
                    ? `Use backup: ${dev.backupPath}`
                    : 'No local backup found — run a backup first via iTunes or Finder'}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
                  style={{
                    border: `1px solid ${isActive ? '#6495ED' : 'var(--border-color)'}`,
                    backgroundColor: isActive ? 'rgba(100,149,237,0.12)' : 'var(--bg-secondary)',
                    color: dev.backupFound ? 'var(--text-primary)' : 'var(--text-muted)',
                    opacity: dev.backupFound ? 1 : 0.5,
                  }}
                >
                  {dev.backupFound
                    ? <CheckCircle size={13} className="text-green-400 shrink-0" />
                    : <AlertCircle size={13} className="text-yellow-500 shrink-0" />}
                  <span className="font-medium">{dev.label}</span>
                  {dev.backupFound && (
                    <span className="flex items-center gap-1 text-xs"
                      style={{ color: 'var(--text-muted)' }}>
                      <Zap size={10} className="text-green-400" />
                      Use
                    </span>
                  )}
                  {!dev.backupFound && (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      No backup
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Backup path field + browse button */}
      <div>
        <label className="block text-sm font-medium mb-1"
          style={{ color: 'var(--text-secondary)' }}>
          iOS Backup Source
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={backupPath}
            readOnly
            placeholder="Select iOS backup folder…"
            className="input-field flex-1 truncate"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          />
          <button
            onClick={handleBrowse}
            disabled={disabled}
            className="btn-secondary flex items-center gap-1.5"
          >
            <FolderOpen size={14} />
            Browse
          </button>
        </div>
        {backupPath && (
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {backupPath}
          </p>
        )}
      </div>
    </div>
  );
};
