import React, { useState, useCallback, useEffect } from 'react';
import {
  Smartphone,
  Play,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Circle,
  Users,
  Download,
  FolderOpen,
  Contact,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

type OperationType = 'backup' | 'file_extract' | 'contacts';
type DeviceJobStatus = 'pending' | 'running' | 'completed' | 'failed';

interface DeviceInfo {
  serial: string;
  model: string;
  manufacturer: string;
  androidVersion: string;
  status: string;
}

interface DeviceJob {
  serial: string;
  status: DeviceJobStatus;
  progress: number;
  message: string;
}

const OPERATIONS: { key: OperationType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    key: 'backup',
    label: 'ADB Backup',
    description: 'Full device backup via ADB',
    icon: <Download size={16} />,
  },
  {
    key: 'file_extract',
    label: 'File Extraction',
    description: 'Extract file system contents',
    icon: <FolderOpen size={16} />,
  },
  {
    key: 'contacts',
    label: 'Contacts',
    description: 'Extract contacts database',
    icon: <Contact size={16} />,
  },
];

export const MultiDevice: React.FC = () => {
  const ipc = useIpc();

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [operation, setOperation] = useState<OperationType>('backup');
  const [outputDir, setOutputDir] = useState('');
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [jobs, setJobs] = useState<Map<string, DeviceJob>>(new Map());
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback(
    (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]),
    []
  );

  const refreshDevices = useCallback(async () => {
    setLoadingDevices(true);
    addLog('Scanning for connected devices...');
    try {
      const result = await ipc.invoke<{ devices: DeviceInfo[] }>(
        IPC_CHANNELS.MULTI_DEVICE_LIST
      );
      if (result?.devices) {
        setDevices(result.devices);
        addLog(`Found ${result.devices.length} device(s).`);
      } else {
        setDevices([]);
        addLog('No devices found.');
      }
    } catch (err) {
      addLog(`Error scanning devices: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingDevices(false);
    }
  }, [ipc, addLog]);

  useEffect(() => {
    refreshDevices();
  }, []);

  const toggleDevice = (serial: string) => {
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(serial)) next.delete(serial);
      else next.add(serial);
      return next;
    });
  };

  const selectAllDevices = () => setSelectedDevices(new Set(devices.map((d) => d.serial)));
  const clearSelection = () => setSelectedDevices(new Set());

  const handleExecute = async () => {
    if (selectedDevices.size === 0 || !outputDir) return;
    setExecuting(true);

    const initialJobs = new Map<string, DeviceJob>();
    selectedDevices.forEach((serial) => {
      initialJobs.set(serial, { serial, status: 'pending', progress: 0, message: 'Waiting...' });
    });
    setJobs(initialJobs);

    addLog(`Starting ${operation} on ${selectedDevices.size} device(s)...`);

    try {
      const result = await ipc.invoke<{
        success: boolean;
        results?: Array<{ serial: string; success: boolean; message?: string }>;
        message?: string;
      }>(IPC_CHANNELS.MULTI_DEVICE_EXECUTE, {
        serials: Array.from(selectedDevices),
        operation,
        outputPath: outputDir,
      });

      if (result?.results) {
        const updatedJobs = new Map<string, DeviceJob>();
        result.results.forEach((r) => {
          updatedJobs.set(r.serial, {
            serial: r.serial,
            status: r.success ? 'completed' : 'failed',
            progress: r.success ? 100 : 0,
            message: r.message ?? (r.success ? 'Completed' : 'Failed'),
          });
          addLog(`${r.serial}: ${r.success ? 'Completed' : 'Failed'} - ${r.message ?? ''}`);
        });
        setJobs(updatedJobs);
      } else {
        addLog(`Execution failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExecuting(false);
    }
  };

  const getJobStatusIcon = (status: DeviceJobStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 size={16} className="text-green-600" />;
      case 'failed':
        return <XCircle size={16} className="text-red-600" />;
      case 'running':
        return <Loader2 size={16} className="animate-spin text-[#6495ED]" />;
      default:
        return <Circle size={16} className="text-[var(--text-muted)]" />;
    }
  };

  const completedCount = Array.from(jobs.values()).filter((j) => j.status === 'completed').length;
  const failedCount = Array.from(jobs.values()).filter((j) => j.status === 'failed').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Multi-Device Acquisition"
        description="Perform simultaneous forensic acquisition across multiple connected Android devices"
        icon={<Users size={24} />}
      />

      {/* Operation selection and output */}
      <div className="card">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Operation</label>
            <div className="space-y-2">
              {OPERATIONS.map((op) => (
                <label
                  key={op.key}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    operation === op.key
                      ? 'border-[#6495ED] bg-blue-50'
                      : 'border-[var(--border-color)] bg-[var(--bg-hover)] hover:bg-[#2a2f3a]'
                  }`}
                >
                  <input
                    type="radio"
                    name="operation"
                    value={op.key}
                    checked={operation === op.key}
                    onChange={() => setOperation(op.key)}
                    disabled={executing}
                    className="text-[#6495ED] focus:ring-[#6495ED]"
                  />
                  <div className="flex items-center gap-2">
                    <span className={operation === op.key ? 'text-[#6495ED]' : 'text-[var(--text-muted)]'}>
                      {op.icon}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{op.label}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{op.description}</p>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="col-span-2 space-y-4">
            <FolderPicker
              label="Output Directory"
              value={outputDir}
              onChange={setOutputDir}
              disabled={executing}
            />

            <div className="flex gap-2">
              <button
                onClick={handleExecute}
                disabled={executing || selectedDevices.size === 0 || !outputDir}
                className="btn-primary flex items-center gap-2 flex-1"
              >
                {executing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}
                {executing
                  ? 'Executing...'
                  : `Run on ${selectedDevices.size} Device${selectedDevices.size !== 1 ? 's' : ''}`}
              </button>
              <button
                onClick={refreshDevices}
                disabled={loadingDevices || executing}
                className="btn-secondary flex items-center gap-2"
              >
                <RefreshCw size={14} className={loadingDevices ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            {/* Summary bar */}
            {jobs.size > 0 && (
              <div className="flex gap-3 text-sm">
                <span className="text-[var(--text-muted)]">Total: {jobs.size}</span>
                {completedCount > 0 && (
                  <span className="text-green-600 font-medium">{completedCount} completed</span>
                )}
                {failedCount > 0 && (
                  <span className="text-red-600 font-medium">{failedCount} failed</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Device selection & controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Smartphone size={16} className="text-[#6495ED]" />
          Connected Devices ({devices.length})
        </h3>
        <div className="flex gap-2 text-xs">
          <button onClick={selectAllDevices} className="text-[#6495ED] hover:underline">
            Select All
          </button>
          <span className="text-[var(--text-muted)]">|</span>
          <button onClick={clearSelection} className="text-[#6495ED] hover:underline">
            Clear
          </button>
        </div>
      </div>

      {/* Device grid */}
      {loadingDevices ? (
        <div className="card flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-[#6495ED]" />
        </div>
      ) : devices.length === 0 ? (
        <div className="card text-center py-12">
          <Smartphone size={32} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">No devices connected</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Connect Android devices via USB and click Refresh</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {devices.map((device) => {
            const isSelected = selectedDevices.has(device.serial);
            const job = jobs.get(device.serial);

            return (
              <div
                key={device.serial}
                onClick={() => !executing && toggleDevice(device.serial)}
                className={`card cursor-pointer transition-all ${
                  isSelected ? 'ring-2 ring-[#6495ED] border-[#6495ED]' : ''
                } ${executing ? 'cursor-not-allowed' : ''}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Smartphone size={20} className={isSelected ? 'text-[#6495ED]' : 'text-[var(--text-muted)]'} />
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        {device.manufacturer} {device.model}
                      </p>
                      <p className="text-[11px] font-mono text-[var(--text-muted)]">{device.serial}</p>
                    </div>
                  </div>
                  <span
                    className={`badge text-[10px] ${
                      device.status === 'device' ? 'badge-success' : 'badge-warning'
                    }`}
                  >
                    {device.status}
                  </span>
                </div>

                <div className="text-xs text-[var(--text-muted)]">
                  Android {device.androidVersion}
                </div>

                {/* Job progress */}
                {job && (
                  <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
                    <div className="flex items-center gap-2 mb-1">
                      {getJobStatusIcon(job.status)}
                      <span className="text-xs text-[var(--text-primary)] font-medium">{job.message}</span>
                    </div>
                    {(job.status === 'running' || job.status === 'completed') && (
                      <div className="w-full h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            job.status === 'completed' ? 'bg-green-500' : 'bg-[#6495ED]'
                          }`}
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
