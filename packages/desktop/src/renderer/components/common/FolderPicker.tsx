import React, { useState, useRef, useEffect } from 'react';
import {
  FolderOpen,
  Folder,
  Smartphone,
  ShieldCheck,
  Database,
  Download,
  Clock,
  X,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { useRecentPaths, useRecentPathsStore } from '../../store/recent-paths-store';
import { useSettingsStore } from '../../store/settings-store';

interface FolderPickerProps {
  label: string;
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Optional helper text shown below the input — describes what kind of
   * folder is expected (e.g. "iOS backup root", "case output directory").
   */
  hint?: string;
  /**
   * Hint about the role of this folder. Drives the icon + accent color so
   * the user can tell at a glance whether this picker is for the source
   * (backup / case input) or destination (output / report) — these often
   * sit next to each other in forms and look identical otherwise.
   */
  role?: 'source' | 'output' | 'case' | 'backup' | 'database' | 'generic';
}

function basename(p: string): string {
  if (!p) return '';
  const m = p.replace(/[/\\]+$/, '').match(/[^/\\]+$/);
  return m ? m[0] : p;
}

const ROLE_META: Record<NonNullable<FolderPickerProps['role']>, {
  Icon: typeof Folder;
  accent: string;
  bg: string;
  label: string;
}> = {
  source:   { Icon: Folder,        accent: 'text-blue-400',    bg: 'bg-blue-500/10',    label: 'Source' },
  output:   { Icon: Download,      accent: 'text-cyan-400',    bg: 'bg-cyan-500/10',    label: 'Output' },
  case:     { Icon: ShieldCheck,   accent: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Case' },
  backup:   { Icon: Smartphone,    accent: 'text-violet-400',  bg: 'bg-violet-500/10',  label: 'Backup' },
  database: { Icon: Database,      accent: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Database' },
  generic:  { Icon: Folder,        accent: 'text-slate-400',   bg: 'bg-slate-500/10',   label: 'Folder' },
};

export const FolderPicker: React.FC<FolderPickerProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Select a folder...',
  disabled = false,
  hint,
  role = 'generic',
}) => {
  // Recent-paths history bucketed by role so iOS-backup picks don't pollute
  // case-folder history and vice versa. Push on every accepted selection
  // (browse / drop / paste-confirm) so the dropdown stays current.
  const recents = useRecentPaths(role);
  const pushRecent = useRecentPathsStore((s) => s.push);
  const removeRecent = useRecentPathsStore((s) => s.remove);
  const [historyOpen, setHistoryOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Auto-fill output pickers with the user's configured default output
  // folder ONCE — when no value is set yet. We deliberately don't call
  // pushRecent on this auto-fill so the default doesn't pollute the
  // history dropdown (it's already the default; surfacing it twice is
  // noise). Only triggers on `role === 'output'` to avoid hijacking
  // case / source / backup pickers.
  const defaultOutputDir = useSettingsStore((s) => s.preferences.defaultOutputDir);
  const autofilledRef = useRef(false);
  useEffect(() => {
    if (autofilledRef.current) return;
    if (role !== 'output') return;
    if (value) return;
    if (!defaultOutputDir) return;
    autofilledRef.current = true;
    onChange(defaultOutputDir);
  }, [role, value, defaultOutputDir, onChange]);

  // Close history on outside click — keeps the dropdown from sticking
  // around after the user moves on without selecting anything.
  useEffect(() => {
    if (!historyOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setHistoryOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [historyOpen]);

  const accept = (next: string): void => {
    onChange(next);
    if (next) pushRecent(role, next);
    setHistoryOpen(false);
  };

  const handlePick = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER);
      if (result && typeof result === 'string') {
        accept(result);
      } else if (Array.isArray(result) && result.length > 0) {
        accept(result[0]);
      }
    } catch {
      // User cancelled
    }
  };

  const meta = ROLE_META[role];
  const showChip = !!value;

  // Drag-and-drop — accept the first dropped folder. Browsers report
  // folders as DataTransferItem entries; we resolve via webUtils which
  // also works for files (we then rely on the role expecting a folder
  // but accept files as a friendly fallback — better UX than rejecting).
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = () => {
    if (dragOver) setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    if (disabled) return;
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const path = window.api.getPathForFile?.(files[0]) ?? '';
    if (path) accept(path);
  };

  return (
    <div className="space-y-1.5" ref={wrapRef}>
      <label className="block text-sm font-medium text-slate-300">{label}</label>
      <div className="flex gap-2 relative">
        <div className="flex-1 relative">
          {/* Leading icon — uses the role-specific icon (Smartphone for
              backups, ShieldCheck for case folders, Download for outputs)
              so source/destination pickers in the same form are immediately
              distinguishable. */}
          <div className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ${showChip ? meta.accent : 'text-slate-500'}`}>
            <meta.Icon size={15} />
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            placeholder={dragOver ? 'Drop folder here…' : placeholder}
            disabled={disabled}
            className={`w-full rounded-md border bg-slate-800 pl-8 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 transition-colors ${
              dragOver
                ? 'border-blue-400 ring-2 ring-blue-400/40'
                : 'border-slate-700'
            }`}
          />
        </div>
        <button
          onClick={handlePick}
          disabled={disabled}
          className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          <FolderOpen size={16} />
          Browse
        </button>
        {/* Recent-paths dropdown — only shown when this role has any
            history. One click reuses a recent path; the X removes individual
            entries when they go stale (e.g. a backup folder that's been
            deleted). The dropdown is absolute-positioned so it overlays
            the next form row instead of pushing layout. */}
        {recents.length > 0 && (
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            disabled={disabled}
            title={`Recent ${role} folders (${recents.length})`}
            className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
          >
            <Clock size={14} />
            <span className="text-[10px] tabular-nums">{recents.length}</span>
          </button>
        )}
        {historyOpen && recents.length > 0 && (
          <div className="absolute right-0 top-full z-20 mt-1 w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-lg">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
              Recent {meta.label.toLowerCase()} folders
            </div>
            <ul>
              {recents.map((p) => (
                <li
                  key={p}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 group"
                >
                  <button
                    type="button"
                    onClick={() => accept(p)}
                    className={`flex-1 truncate text-left ${meta.accent}`}
                    title={p}
                  >
                    <meta.Icon size={11} className="inline mr-1.5 -mt-0.5" />
                    {p}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRecent(role, p)}
                    title="Remove from history"
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity"
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Below-the-input row — when nothing is picked, shows the hint
          (what the user is supposed to choose). When picked, shows a
          role-coloured chip + basename so the user can tell at a glance
          which of (potentially several) folder pickers received the path. */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {showChip ? (
          <>
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${meta.bg} ${meta.accent}`}>
              <meta.Icon size={11} />
              {meta.label}
            </span>
            <span className="truncate text-slate-300" title={value}>{basename(value) || '/'}</span>
          </>
        ) : (
          hint && <span className="text-slate-500">{hint}</span>
        )}
      </div>
    </div>
  );
};
