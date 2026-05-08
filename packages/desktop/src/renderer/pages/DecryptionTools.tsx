import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  Lock,
  Unlock,
  Smartphone,
  Archive,
  Hash,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  PlayCircle,
  StopCircle,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FilePicker, FolderPicker } from '../components/common';

/**
 * DecryptionTools — local-evidence decryption + offline password recovery.
 *
 * Four tabs:
 *   - iOS Backup    (single try + dictionary attack against an encrypted backup folder)
 *   - Android Pattern (gesture.key SHA-1 → reversed pattern via full pattern-space search)
 *   - Android PIN   (legacy password.key SHA-1+SHA-256 → reversed PIN via 10^N brute)
 *   - Encrypted ZIP (single try + dictionary attack via system unzip)
 *
 * All operations run against files already on the examiner's disk — the
 * page heading carries an authorisation reminder. No remote attacks.
 */

type Tab = 'ios-backup' | 'android-pattern' | 'android-pin' | 'zip' | 'brute' | 'live-android';

export const DecryptionTools: React.FC = () => {
  const [tab, setTab] = useState<Tab>('ios-backup');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decryption & Password Recovery"
        description="Offline decryption of evidence under your authorisation — local files only."
        icon={<KeyRound size={24} />}
      />

      <div className="card flex items-start gap-2 border-yellow-500/40 bg-yellow-500/10">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-yellow-400" />
        <p className="text-xs text-yellow-200 leading-relaxed">
          <strong>Authorised use only.</strong> These tools operate on local files (acquired backups, forensic
          copies). They do not attempt online attacks. By using them you confirm you have lawful authority to
          examine the target evidence.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { key: 'ios-backup',     label: 'iOS Backup',     Icon: Smartphone },
          { key: 'android-pattern',label: 'Android Pattern', Icon: Hash },
          { key: 'android-pin',    label: 'Android PIN',    Icon: Lock },
          { key: 'zip',            label: 'Encrypted ZIP',  Icon: Archive },
          { key: 'brute',          label: 'Brute Force',    Icon: KeyRound },
          { key: 'live-android',   label: 'Live Android',   Icon: Smartphone },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-[#6495ED] bg-[#6495ED]/15 text-[var(--text-primary)]'
                : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'ios-backup'      && <IosBackupPanel />}
      {tab === 'android-pattern' && <AndroidPatternPanel />}
      {tab === 'android-pin'     && <AndroidPinPanel />}
      {tab === 'zip'             && <ZipPanel />}
      {tab === 'brute'           && <BruteForcePanel />}
      {tab === 'live-android'    && <LiveAndroidPanel />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const ResultBadge: React.FC<{
  state: 'idle' | 'running' | 'success' | 'failure';
  message?: string;
  recovered?: string;
}> = ({ state, message, recovered }) => {
  if (state === 'idle') return null;
  if (state === 'running') {
    return (
      <div className="rounded border border-blue-500/40 bg-blue-500/10 p-2 text-xs text-blue-300 inline-flex items-center gap-2">
        <Loader2 size={13} className="animate-spin" /> {message ?? 'Working…'}
      </div>
    );
  }
  if (state === 'success') {
    return (
      <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-300 flex items-center gap-2">
        <CheckCircle2 size={14} />
        <span className="flex-1">
          {message ?? 'Recovered'}
          {recovered && (
            <>
              {' '}— <code className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono">{recovered}</code>
            </>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300 flex items-center gap-2">
      <AlertCircle size={14} />
      <span>{message ?? 'No match found.'}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// iOS Backup panel
// ---------------------------------------------------------------------------

const IosBackupPanel: React.FC = () => {
  const [backupDir, setBackupDir] = useState('');
  const [password, setPassword] = useState('');
  const [wordlist, setWordlist] = useState('');
  const [maxAttempts, setMaxAttempts] = useState('0');
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'failure'>('idle');
  const [message, setMessage] = useState<string>();
  const [recovered, setRecovered] = useState<string | undefined>();
  const [progress, setProgress] = useState<{ attempted: number; total?: number; current: string } | null>(null);

  // Subscribe to streaming progress for the dict attack only while running.
  useEffect(() => {
    if (state !== 'running') return;
    const unsub = window.api.on(IPC_CHANNELS.DECRYPT_IOS_BACKUP_DICT_PROGRESS, (...args: unknown[]) => {
      setProgress(args[0] as typeof progress);
    });
    return () => unsub?.();
  }, [state]);

  const handleTry = async (): Promise<void> => {
    if (!backupDir) return;
    setState('running'); setMessage('Verifying password against backup…'); setRecovered(undefined);
    try {
      const r = (await window.api.invoke(IPC_CHANNELS.DECRYPT_IOS_BACKUP_TRY, { backupDir, password })) as { success: boolean; message?: string };
      if (r.success) { setState('success'); setMessage(r.message); setRecovered(password); }
      else { setState('failure'); setMessage(r.message); }
    } catch (err) { setState('failure'); setMessage(err instanceof Error ? err.message : String(err)); }
  };

  const handleDict = async (): Promise<void> => {
    if (!backupDir || !wordlist) return;
    setState('running'); setMessage('Running dictionary attack…'); setRecovered(undefined); setProgress(null);
    try {
      const r = (await window.api.invoke(IPC_CHANNELS.DECRYPT_IOS_BACKUP_DICT, {
        backupDir,
        wordlistPath: wordlist,
        maxAttempts: parseInt(maxAttempts, 10) || 0,
      })) as { success: boolean; password?: string; attempted: number; total?: number; durationMs: number; message?: string };
      if (r.success) {
        setState('success');
        setMessage(`Recovered after ${r.attempted}/${r.total ?? '?'} attempts in ${(r.durationMs / 1000).toFixed(1)}s`);
        setRecovered(r.password);
      } else {
        setState('failure');
        setMessage(`${r.message ?? 'Wordlist exhausted.'} (${r.attempted} attempts in ${(r.durationMs / 1000).toFixed(1)}s)`);
      }
    } catch (err) { setState('failure'); setMessage(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">iOS Encrypted Backup</h3>
      <FolderPicker
        role="backup"
        label="Backup folder"
        value={backupDir}
        onChange={setBackupDir}
        hint="The UDID-named folder containing Manifest.plist + Manifest.db."
      />

      <div className="space-y-2">
        <label className="block text-xs font-medium text-[var(--text-secondary)]">Single password attempt</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Backup password"
            className="input-field flex-1 text-sm"
            disabled={state === 'running'}
          />
          <button
            onClick={handleTry}
            disabled={state === 'running' || !backupDir}
            className="btn-primary inline-flex items-center gap-1.5 text-sm"
          >
            <Unlock size={14} /> Try
          </button>
        </div>
      </div>

      <div className="space-y-2 border-t border-[var(--border-color)] pt-4">
        <label className="block text-xs font-medium text-[var(--text-secondary)]">Dictionary attack</label>
        <FilePicker
          label=""
          value={wordlist}
          onChange={setWordlist}
          filters={[{ name: 'Wordlist', extensions: ['txt', 'lst', 'dic'] }]}
          hint="UTF-8 newline-delimited candidate file."
          bucket="wordlist"
        />
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          Cap (0 = full wordlist):
          <input
            type="number"
            min={0}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(e.target.value)}
            className="input-field w-32 text-xs"
            disabled={state === 'running'}
          />
        </div>
        <button
          onClick={handleDict}
          disabled={state === 'running' || !backupDir || !wordlist}
          className="btn-primary inline-flex items-center gap-1.5 text-sm"
        >
          {state === 'running' ? <StopCircle size={14} /> : <PlayCircle size={14} />}
          {state === 'running' ? 'Attacking…' : 'Run dictionary attack'}
        </button>
      </div>

      {progress && state === 'running' && (
        <div className="text-xs text-[var(--text-muted)] font-mono">
          {progress.attempted}{progress.total ? ` / ${progress.total}` : ''} · trying: <span className="text-[var(--text-secondary)]">{progress.current}</span>
        </div>
      )}
      <ResultBadge state={state} message={message} recovered={recovered} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Android Pattern
// ---------------------------------------------------------------------------

const AndroidPatternPanel: React.FC = () => {
  const [hashHex, setHashHex] = useState('');
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'failure'>('idle');
  const [message, setMessage] = useState<string>();
  const [pattern, setPattern] = useState<number[] | undefined>();

  const handleCrack = async (): Promise<void> => {
    setState('running'); setMessage('Searching pattern space…'); setPattern(undefined);
    try {
      const r = (await window.api.invoke(IPC_CHANNELS.DECRYPT_ANDROID_GESTURE, { hashHex })) as {
        success: boolean; pattern?: number[]; attempted: number; durationMs: number;
      };
      if (r.success && r.pattern) {
        setState('success');
        setPattern(r.pattern);
        setMessage(`Recovered in ${r.attempted.toLocaleString()} attempts (${r.durationMs}ms)`);
      } else {
        setState('failure');
        setMessage(`No match — searched ${r.attempted.toLocaleString()} patterns in ${r.durationMs}ms.`);
      }
    } catch (err) { setState('failure'); setMessage(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Android Lockscreen Pattern</h3>
      <p className="text-xs text-[var(--text-muted)]">
        Enter the SHA-1 hash from <code>/data/system/gesture.key</code> (40 hex chars). Full pattern space
        searches in milliseconds.
      </p>
      <input
        type="text"
        value={hashHex}
        onChange={(e) => setHashHex(e.target.value)}
        placeholder="40-character SHA-1 hex"
        className="input-field w-full text-sm font-mono"
        spellCheck={false}
        disabled={state === 'running'}
      />
      <button
        onClick={handleCrack}
        disabled={state === 'running' || hashHex.length !== 40}
        className="btn-primary inline-flex items-center gap-1.5 text-sm"
      >
        <Unlock size={14} /> Crack pattern
      </button>

      {pattern && (
        <PatternGrid pattern={pattern} />
      )}
      <ResultBadge state={state} message={message} />
    </div>
  );
};

const PatternGrid: React.FC<{ pattern: number[] }> = ({ pattern }) => {
  // Render a 3x3 grid with the dot indices ordered by the pattern.
  return (
    <div className="space-y-2">
      <div className="text-xs text-[var(--text-secondary)] font-mono">
        Pattern sequence: <span className="text-[var(--text-primary)]">{pattern.join(' → ')}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 w-32">
        {Array.from({ length: 9 }).map((_, i) => {
          const order = pattern.indexOf(i);
          const inPattern = order >= 0;
          return (
            <div
              key={i}
              className={`aspect-square rounded-full flex items-center justify-center text-xs font-mono ${
                inPattern
                  ? 'bg-[#6495ED]/30 ring-2 ring-[#6495ED] text-[var(--text-primary)]'
                  : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'
              }`}
            >
              {inPattern ? order + 1 : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Android PIN
// ---------------------------------------------------------------------------

const AndroidPinPanel: React.FC = () => {
  const [hashHex, setHashHex] = useState('');
  const [saltHex, setSaltHex] = useState('');
  const [digits, setDigits] = useState('4');
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'failure'>('idle');
  const [message, setMessage] = useState<string>();
  const [pin, setPin] = useState<string | undefined>();

  const handleCrack = async (): Promise<void> => {
    setState('running'); setMessage(`Brute-forcing ${Math.pow(10, parseInt(digits, 10) || 4).toLocaleString()} candidates…`); setPin(undefined);
    try {
      const r = (await window.api.invoke(IPC_CHANNELS.DECRYPT_ANDROID_PIN, {
        hashHex,
        saltHex,
        digits: parseInt(digits, 10) || 4,
      })) as { success: boolean; pin?: string; attempted: number; durationMs: number };
      if (r.success && r.pin) {
        setState('success');
        setPin(r.pin);
        setMessage(`Recovered in ${r.attempted} attempts (${r.durationMs}ms)`);
      } else {
        setState('failure');
        setMessage(`No match — exhausted ${r.attempted.toLocaleString()} candidates.`);
      }
    } catch (err) { setState('failure'); setMessage(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Android Lockscreen PIN (legacy)</h3>
      <p className="text-xs text-[var(--text-muted)]">
        Legacy <code>password.key</code> = SHA-1 + SHA-256 of (salt + pin). Salt comes from
        <code> locksettings.db</code> → <code>lockscreen.password_salt</code>.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={hashHex}
          onChange={(e) => setHashHex(e.target.value)}
          placeholder="Stored hash (hex)"
          className="input-field text-sm font-mono"
          spellCheck={false}
          disabled={state === 'running'}
        />
        <input
          type="text"
          value={saltHex}
          onChange={(e) => setSaltHex(e.target.value)}
          placeholder="Salt (hex, lowercase)"
          className="input-field text-sm font-mono"
          spellCheck={false}
          disabled={state === 'running'}
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        Digits:
        <input
          type="number"
          min={1}
          max={8}
          value={digits}
          onChange={(e) => setDigits(e.target.value)}
          className="input-field w-20 text-xs"
          disabled={state === 'running'}
        />
        <span>(10^{digits || '4'} = {Math.pow(10, parseInt(digits, 10) || 4).toLocaleString()} candidates)</span>
      </div>
      <button
        onClick={handleCrack}
        disabled={state === 'running' || !hashHex || !saltHex}
        className="btn-primary inline-flex items-center gap-1.5 text-sm"
      >
        <Unlock size={14} /> Crack PIN
      </button>
      <ResultBadge state={state} message={message} recovered={pin} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const ZipPanel: React.FC = () => {
  const [zipPath, setZipPath] = useState('');
  const [password, setPassword] = useState('');
  const [wordlist, setWordlist] = useState('');
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'failure'>('idle');
  const [message, setMessage] = useState<string>();
  const [recovered, setRecovered] = useState<string | undefined>();
  const [progress, setProgress] = useState<{ attempted: number; total?: number; current: string } | null>(null);

  useEffect(() => {
    if (state !== 'running') return;
    const unsub = window.api.on(IPC_CHANNELS.DECRYPT_ZIP_DICT_PROGRESS, (...args: unknown[]) => {
      setProgress(args[0] as typeof progress);
    });
    return () => unsub?.();
  }, [state]);

  const handleTry = async (): Promise<void> => {
    setState('running'); setMessage('Testing password against archive…'); setRecovered(undefined);
    try {
      const r = (await window.api.invoke(IPC_CHANNELS.DECRYPT_ZIP_TRY, { zipPath, password })) as { success: boolean; message?: string };
      if (r.success) { setState('success'); setMessage(r.message); setRecovered(password); }
      else { setState('failure'); setMessage(r.message); }
    } catch (err) { setState('failure'); setMessage(err instanceof Error ? err.message : String(err)); }
  };

  const handleDict = async (): Promise<void> => {
    setState('running'); setMessage('Running dictionary attack…'); setRecovered(undefined); setProgress(null);
    try {
      const r = (await window.api.invoke(IPC_CHANNELS.DECRYPT_ZIP_DICT, {
        zipPath,
        wordlistPath: wordlist,
      })) as { success: boolean; password?: string; attempted: number; total?: number; durationMs: number; message?: string };
      if (r.success) {
        setState('success');
        setRecovered(r.password);
        setMessage(`Recovered after ${r.attempted} attempts in ${(r.durationMs / 1000).toFixed(1)}s`);
      } else {
        setState('failure');
        setMessage(`${r.message ?? 'Wordlist exhausted.'} (${r.attempted} attempts)`);
      }
    } catch (err) { setState('failure'); setMessage(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Encrypted ZIP Archive</h3>
      <FilePicker
        label="ZIP file"
        value={zipPath}
        onChange={setZipPath}
        filters={[{ name: 'ZIP', extensions: ['zip'] }]}
        bucket="zip"
      />
      <div className="flex gap-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password to try"
          className="input-field flex-1 text-sm"
          disabled={state === 'running'}
        />
        <button onClick={handleTry} disabled={state === 'running' || !zipPath} className="btn-primary inline-flex items-center gap-1.5 text-sm">
          <Unlock size={14} /> Try
        </button>
      </div>
      <div className="border-t border-[var(--border-color)] pt-4 space-y-2">
        <FilePicker
          label="Wordlist for dictionary attack"
          value={wordlist}
          onChange={setWordlist}
          filters={[{ name: 'Wordlist', extensions: ['txt', 'lst', 'dic'] }]}
          bucket="wordlist"
        />
        <button
          onClick={handleDict}
          disabled={state === 'running' || !zipPath || !wordlist}
          className="btn-primary inline-flex items-center gap-1.5 text-sm"
        >
          <PlayCircle size={14} /> Run dictionary attack
        </button>
      </div>
      {progress && state === 'running' && (
        <div className="text-xs text-[var(--text-muted)] font-mono">
          {progress.attempted}{progress.total ? ` / ${progress.total}` : ''} · trying: <span className="text-[var(--text-secondary)]">{progress.current}</span>
        </div>
      )}
      <ResultBadge state={state} message={message} recovered={recovered} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Brute Force panel — incremental charset enumeration up to 12 chars.
// ---------------------------------------------------------------------------

type Charset = 'digits' | 'lower' | 'upper' | 'letters' | 'alphanumeric' | 'printable';

const BruteForcePanel: React.FC = () => {
  const [target, setTarget] = useState<'ios-backup' | 'zip'>('ios-backup');
  const [backupDir, setBackupDir] = useState('');
  const [zipPath, setZipPath] = useState('');
  const [charset, setCharset] = useState<Charset>('digits');
  const [minLen, setMinLen] = useState('1');
  const [maxLen, setMaxLen] = useState('6');
  const [maxAttempts, setMaxAttempts] = useState('0');
  const [estimate, setEstimate] = useState<{ total: number | null; feasibility: string } | null>(null);
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'failure'>('idle');
  const [message, setMessage] = useState<string>();
  const [recovered, setRecovered] = useState<string | undefined>();
  const [progress, setProgress] = useState<{ attempted: number; total: number; current: string } | null>(null);

  // Re-estimate every time the search-space inputs change. Cheap pure
  // compute on the main side — no IO, instant feedback so users can see
  // when they've picked an infeasible target.
  useEffect(() => {
    const min = Math.max(1, parseInt(minLen, 10) || 1);
    const max = Math.max(min, Math.min(12, parseInt(maxLen, 10) || min));
    window.api
      .invoke(IPC_CHANNELS.DECRYPT_BRUTE_FORCE_ESTIMATE, { charset, minLen: min, maxLen: max })
      .then((r) => setEstimate(r as { total: number | null; feasibility: string }))
      .catch(() => setEstimate(null));
  }, [charset, minLen, maxLen]);

  // Streaming progress while the brute force runs.
  useEffect(() => {
    if (state !== 'running') return;
    const unsub = window.api.on(IPC_CHANNELS.DECRYPT_BRUTE_FORCE_PROGRESS, (...args: unknown[]) => {
      setProgress(args[0] as typeof progress);
    });
    return () => unsub?.();
  }, [state]);

  const handleRun = async (): Promise<void> => {
    setState('running');
    setMessage('Running brute force…');
    setRecovered(undefined);
    setProgress(null);
    try {
      const r = (await window.api.invoke(IPC_CHANNELS.DECRYPT_BRUTE_FORCE, {
        target,
        backupDir: target === 'ios-backup' ? backupDir : undefined,
        zipPath: target === 'zip' ? zipPath : undefined,
        charset,
        minLen: parseInt(minLen, 10) || 1,
        maxLen: parseInt(maxLen, 10) || 6,
        maxAttempts: parseInt(maxAttempts, 10) || 0,
      })) as { success: boolean; password?: string; attempted: number; total?: number; durationMs: number; message?: string };
      if (r.success) {
        setState('success');
        setRecovered(r.password);
        setMessage(`Recovered after ${r.attempted.toLocaleString()} candidates in ${(r.durationMs / 1000).toFixed(1)}s`);
      } else {
        setState('failure');
        setMessage(`${r.message ?? 'No match.'} (${r.attempted.toLocaleString()} attempts in ${(r.durationMs / 1000).toFixed(1)}s)`);
      }
    } catch (err) {
      setState('failure');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const feasibilityColor = (f: string): string => ({
    fast: 'text-emerald-300',
    moderate: 'text-amber-300',
    slow: 'text-orange-400',
    infeasible: 'text-red-400',
  }[f] ?? 'text-slate-400');

  const formatTotal = (n: number | null): string => {
    if (n == null) return 'too large to count';
    if (n < 1000) return n.toString();
    if (n < 1e6) return `${(n / 1e3).toFixed(1)}K`;
    if (n < 1e9) return `${(n / 1e6).toFixed(1)}M`;
    if (n < 1e12) return `${(n / 1e9).toFixed(1)}B`;
    if (n < 1e15) return `${(n / 1e12).toFixed(1)}T`;
    return `${n.toExponential(2)}`;
  };

  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Incremental Brute Force</h3>
      <p className="text-xs text-[var(--text-muted)]">
        Enumerate every candidate of length <code>min</code>..<code>max</code> over the chosen charset. Use when
        the password isn't in any wordlist. Practical viability depends on the per-target hash speed —
        Apple PBKDF2 backups are slow (≈100 candidates/sec), ZIP and Android PIN are fast.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Target</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as 'ios-backup' | 'zip')}
            className="input-field w-full text-sm"
            disabled={state === 'running'}
          >
            <option value="ios-backup">iOS Encrypted Backup</option>
            <option value="zip">Encrypted ZIP</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Charset</label>
          <select
            value={charset}
            onChange={(e) => setCharset(e.target.value as Charset)}
            className="input-field w-full text-sm"
            disabled={state === 'running'}
          >
            <option value="digits">Digits (0-9)</option>
            <option value="lower">Lowercase (a-z)</option>
            <option value="upper">Uppercase (A-Z)</option>
            <option value="letters">Letters (a-zA-Z)</option>
            <option value="alphanumeric">Alphanumeric (a-zA-Z0-9)</option>
            <option value="printable">Printable (with symbols)</option>
          </select>
        </div>
      </div>

      {target === 'ios-backup' ? (
        <FolderPicker
          role="backup"
          label="Backup folder"
          value={backupDir}
          onChange={setBackupDir}
          hint="UDID-named folder containing Manifest.plist + Manifest.db."
        />
      ) : (
        <FilePicker
          label="ZIP file"
          value={zipPath}
          onChange={setZipPath}
          filters={[{ name: 'ZIP', extensions: ['zip'] }]}
          bucket="zip"
        />
      )}

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Min length</label>
          <input
            type="number"
            min={1}
            max={12}
            value={minLen}
            onChange={(e) => setMinLen(e.target.value)}
            className="input-field w-full text-sm"
            disabled={state === 'running'}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Max length</label>
          <input
            type="number"
            min={1}
            max={12}
            value={maxLen}
            onChange={(e) => setMaxLen(e.target.value)}
            className="input-field w-full text-sm"
            disabled={state === 'running'}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Max attempts (0=∞)</label>
          <input
            type="number"
            min={0}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(e.target.value)}
            className="input-field w-full text-sm"
            disabled={state === 'running'}
          />
        </div>
      </div>

      {/* Search-space estimate — surfaces feasibility before launch. */}
      {estimate && (
        <div className={`rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 text-xs flex items-center justify-between ${feasibilityColor(estimate.feasibility)}`}>
          <span>
            Search space: <span className="font-mono">{formatTotal(estimate.total)}</span> candidates
          </span>
          <span className="uppercase tracking-wide">{estimate.feasibility}</span>
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={
          state === 'running' ||
          (target === 'ios-backup' && !backupDir) ||
          (target === 'zip' && !zipPath) ||
          estimate?.feasibility === 'infeasible'
        }
        className="btn-primary inline-flex items-center gap-1.5 text-sm"
      >
        {state === 'running' ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
        {state === 'running' ? 'Brute-forcing…' : 'Run brute force'}
      </button>

      {progress && state === 'running' && (
        <div className="text-xs text-[var(--text-muted)] font-mono">
          {progress.attempted.toLocaleString()}
          {progress.total > 0 ? ` / ${progress.total.toLocaleString()}` : ''}
          {' · trying: '}
          <span className="text-[var(--text-secondary)]">{progress.current}</span>
        </div>
      )}
      <ResultBadge state={state} message={message} recovered={recovered} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Live Android — pull /data/system/ lockscreen artefacts via ADB and crack
// them offline. Requires root or recovery-mode access; gracefully surfaces
// "device too locked down" when /data is unreadable.
// ---------------------------------------------------------------------------

const LiveAndroidPanel: React.FC = () => {
  const [serial, setSerial] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'failure'>('idle');
  const [message, setMessage] = useState<string>();
  const [result, setResult] = useState<null | {
    rooted?: boolean;
    pulled: { gestureKey?: string; passwordKey?: string; lockSettingsDb?: string };
    pattern?: { recovered?: number[]; attempted: number; durationMs: number };
    pin?: { recovered?: string; attempted: number; durationMs: number };
    notes: string[];
  }>(null);

  const handleRun = async (): Promise<void> => {
    if (!serial || !outputDir) return;
    setState('running'); setMessage('Pulling /data/system/ artefacts via ADB…'); setResult(null);
    try {
      const r = (await window.api.invoke(IPC_CHANNELS.DECRYPT_LIVE_ANDROID, { serial, outputDir })) as {
        success: boolean;
        message?: string;
        rooted?: boolean;
        pulled?: { gestureKey?: string; passwordKey?: string; lockSettingsDb?: string };
        pattern?: { recovered?: number[]; attempted: number; durationMs: number };
        pin?: { recovered?: string; attempted: number; durationMs: number };
        notes?: string[];
      };
      if (r.success) {
        setState('success');
        setMessage(r.message);
        setResult({
          rooted: r.rooted,
          pulled: r.pulled ?? {},
          pattern: r.pattern,
          pin: r.pin,
          notes: r.notes ?? [],
        });
      } else {
        setState('failure');
        setMessage(r.message ?? 'Could not access device storage.');
      }
    } catch (err) {
      setState('failure'); setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Live Android Lockscreen Crack</h3>
      <div className="rounded border border-orange-500/40 bg-orange-500/10 p-2 text-xs text-orange-300">
        <strong>Requirements:</strong> USB Debugging authorised, AND either root (su available) or
        recovery mode (TWRP) where <code>/data</code> is readable. Stock locked Androids will return
        "Permission denied" — the modern keystore-backed lockscreen is not feasible to crack offline.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Device serial</label>
          <input
            type="text"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            placeholder="ADB serial (e.g. 0123456789ABCDEF)"
            className="input-field w-full text-sm font-mono"
            disabled={state === 'running'}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">&nbsp;</label>
          <button
            onClick={handleRun}
            disabled={state === 'running' || !serial || !outputDir}
            className="btn-primary inline-flex items-center gap-1.5 text-sm w-full justify-center"
          >
            {state === 'running' ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
            {state === 'running' ? 'Pulling…' : 'Pull & crack'}
          </button>
        </div>
      </div>

      <FolderPicker
        role="output"
        label="Output folder for pulled artefacts"
        value={outputDir}
        onChange={setOutputDir}
        hint="gesture.key, password.key, locksettings.db will land here for offline analysis."
      />

      {result && (
        <div className="space-y-3">
          <div className={`rounded border px-3 py-2 text-xs ${result.rooted ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
            {result.rooted ? '✓ Root access detected.' : '⚠ Non-root access — only the world-readable subset of /data/system/ may be available.'}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {(['gestureKey', 'passwordKey', 'lockSettingsDb'] as const).map((k) => (
              <div key={k} className={`rounded border p-2 ${result.pulled[k] ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-muted)]'}`}>
                <div className="font-mono">{k}</div>
                <div className="truncate text-[10px]" title={result.pulled[k] ?? ''}>{result.pulled[k] ?? 'not pulled'}</div>
              </div>
            ))}
          </div>
          {result.pattern && (
            <div className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-xs">
              <div className="text-[var(--text-secondary)] font-medium mb-1">Pattern</div>
              {result.pattern.recovered ? (
                <PatternGrid pattern={result.pattern.recovered} />
              ) : (
                <span className="text-[var(--text-muted)]">No match — pattern uses an unusual length or device uses keystore-backed auth.</span>
              )}
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                {result.pattern.attempted.toLocaleString()} candidates · {result.pattern.durationMs}ms
              </div>
            </div>
          )}
          {result.pin && (
            <div className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-xs">
              <div className="text-[var(--text-secondary)] font-medium mb-1">PIN</div>
              {result.pin.recovered ? (
                <code className="rounded bg-emerald-500/20 px-2 py-1 font-mono text-emerald-300">{result.pin.recovered}</code>
              ) : (
                <span className="text-[var(--text-muted)]">No match in 4-8 digit PIN space.</span>
              )}
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                {result.pin.attempted.toLocaleString()} candidates · {result.pin.durationMs}ms
              </div>
            </div>
          )}
          {result.notes.length > 0 && (
            <ul className="text-[11px] text-[var(--text-muted)] list-disc ml-4">
              {result.notes.map((n, i) => (<li key={i}>{n}</li>))}
            </ul>
          )}
        </div>
      )}
      <ResultBadge state={state} message={message} />
    </div>
  );
};
