import React, { useState, useEffect } from 'react';
import {
  FolderPlus,
  FolderOpen,
  Smartphone,
  Apple,
  CheckCircle,
  Clock,
  Shield,
} from 'lucide-react';
import { IPC_CHANNELS, APP_NAME } from '@rmpg/shared';
import { PageHeader, ToolStatus } from '../components/common';
import { useDeviceStatus } from '../hooks';

interface RecentCase {
  name: string;
  path: string;
  createdAt: string;
  caseNumber?: string;
}

const QUICK_TOOLS: { name: string; tool: string }[] = [
  { name: 'ADB', tool: 'adb' },
  { name: 'Java', tool: 'java' },
  { name: 'Tesseract', tool: 'tesseract' },
  { name: 'Python', tool: 'python' },
  { name: 'libimobiledevice', tool: 'idevicebackup2' },
  { name: 'Instaloader', tool: 'instaloader' },
];

export const Dashboard: React.FC = () => {
  const { androidDevices, iosDevices, refresh } = useDeviceStatus();
  const [recentCases, setRecentCases] = useState<RecentCase[]>([]);

  useEffect(() => {
    const loadCases = async () => {
      try {
        const cases = (await window.api.invoke(IPC_CHANNELS.CASE_LIST)) as RecentCase[];
        if (Array.isArray(cases)) {
          setRecentCases(cases.slice(0, 5));
        }
      } catch {
        // No cases or not yet initialized
      }
    };
    loadCases();
  }, []);

  const handleCreateCase = async () => {
    await window.api.invoke(IPC_CHANNELS.CASE_CREATE);
  };

  const handleOpenCase = async () => {
    await window.api.invoke(IPC_CHANNELS.CASE_OPEN);
  };

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="card rounded-xl bg-gradient-to-br from-[#1a2a3a] to-[#0d3b5e] p-8 text-center" style={{ border: 'none' }}>
        <div className="mb-3 flex items-center justify-center gap-3">
          <div className="rounded-xl bg-white/10 p-3">
            <Shield size={32} className="text-[#6495ED]" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white">
          <span className="text-white">RMPG</span>{' '}
          <span className="text-red-400">FORENSICS</span>
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Digital Forensics Acquisition & Analysis Toolkit</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={handleCreateCase}
          className="card flex flex-col items-center gap-3 p-8 text-center transition hover:border-[#6495ED]"
        >
          <div className="rounded-xl bg-[#6495ED]/15 p-4">
            <FolderPlus size={32} className="text-[#6495ED]" />
          </div>
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>NEW CASE</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Start a new forensic case</p>
          </div>
        </button>

        <button
          onClick={handleOpenCase}
          className="card flex flex-col items-center gap-3 p-8 text-center transition hover:border-green-500"
        >
          <div className="rounded-xl p-4" style={{ background: 'rgba(34,197,94,0.1)' }}>
            <FolderOpen size={32} className="text-green-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>LOAD EXISTING</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Resume work on a case</p>
          </div>
        </button>
      </div>

      {/* Device Status */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone size={18} className="text-green-400" />
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Android Devices</h3>
            </div>
            <span className="badge-info">{androidDevices.length}</span>
          </div>
          {androidDevices.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No Android devices connected</p>
          ) : (
            <ul className="space-y-2">
              {androidDevices.map((d) => (
                <li key={d.serial} className="flex items-center gap-2 text-sm">
                  <CheckCircle size={12} className="text-green-400" />
                  <span style={{ color: 'var(--text-primary)' }}>
                    {d.manufacturer} {d.model}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({d.serial})</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Apple size={18} className="text-[#6495ED]" />
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>iOS Devices</h3>
            </div>
            <span className="badge-info">{iosDevices.length}</span>
          </div>
          {iosDevices.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No iOS devices connected</p>
          ) : (
            <ul className="space-y-2">
              {iosDevices.map((d) => (
                <li key={d.serial} className="flex items-center gap-2 text-sm">
                  <CheckCircle size={12} className="text-[#6495ED]" />
                  <span style={{ color: 'var(--text-primary)' }}>
                    {d.manufacturer} {d.model}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({d.serial})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent Cases */}
      <div className="card">
        <h3 className="mb-3 flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Clock size={18} style={{ color: 'var(--text-muted)' }} />
          Recent Cases
        </h3>
        {recentCases.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No recent cases</p>
        ) : (
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>Case Name</th>
                <th>Number</th>
                <th>Created</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {recentCases.map((c, i) => (
                <tr
                  key={i}
                  className="cursor-pointer"
                  onClick={() => window.api.invoke(IPC_CHANNELS.CASE_SET_PATH, c.path)}
                >
                  <td>{c.name}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{c.caseNumber || '-'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                  <td className="max-w-[200px] truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {c.path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tool Status */}
      <div className="card">
        <h3 className="mb-3 font-semibold" style={{ color: 'var(--text-primary)' }}>Tool Status</h3>
        <div className="grid grid-cols-3 gap-3">
          {QUICK_TOOLS.map((t) => (
            <ToolStatus key={t.tool} toolName={t.tool} label={t.name} />
          ))}
        </div>
      </div>
    </div>
  );
};
