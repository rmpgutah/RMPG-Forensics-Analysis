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
        await window.api.invoke('fs:write-file', savePath, lines);
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
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Download size={14} />
            Extract All
          </button>

          <button
            onClick={handleExport}
            disabled={!selectedDevice}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Export to Text
          </button>
        </div>

        <div className="flex-1">
          {/* Tabs */}
          <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-700 bg-slate-800/50 p-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  activeTab === tab.key
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="min-h-[400px] rounded-lg border border-slate-700 bg-slate-950 p-4">
            {!selectedDevice ? (
              <p className="text-sm text-slate-500">Select a device to view properties.</p>
            ) : loading[activeTab] ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                Fetching {activeTab} data...
              </div>
            ) : error ? (
              <p className="text-sm text-red-400">{error}</p>
            ) : currentData === undefined ? (
              <p className="text-sm text-slate-500">
                Click on a tab or use &quot;Extract All&quot; to fetch data.
              </p>
            ) : activeTab === 'packages' ? (
              <div className="space-y-1">
                <p className="mb-2 text-xs text-slate-500">
                  {Array.isArray(currentData) ? currentData.length : 0} packages found
                </p>
                <div className="max-h-[350px] overflow-y-auto font-mono text-xs">
                  {Array.isArray(currentData) &&
                    currentData.map((pkg, i) => (
                      <div key={i} className="text-slate-300 py-0.5">
                        {pkg}
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap font-mono text-xs text-slate-300">
                {String(currentData)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
