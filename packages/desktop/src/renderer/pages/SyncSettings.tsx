import React, { useState, useEffect } from 'react';
import { RefreshCw, Upload, Download, Cloud, CloudOff } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';
import { useIpc } from '../hooks';
import { fmtDate, fmtTime, fmtDateTime } from '../utils/formatDate';

interface SyncStatus {
  connected: boolean;
  lastSyncTime: string | null;
  autoSync: boolean;
}

export const SyncSettings: React.FC = () => {
  const ipc = useIpc();

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    connected: false,
    lastSyncTime: null,
    autoSync: false,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchStatus = async () => {
    setIsRefreshing(true);
    try {
      const result = (await ipc.invoke(IPC_CHANNELS.SYNC_STATUS)) as SyncStatus;
      setSyncStatus(result);
    } catch {
      // Error handled silently
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleUpload = async () => {
    setIsUploading(true);
    try {
      await ipc.invoke(IPC_CHANNELS.SYNC_UPLOAD);
      await fetchStatus();
    } catch {
      // Error handled silently
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await ipc.invoke(IPC_CHANNELS.SYNC_DOWNLOAD);
      await fetchStatus();
    } catch {
      // Error handled silently
    } finally {
      setIsDownloading(false);
    }
  };

  const toggleAutoSync = async () => {
    const newValue = !syncStatus.autoSync;
    setSyncStatus((prev) => ({ ...prev, autoSync: newValue }));
    try {
      await ipc.invoke(IPC_CHANNELS.SYNC_STATUS, { autoSync: newValue });
    } catch {
      setSyncStatus((prev) => ({ ...prev, autoSync: !newValue }));
    }
  };

  const formatLastSync = (time: string | null): string => {
    if (!time) return 'Never';
    try {
      return fmtDateTime(time);
    } catch {
      return time;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sync Settings"
        description="Manage Firebase cloud sync for case data"
        icon={<RefreshCw size={24} />}
      />

      {/* Status card */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {syncStatus.connected ? (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-900/30">
                <Cloud size={20} className="text-green-400" />
              </div>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-hover)]">
                <CloudOff size={20} className="text-[var(--text-secondary)]" />
              </div>
            )}
            <div>
              <h4 className="text-sm font-medium text-[var(--text-primary)]">
                {syncStatus.connected ? 'Connected' : 'Disconnected'}
              </h4>
              <p className="text-xs text-[var(--text-secondary)]">
                Last sync: {formatLastSync(syncStatus.lastSyncTime)}
              </p>
            </div>
          </div>

          <button
            onClick={fetchStatus}
            disabled={isRefreshing}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Sync actions */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Sync Actions</h3>

          <button
            onClick={handleUpload}
            disabled={isUploading || !syncStatus.connected}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload size={16} />
            {isUploading ? 'Uploading...' : 'Upload Case Data'}
          </button>

          <button
            onClick={handleDownload}
            disabled={isDownloading || !syncStatus.connected}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            {isDownloading ? 'Downloading...' : 'Download Case Data'}
          </button>
        </div>

        {/* Settings */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Preferences</h3>

          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-[var(--text-primary)]">Auto-Sync</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  Automatically sync case data when changes are detected
                </p>
              </div>
              <button
                onClick={toggleAutoSync}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  syncStatus.autoSync ? 'bg-blue-600' : 'bg-[var(--bg-hover)]'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-[var(--bg-card)] transition-transform ${
                    syncStatus.autoSync ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <h4 className="mb-2 text-sm font-medium text-[var(--text-primary)]">Sync Information</h4>
            <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
              <li>Case data is synced to Firebase Cloud Storage.</li>
              <li>Only case metadata and reports are synced.</li>
              <li>Raw device images are not uploaded.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
