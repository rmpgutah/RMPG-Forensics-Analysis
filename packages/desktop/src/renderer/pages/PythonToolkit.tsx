import React, { useState, useEffect } from 'react';
import { Terminal, Play, Download, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  ProgressIndicator,
} from '../components/common';
import { useProcess } from '../hooks';

// ---------------------------------------------------------------------------
// Tool Definitions (mirrors backend)
// ---------------------------------------------------------------------------

interface ToolDef {
  id: string;
  name: string;
  description: string;
  category: 'osint' | 'recon' | 'web' | 'crypto';
  targetLabel: string;
  targetPlaceholder: string;
}

const TOOLS: ToolDef[] = [
  // OSINT
  { id: 'sherlock', name: 'Sherlock', description: 'Hunt usernames across 400+ social networks', category: 'osint', targetLabel: 'Username', targetPlaceholder: 'john_doe' },
  { id: 'maigret', name: 'Maigret', description: 'Deep username search across 2500+ sites (advanced Sherlock)', category: 'osint', targetLabel: 'Username', targetPlaceholder: 'john_doe' },
  { id: 'holehe', name: 'Holehe', description: 'Check if email is registered on 120+ websites', category: 'osint', targetLabel: 'Email Address', targetPlaceholder: 'target@example.com' },
  { id: 'socialscan', name: 'Social Scan', description: 'Check email/username availability across platforms', category: 'osint', targetLabel: 'Email or Username', targetPlaceholder: 'target@example.com' },
  { id: 'dorks-eye', name: 'DorksEye', description: 'Generate Google dorks for deep OSINT on a target', category: 'osint', targetLabel: 'Person Name or Domain', targetPlaceholder: 'John Doe' },
  // Recon
  { id: 'theharvester', name: 'theHarvester', description: 'Gather emails, subdomains, hosts from public sources', category: 'recon', targetLabel: 'Domain', targetPlaceholder: 'example.com' },
  { id: 'sublist3r', name: 'Sublist3r', description: 'Enumerate subdomains using OSINT search engines', category: 'recon', targetLabel: 'Domain', targetPlaceholder: 'example.com' },
  { id: 'fierce', name: 'Fierce', description: 'DNS reconnaissance for locating non-contiguous IP space', category: 'recon', targetLabel: 'Domain', targetPlaceholder: 'example.com' },
  { id: 'photon', name: 'Photon', description: 'Fast web crawler: extract URLs, emails, secrets, files', category: 'recon', targetLabel: 'Target URL', targetPlaceholder: 'https://example.com' },
  { id: 'cloud-enum', name: 'Cloud Enum', description: 'Enumerate public cloud resources (AWS/Azure/GCP)', category: 'recon', targetLabel: 'Keyword', targetPlaceholder: 'companyname' },
  // Web Attack
  { id: 'dirsearch', name: 'Dirsearch', description: 'Brute-force web paths and directories recursively', category: 'web', targetLabel: 'Target URL', targetPlaceholder: 'https://example.com' },
  { id: 'wafw00f', name: 'WAFw00f', description: 'Identify and fingerprint Web Application Firewalls', category: 'web', targetLabel: 'Target URL', targetPlaceholder: 'https://example.com' },
  { id: 'xss-strike', name: 'XSStrike', description: 'Advanced XSS detection and exploitation suite', category: 'web', targetLabel: 'Target URL (with params)', targetPlaceholder: 'https://example.com/search?q=test' },
  // Crypto
  { id: 'hash-identifier', name: 'Hash Identifier', description: 'Identify unknown hash types (MD5, SHA, bcrypt, etc.)', category: 'crypto', targetLabel: 'Hash Value', targetPlaceholder: '5d41402abc4b2a76b9719d911017c592' },
];

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  osint: { label: 'OSINT / Investigation', color: 'text-blue-400' },
  recon: { label: 'Reconnaissance', color: 'text-green-400' },
  web: { label: 'Web Attack', color: 'text-red-400' },
  crypto: { label: 'Cryptanalysis', color: 'text-purple-400' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PythonToolkit: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.TOOLKIT_RUN,
    progressChannel: IPC_CHANNELS.TOOLKIT_PROGRESS,
  });

  const [selectedTool, setSelectedTool] = useState<string>('sherlock');
  const [target, setTarget] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [toolStatuses, setToolStatuses] = useState<Record<string, { installed: boolean; version?: string }>>({});
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const selectedToolDef = TOOLS.find((t) => t.id === selectedTool);
  const filteredTools = categoryFilter === 'all' ? TOOLS : TOOLS.filter((t) => t.category === categoryFilter);

  // Check tool installation status on mount
  useEffect(() => {
    checkStatuses();
  }, []);

  const checkStatuses = async () => {
    setLoadingStatus(true);
    try {
      const result = (await window.api.invoke(IPC_CHANNELS.TOOLKIT_STATUS)) as {
        success: boolean;
        tools: Record<string, { installed: boolean; version?: string }>;
      };
      if (result.success) {
        setToolStatuses(result.tools);
      }
    } catch { /* skip */ }
    setLoadingStatus(false);
  };

  const handleInstall = async (toolId: string) => {
    setInstalling(toolId);
    try {
      await window.api.invoke(IPC_CHANNELS.TOOLKIT_INSTALL, { toolId });
      await checkStatuses();
    } catch { /* skip */ }
    setInstalling(null);
  };

  const handleRun = async () => {
    if (!target || !outputFolder) return;
    await process.start({
      toolId: selectedTool,
      target,
      outputPath: outputFolder,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Python Security Toolkit"
        description="Open-source OSINT, recon, and attack tools powered by Python — install and run with one click"
        icon={<Terminal size={24} />}
      />

      {/* Category Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCategoryFilter('all')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${categoryFilter === 'all' ? 'bg-[#6495ED] text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
        >
          All Tools
        </button>
        {Object.entries(CATEGORY_LABELS).map(([key, { label }]) => (
          <button
            key={key}
            onClick={() => setCategoryFilter(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${categoryFilter === key ? 'bg-[#6495ED] text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
          >
            {label}
          </button>
        ))}
        <button onClick={checkStatuses} disabled={loadingStatus} className="ml-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:text-white">
          <RefreshCw size={12} className={loadingStatus ? 'animate-spin' : ''} />
          Refresh Status
        </button>
      </div>

      {/* Tool Grid */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {filteredTools.map((tool) => {
          const status = toolStatuses[tool.id];
          const isInstalled = status?.installed;
          const isSelected = selectedTool === tool.id;
          const hasToolStatuses = Object.keys(toolStatuses).length > 0;

          return (
            <button
              key={tool.id}
              onClick={() => setSelectedTool(tool.id)}
              className={`rounded-lg border p-3 text-left transition ${
                isSelected
                  ? 'border-[#6495ED] bg-[#6495ED]/10'
                  : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{tool.name}</span>
                    <span className={`text-[10px] font-bold uppercase ${CATEGORY_LABELS[tool.category].color}`}>
                      {tool.category}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{tool.description}</p>
                </div>
                <div className="ml-2 shrink-0">
                  {loadingStatus && !hasToolStatuses ? (
                    <RefreshCw size={14} className="animate-spin text-gray-500" />
                  ) : isInstalled ? (
                    <CheckCircle size={14} className="text-green-400" />
                  ) : (
                    <XCircle size={14} className="text-gray-500" />
                  )}
                </div>
              </div>
              {status?.version && (
                <p className="mt-1 text-[10px] text-gray-500">v{status.version}</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Tool Panel */}
      {selectedToolDef && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">{selectedToolDef.name}</h3>
              <p className="text-sm text-gray-400">{selectedToolDef.description}</p>
            </div>
            {!loadingStatus && !toolStatuses[selectedTool]?.installed && (
              <button
                onClick={() => handleInstall(selectedTool)}
                disabled={installing === selectedTool}
                className="btn-primary flex items-center gap-2"
              >
                <Download size={14} />
                {installing === selectedTool ? 'Installing...' : 'Install Tool'}
              </button>
            )}
          </div>

          {/* Target Input */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">{selectedToolDef.targetLabel}</label>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={selectedToolDef.targetPlaceholder}
              className="input w-full"
            />
          </div>

          {/* Output Folder */}
          <FolderPicker label="Output Folder" value={outputFolder} onChange={setOutputFolder} />

          {/* Run Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleRun}
              disabled={!target || !outputFolder || process.isRunning}
              className="btn-primary flex items-center gap-2"
            >
              <Play size={14} />
              {process.isRunning ? 'Running...' : `Run ${selectedToolDef.name}`}
            </button>
            {!loadingStatus && !toolStatuses[selectedTool]?.installed && (
              <span className="flex items-center gap-1 text-xs text-yellow-400">
                <AlertTriangle size={12} />
                Tool not installed — click Install first
              </span>
            )}
          </div>

          {/* Progress */}
          <ProgressIndicator percent={process.progress.percent} message={process.progress.message} isRunning={process.isRunning} />
        </div>
      )}

      {/* Log Console */}
      <LogConsole logs={process.logs} onClear={process.clearLogs} />

      {/* Legal Notice */}
      <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">Law Enforcement & Authorized Use Only</p>
            <p className="mt-1 text-xs text-yellow-400">
              These tools are provided for authorized forensic investigations, penetration testing with written consent,
              and lawful intelligence gathering. All tools are open-source and publicly available on GitHub/PyPI.
              Misuse may violate computer fraud and privacy laws.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
