import React, { useState, useEffect } from 'react';
import { Shield, LogIn, UserPlus, KeyRound, Smartphone, User, Lock as LockIcon } from 'lucide-react';
import QRCodeLib from 'qrcode';
import { IPC_CHANNELS, APP_VERSION } from '@rmpg/shared';
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
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
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
        const trustResult = await window.api.invoke(IPC_CHANNELS.AUTH_TRUST_DEVICE, currentUser) as { token: string };
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
      <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[#0a1828]" role="main" aria-label="Loading">
        <BackgroundFx />
        <Forensic3DScene />
        <HudOverlay />
        <div className="relative flex flex-col items-center gap-3 text-white" aria-live="polite">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-[#6495ED]" role="status" aria-label="Loading" />
          <div className="text-sm tracking-widest text-gray-400">INITIALIZING</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[#0a1828]" role="main" aria-label="Authentication">
      <BackgroundFx />
      <Forensic3DScene />
      <HudOverlay />

      <div className="relative w-full max-w-md px-4">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="relative mx-auto mb-5 h-20 w-20">
            <div className="absolute inset-0 animate-pulse rounded-2xl bg-[#6495ED]/20 blur-xl" />
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#6495ED]/40 via-transparent to-red-500/30 p-[1px]">
              <div className="flex h-full w-full items-center justify-center rounded-2xl bg-[#0f2238]/90 backdrop-blur-xl">
                <Shield size={38} className="text-[#6495ED] drop-shadow-[0_0_8px_rgba(100,149,237,0.6)]" />
              </div>
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-wide text-white">
            <span className="bg-gradient-to-b from-white to-gray-300 bg-clip-text text-transparent">RMPG</span>{' '}
            <span className="bg-gradient-to-b from-red-400 to-red-600 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(239,68,68,0.35)]">
              FORENSICS
            </span>
          </h1>
          <p className="mt-2 text-xs uppercase tracking-[0.3em] text-gray-400">
            Digital Forensics Analysis Toolkit
          </p>
        </div>

        {/* Card with animated gradient border */}
        <div className="relative rounded-2xl p-[1px]">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#6495ED]/40 via-white/5 to-red-500/20" />
          <div className="relative rounded-2xl border border-white/10 bg-[#0f2238]/70 p-8 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)] backdrop-blur-xl">
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
                <label htmlFor="create-username" className="mb-1 block text-xs font-medium text-gray-400">Username</label>
                <input
                  id="create-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="admin"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="create-password" className="mb-1 block text-xs font-medium text-gray-400">Password</label>
                <input
                  id="create-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="Enter password"
                  autoComplete="new-password"
                  minLength={8}
                />
                {password.length > 0 && password.length < 8 && (
                  <p role="alert" className="mt-1 text-xs text-yellow-400">Password must be at least 8 characters</p>
                )}
              </div>
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
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
              <div className="mb-3 flex items-center gap-2 border-b border-white/5 pb-3 text-[#6495ED]">
                <LogIn size={20} />
                <h2 className="text-lg font-semibold text-white">Sign In</h2>
              </div>
              <div>
                <label htmlFor="login-username" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">Username</label>
                <div className="relative">
                  <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-white placeholder-gray-500 outline-none transition focus:border-[#6495ED] focus:bg-white/10 focus:ring-2 focus:ring-[#6495ED]/30"
                    placeholder="Username"
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>
              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">Password</label>
                <div className="relative">
                  <LockIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                  <input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-white placeholder-gray-500 outline-none transition focus:border-[#6495ED] focus:bg-white/10 focus:ring-2 focus:ring-[#6495ED]/30"
                    placeholder="Password"
                    autoComplete="current-password"
                  />
                </div>
              </div>
              {error && (
                <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={busy || !username.trim() || !password.trim()}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-[#6495ED] to-[#4A7BD9] px-4 py-2.5 font-medium text-white shadow-lg shadow-[#6495ED]/20 transition hover:shadow-[#6495ED]/40 hover:brightness-110 disabled:opacity-50 disabled:hover:shadow-[#6495ED]/20"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <LogIn size={16} className="relative" />
                <span className="relative">{busy ? 'Signing in...' : 'Sign In'}</span>
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
                <label htmlFor="setup-totp" className="mb-1 block text-xs font-medium text-gray-400">
                  Enter 6-digit code from authenticator
                </label>
                <input
                  id="setup-totp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-center text-2xl font-mono tracking-[0.5em] text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
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
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label="6-digit verification code"
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-center text-2xl font-mono tracking-[0.5em] text-white placeholder-gray-500 outline-none focus:border-[#6495ED] focus:ring-1 focus:ring-[#6495ED]"
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
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
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-gray-500">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="tracking-wider">SECURE</span>
          <span className="text-gray-700">•</span>
          <span>{`RMPG Forensics Analysis v${APP_VERSION}`}</span>
        </div>
      </div>
    </div>
  );
};

const BackgroundFx: React.FC = () => (
  <>
    {/* Base radial glows */}
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-[#6495ED]/20 blur-[120px]" />
      <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-red-500/10 blur-[120px]" />
      <div className="absolute top-1/2 left-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0d3b5e]/40 blur-[100px]" />
    </div>
    {/* Grid overlay */}
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.07]"
      style={{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
      }}
    />
    {/* Vignette */}
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.6)_100%)]" />
    {/* Noise (subtle film grain) */}
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.03] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
      }}
    />
  </>
);

const FORENSIC_3D_STYLES = `
@keyframes fx-orbit-a { 0% { transform: translate3d(0,0,0) rotateX(0deg) rotateY(0deg); } 50% { transform: translate3d(20px,-30px,60px) rotateX(20deg) rotateY(180deg); } 100% { transform: translate3d(0,0,0) rotateX(0deg) rotateY(360deg); } }
@keyframes fx-orbit-b { 0% { transform: translate3d(0,0,0) rotateX(0deg) rotateY(0deg) rotateZ(0deg); } 50% { transform: translate3d(-15px,20px,40px) rotateX(-25deg) rotateY(180deg) rotateZ(15deg); } 100% { transform: translate3d(0,0,0) rotateX(0deg) rotateY(360deg) rotateZ(0deg); } }
@keyframes fx-tumble { 0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); } 100% { transform: rotateX(360deg) rotateY(360deg) rotateZ(180deg); } }
@keyframes fx-spin-y { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
@keyframes fx-spin-x { from { transform: rotateX(0deg); } to { transform: rotateX(360deg); } }
@keyframes fx-spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes fx-bob { 0%,100% { transform: translateY(0) translateZ(0); } 50% { transform: translateY(-20px) translateZ(30px); } }
@keyframes fx-scan { 0% { transform: translateY(-50%); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(50%); opacity: 0; } }
@keyframes fx-trace { 0% { stroke-dashoffset: 1; } 60% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 0; opacity: 0.6; } }
@keyframes fx-helix-a { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
@keyframes fx-helix-tilt { 0%,100% { transform: rotateZ(-6deg) rotateX(8deg); } 50% { transform: rotateZ(6deg) rotateX(-8deg); } }
@keyframes fx-particle { 0% { transform: translateY(0) translateX(0); opacity: 0; } 10% { opacity: 0.8; } 90% { opacity: 0.6; } 100% { transform: translateY(-100vh) translateX(var(--drift, 20px)); opacity: 0; } }
@keyframes fx-radar { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes fx-blink { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
@keyframes fx-flicker { 0%,98%,100% { opacity: 0.6; } 99% { opacity: 0.15; } }
@keyframes fx-typewriter { 0% { width: 0; } 70% { width: 100%; } 100% { width: 100%; } }
.fx-perspective { perspective: 1400px; perspective-origin: 50% 50%; }
.fx-3d { transform-style: preserve-3d; }
.fx-stack { position: absolute; inset: 0; transform-style: preserve-3d; }
`;

const Forensic3DScene: React.FC = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
    <style>{FORENSIC_3D_STYLES}</style>
    <div className="fx-perspective absolute inset-0">
      {/* Fingerprint — volumetric tumbling slab */}
      <Volumetric3D
        style={{ top: '12%', left: '8%', width: 220, height: 220, opacity: 0.4 }}
        spinAnimation="fx-orbit-a 16s linear infinite"
        layers={6}
        depth={6}
        glow="rgba(100,149,237,0.4)"
        render={(layerOpacity) => (
          <svg viewBox="0 0 200 200" className="h-full w-full">
            <g fill="none" stroke="#6495ED" strokeWidth="1.6" strokeLinecap="round" opacity={layerOpacity}>
              {[
                'M100 30 C 60 30 35 60 35 100 C 35 140 60 170 100 170',
                'M100 45 C 70 45 50 70 50 100 C 50 130 70 155 100 155',
                'M100 60 C 80 60 65 80 65 100 C 65 120 80 140 100 140',
                'M100 75 C 88 75 80 88 80 100 C 80 112 88 125 100 125',
                'M100 90 C 95 90 92 95 92 100 C 92 105 95 110 100 110',
                'M100 30 C 140 30 165 60 165 100 C 165 140 140 170 100 170',
                'M100 45 C 130 45 150 70 150 100 C 150 130 130 155 100 155',
                'M100 60 C 120 60 135 80 135 100 C 135 120 120 140 100 140',
              ].map((d, i) => (
                <path key={i} d={d} pathLength={1} strokeDasharray="1"
                  style={{ animation: `fx-trace 5s ease-out ${i * 0.18}s infinite` }} />
              ))}
            </g>
          </svg>
        )}
      />

      {/* Police badge / star — actual 3D star (front + back + side strip) */}
      <div
        className="fx-3d absolute"
        style={{
          top: '10%',
          right: '8%',
          width: 180,
          height: 180,
          animation: 'fx-bob 6s ease-in-out infinite',
          filter: 'drop-shadow(0 14px 30px rgba(255,210,122,0.35))',
        }}
      >
        <Star3D />
      </div>

      {/* Magnifying glass — handle + lens with depth */}
      <div
        className="fx-3d absolute"
        style={{
          bottom: '18%',
          left: '6%',
          width: 200,
          height: 200,
          animation: 'fx-orbit-b 14s ease-in-out infinite',
          filter: 'drop-shadow(0 10px 24px rgba(100,149,237,0.4))',
        }}
      >
        <Magnifier3D />
      </div>

      {/* DNA helix — true 3D rungs on translateZ */}
      <div
        className="fx-3d absolute"
        style={{
          bottom: '12%',
          right: '7%',
          width: 140,
          height: 280,
          animation: 'fx-helix-tilt 8s ease-in-out infinite',
        }}
      >
        <DNA3D />
      </div>

      {/* Crosshair / target reticle, behind card */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: 520, height: 520, opacity: 0.18 }}
      >
        <div className="absolute inset-0" style={{ animation: 'fx-spin-slow 60s linear infinite' }}>
          <svg viewBox="0 0 200 200" className="h-full w-full">
            <g fill="none" stroke="#6495ED" strokeWidth="0.4">
              <circle cx="100" cy="100" r="95" strokeDasharray="2 4" />
              <circle cx="100" cy="100" r="78" />
              <circle cx="100" cy="100" r="60" strokeDasharray="1 3" />
              <circle cx="100" cy="100" r="40" />
            </g>
            <g stroke="#6495ED" strokeWidth="0.5" opacity="0.6">
              <line x1="100" y1="0" x2="100" y2="20" />
              <line x1="100" y1="180" x2="100" y2="200" />
              <line x1="0" y1="100" x2="20" y2="100" />
              <line x1="180" y1="100" x2="200" y2="100" />
            </g>
            {/* tick marks every 30deg */}
            {Array.from({ length: 12 }).map((_, i) => (
              <line
                key={i}
                x1="100"
                y1="5"
                x2="100"
                y2="12"
                stroke="#6495ED"
                strokeWidth="0.6"
                transform={`rotate(${i * 30} 100 100)`}
              />
            ))}
          </svg>
        </div>
        {/* counter-rotating inner ring */}
        <div className="absolute inset-10" style={{ animation: 'fx-spin-slow 40s linear infinite reverse' }}>
          <svg viewBox="0 0 200 200" className="h-full w-full">
            <circle
              cx="100"
              cy="100"
              r="90"
              fill="none"
              stroke="#ff6b6b"
              strokeWidth="0.4"
              strokeDasharray="6 8"
              opacity="0.7"
            />
          </svg>
        </div>
      </div>

      {/* Evidence tag floating chip */}
      <div
        className="fx-3d absolute"
        style={{
          top: '60%',
          right: '14%',
          opacity: 0.5,
          animation: 'fx-float-c 7s ease-in-out infinite',
          transform: 'rotate(-6deg)',
        }}
      >
        <div className="rounded-md border border-yellow-400/40 bg-yellow-400/10 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-yellow-300/80 backdrop-blur-sm">
          EVIDENCE • CHAIN OF CUSTODY
        </div>
      </div>

      {/* Case file chip */}
      <div
        className="fx-3d absolute"
        style={{
          top: '30%',
          left: '14%',
          opacity: 0.5,
          animation: 'fx-float-c 8.5s ease-in-out infinite',
          transform: 'rotate(4deg)',
        }}
      >
        <div className="rounded-md border border-[#6495ED]/40 bg-[#6495ED]/10 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[#9bb8ee] backdrop-blur-sm">
          CASE #2026-05-FX • CLASSIFIED
        </div>
      </div>
    </div>
  </div>
);

// Generic volumetric wrapper: stacks N copies of `render` at increasing translateZ
// inside a preserve-3d parent that's rotating, producing real depth parallax.
const Volumetric3D: React.FC<{
  style: React.CSSProperties;
  spinAnimation: string;
  layers: number;
  depth: number;
  glow: string;
  render: (layerOpacity: number) => React.ReactNode;
}> = ({ style, spinAnimation, layers, depth, glow, render }) => (
  <div className="fx-3d absolute" style={{ ...style, filter: `drop-shadow(0 10px 30px ${glow})` }}>
    <div className="fx-3d h-full w-full" style={{ animation: spinAnimation }}>
      {Array.from({ length: layers }).map((_, i) => {
        const z = (i - layers / 2) * depth;
        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{ transform: `translateZ(${z}px)` }}
          >
            {render(0.5 + (i / layers) * 0.5)}
          </div>
        );
      })}
    </div>
  </div>
);

// 3D police star: front face + back face + extruded side stack
const Star3D: React.FC = () => {
  const STAR_POINTS = '0,-65 16,-20 63,-20 25,8 39,53 0,26 -39,53 -25,8 -63,-20 -16,-20';
  const SIDE_LAYERS = 14;
  return (
    <div
      className="fx-3d h-full w-full"
      style={{ animation: 'fx-spin-y 9s linear infinite', transformStyle: 'preserve-3d' }}
    >
      {/* extruded side layers */}
      {Array.from({ length: SIDE_LAYERS }).map((_, i) => {
        const z = (i - SIDE_LAYERS / 2) * 1.6;
        const shade = 0.55 + (i / SIDE_LAYERS) * 0.45;
        return (
          <svg
            key={i}
            viewBox="-90 -90 180 180"
            className="absolute inset-0 h-full w-full"
            style={{ transform: `translateZ(${z}px)` }}
          >
            <polygon
              points={STAR_POINTS}
              fill={`rgba(184,134,11,${shade * 0.9})`}
              stroke={`rgba(255,215,140,${shade})`}
              strokeWidth="0.8"
            />
          </svg>
        );
      })}
      {/* front face (gold + red medallion) */}
      <svg
        viewBox="-90 -90 180 180"
        className="absolute inset-0 h-full w-full"
        style={{ transform: 'translateZ(14px)' }}
      >
        <defs>
          <linearGradient id="starGold3D" x1="0" y1="-1" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFE9A8" />
            <stop offset="50%" stopColor="#FFD27A" />
            <stop offset="100%" stopColor="#B8860B" />
          </linearGradient>
          <radialGradient id="medallion" cx="40%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#ff8a8a" />
            <stop offset="100%" stopColor="#7a1414" />
          </radialGradient>
        </defs>
        <polygon points={STAR_POINTS} fill="url(#starGold3D)" stroke="#fff8dc" strokeWidth="1.2" />
        <circle r="22" fill="url(#medallion)" stroke="#FFD27A" strokeWidth="1.5" />
        <text y="5" textAnchor="middle" fontSize="13" fontWeight="800" fill="#FFE9A8" fontFamily="serif">
          RMPG
        </text>
      </svg>
      {/* back face (darker, mirrored) */}
      <svg
        viewBox="-90 -90 180 180"
        className="absolute inset-0 h-full w-full"
        style={{ transform: 'translateZ(-14px) rotateY(180deg)' }}
      >
        <polygon points={STAR_POINTS} fill="#8a6612" stroke="#5a4408" strokeWidth="1" />
        <circle r="22" fill="#3a0a0a" stroke="#8a6612" strokeWidth="1" />
      </svg>
    </div>
  );
};

// 3D magnifying glass: lens with extruded rim + handle
const Magnifier3D: React.FC = () => {
  const RIM_LAYERS = 10;
  return (
    <div
      className="fx-3d h-full w-full"
      style={{ animation: 'fx-spin-y 12s linear infinite' }}
    >
      <div className="fx-3d absolute inset-0">
        {/* extruded rim */}
        {Array.from({ length: RIM_LAYERS }).map((_, i) => {
          const z = (i - RIM_LAYERS / 2) * 2;
          return (
            <svg
              key={i}
              viewBox="0 0 200 200"
              className="absolute inset-0 h-full w-full"
              style={{ transform: `translateZ(${z}px)` }}
            >
              <circle cx="80" cy="80" r="55" fill="none" stroke="#6495ED" strokeWidth="3" opacity={0.4 + (i / RIM_LAYERS) * 0.5} />
              {/* handle as series of stacked rounded rects */}
              <line x1="120" y1="120" x2="170" y2="170" stroke="#3a5a8a" strokeWidth="9" strokeLinecap="round" opacity={0.5 + (i / RIM_LAYERS) * 0.4} />
            </svg>
          );
        })}
        {/* lens face (front) */}
        <svg
          viewBox="0 0 200 200"
          className="absolute inset-0 h-full w-full"
          style={{ transform: 'translateZ(11px)' }}
        >
          <defs>
            <radialGradient id="lens3d" cx="40%" cy="40%" r="60%">
              <stop offset="0%" stopColor="rgba(180,210,255,0.6)" />
              <stop offset="60%" stopColor="rgba(100,149,237,0.25)" />
              <stop offset="100%" stopColor="rgba(100,149,237,0.05)" />
            </radialGradient>
          </defs>
          <circle cx="80" cy="80" r="55" fill="url(#lens3d)" stroke="#9bb8ee" strokeWidth="2" />
          <circle cx="80" cy="80" r="55" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
          <g stroke="#6495ED" strokeWidth="0.8" opacity="0.7">
            <line x1="35" y1="80" x2="125" y2="80" />
            <line x1="80" y1="35" x2="80" y2="125" />
            <circle cx="80" cy="80" r="20" fill="none" />
          </g>
          {/* handle highlight */}
          <line x1="120" y1="120" x2="170" y2="170" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        </svg>
      </div>
    </div>
  );
};

// True 3D DNA: rungs are positioned in 3D space using translateZ + rotateY
const DNA3D: React.FC = () => {
  const RUNGS = 14;
  const RADIUS = 36;
  return (
    <div
      className="fx-3d absolute inset-0"
      style={{ animation: 'fx-helix-a 7s linear infinite', transformStyle: 'preserve-3d' }}
    >
      {Array.from({ length: RUNGS }).map((_, i) => {
        const t = i / (RUNGS - 1);
        const y = -130 + t * 260;
        const angle = t * 540; // 1.5 turns
        return (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 fx-3d"
            style={{
              transform: `translate(-50%, -50%) translateY(${y}px) rotateY(${angle}deg)`,
              width: RADIUS * 2,
              height: 4,
            }}
          >
            {/* rung bar */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `linear-gradient(90deg, #6495ED 0%, ${i % 2 ? '#ff6b6b' : '#9bb8ee'} 50%, #6495ED 100%)`,
                boxShadow: '0 0 8px rgba(100,149,237,0.5)',
                opacity: 0.85,
              }}
            />
            {/* end caps as spheres */}
            <div
              className="absolute h-3 w-3 -translate-y-1/2 rounded-full"
              style={{ left: -6, top: '50%', background: '#6495ED', boxShadow: '0 0 10px #6495ED' }}
            />
            <div
              className="absolute h-3 w-3 -translate-y-1/2 rounded-full"
              style={{ right: -6, top: '50%', background: i % 2 ? '#ff6b6b' : '#6495ED', boxShadow: `0 0 10px ${i % 2 ? '#ff6b6b' : '#6495ED'}` }}
            />
          </div>
        );
      })}
    </div>
  );
};


const HudOverlay: React.FC = () => {
  const particles = Array.from({ length: 28 });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Corner HUD brackets */}
      {[
        { top: 12, left: 12, rotate: 0 },
        { top: 12, right: 12, rotate: 90 },
        { bottom: 12, right: 12, rotate: 180 },
        { bottom: 12, left: 12, rotate: 270 },
      ].map((pos, i) => (
        <svg
          key={i}
          viewBox="0 0 40 40"
          width={36}
          height={36}
          className="absolute opacity-40"
          style={{ ...pos, transform: `rotate(${pos.rotate}deg)` } as React.CSSProperties}
        >
          <path d="M2 14 L2 2 L14 2" fill="none" stroke="#6495ED" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="2" cy="2" r="1.5" fill="#6495ED" />
        </svg>
      ))}

      {/* Side telemetry rail (left) */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 opacity-40">
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            className="h-[1px] bg-[#6495ED]"
            style={{
              width: i % 4 === 0 ? 18 : 10,
              animation: `fx-blink 2s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Side telemetry rail (right) with hex codes */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 opacity-40 font-mono text-[8px] text-[#6495ED]">
        {["0xA1F4","0x9C2E","0x4D70","0xFE03","0x21B8","0x6495","0xED00","0x1A2B","0xC0DE"].map((hex, i) => (
          <span key={i} style={{ animation: `fx-blink 3s ease-in-out ${i * 0.2}s infinite` }}>{hex}</span>
        ))}
      </div>

      {/* Top status strip */}
      <div className="absolute left-1/2 top-3 -translate-x-1/2 flex items-center gap-3 font-mono text-[9px] uppercase tracking-widest text-[#6495ED]/60">
        <span style={{ animation: "fx-blink 1.5s ease-in-out infinite" }}>● REC</span>
        <span className="text-gray-600">|</span>
        <span>SYS: ONLINE</span>
        <span className="text-gray-600">|</span>
        <span>ENC: AES-256</span>
        <span className="text-gray-600">|</span>
        <span style={{ animation: "fx-flicker 4s linear infinite" }}>FORENSIC LINK</span>
      </div>

      {/* Floating particles */}
      <div className="absolute inset-0">
        {particles.map((_, i) => {
          const left = (i * 37) % 100;
          const size = 1 + (i % 3);
          const dur = 8 + (i % 7);
          const delay = (i * 0.4) % 6;
          const drift = ((i % 5) - 2) * 30;
          const color = i % 6 === 0 ? "#ff6b6b" : "#6495ED";
          return (
            <div
              key={i}
              className="absolute bottom-0 rounded-full"
              style={{
                left: `${left}%`,
                width: size,
                height: size,
                background: color,
                boxShadow: `0 0 ${size * 4}px ${color}`,
                animation: `fx-particle ${dur}s linear ${delay}s infinite`,
                ["--drift" as any]: `${drift}px`,
              } as React.CSSProperties}
            />
          );
        })}
      </div>

      {/* Radar sweep behind reticle */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-30"
        style={{ width: 520, height: 520, animation: "fx-radar 6s linear infinite" }}
      >
        <div
          className="absolute left-1/2 top-1/2 origin-left h-[2px] w-1/2"
          style={{
            background: "linear-gradient(90deg, transparent, #6495ED 80%, #fff)",
            boxShadow: "0 0 12px #6495ED",
            transform: "translateY(-1px)",
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 origin-left h-[120px] w-1/2 -translate-y-1/2"
          style={{
            background: "conic-gradient(from 0deg at 0% 50%, rgba(100,149,237,0.25), transparent 30%)",
          }}
        />
      </div>
    </div>
  );
};

