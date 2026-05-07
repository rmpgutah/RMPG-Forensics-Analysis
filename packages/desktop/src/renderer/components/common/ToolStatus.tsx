import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';

interface ToolStatusProps {
  toolName: string;
  label?: string;
  description?: string;
}

/**
 * Tool version strings come in many shapes: "Android Debug Bridge version
 * 1.0.41", "tesseract 5.5.2", "openjdk version "21.0.1" 2024-10-15", or just
 * "3.12.4". Extract the first dotted-numeric token and prefix exactly one
 * "v" — never prepend "v" to whatever the binary printed (which can include
 * runtime errors when the tool is a broken stub).
 */
function formatVersion(raw: string): string {
  const match = raw.match(/(\d+\.[\d.]+)/);
  return match ? `v${match[1]}` : raw;
}

export const ToolStatus: React.FC<ToolStatusProps> = ({ toolName, label, description }) => {
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

  const isMissing = status === 'missing';

  return (
    <div
      className="flex items-start gap-2 rounded p-2 text-sm"
      style={{
        background: isMissing ? 'rgba(239,68,68,0.06)' : 'var(--bg-secondary)',
        border: `1px solid ${isMissing ? 'rgba(239,68,68,0.2)' : 'var(--border-color)'}`,
      }}
      title={description}
    >
      <div className="mt-0.5 shrink-0">
        {status === 'checking' && <Loader2 size={14} className="animate-spin text-slate-500" />}
        {status === 'found'    && <CheckCircle size={14} className="text-green-400" />}
        {status === 'missing'  && <XCircle size={14} className="text-red-400" />}
      </div>
      <div className="min-w-0">
        <div
          className="font-medium truncate"
          style={{ color: isMissing ? 'var(--text-secondary)' : 'var(--text-primary)' }}
        >
          {label || toolName}
        </div>
        {status === 'found' && version && (
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatVersion(version)}</div>
        )}
        {isMissing && (
          <div className="text-[11px] text-red-400">Not found in PATH</div>
        )}
      </div>
    </div>
  );
};
