import React, { useState } from 'react';
import {
  ShieldAlert,
  Play,
  Loader2,
  FileWarning,
  AlertTriangle,
  CheckCircle2,
  Info,
  Download,
  Filter,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FilePicker, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

type ScanTarget = 'android' | 'ios';
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface ScanResult {
  id: string;
  indicator: string;
  module: string;
  severity: Severity;
  description: string;
  matchedData: string;
  timestamp?: string;
}

const SEVERITY_CONFIG: Record<Severity, { color: string; badgeClass: string; label: string }> = {
  critical: { color: 'text-red-700', badgeClass: 'bg-red-100 text-red-700', label: 'Critical' },
  high: { color: 'text-red-600', badgeClass: 'bg-red-50 text-red-600', label: 'High' },
  medium: { color: 'text-yellow-600', badgeClass: 'bg-yellow-100 text-yellow-700', label: 'Medium' },
  low: { color: 'text-blue-600', badgeClass: 'bg-blue-100 text-blue-700', label: 'Low' },
  info: { color: 'text-[var(--text-secondary)]', badgeClass: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]', label: 'Info' },
};

export const MvtScanner: React.FC = () => {
  const ipc = useIpc();

  const [scanTarget, setScanTarget] = useState<ScanTarget>('android');
  const [backupPath, setBackupPath] = useState('');
  const [iocFile, setIocFile] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [scanComplete, setScanComplete] = useState(false);

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleScan = async () => {
    if (!backupPath) return;
    setScanning(true);
    setResults([]);
    setScanComplete(false);
    addLog(`Starting MVT scan (${scanTarget})...`);
    addLog(`Backup path: ${backupPath}`);
    if (iocFile) addLog(`IOC file: ${iocFile}`);

    try {
      const result = await ipc.invoke<{
        success: boolean;
        results?: ScanResult[];
        message?: string;
        summary?: { total: number; critical: number; high: number; medium: number; low: number };
      }>(IPC_CHANNELS.MVT_SCAN, {
        target: scanTarget,
        backupPath,
        iocFilePath: iocFile || undefined,
        outputPath: outputDir || undefined,
      });

      if (result?.success && result.results) {
        setResults(result.results);
        addLog(`Scan complete. Found ${result.results.length} indicators.`);
        if (result.summary) {
          addLog(
            `Summary: ${result.summary.critical} critical, ${result.summary.high} high, ${result.summary.medium} medium, ${result.summary.low} low`
          );
        }
      } else {
        addLog(`Scan failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanning(false);
      setScanComplete(true);
    }
  };

  const handleExport = async () => {
    if (results.length === 0) return;
    try {
      const savePath = await ipc.invoke<string>(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        defaultPath: `mvt_scan_results_${Date.now()}.csv`,
      });
      if (savePath) {
        const csv = [
          'Severity,Module,Indicator,Description,Matched Data,Timestamp',
          ...results.map(
            (r) =>
              `"${r.severity}","${r.module}","${r.indicator}","${r.description}","${r.matchedData}","${r.timestamp ?? ''}"`
          ),
        ].join('\n');
        await ipc.invoke('fs:write-file', savePath, csv);
        addLog(`Results exported to: ${savePath}`);
      }
    } catch (err) {
      addLog(`Export error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const filteredResults =
    severityFilter === 'all'
      ? results
      : results.filter((r) => r.severity === severityFilter);

  const severityCounts = results.reduce(
    (acc, r) => {
      acc[r.severity] = (acc[r.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="MVT Scanner"
        description="Mobile Verification Toolkit -- scan Android or iOS backups for indicators of compromise (spyware, stalkerware)"
        icon={<ShieldAlert size={24} />}
      />

      {/* Configuration */}
      <div className="card">
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            {/* Scan target toggle */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Scan Target</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setScanTarget('android')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                    scanTarget === 'android'
                      ? 'bg-[#6495ED] text-white'
                      : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                  disabled={scanning}
                >
                  Android Backup
                </button>
                <button
                  onClick={() => setScanTarget('ios')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                    scanTarget === 'ios'
                      ? 'bg-[#6495ED] text-white'
                      : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                  disabled={scanning}
                >
                  iOS Backup
                </button>
              </div>
            </div>

            <FolderPicker
              label={scanTarget === 'android' ? 'Android Backup Directory' : 'iOS Backup Directory'}
              value={backupPath}
              onChange={setBackupPath}
              disabled={scanning}
            />

            <FilePicker
              label="IOC File (Optional)"
              value={iocFile}
              onChange={setIocFile}
              placeholder="Select STIX2 IOC file..."
              filters={[
                { name: 'STIX IOC Files', extensions: ['stix2', 'json'] },
                { name: 'All Files', extensions: ['*'] },
              ]}
              disabled={scanning}
            />
          </div>

          <div className="space-y-4">
            <FolderPicker
              label="Output Directory (Optional)"
              value={outputDir}
              onChange={setOutputDir}
              disabled={scanning}
            />

            <div className="rounded-lg bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)] leading-relaxed">
              <p className="font-medium text-[var(--text-primary)] mb-1 flex items-center gap-1">
                <Info size={12} />
                About MVT
              </p>
              <p>
                The Mobile Verification Toolkit checks device backups against known indicators of
                compromise from spyware like Pegasus, Predator, and other surveillance tools.
                Provide a STIX2 IOC file for targeted detection, or run a general scan to identify
                suspicious artifacts.
              </p>
            </div>

            <button
              onClick={handleScan}
              disabled={scanning || !backupPath}
              className="btn-primary flex items-center justify-center gap-2 w-full"
            >
              {scanning ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              {scanning ? 'Scanning...' : 'Start MVT Scan'}
            </button>

            {scanning && (
              <div className="w-full h-2 bg-[var(--bg-hover)] rounded-full overflow-hidden">
                <div className="h-full bg-[#6495ED] rounded-full animate-pulse w-full" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {scanComplete && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-5 gap-3">
            {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map((sev) => (
              <div
                key={sev}
                className={`card p-4 text-center cursor-pointer transition-all ${
                  severityFilter === sev ? 'ring-2 ring-[#6495ED]' : ''
                }`}
                onClick={() => setSeverityFilter(severityFilter === sev ? 'all' : sev)}
              >
                <p className="text-2xl font-bold text-[var(--text-primary)]">{severityCounts[sev] || 0}</p>
                <span className={`badge ${SEVERITY_CONFIG[sev].badgeClass} text-[10px]`}>
                  {SEVERITY_CONFIG[sev].label}
                </span>
              </div>
            ))}
          </div>

          {/* Results table */}
          <div className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <FileWarning size={16} className="text-[#6495ED]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Scan Results ({filteredResults.length})
                </h3>
                {severityFilter !== 'all' && (
                  <button
                    onClick={() => setSeverityFilter('all')}
                    className="text-xs text-[#6495ED] hover:underline"
                  >
                    Clear filter
                  </button>
                )}
              </div>
              <button
                onClick={handleExport}
                disabled={results.length === 0}
                className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
              >
                <Download size={12} />
                Export CSV
              </button>
            </div>

            {filteredResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                <CheckCircle2 size={32} className="mb-2 text-green-500" />
                <p className="text-sm font-medium text-green-600">No indicators found</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {results.length === 0
                    ? 'The scan did not detect any known indicators of compromise.'
                    : 'No results match the current filter.'}
                </p>
              </div>
            ) : (
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-hover)] sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">
                        Severity
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">
                        Module
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">
                        Indicator
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">
                        Description
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">
                        Matched Data
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {filteredResults.map((result) => (
                      <tr key={result.id} className="hover:bg-[var(--bg-hover)]">
                        <td className="px-4 py-2.5">
                          <span className={`badge ${SEVERITY_CONFIG[result.severity].badgeClass} text-[10px]`}>
                            {SEVERITY_CONFIG[result.severity].label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs font-mono text-[var(--text-primary)]">
                          {result.module}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--text-primary)] font-medium max-w-[200px] truncate">
                          {result.indicator}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] max-w-[250px] truncate">
                          {result.description}
                        </td>
                        <td className="px-4 py-2.5 text-xs font-mono text-[var(--text-muted)] max-w-[200px] truncate">
                          {result.matchedData}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
