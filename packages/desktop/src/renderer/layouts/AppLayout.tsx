import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { DeviceStatus, BackgroundTaskBar, ErrorBanner, ErrorToast, ErrorModal } from '../components/common';
import { useCaseStore, useAuthStore, useBackupStore } from '../store';
import { useSettingsStore } from '../store/settings-store';
import { useDeviceStatus } from '../hooks';
import { APP_NAME, APP_VERSION, IPC_CHANNELS } from '@rmpg/shared';
import { LogOut, User, Download, RefreshCw, Sun, Moon } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const caseName = useCaseStore((s) => s.caseName);
  const { currentUser, logout } = useAuthStore();
  const { preferences, setPreference } = useSettingsStore();
  const isLight = preferences.theme === 'light';
  const toggleTheme = () => setPreference('theme', isLight ? 'dark' : 'light');
  const { androidDevices } = useDeviceStatus();
  const device = androidDevices[0];
  const { updateProgress, task } = useBackupStore();
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState<number>(0);

  // Global IOS_BACKUP_PROGRESS listener — persists across page navigation
  // Note: the preload strips the IPC event, so the first arg IS the data payload
  useEffect(() => {
    const cleanup = window.api.on(IPC_CHANNELS.IOS_BACKUP_PROGRESS, (data: Record<string, unknown>) => {
      if (typeof data.percent === 'number') {
        updateProgress({
          percent: data.percent as number,
          message: (data.message as string) || (data.data as string) || undefined,
          bytes: data.bytes as number | undefined,
          totalBytes: data.totalBytes as number | undefined,
          speed: data.speed as number | undefined,
          eta: data.eta as number | undefined,
          filesCount: data.filesCount as number | undefined,
          totalFiles: data.totalFiles as number | undefined,
        });
      } else if (data?.data) {
        updateProgress({ message: String(data.data) });
      }
    });
    return cleanup;
  }, [updateProgress]);

  // Auto-update listeners
  useEffect(() => {
    const cleanupAvailable = window.api.on('update:available', (data: Record<string, unknown>) => {
      setUpdateVersion(String(data.version ?? ''));
      setDownloadPercent(0);
    });
    const cleanupProgress = window.api.on('update:download-progress', (data: Record<string, unknown>) => {
      setDownloadPercent(Number(data.percent ?? 0));
    });
    const cleanupDownloaded = window.api.on('update:downloaded', (data: Record<string, unknown>) => {
      setUpdateVersion(String(data.version ?? ''));
      setDownloadPercent(100);
      setUpdateReady(true);
    });
    return () => { cleanupAvailable(); cleanupProgress(); cleanupDownloaded(); };
  }, []);

  const handleInstallUpdate = () => {
    window.api.invoke('update:install-now').catch(() => {});
  };

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
            <button
              onClick={toggleTheme}
              className="rounded p-1 transition hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
              title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
            >
              {isLight ? <Moon size={14} /> : <Sun size={14} />}
            </button>
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

        {/* Auto-update banner */}
        {updateVersion && (
          <div className="flex flex-col gap-1 px-6 py-2 text-xs"
            style={{ background: updateReady ? 'rgba(74,222,128,0.08)' : 'rgba(100,149,237,0.08)', borderBottom: `1px solid ${updateReady ? 'rgba(74,222,128,0.25)' : 'rgba(100,149,237,0.25)'}` }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {updateReady
                  ? <RefreshCw size={13} className="text-green-400" />
                  : <Download size={13} className="animate-bounce text-[#6495ED]" />}
                <span style={{ color: updateReady ? '#4ade80' : '#6495ED' }}>
                  {updateReady
                    ? `v${updateVersion} downloaded — will install on next restart`
                    : `Downloading update v${updateVersion}… ${downloadPercent}%`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {updateReady && (
                  <button
                    onClick={handleInstallUpdate}
                    className="rounded px-3 py-1 text-xs font-medium transition hover:opacity-80"
                    style={{ background: '#4ade80', color: '#0f1117' }}
                  >
                    Restart Now
                  </button>
                )}
              </div>
            </div>
            {!updateReady && (
              <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'rgba(100,149,237,0.15)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${downloadPercent}%`, background: '#6495ED' }}
                />
              </div>
            )}
          </div>
        )}

        {/* Error banners — persistent until dismissed */}
        <ErrorBanner />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--bg-primary)' }}>
          <Outlet />
        </main>

        {/* Background task bar — shows backup progress across all pages */}
        {task && !task.dismissed && <BackgroundTaskBar />}

        {/* Bottom status bar */}
        <footer className="flex h-8 items-center justify-between px-4 text-xs" style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-4">
            <span>{APP_NAME} v{APP_VERSION}</span>
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

        {/* Floating error UIs (z-index handled inside the components) */}
        <ErrorToast />
        <ErrorModal />
      </div>
    </div>
  );
};
