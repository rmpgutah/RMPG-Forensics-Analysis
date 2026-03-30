import React, { useState, useEffect } from 'react';
import {
  Apple,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  PhoneOff,
  Video,
  Headphones,
  Download,
  Loader2,
  Search,
  Filter,
  FileDown,
  Calendar,
  Clock,
  ChevronLeft,
  ChevronRight,
  Ban,
  BarChart3,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CallRecord {
  id: string;
  contactName: string;
  phoneNumber: string;
  direction: 'inbound' | 'outbound' | 'missed' | 'blocked';
  duration: number; // seconds
  date: string;
  callType: 'voice' | 'facetime_video' | 'facetime_audio';
  answered: boolean;
  isFromWatchOrMac: boolean;
  countryCode: string;
  service: string; // carrier or facetime
}

interface CallStats {
  total: number;
  inbound: number;
  outbound: number;
  missed: number;
  blocked: number;
  facetimeVideo: number;
  facetimeAudio: number;
  totalDuration: number;
  averageDuration: number;
  uniqueContacts: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatDuration = (seconds: number): string => {
  if (seconds === 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatTotalDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const getDirectionIcon = (direction: string, callType: string) => {
  if (direction === 'blocked') return <Ban size={16} className="text-red-500" />;
  if (direction === 'missed') return <PhoneMissed size={16} className="text-yellow-400" />;
  if (callType === 'facetime_video') return <Video size={16} className="text-green-400" />;
  if (callType === 'facetime_audio') return <Headphones size={16} className="text-blue-400" />;
  if (direction === 'inbound') return <PhoneIncoming size={16} className="text-green-400" />;
  return <PhoneOutgoing size={16} className="text-blue-400" />;
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosCallHistory: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [filteredCalls, setFilteredCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<'date' | 'duration' | 'contactName'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const pageSize = 50;

  const handleBrowseBackup = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, {
        title: 'Select iOS Backup Folder',
      });
      if (result) setBackupPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleExtract = async () => {
    if (!backupPath) return;
    setLoading(true);
    setCalls([]);
    setStats(null);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_CALLS_EXTRACT, {
        backupPath,
      }) as { calls: CallRecord[]; stats: CallStats };
      setCalls(result.calls);
      setStats(result.stats);
    } catch (err) {
      console.error('Call extraction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        title: 'Export Call History as CSV',
        defaultPath: 'ios_call_history.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (savePath) {
        await window.api.invoke(IPC_CHANNELS.IOS_CALLS_EXTRACT, {
          backupPath,
          exportPath: savePath,
          exportFormat: 'csv',
          callIds: filteredCalls.map((c) => c.id),
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

  useEffect(() => {
    let result = [...calls];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.contactName.toLowerCase().includes(q) ||
          c.phoneNumber.includes(q)
      );
    }

    if (directionFilter !== 'all') {
      result = result.filter((c) => c.direction === directionFilter);
    }

    if (typeFilter !== 'all') {
      result = result.filter((c) => c.callType === typeFilter);
    }

    if (dateFrom) result = result.filter((c) => c.date >= dateFrom);
    if (dateTo) result = result.filter((c) => c.date <= dateTo);

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortField === 'duration') cmp = a.duration - b.duration;
      else cmp = a.contactName.localeCompare(b.contactName);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    setFilteredCalls(result);
    setCurrentPage(1);
  }, [calls, searchQuery, directionFilter, typeFilter, dateFrom, dateTo, sortField, sortDir]);

  const totalPages = Math.ceil(filteredCalls.length / pageSize);
  const paginatedCalls = filteredCalls.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Top callers
  const topCallers = React.useMemo(() => {
    const map = new Map<string, { name: string; number: string; count: number; duration: number }>();
    calls.forEach((c) => {
      const key = c.phoneNumber;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
        existing.duration += c.duration;
      } else {
        map.set(key, { name: c.contactName, number: c.phoneNumber, count: 1, duration: c.duration });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [calls]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Call History"
        description="Extract all call logs — inbound, outbound, missed, blocked, FaceTime video, and FaceTime audio"
        icon={<Apple size={24} />}
      />

      {/* Source Selection */}
      <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              iOS Backup Source
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={backupPath}
                readOnly
                placeholder="Select iOS backup folder..."
                className="input-field flex-1"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              />
              <button onClick={handleBrowseBackup} className="btn-secondary" disabled={loading}>Browse</button>
            </div>
          </div>
          <button onClick={handleExtract} className="btn-primary" disabled={!backupPath || loading}>
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <Phone size={16} className="mr-2" />}
            {loading ? 'Extracting...' : 'Extract Call Logs'}
          </button>
        </div>
      </div>

      {/* Stats + Top Callers */}
      {stats && (
        <div className="grid grid-cols-12 gap-4">
          {/* Stats */}
          <div className="col-span-8 grid grid-cols-4 gap-3">
            {[
              { label: 'Total Calls', value: stats.total.toLocaleString(), color: 'text-blue-400', icon: <Phone size={18} /> },
              { label: 'Inbound', value: stats.inbound.toLocaleString(), color: 'text-green-400', icon: <PhoneIncoming size={18} /> },
              { label: 'Outbound', value: stats.outbound.toLocaleString(), color: 'text-blue-400', icon: <PhoneOutgoing size={18} /> },
              { label: 'Missed', value: stats.missed.toLocaleString(), color: 'text-yellow-400', icon: <PhoneMissed size={18} /> },
              { label: 'Blocked', value: stats.blocked.toLocaleString(), color: 'text-red-400', icon: <Ban size={18} /> },
              { label: 'FaceTime Video', value: stats.facetimeVideo.toLocaleString(), color: 'text-green-400', icon: <Video size={18} /> },
              { label: 'FaceTime Audio', value: stats.facetimeAudio.toLocaleString(), color: 'text-purple-400', icon: <Headphones size={18} /> },
              { label: 'Total Duration', value: formatTotalDuration(stats.totalDuration), color: 'text-orange-400', icon: <Clock size={18} /> },
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

          {/* Top Callers */}
          <div className="col-span-4 card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-blue-400" />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Top Contacts</span>
            </div>
            {topCallers.map((tc, i) => (
              <div key={i} className="flex items-center justify-between py-1.5" style={{ borderBottom: i < topCallers.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                <div>
                  <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{tc.name || tc.number}</div>
                  {tc.name && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{tc.number}</div>}
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-blue-400">{tc.count} calls</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatTotalDuration(tc.duration)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      {calls.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or number..."
                className="input-field w-full pl-9"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              />
            </div>

            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value)}
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              <option value="all">All Directions</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
              <option value="missed">Missed</option>
              <option value="blocked">Blocked</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              <option value="all">All Types</option>
              <option value="voice">Voice</option>
              <option value="facetime_video">FaceTime Video</option>
              <option value="facetime_audio">FaceTime Audio</option>
            </select>

            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            <span style={{ color: 'var(--text-muted)' }}>to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />

            <button onClick={handleExport} className="btn-secondary text-sm ml-auto" disabled={exporting}>
              <FileDown size={14} className="mr-1" /> Export CSV
            </button>
          </div>
          <div className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Showing {filteredCalls.length.toLocaleString()} of {calls.length.toLocaleString()} calls
          </div>
        </div>
      )}

      {/* Call Table */}
      {paginatedCalls.length > 0 && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Type</th>
                  <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('contactName')}>
                    Contact {sortField === 'contactName' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Number</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Direction</th>
                  <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('duration')}>
                    Duration {sortField === 'duration' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('date')}>
                    Date {sortField === 'date' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Answered</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Service</th>
                </tr>
              </thead>
              <tbody>
                {paginatedCalls.map((call) => (
                  <tr
                    key={call.id}
                    style={{ borderBottom: '1px solid var(--border-color)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-3 py-2">{getDirectionIcon(call.direction, call.callType)}</td>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {call.contactName || <span style={{ color: 'var(--text-muted)' }}>Unknown</span>}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{call.phoneNumber}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        call.direction === 'inbound' ? 'badge-success' :
                        call.direction === 'outbound' ? 'badge-info' :
                        call.direction === 'missed' ? 'text-yellow-400 bg-yellow-400/10' :
                        'badge-danger'
                      }`}>
                        {call.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)' }}>
                      {formatDuration(call.duration)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(call.date).toLocaleDateString()}{' '}
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(call.date).toLocaleTimeString()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {call.answered
                        ? <span className="badge-success text-xs px-2 py-0.5 rounded-full">Yes</span>
                        : <span className="badge-danger text-xs px-2 py-0.5 rounded-full">No</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{call.service}</td>
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

      {/* Empty State */}
      {!loading && calls.length === 0 && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Phone size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and extract call history to view logs here</p>
        </div>
      )}
    </div>
  );
};
