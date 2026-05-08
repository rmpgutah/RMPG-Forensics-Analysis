import React, { useState } from 'react';
import {
  Info,
  Cpu,
  HardDrive,
  Wifi,
  MapPin,
  Package,
  MemoryStick,
  Download,
  Loader2,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, DeviceSelector } from '../components/common';
import { useDeviceStatus } from '../hooks';

type TabKey = 'general' | 'imei' | 'location' | 'wifi' | 'cpu' | 'memory' | 'disk' | 'packages';

interface DeviceData {
  general: string;
  imei: string;
  location: string;
  wifi: string;
  cpu: string;
  memory: string;
  disk: string;
  packages: string[];
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: 'General', icon: <Info size={14} /> },
  { key: 'imei', label: 'IMEI', icon: <Info size={14} /> },
  { key: 'location', label: 'Location', icon: <MapPin size={14} /> },
  { key: 'wifi', label: 'WiFi', icon: <Wifi size={14} /> },
  { key: 'cpu', label: 'CPU', icon: <Cpu size={14} /> },
  { key: 'memory', label: 'Memory', icon: <MemoryStick size={14} /> },
  { key: 'disk', label: 'Disk Stats', icon: <HardDrive size={14} /> },
  { key: 'packages', label: 'Packages', icon: <Package size={14} /> },
];

const channelMap: Record<TabKey, string> = {
  general: IPC_CHANNELS.DEVICE_GET_PROPERTIES,
  imei: IPC_CHANNELS.DEVICE_GET_IMEI,
  location: IPC_CHANNELS.DEVICE_GET_LOCATION,
  wifi: IPC_CHANNELS.DEVICE_GET_WIFI,
  cpu: IPC_CHANNELS.DEVICE_GET_CPU,
  memory: IPC_CHANNELS.DEVICE_GET_MEMORY,
  disk: IPC_CHANNELS.DEVICE_GET_DISKSTATS,
  packages: IPC_CHANNELS.DEVICE_GET_PACKAGES,
};

export const DeviceInfo: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [data, setData] = useState<Partial<DeviceData>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchTab = async (tab: TabKey) => {
    if (!selectedDevice) return;
    setLoading((prev) => ({ ...prev, [tab]: true }));
    setError(null);
    try {
      const result = await window.api.invoke(channelMap[tab], selectedDevice.serial);
      setData((prev) => ({ ...prev, [tab]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading((prev) => ({ ...prev, [tab]: false }));
    }
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    if (!data[tab]) {
      fetchTab(tab);
    }
  };

  const handleExtractAll = async () => {
    if (!selectedDevice) return;
    for (const tab of TABS) {
      await fetchTab(tab.key);
    }
  };

  const handleExport = async () => {
    if (!selectedDevice) return;
    try {
      const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
        defaultPath: `device_info_${selectedDevice.serial}.txt`,
      });
      if (savePath) {
        const lines = TABS.map((t) => {
          const val = data[t.key];
          // Use a JSON-friendly representation for objects, simple toString
          // for primitives — same intent as the on-screen renderer but
          // serialised for plain-text export.
          let content: string;
          if (val == null) content = 'Not fetched';
          else if (Array.isArray(val)) content = val.map((v) => typeof v === 'object' ? JSON.stringify(v) : String(v)).join('\n');
          else if (typeof val === 'object') content = JSON.stringify(val, null, 2);
          else content = String(val);
          return `=== ${t.label} ===\n${content}`;
        }).join('\n\n');
        await window.api.invoke(IPC_CHANNELS.FILE_WRITE, savePath, lines);
      }
    } catch {
      // Export cancelled or failed
    }
  };

  const currentData = data[activeTab];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Information"
        description="Extract detailed properties and diagnostics from a connected Android device"
        icon={<Info size={24} />}
      />

      <div className="flex gap-4">
        <div className="w-64 space-y-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            filter="android"
          />

          <button
            onClick={handleExtractAll}
            disabled={!selectedDevice}
            className="btn-primary flex w-full items-center justify-center gap-2 text-sm"
          >
            <Download size={14} />
            Extract All
          </button>

          <button
            onClick={handleExport}
            disabled={!selectedDevice}
            className="btn-secondary flex w-full items-center justify-center gap-2 text-sm"
          >
            Export to Text
          </button>
        </div>

        <div className="flex-1">
          {/* Tabs */}
          <div className="mb-4 flex flex-wrap gap-1 rounded-lg border p-1"
            style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  activeTab === tab.key
                    ? 'bg-[#6495ED] text-white'
                    : 'hover:bg-[var(--bg-hover)]'
                }`}
                style={activeTab === tab.key ? {} : { color: 'var(--text-secondary)' }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="card min-h-[400px]">
            {!selectedDevice ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a device to view properties.</p>
            ) : loading[activeTab] ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <Loader2 size={14} className="animate-spin" />
                Fetching {activeTab} data…
              </div>
            ) : error ? (
              <p className="text-sm text-red-400">{error}</p>
            ) : currentData === undefined ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Click a tab or use &quot;Extract All&quot; to fetch data.
              </p>
            ) : activeTab === 'packages' ? (
              <div className="space-y-1">
                <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {Array.isArray(currentData) ? currentData.length : 0} packages found
                </p>
                <div className="max-h-[350px] overflow-y-auto font-mono text-xs">
                  {Array.isArray(currentData) &&
                    currentData.map((pkg, i) => (
                      <div key={i} className="py-0.5" style={{ color: 'var(--text-primary)' }}>
                        {pkg}
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              // Generic renderer (see helper below): pretty-prints objects
              // as key/value rows, arrays as tables, primitives as text.
              // Replaces the previous String(currentData) which produced
              // "[object Object]" for every non-string handler return.
              <div className="max-h-[400px] overflow-auto font-mono text-xs"
                style={{ color: 'var(--text-primary)' }}>
                {renderDeviceData(currentData)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Pretty-print arbitrary handler return values (objects, arrays of
 * objects, arrays of primitives, scalars, null) as readable HTML. The
 * old `String(value)` rendered "[object Object]" for every non-string,
 * which is what the user reported across General/IMEI/Location/WiFi tabs.
 *
 * Layout choices:
 * - null/undefined → "—" muted, never blank (silent emptiness reads as
 *   "still loading" to users)
 * - primitive → just text
 * - array of primitives → bullet list
 * - array of objects → 2-column table (uses union-of-keys for stable cols)
 * - plain object → 2-column key/value grid (left col aligned, monospaced
 *   key, value gets word-break so long URLs don't blow the layout)
 */
function renderDeviceData(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  if (typeof value !== 'object') {
    return <pre className="whitespace-pre-wrap">{String(value)}</pre>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span style={{ color: 'var(--text-muted)' }}>(empty)</span>;
    }
    const allPrimitive = value.every((v) => typeof v !== 'object' || v === null);
    if (allPrimitive) {
      return (
        <ul className="space-y-0.5">
          {value.map((v, i) => (
            <li key={i} className="truncate">{String(v)}</li>
          ))}
        </ul>
      );
    }
    // Array of objects → table
    const cols = Array.from(value.reduce<Set<string>>((acc, row) => {
      if (row && typeof row === 'object') for (const k of Object.keys(row)) acc.add(k);
      return acc;
    }, new Set<string>()));
    return (
      <div className="overflow-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {cols.map((c) => (<th key={c} className="px-2 py-1 border-b border-[var(--border-color)]">{c}</th>))}
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) => (
              <tr key={i} className="border-b border-[var(--border-color)]/50">
                {cols.map((c) => {
                  const cell = (row as Record<string, unknown>)?.[c];
                  return (
                    <td key={c} className="px-2 py-1 align-top break-all">
                      {cell == null ? <span style={{ color: 'var(--text-muted)' }}>—</span> : String(cell)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  // Plain object → key/value grid
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>(no data)</span>;
  }
  return (
    <div className="grid grid-cols-[max-content,1fr] gap-x-3 gap-y-1">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <div className="text-right pr-2 font-medium" style={{ color: 'var(--text-muted)' }}>{k}</div>
          <div className="break-all">
            {v === null || v === undefined
              ? <span style={{ color: 'var(--text-muted)' }}>—</span>
              : typeof v === 'object'
                ? <pre className="whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre>
                : String(v)}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
