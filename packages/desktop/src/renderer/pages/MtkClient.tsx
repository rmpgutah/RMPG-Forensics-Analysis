import React, { useState } from 'react';
import { MemoryStick, Play, ShieldAlert } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FolderPicker, ToolStatus } from '../components/common';
import { useProcess } from '../hooks';

/**
 * MediaTek BROM Exploit (mtkclient)
 *
 * Wraps the `mtk` CLI to talk to MediaTek devices in Preloader / BROM mode.
 * Vulnerable chipsets (most pre-2022 Helio + many Dimensity) allow bootrom-
 * level read of every partition without unlocking the bootloader.
 */
type Mode = 'printgpt' | 'r-userdata' | 'r-all' | 'rl' | 'da-seccfg';

const MODE_LABELS: Record<Mode, { label: string; description: string }> = {
  'printgpt': {
    label: 'Print Partition Table',
    description: 'Read-only: list every partition + offset. Sanity check that the device is in BROM/Preloader.',
  },
  'r-userdata': {
    label: 'Read userdata',
    description: 'Read-only: dump the userdata partition (analyst data).',
  },
  'r-all': {
    label: 'Read All Partitions',
    description: 'Read-only: dump every partition individually (named files in output folder).',
  },
  'rl': {
    label: 'Full Flash Dump (rl)',
    description: 'Read-only: dump the entire eMMC/UFS as a single image. Largest output.',
  },
  'da-seccfg': {
    label: 'Read seccfg (factory state)',
    description: 'Read-only: dump the seccfg partition — useful for FRP / bootloader-state forensics.',
  },
};

export const MtkClient: React.FC = () => {
  const [outputDir, setOutputDir] = useState('');
  const [mode, setMode] = useState<Mode>('printgpt');
  const proc = useProcess({
    channel: IPC_CHANNELS.MTK_DUMP,
    progressChannel: IPC_CHANNELS.MTK_DUMP_PROGRESS,
  });

  const start = async () => {
    if (!outputDir && mode !== 'printgpt') return;
    await proc.start({ mode, outputDir });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="MediaTek BROM Imager"
        description="Read raw partitions from MediaTek devices via the BROM/Preloader exploit"
        icon={<MemoryStick size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <ToolStatus toolName="mtk" />

          <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 p-3 text-xs text-amber-200/90 flex gap-2">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              Hold <strong>Volume Down</strong> while connecting USB to enter BROM. <code>mtk</code> handles the chipset detection and DA upload automatically. Read-only modes only.
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Operation</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              disabled={proc.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {Object.entries(MODE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500">{MODE_LABELS[mode].description}</p>
          </div>

          {mode !== 'printgpt' && (
            <FolderPicker
              role="output"
              label="Output Folder"
              value={outputDir}
              onChange={setOutputDir}
              disabled={proc.isRunning}
            />
          )}

          <button
            onClick={start}
            disabled={proc.isRunning || (mode !== 'printgpt' && !outputDir)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Play size={16} />
            {proc.isRunning ? 'Dumping…' : 'Start'}
          </button>
        </div>

        <div className="space-y-4">
          <LogConsole logs={proc.logs} title="mtk output" />
        </div>
      </div>
    </div>
  );
};
