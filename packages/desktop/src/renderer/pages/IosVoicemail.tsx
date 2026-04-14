import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Apple,
  Voicemail,
  Download,
  Loader2,
  Search,
  FileDown,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Square,
  Trash2,
  Phone,
  Clock,
  Volume2,
  Eye,
  X,
  CheckCircle,
  Circle,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, IosDeviceBar } from '../components/common';
import { fmtDate, fmtTime, fmtDateTime } from '../utils/formatDate';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface VoicemailRecord {
  id: string;
  caller: string;
  callerName: string;
  date: string;
  duration: number; // seconds
  isRead: boolean;
  transcription: string;
  hasTranscription: boolean;
  isDeleted: boolean;
  deletedDate?: string;
  audioPath: string;
  audioFormat: string;
  fileSize: number;
  callbackNumber: string;
  label: string; // e.g., mobile, home, work
}

interface VoicemailStats {
  total: number;
  unread: number;
  deleted: number;
  withTranscription: number;
  totalDuration: number;
  averageDuration: number;
  uniqueCallers: number;
}

type ExportFormat = 'wav' | 'mp3';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatDuration = (seconds: number): string => {
  if (seconds === 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatTotalDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/* ------------------------------------------------------------------ */
/*  Audio Player Subcomponent                                          */
/* ------------------------------------------------------------------ */

const AudioPlayer: React.FC<{ voicemail: VoicemailRecord; isActive: boolean; onPlay: () => void }> = ({ voicemail, isActive, onPlay }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(voicemail.duration);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive && playing) {
      audioRef.current?.pause();
      setPlaying(false);
    }
  }, [isActive, playing]);

  const handlePlayPause = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(voicemail.audioPath);
      audioRef.current.addEventListener('timeupdate', () => {
        setCurrentTime(audioRef.current?.currentTime ?? 0);
      });
      audioRef.current.addEventListener('loadedmetadata', () => {
        setDuration(audioRef.current?.duration ?? voicemail.duration);
      });
      audioRef.current.addEventListener('ended', () => {
        setPlaying(false);
        setCurrentTime(0);
      });
    }

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      onPlay();
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
      setCurrentTime(0);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !audioRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const newTime = ratio * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handlePlayPause}
        className="btn-secondary p-1.5"
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button
        onClick={handleStop}
        className="btn-secondary p-1.5"
        title="Stop"
        disabled={!playing && currentTime === 0}
      >
        <Square size={14} />
      </button>

      {/* Progress Bar */}
      <div
        ref={progressRef}
        className="flex-1 h-2 rounded-full cursor-pointer"
        style={{ backgroundColor: 'var(--bg-secondary)', minWidth: '80px' }}
        onClick={handleProgressClick}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${progress}%`, backgroundColor: '#3b82f6' }}
        />
      </div>

      <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: '38px' }}>
        {formatDuration(Math.floor(currentTime))}
      </span>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosVoicemail: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Data
  const [voicemails, setVoicemails] = useState<VoicemailRecord[]>([]);
  const [filteredVoicemails, setFilteredVoicemails] = useState<VoicemailRecord[]>([]);
  const [stats, setStats] = useState<VoicemailStats | null>(null);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [selectedVoicemail, setSelectedVoicemail] = useState<VoicemailRecord | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [callerFilter, setCallerFilter] = useState('');
  const [readFilter, setReadFilter] = useState<string>('all');
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<'date' | 'duration' | 'caller'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const pageSize = 30;

  const handleExtract = async () => {
    if (!backupPath) return;
    setLoading(true);
    setVoicemails([]);
    setStats(null);
    setSelectedVoicemail(null);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_VOICEMAIL_EXTRACT, {
        backupPath,
        includeDeleted: true,
      }) as { voicemails: VoicemailRecord[]; stats: VoicemailStats };
      setVoicemails(result.voicemails);
      setStats(result.stats);
    } catch (err) {
      console.error('Voicemail extraction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const folderPath = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, {
        title: `Select Output Folder for ${format.toUpperCase()} Files`,
      });
      if (folderPath) {
        await window.api.invoke(IPC_CHANNELS.IOS_VOICEMAIL_EXTRACT, {
          backupPath,
          exportPath: folderPath,
          exportFormat: format,
          voicemailIds: filteredVoicemails.map((v) => v.id),
        });
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        title: 'Export Voicemail Metadata as CSV',
        defaultPath: 'ios_voicemail_metadata.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (savePath) {
        await window.api.invoke(IPC_CHANNELS.IOS_VOICEMAIL_EXTRACT, {
          backupPath,
          exportPath: savePath,
          exportFormat: 'csv',
          voicemailIds: filteredVoicemails.map((v) => v.id),
        });
      }
    } catch (err) {
      console.error('CSV export failed:', err);
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

  // Filter
  useEffect(() => {
    let result = [...voicemails];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (v) =>
          v.callerName.toLowerCase().includes(q) ||
          v.caller.includes(q) ||
          v.transcription.toLowerCase().includes(q)
      );
    }

    if (callerFilter) {
      const cf = callerFilter.toLowerCase();
      result = result.filter(
        (v) => v.callerName.toLowerCase().includes(cf) || v.caller.includes(cf)
      );
    }

    if (readFilter === 'read') result = result.filter((v) => v.isRead);
    else if (readFilter === 'unread') result = result.filter((v) => !v.isRead);

    if (showDeletedOnly) result = result.filter((v) => v.isDeleted);

    if (dateFrom) result = result.filter((v) => v.date >= dateFrom);
    if (dateTo) result = result.filter((v) => v.date <= dateTo);

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortField === 'duration') cmp = a.duration - b.duration;
      else cmp = (a.callerName || a.caller).localeCompare(b.callerName || b.caller);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    setFilteredVoicemails(result);
    setCurrentPage(1);
  }, [voicemails, searchQuery, callerFilter, readFilter, showDeletedOnly, dateFrom, dateTo, sortField, sortDir]);

  const totalPages = Math.ceil(filteredVoicemails.length / pageSize);
  const paginatedVoicemails = filteredVoicemails.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Top callers
  const topCallers = React.useMemo(() => {
    const map = new Map<string, { name: string; number: string; count: number; totalDuration: number }>();
    voicemails.forEach((v) => {
      const key = v.caller;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
        existing.totalDuration += v.duration;
      } else {
        map.set(key, { name: v.callerName, number: v.caller, count: 1, totalDuration: v.duration });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [voicemails]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Voicemail"
        description="Extract voicemail recordings, transcriptions, and metadata from iOS backups"
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
              {loading ? 'Extracting...' : 'Extract Voicemails'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats + Top Callers */}
      {stats && (
        <div className="grid grid-cols-12 gap-4">
          {/* Stats */}
          <div className="col-span-8 grid grid-cols-4 gap-3">
            {[
              { label: 'Total Voicemails', value: stats.total.toLocaleString(), color: 'text-blue-400', icon: <Voicemail size={18} /> },
              { label: 'Unread', value: stats.unread.toLocaleString(), color: 'text-yellow-400', icon: <Circle size={18} /> },
              { label: 'Deleted', value: stats.deleted.toLocaleString(), color: 'text-red-400', icon: <Trash2 size={18} /> },
              { label: 'With Transcription', value: stats.withTranscription.toLocaleString(), color: 'text-green-400', icon: <Eye size={18} /> },
              { label: 'Total Duration', value: formatTotalDuration(stats.totalDuration), color: 'text-purple-400', icon: <Clock size={18} /> },
              { label: 'Avg Duration', value: formatDuration(stats.averageDuration), color: 'text-cyan-400', icon: <Clock size={18} /> },
              { label: 'Unique Callers', value: stats.uniqueCallers.toLocaleString(), color: 'text-orange-400', icon: <Phone size={18} /> },
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
              <Phone size={16} className="text-blue-400" />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Top Callers</span>
            </div>
            {topCallers.map((tc, i) => (
              <div key={i} className="flex items-center justify-between py-1.5" style={{ borderBottom: i < topCallers.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                <div>
                  <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{tc.name || tc.number}</div>
                  {tc.name && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{tc.number}</div>}
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-blue-400">{tc.count} voicemail{tc.count !== 1 ? 's' : ''}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatTotalDuration(tc.totalDuration)}</div>
                </div>
              </div>
            ))}
            {topCallers.length === 0 && (
              <div className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>No callers</div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      {voicemails.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search caller, number, or transcription..."
                className="input-field w-full pl-9"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              />
            </div>

            <input
              type="text"
              value={callerFilter}
              onChange={(e) => setCallerFilter(e.target.value)}
              placeholder="Filter by caller..."
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', width: '150px' }}
            />

            <select
              value={readFilter}
              onChange={(e) => setReadFilter(e.target.value)}
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              <option value="all">All</option>
              <option value="read">Read</option>
              <option value="unread">Unread</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={showDeletedOnly} onChange={(e) => setShowDeletedOnly(e.target.checked)} />
              Deleted only
            </label>

            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            <span style={{ color: 'var(--text-muted)' }}>to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
          </div>

          <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Showing {filteredVoicemails.length.toLocaleString()} of {voicemails.length.toLocaleString()} voicemails
            </span>
            <div className="flex gap-2">
              <button onClick={handleExportCsv} className="btn-secondary text-sm" disabled={exporting}>
                <FileDown size={14} className="mr-1" /> CSV
              </button>
              <button onClick={() => handleBulkExport('wav')} className="btn-secondary text-sm" disabled={exporting}>
                <Download size={14} className="mr-1" /> Export WAV
              </button>
              <button onClick={() => handleBulkExport('mp3')} className="btn-secondary text-sm" disabled={exporting}>
                <Download size={14} className="mr-1" /> Export MP3
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voicemail Table */}
      {paginatedVoicemails.length > 0 && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Status</th>
                  <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('caller')}>
                    Caller {sortField === 'caller' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('date')}>
                    Date {sortField === 'date' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-3 py-2 text-right cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('duration')}>
                    Duration {sortField === 'duration' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)', minWidth: '220px' }}>Player</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Transcription</th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Flags</th>
                </tr>
              </thead>
              <tbody>
                {paginatedVoicemails.map((vm) => (
                  <tr
                    key={vm.id}
                    className="cursor-pointer transition-colors"
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      backgroundColor: selectedVoicemail?.id === vm.id ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onClick={() => setSelectedVoicemail(vm)}
                    onMouseEnter={(e) => {
                      if (selectedVoicemail?.id !== vm.id) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (selectedVoicemail?.id !== vm.id) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <td className="px-3 py-2 text-center">
                      {vm.isRead ? (
                        <CheckCircle size={16} className="text-green-400 mx-auto" />
                      ) : (
                        <Circle size={16} className="text-yellow-400 mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                      <div className="font-medium">{vm.callerName || vm.caller}</div>
                      {vm.callerName && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{vm.caller}</div>}
                      {vm.label && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{vm.label}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {fmtDate(vm.date)}<br />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {fmtTime(vm.date)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                      {formatDuration(vm.duration)}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <AudioPlayer
                        voicemail={vm}
                        isActive={activePlayerId === vm.id}
                        onPlay={() => setActivePlayerId(vm.id)}
                      />
                    </td>
                    <td className="px-3 py-2 max-w-[250px]" style={{ color: 'var(--text-secondary)' }}>
                      {vm.hasTranscription ? (
                        <span className="truncate block text-xs">{vm.transcription}</span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No transcription</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {vm.isDeleted && (
                          <span className="badge-danger text-xs px-1.5 py-0.5 rounded-full">
                            <Trash2 size={10} />
                          </span>
                        )}
                      </div>
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

      {/* Detail Modal */}
      {selectedVoicemail && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSelectedVoicemail(null)}
        >
          <div
            className="card p-6 max-w-xl w-full mx-4 max-h-[80vh] overflow-y-auto"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Voicemail Detail
                {selectedVoicemail.isDeleted && (
                  <span className="badge-danger text-xs px-2 py-0.5 rounded-full ml-2">DELETED</span>
                )}
              </h3>
              <button onClick={() => setSelectedVoicemail(null)} className="btn-secondary p-1.5">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              {[
                { label: 'Caller', value: `${selectedVoicemail.callerName || 'Unknown'} (${selectedVoicemail.caller})` },
                { label: 'Date', value: fmtDateTime(selectedVoicemail.date) },
                { label: 'Duration', value: formatDuration(selectedVoicemail.duration) },
                { label: 'Status', value: selectedVoicemail.isRead ? 'Read' : 'Unread' },
                { label: 'Label', value: selectedVoicemail.label || 'N/A' },
                { label: 'Callback Number', value: selectedVoicemail.callbackNumber || 'N/A' },
                { label: 'Audio Format', value: selectedVoicemail.audioFormat },
                { label: 'File Size', value: formatBytes(selectedVoicemail.fileSize) },
              ].map((row) => (
                <div key={row.label} className="flex gap-4">
                  <span className="w-32 flex-shrink-0 font-medium" style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{row.value}</span>
                </div>
              ))}

              {/* Audio Player */}
              <div className="pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
                <span className="font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
                  <Volume2 size={14} className="inline mr-1" /> Audio Playback
                </span>
                <div className="p-3 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <AudioPlayer
                    voicemail={selectedVoicemail}
                    isActive={activePlayerId === selectedVoicemail.id}
                    onPlay={() => setActivePlayerId(selectedVoicemail.id)}
                  />
                </div>
              </div>

              {/* Transcription */}
              {selectedVoicemail.hasTranscription && (
                <div className="pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
                  <span className="font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Transcription</span>
                  <div className="p-3 rounded whitespace-pre-wrap" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                    {selectedVoicemail.transcription}
                  </div>
                </div>
              )}

              {selectedVoicemail.isDeleted && selectedVoicemail.deletedDate && (
                <div className="flex gap-4 pt-2">
                  <span className="w-32 flex-shrink-0 font-medium text-red-400">Deleted Date</span>
                  <span className="text-red-400">{fmtDateTime(selectedVoicemail.deletedDate)}</span>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button onClick={() => setSelectedVoicemail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && voicemails.length === 0 && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Voicemail size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and extract voicemails to listen and view them here</p>
        </div>
      )}
    </div>
  );
};
