import React, { useState } from 'react';
import { Hash, Play, CheckCircle, XCircle } from 'lucide-react';
import { IPC_CHANNELS, HASH_ALGORITHMS } from '@rmpg/shared';
import { PageHeader, FilePicker, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

type Algorithm = (typeof HASH_ALGORITHMS)[number];
type HashResults = Partial<Record<Algorithm, string>>;
type TabKey = 'file' | 'directory' | 'verify';

export const HashGenerator: React.FC = () => {
  const ipc = useIpc();

  const [activeTab, setActiveTab] = useState<TabKey>('file');
  const [selectedAlgorithms, setSelectedAlgorithms] = useState<Set<Algorithm>>(
    new Set(['md5', 'sha1', 'sha256'])
  );

  // File tab state
  const [filePath, setFilePath] = useState('');
  const [fileResults, setFileResults] = useState<HashResults | null>(null);

  // Directory tab state
  const [directoryPath, setDirectoryPath] = useState('');
  const [dirResults, setDirResults] = useState<Record<string, HashResults> | null>(null);

  // Verify tab state
  const [verifyFilePath, setVerifyFilePath] = useState('');
  const [expectedHash, setExpectedHash] = useState('');
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);

  const [isComputing, setIsComputing] = useState(false);

  const toggleAlgorithm = (alg: Algorithm) => {
    setSelectedAlgorithms((prev) => {
      const next = new Set(prev);
      if (next.has(alg)) next.delete(alg);
      else next.add(alg);
      return next;
    });
  };

  const handleComputeFile = async () => {
    if (!filePath || selectedAlgorithms.size === 0) return;
    setIsComputing(true);
    setFileResults(null);
    try {
      const result = (await ipc.invoke(IPC_CHANNELS.HASH_COMPUTE_FILE, {
        filePath,
        algorithms: Array.from(selectedAlgorithms),
      })) as HashResults;
      setFileResults(result);
    } catch {
      // Error handled silently
    } finally {
      setIsComputing(false);
    }
  };

  const handleComputeDirectory = async () => {
    if (!directoryPath || selectedAlgorithms.size === 0) return;
    setIsComputing(true);
    setDirResults(null);
    try {
      const result = (await ipc.invoke(IPC_CHANNELS.HASH_COMPUTE_DIRECTORY, {
        directoryPath,
        algorithms: Array.from(selectedAlgorithms),
      })) as Record<string, HashResults>;
      setDirResults(result);
    } catch {
      // Error handled silently
    } finally {
      setIsComputing(false);
    }
  };

  const handleVerify = async () => {
    if (!verifyFilePath || !expectedHash.trim()) return;
    setIsComputing(true);
    setVerifyResult(null);
    try {
      const result = (await ipc.invoke(IPC_CHANNELS.HASH_VERIFY, {
        filePath: verifyFilePath,
        expectedHash: expectedHash.trim(),
      })) as { match: boolean };
      setVerifyResult(result.match);
    } catch {
      setVerifyResult(false);
    } finally {
      setIsComputing(false);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'file', label: 'File' },
    { key: 'directory', label: 'Directory' },
    { key: 'verify', label: 'Verify' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hash Generator"
        description="Compute and verify cryptographic hashes for files and directories"
        icon={<Hash size={24} />}
      />

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800/50 p-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === key
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Algorithm selection (shared across file and directory tabs) */}
      {(activeTab === 'file' || activeTab === 'directory') && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-300">Algorithms</label>
          <div className="flex flex-wrap gap-2">
            {HASH_ALGORITHMS.map((alg) => (
              <label
                key={alg}
                className="flex items-center gap-2 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 cursor-pointer hover:bg-slate-750"
              >
                <input
                  type="checkbox"
                  checked={selectedAlgorithms.has(alg)}
                  onChange={() => toggleAlgorithm(alg)}
                  disabled={isComputing}
                  className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
                />
                {alg.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Left column: inputs */}
        <div className="space-y-4">
          {activeTab === 'file' && (
            <>
              <FilePicker
                label="Select File"
                value={filePath}
                onChange={setFilePath}
                disabled={isComputing}
              />
              <button
                onClick={handleComputeFile}
                disabled={isComputing || !filePath || selectedAlgorithms.size === 0}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play size={16} />
                {isComputing ? 'Computing...' : 'Compute Hash'}
              </button>
            </>
          )}

          {activeTab === 'directory' && (
            <>
              <FolderPicker
                label="Select Directory"
                value={directoryPath}
                onChange={setDirectoryPath}
                disabled={isComputing}
              />
              <button
                onClick={handleComputeDirectory}
                disabled={isComputing || !directoryPath || selectedAlgorithms.size === 0}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play size={16} />
                {isComputing ? 'Computing...' : 'Compute All Hashes'}
              </button>
            </>
          )}

          {activeTab === 'verify' && (
            <>
              <FilePicker
                label="Select File to Verify"
                value={verifyFilePath}
                onChange={setVerifyFilePath}
                disabled={isComputing}
              />
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">
                  Expected Hash
                </label>
                <input
                  type="text"
                  value={expectedHash}
                  onChange={(e) => setExpectedHash(e.target.value)}
                  placeholder="Paste expected hash value..."
                  disabled={isComputing}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleVerify}
                disabled={isComputing || !verifyFilePath || !expectedHash.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play size={16} />
                {isComputing ? 'Verifying...' : 'Verify Hash'}
              </button>
            </>
          )}
        </div>

        {/* Right column: results */}
        <div className="space-y-4">
          {activeTab === 'file' && fileResults && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-3">
              <h4 className="text-sm font-medium text-white">Hash Results</h4>
              <div className="space-y-2">
                {Object.entries(fileResults).map(([alg, hash]) => (
                  <div key={alg} className="space-y-0.5">
                    <span className="text-xs font-medium text-slate-500 uppercase">{alg}</span>
                    <p className="font-mono text-xs text-green-400 break-all">{hash}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'directory' && dirResults && (
            <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-4">
              <h4 className="text-sm font-medium text-white">Directory Hash Results</h4>
              {Object.entries(dirResults).map(([fileName, hashes]) => (
                <div key={fileName} className="space-y-1">
                  <span className="text-xs font-medium text-slate-300 break-all">{fileName}</span>
                  {Object.entries(hashes).map(([alg, hash]) => (
                    <div key={alg} className="flex gap-2 pl-2">
                      <span className="text-xs text-slate-500 uppercase shrink-0">{alg}:</span>
                      <span className="font-mono text-xs text-green-400 break-all">{hash}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {activeTab === 'verify' && verifyResult !== null && (
            <div
              className={`rounded-lg border p-4 flex items-center gap-3 ${
                verifyResult
                  ? 'border-green-700/50 bg-green-900/20'
                  : 'border-red-700/50 bg-red-900/20'
              }`}
            >
              {verifyResult ? (
                <>
                  <CheckCircle size={24} className="text-green-400 shrink-0" />
                  <div>
                    <h4 className="text-sm font-medium text-green-400">Hash Match - PASS</h4>
                    <p className="text-xs text-green-400/70">
                      The computed hash matches the expected value.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <XCircle size={24} className="text-red-400 shrink-0" />
                  <div>
                    <h4 className="text-sm font-medium text-red-400">Hash Mismatch - FAIL</h4>
                    <p className="text-xs text-red-400/70">
                      The computed hash does not match the expected value.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
