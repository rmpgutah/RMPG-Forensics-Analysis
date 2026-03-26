import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { usePlatform, type Platform } from '../../hooks';

interface PlatformGuardProps {
  allowed: Platform[];
  children: React.ReactNode;
  message?: string;
}

export const PlatformGuard: React.FC<PlatformGuardProps> = ({
  allowed,
  children,
  message,
}) => {
  const { platform } = usePlatform();
  const platformLabels: Record<Platform, string> = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
  };

  if (!allowed.includes(platform)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-8 text-center">
        <AlertTriangle size={48} className="mb-4 text-yellow-400" />
        <h2 className="text-lg font-semibold text-yellow-300">
          Platform Not Supported
        </h2>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          {message ||
            `This feature is only available on ${allowed
              .map((p) => platformLabels[p])
              .join(', ')}. You are currently running on ${platformLabels[platform]}.`}
        </p>
      </div>
    );
  }

  return <>{children}</>;
};
