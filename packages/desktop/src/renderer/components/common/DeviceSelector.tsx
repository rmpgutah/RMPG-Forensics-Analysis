import React from 'react';
import { Smartphone, RefreshCw } from 'lucide-react';
import type { DeviceInfo } from '../../types/global';

interface DeviceSelectorProps {
  devices: DeviceInfo[];
  selected: DeviceInfo | null;
  onSelect: (device: DeviceInfo | null) => void;
  onRefresh?: () => void;
  filter?: 'android' | 'ios' | 'all';
  disabled?: boolean;
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  devices,
  selected,
  onSelect,
  onRefresh,
  filter = 'all',
  disabled = false,
}) => {
  const filtered = filter === 'all' ? devices : devices.filter((d) => d.type === filter);

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-300">Device</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Smartphone
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <select
            value={selected?.serial || ''}
            onChange={(e) => {
              const device = filtered.find((d) => d.serial === e.target.value);
              onSelect(device ?? null);
            }}
            disabled={disabled || filtered.length === 0}
            className="w-full appearance-none rounded-md border border-slate-700 bg-slate-800 py-2 pl-10 pr-8 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          >
            {filtered.length === 0 ? (
              <option value="">No devices connected</option>
            ) : (
              <>
                <option value="">Select a device...</option>
                {filtered.map((d) => (
                  <option key={d.serial} value={d.serial}>
                    {d.manufacturer} {d.model} ({d.serial})
                    {d.type === 'ios' ? ' [iOS]' : ' [Android]'}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={disabled}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50"
            title="Refresh devices"
          >
            <RefreshCw size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
