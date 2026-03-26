import React, { useState, useCallback } from 'react';
import { Package, Play, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FilePicker, DeviceSelector, ConfirmDialog } from '../components/common';
import { useDeviceStatus, useIpc } from '../hooks';

export const ApkManager: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const ipc = useIpc();

  const [apkPath, setApkPath] = useState('');
  const [packages, setPackages] = useState<string[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [uninstallTarget, setUninstallTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const fetchPackages = useCallback(async () => {
    if (!selectedDevice) return;
    setLoadingPackages(true);
    addLog('Fetching installed packages...');
    const result = await ipc.invoke<string[]>(IPC_CHANNELS.APK_LIST, {
      serial: selectedDevice.serial,
    });
    if (result) {
      setPackages(result);
      addLog(`Found ${result.length} installed packages.`);
    } else {
      addLog('Failed to fetch packages.');
    }
    setLoadingPackages(false);
  }, [selectedDevice, ipc]);

  const handleInstall = async () => {
    if (!selectedDevice || !apkPath) return;
    setInstalling(true);
    addLog(`Installing APK: ${apkPath}`);
    const result = await ipc.invoke<{ success: boolean; message?: string }>(
      IPC_CHANNELS.APK_INSTALL,
      { serial: selectedDevice.serial, apkPath }
    );
    if (result?.success) {
      addLog('APK installed successfully.');
      await fetchPackages();
    } else {
      addLog(`Installation failed: ${result?.message ?? ipc.error ?? 'Unknown error'}`);
    }
    setInstalling(false);
  };

  const handleUninstall = async () => {
    if (!selectedDevice || !uninstallTarget) return;
    addLog(`Uninstalling package: ${uninstallTarget}`);
    const result = await ipc.invoke<{ success: boolean; message?: string }>(
      IPC_CHANNELS.APK_UNINSTALL,
      { serial: selectedDevice.serial, packageName: uninstallTarget }
    );
    if (result?.success) {
      addLog(`Package ${uninstallTarget} uninstalled successfully.`);
      setSelectedPackage(null);
      await fetchPackages();
    } else {
      addLog(`Uninstall failed: ${result?.message ?? ipc.error ?? 'Unknown error'}`);
    }
    setUninstallTarget(null);
  };

  const filteredPackages = filter
    ? packages.filter((p) => p.toLowerCase().includes(filter.toLowerCase()))
    : packages;

  return (
    <div className="space-y-6">
      <PageHeader
        title="APK Manager"
        description="Install and uninstall APK packages on Android devices"
        icon={<Package size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Left column - controls */}
        <div className="space-y-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            filter="android"
            disabled={installing}
          />

          <FilePicker
            label="APK File"
            value={apkPath}
            onChange={setApkPath}
            placeholder="Select an APK file..."
            filters={[{ name: 'APK Files', extensions: ['apk'] }]}
            disabled={installing}
          />

          <button
            onClick={handleInstall}
            disabled={installing || !selectedDevice || !apkPath}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {installing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {installing ? 'Installing...' : 'Install APK'}
          </button>

          {ipc.error && (
            <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
              {ipc.error}
            </div>
          )}
        </div>

        {/* Right column - package list */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-300">Installed Packages</label>
            <button
              onClick={fetchPackages}
              disabled={!selectedDevice || loadingPackages}
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
            >
              <RefreshCw size={12} className={loadingPackages ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter packages..."
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          <div className="h-[320px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/50">
            {loadingPackages ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : filteredPackages.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">
                {packages.length === 0
                  ? 'Click Refresh to load packages.'
                  : 'No matching packages.'}
              </div>
            ) : (
              <ul className="divide-y divide-slate-700">
                {filteredPackages.map((pkg) => (
                  <li
                    key={pkg}
                    onClick={() => setSelectedPackage(pkg === selectedPackage ? null : pkg)}
                    className={`flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-mono hover:bg-slate-800 ${
                      pkg === selectedPackage
                        ? 'bg-blue-900/30 text-blue-300'
                        : 'text-slate-300'
                    }`}
                  >
                    <span className="truncate">{pkg}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            onClick={() => selectedPackage && setUninstallTarget(selectedPackage)}
            disabled={!selectedPackage || installing}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-red-700/50 bg-red-900/20 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={16} />
            Uninstall Selected
          </button>
        </div>
      </div>

      <LogConsole logs={logs} onClear={() => setLogs([])} />

      <ConfirmDialog
        open={!!uninstallTarget}
        title="Uninstall Package?"
        message={`Are you sure you want to uninstall "${uninstallTarget}"? This action cannot be undone.`}
        confirmLabel="Uninstall"
        variant="warning"
        onConfirm={handleUninstall}
        onCancel={() => setUninstallTarget(null)}
      />
    </div>
  );
};
