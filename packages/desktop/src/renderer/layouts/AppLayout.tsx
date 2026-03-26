import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { DeviceStatus } from '../components/common/DeviceStatus';
import { useCaseStore } from '../store';

export const AppLayout: React.FC = () => {
  const caseName = useCaseStore((s) => s.caseName);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-900">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="flex h-12 items-center justify-between border-b border-slate-700 bg-slate-900/80 px-6">
          <div className="flex items-center gap-3">
            {caseName ? (
              <>
                <span className="text-sm text-slate-500">Active Case:</span>
                <span className="rounded bg-blue-600/20 px-2 py-0.5 text-sm font-medium text-blue-400">
                  {caseName}
                </span>
              </>
            ) : (
              <span className="text-sm text-slate-500">No case selected</span>
            )}
          </div>
          <DeviceStatus />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
