import React, { useState, useCallback } from 'react';
import {
  Database,
  Play,
  Loader2,
  Table2,
  FileDown,
  FolderOpen,
  Trash2,
  Clock,
  ChevronRight,
  Search,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FilePicker, LogConsole } from '../components/common';
import { useIpc } from '../hooks';

interface TableInfo {
  name: string;
  rowCount: number;
  columns: string[];
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;
}

export const SqliteBrowser: React.FC = () => {
  const ipc = useIpc();

  const [dbPath, setDbPath] = useState('');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryRunning, setQueryRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [tableFilter, setTableFilter] = useState('');

  const addLog = useCallback(
    (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]),
    []
  );

  const handleOpenDb = async (path: string) => {
    setDbPath(path);
    if (!path) return;
    setLoading(true);
    setTables([]);
    setSelectedTable(null);
    setQueryResult(null);
    addLog(`Opening database: ${path}`);

    try {
      const result = await ipc.invoke<{
        success: boolean;
        tables?: TableInfo[];
        message?: string;
      }>(IPC_CHANNELS.SQLITE_OPEN, { dbPath: path });

      if (result?.success && result.tables) {
        setTables(result.tables);
        addLog(`Database opened. Found ${result.tables.length} table(s).`);
      } else {
        addLog(`Failed to open database: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTable = (tableName: string) => {
    setSelectedTable(tableName);
    const escapedName = tableName.replace(/"/g, '""');
    setQuery(`SELECT * FROM "${escapedName}" LIMIT 100;`);
  };

  const handleRunQuery = async () => {
    if (!query.trim() || !dbPath) return;
    setQueryRunning(true);
    setQueryResult(null);
    addLog(`Executing: ${query}`);

    // Add to history
    setQueryHistory((prev) => {
      const filtered = prev.filter((q) => q !== query);
      return [query, ...filtered].slice(0, 20);
    });

    try {
      const result = await ipc.invoke<{
        success: boolean;
        result?: QueryResult;
        message?: string;
      }>(IPC_CHANNELS.SQLITE_QUERY, { dbPath, query });

      if (result?.success && result.result) {
        setQueryResult(result.result);
        addLog(
          `Query returned ${result.result.rowCount} row(s) in ${result.result.executionTime}ms.`
        );
      } else {
        addLog(`Query failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setQueryRunning(false);
    }
  };

  const handleExportCsv = async () => {
    if (!queryResult || queryResult.rows.length === 0) return;
    try {
      const savePath = await ipc.invoke<string>(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        defaultPath: `query_results_${Date.now()}.csv`,
      });
      if (savePath) {
        const header = queryResult.columns.join(',');
        const rows = queryResult.rows.map((row) =>
          queryResult.columns
            .map((col) => {
              const val = row[col];
              return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : String(val ?? '');
            })
            .join(',')
        );
        const csv = [header, ...rows].join('\n');
        await ipc.invoke('fs:write-file', savePath, csv);
        addLog(`Exported ${queryResult.rows.length} rows to: ${savePath}`);
      }
    } catch (err) {
      addLog(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const filteredTables = tableFilter
    ? tables.filter((t) => t.name.toLowerCase().includes(tableFilter.toLowerCase()))
    : tables;

  const formatCellValue = (val: unknown): string => {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="SQLite Browser"
        description="Browse SQLite database files, explore tables, run queries, and export results"
        icon={<Database size={24} />}
      />

      {/* Database file selector */}
      <div className="card">
        <FilePicker
          label="Database File"
          value={dbPath}
          onChange={handleOpenDb}
          placeholder="Select a .db or .sqlite file..."
          filters={[
            { name: 'SQLite Databases', extensions: ['db', 'sqlite', 'sqlite3', 'sqlitedb'] },
            { name: 'All Files', extensions: ['*'] },
          ]}
          disabled={loading || queryRunning}
        />
      </div>

      {/* Main layout: sidebar + content */}
      <div className="flex gap-4" style={{ minHeight: '500px' }}>
        {/* Table list sidebar */}
        <div className="w-64 shrink-0 space-y-2">
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <Table2 size={14} className="text-[#6495ED]" />
                Tables ({tables.length})
              </h3>
            </div>

            {tables.length > 5 && (
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                  placeholder="Filter tables..."
                  className="input-field text-xs py-1.5 pl-7"
                />
              </div>
            )}

            <div className="max-h-[400px] overflow-y-auto space-y-0.5">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin text-[#6495ED]" />
                </div>
              ) : filteredTables.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-4 text-center">
                  {tables.length === 0 ? 'Open a database file' : 'No matching tables'}
                </p>
              ) : (
                filteredTables.map((table) => (
                  <button
                    key={table.name}
                    onClick={() => handleSelectTable(table.name)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                      selectedTable === table.name
                        ? 'bg-[#6495ED] text-white'
                        : 'text-[var(--text-primary)] hover:bg-[#2a2f3a]'
                    }`}
                  >
                    <span className="truncate font-medium">{table.name}</span>
                    <span
                      className={`text-[10px] shrink-0 ml-2 ${
                        selectedTable === table.name ? 'text-blue-100' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {table.rowCount} rows
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Query history */}
          {queryHistory.length > 0 && (
            <div className="card p-3 space-y-2">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] w-full"
              >
                <Clock size={14} className="text-[#6495ED]" />
                History ({queryHistory.length})
                <ChevronRight
                  size={12}
                  className={`ml-auto transition-transform ${showHistory ? 'rotate-90' : ''}`}
                />
              </button>
              {showHistory && (
                <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                  {queryHistory.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setQuery(q)}
                      className="w-full text-left px-2 py-1.5 rounded text-[11px] font-mono text-[var(--text-secondary)] hover:bg-[#2a2f3a] truncate"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Query editor + results */}
        <div className="flex-1 space-y-4">
          {/* Query editor */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">SQL Query</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setQuery('')}
                  className="btn-ghost text-xs py-1 px-2 flex items-center gap-1"
                >
                  <Trash2 size={12} />
                  Clear
                </button>
              </div>
            </div>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter SQL query... (e.g., SELECT * FROM messages LIMIT 100)"
              rows={4}
              className="input-field font-mono text-sm resize-y"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  handleRunQuery();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-[var(--text-muted)]">Press Cmd/Ctrl + Enter to execute</p>
              <div className="flex gap-2">
                {queryResult && queryResult.rows.length > 0 && (
                  <button
                    onClick={handleExportCsv}
                    className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
                  >
                    <FileDown size={12} />
                    Export CSV
                  </button>
                )}
                <button
                  onClick={handleRunQuery}
                  disabled={queryRunning || !query.trim() || !dbPath}
                  className="btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3"
                >
                  {queryRunning ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Play size={12} />
                  )}
                  {queryRunning ? 'Running...' : 'Execute'}
                </button>
              </div>
            </div>
          </div>

          {/* Results table */}
          {queryResult && (
            <div className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-hover)]">
                <span className="text-xs text-[var(--text-secondary)]">
                  {queryResult.rowCount} row{queryResult.rowCount !== 1 ? 's' : ''} returned
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {queryResult.executionTime}ms
                </span>
              </div>
              <div className="max-h-[350px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--bg-hover)] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-muted)] w-10">#</th>
                      {queryResult.columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left font-medium text-[var(--text-muted)] whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {queryResult.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-[var(--bg-hover)]">
                        <td className="px-3 py-1.5 text-[var(--text-muted)] font-mono">{idx + 1}</td>
                        {queryResult.columns.map((col) => (
                          <td
                            key={col}
                            className="px-3 py-1.5 text-[var(--text-primary)] font-mono max-w-[300px] truncate"
                            title={formatCellValue(row[col])}
                          >
                            {row[col] === null ? (
                              <span className="text-[var(--text-muted)] italic">NULL</span>
                            ) : (
                              formatCellValue(row[col])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!queryResult && !queryRunning && dbPath && (
            <div className="card flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
              <Database size={32} className="mb-3" />
              <p className="text-sm font-medium">Select a table or write a query</p>
              <p className="text-xs mt-1">Click a table on the left to preview its contents</p>
            </div>
          )}
        </div>
      </div>

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
