import React, { useState, useEffect, useCallback } from 'react';
import { Settings, FolderOpen, Download, RefreshCw, CheckCircle, XCircle, Loader } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, ToolStatus } from '../components/common';
import { useIpc } from '../hooks';

interface ToolInfo {
  id: string;
  name: string;
  description: string;
  /** Hint shown when the tool is missing */
  installHint?: string;
}

const TOOLS: ToolInfo[] = [
  {
    id: 'adb',
    name: 'ADB',
    description: 'Android Debug Bridge for device communication',
    installHint: 'Part of Android Platform Tools',
  },
  {
    id: 'java',
    name: 'Java',
    description: 'Java Runtime Environment for Android tools',
    installHint: 'Required for IPED and AB→TAR conversion',
  },
  {
    id: 'python',
    name: 'Python',
    description: 'Python 3 interpreter for scripting tools',
    installHint: 'Required for WhatsApp decryption and audio transcription',
  },
  {
    id: 'tesseract',
    name: 'Tesseract OCR',
    description: 'OCR engine for text recognition from images',
    installHint: 'Required for OCR Processing and Screen Capture features',
  },
  {
    id: 'instaloader',
    name: 'Instaloader',
    description: 'Instagram profile downloader (Python package)',
    installHint: 'Install with: pip install instaloader',
  },
  {
    id: 'idevice_id',
    name: 'libimobiledevice',
    description: 'iOS device communication library (idevice_id)',
    installHint: 'Required for all iOS device features',
  },
  {
    id: 'idevicebackup2',
    name: 'idevicebackup2',
    description: 'iOS backup and restore utility',
    installHint: 'Part of libimobiledevice',
  },
  {
    id: 'ideviceinfo',
    name: 'ideviceinfo',
    description: 'iOS device information query tool',
    installHint: 'Part of libimobiledevice',
  },
  {
    id: 'scrcpy',
    name: 'Scrcpy',
    description: 'Android screen mirroring and control',
    installHint: 'Required for Device Mirror feature',
  },
  {
    id: 'jadx',
    name: 'JADX',
    description: 'Android APK decompiler',
    installHint: 'Required for APK Analysis feature',
  },
];

interface ToolStatusEntry {
  found: boolean;
  version?: string;
  path?: string;
}

interface ToolStatusMap {
  [toolId: string]: ToolStatusEntry;
}

interface InstallState {
  status: 'idle' | 'installing' | 'done' | 'error' | 'manual';
  message?: string;
}

export const ToolConfiguration: React.FC = () => {
  const ipc = useIpc();

  const [toolStatuses, setToolStatuses] = useState<ToolStatusMap>({});
  const [isChecking, setIsChecking] = useState(false);
  const [platform, setPlatform] = useState<string>('');
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});

  const checkAllTools = useCallback(async () => {
    setIsChecking(true);
    try {
      const result = (await ipc.invoke(IPC_CHANNELS.TOOLS_CHECK)) as ToolStatusMap;
      setToolStatuses(result);
    } catch {
      // Error handled silently
    } finally {
      setIsChecking(false);
    }
  }, [ipc]);

  useEffect(() => {
    checkAllTools();
    ipc.invoke(IPC_CHANNELS.APP_GET_PLATFORM).then((p) => setPlatform(String(p))).catch(() => {});
  }, [checkAllTools, ipc]);

  // Listen for install progress events.
  //
  // preload's `api.on` invokes the callback as `callback(...args)` —
  // pulling the first arg via varargs surfaces the live brew/winget/pip
  // stdout that the install handler is already streaming. Without this,
  // Java install showed "Installing..." with no live output forever.
  useEffect(() => {
    const cleanup = window.api.on(
      IPC_CHANNELS.TOOLS_INSTALL_PROGRESS,
      (...args: unknown[]) => {
        const data = (args[0] ?? {}) as { toolName?: string; message?: string; percent?: number };
        if (!data.toolName) return;
        setInstallStates((prev) => ({
          ...prev,
          [data.toolName!]: {
            status: 'installing',
            message: data.message ?? prev[data.toolName!]?.message ?? 'Installing…',
          },
        }));
      }
    );
    return cleanup;
  }, []);

  const handleConfigure = async (toolId: string) => {
    try {
      const result = await ipc.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, {
        title: `Locate ${toolId} executable`,
        filters: [
          { name: 'Executables', extensions: ['exe', 'cmd', 'bat', '*'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      }) as string | null;
      if (!result) return;
      await ipc.invoke(IPC_CHANNELS.TOOLS_CONFIGURE, toolId, result);
      await checkAllTools();
    } catch {
      // Error handled silently
    }
  };

  const handleInstall = async (toolId: string) => {
    setInstallStates((prev) => ({
      ...prev,
      [toolId]: { status: 'installing', message: 'Starting installation...' },
    }));

    try {
      const result = await ipc.invoke(IPC_CHANNELS.TOOLS_INSTALL, toolId) as {
        success: boolean;
        manualInstall?: boolean;
        message?: string;
      };

      if (result.manualInstall) {
        setInstallStates((prev) => ({
          ...prev,
          [toolId]: { status: 'manual', message: result.message ?? 'Manual installation required' },
        }));
      } else {
        setInstallStates((prev) => ({
          ...prev,
          [toolId]: { status: 'done', message: 'Installed successfully!' },
        }));
        // Re-check tools after successful install
        await checkAllTools();
      }
    } catch (err) {
      setInstallStates((prev) => ({
        ...prev,
        [toolId]: {
          status: 'error',
          message: (err as Error).message,
        },
      }));
    }
  };

  const getInstallButtonLabel = (toolId: string): string => {
    if (platform === 'darwin') return 'Install via Homebrew';
    if (platform === 'win32') {
      // winget tools
      if (['java', 'python'].includes(toolId)) return 'Install via winget';
      return 'Open Download Page';
    }
    return 'Install';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tool Configuration"
        description="Verify and install the external tools required by each forensic feature"
        icon={<Settings size={24} />}
      />

      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">
          Platform: <span className="font-mono">{platform || '…'}</span>
          {platform === 'darwin' && ' — Homebrew auto-install available'}
          {platform === 'win32' && ' — winget auto-install available for some tools'}
        </p>
        <button
          onClick={checkAllTools}
          disabled={isChecking}
          className="btn-secondary flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={14} className={isChecking ? 'animate-spin' : ''} />
          {isChecking ? 'Checking…' : 'Refresh All'}
        </button>
      </div>

      <div className="space-y-3">
        {TOOLS.map((tool) => {
          const status = toolStatuses[tool.id];
          const installState = installStates[tool.id];
          const isInstalled = status?.found ?? false;
          const isInstalling = installState?.status === 'installing';

          return (
            <div
              key={tool.id}
              className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: status indicator + info */}
                <div className="flex items-start gap-4 min-w-0">
                  <ToolStatus toolName={tool.id} label={tool.name} />
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-[var(--text-primary)]">{tool.name}</h4>
                    <p className="text-xs text-[var(--text-secondary)]">{tool.description}</p>
                    {status?.path && (
                      <p className="mt-0.5 truncate font-mono text-xs text-[var(--text-muted)]">{status.path}</p>
                    )}
                    {status?.version && (
                      <p className="text-xs text-[var(--text-muted)]">Version: {status.version}</p>
                    )}
                    {!isInstalled && tool.installHint && !installState && (
                      <p className="mt-0.5 text-xs text-amber-400">{tool.installHint}</p>
                    )}
                    {/* Install progress / result message */}
                    {installState && (
                      <div className="mt-1 flex items-center gap-1.5">
                        {installState.status === 'installing' && (
                          <Loader size={12} className="animate-spin text-blue-400" />
                        )}
                        {installState.status === 'done' && (
                          <CheckCircle size={12} className="text-green-400" />
                        )}
                        {(installState.status === 'error' || installState.status === 'manual') && (
                          <XCircle size={12} className="text-amber-400" />
                        )}
                        <p className={`text-xs ${
                          installState.status === 'done'
                            ? 'text-green-400'
                            : installState.status === 'error'
                            ? 'text-red-400'
                            : installState.status === 'manual'
                            ? 'text-amber-400'
                            : 'text-[var(--text-muted)]'
                        }`}>
                          {installState.message}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: action buttons */}
                <div className="flex shrink-0 items-center gap-2">
                  {!isInstalled && (
                    <button
                      onClick={() => handleInstall(tool.id)}
                      disabled={isInstalling}
                      className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50"
                      title={getInstallButtonLabel(tool.id)}
                    >
                      {isInstalling ? (
                        <Loader size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      {isInstalling ? 'Installing…' : getInstallButtonLabel(tool.id)}
                    </button>
                  )}
                  <button
                    onClick={() => handleConfigure(tool.id)}
                    disabled={isInstalling}
                    className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-50"
                    title="Browse to executable"
                  >
                    <FolderOpen size={12} />
                    {isInstalled ? 'Change Path' : 'Browse…'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">Install Methods</h3>
        <div className="space-y-1 text-xs text-[var(--text-muted)]">
          {platform === 'darwin' && (
            <>
              <p>• <strong>Install via Homebrew</strong> — runs <code>brew install &lt;package&gt;</code> automatically</p>
              <p>• Requires Homebrew to be installed — visit <code>brew.sh</code> for instructions</p>
            </>
          )}
          {platform === 'win32' && (
            <>
              <p>• <strong>Install via winget</strong> — uses Windows Package Manager (built into Windows 11)</p>
              <p>• <strong>Open Download Page</strong> — opens the official download page in your browser</p>
            </>
          )}
          <p>• <strong>Browse…</strong> — manually locate an already-installed executable on disk</p>
        </div>
      </div>
    </div>
  );
};
