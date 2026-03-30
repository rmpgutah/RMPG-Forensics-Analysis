import React, { useState, useCallback } from 'react';
import {
  Settings,
  Play,
  CheckSquare,
  Square,
  Loader2,
  Download,
  RotateCcw,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FolderPicker, DeviceSelector } from '../components/common';
import { useDeviceStatus, useIpc } from '../hooks';

interface CollectionItem {
  id: string;
  label: string;
  category: 'system' | 'network' | 'hardware' | 'security' | 'apps' | 'logs';
}

const COLLECTION_ITEMS: CollectionItem[] = [
  { id: 'system_properties', label: 'System Properties', category: 'system' },
  { id: 'dumpsys', label: 'Dumpsys', category: 'system' },
  { id: 'disk_info', label: 'Disk Info', category: 'hardware' },
  { id: 'geolocation', label: 'Geolocation', category: 'system' },
  { id: 'imei_01', label: 'IMEI (Slot 01)', category: 'hardware' },
  { id: 'imei_02', label: 'IMEI (Slot 02)', category: 'hardware' },
  { id: 'serial_number', label: 'Serial Number', category: 'hardware' },
  { id: 'active_processes', label: 'Active Processes', category: 'system' },
  { id: 'tcp_connections', label: 'TCP Connections', category: 'network' },
  { id: 'account_info', label: 'Account Info', category: 'security' },
  { id: 'wifi_dumps', label: 'WiFi Dumps', category: 'network' },
  { id: 'cpu_info', label: 'CPU Info', category: 'hardware' },
  { id: 'memory_info', label: 'Memory Info', category: 'hardware' },
  { id: 'display_info', label: 'Display Info', category: 'hardware' },
  { id: 'logcat', label: 'LogCat', category: 'logs' },
  { id: 'disk_usage', label: 'Disk Usage', category: 'hardware' },
  { id: 'carrier_info', label: 'Carrier Info', category: 'network' },
  { id: 'bluetooth_status', label: 'Bluetooth Status', category: 'network' },
  { id: 'face_recognition', label: 'Face Recognition', category: 'security' },
  { id: 'global_settings', label: 'Global Settings', category: 'system' },
  { id: 'security_settings', label: 'Security Settings', category: 'security' },
  { id: 'system_settings', label: 'System Settings', category: 'system' },
  { id: 'android_version', label: 'Android Version', category: 'system' },
  { id: 'on_off_history', label: 'On/Off History', category: 'logs' },
  { id: 'active_users', label: 'Active Users', category: 'security' },
  { id: 'system_events', label: 'System Events', category: 'logs' },
  { id: 'power_history', label: 'Power History', category: 'logs' },
  { id: 'installed_apps_3rd', label: 'Installed Apps (3rd Party)', category: 'apps' },
  { id: 'installed_apps_native', label: 'Installed Apps (Native)', category: 'apps' },
  { id: 'database_info', label: 'Database Info', category: 'system' },
  { id: 'adb_status', label: 'ADB Status', category: 'system' },
];

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'system', label: 'System' },
  { key: 'hardware', label: 'Hardware' },
  { key: 'network', label: 'Network' },
  { key: 'security', label: 'Security' },
  { key: 'apps', label: 'Apps' },
  { key: 'logs', label: 'Logs' },
];

export const MiscCollections: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const ipc = useIpc();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outputFolder, setOutputFolder] = useState('');
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [currentItem, setCurrentItem] = useState('');
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());
  const [failedItems, setFailedItems] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');

  const addLog = useCallback(
    (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]),
    []
  );

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(COLLECTION_ITEMS.map((i) => i.id)));
  const selectNone = () => setSelected(new Set());
  const selectCategory = (cat: string) => {
    setSelected(new Set(COLLECTION_ITEMS.filter((i) => i.category === cat).map((i) => i.id)));
  };

  const filteredItems =
    categoryFilter === 'all'
      ? COLLECTION_ITEMS
      : COLLECTION_ITEMS.filter((i) => i.category === categoryFilter);

  const handleCollect = async (items: string[]) => {
    if (!selectedDevice || !outputFolder || items.length === 0) return;
    setCollecting(true);
    setProgress(0);
    setTotalItems(items.length);
    setCompletedItems(new Set());
    setFailedItems(new Set());

    addLog(`Starting collection of ${items.length} items...`);

    for (let i = 0; i < items.length; i++) {
      const itemId = items[i];
      const itemLabel = COLLECTION_ITEMS.find((c) => c.id === itemId)?.label ?? itemId;
      setCurrentItem(itemLabel);
      setProgress(((i + 1) / items.length) * 100);
      addLog(`Collecting: ${itemLabel}`);

      try {
        const result = await ipc.invoke<{ success: boolean; message?: string }>(
          IPC_CHANNELS.MISC_COLLECT,
          {
            serial: selectedDevice.serial,
            item: itemId,
            outputPath: outputFolder,
          }
        );

        if (result?.success) {
          setCompletedItems((prev) => new Set([...prev, itemId]));
          addLog(`Completed: ${itemLabel}`);
        } else {
          setFailedItems((prev) => new Set([...prev, itemId]));
          addLog(`Failed: ${itemLabel} - ${result?.message ?? 'Unknown error'}`);
        }
      } catch (err) {
        setFailedItems((prev) => new Set([...prev, itemId]));
        addLog(`Error: ${itemLabel} - ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    setCurrentItem('');
    addLog('Collection process finished.');
    setCollecting(false);
  };

  const handleCollectAll = () =>
    handleCollect(COLLECTION_ITEMS.map((i) => i.id));

  const handleCollectSelected = () =>
    handleCollect(Array.from(selected));

  const progressPercent = Math.round(progress);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Miscellaneous Collections"
        description="Comprehensive system data dump -- collect device properties, diagnostics, and forensic artifacts"
        icon={<Settings size={24} />}
      />

      {/* Top controls */}
      <div className="card">
        <div className="grid grid-cols-3 gap-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            filter="android"
            disabled={collecting}
          />
          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={collecting}
          />
          <div className="flex items-end gap-2">
            <button
              onClick={handleCollectAll}
              disabled={collecting || !selectedDevice || !outputFolder}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {collecting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Collect All
            </button>
            <button
              onClick={handleCollectSelected}
              disabled={collecting || !selectedDevice || !outputFolder || selected.size === 0}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Play size={14} />
              Collect Selected ({selected.size})
            </button>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {collecting && (
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              Collecting: {currentItem}
            </span>
            <span className="text-sm text-[var(--text-muted)]">{progressPercent}%</span>
          </div>
          <div className="w-full h-3 bg-[var(--bg-hover)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#6495ED] rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="mt-2 flex gap-4 text-xs text-[var(--text-muted)]">
            <span>Completed: {completedItems.size}/{totalItems}</span>
            {failedItems.size > 0 && (
              <span className="text-red-600">Failed: {failedItems.size}</span>
            )}
          </div>
        </div>
      )}

      {/* Category filter tabs */}
      <div className="flex items-center gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategoryFilter(cat.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              categoryFilter === cat.key
                ? 'bg-[#6495ED] text-white'
                : 'bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[#2a2f3a] border border-[var(--border-color)]'
            }`}
          >
            {cat.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2 text-xs">
          <button onClick={selectAll} className="text-[#6495ED] hover:underline">
            Select All
          </button>
          <span className="text-[var(--text-muted)]">|</span>
          <button onClick={selectNone} className="text-[#6495ED] hover:underline">
            Clear All
          </button>
          {categoryFilter !== 'all' && (
            <>
              <span className="text-[var(--text-muted)]">|</span>
              <button
                onClick={() => selectCategory(categoryFilter)}
                className="text-[#6495ED] hover:underline"
              >
                Select Category
              </button>
            </>
          )}
        </div>
      </div>

      {/* Grid of collection items */}
      <div className="grid grid-cols-4 gap-3">
        {filteredItems.map((item) => {
          const isSelected = selected.has(item.id);
          const isCompleted = completedItems.has(item.id);
          const isFailed = failedItems.has(item.id);
          const isRunning = collecting && currentItem === item.label;

          return (
            <button
              key={item.id}
              onClick={() => !collecting && toggleItem(item.id)}
              disabled={collecting}
              className={`card flex items-center gap-3 p-3 text-left transition-all cursor-pointer ${
                isSelected ? 'ring-2 ring-[#6495ED] border-[#6495ED]' : ''
              } ${isCompleted ? 'bg-green-50 border-green-200' : ''} ${
                isFailed ? 'bg-red-50 border-red-200' : ''
              } ${isRunning ? 'bg-blue-50 border-[#6495ED]' : ''} disabled:cursor-not-allowed`}
            >
              {isRunning ? (
                <Loader2 size={16} className="animate-spin text-[#6495ED] shrink-0" />
              ) : isCompleted ? (
                <CheckSquare size={16} className="text-green-600 shrink-0" />
              ) : isSelected ? (
                <CheckSquare size={16} className="text-[#6495ED] shrink-0" />
              ) : (
                <Square size={16} className="text-[var(--text-muted)] shrink-0" />
              )}
              <span className="text-sm text-[var(--text-primary)] truncate">{item.label}</span>
              {isFailed && <span className="badge-danger ml-auto text-[10px]">Failed</span>}
            </button>
          );
        })}
      </div>

      {/* Results summary */}
      {!collecting && (completedItems.size > 0 || failedItems.size > 0) && (
        <div className="card flex items-center justify-between">
          <div className="flex gap-4 text-sm">
            <span className="text-green-600 font-medium">
              {completedItems.size} collected successfully
            </span>
            {failedItems.size > 0 && (
              <span className="text-red-600 font-medium">{failedItems.size} failed</span>
            )}
          </div>
          <button
            onClick={() => {
              setCompletedItems(new Set());
              setFailedItems(new Set());
              setProgress(0);
            }}
            className="btn-ghost flex items-center gap-1.5 text-sm"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
      )}

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
