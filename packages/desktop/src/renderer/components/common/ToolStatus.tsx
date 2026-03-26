import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';

interface ToolStatusProps {
  toolName: string;
  label?: string;
}

export const ToolStatus: React.FC<ToolStatusProps> = ({ toolName, label }) => {
  const [status, setStatus] = useState<'checking' | 'found' | 'missing'>('checking');
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    const check = async () => {
      try {
        const result = (await window.api.invoke(IPC_CHANNELS.TOOLS_CHECK, toolName)) as {
          found: boolean;
          version?: string;
        };
        setStatus(result.found ? 'found' : 'missing');
        if (result.version) setVersion(result.version);
      } catch {
        setStatus('missing');
      }
    };
    check();
  }, [toolName]);

  return (
    <div className="flex items-center gap-2 text-sm">
      {status === 'checking' && (
        <Loader2 size={14} className="animate-spin text-slate-500" />
      )}
      {status === 'found' && <CheckCircle size={14} className="text-green-400" />}
      {status === 'missing' && <XCircle size={14} className="text-red-400" />}
      <span className={status === 'missing' ? 'text-red-400' : 'text-slate-300'}>
        {label || toolName}
        {version && <span className="ml-1 text-xs text-slate-500">v{version}</span>}
      </span>
      {status === 'missing' && (
        <span className="text-xs text-red-400/70">(not found)</span>
      )}
    </div>
  );
};
