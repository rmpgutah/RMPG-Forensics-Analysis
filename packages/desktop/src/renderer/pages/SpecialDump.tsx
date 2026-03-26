import React, { useState, useCallback } from 'react';
import { Database, Play, RefreshCw, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FolderPicker, DeviceSelector } from '../components/common';
import { useDeviceStatus, useIpc } from '../hooks';

export const SpecialDump: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const ipc = useIpc();

  const [services, setServices] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [loadingServices, setLoadingServices] = useState(false);
  const [outputFolder, setOutputFolder] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const fetchServices = useCallback(async () => {
    if (!selectedDevice) return;
    setLoadingServices(true);
    addLog('Fetching dumpsys services...');
    const result = await ipc.invoke<string[]>(IPC_CHANNELS.DUMP_LIST_SERVICES, {
      serial: selectedDevice.serial,
    });
    if (result) {
      setServices(result);
      addLog(`Found ${result.length} services.`);
    } else {
      addLog('Failed to list services.');
    }
    setLoadingServices(false);
  }, [selectedDevice, ipc]);

  const toggleService = (svc: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(svc)) next.delete(svc);
      else next.add(svc);
      return next;
    });
  };

  const selectAll = () => setSelectedServices(new Set(filteredServices));
  const selectNone = () => setSelectedServices(new Set());

  const handleExtract = async () => {
    if (!selectedDevice || !outputFolder || selectedServices.size === 0) return;
    setExtracting(true);
    addLog(`Extracting ${selectedServices.size} services...`);
    const result = await ipc.invoke<{ success: boolean; message?: string }>(
      IPC_CHANNELS.DUMP_EXTRACT,
      {
        serial: selectedDevice.serial,
        services: Array.from(selectedServices),
        outputPath: outputFolder,
      }
    );
    if (result?.success) {
      addLog('Extraction completed successfully.');
    } else {
      addLog(`Extraction failed: ${result?.message ?? ipc.error ?? 'Unknown error'}`);
    }
    setExtracting(false);
  };

  const filteredServices = filter
    ? services.filter((s) => s.toLowerCase().includes(filter.toLowerCase()))
    : services;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Special Dump"
        description="Extract Android dumpsys service data for forensic analysis"
        icon={<Database size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Left column - config */}
        <div className="space-y-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            filter="android"
            disabled={extracting}
          />

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={extracting}
          />

          <button
            onClick={handleExtract}
            disabled={extracting || !selectedDevice || !outputFolder || selectedServices.size === 0}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {extracting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {extracting ? 'Extracting...' : `Extract ${selectedServices.size} Service${selectedServices.size !== 1 ? 's' : ''}`}
          </button>
        </div>

        {/* Right column - service list */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-300">
              Dumpsys Services
              {services.length > 0 && (
                <span className="ml-2 text-slate-500">({selectedServices.size}/{services.length})</span>
              )}
            </label>
            <button
              onClick={fetchServices}
              disabled={!selectedDevice || loadingServices}
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
            >
              <RefreshCw size={12} className={loadingServices ? 'animate-spin' : ''} />
              Load Services
            </button>
          </div>

          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter services..."
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          <div className="flex gap-2 text-xs">
            <button onClick={selectAll} className="text-blue-400 hover:text-blue-300">
              Select All
            </button>
            <span className="text-slate-600">|</span>
            <button onClick={selectNone} className="text-blue-400 hover:text-blue-300">
              Clear All
            </button>
          </div>

          <div className="h-[280px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/50">
            {loadingServices ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : filteredServices.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">
                {services.length === 0
                  ? 'Click "Load Services" to fetch available services.'
                  : 'No matching services.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {filteredServices.map((svc) => (
                  <label
                    key={svc}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-mono text-slate-300 hover:bg-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={selectedServices.has(svc)}
                      onChange={() => toggleService(svc)}
                      disabled={extracting}
                      className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
                    />
                    {svc}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
