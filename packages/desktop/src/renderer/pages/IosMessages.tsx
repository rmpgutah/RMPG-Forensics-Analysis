import React, { useState, useEffect } from 'react';
import {
  Apple,
  MessageSquare,
  Download,
  Loader2,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  Paperclip,
  Trash2,
  Eye,
  FileDown,
  Calendar,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCheck,
  Check,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MessageRecord {
  id: string;
  guid: string;
  sender: string;
  senderName: string;
  recipient: string;
  recipientName: string;
  date: string;
  type: 'iMessage' | 'SMS' | 'MMS';
  direction: 'sent' | 'received';
  content: string;
  attachmentCount: number;
  attachments: { filename: string; mimeType: string; size: number }[];
  readStatus: boolean;
  isDeleted: boolean;
  deletedDate?: string;
  isFromWAL: boolean;
  groupChat?: string;
  threadId: string;
}

interface MessageStats {
  total: number;
  iMessage: number;
  sms: number;
  mms: number;
  sent: number;
  received: number;
  deleted: number;
  withAttachments: number;
  recoveredFromWAL: number;
}

type ExportFormat = 'csv' | 'html' | 'pdf';

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosMessages: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [filteredMessages, setFilteredMessages] = useState<MessageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<MessageStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [contactFilter, setContactFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [directionFilter, setDirectionFilter] = useState<string>('all');
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const [showWALRecovery, setShowWALRecovery] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedMessage, setSelectedMessage] = useState<MessageRecord | null>(null);
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
    setMessages([]);
    setStats(null);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_MESSAGES_EXTRACT, {
        backupPath,
        includeDeleted: true,
        recoverFromWAL: true,
      }) as { messages: MessageRecord[]; stats: MessageStats };
      setMessages(result.messages);
      setStats(result.stats);
    } catch (err) {
      console.error('Message extraction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        title: `Export Messages as ${format.toUpperCase()}`,
        defaultPath: `ios_messages_export.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (savePath) {
        await window.api.invoke(IPC_CHANNELS.IOS_MESSAGES_EXTRACT, {
          backupPath,
          exportPath: savePath,
          exportFormat: format,
          messages: filteredMessages.map((m) => m.id),
        });
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  // Apply filters
  useEffect(() => {
    let result = [...messages];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.content.toLowerCase().includes(q) ||
          m.senderName.toLowerCase().includes(q) ||
          m.recipientName.toLowerCase().includes(q) ||
          m.sender.includes(q) ||
          m.recipient.includes(q)
      );
    }

    if (contactFilter) {
      const cf = contactFilter.toLowerCase();
      result = result.filter(
        (m) =>
          m.sender.toLowerCase().includes(cf) ||
          m.senderName.toLowerCase().includes(cf) ||
          m.recipient.toLowerCase().includes(cf) ||
          m.recipientName.toLowerCase().includes(cf)
      );
    }

    if (typeFilter !== 'all') {
      result = result.filter((m) => m.type === typeFilter);
    }

    if (directionFilter !== 'all') {
      result = result.filter((m) => m.direction === directionFilter);
    }

    if (showDeletedOnly) {
      result = result.filter((m) => m.isDeleted);
    }

    if (showWALRecovery) {
      result = result.filter((m) => m.isFromWAL);
    }

    if (dateFrom) {
      result = result.filter((m) => m.date >= dateFrom);
    }

    if (dateTo) {
      result = result.filter((m) => m.date <= dateTo);
    }

    setFilteredMessages(result);
    setCurrentPage(1);
  }, [messages, searchQuery, contactFilter, typeFilter, directionFilter, showDeletedOnly, showWALRecovery, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredMessages.length / pageSize);
  const paginatedMessages = filteredMessages.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const uniqueContacts = Array.from(
    new Set(messages.flatMap((m) => [m.senderName, m.recipientName]).filter(Boolean))
  ).sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Messages"
        description="Extract all iMessages, SMS, and MMS — including deleted messages recovered from SQLite WAL"
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
              <button onClick={handleBrowseBackup} className="btn-secondary" disabled={loading}>
                Browse
              </button>
            </div>
          </div>
          <button onClick={handleExtract} className="btn-primary" disabled={!backupPath || loading}>
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <MessageSquare size={16} className="mr-2" />}
            {loading ? 'Extracting...' : 'Extract Messages'}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Total Messages', value: stats.total.toLocaleString(), color: 'text-blue-400' },
            { label: 'iMessage / SMS / MMS', value: `${stats.iMessage} / ${stats.sms} / ${stats.mms}`, color: 'text-green-400' },
            { label: 'Sent / Received', value: `${stats.sent} / ${stats.received}`, color: 'text-purple-400' },
            { label: 'Deleted (Recovered)', value: `${stats.deleted} (${stats.recoveredFromWAL} WAL)`, color: 'text-red-400' },
            { label: 'With Attachments', value: stats.withAttachments.toString(), color: 'text-orange-400' },
          ].map((s) => (
            <div key={s.label} className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              <div className={`text-lg font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      {messages.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search message content..."
                className="input-field w-full pl-9"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              />
            </div>

            <input
              type="text"
              value={contactFilter}
              onChange={(e) => setContactFilter(e.target.value)}
              placeholder="Filter by contact..."
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', width: '160px' }}
            />

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              <option value="all">All Types</option>
              <option value="iMessage">iMessage</option>
              <option value="SMS">SMS</option>
              <option value="MMS">MMS</option>
            </select>

            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value)}
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              <option value="all">All Directions</option>
              <option value="sent">Sent</option>
              <option value="received">Received</option>
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            />
            <span style={{ color: 'var(--text-muted)' }}>to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input-field"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            />

            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={showDeletedOnly} onChange={(e) => setShowDeletedOnly(e.target.checked)} />
              Deleted only
            </label>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={showWALRecovery} onChange={(e) => setShowWALRecovery(e.target.checked)} />
              WAL recovery
            </label>
          </div>

          <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Showing {filteredMessages.length.toLocaleString()} of {messages.length.toLocaleString()} messages
            </span>
            <div className="flex gap-2">
              <button onClick={() => handleExport('csv')} className="btn-secondary text-sm" disabled={exporting}>
                <FileDown size={14} className="mr-1" /> CSV
              </button>
              <button onClick={() => handleExport('html')} className="btn-secondary text-sm" disabled={exporting}>
                <FileDown size={14} className="mr-1" /> HTML
              </button>
              <button onClick={() => handleExport('pdf')} className="btn-secondary text-sm" disabled={exporting}>
                <FileDown size={14} className="mr-1" /> PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages Table */}
      {paginatedMessages.length > 0 && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Direction</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Sender</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Recipient</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Type</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Content</th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Attach</th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Read</th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedMessages.map((msg) => (
                  <tr
                    key={msg.id}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--border-color)' }}
                    onClick={() => setSelectedMessage(msg)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-3 py-2">
                      {msg.direction === 'sent'
                        ? <ArrowUpRight size={16} className="text-blue-400" />
                        : <ArrowDownLeft size={16} className="text-green-400" />
                      }
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                      <div className="font-medium">{msg.senderName || msg.sender}</div>
                      {msg.senderName && (
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{msg.sender}</div>
                      )}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                      <div className="font-medium">{msg.recipientName || msg.recipient}</div>
                      {msg.recipientName && (
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{msg.recipient}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(msg.date).toLocaleDateString()}<br />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(msg.date).toLocaleTimeString()}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`badge-${msg.type === 'iMessage' ? 'info' : msg.type === 'SMS' ? 'success' : 'danger'} text-xs px-2 py-0.5 rounded-full`}>
                        {msg.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[300px] truncate" style={{ color: 'var(--text-primary)' }}>
                      {msg.content || <span style={{ color: 'var(--text-muted)' }}>[No text content]</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {msg.attachmentCount > 0 && (
                        <span className="flex items-center justify-center gap-1 text-orange-400">
                          <Paperclip size={14} /> {msg.attachmentCount}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {msg.readStatus
                        ? <CheckCheck size={16} className="text-blue-400 mx-auto" />
                        : <Check size={16} style={{ color: 'var(--text-muted)' }} className="mx-auto" />
                      }
                    </td>
                    <td className="px-3 py-2 text-center">
                      {msg.isDeleted && (
                        <span className="badge-danger text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Trash2 size={12} /> Deleted
                        </span>
                      )}
                      {msg.isFromWAL && (
                        <span className="badge-info text-xs px-2 py-0.5 rounded-full mt-1 inline-block">WAL</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border-color)' }}>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="btn-secondary text-sm"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="btn-secondary text-sm"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message Detail Modal */}
      {selectedMessage && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSelectedMessage(null)}
        >
          <div
            className="card p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              Message Detail
              {selectedMessage.isDeleted && (
                <span className="badge-danger text-xs px-2 py-0.5 rounded-full ml-2">DELETED</span>
              )}
              {selectedMessage.isFromWAL && (
                <span className="badge-info text-xs px-2 py-0.5 rounded-full ml-2">Recovered from WAL</span>
              )}
            </h3>
            <div className="space-y-3 text-sm">
              {[
                { label: 'GUID', value: selectedMessage.guid },
                { label: 'Sender', value: `${selectedMessage.senderName} (${selectedMessage.sender})` },
                { label: 'Recipient', value: `${selectedMessage.recipientName} (${selectedMessage.recipient})` },
                { label: 'Date', value: new Date(selectedMessage.date).toLocaleString() },
                { label: 'Type', value: selectedMessage.type },
                { label: 'Direction', value: selectedMessage.direction },
                { label: 'Read', value: selectedMessage.readStatus ? 'Yes' : 'No' },
                { label: 'Thread ID', value: selectedMessage.threadId },
                { label: 'Group Chat', value: selectedMessage.groupChat || 'N/A' },
              ].map((row) => (
                <div key={row.label} className="flex gap-4">
                  <span className="w-28 flex-shrink-0 font-medium" style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{row.value}</span>
                </div>
              ))}
              <div>
                <span className="font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Content</span>
                <div className="p-3 rounded" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                  {selectedMessage.content || '[No text content]'}
                </div>
              </div>
              {selectedMessage.attachments.length > 0 && (
                <div>
                  <span className="font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Attachments ({selectedMessage.attachments.length})
                  </span>
                  {selectedMessage.attachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded mb-1" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <Paperclip size={14} className="text-orange-400" />
                      <span style={{ color: 'var(--text-primary)' }}>{att.filename}</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{att.mimeType}</span>
                    </div>
                  ))}
                </div>
              )}
              {selectedMessage.isDeleted && selectedMessage.deletedDate && (
                <div className="flex gap-4">
                  <span className="w-28 flex-shrink-0 font-medium text-red-400">Deleted Date</span>
                  <span className="text-red-400">{new Date(selectedMessage.deletedDate).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setSelectedMessage(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && messages.length === 0 && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <MessageSquare size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and extract messages to view them here</p>
        </div>
      )}
    </div>
  );
};
