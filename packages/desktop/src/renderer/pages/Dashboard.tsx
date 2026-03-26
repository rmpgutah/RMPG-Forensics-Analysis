import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  FolderPlus,
  FolderOpen,
  Smartphone,
  Apple,
  CheckCircle,
  XCircle,
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
      <PageHeader
        title={APP_NAME}
        description="Digital forensics acquisition and analysis toolkit"
        icon={<Shield size={28} />}
      />

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={handleCreateCase}
          className="flex items-center gap-4 rounded-lg border border-slate-700 bg-slate-800/50 p-5 text-left transition hover:border-blue-600 hover:bg-slate-800"
        >
          <div className="rounded-lg bg-blue-600/20 p-3">
            <FolderPlus size={24} className="text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Create New Case</h3>
            <p className="text-sm text-slate-400">Start a new forensic case</p>
          </div>
        </button>

        <button
          onClick={handleOpenCase}
          className="flex items-center gap-4 rounded-lg border border-slate-700 bg-slate-800/50 p-5 text-left transition hover:border-blue-600 hover:bg-slate-800"
        >
          <div className="rounded-lg bg-green-600/20 p-3">
            <FolderOpen size={24} className="text-green-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Open Existing Case</h3>
            <p className="text-sm text-slate-400">Resume work on a case</p>
          </div>
        </button>
      </div>

      {/* Device Status */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone size={18} className="text-green-400" />
              <h3 className="font-semibold text-white">Android Devices</h3>
            </div>
            <span className="rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-300">
              {androidDevices.length}
            </span>
          </div>
          {androidDevices.length === 0 ? (
            <p className="text-sm text-slate-500">No Android devices connected</p>
          ) : (
            <ul className="space-y-2">
              {androidDevices.map((d) => (
                <li key={d.serial} className="flex items-center gap-2 text-sm">
                  <CheckCircle size={12} className="text-green-400" />
                  <span className="text-slate-300">
                    {d.manufacturer} {d.model}
                  </span>
                  <span className="text-xs text-slate-500">({d.serial})</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Apple size={18} className="text-blue-400" />
              <h3 className="font-semibold text-white">iOS Devices</h3>
            </div>
            <span className="rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-300">
              {iosDevices.length}
            </span>
          </div>
          {iosDevices.length === 0 ? (
            <p className="text-sm text-slate-500">No iOS devices connected</p>
          ) : (
            <ul className="space-y-2">
              {iosDevices.map((d) => (
                <li key={d.serial} className="flex items-center gap-2 text-sm">
                  <CheckCircle size={12} className="text-blue-400" />
                  <span className="text-slate-300">
                    {d.manufacturer} {d.model}
                  </span>
                  <span className="text-xs text-slate-500">({d.serial})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent Cases */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-white">
          <Clock size={18} className="text-slate-400" />
          Recent Cases
        </h3>
        {recentCases.length === 0 ? (
          <p className="text-sm text-slate-500">No recent cases</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Case Name</th>
                <th className="pb-2 font-medium">Number</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2 font-medium">Path</th>
              </tr>
            </thead>
            <tbody>
              {recentCases.map((c, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-700/50 transition hover:bg-slate-700/30 cursor-pointer"
                  onClick={() => window.api.invoke(IPC_CHANNELS.CASE_SET_PATH, c.path)}
                >
                  <td className="py-2 text-slate-300">{c.name}</td>
                  <td className="py-2 text-slate-400">{c.caseNumber || '-'}</td>
                  <td className="py-2 text-slate-400">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                  <td className="max-w-[200px] truncate py-2 text-xs text-slate-500">
                    {c.path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tool Status */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h3 className="mb-3 font-semibold text-white">Tool Status</h3>
        <div className="grid grid-cols-3 gap-3">
          {QUICK_TOOLS.map((t) => (
            <ToolStatus key={t.tool} toolName={t.tool} label={t.name} />
          ))}
        </div>
      </div>
    </div>
  );
};
