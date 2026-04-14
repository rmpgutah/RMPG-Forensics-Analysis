import React, { useState, useEffect } from 'react';
import {
  Apple,
  StickyNote,
  Download,
  Loader2,
  Search,
  FileDown,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Folder,
  Paperclip,
  Pencil,
  CheckSquare,
  Trash2,
  Lock,
  Share2,
  X,
  Eye,
  FileText,
  Users,
  Filter,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, IosDeviceBar } from '../components/common';
import { fmtDate, fmtTime, fmtDateTime } from '../utils/formatDate';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NoteRecord {
  id: string;
  title: string;
  snippet: string;
  htmlContent: string;
  plainTextContent: string;
  folder: string;
  account: string;
  createdDate: string;
  modifiedDate: string;
  hasAttachments: boolean;
  attachmentCount: number;
  attachments: NoteAttachment[];
  hasDrawings: boolean;
  hasChecklists: boolean;
  checklistTotal: number;
  checklistChecked: number;
  isLocked: boolean;
  isShared: boolean;
  sharedWith: string[];
  isDeleted: boolean;
  deletedDate?: string;
  isPinned: boolean;
  wordCount: number;
}

interface NoteAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface NoteStats {
  total: number;
  deleted: number;
  locked: number;
  shared: number;
  withAttachments: number;
  withDrawings: number;
  withChecklists: number;
  folders: number;
  accounts: number;
}

type ExportFormat = 'individual' | 'pdf' | 'csv';

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

/**
 * Render note content safely. For forensic previews we render the
 * plain-text content inside a <pre> block. If HTML content is available
 * we create a sandboxed iframe to display it, which prevents script
 * execution and isolates styles.
 */
const NoteContentPreview: React.FC<{ htmlContent: string; plainTextContent: string; isLocked: boolean }> = ({
  htmlContent,
  plainTextContent,
  isLocked,
}) => {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    if (htmlContent && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 13px;
                color: #e2e8f0;
                background: transparent;
                padding: 8px;
                margin: 0;
                line-height: 1.5;
              }
              a { color: #60a5fa; }
              img { max-width: 100%; height: auto; }
              table { border-collapse: collapse; }
              td, th { border: 1px solid #475569; padding: 4px 8px; }
            </style>
          </head>
          <body>${htmlContent}</body>
          </html>
        `);
        doc.close();
      }
    }
  }, [htmlContent]);

  if (isLocked) {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
        <Lock size={32} className="mx-auto mb-2 text-yellow-400" />
        <p>This note is locked. Content may not be available without decryption.</p>
      </div>
    );
  }

  if (htmlContent) {
    return (
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin"
        style={{
          width: '100%',
          minHeight: '300px',
          border: 'none',
          backgroundColor: 'transparent',
        }}
        title="Note content preview"
      />
    );
  }

  return (
    <div className="whitespace-pre-wrap text-sm" style={{ color: 'var(--text-primary)' }}>
      {plainTextContent || '(no content)'}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosNotes: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Data
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [filteredNotes, setFilteredNotes] = useState<NoteRecord[]>([]);
  const [stats, setStats] = useState<NoteStats | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteRecord | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all'); // all | active | deleted | locked | shared
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<'modifiedDate' | 'createdDate' | 'title'>('modifiedDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const pageSize = 50;

  const handleExtract = async () => {
    if (!backupPath) return;
    setLoading(true);
    setNotes([]);
    setStats(null);
    setSelectedNote(null);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_NOTES_EXTRACT, {
        backupPath,
        includeDeleted: true,
        includeLocked: true,
        includeShared: true,
      }) as { notes: NoteRecord[]; stats: NoteStats };
      setNotes(result.notes);
      setStats(result.stats);
    } catch (err) {
      console.error('Notes extraction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      if (format === 'individual') {
        const folderPath = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, {
          title: 'Select Output Folder for Individual Note Files',
        });
        if (folderPath) {
          await window.api.invoke(IPC_CHANNELS.IOS_NOTES_EXTRACT, {
            backupPath,
            exportPath: folderPath,
            exportFormat: 'individual',
            noteIds: filteredNotes.map((n) => n.id),
          });
        }
      } else {
        const ext = format === 'pdf' ? 'pdf' : 'csv';
        const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
          title: `Export Notes as ${format.toUpperCase()}`,
          defaultPath: `ios_notes_export.${ext}`,
          filters: [{ name: format.toUpperCase(), extensions: [ext] }],
        });
        if (savePath) {
          await window.api.invoke(IPC_CHANNELS.IOS_NOTES_EXTRACT, {
            backupPath,
            exportPath: savePath,
            exportFormat: format,
            noteIds: filteredNotes.map((n) => n.id),
          });
        }
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

  // Derived data
  const uniqueFolders = React.useMemo(() => Array.from(new Set(notes.map((n) => n.folder).filter(Boolean))).sort(), [notes]);
  const uniqueAccounts = React.useMemo(() => Array.from(new Set(notes.map((n) => n.account).filter(Boolean))).sort(), [notes]);

  // Filter
  useEffect(() => {
    let result = [...notes];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.plainTextContent.toLowerCase().includes(q)
      );
    }

    if (folderFilter !== 'all') {
      result = result.filter((n) => n.folder === folderFilter);
    }

    if (accountFilter !== 'all') {
      result = result.filter((n) => n.account === accountFilter);
    }

    if (statusFilter === 'deleted') result = result.filter((n) => n.isDeleted);
    else if (statusFilter === 'locked') result = result.filter((n) => n.isLocked);
    else if (statusFilter === 'shared') result = result.filter((n) => n.isShared);
    else if (statusFilter === 'active') result = result.filter((n) => !n.isDeleted);

    if (dateFrom) result = result.filter((n) => n.modifiedDate >= dateFrom);
    if (dateTo) result = result.filter((n) => n.modifiedDate <= dateTo);

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'modifiedDate') cmp = a.modifiedDate.localeCompare(b.modifiedDate);
      else if (sortField === 'createdDate') cmp = a.createdDate.localeCompare(b.createdDate);
      else cmp = a.title.localeCompare(b.title);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    setFilteredNotes(result);
    setCurrentPage(1);
  }, [notes, searchQuery, folderFilter, accountFilter, statusFilter, dateFrom, dateTo, sortField, sortDir]);

  const totalPages = Math.ceil(filteredNotes.length / pageSize);
  const paginatedNotes = filteredNotes.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Notes"
        description="Extract all Apple Notes including shared, locked, and recently deleted notes with full content and attachments"
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
              {loading ? 'Extracting...' : 'Extract Notes'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Total Notes', value: stats.total.toLocaleString(), color: 'text-blue-400', icon: <StickyNote size={18} /> },
            { label: 'Deleted', value: stats.deleted.toLocaleString(), color: 'text-red-400', icon: <Trash2 size={18} /> },
            { label: 'Locked', value: stats.locked.toLocaleString(), color: 'text-yellow-400', icon: <Lock size={18} /> },
            { label: 'Shared', value: stats.shared.toLocaleString(), color: 'text-green-400', icon: <Share2 size={18} /> },
            { label: 'With Attachments', value: stats.withAttachments.toLocaleString(), color: 'text-orange-400', icon: <Paperclip size={18} /> },
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

      {/* Secondary Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'With Drawings', value: stats.withDrawings.toLocaleString(), color: 'text-purple-400', icon: <Pencil size={16} /> },
            { label: 'With Checklists', value: stats.withChecklists.toLocaleString(), color: 'text-cyan-400', icon: <CheckSquare size={16} /> },
            { label: 'Folders', value: stats.folders.toLocaleString(), color: 'text-yellow-400', icon: <Folder size={16} /> },
            { label: 'Accounts', value: stats.accounts.toLocaleString(), color: 'text-green-400', icon: <Users size={16} /> },
          ].map((s) => (
            <div key={s.label} className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                <span className={s.color}>{s.icon}</span>
              </div>
              <div className={`text-base font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Main Content Area: Table + Preview */}
      {notes.length > 0 && (
        <>
          {/* Filters */}
          <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search note title or content..."
                  className="input-field w-full pl-9"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                />
              </div>

              <select
                value={folderFilter}
                onChange={(e) => setFolderFilter(e.target.value)}
                className="input-field"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              >
                <option value="all">All Folders</option>
                {uniqueFolders.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>

              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="input-field"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              >
                <option value="all">All Accounts</option>
                {uniqueAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input-field"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              >
                <option value="all">All Status</option>
                <option value="active">Active Only</option>
                <option value="deleted">Deleted Only</option>
                <option value="locked">Locked Only</option>
                <option value="shared">Shared Only</option>
              </select>

              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              <span style={{ color: 'var(--text-muted)' }}>to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            </div>

            <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Showing {filteredNotes.length.toLocaleString()} of {notes.length.toLocaleString()} notes
              </span>
              <div className="flex gap-2">
                <button onClick={() => handleExport('csv')} className="btn-secondary text-sm" disabled={exporting}>
                  <FileDown size={14} className="mr-1" /> CSV
                </button>
                <button onClick={() => handleExport('individual')} className="btn-secondary text-sm" disabled={exporting}>
                  <FileDown size={14} className="mr-1" /> Individual Files
                </button>
                <button onClick={() => handleExport('pdf')} className="btn-secondary text-sm" disabled={exporting}>
                  <FileDown size={14} className="mr-1" /> Bulk PDF
                </button>
              </div>
            </div>
          </div>

          {/* Split View: Table + Preview */}
          <div className="grid grid-cols-12 gap-4">
            {/* Notes Table */}
            <div className={`${selectedNote ? 'col-span-7' : 'col-span-12'} card overflow-hidden`} style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('title')}>
                        Title {sortField === 'title' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Folder</th>
                      <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('createdDate')}>
                        Created {sortField === 'createdDate' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('modifiedDate')}>
                        Modified {sortField === 'modifiedDate' && (sortDir === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Account</th>
                      <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedNotes.map((note) => (
                      <tr
                        key={note.id}
                        className="cursor-pointer transition-colors"
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: selectedNote?.id === note.id ? 'var(--bg-hover)' : 'transparent',
                        }}
                        onClick={() => setSelectedNote(note)}
                        onMouseEnter={(e) => {
                          if (selectedNote?.id !== note.id) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                        }}
                        onMouseLeave={(e) => {
                          if (selectedNote?.id !== note.id) e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                          <div className="font-medium truncate max-w-[200px]">
                            {note.title || <span style={{ color: 'var(--text-muted)' }}>(untitled)</span>}
                          </div>
                          <div className="text-xs truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }}>
                            {note.snippet}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <span className="flex items-center gap-1">
                            <Folder size={12} className="text-yellow-400" /> {note.folder}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {fmtDate(note.createdDate)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {fmtDate(note.modifiedDate)}
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{note.account}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {note.hasAttachments && <Paperclip size={12} className="text-orange-400" title="Has attachments" />}
                            {note.hasDrawings && <Pencil size={12} className="text-purple-400" title="Has drawings" />}
                            {note.hasChecklists && <CheckSquare size={12} className="text-cyan-400" title="Has checklists" />}
                            {note.isLocked && <Lock size={12} className="text-yellow-400" title="Locked" />}
                            {note.isShared && <Share2 size={12} className="text-green-400" title="Shared" />}
                            {note.isDeleted && <Trash2 size={12} className="text-red-400" title="Deleted" />}
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

            {/* Preview Panel */}
            {selectedNote && (
              <div className="col-span-5 card p-0 overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', maxHeight: '80vh' }}>
                {/* Preview Header */}
                <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {selectedNote.title || '(untitled)'}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>{selectedNote.folder}</span>
                      <span>|</span>
                      <span>{selectedNote.account}</span>
                      <span>|</span>
                      <span>{selectedNote.wordCount} words</span>
                    </div>
                  </div>
                  <button onClick={() => setSelectedNote(null)} className="btn-secondary p-1.5 ml-2">
                    <X size={16} />
                  </button>
                </div>

                {/* Metadata Badges */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {selectedNote.isDeleted && (
                    <span className="badge-danger text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Trash2 size={10} /> Deleted {selectedNote.deletedDate && `on ${fmtDate(selectedNote.deletedDate)}`}
                    </span>
                  )}
                  {selectedNote.isLocked && (
                    <span className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1 text-yellow-400 bg-yellow-400/10">
                      <Lock size={10} /> Locked
                    </span>
                  )}
                  {selectedNote.isShared && (
                    <span className="badge-success text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Share2 size={10} /> Shared with {selectedNote.sharedWith.length}
                    </span>
                  )}
                  {selectedNote.isPinned && (
                    <span className="badge-info text-xs px-2 py-0.5 rounded-full">Pinned</span>
                  )}
                  {selectedNote.hasAttachments && (
                    <span className="text-xs px-2 py-0.5 rounded-full text-orange-400 bg-orange-400/10 flex items-center gap-1">
                      <Paperclip size={10} /> {selectedNote.attachmentCount} attachment{selectedNote.attachmentCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {selectedNote.hasChecklists && (
                    <span className="text-xs px-2 py-0.5 rounded-full text-cyan-400 bg-cyan-400/10 flex items-center gap-1">
                      <CheckSquare size={10} /> {selectedNote.checklistChecked}/{selectedNote.checklistTotal}
                    </span>
                  )}
                </div>

                {/* Dates */}
                <div className="flex items-center gap-4 px-4 py-2 text-xs" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                  <span>Created: {fmtDateTime(selectedNote.createdDate)}</span>
                  <span>Modified: {fmtDateTime(selectedNote.modifiedDate)}</span>
                </div>

                {/* Content Preview */}
                <div
                  className="p-4 overflow-y-auto"
                  style={{ maxHeight: 'calc(80vh - 200px)' }}
                >
                  <NoteContentPreview
                    htmlContent={selectedNote.htmlContent}
                    plainTextContent={selectedNote.plainTextContent}
                    isLocked={selectedNote.isLocked}
                  />

                  {/* Attachments */}
                  {selectedNote.attachments.length > 0 && (
                    <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-color)' }}>
                      <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                        Attachments ({selectedNote.attachments.length})
                      </h4>
                      <div className="space-y-1">
                        {selectedNote.attachments.map((att) => (
                          <div key={att.id} className="flex items-center gap-2 p-2 rounded text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                            <Paperclip size={14} className="text-orange-400 flex-shrink-0" />
                            <span className="truncate" style={{ color: 'var(--text-primary)' }}>{att.filename}</span>
                            <span className="text-xs ml-auto flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                              {att.mimeType} - {formatBytes(att.size)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Shared With */}
                  {selectedNote.sharedWith.length > 0 && (
                    <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-color)' }}>
                      <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                        Shared With
                      </h4>
                      <div className="space-y-1">
                        {selectedNote.sharedWith.map((email, i) => (
                          <div key={i} className="flex items-center gap-2 p-2 rounded text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                            <Users size={14} className="text-green-400" />
                            <span style={{ color: 'var(--text-primary)' }}>{email}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty State */}
      {!loading && notes.length === 0 && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <StickyNote size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and extract notes to view them here</p>
        </div>
      )}
    </div>
  );
};
