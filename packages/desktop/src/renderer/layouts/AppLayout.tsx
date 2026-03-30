import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { DeviceStatus } from '../components/common/DeviceStatus';
import { useCaseStore, useAuthStore } from '../store';
import { useDeviceStatus } from '../hooks';
import { APP_NAME } from '@rmpg/shared';
import { LogOut, User } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const caseName = useCaseStore((s) => s.caseName);
  const { currentUser, logout } = useAuthStore();
  const { androidDevices } = useDeviceStatus();
  const device = androidDevices[0];

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header bar */}
        <header className="flex h-10 items-center justify-between px-6 shadow-md" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-3">
            {caseName ? (
              <>
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Active Case:</span>
                <span className="rounded bg-[#6495ED]/20 px-2 py-0.5 text-xs font-semibold text-[#6495ED]">
                  {caseName}
                </span>
              </>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No case selected</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <DeviceStatus />
            {currentUser && (
              <div className="flex items-center gap-2 pl-3" style={{ borderLeft: '1px solid var(--border-color)' }}>
                <User size={14} style={{ color: 'var(--text-muted)' }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{currentUser}</span>
                <button
                  onClick={logout}
                  className="rounded p-1 transition hover:bg-white/10"
                  style={{ color: 'var(--text-muted)' }}
                  title="Sign Out"
                >
                  <LogOut size={14} />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
          <Outlet />
        </main>

        {/* Bottom status bar */}
        <footer className="flex h-8 items-center justify-between px-4 text-xs" style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-4">
            <span>{APP_NAME} v1.0.0</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>support@rmpgutah.us</span>
          </div>
          <div className="flex items-center gap-4">
            {device ? (
              <>
                <span>Model: {device.model || 'N/A'}</span>
                <span style={{ color: 'var(--border-color)' }}>|</span>
                <span>Android {device.version || 'N/A'}</span>
                <span style={{ color: 'var(--border-color)' }}>|</span>
                <span>{device.serial}</span>
              </>
            ) : (
              <span>No device connected</span>
            )}
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>Acquisition Path: {caseName || '—'}</span>
          </div>
        </footer>
      </div>
    </div>
  );
};
