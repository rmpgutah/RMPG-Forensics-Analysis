import React, { useState } from 'react';
import {
  Code2,
  Play,
  Loader2,
  FileCode,
  FolderOpen,
  Settings2,
  Eye,
  Download,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FilePicker, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

interface DecompileOptions {
  showSource: boolean;
  deobfuscate: boolean;
  exportGradle: boolean;
  threadsCount: number;
  skipResources: boolean;
  showInconsistentCode: boolean;
}

export const JadxDecompiler: React.FC = () => {
  const ipc = useIpc();

  const [apkPath, setApkPath] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [decompiling, setDecompiling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [options, setOptions] = useState<DecompileOptions>({
    showSource: true,
    deobfuscate: false,
    exportGradle: false,
    threadsCount: 4,
    skipResources: false,
    showInconsistentCode: false,
  });
  const [resultPath, setResultPath] = useState('');

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const updateOption = <K extends keyof DecompileOptions>(key: K, value: DecompileOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const handleDecompile = async () => {
    if (!apkPath || !outputDir) return;
    setDecompiling(true);
    setProgress(0);
    setResultPath('');
    addLog(`Starting JADX decompilation...`);
    addLog(`APK: ${apkPath}`);
    addLog(`Output: ${outputDir}`);
    addLog(`Options: deobfuscate=${options.deobfuscate}, gradle=${options.exportGradle}`);

    try {
      const result = await ipc.invoke<{
        success: boolean;
        outputPath?: string;
        message?: string;
        classCount?: number;
      }>(IPC_CHANNELS.JADX_DECOMPILE, {
        apkPath,
        outputPath: outputDir,
        options: {
          showSource: options.showSource,
          deobfuscate: options.deobfuscate,
          exportAsGradleProject: options.exportGradle,
          threadsCount: options.threadsCount,
          skipResources: options.skipResources,
          showInconsistentCode: options.showInconsistentCode,
        },
      });

      if (result?.success) {
        setResultPath(result.outputPath ?? outputDir);
        addLog(`Decompilation completed successfully.`);
        if (result.classCount) {
          addLog(`Decompiled ${result.classCount} classes.`);
        }
        addLog(`Output saved to: ${result.outputPath ?? outputDir}`);
        setProgress(100);
      } else {
        addLog(`Decompilation failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDecompiling(false);
    }
  };

  const handleOpenOutput = async () => {
    if (resultPath) {
      await ipc.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, { action: 'open-path', path: resultPath });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="JADX Decompiler"
        description="Decompile Android APK files to readable Java source code using JADX"
        icon={<Code2 size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Left - File selection and actions */}
        <div className="space-y-4">
          <div className="card space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <FileCode size={16} className="text-[#6495ED]" />
              Input / Output
            </h3>

            <FilePicker
              label="APK File"
              value={apkPath}
              onChange={setApkPath}
              placeholder="Select an APK file to decompile..."
              filters={[
                { name: 'Android Package', extensions: ['apk'] },
                { name: 'DEX Files', extensions: ['dex'] },
                { name: 'AAR Files', extensions: ['aar'] },
              ]}
              disabled={decompiling}
            />

            <FolderPicker
              label="Output Directory"
              value={outputDir}
              onChange={setOutputDir}
              disabled={decompiling}
            />

            <button
              onClick={handleDecompile}
              disabled={decompiling || !apkPath || !outputDir}
              className="btn-primary flex items-center justify-center gap-2 w-full"
            >
              {decompiling ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              {decompiling ? 'Decompiling...' : 'Decompile APK'}
            </button>

            {/* Progress */}
            {decompiling && (
              <div className="w-full h-2 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#6495ED] rounded-full transition-all animate-pulse"
                  style={{ width: '100%' }}
                />
              </div>
            )}

            {resultPath && (
              <button
                onClick={handleOpenOutput}
                className="btn-secondary flex items-center gap-2 w-full justify-center"
              >
                <FolderOpen size={14} />
                Open Output Folder
              </button>
            )}
          </div>

          {/* Quick info */}
          {apkPath && (
            <div className="card">
              <h4 className="text-xs font-medium text-[var(--text-muted)] mb-2">Selected File</h4>
              <p className="text-sm text-[var(--text-primary)] font-mono break-all">{apkPath}</p>
            </div>
          )}
        </div>

        {/* Right - Options */}
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Settings2 size={16} className="text-[#6495ED]" />
            Decompilation Options
          </h3>

          <div className="space-y-3">
            <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[#2a2f3a] cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Show Source Code</p>
                <p className="text-xs text-[var(--text-muted)]">Decompile DEX to Java source</p>
              </div>
              <input
                type="checkbox"
                checked={options.showSource}
                onChange={(e) => updateOption('showSource', e.target.checked)}
                disabled={decompiling}
                className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[#2a2f3a] cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Deobfuscate</p>
                <p className="text-xs text-[var(--text-muted)]">Attempt to rename obfuscated classes and methods</p>
              </div>
              <input
                type="checkbox"
                checked={options.deobfuscate}
                onChange={(e) => updateOption('deobfuscate', e.target.checked)}
                disabled={decompiling}
                className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[#2a2f3a] cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Export as Gradle Project</p>
                <p className="text-xs text-[var(--text-muted)]">Create a buildable Android Studio project</p>
              </div>
              <input
                type="checkbox"
                checked={options.exportGradle}
                onChange={(e) => updateOption('exportGradle', e.target.checked)}
                disabled={decompiling}
                className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[#2a2f3a] cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Skip Resources</p>
                <p className="text-xs text-[var(--text-muted)]">Skip decoding resource files (faster)</p>
              </div>
              <input
                type="checkbox"
                checked={options.skipResources}
                onChange={(e) => updateOption('skipResources', e.target.checked)}
                disabled={decompiling}
                className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[#2a2f3a] cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Show Inconsistent Code</p>
                <p className="text-xs text-[var(--text-muted)]">Include code with inconsistencies as comments</p>
              </div>
              <input
                type="checkbox"
                checked={options.showInconsistentCode}
                onChange={(e) => updateOption('showInconsistentCode', e.target.checked)}
                disabled={decompiling}
                className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
              />
            </label>

            <div className="p-3 rounded-lg bg-[var(--bg-hover)]">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">Thread Count</p>
                <span className="text-sm font-mono text-[#6495ED]">{options.threadsCount}</span>
              </div>
              <input
                type="range"
                min={1}
                max={16}
                value={options.threadsCount}
                onChange={(e) => updateOption('threadsCount', Number(e.target.value))}
                disabled={decompiling}
                className="w-full accent-[#6495ED]"
              />
              <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                <span>1</span>
                <span>16</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
