import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { usePlatform, type Platform } from '../../hooks';

interface PlatformGuardProps {
  /** Modern API: array of permitted platforms. */
  allowed?: Platform[];
  /** Legacy single-platform prop kept so older pages (Samsung Unlock)
   *  that pass `platform="win32"` keep working without a refactor. */
  platform?: Platform;
  children: React.ReactNode;
  /** Optional override for the gating message. */
  message?: string;
  /** Legacy alias for `message` — Samsung Unlock uses this prop name. */
  fallbackMessage?: string;
}

export const PlatformGuard: React.FC<PlatformGuardProps> = ({
  allowed,
  platform: legacyPlatform,
  children,
  message,
  fallbackMessage,
}) => {
  const { platform } = usePlatform();
  const platformLabels: Record<Platform, string> = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
  };

  // Normalise both prop shapes into a single array. Default to all
  // platforms when neither was supplied so the guard never crashes from
  // missing input — without this, Samsung Unlock blanked the entire
  // route with "Cannot read properties of undefined (reading 'includes')".
  const allowedList: Platform[] = Array.isArray(allowed) && allowed.length > 0
    ? allowed
    : legacyPlatform
      ? [legacyPlatform]
      : ['win32', 'darwin', 'linux'];
  const fallback = message ?? fallbackMessage;

  if (!allowedList.includes(platform)) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-8 text-center">
        <AlertTriangle size={48} className="mb-4 text-yellow-400" />
        <h2 className="text-lg font-semibold text-yellow-300">
          Platform Not Supported
        </h2>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          {fallback ||
            `This feature is only available on ${allowedList
              .map((p) => platformLabels[p])
              .join(', ')}. You are currently running on ${platformLabels[platform]}.`}
        </p>
      </div>
    );
  }

  return <>{children}</>;
};
