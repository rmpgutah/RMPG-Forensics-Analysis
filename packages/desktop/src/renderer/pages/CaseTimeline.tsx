import React, { useMemo, useState } from 'react';
import {
  History,
  CheckCircle2,
  XCircle,
  Loader2,
  HardDrive,
  Search,
  Hash,
  FolderOpen,
  Filter,
  Clock,
  FileText,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FolderPicker } from '../components/common';
import { useCaseStore } from '../store';
import type { Acquisition } from '../store/case-store';

/**
 * CaseTimeline — chronological view of every acquisition the active case
 * has accumulated. Reads `useCaseStore.acquisitions[]` directly, so any
 * page that calls `addAcquisition()` automatically lights up here without
 * extra plumbing.
 *
 * Why a single-column timeline (vs a table): forensic acquisitions are
 * read in time-order ("what happened to this device when?"), not by sorting
 * arbitrary columns. The vertical timeline puts the *story* first; sort
 * + filter chips above let users narrow down to a single type or status.
 *
 * Status colour key matches the rest of the app:
 *   completed  → emerald
 *   in-progress → amber + spinner
 *   failed     → red
 */

type StatusFilter = 'all' | Acquisition['status'];
type TypeFilter = 'all' | string;
type SortOrder = 'newest' | 'oldest';

export const CaseTimeline: React.FC = () => {
  const { caseName, casePath, examiner, caseNumber, acquisitions } = useCaseStore();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [search, setSearch] = useState('');

  // Distinct acquisition types seen in this case — drives the type filter
  // dropdown so the user only sees options that actually have entries
  // (no empty "filter to ABD Backup" option in a case with only iOS data).
  const types = useMemo(
    () => Array.from(new Set(acquisitions.map((a) => a.type))).sort(),
    [acquisitions],
  );

  const filtered = useMemo(() => {
    const lower = search.toLowerCase();
    const result = acquisitions.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (lower && !(`${a.type} ${a.path} ${a.hash ?? ''}`.toLowerCase().includes(lower))) return false;
      return true;
    });
    result.sort((a, b) => {
      const ta = Date.parse(a.timestamp) || 0;
      const tb = Date.parse(b.timestamp) || 0;
      return sortOrder === 'newest' ? tb - ta : ta - tb;
    });
    return result;
  }, [acquisitions, statusFilter, typeFilter, sortOrder, search]);

  // Per-status counts for the chip badges. Cheap to compute (acquisitions
  // are tens-to-hundreds, never thousands) so no memo needed.
  const counts = {
    all: acquisitions.length,
    completed: acquisitions.filter((a) => a.status === 'completed').length,
    'in-progress': acquisitions.filter((a) => a.status === 'in-progress').length,
    failed: acquisitions.filter((a) => a.status === 'failed').length,
  };

  if (!casePath) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Case Timeline"
          description="Chronological view of acquisitions in the active case"
          icon={<History size={24} />}
        />
        <div className="card text-center py-12">
          <History size={40} className="mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-secondary)]">No case is currently open.</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Open a case from the Case Manager or run the Acquisition Wizard to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Case Timeline"
        description={`${caseName || 'Case'} · ${caseNumber || '—'} · examiner: ${examiner || '—'}`}
        icon={<History size={24} />}
      />

      <ReportBuilderCard />

      {/* Status chip row — one chip per status with live count. Click to
          filter; click "all" to reset. Counts give the user a sense of
          case volume without making them scroll. */}
      <div className="card flex flex-wrap items-center gap-2">
        <Filter size={14} className="text-[var(--text-muted)]" />
        {([
          { key: 'all',          label: 'All',          color: 'bg-slate-500/15 text-slate-300' },
          { key: 'completed',    label: 'Completed',    color: 'bg-emerald-500/15 text-emerald-300' },
          { key: 'in-progress',  label: 'In progress',  color: 'bg-amber-500/15 text-amber-300' },
          { key: 'failed',       label: 'Failed',       color: 'bg-red-500/15 text-red-300' },
        ] as const).map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-opacity ${color} ${
              statusFilter === key ? 'ring-2 ring-[#6495ED]/60' : 'opacity-70 hover:opacity-100'
            }`}
          >
            {label}
            <span className="tabular-nums opacity-80">{counts[key]}</span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="input-field text-xs py-1"
          >
            <option value="all">All types</option>
            {types.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            className="input-field text-xs py-1"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="input-field text-xs py-1 pl-7 w-48"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <Clock size={32} className="mx-auto mb-2 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-secondary)]">No acquisitions match the current filters.</p>
        </div>
      ) : (
        <div className="card relative">
          {/* The vertical rail and per-item row. Items render as a flex
              row with a fixed-width status icon on the left so the
              timestamp column stays aligned regardless of message length. */}
          <ol className="relative space-y-3">
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-[var(--border-color)]" />
            {filtered.map((a) => <TimelineRow key={a.id} entry={a} />)}
          </ol>
        </div>
      )}
    </div>
  );
};

const TimelineRow: React.FC<{ entry: Acquisition }> = ({ entry }) => {
  const { Icon, accent, bgRing } = statusVisual(entry.status);
  const ts = useMemo(() => formatTimestamp(entry.timestamp), [entry.timestamp]);

  // Open the file/folder for this acquisition through the dialog handler's
  // open-path side-channel — same trick used by other pages that want to
  // reveal a result in the OS file manager.
  const reveal = (): void => {
    window.api.invoke('dialog:save-file', { action: 'open-path', path: entry.path }).catch(() => {});
  };

  return (
    <li className="relative flex items-start gap-3 pl-1">
      <div className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${bgRing}`}>
        <Icon size={14} className={accent} />
      </div>
      <div className="flex-1 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">{prettyType(entry.type)}</span>
              <span className={`text-[10px] uppercase tracking-wide ${accent}`}>{entry.status}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <HardDrive size={11} />
              <button
                onClick={reveal}
                className="truncate text-left hover:text-[var(--text-primary)] hover:underline"
                title={`Open: ${entry.path}`}
              >
                {entry.path || '(no path)'}
              </button>
            </div>
            {entry.hash && (
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] font-mono">
                <Hash size={10} />
                <span className="truncate" title={entry.hash}>{entry.hash}</span>
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-[var(--text-secondary)]">{ts.dateLabel}</div>
            <div className="text-[10px] text-[var(--text-muted)]">{ts.timeLabel}</div>
          </div>
        </div>
        {entry.path && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={reveal}
              className="inline-flex items-center gap-1 rounded border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <FolderOpen size={11} /> Open
            </button>
          </div>
        )}
      </div>
    </li>
  );
};

function statusVisual(status: Acquisition['status']): {
  Icon: typeof CheckCircle2;
  accent: string;
  bgRing: string;
} {
  switch (status) {
    case 'completed':
      return { Icon: CheckCircle2, accent: 'text-emerald-400', bgRing: 'bg-emerald-500/15 ring-1 ring-emerald-500/30' };
    case 'in-progress':
      return { Icon: Loader2,      accent: 'text-amber-400',   bgRing: 'bg-amber-500/15 ring-1 ring-amber-500/30 animate-pulse' };
    case 'failed':
      return { Icon: XCircle,      accent: 'text-red-400',     bgRing: 'bg-red-500/15 ring-1 ring-red-500/30' };
  }
}

function prettyType(t: string): string {
  // "ios:backup" → "iOS Backup"; "adb:backup" → "ADB Backup"; etc.
  return t
    .split(/[:_-]/)
    .map((seg) => seg ? seg[0].toUpperCase() + seg.slice(1) : '')
    .join(' ')
    .replace(/\bIos\b/, 'iOS')
    .replace(/\bAdb\b/, 'ADB')
    .replace(/\bSms\b/, 'SMS')
    .replace(/\bOcr\b/, 'OCR');
}

function formatTimestamp(iso: string): { dateLabel: string; timeLabel: string } {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { dateLabel: '—', timeLabel: '' };
  return {
    dateLabel: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    timeLabel: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

/**
 * In-page card for building an Acquisition Report (HTML + Markdown) from
 * any acquisition folder produced by the structured-output pipeline (the
 * `MISC_COLLECT` handler, iOS extractors that adopt forensic-output, etc.).
 * Lives at the top of the timeline so an examiner can produce a shareable
 * report in two clicks: pick folder → Build Report.
 */
const ReportBuilderCard: React.FC = () => {
  const [acquisitionDir, setAcquisitionDir] = React.useState('');
  const [building, setBuilding] = React.useState(false);
  const [result, setResult] = React.useState<{ htmlPath: string; markdownPath: string; artefactsIncluded: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleBuild = async (): Promise<void> => {
    if (!acquisitionDir || building) return;
    setBuilding(true);
    setError(null);
    setResult(null);
    try {
      const r = (await window.api.invoke(IPC_CHANNELS.ACQUISITION_REPORT_BUILD, {
        acquisitionDir,
        computeHashes: true,
      })) as { success: boolean; htmlPath?: string; markdownPath?: string; artefactsIncluded?: number; message?: string };
      if (r?.success && r.htmlPath && r.markdownPath) {
        setResult({
          htmlPath: r.htmlPath,
          markdownPath: r.markdownPath,
          artefactsIncluded: r.artefactsIncluded ?? 0,
        });
      } else {
        setError(r?.message ?? 'Failed to build report.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  };

  const reveal = (p: string): void => {
    window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, { action: 'open-path', path: p }).catch(() => {});
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-2">
        <FileText size={16} className="mt-1 text-[#6495ED]" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Acquisition Report</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Pick an acquisition folder (e.g. <code>case/android/&lt;serial&gt;</code>) — the report combines
            its <code>MANIFEST.json</code> + parsed JSON artefacts into a single HTML + Markdown summary
            with SHA-256 hashes for chain-of-custody.
          </p>
        </div>
      </div>
      <FolderPicker
        role="case"
        label=""
        value={acquisitionDir}
        onChange={setAcquisitionDir}
        hint="The folder must contain a MANIFEST.json (created by the wizard or per-handler extractions)."
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleBuild}
          disabled={!acquisitionDir || building}
          className="btn-primary inline-flex items-center gap-1.5 text-sm"
        >
          {building ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          {building ? 'Building report…' : 'Build report'}
        </button>
        {result && (
          <>
            <button
              onClick={() => reveal(result.htmlPath)}
              className="btn-secondary inline-flex items-center gap-1 text-sm"
            >
              <FolderOpen size={13} /> Open HTML
            </button>
            <button
              onClick={() => reveal(result.markdownPath)}
              className="btn-secondary inline-flex items-center gap-1 text-sm"
            >
              <FolderOpen size={13} /> Open Markdown
            </button>
            <span className="text-xs text-[var(--text-muted)]">{result.artefactsIncluded} artefact(s) included</span>
          </>
        )}
      </div>
      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
};
