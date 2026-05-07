import React, { useState } from 'react';
import { Cpu, Play, AlertTriangle } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  ProgressIndicator,
  ToolStatus,
} from '../components/common';
import { useProcess } from '../hooks';

const EDL_OPERATIONS = [
  { value: 'read-gpt', label: 'Print Partition Table', description: 'Read-only: list every partition + offset. Sanity check that the device is in EDL mode.' },
  { value: 'read-full', label: 'Full Disk Image (rawprogram0)', description: 'Reads the entire UFS/eMMC into a single .bin image.' },
  { value: 'read-partition', label: 'Read Specific Partition', description: 'Read a single named partition (e.g., userdata, system).' },
] as const;

export const EdlImager: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.EDL_READ,
    progressChannel: IPC_CHANNELS.EDL_READ_PROGRESS,
  });

  const [outputFolder, setOutputFolder] = useState('');
  const [operation, setOperation] = useState<string>('read-gpt');
  const [partitionName, setPartitionName] = useState('');

  const handleStart = async () => {
    if (!outputFolder) return;
    if (operation === 'read-partition' && !partitionName) return;
    await process.start({
      operation,
      outputPath: outputFolder,
      partitionName: operation === 'read-partition' ? partitionName : undefined,
    });
  };

  const selectedOp = EDL_OPERATIONS.find((op) => op.value === operation);

  return (
    <div className="space-y-6">
      <PageHeader
        title="EDL Imager (Qualcomm)"
        description="Read raw partitions from Qualcomm devices via Emergency Download (EDL) mode"
        icon={<Cpu size={24} />}
      />

      <ToolStatus toolName="edl" label="edl" />

        <div className="rounded-lg border border-blue-700/50 bg-blue-900/20 p-3 text-sm text-blue-300">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Put the device in <strong>EDL mode</strong> (9008) before connecting USB.
              Qualcomm devices enter EDL via test points or specific button combinations.
              Read-only modes only.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Operation</label>
              <select
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
                disabled={process.isRunning}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              >
                {EDL_OPERATIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              {selectedOp && (
                <p className="text-xs text-slate-500">{selectedOp.description}</p>
              )}
            </div>

            {operation === 'read-partition' && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">
                  Partition Name
                </label>
                <input
                  type="text"
                  value={partitionName}
                  onChange={(e) => setPartitionName(e.target.value)}
                  placeholder="e.g., userdata, system, boot"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
            )}

            <FolderPicker
              label="Output Folder"
              value={outputFolder}
              onChange={setOutputFolder}
              placeholder="Select folder to save partition images..."
              disabled={process.isRunning}
            />

            <button
              onClick={handleStart}
              disabled={
                process.isRunning ||
                !outputFolder ||
                (operation === 'read-partition' && !partitionName)
              }
              className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              {process.isRunning ? 'Reading...' : 'Start'}
            </button>
          </div>

          <div className="space-y-4">
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
