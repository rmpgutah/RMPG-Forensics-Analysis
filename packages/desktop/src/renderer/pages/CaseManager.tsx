import React, { useState, useEffect, useCallback } from 'react';
import { FolderKanban, Plus, FolderOpen, Trash2, Download, Upload, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FolderPicker, ConfirmDialog } from '../components/common';
import { useIpc } from '../hooks';

interface CaseEntry {
  name: string;
  number: string;
  createdAt: string;
  path: string;
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
    await ipc.invoke(IPC_CHANNELS.CASE_CREATE, {
      name: newCaseName,
      number: newCaseNumber,
      path: newCaseFolder,
    });
    setShowCreate(false);
    setNewCaseName('');
    setNewCaseNumber('');
    setNewCaseFolder('');
    await refreshCases();
  };

  const handleOpen = async (entry: CaseEntry) => {
    await ipc.invoke(IPC_CHANNELS.CASE_OPEN, { path: entry.path });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await ipc.invoke(IPC_CHANNELS.CASE_DELETE, { path: deleteTarget.path });
    setDeleteTarget(null);
    await refreshCases();
  };

  const handleImport = async () => {
    await ipc.invoke(IPC_CHANNELS.CASE_IMPORT);
    await refreshCases();
  };

  const handleExport = async (entry: CaseEntry) => {
    await ipc.invoke(IPC_CHANNELS.CASE_EXPORT, { path: entry.path });
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
          className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-750 disabled:opacity-50"
        >
          <Download size={16} />
          Import Case
        </button>
      </div>

      {/* Create case form */}
      {showCreate && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-4">
          <h3 className="text-sm font-medium text-white">Create New Case</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Case Name</label>
              <input
                type="text"
                value={newCaseName}
                onChange={(e) => setNewCaseName(e.target.value)}
                placeholder="e.g. Smith Investigation"
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Case Number</label>
              <input
                type="text"
                value={newCaseNumber}
                onChange={(e) => setNewCaseNumber(e.target.value)}
                placeholder="e.g. 2024-001"
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-300"
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
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                Path
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  <Loader2 size={20} className="mx-auto animate-spin" />
                </td>
              </tr>
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No cases found. Create a new case to get started.
                </td>
              </tr>
            ) : (
              cases.map((entry) => (
                <tr key={entry.path} className="hover:bg-slate-800/80">
                  <td className="px-4 py-3 text-white font-medium">{entry.name}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.number}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs truncate max-w-[200px]">
                    {entry.path}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpen(entry)}
                        title="Open Case"
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                      >
                        <FolderOpen size={16} />
                      </button>
                      <button
                        onClick={() => handleExport(entry)}
                        title="Export Case"
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                      >
                        <Upload size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(entry)}
                        title="Delete Case"
                        className="rounded p-1.5 text-slate-400 hover:bg-red-900/50 hover:text-red-400"
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Case?"
        message={`Are you sure you want to delete case "${deleteTarget?.name}" (${deleteTarget?.number})? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="warning"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
