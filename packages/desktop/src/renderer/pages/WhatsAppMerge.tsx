import React, { useState, useCallback } from 'react';
import {
  MessageSquare,
  Play,
  Loader2,
  Plus,
  X,
  FileDown,
  Database,
  ArrowDownUp,
  CheckCircle2,
  AlertTriangle,
  FolderOpen,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FilePicker, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

interface MergeOptions {
  deduplicateMessages: boolean;
  deduplicateMedia: boolean;
  preserveTimestamps: boolean;
  mergeContacts: boolean;
  resolveConflicts: 'newest' | 'oldest' | 'both';
}

interface MergeStats {
  totalMessages: number;
  uniqueMessages: number;
  duplicatesRemoved: number;
  contactsMerged: number;
  chatsFound: number;
}

export const WhatsAppMerge: React.FC = () => {
  const ipc = useIpc();

  const [dbFiles, setDbFiles] = useState<string[]>(['']);
  const [outputPath, setOutputPath] = useState('');
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [mergeComplete, setMergeComplete] = useState(false);
  const [resultPath, setResultPath] = useState('');
  const [stats, setStats] = useState<MergeStats | null>(null);
  const [options, setOptions] = useState<MergeOptions>({
    deduplicateMessages: true,
    deduplicateMedia: true,
    preserveTimestamps: true,
    mergeContacts: true,
    resolveConflicts: 'newest',
  });

  const addLog = useCallback(
    (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]),
    []
  );

  const addDbSlot = () => {
    if (dbFiles.length < 10) {
      setDbFiles((prev) => [...prev, '']);
    }
  };

  const removeDbSlot = (index: number) => {
    if (dbFiles.length > 1) {
      setDbFiles((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const updateDbFile = (index: number, value: string) => {
    setDbFiles((prev) => prev.map((f, i) => (i === index ? value : f)));
  };

  const validFiles = dbFiles.filter((f) => f.trim() !== '');

  const handleMerge = async () => {
    if (validFiles.length < 2 || !outputPath) return;
    setMerging(true);
    setProgress(0);
    setMergeComplete(false);
    setStats(null);
    setResultPath('');

    addLog(`Starting WhatsApp database merge...`);
    addLog(`Input files: ${validFiles.length}`);
    validFiles.forEach((f, i) => addLog(`  [${i + 1}] ${f}`));
    addLog(`Output: ${outputPath}`);
    addLog(`Deduplication: messages=${options.deduplicateMessages}, media=${options.deduplicateMedia}`);
    addLog(`Conflict resolution: ${options.resolveConflicts}`);

    try {
      const result = await ipc.invoke<{
        success: boolean;
        outputPath?: string;
        stats?: MergeStats;
        message?: string;
      }>(IPC_CHANNELS.WHATSAPP_MERGE, {
        dbPaths: validFiles,
        outputPath,
        options: {
          deduplicateMessages: options.deduplicateMessages,
          deduplicateMedia: options.deduplicateMedia,
          preserveTimestamps: options.preserveTimestamps,
          mergeContacts: options.mergeContacts,
          conflictResolution: options.resolveConflicts,
        },
      });

      if (result?.success) {
        setMergeComplete(true);
        setProgress(100);
        if (result.outputPath) setResultPath(result.outputPath);
        if (result.stats) setStats(result.stats);
        addLog('Merge completed successfully.');
        if (result.stats) {
          addLog(`Total messages: ${result.stats.totalMessages}`);
          addLog(`Unique messages: ${result.stats.uniqueMessages}`);
          addLog(`Duplicates removed: ${result.stats.duplicatesRemoved}`);
          addLog(`Contacts merged: ${result.stats.contactsMerged}`);
          addLog(`Chats found: ${result.stats.chatsFound}`);
        }
        addLog(`Output: ${result.outputPath ?? outputPath}`);
      } else {
        addLog(`Merge failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMerging(false);
    }
  };

  const handleOpenResult = async () => {
    if (resultPath) {
      await ipc.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, { action: 'open-path', path: resultPath });
    }
  };

  const updateOption = <K extends keyof MergeOptions>(key: K, value: MergeOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Database Merge"
        description="Merge multiple WhatsApp msgstore.db files into a unified database with deduplication"
        icon={<MessageSquare size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Left - File inputs */}
        <div className="space-y-4">
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Database size={16} className="text-[#6495ED]" />
                Input Database Files
              </h3>
              <button
                onClick={addDbSlot}
                disabled={dbFiles.length >= 10 || merging}
                className="btn-ghost flex items-center gap-1 text-xs py-1 px-2"
              >
                <Plus size={12} />
                Add File
              </button>
            </div>

            <div className="space-y-2">
              {dbFiles.map((file, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)] w-6 text-right shrink-0">
                    {index + 1}.
                  </span>
                  <div className="flex-1">
                    <FilePicker
                      label=""
                      value={file}
                      onChange={(val) => updateDbFile(index, val)}
                      placeholder="Select msgstore.db file..."
                      filters={[
                        { name: 'WhatsApp Database', extensions: ['db'] },
                        { name: 'All Files', extensions: ['*'] },
                      ]}
                      disabled={merging}
                    />
                  </div>
                  {dbFiles.length > 1 && (
                    <button
                      onClick={() => removeDbSlot(index)}
                      disabled={merging}
                      className="p-1.5 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-[var(--text-muted)]">
              {validFiles.length} of {dbFiles.length} file(s) selected.
              {validFiles.length < 2 && ' At least 2 files required to merge.'}
            </p>
          </div>

          <div className="card space-y-4">
            <FolderPicker
              label="Output Directory"
              value={outputPath}
              onChange={setOutputPath}
              disabled={merging}
            />

            <button
              onClick={handleMerge}
              disabled={merging || validFiles.length < 2 || !outputPath}
              className="btn-primary flex items-center justify-center gap-2 w-full"
            >
              {merging ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ArrowDownUp size={16} />
              )}
              {merging ? 'Merging...' : `Merge ${validFiles.length} Databases`}
            </button>

            {/* Progress */}
            {merging && (
              <div className="space-y-1">
                <div className="w-full h-2 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                  <div className="h-full bg-[#6495ED] rounded-full animate-pulse w-full" />
                </div>
                <p className="text-xs text-[var(--text-muted)] text-center">Processing databases...</p>
              </div>
            )}
          </div>
        </div>

        {/* Right - Options and results */}
        <div className="space-y-4">
          <div className="card space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ArrowDownUp size={16} className="text-[#6495ED]" />
              Merge Options
            </h3>

            <div className="space-y-3">
              <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[#2a2f3a] cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Deduplicate Messages</p>
                  <p className="text-xs text-[var(--text-muted)]">Remove duplicate messages based on content and timestamp</p>
                </div>
                <input
                  type="checkbox"
                  checked={options.deduplicateMessages}
                  onChange={(e) => updateOption('deduplicateMessages', e.target.checked)}
                  disabled={merging}
                  className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[#2a2f3a] cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Deduplicate Media</p>
                  <p className="text-xs text-[var(--text-muted)]">Remove duplicate media references by hash</p>
                </div>
                <input
                  type="checkbox"
                  checked={options.deduplicateMedia}
                  onChange={(e) => updateOption('deduplicateMedia', e.target.checked)}
                  disabled={merging}
                  className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[#2a2f3a] cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Preserve Timestamps</p>
                  <p className="text-xs text-[var(--text-muted)]">Keep original message timestamps from source databases</p>
                </div>
                <input
                  type="checkbox"
                  checked={options.preserveTimestamps}
                  onChange={(e) => updateOption('preserveTimestamps', e.target.checked)}
                  disabled={merging}
                  className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-hover)] hover:bg-[#2a2f3a] cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Merge Contacts</p>
                  <p className="text-xs text-[var(--text-muted)]">Combine contact information from all databases</p>
                </div>
                <input
                  type="checkbox"
                  checked={options.mergeContacts}
                  onChange={(e) => updateOption('mergeContacts', e.target.checked)}
                  disabled={merging}
                  className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
                />
              </label>

              <div className="p-3 rounded-lg bg-[var(--bg-hover)]">
                <p className="text-sm font-medium text-[var(--text-primary)] mb-2">Conflict Resolution</p>
                <div className="flex gap-2">
                  {(['newest', 'oldest', 'both'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => updateOption('resolveConflicts', mode)}
                      className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-colors ${
                        options.resolveConflicts === mode
                          ? 'bg-[#6495ED] text-white'
                          : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[#2a2f3a]'
                      }`}
                      disabled={merging}
                    >
                      {mode === 'newest' ? 'Keep Newest' : mode === 'oldest' ? 'Keep Oldest' : 'Keep Both'}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                  How to handle conflicting records with the same key but different content.
                </p>
              </div>
            </div>
          </div>

          {/* Merge results */}
          {mergeComplete && stats && (
            <div className="card space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-green-600" />
                <h3 className="text-sm font-semibold text-green-700">Merge Complete</h3>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[var(--bg-hover)] p-3 text-center">
                  <p className="text-xl font-bold text-[var(--text-primary)]">{stats.totalMessages.toLocaleString()}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">Total Messages</p>
                </div>
                <div className="rounded-lg bg-[var(--bg-hover)] p-3 text-center">
                  <p className="text-xl font-bold text-[var(--text-primary)]">{stats.uniqueMessages.toLocaleString()}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">Unique Messages</p>
                </div>
                <div className="rounded-lg bg-[var(--bg-hover)] p-3 text-center">
                  <p className="text-xl font-bold text-red-600">{stats.duplicatesRemoved.toLocaleString()}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">Duplicates Removed</p>
                </div>
                <div className="rounded-lg bg-[var(--bg-hover)] p-3 text-center">
                  <p className="text-xl font-bold text-[#6495ED]">{stats.chatsFound.toLocaleString()}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">Chats Found</p>
                </div>
              </div>

              {stats.contactsMerged > 0 && (
                <p className="text-xs text-[var(--text-secondary)]">
                  {stats.contactsMerged} contact(s) merged from multiple sources.
                </p>
              )}

              {resultPath && (
                <button
                  onClick={handleOpenResult}
                  className="btn-secondary flex items-center justify-center gap-2 w-full"
                >
                  <FolderOpen size={14} />
                  Open Output Folder
                </button>
              )}
            </div>
          )}

          {/* Warning about merge */}
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-xs text-yellow-700 leading-relaxed">
            <p className="font-medium flex items-center gap-1 mb-1">
              <AlertTriangle size={12} />
              Notice
            </p>
            <p>
              Merging WhatsApp databases is a complex operation. Always work on copies of the
              original database files. The merged database structure follows the standard msgstore.db
              schema. Verify the output before using it for analysis.
            </p>
          </div>
        </div>
      </div>

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
