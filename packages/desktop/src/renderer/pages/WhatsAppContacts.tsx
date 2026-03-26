import React, { useState } from 'react';
import { Contact, Search, Download, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, DeviceSelector } from '../components/common';
import { useDeviceStatus, useIpc } from '../hooks';

interface WhatsAppContact {
  name: string;
  number: string;
  status: string;
}

export const WhatsAppContacts: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const ipc = useIpc();

  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<keyof WhatsAppContact>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const handleBrowse = async () => {
    if (!selectedDevice) return;
    setBrowsing(true);
    const result = await ipc.invoke<WhatsAppContact[]>(
      IPC_CHANNELS.WHATSAPP_BROWSE_CONTACTS,
      { serial: selectedDevice.serial }
    );
    if (result) {
      setContacts(result);
    }
    setBrowsing(false);
  };

  const handleExportCsv = () => {
    if (filteredContacts.length === 0) return;
    const header = 'Name,Number,Status';
    const rows = filteredContacts.map(
      (c) => `"${c.name.replace(/"/g, '""')}","${c.number}","${c.status.replace(/"/g, '""')}"`
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSort = (field: keyof WhatsAppContact) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const filteredContacts = contacts
    .filter(
      (c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.number.includes(searchQuery) ||
        c.status.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      const aVal = a[sortField].toLowerCase();
      const bVal = b[sortField].toLowerCase();
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });

  const SortHeader: React.FC<{ field: keyof WhatsAppContact; label: string }> = ({ field, label }) => (
    <th
      onClick={() => handleSort(field)}
      className="cursor-pointer px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 hover:text-slate-300"
    >
      {label}
      {sortField === field && (
        <span className="ml-1">{sortAsc ? '\u2191' : '\u2193'}</span>
      )}
    </th>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Contacts"
        description="Browse and export WhatsApp contacts from a connected device"
        icon={<Contact size={24} />}
      />

      <div className="flex items-center gap-4">
        <div className="w-80">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            filter="android"
            disabled={browsing}
          />
        </div>

        <button
          onClick={handleBrowse}
          disabled={browsing || !selectedDevice}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {browsing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Search size={16} />
          )}
          {browsing ? 'Loading...' : 'Browse Contacts'}
        </button>

        {contacts.length > 0 && (
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-750"
          >
            <Download size={16} />
            Export CSV
          </button>
        )}
      </div>

      {ipc.error && (
        <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          {ipc.error}
        </div>
      )}

      {/* Search + Table */}
      {contacts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contacts..."
              className="w-80 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-400">
              {filteredContacts.length} of {contacts.length} contacts
            </span>
          </div>

          <div className="max-h-[500px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/50">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-800">
                <tr className="border-b border-slate-700">
                  <SortHeader field="name" label="Name" />
                  <SortHeader field="number" label="Number" />
                  <SortHeader field="status" label="Status" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredContacts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                      No contacts match your search.
                    </td>
                  </tr>
                ) : (
                  filteredContacts.map((contact, i) => (
                    <tr key={`${contact.number}-${i}`} className="hover:bg-slate-800/80">
                      <td className="px-4 py-2.5 text-white">{contact.name}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">{contact.number}</td>
                      <td className="px-4 py-2.5 text-slate-400 truncate max-w-[250px]">
                        {contact.status || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!browsing && contacts.length === 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 py-16 text-center">
          <Contact size={40} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm text-slate-500">
            Select a device and click "Browse Contacts" to load WhatsApp contacts.
          </p>
        </div>
      )}
    </div>
  );
};
