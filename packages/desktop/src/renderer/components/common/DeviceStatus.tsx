import React from 'react';
import { Smartphone, WifiOff, RefreshCw } from 'lucide-react';
import { useDeviceStatus } from '../../hooks/useDeviceStatus';

export const DeviceStatus: React.FC = () => {
  const { allDevices, selectedDevice, isPolling, refresh } = useDeviceStatus();
  const connected = allDevices.length > 0;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={refresh}
        className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        title="Refresh devices"
      >
        <RefreshCw size={12} className={isPolling ? 'animate-spin' : ''} />
      </button>

      {connected ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <Smartphone size={14} className="text-green-400" />
          <span className="text-slate-300">
            {selectedDevice?.model || selectedDevice?.serial || 'Connected'}
          </span>
          {allDevices.length > 1 && (
            <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
              +{allDevices.length - 1}
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          <WifiOff size={14} className="text-red-400" />
          <span className="text-slate-500">No device connected</span>
        </div>
      )}
    </div>
  );
};
