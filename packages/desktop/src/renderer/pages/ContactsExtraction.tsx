import React, { useState } from 'react';
import {
  Users,
  MessageSquare,
  Download,
  Loader2,
  FileDown,
  Search,
  Phone,
  Mail,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, DeviceSelector, FolderPicker } from '../components/common';
import { useDeviceStatus } from '../hooks';

interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  organization?: string;
}

interface SmsMessage {
  id: string;
  address: string;
  contactName?: string;
  body: string;
  date: string;
  type: 'sent' | 'received';
}

type ActiveTab = 'contacts' | 'sms';

export const ContactsExtraction: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const [activeTab, setActiveTab] = useState<ActiveTab>('contacts');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([]);
  const [extractingContacts, setExtractingContacts] = useState(false);
  const [extractingSms, setExtractingSms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [outputFolder, setOutputFolder] = useState('');

  const handleExtractContacts = async () => {
    if (!selectedDevice) return;
    setExtractingContacts(true);
    setError(null);
    try {
      const result = (await window.api.invoke(IPC_CHANNELS.CONTACTS_EXTRACT, {
        serial: selectedDevice.serial,
      })) as Contact[];
      setContacts(result ?? []);
      setActiveTab('contacts');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtractingContacts(false);
    }
  };

  const handleExtractSms = async () => {
    if (!selectedDevice) return;
    setExtractingSms(true);
    setError(null);
    try {
      const result = (await window.api.invoke(IPC_CHANNELS.SMS_EXTRACT, {
        serial: selectedDevice.serial,
      })) as SmsMessage[];
      setSmsMessages(result ?? []);
      setActiveTab('sms');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtractingSms(false);
    }
  };

  const handleExportContacts = async () => {
    if (contacts.length === 0 || !outputFolder) return;
    try {
      const header = 'Name,Phone,Email,Organization';
      const rows = contacts.map(
        (c) => `"${c.name}","${c.phone}","${c.email ?? ''}","${c.organization ?? ''}"`
      );
      const csvPath = `${outputFolder}/contacts_${selectedDevice?.serial ?? 'export'}.csv`;
      await window.api.invoke('fs:write-file', csvPath, [header, ...rows].join('\n'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportSms = async () => {
    if (smsMessages.length === 0 || !outputFolder) return;
    try {
      const header = 'Address,Contact,Body,Date,Type';
      const rows = smsMessages.map(
        (m) =>
          `"${m.address}","${m.contactName ?? ''}","${m.body.replace(/"/g, '""')}","${m.date}","${m.type}"`
      );
      const csvPath = `${outputFolder}/sms_${selectedDevice?.serial ?? 'export'}.csv`;
      await window.api.invoke('fs:write-file', csvPath, [header, ...rows].join('\n'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const filteredContacts = searchFilter
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
          c.phone.includes(searchFilter)
      )
    : contacts;

  const filteredSms = searchFilter
    ? smsMessages.filter(
        (m) =>
          m.address.includes(searchFilter) ||
          (m.contactName?.toLowerCase().includes(searchFilter.toLowerCase()) ?? false) ||
          m.body.toLowerCase().includes(searchFilter.toLowerCase())
      )
    : smsMessages;

  const isBusy = extractingContacts || extractingSms;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts & SMS Extraction"
        description="Extract contacts and SMS messages from an Android device via ADB"
        icon={<Users size={24} />}
      />

      <div className="grid grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Device</h3>
            <DeviceSelector
              devices={allDevices}
              selected={selectedDevice}
              onSelect={selectDevice}
              onRefresh={refresh}
              filter="android"
              disabled={isBusy}
            />
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Actions</h3>
            <div className="space-y-2">
              <button
                onClick={handleExtractContacts}
                disabled={!selectedDevice || isBusy}
                className="btn-primary flex w-full items-center justify-center gap-2 text-sm"
              >
                {extractingContacts ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Users size={14} />
                )}
                {extractingContacts ? 'Extracting...' : 'Extract Contacts'}
              </button>

              <button
                onClick={handleExtractSms}
                disabled={!selectedDevice || isBusy}
                className="btn-primary flex w-full items-center justify-center gap-2 text-sm"
              >
                {extractingSms ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <MessageSquare size={14} />
                )}
                {extractingSms ? 'Extracting...' : 'Extract SMS'}
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Export</h3>
            <FolderPicker
              label=""
              value={outputFolder}
              onChange={setOutputFolder}
              disabled={isBusy}
            />
            <div className="mt-3 space-y-2">
              <button
                onClick={handleExportContacts}
                disabled={contacts.length === 0 || !outputFolder}
                className="btn-secondary flex w-full items-center justify-center gap-2 text-sm"
              >
                <FileDown size={14} />
                Export Contacts CSV
              </button>
              <button
                onClick={handleExportSms}
                disabled={smsMessages.length === 0 || !outputFolder}
                className="btn-secondary flex w-full items-center justify-center gap-2 text-sm"
              >
                <FileDown size={14} />
                Export SMS CSV
              </button>
            </div>
          </div>

          {/* Statistics */}
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                <p className="text-2xl font-bold text-[#6495ED]">{contacts.length}</p>
                <p className="text-xs text-[var(--text-muted)]">Contacts</p>
              </div>
              <div className="rounded-lg bg-purple-50 p-3 text-center">
                <p className="text-2xl font-bold text-purple-500">{smsMessages.length}</p>
                <p className="text-xs text-[var(--text-muted)]">SMS Messages</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="col-span-3 space-y-4">
          {/* Tab bar */}
          <div className="flex items-center gap-4">
            <div className="flex gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-hover)] p-1">
              <button
                onClick={() => setActiveTab('contacts')}
                className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'contacts'
                    ? 'bg-[#6495ED] text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                }`}
              >
                <Users size={14} />
                Contacts ({contacts.length})
              </button>
              <button
                onClick={() => setActiveTab('sms')}
                className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'sms'
                    ? 'bg-[#6495ED] text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                }`}
              >
                <MessageSquare size={14} />
                SMS ({smsMessages.length})
              </button>
            </div>

            {/* Search */}
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder={activeTab === 'contacts' ? 'Search contacts by name or phone...' : 'Search messages...'}
                className="input-field pl-9 text-sm"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Contacts table */}
          {activeTab === 'contacts' && (
            <div className="card !p-0 overflow-hidden">
              <div className="max-h-[520px] overflow-y-auto">
                {filteredContacts.length === 0 ? (
                  <div className="py-16 text-center">
                    <Users size={40} className="mx-auto mb-2 text-[var(--text-muted)]" />
                    <p className="text-sm text-[var(--text-muted)]">
                      {contacts.length === 0
                        ? 'No contacts extracted yet. Connect a device and click Extract Contacts.'
                        : 'No contacts match your search.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--bg-hover)] sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Phone</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Email</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Organization</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-color)]">
                      {filteredContacts.map((contact) => (
                        <tr key={contact.id} className="hover:bg-[#F0F0FF] transition-colors">
                          <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-primary)] text-xs font-bold text-[#6495ED]">
                                {contact.name.charAt(0).toUpperCase()}
                              </div>
                              {contact.name}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                            <div className="flex items-center gap-1.5">
                              <Phone size={12} className="text-[var(--text-muted)]" />
                              {contact.phone}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                            {contact.email ? (
                              <div className="flex items-center gap-1.5">
                                <Mail size={12} className="text-[var(--text-muted)]" />
                                {contact.email}
                              </div>
                            ) : (
                              <span className="text-[var(--text-muted)]">--</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-muted)]">{contact.organization || '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* SMS table */}
          {activeTab === 'sms' && (
            <div className="card !p-0 overflow-hidden">
              <div className="max-h-[520px] overflow-y-auto">
                {filteredSms.length === 0 ? (
                  <div className="py-16 text-center">
                    <MessageSquare size={40} className="mx-auto mb-2 text-[var(--text-muted)]" />
                    <p className="text-sm text-[var(--text-muted)]">
                      {smsMessages.length === 0
                        ? 'No SMS messages extracted yet. Connect a device and click Extract SMS.'
                        : 'No messages match your search.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--bg-hover)] sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider w-20">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider w-36">Address</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Message</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider w-40">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-color)]">
                      {filteredSms.map((msg) => (
                        <tr key={msg.id} className="hover:bg-[#F0F0FF] transition-colors">
                          <td className="px-4 py-2.5">
                            <span
                              className={`badge ${
                                msg.type === 'received' ? 'badge-info' : 'badge-success'
                              }`}
                            >
                              {msg.type === 'received' ? 'In' : 'Out'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div>
                              <span className="font-medium text-[var(--text-primary)]">{msg.contactName || msg.address}</span>
                              {msg.contactName && (
                                <p className="text-xs text-[var(--text-muted)]">{msg.address}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-md">
                            <p className="truncate">{msg.body}</p>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-[var(--text-muted)]">{msg.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Status bar */}
          <div className="text-xs text-[var(--text-muted)] text-right">
            {activeTab === 'contacts'
              ? `Showing ${filteredContacts.length} of ${contacts.length} contacts`
              : `Showing ${filteredSms.length} of ${smsMessages.length} messages`}
          </div>
        </div>
      </div>
    </div>
  );
};
