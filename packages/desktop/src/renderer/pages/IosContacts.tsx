import React, { useState, useEffect } from 'react';
import {
  Apple,
  Users,
  User,
  Phone,
  Mail,
  MapPin,
  Building2,
  Cake,
  StickyNote,
  Globe,
  Link2,
  Download,
  Loader2,
  Search,
  FileDown,
  ChevronLeft,
  ChevronRight,
  Image,
  UserPlus,
  X,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PhoneNumber {
  label: string;
  number: string;
}

interface EmailAddress {
  label: string;
  email: string;
}

interface PostalAddress {
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

interface SocialProfile {
  service: string;
  username: string;
  url: string;
}

interface LinkedContact {
  name: string;
  relation: string;
}

interface ContactRecord {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string;
  nickname: string;
  organization: string;
  department: string;
  jobTitle: string;
  phoneNumbers: PhoneNumber[];
  emailAddresses: EmailAddress[];
  postalAddresses: PostalAddress[];
  birthday: string;
  notes: string;
  socialProfiles: SocialProfile[];
  linkedContacts: LinkedContact[];
  hasPhoto: boolean;
  photoPath: string;
  createdDate: string;
  modifiedDate: string;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosContacts: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<ContactRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterHasPhone, setFilterHasPhone] = useState(false);
  const [filterHasEmail, setFilterHasEmail] = useState(false);
  const [filterHasPhoto, setFilterHasPhoto] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactRecord | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
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
    setContacts([]);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_CONTACTS_EXTRACT, {
        backupPath,
      }) as { contacts: ContactRecord[] };
      setContacts(result.contacts);
    } catch (err) {
      console.error('Contact extraction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: 'vcf' | 'csv') => {
    setExporting(true);
    try {
      const ext = format === 'vcf' ? 'vcf' : 'csv';
      const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        title: `Export Contacts as ${format.toUpperCase()}`,
        defaultPath: `ios_contacts.${ext}`,
        filters: [{ name: format.toUpperCase(), extensions: [ext] }],
      });
      if (savePath) {
        await window.api.invoke(IPC_CHANNELS.IOS_CONTACTS_EXTRACT, {
          backupPath,
          exportPath: savePath,
          exportFormat: format,
          contactIds: filteredContacts.map((c) => c.id),
        });
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    let result = [...contacts];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
          c.nickname.toLowerCase().includes(q) ||
          c.organization.toLowerCase().includes(q) ||
          c.phoneNumbers.some((p) => p.number.includes(q)) ||
          c.emailAddresses.some((e) => e.email.toLowerCase().includes(q)) ||
          c.notes.toLowerCase().includes(q)
      );
    }

    if (filterHasPhone) result = result.filter((c) => c.phoneNumbers.length > 0);
    if (filterHasEmail) result = result.filter((c) => c.emailAddresses.length > 0);
    if (filterHasPhoto) result = result.filter((c) => c.hasPhoto);

    setFilteredContacts(result);
    setCurrentPage(1);
  }, [contacts, searchQuery, filterHasPhone, filterHasEmail, filterHasPhoto]);

  const totalPages = Math.ceil(filteredContacts.length / pageSize);
  const paginatedContacts = filteredContacts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getFullName = (c: ContactRecord) => {
    const parts = [c.firstName, c.middleName, c.lastName].filter(Boolean);
    return parts.join(' ') || c.nickname || c.organization || 'No Name';
  };

  const getInitials = (c: ContactRecord) => {
    const first = c.firstName?.[0] || '';
    const last = c.lastName?.[0] || '';
    return (first + last).toUpperCase() || '?';
  };

  const statsData = {
    total: contacts.length,
    withPhone: contacts.filter((c) => c.phoneNumbers.length > 0).length,
    withEmail: contacts.filter((c) => c.emailAddresses.length > 0).length,
    withPhoto: contacts.filter((c) => c.hasPhoto).length,
    withAddress: contacts.filter((c) => c.postalAddresses.length > 0).length,
    organizations: new Set(contacts.map((c) => c.organization).filter(Boolean)).size,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Contacts"
        description="Extract all contacts with phone numbers, emails, addresses, photos, social profiles, and linked contacts"
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
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <Users size={16} className="mr-2" />}
            {loading ? 'Extracting...' : 'Extract Contacts'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {contacts.length > 0 && (
        <div className="grid grid-cols-6 gap-3">
          {[
            { label: 'Total Contacts', value: statsData.total, color: 'text-blue-400' },
            { label: 'With Phone', value: statsData.withPhone, color: 'text-green-400' },
            { label: 'With Email', value: statsData.withEmail, color: 'text-purple-400' },
            { label: 'With Photo', value: statsData.withPhoto, color: 'text-orange-400' },
            { label: 'With Address', value: statsData.withAddress, color: 'text-cyan-400' },
            { label: 'Organizations', value: statsData.organizations, color: 'text-yellow-400' },
          ].map((s) => (
            <div key={s.label} className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              <div className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      {contacts.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search contacts..."
                className="input-field w-full pl-9"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              />
            </div>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={filterHasPhone} onChange={(e) => setFilterHasPhone(e.target.checked)} />
              Has phone
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={filterHasEmail} onChange={(e) => setFilterHasEmail(e.target.checked)} />
              Has email
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={filterHasPhoto} onChange={(e) => setFilterHasPhoto(e.target.checked)} />
              Has photo
            </label>

            <div className="flex gap-1 ml-auto">
              <button onClick={() => setViewMode('table')} className={`btn-secondary text-xs ${viewMode === 'table' ? 'ring-1 ring-blue-400' : ''}`}>Table</button>
              <button onClick={() => setViewMode('cards')} className={`btn-secondary text-xs ${viewMode === 'cards' ? 'ring-1 ring-blue-400' : ''}`}>Cards</button>
            </div>

            <button onClick={() => handleExport('vcf')} className="btn-secondary text-sm" disabled={exporting}>
              <FileDown size={14} className="mr-1" /> vCard
            </button>
            <button onClick={() => handleExport('csv')} className="btn-secondary text-sm" disabled={exporting}>
              <FileDown size={14} className="mr-1" /> CSV
            </button>
          </div>
          <div className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            {filteredContacts.length.toLocaleString()} of {contacts.length.toLocaleString()} contacts
          </div>
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && paginatedContacts.length > 0 && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Name</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Phone Numbers</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Emails</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Organization</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Birthday</th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Photo</th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Social</th>
                </tr>
              </thead>
              <tbody>
                {paginatedContacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--border-color)' }}
                    onClick={() => setSelectedContact(contact)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400 flex-shrink-0">
                          {getInitials(contact)}
                        </div>
                        <div>
                          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{getFullName(contact)}</div>
                          {contact.nickname && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>"{contact.nickname}"</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {contact.phoneNumbers.slice(0, 2).map((p, i) => (
                        <div key={i} className="text-xs" style={{ color: 'var(--text-primary)' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{p.label}: </span>{p.number}
                        </div>
                      ))}
                      {contact.phoneNumbers.length > 2 && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>+{contact.phoneNumbers.length - 2} more</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {contact.emailAddresses.slice(0, 2).map((e, i) => (
                        <div key={i} className="text-xs" style={{ color: 'var(--text-primary)' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{e.label}: </span>{e.email}
                        </div>
                      ))}
                      {contact.emailAddresses.length > 2 && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>+{contact.emailAddresses.length - 2} more</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {contact.organization && (
                        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{contact.organization}</div>
                      )}
                      {contact.jobTitle && (
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{contact.jobTitle}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {contact.birthday || '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {contact.hasPhoto ? <Image size={16} className="text-green-400 mx-auto" /> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {contact.socialProfiles.length > 0 ? (
                        <span className="badge-info text-xs px-2 py-0.5 rounded-full">{contact.socialProfiles.length}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
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

      {/* Card View */}
      {viewMode === 'cards' && paginatedContacts.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {paginatedContacts.map((contact) => (
            <div
              key={contact.id}
              className="card p-4 cursor-pointer transition-colors"
              style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
              onClick={() => setSelectedContact(contact)}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-card)')}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-lg font-bold text-blue-400 flex-shrink-0">
                  {getInitials(contact)}
                </div>
                <div>
                  <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{getFullName(contact)}</div>
                  {contact.organization && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{contact.organization}</div>}
                </div>
              </div>
              {contact.phoneNumbers.length > 0 && (
                <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  <Phone size={12} /> {contact.phoneNumbers[0].number}
                  {contact.phoneNumbers.length > 1 && <span style={{ color: 'var(--text-muted)' }}>+{contact.phoneNumbers.length - 1}</span>}
                </div>
              )}
              {contact.emailAddresses.length > 0 && (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <Mail size={12} /> {contact.emailAddresses[0].email}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Contact Detail Modal */}
      {selectedContact && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSelectedContact(null)}
        >
          <div
            className="card p-6 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center text-2xl font-bold text-blue-400">
                  {getInitials(selectedContact)}
                </div>
                <div>
                  <h3 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{getFullName(selectedContact)}</h3>
                  {selectedContact.nickname && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>"{selectedContact.nickname}"</div>}
                  {selectedContact.organization && (
                    <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {selectedContact.jobTitle && `${selectedContact.jobTitle} at `}{selectedContact.organization}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedContact(null)} className="btn-secondary p-1"><X size={18} /></button>
            </div>

            <div className="space-y-4">
              {/* Phone Numbers */}
              {selectedContact.phoneNumbers.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Phone size={14} /> Phone Numbers
                  </h4>
                  {selectedContact.phoneNumbers.map((p, i) => (
                    <div key={i} className="flex gap-3 py-1">
                      <span className="text-xs w-16 text-right" style={{ color: 'var(--text-muted)' }}>{p.label}</span>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{p.number}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Emails */}
              {selectedContact.emailAddresses.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Mail size={14} /> Email Addresses
                  </h4>
                  {selectedContact.emailAddresses.map((e, i) => (
                    <div key={i} className="flex gap-3 py-1">
                      <span className="text-xs w-16 text-right" style={{ color: 'var(--text-muted)' }}>{e.label}</span>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{e.email}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Addresses */}
              {selectedContact.postalAddresses.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <MapPin size={14} /> Addresses
                  </h4>
                  {selectedContact.postalAddresses.map((a, i) => (
                    <div key={i} className="py-1">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.label}: </span>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        {[a.street, a.city, a.state, a.zip, a.country].filter(Boolean).join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Birthday */}
              {selectedContact.birthday && (
                <div>
                  <h4 className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Cake size={14} /> Birthday
                  </h4>
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{selectedContact.birthday}</span>
                </div>
              )}

              {/* Social Profiles */}
              {selectedContact.socialProfiles.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Globe size={14} /> Social Profiles
                  </h4>
                  {selectedContact.socialProfiles.map((sp, i) => (
                    <div key={i} className="flex gap-3 py-1">
                      <span className="text-xs w-20 text-right font-medium" style={{ color: 'var(--text-muted)' }}>{sp.service}</span>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{sp.username}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Linked Contacts */}
              {selectedContact.linkedContacts.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Link2 size={14} /> Linked Contacts
                  </h4>
                  {selectedContact.linkedContacts.map((lc, i) => (
                    <div key={i} className="flex gap-3 py-1">
                      <span className="text-xs w-20 text-right" style={{ color: 'var(--text-muted)' }}>{lc.relation}</span>
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{lc.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              {selectedContact.notes && (
                <div>
                  <h4 className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <StickyNote size={14} /> Notes
                  </h4>
                  <div className="text-sm p-3 rounded" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                    {selectedContact.notes}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
                <div className="flex gap-6 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>Created: {new Date(selectedContact.createdDate).toLocaleString()}</span>
                  <span>Modified: {new Date(selectedContact.modifiedDate).toLocaleString()}</span>
                  <span>Photo: {selectedContact.hasPhoto ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && contacts.length === 0 && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Users size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and extract contacts to view them here</p>
        </div>
      )}
    </div>
  );
};
