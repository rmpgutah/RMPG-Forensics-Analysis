import React, { useState } from 'react';
import { UserSearch, Play, AlertTriangle, Search, Download } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  ProgressIndicator,
  ConfirmDialog,
} from '../components/common';
import { useProcess } from '../hooks';

const PII_SOURCES = [
  { value: 'device-full', label: 'Connected Device (Full Scan)', description: 'Extract all PII from connected mobile device — contacts, accounts, messages, etc.' },
  { value: 'device-targeted', label: 'Connected Device (Targeted)', description: 'Search device for specific PII patterns (SSN, credit cards, emails, phones).' },
  { value: 'web-osint', label: 'Web OSINT Lookup', description: 'Search public sources, social media, and data breach databases — no credentials required.' },
  { value: 'email-enum', label: 'Email Enumeration', description: 'Discover email addresses via DNS MX records and common patterns — no credentials required.' },
  { value: 'social-profile', label: 'Social Media Profiling', description: 'Aggregate public social profiles from GitHub, Reddit, and more — no credentials required.' },
  { value: 'breach-check', label: 'Breach Database Search', description: 'Check if target emails/accounts appear in known data breaches.' },
  { value: 'phone-lookup', label: 'Phone Number Intelligence', description: 'Parse and validate phone numbers with carrier and region info — no credentials required.' },
  { value: 'domain-whois', label: 'Domain/IP Intelligence', description: 'DNS records, MX, NS, IP resolution, and hosting info — no credentials required.' },
  { value: 'document-scan', label: 'Document PII Scan', description: 'Scan extracted documents/images for PII (OCR + pattern matching).' },
] as const;

const PII_PATTERNS = [
  { id: 'ssn', label: 'Social Security Numbers', checked: true },
  { id: 'credit-card', label: 'Credit/Debit Card Numbers', checked: true },
  { id: 'bank-account', label: 'Bank Account Numbers', checked: true },
  { id: 'email', label: 'Email Addresses', checked: true },
  { id: 'phone', label: 'Phone Numbers', checked: true },
  { id: 'address', label: 'Physical Addresses', checked: true },
  { id: 'dob', label: 'Dates of Birth', checked: true },
  { id: 'passport', label: 'Passport Numbers', checked: true },
  { id: 'drivers-license', label: "Driver's License Numbers", checked: true },
  { id: 'ip-address', label: 'IP Addresses', checked: true },
  { id: 'username', label: 'Usernames & Online Handles', checked: true },
  { id: 'password', label: 'Passwords & Credentials', checked: true },
  { id: 'medical', label: 'Medical Record Numbers', checked: false },
  { id: 'biometric', label: 'Biometric Data References', checked: false },
];

export const PiiPolling: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.PII_POLL,
    progressChannel: IPC_CHANNELS.PII_POLL_PROGRESS,
  });

  const [source, setSource] = useState<string>('device-full');
  const [outputFolder, setOutputFolder] = useState('');
  const [targetIdentifier, setTargetIdentifier] = useState('');
  const [patterns, setPatterns] = useState(PII_PATTERNS.map((p) => ({ ...p })));
  const [deepScan, setDeepScan] = useState(true);
  const [crossReference, setCrossReference] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedSource = PII_SOURCES.find((s) => s.value === source);
  const isDeviceSource = source.startsWith('device');
  const needsTarget = ['web-osint', 'email-enum', 'social-profile', 'breach-check', 'phone-lookup', 'domain-whois'].includes(source);

  const togglePattern = (id: string) => {
    setPatterns(patterns.map((p) => p.id === id ? { ...p, checked: !p.checked } : p));
  };

  const handleStartClick = () => {
    if (!outputFolder) return;
    if (needsTarget && !targetIdentifier) return;
    setShowConfirm(true);
  };

  const handleConfirmStart = async () => {
    setShowConfirm(false);
    await process.start({
      source,
      outputPath: outputFolder,
      targetIdentifier: targetIdentifier || undefined,
      patterns: patterns.filter((p) => p.checked).map((p) => p.id),
      deepScan,
      crossReference,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="PII Polling & Intelligence"
        description="Extract, discover, and aggregate Personally Identifiable Information from devices and online sources"
        icon={<UserSearch size={24} />}
      />

      <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>SENSITIVE DATA:</strong> PII polling extracts highly sensitive personal data.
            All operations must comply with applicable privacy laws and require proper legal
            authority. Extracted data must be handled according to chain-of-custody requirements.
            Unauthorized collection of PII is illegal.
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-blue-700/30 bg-blue-900/10 p-3 text-sm text-blue-300">
        <div className="flex items-start gap-2">
          <Search size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>No credentials needed:</strong> Online intelligence sources (OSINT, email
            enumeration, social profiling, phone lookup, domain/IP) use publicly accessible
            data and do not require login credentials or API keys.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Intelligence Source</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              {PII_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {selectedSource && (
              <p className="text-xs text-slate-500">{selectedSource.description}</p>
            )}
          </div>

          {needsTarget && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">
                Target Identifier
              </label>
              <input
                type="text"
                value={targetIdentifier}
                onChange={(e) => setTargetIdentifier(e.target.value)}
                placeholder="Email, phone, name, username, domain, or IP..."
                disabled={process.isRunning}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
              <p className="text-xs text-slate-500">
                Enter the target's known identifier to search across intelligence sources.
              </p>
            </div>
          )}

          {/* PII Pattern Selection */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-3 text-sm font-medium text-white">PII Patterns to Detect</h4>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
              {patterns.map((pattern) => (
                <label
                  key={pattern.id}
                  className="flex items-center gap-2 text-xs text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={pattern.checked}
                    onChange={() => togglePattern(pattern.id)}
                    disabled={process.isRunning}
                    className="rounded border-slate-600 bg-slate-800"
                  />
                  {pattern.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={deepScan}
                onChange={(e) => setDeepScan(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Deep scan (search encrypted stores, deleted data, cached content)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={crossReference}
                onChange={(e) => setCrossReference(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Cross-reference findings across multiple sources
            </label>
          </div>

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Select folder to save PII report..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !outputFolder || (needsTarget && !targetIdentifier)}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Polling in Progress...' : 'Start PII Polling'}
          </button>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Device PII Sources</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Contact databases (names, phones, emails)</li>
              <li>• SMS/MMS message content</li>
              <li>• Saved passwords & autofill data</li>
              <li>• Browser form history</li>
              <li>• App account data & tokens</li>
              <li>• Photo EXIF (location, device info)</li>
              <li>• Clipboard history</li>
              <li>• WiFi network names & passwords</li>
              <li>• Document contents (PDFs, notes)</li>
              <li>• Keyboard prediction cache</li>
            </ul>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Online Intelligence</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• OSINT framework integration</li>
              <li>• Data breach database lookups</li>
              <li>• Social media profile aggregation</li>
              <li>• Public records search</li>
              <li>• Email/username correlation</li>
              <li>• Domain & IP ownership history</li>
              <li>• Dark web monitoring feeds</li>
              <li>• People search engine queries</li>
            </ul>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Output Format</h4>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>• Structured JSON/CSV report</li>
              <li>• PII categorized by type and source</li>
              <li>• Confidence scoring per finding</li>
              <li>• Cross-reference relationship map</li>
              <li>• Chain-of-custody metadata</li>
              <li>• Exportable evidence package</li>
            </ul>
          </div>

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

      <ConfirmDialog
        open={showConfirm}
        title="Confirm PII Polling Operation"
        message="This operation will extract and aggregate Personally Identifiable Information from the selected sources. PII data is highly sensitive and subject to privacy regulations. Ensure proper legal authority and data handling procedures are in place. Proceed?"
        confirmLabel="Start PII Polling"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
