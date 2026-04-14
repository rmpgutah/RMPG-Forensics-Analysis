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
          const content = Array.isArray(val) ? val.join('\n') : String(val ?? 'Not fetched');
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
              <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap font-mono text-xs"
                style={{ color: 'var(--text-primary)' }}>
                {String(currentData)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
