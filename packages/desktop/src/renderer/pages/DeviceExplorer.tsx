import React, { useState, useCallback } from 'react';
import {
  FolderOpen,
  File,
  Folder,
  ChevronRight,
  ArrowUp,
  Download,
  Upload,
  Trash2,
  Loader2,
  RefreshCw,
  Home,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, DeviceSelector, FolderPicker } from '../components/common';
import { useDeviceStatus } from '../hooks';

interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modified: string;
  permissions: string;
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const DeviceExplorer: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const [currentPath, setCurrentPath] = useState('/sdcard');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [localFolder, setLocalFolder] = useState('');
  const [pathInput, setPathInput] = useState('/sdcard');

  const fetchEntries = useCallback(
    async (path: string) => {
      if (!selectedDevice) return;
      setLoading(true);
      setError(null);
      setSelectedEntries(new Set());
      try {
        const result = (await window.api.invoke(IPC_CHANNELS.FILE_EXPLORE, {
          serial: selectedDevice.serial,
          path,
        })) as FileEntry[];
        setEntries(result ?? []);
        setCurrentPath(path);
        setPathInput(path);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedDevice]
  );

  const navigateTo = (path: string) => {
    fetchEntries(path);
  };

  const navigateUp = () => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parent);
  };

  const handleEntryClick = (entry: FileEntry) => {
    if (entry.type === 'directory') {
      const newPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      navigateTo(newPath);
    }
  };

  const toggleSelect = (name: string) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handlePull = async () => {
    if (!selectedDevice || !localFolder || selectedEntries.size === 0) return;
    setPulling(true);
    try {
      const paths = Array.from(selectedEntries).map((name) =>
        currentPath === '/' ? `/${name}` : `${currentPath}/${name}`
      );
      await window.api.invoke(IPC_CHANNELS.FILE_PULL, {
        serial: selectedDevice.serial,
        remotePaths: paths,
        localPath: localFolder,
      });
      setSelectedEntries(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
    }
  };

  const handlePush = async () => {
    if (!selectedDevice || !localFolder) return;
    setPushing(true);
    try {
      const files = (await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, {
        properties: ['openFile', 'multiSelections'],
        defaultPath: localFolder,
      })) as string[] | null;
      if (files && files.length > 0) {
        await window.api.invoke(IPC_CHANNELS.FILE_PUSH, {
          serial: selectedDevice.serial,
          localPaths: files,
          remotePath: currentPath,
        });
        fetchEntries(currentPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedDevice || selectedEntries.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedEntries.size} selected item(s)? This cannot be undone.`
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      const paths = Array.from(selectedEntries).map((name) =>
        currentPath === '/' ? `/${name}` : `${currentPath}/${name}`
      );
      await window.api.invoke(IPC_CHANNELS.FILE_DELETE, {
        serial: selectedDevice.serial,
        paths,
      });
      setSelectedEntries(new Set());
      fetchEntries(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pathInput.trim()) navigateTo(pathInput.trim());
  };

  const breadcrumbs = currentPath.split('/').filter(Boolean);
  const isBusy = pulling || pushing || deleting;
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Explorer"
        description="Browse and manage files on an Android device file system"
        icon={<FolderOpen size={24} />}
      />

      <div className="grid grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Device</h3>
            <DeviceSelector
              devices={allDevices}
              selected={selectedDevice}
              onSelect={(d) => {
                selectDevice(d);
                setEntries([]);
                setCurrentPath('/sdcard');
                setPathInput('/sdcard');
              }}
              onRefresh={refresh}
              filter="android"
              disabled={isBusy}
            />
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Local Folder</h3>
            <FolderPicker
              label=""
              value={localFolder}
              onChange={setLocalFolder}
              disabled={isBusy}
            />
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Quick Navigation</h3>
            <div className="space-y-1">
              {['/sdcard', '/sdcard/DCIM', '/sdcard/Download', '/sdcard/WhatsApp', '/data/data', '/system'].map(
                (p) => (
                  <button
                    key={p}
                    onClick={() => navigateTo(p)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[#6495ED] transition-colors text-left"
                  >
                    <Folder size={12} />
                    {p}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={handlePull}
              disabled={!selectedDevice || !localFolder || selectedEntries.size === 0 || isBusy}
              className="btn-primary flex w-full items-center justify-center gap-2 text-sm"
            >
              {pulling ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Pull Selected
            </button>

            <button
              onClick={handlePush}
              disabled={!selectedDevice || !localFolder || isBusy}
              className="btn-secondary flex w-full items-center justify-center gap-2 text-sm"
            >
              {pushing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Push Files
            </button>

            <button
              onClick={handleDelete}
              disabled={!selectedDevice || selectedEntries.size === 0 || isBusy}
              className="btn-danger flex w-full items-center justify-center gap-2 text-sm"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Delete Selected
            </button>
          </div>
        </div>

        {/* File Browser */}
        <div className="col-span-3 space-y-4">
          {/* Path bar */}
          <div className="card !p-3">
            <form onSubmit={handlePathSubmit} className="flex items-center gap-2">
              <button
                type="button"
                onClick={navigateUp}
                disabled={currentPath === '/' || loading}
                className="btn-ghost !p-2"
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                onClick={() => navigateTo('/sdcard')}
                disabled={loading}
                className="btn-ghost !p-2"
              >
                <Home size={16} />
              </button>
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                className="input-field flex-1 text-sm font-mono"
              />
              <button type="submit" disabled={loading} className="btn-primary text-sm !px-3">
                Go
              </button>
              <button
                type="button"
                onClick={() => fetchEntries(currentPath)}
                disabled={loading}
                className="btn-ghost !p-2"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
            </form>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <button onClick={() => navigateTo('/')} className="hover:text-[#6495ED]">
              /
            </button>
            {breadcrumbs.map((part, i) => (
              <React.Fragment key={i}>
                <ChevronRight size={10} />
                <button
                  onClick={() => navigateTo('/' + breadcrumbs.slice(0, i + 1).join('/'))}
                  className="hover:text-[#6495ED]"
                >
                  {part}
                </button>
              </React.Fragment>
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* File listing */}
          <div className="card !p-0 overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[auto_1fr_100px_160px_100px] gap-2 border-b border-[var(--border-color)] bg-[var(--bg-hover)] px-4 py-2 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
              <div className="w-6" />
              <div>Name</div>
              <div className="text-right">Size</div>
              <div>Modified</div>
              <div>Permissions</div>
            </div>

            <div className="max-h-[520px] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
                  <Loader2 size={24} className="animate-spin" />
                  <span className="ml-2 text-sm">Loading directory...</span>
                </div>
              ) : sortedEntries.length === 0 ? (
                <div className="py-16 text-center text-sm text-[var(--text-muted)]">
                  {selectedDevice
                    ? 'Empty directory or unable to read contents.'
                    : 'Select a device and browse to a directory.'}
                </div>
              ) : (
                sortedEntries.map((entry) => (
                  <div
                    key={entry.name}
                    className={`grid grid-cols-[auto_1fr_100px_160px_100px] gap-2 items-center px-4 py-2 text-sm border-b border-[var(--border-color)] hover:bg-[#F0F0FF] cursor-pointer transition-colors ${
                      selectedEntries.has(entry.name) ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="w-6">
                      <input
                        type="checkbox"
                        checked={selectedEntries.has(entry.name)}
                        onChange={() => toggleSelect(entry.name)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
                      />
                    </div>
                    <div
                      className="flex items-center gap-2 truncate"
                      onDoubleClick={() => handleEntryClick(entry)}
                    >
                      {entry.type === 'directory' ? (
                        <Folder size={16} className="shrink-0 text-[#6495ED]" />
                      ) : (
                        <File size={16} className="shrink-0 text-[var(--text-muted)]" />
                      )}
                      <span className={`truncate ${entry.type === 'directory' ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                        {entry.name}
                      </span>
                    </div>
                    <div className="text-right text-xs text-[var(--text-muted)]">
                      {entry.type === 'file' ? formatSize(entry.size) : '--'}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">{entry.modified || '--'}</div>
                    <div className="font-mono text-xs text-[var(--text-muted)]">{entry.permissions || '--'}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>
              {sortedEntries.length} item(s) &middot; {selectedEntries.size} selected
            </span>
            <span>{currentPath}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
