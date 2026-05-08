import React, { useState, useEffect } from 'react';
import {
  Apple,
  Globe,
  Bookmark,
  Download,
  Loader2,
  Search,
  FileDown,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronExpand,
  ExternalLink,
  Star,
  Clock,
  Folder,
  FolderOpen,
  Layers,
  BarChart3,
  ArrowUpDown,
  X,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, IosDeviceBar } from '../components/common';
import { fmtDate, fmtTime, fmtDateTime } from '../utils/formatDate';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitDate: string;
  visitCount: number;
  redirectSource: string;
  duration: number; // seconds spent on page
  domain: string;
}

interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  type: 'folder' | 'bookmark';
  children?: BookmarkNode[];
  dateAdded: string;
}

interface OpenTab {
  id: string;
  title: string;
  url: string;
  lastViewed: string;
  isPrivate: boolean;
}

interface DownloadEntry {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  date: string;
  status: 'completed' | 'failed' | 'cancelled';
}

interface AutofillEntry {
  id: string;
  field: string;
  value: string;
  domain: string;
  lastUsed: string;
  useCount: number;
}

interface SafariStats {
  totalHistory: number;
  totalBookmarks: number;
  totalOpenTabs: number;
  totalDownloads: number;
  totalAutofill: number;
  uniqueDomains: number;
  dateRange: { earliest: string; latest: string };
}

type ActiveTab = 'history' | 'bookmarks' | 'tabs' | 'downloads' | 'autofill';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatDuration = (seconds: number): string => {
  if (seconds === 0) return '-';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/* ------------------------------------------------------------------ */
/*  Bookmark Tree Subcomponent                                         */
/* ------------------------------------------------------------------ */

const BookmarkTreeNode: React.FC<{ node: BookmarkNode; depth: number }> = ({ node, depth }) => {
  const [expanded, setExpanded] = useState(depth < 2);

  if (node.type === 'folder') {
    return (
      <div>
        <div
          className="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer text-sm"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronExpand size={14} />}
          {expanded ? <FolderOpen size={14} className="text-yellow-400" /> : <Folder size={14} className="text-yellow-400" />}
          <span style={{ color: 'var(--text-primary)' }}>{node.title}</span>
          {node.children && (
            <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>
              ({node.children.length})
            </span>
          )}
        </div>
        {expanded && node.children?.map((child) => (
          <BookmarkTreeNode key={child.id} node={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 py-1 px-2 rounded text-sm"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <Star size={12} className="text-blue-400 flex-shrink-0" />
      <span className="truncate" style={{ color: 'var(--text-primary)' }}>{node.title || node.url}</span>
      {node.url && (
        <span className="text-xs truncate flex-shrink-0 ml-auto" style={{ color: 'var(--text-muted)', maxWidth: '200px' }}>
          {extractDomain(node.url)}
        </span>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosSafariHistory: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('history');

  // Data stores
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [filteredHistory, setFilteredHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkNode[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [autofill, setAutofill] = useState<AutofillEntry[]>([]);
  const [stats, setStats] = useState<SafariStats | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<'visitDate' | 'visitCount' | 'duration' | 'title'>('visitDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const pageSize = 50;

  const handleExtract = async () => {
    if (!backupPath) return;
    setLoading(true);
    setHistory([]);
    setBookmarks([]);
    setOpenTabs([]);
    setDownloads([]);
    setAutofill([]);
    setStats(null);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_SAFARI_EXTRACT, {
        backupPath,
        includeHistory: true,
        includeBookmarks: true,
        includeOpenTabs: true,
        includeDownloads: true,
        includeAutofill: true,
      }) as {
        history: HistoryEntry[];
        bookmarks: BookmarkNode[];
        openTabs: OpenTab[];
        downloads: DownloadEntry[];
        autofill: AutofillEntry[];
        stats: SafariStats;
      };
      setHistory(result.history);
      setBookmarks(result.bookmarks);
      setOpenTabs(result.openTabs);
      setDownloads(result.downloads);
      setAutofill(result.autofill);
      setStats(result.stats);
    } catch (err) {
      console.error('Safari extraction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        title: 'Export Safari History as CSV',
        defaultPath: 'ios_safari_history.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (savePath) {
        await window.api.invoke(IPC_CHANNELS.IOS_SAFARI_EXTRACT, {
          backupPath,
          exportPath: savePath,
          exportFormat: 'csv',
          exportTab: activeTab,
          entryIds: filteredHistory.map((h) => h.id),
        });
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // Filter history
  useEffect(() => {
    let result = [...history];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (h) =>
          h.title.toLowerCase().includes(q) ||
          h.url.toLowerCase().includes(q)
      );
    }

    if (domainFilter) {
      const df = domainFilter.toLowerCase();
      result = result.filter((h) => h.domain.toLowerCase().includes(df));
    }

    if (dateFrom) result = result.filter((h) => h.visitDate >= dateFrom);
    if (dateTo) result = result.filter((h) => h.visitDate <= dateTo);

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'visitDate') cmp = a.visitDate.localeCompare(b.visitDate);
      else if (sortField === 'visitCount') cmp = a.visitCount - b.visitCount;
      else if (sortField === 'duration') cmp = a.duration - b.duration;
      else cmp = a.title.localeCompare(b.title);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    setFilteredHistory(result);
    setCurrentPage(1);
  }, [history, searchQuery, domainFilter, dateFrom, dateTo, sortField, sortDir]);

  const totalPages = Math.ceil(filteredHistory.length / pageSize);
  const paginatedHistory = filteredHistory.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Top domains
  const topDomains = React.useMemo(() => {
    const map = new Map<string, { domain: string; visits: number; totalDuration: number }>();
    history.forEach((h) => {
      const existing = map.get(h.domain);
      if (existing) {
        existing.visits += h.visitCount;
        existing.totalDuration += h.duration;
      } else {
        map.set(h.domain, { domain: h.domain, visits: h.visitCount, totalDuration: h.duration });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.visits - a.visits).slice(0, 10);
  }, [history]);

  const maxDomainVisits = topDomains.length > 0 ? topDomains[0].visits : 1;

  const tabConfig: { key: ActiveTab; label: string; count: number }[] = [
    { key: 'history', label: 'History', count: history.length },
    { key: 'bookmarks', label: 'Bookmarks', count: stats?.totalBookmarks ?? 0 },
    { key: 'tabs', label: 'Open Tabs', count: openTabs.length },
    { key: 'downloads', label: 'Downloads', count: downloads.length },
    { key: 'autofill', label: 'Autofill', count: autofill.length },
  ];

  const hasData = history.length > 0 || bookmarks.length > 0 || openTabs.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Safari History"
        description="Extract Safari browser history, bookmarks, open tabs, downloads, and autofill data from iOS backups"
        icon={<Apple size={24} />}
      />

      {/* Source Selection */}
      <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="space-y-3">
          <IosDeviceBar
            backupPath={backupPath}
            onBackupPath={setBackupPath}
            disabled={loading}
          />
          <div className="flex justify-end">
            <button onClick={handleExtract} className="btn-primary" disabled={!backupPath || loading}>
              {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              {loading ? 'Extracting...' : 'Extract Safari Data'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-6 gap-3">
          {[
            { label: 'History Entries', value: stats.totalHistory.toLocaleString(), color: 'text-blue-400', icon: <Clock size={18} /> },
            { label: 'Bookmarks', value: stats.totalBookmarks.toLocaleString(), color: 'text-yellow-400', icon: <Bookmark size={18} /> },
            { label: 'Open Tabs', value: stats.totalOpenTabs.toLocaleString(), color: 'text-green-400', icon: <Layers size={18} /> },
            { label: 'Downloads', value: stats.totalDownloads.toLocaleString(), color: 'text-purple-400', icon: <Download size={18} /> },
            { label: 'Autofill Entries', value: stats.totalAutofill.toLocaleString(), color: 'text-orange-400', icon: <Globe size={18} /> },
            { label: 'Unique Domains', value: stats.uniqueDomains.toLocaleString(), color: 'text-cyan-400', icon: <BarChart3 size={18} /> },
          ].map((s) => (
            <div key={s.label} className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                <span className={s.color}>{s.icon}</span>
              </div>
              <div className={`text-lg font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tab Bar */}
      {hasData && (
        <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border-color)' }}>
          {tabConfig.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="px-4 py-2 text-sm font-medium rounded-t transition-colors"
              style={{
                backgroundColor: activeTab === tab.key ? 'var(--bg-card)' : 'transparent',
                color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: activeTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent',
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                  {tab.count.toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ---- HISTORY TAB ---- */}
      {hasData && activeTab === 'history' && (
        <>
          {/* Top Domains Chart */}
          {topDomains.length > 0 && (
            <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-blue-400" />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Top 10 Domains by Visits</span>
              </div>
              <div className="space-y-2">
                {topDomains.map((d) => (
                  <div key={d.domain} className="flex items-center gap-3">
                    <span className="text-xs w-40 truncate text-right" style={{ color: 'var(--text-secondary)' }}>{d.domain}</span>
                    <div className="flex-1 h-5 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${Math.max((d.visits / maxDomainVisits) * 100, 2)}%`,
                          backgroundColor: '#3b82f6',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono w-16 text-right" style={{ color: 'var(--text-muted)' }}>{d.visits.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search URL or title..."
                  className="input-field w-full pl-9"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                />
              </div>

              <input
                type="text"
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                placeholder="Filter by domain..."
                className="input-field"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', width: '160px' }}
              />

              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              <span style={{ color: 'var(--text-muted)' }}>to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />

              <button onClick={handleExport} className="btn-secondary text-sm ml-auto" disabled={exporting}>
                <FileDown size={14} className="mr-1" /> Export CSV
              </button>
            </div>
            <div className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              Showing {filteredHistory.length.toLocaleString()} of {history.length.toLocaleString()} entries
            </div>
          </div>

          {/* History Table */}
          {paginatedHistory.length > 0 && (
            <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('title')}>
                        Title {sortField === 'title' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>URL</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Domain</th>
                      <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('visitDate')}>
                        Visit Date {sortField === 'visitDate' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2 text-center cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('visitCount')}>
                        Visits {sortField === 'visitCount' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Redirect Source</th>
                      <th className="px-3 py-2 text-right cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('duration')}>
                        Duration {sortField === 'duration' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedHistory.map((entry) => (
                      <tr
                        key={entry.id}
                        style={{ borderBottom: '1px solid var(--border-color)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="px-3 py-2 font-medium max-w-[200px] truncate" style={{ color: 'var(--text-primary)' }}>
                          {entry.title || <span style={{ color: 'var(--text-muted)' }}>(untitled)</span>}
                        </td>
                        <td className="px-3 py-2 max-w-[250px] truncate" style={{ color: 'var(--text-secondary)' }}>
                          <span className="flex items-center gap-1">
                            <ExternalLink size={12} className="flex-shrink-0 text-blue-400" />
                            <span className="truncate">{entry.url}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{entry.domain}</td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {fmtDate(entry.visitDate)}{' '}
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {fmtTime(entry.visitDate)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center font-mono" style={{ color: 'var(--text-primary)' }}>
                          {entry.visitCount}
                        </td>
                        <td className="px-3 py-2 max-w-[180px] truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                          {entry.redirectSource || '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                          {formatDuration(entry.duration)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border-color)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {currentPage} of {totalPages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="btn-secondary text-sm">
                    <ChevronLeft size={14} /> Prev
                  </button>
                  <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="btn-secondary text-sm">
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ---- BOOKMARKS TAB ---- */}
      {hasData && activeTab === 'bookmarks' && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Bookmark size={16} className="text-yellow-400" />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Bookmark Tree</span>
          </div>
          {bookmarks.length > 0 ? (
            <div className="max-h-[600px] overflow-y-auto" style={{ border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-primary)' }}>
              <div className="p-2">
                {bookmarks.map((node) => (
                  <BookmarkTreeNode key={node.id} node={node} depth={0} />
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
              No bookmarks found
            </div>
          )}
        </div>
      )}

      {/* ---- OPEN TABS TAB ---- */}
      {hasData && activeTab === 'tabs' && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <table className="data-table w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Title</th>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>URL</th>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Last Viewed</th>
                <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Private</th>
              </tr>
            </thead>
            <tbody>
              {openTabs.map((tab) => (
                <tr
                  key={tab.id}
                  style={{ borderBottom: '1px solid var(--border-color)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{tab.title}</td>
                  <td className="px-3 py-2 max-w-[300px] truncate" style={{ color: 'var(--text-secondary)' }}>{tab.url}</td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {fmtDateTime(tab.lastViewed)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {tab.isPrivate ? (
                      <span className="badge-danger text-xs px-2 py-0.5 rounded-full">Private</span>
                    ) : (
                      <span className="badge-success text-xs px-2 py-0.5 rounded-full">Normal</span>
                    )}
                  </td>
                </tr>
              ))}
              {openTabs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>No open tabs found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- DOWNLOADS TAB ---- */}
      {hasData && activeTab === 'downloads' && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <table className="data-table w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Filename</th>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>URL</th>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Type</th>
                <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Size</th>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Date</th>
                <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {downloads.map((dl) => (
                <tr
                  key={dl.id}
                  style={{ borderBottom: '1px solid var(--border-color)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{dl.filename}</td>
                  <td className="px-3 py-2 max-w-[250px] truncate text-xs" style={{ color: 'var(--text-muted)' }}>{dl.url}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{dl.mimeType}</td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>{formatBytes(dl.fileSize)}</td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDateTime(dl.date)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      dl.status === 'completed' ? 'badge-success' : dl.status === 'failed' ? 'badge-danger' : 'badge-info'
                    }`}>
                      {dl.status}
                    </span>
                  </td>
                </tr>
              ))}
              {downloads.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>No downloads found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- AUTOFILL TAB ---- */}
      {hasData && activeTab === 'autofill' && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <table className="data-table w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Field Name</th>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Value</th>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Domain</th>
                <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Last Used</th>
                <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Use Count</th>
              </tr>
            </thead>
            <tbody>
              {autofill.map((af) => (
                <tr
                  key={af.id}
                  style={{ borderBottom: '1px solid var(--border-color)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{af.field}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{af.value}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{af.domain}</td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDateTime(af.lastUsed)}</td>
                  <td className="px-3 py-2 text-center font-mono" style={{ color: 'var(--text-primary)' }}>{af.useCount}</td>
                </tr>
              ))}
              {autofill.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>No autofill entries found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {!loading && !hasData && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Globe size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and extract Safari data to view browsing history, bookmarks, and more</p>
        </div>
      )}
    </div>
  );
};
