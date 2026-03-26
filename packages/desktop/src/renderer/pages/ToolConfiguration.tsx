import React, { useState, useEffect } from 'react';
import { Settings, FolderOpen } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, ToolStatus } from '../components/common';
import { useIpc } from '../hooks';

interface ToolInfo {
  id: string;
  name: string;
  description: string;
}

const TOOLS: ToolInfo[] = [
  { id: 'adb', name: 'ADB', description: 'Android Debug Bridge for device communication' },
  { id: 'java', name: 'Java', description: 'Java Runtime Environment for Android tools' },
  { id: 'python', name: 'Python', description: 'Python interpreter for scripting tools' },
  { id: 'tesseract', name: 'Tesseract', description: 'OCR engine for text recognition' },
  { id: 'instaloader', name: 'Instaloader', description: 'Instagram profile downloader' },
  { id: 'libimobiledevice', name: 'libimobiledevice', description: 'iOS device communication library' },
  { id: 'scrcpy', name: 'Scrcpy', description: 'Android screen mirroring and control' },
  { id: 'jadx', name: 'JADX', description: 'Android APK decompiler' },
];

interface ToolStatusMap {
  [toolId: string]: { installed: boolean; version?: string; path?: string };
}

export const ToolConfiguration: React.FC = () => {
  const ipc = useIpc();

  const [toolStatuses, setToolStatuses] = useState<ToolStatusMap>({});
  const [isChecking, setIsChecking] = useState(false);

  const checkAllTools = async () => {
    setIsChecking(true);
    try {
      const result = (await ipc.invoke(IPC_CHANNELS.TOOLS_CHECK)) as ToolStatusMap;
      setToolStatuses(result);
    } catch {
      // Error handled silently
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkAllTools();
  }, []);

  const handleConfigure = async (toolId: string) => {
    try {
      await ipc.invoke(IPC_CHANNELS.TOOLS_CONFIGURE, { toolId });
      // Refresh status after configuration
      await checkAllTools();
    } catch {
      // Error handled silently
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tool Configuration"
        description="Manage paths and verify installation status of forensic tools"
        icon={<Settings size={24} />}
      />

      <div className="flex justify-end">
        <button
          onClick={checkAllTools}
          disabled={isChecking}
          className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          {isChecking ? 'Checking...' : 'Refresh All'}
        </button>
      </div>

      <div className="space-y-3">
        {TOOLS.map((tool) => {
          const status = toolStatuses[tool.id];
          return (
            <div
              key={tool.id}
              className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 p-4"
            >
              <div className="flex items-center gap-4">
                <ToolStatus tool={tool.id} />
                <div>
                  <h4 className="text-sm font-medium text-white">{tool.name}</h4>
                  <p className="text-xs text-slate-400">{tool.description}</p>
                  {status?.path && (
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{status.path}</p>
                  )}
                  {status?.version && (
                    <p className="text-xs text-slate-500">Version: {status.version}</p>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleConfigure(tool.id)}
                className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
              >
                <FolderOpen size={14} />
                Configure Path
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
