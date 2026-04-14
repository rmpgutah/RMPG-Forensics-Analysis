import React, { useState, useEffect, useCallback } from 'react';
import { FolderKanban, Plus, FolderOpen, Trash2, Download, Upload, Loader2, FileText, Save } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FolderPicker, ConfirmDialog } from '../components/common';
import { useIpc } from '../hooks';

interface CaseEntry {
  name: string;
  caseNumber: string;
  number?: string; // legacy alias
  createdAt: string;
  localPath: string;
  path?: string; // legacy alias
  notes?: string;
}

export const CaseManager: React.FC = () => {
  const ipc = useIpc();

  const [cases, setCases] = useState<CaseEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Create case form
  const [showCreate, setShowCreate] = useState(false);
  const [newCaseName, setNewCaseName] = useState('');
  const [newCaseNumber, setNewCaseNumber] = useState('');
  const [newCaseFolder, setNewCaseFolder] = useState('');

  const [opError, setOpError] = useState<string | null>(null);

  // Notes editing
  const [selectedCase, setSelectedCase] = useState<CaseEntry | null>(null);
  const [notesText, setNotesText] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<CaseEntry | null>(null);

  const refreshCases = useCallback(async () => {
    setLoading(true);
    const result = await ipc.invoke<CaseEntry[]>(IPC_CHANNELS.CASE_LIST);
    if (result) setCases(result);
    setLoading(false);
  }, [ipc]);

  useEffect(() => {
    refreshCases();
  }, []);

  const handleCreate = async () => {
    if (!newCaseName || !newCaseNumber || !newCaseFolder) return;
    setOpError(null);
    try {
      await ipc.invoke(IPC_CHANNELS.CASE_CREATE, {
        examinerName: newCaseName,
        caseNumber: newCaseNumber,
        description: '',
        outputDir: newCaseFolder,
      });
      setShowCreate(false);
      setNewCaseName('');
      setNewCaseNumber('');
      setNewCaseFolder('');
      await refreshCases();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpen = async (entry: CaseEntry) => {
    await ipc.invoke(IPC_CHANNELS.CASE_OPEN, entry.localPath ?? entry.path);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setOpError(null);
    try {
      await ipc.invoke(IPC_CHANNELS.CASE_DELETE, deleteTarget.localPath ?? deleteTarget.path);
      setDeleteTarget(null);
      await refreshCases();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
      setDeleteTarget(null);
    }
  };

  const handleImport = async () => {
    setOpError(null);
    try {
      await ipc.invoke(IPC_CHANNELS.CASE_IMPORT);
      await refreshCases();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExport = async (entry: CaseEntry) => {
    await ipc.invoke(IPC_CHANNELS.CASE_EXPORT, entry.localPath ?? entry.path);
  };

  const handleSelectCase = (entry: CaseEntry) => {
    if (selectedCase?.localPath === entry.localPath) {
      setSelectedCase(null);
    } else {
      setSelectedCase(entry);
      setNotesText(entry.notes ?? '');
      setNotesSaved(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedCase) return;
    setNotesSaving(true);
    try {
      await ipc.invoke(IPC_CHANNELS.CASE_SAVE_NOTES, selectedCase.localPath ?? selectedCase.path, notesText);
      setNotesSaved(true);
      // Update local state so notes persist in the panel
      setCases((prev) => prev.map((c) =>
        (c.localPath ?? c.path) === (selectedCase.localPath ?? selectedCase.path)
          ? { ...c, notes: notesText }
          : c
      ));
      setSelectedCase((prev) => prev ? { ...prev, notes: notesText } : prev);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
    setNotesSaving(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Case Manager"
        description="Create, open, and manage forensic cases"
        icon={<FolderKanban size={24} />}
      />

      {/* Actions bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={16} />
          New Case
        </button>
        <button
          onClick={handleImport}
          disabled={ipc.loading}
          className="btn-secondary flex items-center gap-2"
        >
          <Download size={16} />
          Import Case
        </button>
      </div>

      {/* Create case form */}
      {showCreate && (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 space-y-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Create New Case</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-primary)]">Case Name</label>
              <input
                type="text"
                value={newCaseName}
                onChange={(e) => setNewCaseName(e.target.value)}
                placeholder="e.g. Smith Investigation"
                className="input-field w-full"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-[var(--text-primary)]">Case Number</label>
              <input
                type="text"
                value={newCaseNumber}
                onChange={(e) => setNewCaseNumber(e.target.value)}
                placeholder="e.g. 2024-001"
                className="input-field w-full"
              />
            </div>
          </div>
          <FolderPicker
            label="Case Folder"
            value={newCaseFolder}
            onChange={setNewCaseFolder}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={!newCaseName || !newCaseNumber || !newCaseFolder || ipc.loading}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} />
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-md border border-[var(--border-color)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error display */}
      {ipc.error && (
        <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
          {ipc.error}
        </div>
      )}

      {/* Case list table */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Path
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)]">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  <Loader2 size={20} className="mx-auto animate-spin" />
                </td>
              </tr>
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  No cases found. Create a new case to get started.
                </td>
              </tr>
            ) : (
              cases.map((entry) => (
                <tr
                  key={entry.path}
                  className="cursor-pointer hover:bg-[var(--bg-hover)]"
                  style={selectedCase?.localPath === entry.localPath ? { background: 'var(--bg-hover)' } : {}}
                  onClick={() => handleSelectCase(entry)}
                >
                  <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{entry.name}</td>
                  <td className="px-4 py-3 text-[var(--text-primary)]">{entry.caseNumber ?? entry.number}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs truncate max-w-[200px]">
                    {entry.localPath ?? entry.path}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpen(entry)}
                        title="Open Case"
                        className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      >
                        <FolderOpen size={16} />
                      </button>
                      <button
                        onClick={() => handleExport(entry)}
                        title="Export Case"
                        className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Upload size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(entry)}
                        title="Delete Case"
                        className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-red-900/50 hover:text-red-400"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Case Notes Panel */}
      {selectedCase && (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              <FileText size={14} className="text-[#6495ED]" />
              Case Notes — {selectedCase.name}
            </h3>
            <button
              onClick={() => setSelectedCase(null)}
              className="text-xs opacity-50 hover:opacity-100"
              style={{ color: 'var(--text-muted)' }}
            >✕</button>
          </div>
          <textarea
            value={notesText}
            onChange={(e) => { setNotesText(e.target.value); setNotesSaved(false); }}
            placeholder="Add case notes, observations, or investigator remarks…"
            rows={5}
            className="input-field w-full resize-y font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveNotes}
              disabled={notesSaving}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {notesSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {notesSaving ? 'Saving…' : 'Save Notes'}
            </button>
            {notesSaved && (
              <span className="text-xs text-green-400">Saved successfully</span>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Case?"
        message={`Are you sure you want to delete case "${deleteTarget?.name}" (${deleteTarget?.caseNumber ?? deleteTarget?.number})? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="warning"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
