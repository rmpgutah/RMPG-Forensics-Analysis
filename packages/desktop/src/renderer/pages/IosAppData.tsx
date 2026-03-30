import React, { useState, useEffect } from 'react';
import {
  Apple,
  Package,
  ChevronRight,
  ChevronDown,
  Download,
  Loader2,
  Search,
  Database,
  FileText,
  FolderOpen,
  HardDrive,
  MessageCircle,
  Globe,
  Shield,
  Calendar,
  FileDown,
  RefreshCw,
  Eye,
  X,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppFile {
  name: string;
  path: string;
  size: number;
  type: 'database' | 'plist' | 'cache' | 'document' | 'media' | 'other';
  modified: string;
}

interface AppRecord {
  id: string;
  bundleId: string;
  displayName: string;
  version: string;
  shortVersion: string;
  totalSize: number;
  documentsSize: number;
  cacheSize: number;
  installDate: string;
  lastUsed: string;
  category: 'messaging' | 'social' | 'browser' | 'finance' | 'productivity' | 'other';
  isForensicInterest: boolean;
  forensicNotes: string;
  documents: AppFile[];
  caches: AppFile[];
  databases: AppFile[];
}

interface AppDataStats {
  totalApps: number;
  totalSize: number;
  messagingApps: number;
  socialApps: number;
  browserApps: number;
  forensicInterestApps: number;
  totalDatabases: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'messaging': return <MessageCircle size={16} className="text-green-400" />;
    case 'social': return <Globe size={16} className="text-blue-400" />;
    case 'browser': return <Globe size={16} className="text-purple-400" />;
    case 'finance': return <Shield size={16} className="text-yellow-400" />;
    default: return <Package size={16} style={{ color: 'var(--text-muted)' }} />;
  }
};

const getFileTypeIcon = (type: string) => {
  switch (type) {
    case 'database': return <Database size={14} className="text-orange-400" />;
    case 'plist': return <FileText size={14} className="text-blue-400" />;
    case 'cache': return <HardDrive size={14} className="text-gray-400" />;
    case 'document': return <FileText size={14} className="text-green-400" />;
    default: return <FileText size={14} style={{ color: 'var(--text-muted)' }} />;
  }
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosAppData: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [filteredApps, setFilteredApps] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [stats, setStats] = useState<AppDataStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showForensicOnly, setShowForensicOnly] = useState(false);
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
  const [selectedAppDetail, setSelectedAppDetail] = useState<AppRecord | null>(null);

  const handleBrowseBackup = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, { title: 'Select iOS Backup Folder' });
      if (result) setBackupPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleBrowseOutput = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, { title: 'Select Output Folder' });
      if (result) setOutputPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleScanApps = async () => {
    if (!backupPath) return;
    setLoading(true);
    setApps([]);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_APP_DATA, {
        backupPath,
      }) as { apps: AppRecord[]; stats: AppDataStats };
      setApps(result.apps);
      setStats(result.stats);
    } catch (err) {
      console.error('App scan failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExtractApp = async (appId: string) => {
    if (!outputPath) return;
    setExtracting(true);
    try {
      await window.api.invoke(IPC_CHANNELS.IOS_APP_DATA_EXTRACT, {
        backupPath,
        outputPath,
        appIds: [appId],
      });
    } catch (err) {
      console.error('App extract failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractAll = async () => {
    if (!outputPath) return;
    setExtracting(true);
    setExtractProgress(0);
    try {
      await window.api.invoke(IPC_CHANNELS.IOS_APP_DATA_EXTRACT, {
        backupPath,
        outputPath,
        extractAll: true,
      });
    } catch (err) {
      console.error('Bulk extract failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractForensic = async () => {
    if (!outputPath) return;
    setExtracting(true);
    try {
      const forensicIds = apps.filter((a) => a.isForensicInterest).map((a) => a.id);
      await window.api.invoke(IPC_CHANNELS.IOS_APP_DATA_EXTRACT, {
        backupPath,
        outputPath,
        appIds: forensicIds,
      });
    } catch (err) {
      console.error('Forensic extract failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  useEffect(() => {
    const cleanup = window.api.on(IPC_CHANNELS.IOS_APP_DATA_PROGRESS, (_event: unknown, data: { percent: number }) => {
      setExtractProgress(data.percent);
      if (data.percent >= 100) setExtracting(false);
    });
    return () => { cleanup?.(); };
  }, []);

  // Filters
  useEffect(() => {
    let result = [...apps];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          a.displayName.toLowerCase().includes(q) ||
          a.bundleId.toLowerCase().includes(q)
      );
    }

    if (categoryFilter !== 'all') result = result.filter((a) => a.category === categoryFilter);
    if (showForensicOnly) result = result.filter((a) => a.isForensicInterest);

    result.sort((a, b) => b.totalSize - a.totalSize);
    setFilteredApps(result);
  }, [apps, searchQuery, categoryFilter, showForensicOnly]);

  const toggleExpand = (id: string) => {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS App Data"
        description="Extract app-specific data for all installed apps — WhatsApp, Telegram, Signal, browser history, social media caches, and more"
        icon={<Apple size={24} />}
      />

      {/* Source + Output */}
      <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>iOS Backup Source</label>
            <div className="flex gap-2">
              <input type="text" value={backupPath} readOnly placeholder="Select iOS backup folder..." className="input-field flex-1" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              <button onClick={handleBrowseBackup} className="btn-secondary" disabled={loading}>Browse</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Output Folder</label>
            <div className="flex gap-2">
              <input type="text" value={outputPath} readOnly placeholder="Select output folder..." className="input-field flex-1" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              <button onClick={handleBrowseOutput} className="btn-secondary" disabled={extracting}>Browse</button>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleScanApps} className="btn-primary" disabled={!backupPath || loading}>
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <Package size={16} className="mr-2" />}
            {loading ? 'Scanning...' : 'Scan Installed Apps'}
          </button>
          {apps.length > 0 && (
            <>
              <button onClick={handleExtractForensic} className="btn-primary" disabled={!outputPath || extracting}>
                <Shield size={16} className="mr-2" /> Extract Forensic Interest
              </button>
              <button onClick={handleExtractAll} className="btn-secondary" disabled={!outputPath || extracting}>
                <Download size={16} className="mr-2" /> Extract All App Data
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress */}
      {extracting && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color: 'var(--text-primary)' }}>Extracting app data...</span>
            <span style={{ color: 'var(--text-secondary)' }}>{Math.round(extractProgress)}%</span>
          </div>
          <div className="w-full rounded-full h-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${extractProgress}%` }} />
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-7 gap-3">
          {[
            { label: 'Total Apps', value: stats.totalApps, color: 'text-blue-400' },
            { label: 'Total Size', value: formatBytes(stats.totalSize), color: 'text-green-400' },
            { label: 'Messaging', value: stats.messagingApps, color: 'text-green-400' },
            { label: 'Social', value: stats.socialApps, color: 'text-purple-400' },
            { label: 'Browsers', value: stats.browserApps, color: 'text-orange-400' },
            { label: 'Forensic Interest', value: stats.forensicInterestApps, color: 'text-red-400' },
            { label: 'Databases', value: stats.totalDatabases, color: 'text-yellow-400' },
          ].map((s) => (
            <div key={s.label} className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              <div className={`text-lg font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      {apps.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by app name or bundle ID..." className="input-field w-full pl-9" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            </div>

            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
              <option value="all">All Categories</option>
              <option value="messaging">Messaging</option>
              <option value="social">Social Media</option>
              <option value="browser">Browsers</option>
              <option value="finance">Finance</option>
              <option value="productivity">Productivity</option>
              <option value="other">Other</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={showForensicOnly} onChange={(e) => setShowForensicOnly(e.target.checked)} />
              Forensic interest only
            </label>

            <span className="text-sm ml-auto" style={{ color: 'var(--text-muted)' }}>
              {filteredApps.length} of {apps.length} apps
            </span>
          </div>
        </div>
      )}

      {/* App List */}
      {filteredApps.length > 0 && (
        <div className="space-y-2">
          {filteredApps.map((app) => {
            const isExpanded = expandedApps.has(app.id);
            const allFiles = [...app.documents, ...app.caches, ...app.databases];

            return (
              <div key={app.id} className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: app.isForensicInterest ? '1px solid #ef4444' : '1px solid var(--border-color)' }}>
                {/* App Header */}
                <div
                  className="p-4 flex items-center gap-3 cursor-pointer transition-colors"
                  onClick={() => toggleExpand(app.id)}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <button className="flex-shrink-0">
                    {isExpanded ? <ChevronDown size={18} style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight size={18} style={{ color: 'var(--text-secondary)' }} />}
                  </button>

                  {getCategoryIcon(app.category)}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{app.displayName}</span>
                      <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>v{app.shortVersion || app.version}</span>
                      {app.isForensicInterest && (
                        <span className="badge-danger text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Shield size={10} /> Forensic
                        </span>
                      )}
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{app.bundleId}</div>
                  </div>

                  <div className="flex items-center gap-6 flex-shrink-0 text-sm">
                    <div className="text-right">
                      <div style={{ color: 'var(--text-primary)' }}>{formatBytes(app.totalSize)}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Docs: {formatBytes(app.documentsSize)} / Cache: {formatBytes(app.cacheSize)}
                      </div>
                    </div>
                    <div className="text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                      <div>Installed: {new Date(app.installDate).toLocaleDateString()}</div>
                      <div>Last used: {new Date(app.lastUsed).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="badge-info text-xs px-2 py-0.5 rounded-full">{app.databases.length} DB</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{allFiles.length} files</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExtractApp(app.id); }}
                      className="btn-secondary text-xs"
                      disabled={!outputPath || extracting}
                    >
                      <Download size={14} />
                    </button>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--border-color)' }}>
                    {app.forensicNotes && (
                      <div className="mt-3 p-3 rounded text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                        <div className="font-medium text-red-400 mb-1 flex items-center gap-1"><Shield size={14} /> Forensic Notes</div>
                        <p style={{ color: 'var(--text-primary)' }}>{app.forensicNotes}</p>
                      </div>
                    )}

                    {/* Databases */}
                    {app.databases.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-sm font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                          <Database size={14} className="text-orange-400" /> Databases ({app.databases.length})
                        </h4>
                        <div className="space-y-1">
                          {app.databases.map((f, i) => (
                            <div key={i} className="flex items-center justify-between p-2 rounded text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                              <div className="flex items-center gap-2">
                                <Database size={14} className="text-orange-400" />
                                <span style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatBytes(f.size)}</span>
                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(f.modified).toLocaleDateString()}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Documents */}
                    {app.documents.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-sm font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                          <FolderOpen size={14} className="text-green-400" /> Documents ({app.documents.length})
                        </h4>
                        <div className="space-y-1">
                          {app.documents.slice(0, 10).map((f, i) => (
                            <div key={i} className="flex items-center justify-between p-2 rounded text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                              <div className="flex items-center gap-2">
                                {getFileTypeIcon(f.type)}
                                <span style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                              </div>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatBytes(f.size)}</span>
                            </div>
                          ))}
                          {app.documents.length > 10 && (
                            <div className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>... and {app.documents.length - 10} more files</div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Caches */}
                    {app.caches.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-sm font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                          <HardDrive size={14} className="text-gray-400" /> Caches ({app.caches.length})
                        </h4>
                        <div className="space-y-1">
                          {app.caches.slice(0, 5).map((f, i) => (
                            <div key={i} className="flex items-center justify-between p-2 rounded text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                              <div className="flex items-center gap-2">
                                {getFileTypeIcon(f.type)}
                                <span style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                              </div>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatBytes(f.size)}</span>
                            </div>
                          ))}
                          {app.caches.length > 5 && (
                            <div className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>... and {app.caches.length - 5} more cached files</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {!loading && apps.length === 0 && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Package size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and scan to view installed apps and their data</p>
        </div>
      )}
    </div>
  );
};
