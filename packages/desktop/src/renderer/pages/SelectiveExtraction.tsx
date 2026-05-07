import React, { useState, useCallback } from 'react';
import { Target, Play, Search, Download, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  ProgressIndicator,
  DeviceSelector,
} from '../components/common';
import { useDeviceStatus, useProcess } from '../hooks';

interface ExtractItem {
  id: string;
  category: string;
  label: string;
  description: string;
  path: string;
  estimatedSize?: string;
  selected: boolean;
}

const QUICK_TARGETS: ExtractItem[] = [
  { id: 'contacts', category: 'Personal', label: 'Contacts', description: 'Phone contacts and address book', path: '/data/data/com.android.providers.contacts/databases/contacts2.db', estimatedSize: '< 5 MB', selected: false },
  { id: 'sms', category: 'Personal', label: 'SMS / MMS Messages', description: 'All text messages and multimedia messages', path: '/data/data/com.android.providers.telephony/databases/mmssms.db', estimatedSize: '< 50 MB', selected: false },
  { id: 'call-log', category: 'Personal', label: 'Call History', description: 'Complete call log with timestamps and durations', path: '/data/data/com.android.providers.contacts/databases/calllog.db', estimatedSize: '< 2 MB', selected: false },
  { id: 'whatsapp-db', category: 'Messaging', label: 'WhatsApp Messages', description: 'WhatsApp message database (msgstore.db)', path: '/data/data/com.whatsapp/databases/msgstore.db', estimatedSize: '10-500 MB', selected: false },
  { id: 'whatsapp-contacts', category: 'Messaging', label: 'WhatsApp Contacts', description: 'WhatsApp contact list and metadata', path: '/data/data/com.whatsapp/databases/wa.db', estimatedSize: '< 10 MB', selected: false },
  { id: 'telegram-db', category: 'Messaging', label: 'Telegram Messages', description: 'Telegram message cache and databases', path: '/data/data/org.telegram.messenger/files/', estimatedSize: '10-200 MB', selected: false },
  { id: 'signal-db', category: 'Messaging', label: 'Signal Messages', description: 'Signal encrypted message store', path: '/data/data/org.thoughtcrime.securesms/databases/', estimatedSize: '5-100 MB', selected: false },
  { id: 'chrome-history', category: 'Browsing', label: 'Chrome History', description: 'Browser history, bookmarks, and saved passwords', path: '/data/data/com.android.chrome/app_chrome/Default/', estimatedSize: '< 20 MB', selected: false },
  { id: 'wifi-passwords', category: 'Credentials', label: 'WiFi Passwords', description: 'Saved WiFi network credentials', path: '/data/misc/wifi/', estimatedSize: '< 1 MB', selected: false },
  { id: 'accounts', category: 'Credentials', label: 'Stored Accounts', description: 'Google, email, and app account data', path: '/data/system/sync/accounts.db', estimatedSize: '< 5 MB', selected: false },
  { id: 'photos-recent', category: 'Media', label: 'Recent Photos (Last 30 days)', description: 'Camera photos from the last 30 days only', path: '/sdcard/DCIM/Camera/', estimatedSize: '100 MB - 2 GB', selected: false },
  { id: 'screenshots', category: 'Media', label: 'Screenshots', description: 'All device screenshots', path: '/sdcard/DCIM/Screenshots/', estimatedSize: '10-200 MB', selected: false },
  { id: 'downloads', category: 'Files', label: 'Downloads Folder', description: 'All downloaded files', path: '/sdcard/Download/', estimatedSize: 'Varies', selected: false },
  { id: 'location', category: 'Location', label: 'Location History', description: 'GPS location cache and history', path: '/data/data/com.google.android.gms/databases/herrevad', estimatedSize: '< 10 MB', selected: false },
  { id: 'notifications', category: 'System', label: 'Notification Log', description: 'Recent notification history with content', path: '/data/system/notification_log.db', estimatedSize: '< 5 MB', selected: false },
  { id: 'clipboard', category: 'System', label: 'Clipboard History', description: 'Copied text and clipboard data', path: '/data/clipboard/', estimatedSize: '< 1 MB', selected: false },
  { id: 'app-list', category: 'System', label: 'Installed Apps List', description: 'List of all installed applications with metadata', path: '/data/system/packages.xml', estimatedSize: '< 2 MB', selected: false },
  { id: 'keystore', category: 'Credentials', label: 'Keystore / Saved Passwords', description: 'Android keystore and credential manager data', path: '/data/misc/keystore/', estimatedSize: '< 5 MB', selected: false },
];

export const SelectiveExtraction: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const process = useProcess({
    channel: IPC_CHANNELS.SELECTIVE_EXTRACT,
    progressChannel: IPC_CHANNELS.SELECTIVE_EXTRACT_PROGRESS,
  });

  const [targets, setTargets] = useState<ExtractItem[]>(QUICK_TARGETS.map((t) => ({ ...t })));
  const [outputFolder, setOutputFolder] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const categories = ['all', ...Array.from(new Set(targets.map((t) => t.category)))];
  const selectedCount = targets.filter((t) => t.selected).length;

  const filteredTargets = targets.filter((t) => {
    const matchesCategory = filterCategory === 'all' || t.category === filterCategory;
    const matchesSearch = !searchQuery || 
      t.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const toggleTarget = (id: string) => {
    setTargets(targets.map((t) => t.id === id ? { ...t, selected: !t.selected } : t));
  };

  const selectAll = () => {
    setTargets(targets.map((t) => ({ ...t, selected: true })));
  };

  const selectNone = () => {
    setTargets(targets.map((t) => ({ ...t, selected: false })));
  };

  const addCustomPath = () => {
    if (!customPath.trim()) return;
    const newItem: ExtractItem = {
      id: `custom-${Date.now()}`,
      category: 'Custom',
      label: customPath.split('/').pop() || customPath,
      description: `Custom path: ${customPath}`,
      path: customPath,
      selected: true,
    };
    setTargets([...targets, newItem]);
    setCustomPath('');
  };

  const handleStart = async () => {
    if (!selectedDevice || !outputFolder) return;
    const selectedTargets = targets.filter((t) => t.selected);
    if (selectedTargets.length === 0) return;
    await process.start({
      serial: selectedDevice.serial,
      outputPath: outputFolder,
      targets: selectedTargets.map((t) => ({ id: t.id, path: t.path, label: t.label })),
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Selective Extraction"
        description="Pull only the specific data you need — no full backup or device download required"
        icon={<Target size={24} />}
      />

      <div className="rounded-lg border border-green-700/50 bg-green-900/20 p-3 text-sm text-green-300">
        <div className="flex items-start gap-2">
          <CheckCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>TARGETED EXTRACTION:</strong> Select only the data you need and pull it
            directly from the device. No need to download the entire phone contents or run
            a full backup process. Extraction is fast and surgical — only selected items are
            transferred.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6">
        <div className="space-y-4">
          {/* Search and filter bar */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search data targets..."
                className="w-full rounded-md border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
            <button onClick={selectAll} className="rounded bg-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-600">
              Select All
            </button>
            <button onClick={selectNone} className="rounded bg-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-600">
              Clear
            </button>
          </div>

          {/* Extraction targets list */}
          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/50">
            {filteredTargets.map((target) => (
              <label
                key={target.id}
                className={`flex items-start gap-3 border-b border-slate-800 px-4 py-3 cursor-pointer hover:bg-slate-800/30 ${
                  target.selected ? 'bg-blue-900/10' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={target.selected}
                  onChange={() => toggleTarget(target.id)}
                  disabled={process.isRunning}
                  className="mt-1 rounded border-slate-600 bg-slate-800"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{target.label}</span>
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {target.category}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{target.description}</p>
                </div>
                {target.estimatedSize && (
                  <span className="text-[10px] text-slate-600 whitespace-nowrap mt-1">
                    ~{target.estimatedSize}
                  </span>
                )}
              </label>
            ))}
          </div>

          {/* Custom path input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="Add custom device path (e.g., /data/data/com.app/databases/)"
              disabled={process.isRunning}
              className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              onClick={addCustomPath}
              disabled={!customPath.trim() || process.isRunning}
              className="rounded-md bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            disabled={process.isRunning}
          />

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Select destination..."
            disabled={process.isRunning}
          />

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-400">Selected Items</span>
              <span className="text-xs font-bold text-white">{selectedCount}</span>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {targets.filter((t) => t.selected).map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 truncate">{t.label}</span>
                  <button
                    onClick={() => toggleTarget(t.id)}
                    className="text-slate-600 hover:text-red-400 ml-1"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleStart}
            disabled={process.isRunning || !selectedDevice || !outputFolder || selectedCount === 0}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            {process.isRunning ? 'Extracting...' : `Extract ${selectedCount} Item${selectedCount !== 1 ? 's' : ''}`}
          </button>

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
            <h4 className="mb-1.5 text-xs font-medium text-white">How It Works</h4>
            <ul className="space-y-1 text-[11px] text-slate-400">
              <li>• No full backup or device image needed</li>
              <li>• Pulls only the selected items directly</li>
              <li>• Works over ADB, USB, or network</li>
              <li>• Preserves file metadata and timestamps</li>
              <li>• Automatic root escalation if needed</li>
              <li>• Chain-of-custody hash generated per item</li>
            </ul>
          </div>

          {(process.isRunning || process.progress.percent > 0) && (
            <ProgressIndicator
              percent={process.progress.percent}
              message={process.progress.message}
              isRunning={process.isRunning}
            />
          )}
        </div>
      </div>

      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
