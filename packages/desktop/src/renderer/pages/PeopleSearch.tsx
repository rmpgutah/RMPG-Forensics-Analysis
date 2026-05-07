import React, { useState } from 'react';
import { Users, Search, Play, AlertTriangle, Download, FileText } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  PageHeader,
  LogConsole,
  FolderPicker,
  ProgressIndicator,
  ConfirmDialog,
} from '../components/common';
import { useProcess } from '../hooks';

const DATA_POINTS = [
  { id: 'ssn', label: 'Social Security Number', icon: '🔐' },
  { id: 'dob', label: 'Date of Birth', icon: '📅' },
  { id: 'address', label: 'Current & Past Addresses', icon: '🏠' },
  { id: 'phone', label: 'Phone Numbers', icon: '📱' },
  { id: 'email', label: 'Email Addresses', icon: '📧' },
  { id: 'employment', label: 'Employment History', icon: '💼' },
  { id: 'relatives', label: 'Known Relatives & Associates', icon: '👥' },
  { id: 'financial', label: 'Financial Records', icon: '💳' },
  { id: 'criminal', label: 'Criminal Records', icon: '⚖️' },
  { id: 'vehicles', label: 'Vehicle Registration', icon: '🚗' },
  { id: 'property', label: 'Property Ownership', icon: '🏡' },
  { id: 'education', label: 'Education History', icon: '🎓' },
  { id: 'social-media', label: 'Social Media Profiles', icon: '📱' },
  { id: 'photos', label: 'Photos & Images', icon: '📸' },
  { id: 'usernames', label: 'Online Usernames & Handles', icon: '🔍' },
  { id: 'ip-addresses', label: 'Known IP Addresses', icon: '🌐' },
  { id: 'devices', label: 'Registered Devices', icon: '💻' },
  { id: 'travel', label: 'Travel Records', icon: '✈️' },
];

const SEARCH_SOURCES = [
  { id: 'all', label: 'All Available Sources' },
  { id: 'public-records', label: 'Public Records & Databases' },
  { id: 'social-media', label: 'Social Media Platforms' },
  { id: 'breach-data', label: 'Data Breach Archives' },
  { id: 'web-scrape', label: 'Web Scraping & OSINT' },
  { id: 'device-data', label: 'Connected Device Data' },
  { id: 'dark-web', label: 'Dark Web Sources' },
];

export const PeopleSearch: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.PEOPLE_SEARCH,
    progressChannel: IPC_CHANNELS.PEOPLE_SEARCH_PROGRESS,
  });

  // Search inputs
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [knownEmail, setKnownEmail] = useState('');
  const [knownPhone, setKnownPhone] = useState('');
  const [knownAddress, setKnownAddress] = useState('');
  const [knownDob, setKnownDob] = useState('');
  const [knownSsn, setKnownSsn] = useState('');
  const [knownUsername, setKnownUsername] = useState('');

  // Options
  const [selectedData, setSelectedData] = useState<Set<string>>(new Set(['ssn', 'dob', 'address', 'phone', 'email', 'relatives', 'social-media']));
  const [source, setSource] = useState('all');
  const [outputFolder, setOutputFolder] = useState('');
  const [deepSearch, setDeepSearch] = useState(true);
  const [crossReference, setCrossReference] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  const toggleData = (id: string) => {
    const next = new Set(selectedData);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedData(next);
  };

  const selectAllData = () => setSelectedData(new Set(DATA_POINTS.map((d) => d.id)));
  const clearAllData = () => setSelectedData(new Set());

  const hasSearchInput = firstName || lastName || knownEmail || knownPhone || knownAddress || knownDob || knownSsn || knownUsername;

  const handleStartClick = () => {
    if (!hasSearchInput || !outputFolder || selectedData.size === 0) return;
    setShowConfirm(true);
  };

  const handleConfirmStart = async () => {
    setShowConfirm(false);
    await process.start({
      subject: {
        firstName,
        lastName,
        email: knownEmail || undefined,
        phone: knownPhone || undefined,
        address: knownAddress || undefined,
        dob: knownDob || undefined,
        ssn: knownSsn || undefined,
        username: knownUsername || undefined,
      },
      requestedData: Array.from(selectedData),
      source,
      outputPath: outputFolder,
      deepSearch,
      crossReference,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="People Search & Data Collection"
        description="Search and collect personal data — SSN, DOB, addresses, phone numbers, emails, and more"
        icon={<Users size={24} />}
      />

      <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>RESTRICTED:</strong> People search and PII collection is subject to strict
            legal requirements. Ensure proper legal authority (warrant, subpoena, or consent)
            before searching for personal data. All queries are logged.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-6">
        <div className="space-y-5">
          {/* Subject Information */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
            <div className="flex items-center gap-3 mb-4">
              <Search size={18} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-white">Subject Information</h3>
              <span className="text-[10px] text-slate-500">Enter any known details</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">Email Address</label>
                <input
                  type="email"
                  value={knownEmail}
                  onChange={(e) => setKnownEmail(e.target.value)}
                  placeholder="john@example.com"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">Phone Number</label>
                <input
                  type="tel"
                  value={knownPhone}
                  onChange={(e) => setKnownPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">Known Address</label>
                <input
                  type="text"
                  value={knownAddress}
                  onChange={(e) => setKnownAddress(e.target.value)}
                  placeholder="123 Main St, City, ST"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">Date of Birth</label>
                <input
                  type="text"
                  value={knownDob}
                  onChange={(e) => setKnownDob(e.target.value)}
                  placeholder="MM/DD/YYYY"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">SSN (if known)</label>
                <input
                  type="text"
                  value={knownSsn}
                  onChange={(e) => setKnownSsn(e.target.value)}
                  placeholder="XXX-XX-XXXX"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">Username / Handle</label>
                <input
                  type="text"
                  value={knownUsername}
                  onChange={(e) => setKnownUsername(e.target.value)}
                  placeholder="@username"
                  disabled={process.isRunning}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          {/* Data Points to Collect */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-blue-400" />
                <h3 className="text-sm font-semibold text-white">Data to Collect</h3>
              </div>
              <div className="flex gap-2">
                <button onClick={selectAllData} className="rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-600">All</button>
                <button onClick={clearAllData} className="rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-600">None</button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {DATA_POINTS.map((dp) => (
                <label
                  key={dp.id}
                  className={`flex items-center gap-2 rounded px-2.5 py-2 cursor-pointer text-xs transition-colors ${
                    selectedData.has(dp.id)
                      ? 'bg-blue-900/30 text-white'
                      : 'text-slate-400 hover:bg-slate-700/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedData.has(dp.id)}
                    onChange={() => toggleData(dp.id)}
                    disabled={process.isRunning}
                    className="rounded border-slate-600 bg-slate-800"
                  />
                  <span>{dp.icon}</span>
                  <span>{dp.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">Search Source</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={process.isRunning}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              {SEARCH_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={deepSearch}
                onChange={(e) => setDeepSearch(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Deep search (slower, more thorough)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={crossReference}
                onChange={(e) => setCrossReference(e.target.checked)}
                disabled={process.isRunning}
                className="rounded border-slate-600 bg-slate-800"
              />
              Cross-reference across sources
            </label>
          </div>

          <FolderPicker
            label="Save Results To"
            value={outputFolder}
            onChange={setOutputFolder}
            placeholder="Choose output folder..."
            disabled={process.isRunning}
          />

          <button
            onClick={handleStartClick}
            disabled={process.isRunning || !hasSearchInput || !outputFolder || selectedData.size === 0}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {process.isRunning ? (
              <>
                <Search size={16} className="animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search size={16} />
                Search Person ({selectedData.size} data points)
              </>
            )}
          </button>

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">How It Works</h4>
            <ul className="space-y-1.5 text-[11px] text-slate-400">
              <li>1. Enter any known information about the subject</li>
              <li>2. Select what data points you want to find</li>
              <li>3. The system searches all available sources</li>
              <li>4. Results are cross-referenced and verified</li>
              <li>5. A complete dossier is generated as JSON/PDF</li>
            </ul>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Output Includes</h4>
            <ul className="space-y-1 text-[11px] text-slate-400">
              <li>• Structured JSON data file</li>
              <li>• Full person dossier report</li>
              <li>• Source attribution for each finding</li>
              <li>• Confidence scores per data point</li>
              <li>• Relationship/associate graph</li>
              <li>• Timeline of discovered activities</li>
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
        title="Confirm People Search"
        message="This will search for personal data across multiple sources. Results may include sensitive PII (SSN, financial data, addresses). Ensure you have proper legal authority. All queries are logged for audit purposes. Proceed?"
        confirmLabel="Start Search"
        variant="danger"
        onConfirm={handleConfirmStart}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
