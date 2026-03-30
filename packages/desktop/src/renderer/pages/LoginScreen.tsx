import React, { useState, useEffect } from 'react';
import { Shield, LogIn, UserPlus, KeyRound, Smartphone } from 'lucide-react';
import QRCodeLib from 'qrcode';
import { useAuthStore } from '../store';

function QRCode({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!value) return;
    QRCodeLib.toDataURL(value, {
      width: size,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).then(setDataUrl).catch(() => {});
  }, [value, size]);

  if (!dataUrl) return null;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-xl bg-white p-3">
        <img src={dataUrl} alt="2FA QR Code" width={size} height={size} />
      </div>
      <p className="text-xs text-gray-500">Scan with your authenticator app</p>
    </div>
  );
}

type AuthPhase = 'loading' | 'create-first-user' | 'login' | '2fa-setup' | '2fa-verify';

export const LoginScreen: React.FC = () => {
  const {
    hasUsers,
    requires2FASetup,
    requires2FAVerify,
    currentUser,
    loading,
    checkStatus,
    login,
    createUser,
    setup2FA,
    verify2FA,
  } = useAuthStore();

  const [phase, setPhase] = useState<AuthPhase>('loading');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpToken, setTotpToken] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);

  useEffect(() => {
    checkStatus();
  }, []);

  useEffect(() => {
    if (loading) {
      setPhase('loading');
    } else if (!hasUsers) {
      setPhase('create-first-user');
    } else if (requires2FASetup) {
      setPhase('2fa-setup');
      handleSetup2FA();
    } else if (requires2FAVerify) {
      setPhase('2fa-verify');
    } else {
      setPhase('login');
    }
  }, [loading, hasUsers, requires2FASetup, requires2FAVerify]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setBusy(true);
    setError('');
    const result = await createUser(username.trim(), password);
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Failed to create user');
    } else {
      // Now login with the new user
      setPhase('login');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setBusy(true);
    setError('');
    // Pass stored trust token to skip 2FA if device is remembered
    const savedToken = localStorage.getItem(`rmpg_trust_${username.trim()}`);
    const result = await login(username.trim(), password, savedToken || undefined);
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Login failed');
    }
    // Phase will auto-update via useEffect
  };

  const handleSetup2FA = async () => {
    const result = await setup2FA();
    if (result.secret) {
      setTotpSecret(result.secret);
      setOtpauthUrl(result.otpauthUrl || '');
    } else {
      setError(result.error || 'Failed to generate 2FA secret');
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpToken.length !== 6) return;
    setBusy(true);
    setError('');
    const result = await verify2FA(totpToken);
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Invalid code — try again');
      setTotpToken('');
    } else if (rememberDevice && currentUser) {
      // Save trust token so 2FA isn't required next time
      try {
        const trustResult = await window.api.invoke('auth:trust-device', currentUser) as { token: string };
        if (trustResult?.token) {
          localStorage.setItem(`rmpg_trust_${currentUser}`, trustResult.token);
        }
      } catch {
        // Non-critical — device just won't be remembered
      }
    }
  };

  if (phase === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d3b5e]">
        <div className="animate-pulse text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d3b5e]">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur">
            <Shield size={36} className="text-[#6495ED]" />
          </div>
          <h1 className="text-2xl font-bold text-white">
            RMPG <span className="text-red-500">FORENSICS</span>
          </h1>
          <p className="mt-1 text-sm text-gray-400">Digital Forensics Analysis Toolkit</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-lg">
          {/* Create First User */}
          {phase === 'create-first-user' && (
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="mb-2 flex items-center gap-2 text-[#6495ED]">
                <UserPlus size={20} />
                <h2 className="text-lg font-semibold text-white">Create Admin Account</h2>
              </div>
              <p className="text-sm text-gray-400">
                Set up your first account. 2FA will be required on login.
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="admin"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="Enter password"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={busy || !username.trim() || !password.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#6495ED] px-4 py-2.5 font-medium text-white transition hover:bg-[#4A7BD9] disabled:opacity-50"
              >
                <UserPlus size={16} />
                {busy ? 'Creating...' : 'Create Account'}
              </button>
            </form>
          )}

          {/* Login */}
          {phase === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="mb-2 flex items-center gap-2 text-[#6495ED]">
                <LogIn size={20} />
                <h2 className="text-lg font-semibold text-white">Sign In</h2>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="Username"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="Password"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={busy || !username.trim() || !password.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#6495ED] px-4 py-2.5 font-medium text-white transition hover:bg-[#4A7BD9] disabled:opacity-50"
              >
                <LogIn size={16} />
                {busy ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          )}

          {/* 2FA Setup (forced on first login or after reset) */}
          {phase === '2fa-setup' && (
            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div className="mb-2 flex items-center gap-2 text-[#6495ED]">
                <Smartphone size={20} />
                <h2 className="text-lg font-semibold text-white">Set Up 2FA</h2>
              </div>
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-300">
                2FA has been reset. You must configure a new authenticator to continue.
              </div>
              <p className="text-sm text-gray-400">
                Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):
              </p>
              {otpauthUrl && <QRCode value={otpauthUrl} size={180} />}
              <details className="group">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
                  Can't scan? Enter secret manually
                </summary>
                <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-white/5 p-3">
                  <code className="select-all break-all text-xs text-[#6495ED]">{totpSecret}</code>
                </div>
              </details>
              <p className="text-xs text-gray-500">
                Account: RMPG Forensics — {currentUser}
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">
                  Enter 6-digit code from authenticator
                </label>
                <input
                  type="text"
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-center text-2xl font-mono tracking-[0.5em] text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[#6495ED]"
                />
                <span className="text-sm text-gray-400">Remember this device (skip 2FA for 30 days)</span>
              </label>
              <button
                type="submit"
                disabled={busy || totpToken.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#6495ED] px-4 py-2.5 font-medium text-white transition hover:bg-[#4A7BD9] disabled:opacity-50"
              >
                <KeyRound size={16} />
                {busy ? 'Verifying...' : 'Verify & Activate'}
              </button>
            </form>
          )}

          {/* 2FA Verify (normal login with existing 2FA) */}
          {phase === '2fa-verify' && (
            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div className="mb-2 flex items-center gap-2 text-[#6495ED]">
                <KeyRound size={20} />
                <h2 className="text-lg font-semibold text-white">Two-Factor Authentication</h2>
              </div>
              <p className="text-sm text-gray-400">
                Enter the 6-digit code from your authenticator app for{' '}
                <span className="font-medium text-white">{currentUser}</span>.
              </p>
              <div>
                <input
                  type="text"
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-center text-2xl font-mono tracking-[0.5em] text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[#6495ED]"
                />
                <span className="text-sm text-gray-400">Remember this device (skip 2FA for 30 days)</span>
              </label>
              <button
                type="submit"
                disabled={busy || totpToken.length !== 6}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#6495ED] px-4 py-2.5 font-medium text-white transition hover:bg-[#4A7BD9] disabled:opacity-50"
              >
                <LogIn size={16} />
                {busy ? 'Verifying...' : 'Verify'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          RMPG Forensics Analysis v1.0.0
        </p>
      </div>
    </div>
  );
};
