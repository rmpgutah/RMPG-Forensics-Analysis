import React, { useState, useEffect, useCallback } from 'react';
import { Download, FolderOpen, CheckCircle, XCircle, Loader2, Monitor, Apple } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, ProgressIndicator } from '../components/common';
import { useIpc, usePlatform } from '../hooks';

interface PlatformDownload {
  url: string;
  filename: string;
  size: string;
}

interface DownloadableApp {
  id: string;
  name: string;
  description: string;
  version: string;
  platforms: {
    win?: PlatformDownload;
    mac?: PlatformDownload;
  };
  badge: 'stable' | 'beta' | 'alpha';
  localStatus?: { exists: boolean; filePath?: string; fileSize?: number };
}

interface DownloadProgress {
  id: string;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  speed: string;
  status: 'idle' | 'downloading' | 'complete' | 'error' | 'cancelled';
  error?: string;
  filePath?: string;
}

const BADGE_STYLES: Record<string, string> = {
  stable: 'bg-green-500/20 text-green-400',
  beta: 'bg-yellow-500/20 text-yellow-400',
  alpha: 'bg-purple-500/20 text-purple-400',
};

export const AppDownloads: React.FC = () => {
  const ipc = useIpc();
  const { platform } = usePlatform();
  const [apps, setApps] = useState<DownloadableApp[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({});
  const [isLoading, setIsLoading] = useState(true);

  const currentPlatform: 'win' | 'mac' = platform === 'darwin' ? 'mac' : 'win';

  const loadCatalog = useCallback(async () => {
    setIsLoading(true);
    const result = await ipc.invoke<DownloadableApp[]>(IPC_CHANNELS.DOWNLOAD_LIST);
    if (result) {
      setApps(result);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Listen for download progress events
  useEffect(() => {
    const handleProgress = (...args: unknown[]) => {
      const progress = args[0] as DownloadProgress;
      setDownloads((prev) => ({ ...prev, [progress.id]: progress }));

      // Refresh catalog when download completes
      if (progress.status === 'complete') {
        setTimeout(() => loadCatalog(), 500);
      }
    };

    window.api.on(IPC_CHANNELS.DOWNLOAD_PROGRESS, handleProgress);
    return () => {
      window.api.removeListener(IPC_CHANNELS.DOWNLOAD_PROGRESS, handleProgress);
    };
  }, [loadCatalog]);

  const handleDownload = async (appId: string, targetPlatform?: 'win' | 'mac') => {
    const plt = targetPlatform || currentPlatform;
    const downloadId = `${appId}-${plt}`;
    setDownloads((prev) => ({
      ...prev,
      [downloadId]: {
        id: downloadId,
        percent: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        speed: '0 B/s',
        status: 'downloading',
      },
    }));

    try {
      await ipc.invoke(IPC_CHANNELS.DOWNLOAD_START, appId, plt);
    } catch {
      // Error will come through progress event
    }
  };

  const handleCancel = async (appId: string, targetPlatform?: 'win' | 'mac') => {
    const plt = targetPlatform || currentPlatform;
    await ipc.invoke(IPC_CHANNELS.DOWNLOAD_CANCEL, appId, plt);
  };

  const handleOpenFolder = async () => {
    await ipc.invoke(IPC_CHANNELS.DOWNLOAD_OPEN_FOLDER);
  };

  const getDownloadState = (appId: string, plt: 'win' | 'mac'): DownloadProgress | null => {
    return downloads[`${appId}-${plt}`] || null;
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-blue-400" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="App Downloads"
        description="Download RMPG companion tools for Windows and macOS"
        icon={<Download size={24} />}
        actions={
          <button
            onClick={handleOpenFolder}
            className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
          >
            <FolderOpen size={14} />
            Open Downloads Folder
          </button>
        }
      />

      {/* Platform indicator */}
      <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3">
        {currentPlatform === 'mac' ? <Apple size={16} className="text-slate-300" /> : <Monitor size={16} className="text-slate-300" />}
        <span className="text-sm text-slate-300">
          Current platform: <strong className="text-white">{currentPlatform === 'mac' ? 'macOS' : 'Windows'}</strong>
        </span>
        <span className="text-xs text-slate-500 ml-2">
          Downloads for both platforms are available below
        </span>
      </div>

      {/* App cards */}
      <div className="space-y-4">
        {apps.map((appItem) => (
          <AppDownloadCard
            key={appItem.id}
            app={appItem}
            currentPlatform={currentPlatform}
            winProgress={getDownloadState(appItem.id, 'win')}
            macProgress={getDownloadState(appItem.id, 'mac')}
            onDownload={handleDownload}
            onCancel={handleCancel}
          />
        ))}
      </div>
    </div>
  );
};

interface AppDownloadCardProps {
  app: DownloadableApp;
  currentPlatform: 'win' | 'mac';
  winProgress: DownloadProgress | null;
  macProgress: DownloadProgress | null;
  onDownload: (appId: string, platform: 'win' | 'mac') => void;
  onCancel: (appId: string, platform: 'win' | 'mac') => void;
}

const AppDownloadCard: React.FC<AppDownloadCardProps> = ({
  app,
  currentPlatform,
  winProgress,
  macProgress,
  onDownload,
  onCancel,
}) => {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white">{app.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${BADGE_STYLES[app.badge]}`}>
              v{app.version} {app.badge}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{app.description}</p>
        </div>
        {app.localStatus?.exists && (
          <div className="flex items-center gap-1 rounded bg-green-500/10 px-2 py-1 text-xs text-green-400">
            <CheckCircle size={12} />
            Downloaded
          </div>
        )}
      </div>

      {/* Platform download buttons */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Windows */}
        <PlatformDownloadRow
          platform="win"
          platformInfo={app.platforms.win}
          progress={winProgress}
          isCurrent={currentPlatform === 'win'}
          appId={app.id}
          onDownload={onDownload}
          onCancel={onCancel}
        />

        {/* macOS */}
        <PlatformDownloadRow
          platform="mac"
          platformInfo={app.platforms.mac}
          progress={macProgress}
          isCurrent={currentPlatform === 'mac'}
          appId={app.id}
          onDownload={onDownload}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
};

interface PlatformDownloadRowProps {
  platform: 'win' | 'mac';
  platformInfo?: PlatformDownload;
  progress: DownloadProgress | null;
  isCurrent: boolean;
  appId: string;
  onDownload: (appId: string, platform: 'win' | 'mac') => void;
  onCancel: (appId: string, platform: 'win' | 'mac') => void;
}

const PlatformDownloadRow: React.FC<PlatformDownloadRowProps> = ({
  platform,
  platformInfo,
  progress,
  isCurrent,
  appId,
  onDownload,
  onCancel,
}) => {
  if (!platformInfo) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-slate-700/50 bg-slate-900/30 px-4 py-3 opacity-50">
        {platform === 'mac' ? <Apple size={16} /> : <Monitor size={16} />}
        <span className="text-sm text-slate-500">
          {platform === 'mac' ? 'macOS' : 'Windows'} — Not available
        </span>
      </div>
    );
  }

  const isDownloading = progress?.status === 'downloading';
  const isComplete = progress?.status === 'complete';
  const isError = progress?.status === 'error';

  return (
    <div className={`rounded-md border px-4 py-3 ${isCurrent ? 'border-blue-500/30 bg-blue-500/5' : 'border-slate-700/50 bg-slate-900/30'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {platform === 'mac' ? (
            <Apple size={16} className="text-slate-300" />
          ) : (
            <Monitor size={16} className="text-slate-300" />
          )}
          <div>
            <span className="text-sm font-medium text-white">
              {platform === 'mac' ? 'macOS' : 'Windows'}
              {isCurrent && <span className="ml-2 text-xs text-blue-400">(current)</span>}
            </span>
            <p className="text-xs text-slate-500">{platformInfo.filename} · {platformInfo.size}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isComplete && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle size={12} /> Done
            </span>
          )}
          {isError && (
            <span className="flex items-center gap-1 text-xs text-red-400" title={progress?.error}>
              <XCircle size={12} /> Failed
            </span>
          )}
          {isDownloading ? (
            <button
              onClick={() => onCancel(appId, platform)}
              className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => onDownload(appId, platform)}
              className="flex items-center gap-1.5 rounded-md border border-blue-500/50 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-500/20"
            >
              <Download size={12} />
              Download
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isDownloading && progress && (
        <div className="mt-3">
          <ProgressIndicator
            percent={progress.percent}
            message={`${progress.speed} — ${formatBytes(progress.bytesDownloaded)} / ${formatBytes(progress.totalBytes)}`}
            isRunning={true}
            showPercentage={true}
          />
        </div>
      )}
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
