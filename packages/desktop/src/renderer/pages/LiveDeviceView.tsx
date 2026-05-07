import React, { useState, useCallback } from 'react';
import { Eye, FolderOpen, FileText, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  DeviceSelector,
} from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  permissions?: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  tag: string;
  message: string;
}

type ViewTab = 'files' | 'logs' | 'databases';

export const LiveDeviceView: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.LIVE_VIEW_STREAM,
    progressChannel: IPC_CHANNELS.LIVE_VIEW_STREAM_PROGRESS,
  });

  const [activeTab, setActiveTab] = useState<ViewTab>('files');
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['/']));

  const browseDirectory = useCallback(async (dirPath: string) => {
    if (!selectedDevice) return;
    setIsLoading(true);
    setFileContent(null);
    setSelectedFile(null);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.LIVE_VIEW_BROWSE, {
        serial: selectedDevice.serial,
        path: dirPath,
      });
      if (result?.files) {
        setFiles(result.files);
      }
      setCurrentPath(dirPath);
    } catch {
      // handled by process hook
    } finally {
      setIsLoading(false);
    }
  }, [selectedDevice]);

  const openFile = useCallback(async (filePath: string) => {
    if (!selectedDevice) return;
    setIsLoading(true);
    setSelectedFile(filePath);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.LIVE_VIEW_READ_FILE, {
        serial: selectedDevice.serial,
        path: filePath,
      });
      if (result?.content) {
        setFileContent(result.content);
      }
    } catch {
      setFileContent('[Error reading file]');
    } finally {
      setIsLoading(false);
    }
  }, [selectedDevice]);

  const loadLiveLogs = useCallback(async () => {
    if (!selectedDevice) return;
    setIsLoading(true);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.LIVE_VIEW_READ_LOGS, {
        serial: selectedDevice.serial,
        lines: 200,
      });
      if (result?.logs) {
        setLogs(result.logs);
      }
    } catch {
      // handled
    } finally {
      setIsLoading(false);
    }
  }, [selectedDevice]);

  const toggleDir = (dirPath: string) => {
    const next = new Set(expandedDirs);
    if (next.has(dirPath)) {
      next.delete(dirPath);
    } else {
      next.add(dirPath);
      browseDirectory(dirPath);
    }
    setExpandedDirs(next);
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Device View"
        description="Browse device files, logs, and databases in real-time — no backup required"
        icon={<Eye size={24} />}
      />

      <div className="rounded-lg border border-blue-700/50 bg-blue-900/20 p-3 text-sm text-blue-300">
        <div className="flex items-start gap-2">
          <Eye size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>LIVE MODE:</strong> Files and logs are read directly from the connected device
            in real-time. No backup or extraction is needed. Changes on the device are reflected
            immediately. Requires device access (ADB/USB trust established).
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-4">
        {/* Left panel */}
        <div className="space-y-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            disabled={isLoading}
          />

          {/* Tab selector */}
          <div className="flex rounded-md border border-slate-700 bg-slate-800/50 p-0.5">
            {(['files', 'logs', 'databases'] as ViewTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === 'files') browseDirectory('/');
                  if (tab === 'logs') loadLiveLogs();
                }}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium capitalize ${
                  activeTab === tab
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Quick paths */}
          {activeTab === 'files' && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-400 uppercase">Quick Access</p>
              {[
                { label: 'Root /', path: '/' },
                { label: 'DCIM (Photos)', path: '/sdcard/DCIM' },
                { label: 'Downloads', path: '/sdcard/Download' },
                { label: 'WhatsApp', path: '/sdcard/Android/media/com.whatsapp' },
                { label: 'App Data', path: '/data/data' },
                { label: 'System', path: '/system' },
                { label: 'Databases', path: '/data/data/com.android.providers.contacts/databases' },
                { label: 'Logs', path: '/data/log' },
              ].map((shortcut) => (
                <button
                  key={shortcut.path}
                  onClick={() => browseDirectory(shortcut.path)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-700/50"
                >
                  <FolderOpen size={12} />
                  {shortcut.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right panel - content area */}
        <div className="space-y-3">
          {/* Breadcrumb */}
          {activeTab === 'files' && (
            <div className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/50 px-3 py-2 text-xs text-slate-300">
              <button onClick={() => browseDirectory('/')} className="hover:text-white">
                /
              </button>
              {pathParts.map((part, i) => (
                <React.Fragment key={i}>
                  <ChevronRight size={10} className="text-slate-500" />
                  <button
                    onClick={() => browseDirectory('/' + pathParts.slice(0, i + 1).join('/'))}
                    className="hover:text-white"
                  >
                    {part}
                  </button>
                </React.Fragment>
              ))}
              <button
                onClick={() => browseDirectory(currentPath)}
                className="ml-auto text-slate-500 hover:text-white"
                title="Refresh"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          )}

          {/* File browser */}
          {activeTab === 'files' && !fileContent && (
            <div className="max-h-[500px] overflow-y-auto rounded border border-slate-700 bg-slate-900/50">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500 animate-pulse">
                  Loading live file listing...
                </div>
              ) : files.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  {selectedDevice ? 'Select a directory to browse or connect a device' : 'Connect a device to begin live browsing'}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-700 bg-slate-800/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-400">Name</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-400">Size</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-400">Permissions</th>
                      <th className="px-3 py-2 text-right font-medium text-slate-400">Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => (
                      <tr
                        key={file.path}
                        onClick={() =>
                          file.type === 'directory'
                            ? browseDirectory(file.path)
                            : openFile(file.path)
                        }
                        className="cursor-pointer border-b border-slate-800 hover:bg-slate-800/30"
                      >
                        <td className="px-3 py-1.5 text-slate-200">
                          <div className="flex items-center gap-2">
                            {file.type === 'directory' ? (
                              <FolderOpen size={12} className="text-yellow-400" />
                            ) : (
                              <FileText size={12} className="text-slate-400" />
                            )}
                            {file.name}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-500">
                          {file.size != null ? formatSize(file.size) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-500">
                          {file.permissions || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-500">
                          {file.modified || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* File content viewer */}
          {activeTab === 'files' && fileContent !== null && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setFileContent(null); setSelectedFile(null); }}
                  className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
                >
                  ← Back to directory
                </button>
                <span className="text-xs text-slate-400 font-mono">{selectedFile}</span>
              </div>
              <pre className="max-h-[500px] overflow-auto rounded border border-slate-700 bg-slate-900 p-3 text-xs text-slate-300 font-mono whitespace-pre-wrap">
                {fileContent}
              </pre>
            </div>
          )}

          {/* Live logs viewer */}
          {activeTab === 'logs' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">Live Device Logs (logcat / syslog)</span>
                <button
                  onClick={loadLiveLogs}
                  disabled={isLoading}
                  className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600 disabled:opacity-50"
                >
                  <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>
              <div className="max-h-[500px] overflow-y-auto rounded border border-slate-700 bg-slate-900/50 p-2 font-mono text-xs">
                {logs.length === 0 ? (
                  <div className="text-center text-slate-500 py-4">
                    {selectedDevice ? 'Click Refresh to load live logs' : 'Connect a device to view logs'}
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`py-0.5 ${getLogColor(log.level)}`}>
                      <span className="text-slate-600">{log.timestamp}</span>{' '}
                      <span className={`font-bold ${getLogLevelColor(log.level)}`}>{log.level}</span>{' '}
                      <span className="text-blue-400">{log.tag}</span>{' '}
                      <span>{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Live databases viewer */}
          {activeTab === 'databases' && (
            <div className="space-y-2">
              <div className="rounded border border-slate-700 bg-slate-800/50 p-4">
                <h4 className="mb-2 text-sm font-medium text-white">Live Database Access</h4>
                <p className="text-xs text-slate-400 mb-3">
                  Access SQLite databases directly on-device without extraction. 
                  Browse app databases, contacts, messages, and system stores in real-time.
                </p>
                <div className="space-y-1">
                  {[
                    { label: 'Contacts (contacts2.db)', path: '/data/data/com.android.providers.contacts/databases/contacts2.db' },
                    { label: 'SMS/MMS (mmssms.db)', path: '/data/data/com.android.providers.telephony/databases/mmssms.db' },
                    { label: 'Call Log (calllog.db)', path: '/data/data/com.android.providers.contacts/databases/calllog.db' },
                    { label: 'WiFi Settings', path: '/data/misc/wifi/WifiConfigStore.xml' },
                    { label: 'WhatsApp (msgstore.db)', path: '/data/data/com.whatsapp/databases/msgstore.db' },
                    { label: 'Chrome History', path: '/data/data/com.android.chrome/app_chrome/Default/History' },
                    { label: 'Settings (settings.db)', path: '/data/data/com.android.providers.settings/databases/settings.db' },
                  ].map((db) => (
                    <button
                      key={db.path}
                      onClick={() => openFile(db.path)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50 text-left"
                    >
                      <FileText size={12} className="text-blue-400 shrink-0" />
                      <span>{db.label}</span>
                      <span className="ml-auto text-[10px] text-slate-600 font-mono truncate max-w-[200px]">{db.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getLogColor(level: string): string {
  switch (level.toUpperCase()) {
    case 'E': return 'text-red-300';
    case 'W': return 'text-yellow-300';
    case 'I': return 'text-slate-300';
    case 'D': return 'text-slate-400';
    default: return 'text-slate-500';
  }
}

function getLogLevelColor(level: string): string {
  switch (level.toUpperCase()) {
    case 'E': return 'text-red-400';
    case 'W': return 'text-yellow-400';
    case 'I': return 'text-green-400';
    case 'D': return 'text-blue-400';
    default: return 'text-slate-500';
  }
}
