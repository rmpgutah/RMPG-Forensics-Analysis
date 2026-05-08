import React from 'react';
import { Sliders, Sun, Moon, Trash2, Hash, ScrollText, Smartphone, Clock } from 'lucide-react';
import { PageHeader, FolderPicker } from '../components/common';
import { useSettingsStore } from '../store/settings-store';
import { useRecentPathsStore } from '../store/recent-paths-store';

/**
 * Preferences — surfaces the persisted `useSettingsStore.preferences`
 * fields that previously had no UI to set them. This isn't a kitchen-sink
 * settings page; it's the small set of cross-cutting choices that affect
 * many feature pages at once:
 *
 * - Theme (already wired through AppLayout's toggle, exposed here for
 *   discoverability)
 * - Default output folder (auto-fills any FolderPicker with role="output"
 *   when the user hasn't picked one yet — saves a Browse trip per page)
 * - Auto-detect / poll interval (controls the device status hook's
 *   frequency)
 * - Default hash algorithm (used by Hash Generator's "verify" tab and
 *   any handler that takes a hashAlgorithm param)
 * - Log level (filters renderer-side LogConsole noise)
 *
 * Plus a maintenance section to clear recent-paths history per bucket —
 * useful when a stale path keeps appearing in dropdowns after a folder
 * was renamed or deleted.
 */
export const Preferences: React.FC = () => {
  const prefs = useSettingsStore((s) => s.preferences);
  const setPreference = useSettingsStore((s) => s.setPreference);

  const buckets = useRecentPathsStore((s) => Object.keys(s.byBucket));
  const clearRecents = useRecentPathsStore((s) => s.clear);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preferences"
        description="Cross-cutting settings that affect many pages: defaults, theme, polling, log verbosity."
        icon={<Sliders size={24} />}
      />

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          {prefs.theme === 'light' ? <Sun size={14} /> : <Moon size={14} />}
          Appearance
        </h3>
        <div className="flex items-center gap-2">
          {(['dark', 'light'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setPreference('theme', t)}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                prefs.theme === t
                  ? 'border-[#6495ED] bg-[#6495ED]/10 text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {t === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
              {t === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <ScrollText size={14} /> Default output folder
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          When set, every page that asks for an output / report folder pre-fills with this path
          (you can still pick a different folder per case). Useful for examiners who keep all artefacts under one root.
        </p>
        {/*
          NB: this picker has role="generic" deliberately — using role="output"
          here would create a feedback loop where the Preferences picker
          auto-fills itself from… itself.
        */}
        <FolderPicker
          role="generic"
          label=""
          value={prefs.defaultOutputDir}
          onChange={(v) => setPreference('defaultOutputDir', v)}
          hint="Leave empty to disable auto-fill."
        />
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Smartphone size={14} /> Device polling
        </h3>
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={prefs.autoDetectDevices}
            onChange={(e) => setPreference('autoDetectDevices', e.target.checked)}
          />
          Auto-detect connected devices
        </label>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--text-secondary)]">Poll interval (ms):</span>
          <input
            type="number"
            min={500}
            step={500}
            value={prefs.devicePollInterval}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v >= 500) setPreference('devicePollInterval', v);
            }}
            className="input-field w-32 text-sm"
            disabled={!prefs.autoDetectDevices}
          />
          <span className="text-xs text-[var(--text-muted)]">
            {prefs.autoDetectDevices ? `≈ ${(prefs.devicePollInterval / 1000).toFixed(1)}s` : 'disabled'}
          </span>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Hash size={14} /> Default hash algorithm
        </h3>
        <div className="flex flex-wrap gap-2">
          {(['md5', 'sha1', 'sha256'] as const).map((alg) => (
            <button
              key={alg}
              onClick={() => setPreference('hashAlgorithm', alg)}
              className={`rounded-md border px-3 py-1.5 text-xs font-mono uppercase ${
                prefs.hashAlgorithm === alg
                  ? 'border-[#6495ED] bg-[#6495ED]/10 text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {alg}
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <ScrollText size={14} /> Log verbosity
        </h3>
        <select
          value={prefs.logLevel}
          onChange={(e) => setPreference('logLevel', e.target.value as 'info' | 'debug' | 'warning' | 'error')}
          className="input-field text-sm w-48"
        >
          <option value="error">Errors only</option>
          <option value="warning">Warnings + errors</option>
          <option value="info">Info (default)</option>
          <option value="debug">Debug (verbose)</option>
        </select>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Clock size={14} /> Recent-paths history
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          Each picker remembers up to 5 recent paths, bucketed by purpose (output / source / backup / etc.).
          Clear individual buckets here when entries become stale.
        </p>
        {buckets.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] italic">No recent paths recorded yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {buckets.map((b) => (
              <button
                key={b}
                onClick={() => clearRecents(b)}
                className="inline-flex items-center gap-1 rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/40"
                title={`Clear "${b}" history`}
              >
                <Trash2 size={11} />
                {b}
              </button>
            ))}
            <button
              onClick={() => clearRecents()}
              className="inline-flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-red-400 hover:bg-red-500/15"
            >
              <Trash2 size={11} />
              Clear all
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
