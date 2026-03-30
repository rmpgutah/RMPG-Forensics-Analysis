import React, { useState, useEffect } from 'react';
import {
  Apple,
  Trash2,
  Image,
  MessageSquare,
  Phone,
  Users,
  StickyNote,
  Globe,
  Bell,
  Database,
  Loader2,
  Search,
  Download,
  FileDown,
  Shield,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Filter,
  BarChart3,
  Calendar,
  RefreshCw,
  Eye,
  X,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type DeletedCategory =
  | 'photo'
  | 'message'
  | 'call_log'
  | 'contact'
  | 'note'
  | 'browser_history'
  | 'app_data'
  | 'notification';

type ConfidenceLevel = 'high' | 'medium' | 'low';

type RecoverySource = 'recently_deleted' | 'sqlite_recovery' | 'wal_recovery' | 'plist_tombstone' | 'freelist_page' | 'journal_recovery';

interface DeletedRecord {
  id: string;
  category: DeletedCategory;
  title: string;
  description: string;
  originalPath: string;
  deletedDate: string;
  createdDate: string;
  recoverySource: RecoverySource;
  confidence: ConfidenceLevel;
  confidencePercent: number;
  dataSize: number;
  isRecoverable: boolean;
  previewData: string;
  metadata: Record<string, string>;
}

interface RecoveryStats {
  totalRecovered: number;
  photos: number;
  messages: number;
  callLogs: number;
  contacts: number;
  notes: number;
  browserHistory: number;
  appData: number;
  notifications: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  totalRecoverableSize: number;
}

interface DeletionTimelineEntry {
  date: string;
  count: number;
  categories: Record<DeletedCategory, number>;
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

const getCategoryIcon = (category: DeletedCategory) => {
  switch (category) {
    case 'photo': return <Image size={16} className="text-green-400" />;
    case 'message': return <MessageSquare size={16} className="text-blue-400" />;
    case 'call_log': return <Phone size={16} className="text-purple-400" />;
    case 'contact': return <Users size={16} className="text-orange-400" />;
    case 'note': return <StickyNote size={16} className="text-yellow-400" />;
    case 'browser_history': return <Globe size={16} className="text-cyan-400" />;
    case 'app_data': return <Database size={16} className="text-red-400" />;
    case 'notification': return <Bell size={16} className="text-pink-400" />;
  }
};

const getCategoryLabel = (category: DeletedCategory): string => {
  const labels: Record<DeletedCategory, string> = {
    photo: 'Photo/Video',
    message: 'Message',
    call_log: 'Call Log',
    contact: 'Contact',
    note: 'Note',
    browser_history: 'Browser History',
    app_data: 'App Data',
    notification: 'Notification',
  };
  return labels[category];
};

const getConfidenceIcon = (level: ConfidenceLevel) => {
  switch (level) {
    case 'high': return <CheckCircle size={14} className="text-green-400" />;
    case 'medium': return <AlertTriangle size={14} className="text-yellow-400" />;
    case 'low': return <HelpCircle size={14} className="text-red-400" />;
  }
};

const getConfidenceBadge = (level: ConfidenceLevel) => {
  switch (level) {
    case 'high': return 'badge-success';
    case 'medium': return 'text-yellow-400 bg-yellow-400/10';
    case 'low': return 'badge-danger';
  }
};

const getSourceLabel = (source: RecoverySource): string => {
  const labels: Record<RecoverySource, string> = {
    recently_deleted: 'Recently Deleted',
    sqlite_recovery: 'SQLite Recovery',
    wal_recovery: 'WAL Recovery',
    plist_tombstone: 'Plist Tombstone',
    freelist_page: 'Freelist Page',
    journal_recovery: 'Journal Recovery',
  };
  return labels[source];
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosDeletedData: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [records, setRecords] = useState<DeletedRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<DeletedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverProgress, setRecoverProgress] = useState(0);
  const [stats, setStats] = useState<RecoveryStats | null>(null);
  const [timeline, setTimeline] = useState<DeletionTimelineEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRecord, setSelectedRecord] = useState<DeletedRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const pageSize = 50;

  const handleBrowseBackup = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, { title: 'Select iOS Backup Folder' });
      if (result) setBackupPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleBrowseOutput = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, { title: 'Select Recovery Output Folder' });
      if (result) setOutputPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleScan = async () => {
    if (!backupPath) return;
    setLoading(true);
    setRecords([]);
    setStats(null);
    setTimeline([]);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_DELETED_RECOVER, {
        backupPath,
        scanOnly: true,
        deepScan: true,
      }) as {
        records: DeletedRecord[];
        stats: RecoveryStats;
        timeline: DeletionTimelineEntry[];
      };
      setRecords(result.records);
      setStats(result.stats);
      setTimeline(result.timeline);
    } catch (err) {
      console.error('Deleted data scan failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async (ids?: string[]) => {
    if (!outputPath) return;
    setRecovering(true);
    setRecoverProgress(0);
    try {
      await window.api.invoke(IPC_CHANNELS.IOS_DELETED_RECOVER, {
        backupPath,
        outputPath,
        recordIds: ids || (selectedIds.size > 0 ? Array.from(selectedIds) : undefined),
        recoverAll: !ids && selectedIds.size === 0,
      });
    } catch (err) {
      console.error('Recovery failed:', err);
    } finally {
      setRecovering(false);
    }
  };

  useEffect(() => {
    const cleanup = window.api.on(IPC_CHANNELS.IOS_DELETED_RECOVER_PROGRESS, (_event: unknown, data: { percent: number }) => {
      setRecoverProgress(data.percent);
      if (data.percent >= 100) setRecovering(false);
    });
    return () => { cleanup?.(); };
  }, []);

  // Filters
  useEffect(() => {
    let result = [...records];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.originalPath.toLowerCase().includes(q) ||
          r.previewData.toLowerCase().includes(q)
      );
    }

    if (categoryFilter !== 'all') result = result.filter((r) => r.category === categoryFilter);
    if (confidenceFilter !== 'all') result = result.filter((r) => r.confidence === confidenceFilter);
    if (sourceFilter !== 'all') result = result.filter((r) => r.recoverySource === sourceFilter);
    if (dateFrom) result = result.filter((r) => r.deletedDate >= dateFrom);
    if (dateTo) result = result.filter((r) => r.deletedDate <= dateTo);

    setFilteredRecords(result);
    setCurrentPage(1);
  }, [records, searchQuery, categoryFilter, confidenceFilter, sourceFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredRecords.length / pageSize);
  const paginatedRecords = filteredRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Deleted Data Recovery"
        description="Recover deleted photos, messages, call logs, contacts, notes, browser history, app data, and notifications from iOS backups"
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
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Recovery Output Folder</label>
            <div className="flex gap-2">
              <input type="text" value={outputPath} readOnly placeholder="Select output folder..." className="input-field flex-1" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              <button onClick={handleBrowseOutput} className="btn-secondary" disabled={recovering}>Browse</button>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleScan} className="btn-primary" disabled={!backupPath || loading}>
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <Search size={16} className="mr-2" />}
            {loading ? 'Deep Scanning...' : 'Scan for Deleted Data'}
          </button>
          {records.length > 0 && (
            <>
              <button onClick={() => handleRecover()} className="btn-primary" disabled={!outputPath || recovering}>
                {recovering ? <Loader2 size={16} className="animate-spin mr-2" /> : <RefreshCw size={16} className="mr-2" />}
                {selectedIds.size > 0 ? `Recover Selected (${selectedIds.size})` : 'Recover All'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Recovery Progress */}
      {recovering && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color: 'var(--text-primary)' }}>Recovering deleted data...</span>
            <span style={{ color: 'var(--text-secondary)' }}>{Math.round(recoverProgress)}%</span>
          </div>
          <div className="w-full rounded-full h-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="h-2 rounded-full bg-green-500 transition-all" style={{ width: `${recoverProgress}%` }} />
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="space-y-4">
          {/* Category Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Recovered', value: stats.totalRecovered.toLocaleString(), sub: formatBytes(stats.totalRecoverableSize), color: 'text-blue-400', icon: <Trash2 size={18} /> },
              { label: 'High Confidence', value: stats.highConfidence.toLocaleString(), sub: 'Fully recoverable', color: 'text-green-400', icon: <CheckCircle size={18} /> },
              { label: 'Medium Confidence', value: stats.mediumConfidence.toLocaleString(), sub: 'Partially recoverable', color: 'text-yellow-400', icon: <AlertTriangle size={18} /> },
              { label: 'Low Confidence', value: stats.lowConfidence.toLocaleString(), sub: 'Fragments only', color: 'text-red-400', icon: <HelpCircle size={18} /> },
            ].map((s) => (
              <div key={s.label} className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-center justify-between">
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                  <span className={s.color}>{s.icon}</span>
                </div>
                <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Category Breakdown */}
          <div className="grid grid-cols-8 gap-3">
            {[
              { label: 'Photos', value: stats.photos, icon: <Image size={16} />, color: 'text-green-400' },
              { label: 'Messages', value: stats.messages, icon: <MessageSquare size={16} />, color: 'text-blue-400' },
              { label: 'Call Logs', value: stats.callLogs, icon: <Phone size={16} />, color: 'text-purple-400' },
              { label: 'Contacts', value: stats.contacts, icon: <Users size={16} />, color: 'text-orange-400' },
              { label: 'Notes', value: stats.notes, icon: <StickyNote size={16} />, color: 'text-yellow-400' },
              { label: 'Browser', value: stats.browserHistory, icon: <Globe size={16} />, color: 'text-cyan-400' },
              { label: 'App Data', value: stats.appData, icon: <Database size={16} />, color: 'text-red-400' },
              { label: 'Notifications', value: stats.notifications, icon: <Bell size={16} />, color: 'text-pink-400' },
            ].map((s) => (
              <div key={s.label} className="card p-3 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className={`mx-auto mb-1 ${s.color}`}>{s.icon}</div>
                <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deletion Timeline */}
      {timeline.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <BarChart3 size={16} className="text-blue-400" /> Deletion Timeline
          </h3>
          <div className="flex gap-1 items-end" style={{ height: '100px' }}>
            {timeline.map((entry, i) => {
              const maxCount = Math.max(...timeline.map((t) => t.count));
              const height = maxCount > 0 ? (entry.count / maxCount) * 100 : 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center group relative">
                  <div
                    className="w-full rounded-t bg-blue-500/60 hover:bg-blue-500 transition-colors cursor-pointer"
                    style={{ height: `${Math.max(height, 2)}%`, minHeight: '2px' }}
                    title={`${entry.date}: ${entry.count} deletions`}
                  />
                  {i % Math.ceil(timeline.length / 8) === 0 && (
                    <span className="text-[10px] mt-1 rotate-45 origin-left" style={{ color: 'var(--text-muted)' }}>
                      {new Date(entry.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      {records.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search deleted data..." className="input-field w-full pl-9" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            </div>

            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
              <option value="all">All Categories</option>
              <option value="photo">Photos/Videos</option>
              <option value="message">Messages</option>
              <option value="call_log">Call Logs</option>
              <option value="contact">Contacts</option>
              <option value="note">Notes</option>
              <option value="browser_history">Browser History</option>
              <option value="app_data">App Data</option>
              <option value="notification">Notifications</option>
            </select>

            <select value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
              <option value="all">All Confidence</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
              <option value="all">All Sources</option>
              <option value="recently_deleted">Recently Deleted</option>
              <option value="sqlite_recovery">SQLite Recovery</option>
              <option value="wal_recovery">WAL Recovery</option>
              <option value="plist_tombstone">Plist Tombstone</option>
              <option value="freelist_page">Freelist Page</option>
              <option value="journal_recovery">Journal Recovery</option>
            </select>

            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            <span style={{ color: 'var(--text-muted)' }}>to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
          </div>
          <div className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            {filteredRecords.length.toLocaleString()} of {records.length.toLocaleString()} deleted items
          </div>
        </div>
      )}

      {/* Records Table */}
      {paginatedRecords.length > 0 && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <th className="px-3 py-2 text-center w-8" style={{ color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === paginatedRecords.length && paginatedRecords.length > 0}
                      onChange={() => {
                        if (selectedIds.size === paginatedRecords.length) {
                          setSelectedIds(new Set());
                        } else {
                          setSelectedIds(new Set(paginatedRecords.map((r) => r.id)));
                        }
                      }}
                    />
                  </th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Category</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Title</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Preview</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Deleted Date</th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Confidence</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Source</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Size</th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRecords.map((record) => (
                  <tr
                    key={record.id}
                    className="transition-colors"
                    style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: selectedIds.has(record.id) ? 'var(--bg-hover)' : 'transparent' }}
                    onMouseEnter={(e) => { if (!selectedIds.has(record.id)) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { if (!selectedIds.has(record.id)) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(record.id)}
                        onChange={() => toggleSelect(record.id)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(record.category)}
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{getCategoryLabel(record.category)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium max-w-[200px] truncate" style={{ color: 'var(--text-primary)' }}>
                      {record.title}
                    </td>
                    <td className="px-3 py-2 max-w-[250px] truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                      {record.previewData || record.description}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(record.deletedDate).toLocaleDateString()}{' '}
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(record.deletedDate).toLocaleTimeString()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${getConfidenceBadge(record.confidence)}`}>
                        {getConfidenceIcon(record.confidence)}
                        {record.confidence} ({record.confidencePercent}%)
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {getSourceLabel(record.recoverySource)}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {formatBytes(record.dataSize)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => setSelectedRecord(record)} className="btn-secondary p-1" title="View Details">
                          <Eye size={14} />
                        </button>
                        {record.isRecoverable && (
                          <button
                            onClick={() => handleRecover([record.id])}
                            className="btn-primary p-1"
                            disabled={!outputPath || recovering}
                            title="Recover"
                          >
                            <Download size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border-color)' }}>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {currentPage} of {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="btn-secondary text-sm"><ChevronLeft size={14} /> Prev</button>
              <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="btn-secondary text-sm">Next <ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      )}

      {/* Record Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setSelectedRecord(null)}>
          <div className="card p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                {getCategoryIcon(selectedRecord.category)}
                Deleted {getCategoryLabel(selectedRecord.category)} Detail
              </h3>
              <button onClick={() => setSelectedRecord(null)} className="btn-secondary p-1"><X size={18} /></button>
            </div>

            <div className="space-y-3 text-sm">
              {[
                { label: 'Title', value: selectedRecord.title },
                { label: 'Category', value: getCategoryLabel(selectedRecord.category) },
                { label: 'Original Path', value: selectedRecord.originalPath },
                { label: 'Created Date', value: new Date(selectedRecord.createdDate).toLocaleString() },
                { label: 'Deleted Date', value: new Date(selectedRecord.deletedDate).toLocaleString() },
                { label: 'Recovery Source', value: getSourceLabel(selectedRecord.recoverySource) },
                { label: 'Data Size', value: formatBytes(selectedRecord.dataSize) },
                { label: 'Recoverable', value: selectedRecord.isRecoverable ? 'Yes' : 'No' },
              ].map((r) => (
                <div key={r.label} className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{r.value}</span>
                </div>
              ))}

              <div className="flex justify-between py-1 items-center" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Confidence</span>
                <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${getConfidenceBadge(selectedRecord.confidence)}`}>
                  {getConfidenceIcon(selectedRecord.confidence)}
                  {selectedRecord.confidence} ({selectedRecord.confidencePercent}%)
                </span>
              </div>

              {selectedRecord.description && (
                <div>
                  <span className="font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Description</span>
                  <div className="p-3 rounded" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                    {selectedRecord.description}
                  </div>
                </div>
              )}

              {selectedRecord.previewData && (
                <div>
                  <span className="font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Data Preview</span>
                  <div className="p-3 rounded font-mono text-xs overflow-x-auto" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                    {selectedRecord.previewData}
                  </div>
                </div>
              )}

              {Object.keys(selectedRecord.metadata).length > 0 && (
                <div>
                  <span className="font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Metadata</span>
                  {Object.entries(selectedRecord.metadata).map(([key, val]) => (
                    <div key={key} className="flex justify-between py-0.5 text-xs">
                      <span style={{ color: 'var(--text-muted)' }}>{key}</span>
                      <span style={{ color: 'var(--text-primary)' }}>{val}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              {selectedRecord.isRecoverable && (
                <button onClick={() => { handleRecover([selectedRecord.id]); setSelectedRecord(null); }} className="btn-primary" disabled={!outputPath || recovering}>
                  <Download size={14} className="mr-1" /> Recover This Item
                </button>
              )}
              <button onClick={() => setSelectedRecord(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && records.length === 0 && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Trash2 size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and scan to discover recoverable deleted data</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Deep scan analyzes SQLite databases, WAL files, plist tombstones, freelist pages, and journal files
          </p>
        </div>
      )}
    </div>
  );
};
