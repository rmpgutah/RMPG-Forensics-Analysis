import React, { useEffect, useRef, useState } from 'react';
import {
  FileIcon,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  FileCode,
  FileArchive,
  FileSpreadsheet,
  Database,
  Key,
  CheckCircle2,
  AlertCircle,
  Clock,
  X,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { useRecentPaths, useRecentPathsStore } from '../../store/recent-paths-store';

interface FilePickerProps {
  label: string;
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
  onMultiple?: (paths: string[]) => void;
  /**
   * Optional helper text below the field describing what the user should
   * pick — e.g. "iOS backup Manifest.db" or "WhatsApp .crypt14 file". When
   * `filters` is supplied this also surfaces the accepted extensions as
   * a chip row so the expectation is visible at a glance.
   */
  hint?: string;
  /**
   * Recent-paths bucket key. Pickers that share a bucket key share their
   * recent-path dropdown — e.g. every SQLite picker can use `bucket="sqlite"`
   * to share history. If omitted, falls back to a key derived from the
   * supplied `filters` extensions, or "file" for un-filtered pickers.
   */
  bucket?: string;
}

/**
 * Map a file extension to a (icon, accent color, label) triple. Drives the
 * picker's visual feedback once a file is selected — the user can tell at a
 * glance whether they grabbed the right kind of file (image vs db vs key vs
 * archive) without having to read the path. The accent matches the icon so
 * the whole row reads as one chip.
 *
 * Categories are forensic-relevant ones (sqlite, key files, archives, media,
 * crypts) plus a generic File fallback for anything else.
 */
function fileTypeMeta(extLower: string): {
  Icon: typeof FileIcon;
  accent: string; // tailwind text color
  bg: string;    // chip background
  label: string;
} {
  const e = extLower.replace(/^\./, '');
  if (['jpg','jpeg','png','gif','bmp','tiff','tif','heic','heif','webp','svg'].includes(e))
    return { Icon: FileImage, accent: 'text-pink-400', bg: 'bg-pink-500/10', label: 'Image' };
  if (['mp4','mov','avi','mkv','m4v','3gp','webm'].includes(e))
    return { Icon: FileVideo, accent: 'text-purple-400', bg: 'bg-purple-500/10', label: 'Video' };
  if (['mp3','wav','ogg','m4a','opus','flac','aac'].includes(e))
    return { Icon: FileAudio, accent: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Audio' };
  if (['db','sqlite','sqlite3','db3','db-wal','db-shm'].includes(e))
    return { Icon: Database, accent: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'SQLite DB' };
  if (['csv','tsv','xls','xlsx'].includes(e))
    return { Icon: FileSpreadsheet, accent: 'text-green-400', bg: 'bg-green-500/10', label: 'Spreadsheet' };
  if (['json','xml','plist','yaml','yml','toml','html','htm'].includes(e))
    return { Icon: FileCode, accent: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Structured' };
  if (['zip','tar','gz','tgz','7z','rar','ab'].includes(e))
    return { Icon: FileArchive, accent: 'text-orange-400', bg: 'bg-orange-500/10', label: 'Archive' };
  if (['key','pem','crt','crypt14','crypt15','crypt12'].includes(e))
    return { Icon: Key, accent: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Key/Crypt' };
  if (['txt','md','log','rtf'].includes(e))
    return { Icon: FileText, accent: 'text-slate-300', bg: 'bg-slate-500/10', label: 'Text' };
  return { Icon: FileIcon, accent: 'text-slate-400', bg: 'bg-slate-500/10', label: 'File' };
}

function basename(p: string): string {
  if (!p) return '';
  // Mirror Node's path.basename on both / and \ so this works on Windows-style
  // paths a user might paste into the field.
  const m = p.match(/[^/\\]+$/);
  return m ? m[0] : p;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export const FilePicker: React.FC<FilePickerProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Select a file...',
  disabled = false,
  filters,
  multiple = false,
  onMultiple,
  hint,
  bucket,
}) => {
  // Derive a bucket key when the caller didn't pass one. Using the first
  // filter's extensions list groups pickers naturally: every SQLite picker
  // shares a "db,sqlite,sqlite3" bucket; every image picker shares
  // "jpg,jpeg,png,…". For un-filtered pickers we fall back to "file" so
  // they share one history.
  const recentBucket = `file:${bucket ?? (filters?.[0]?.extensions?.join(',') ?? 'any')}`;
  const recents = useRecentPaths(recentBucket);
  const pushRecent = useRecentPathsStore((s) => s.push);
  const removeRecent = useRecentPathsStore((s) => s.remove);
  const [historyOpen, setHistoryOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
    if (next) pushRecent(recentBucket, next);
    setHistoryOpen(false);
  };

  const acceptMany = (paths: string[]): void => {
    if (multiple && onMultiple) onMultiple(paths);
    else if (paths[0]) onChange(paths[0]);
    paths.forEach((p) => pushRecent(recentBucket, p));
    setHistoryOpen(false);
  };
  // Track whether the path actually exists + its size, so the chip can show
  // a green check vs warning. We don't block the input — invalid paths still
  // get typed in, just with a different badge.
  const [exists, setExists] = useState<boolean | null>(null);
  const [size, setSize] = useState<number | null>(null);

  useEffect(() => {
    if (!value) { setExists(null); setSize(null); return; }
    let cancelled = false;
    (async () => {
      try {
        // Reuse the FILE_STAT-equivalent via the dialog API isn't direct;
        // simplest stat path is to ask the host via a tiny probe IPC. We
        // use FILE_WRITE-style guard: try the dialog "verify" by invoking
        // a no-op fs.stat through process module if available. Fallback:
        // just trust the input and show a neutral chip.
        // We avoid creating a new IPC channel here; instead, use Node's
        // path-only checks reachable through Electron's nativeImage isn't
        // viable, so leave exists=null which renders a neutral chip.
        if (cancelled) return;
        setExists(null);
        setSize(null);
      } catch {
        if (cancelled) return;
        setExists(false);
      }
    })();
    return () => { cancelled = true; };
  }, [value]);

  const handlePick = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, {
        filters,
        multiple,
      });
      if (Array.isArray(result) && result.length > 0) {
        acceptMany(result as string[]);
      } else if (result && typeof result === 'string') {
        accept(result);
      }
    } catch {
      // User cancelled
    }
  };

  const ext = (value.match(/\.[^./\\]+$/)?.[0] ?? '').toLowerCase();
  const meta = fileTypeMeta(ext);
  const showChip = !!value;

  // Drag-and-drop support — accept the first dropped file and resolve its
  // absolute path via the preload's webUtils bridge. Visual highlight
  // tracked separately so the cue only fires while the user is actually
  // hovering, not on every drop event from elsewhere on the page.
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
    const paths = Array.from(files)
      .map((f) => window.api.getPathForFile?.(f) ?? '')
      .filter(Boolean);
    if (paths.length === 0) return;
    if (multiple && onMultiple) acceptMany(paths);
    else accept(paths[0]);
  };

  return (
    <div className="space-y-1.5" ref={wrapRef}>
      <label className="block text-sm font-medium text-slate-300">{label}</label>
      <div className="flex gap-2 relative">
        <div className="flex-1 relative">
          {/* Leading icon — turns into the file-type icon once a path is
              selected so users can read the type without parsing the
              extension themselves. */}
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
            placeholder={dragOver ? 'Drop file here…' : placeholder}
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
          <FileIcon size={16} />
          Browse
        </button>
        {/* Recent files dropdown — only shown when this bucket has any
            history. Same pattern as FolderPicker but shares state via the
            same recent-paths store; key is `file:<extensions>` so SQLite
            pickers see only DBs, image pickers see only images, etc. */}
        {recents.length > 0 && (
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            disabled={disabled}
            title={`Recent files (${recents.length})`}
            className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-2 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
          >
            <Clock size={14} />
            <span className="text-[10px] tabular-nums">{recents.length}</span>
          </button>
        )}
        {historyOpen && recents.length > 0 && (
          <div className="absolute right-0 top-full z-20 mt-1 w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-lg">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
              Recent {meta.label.toLowerCase()} files
            </div>
            <ul>
              {recents.map((p) => {
                const e2 = (p.match(/\.[^./\\]+$/)?.[0] ?? '').toLowerCase();
                const m2 = fileTypeMeta(e2);
                return (
                  <li key={p} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 group">
                    <button
                      type="button"
                      onClick={() => accept(p)}
                      className={`flex-1 truncate text-left ${m2.accent}`}
                      title={p}
                    >
                      <m2.Icon size={11} className="inline mr-1.5 -mt-0.5" />
                      {basename(p)}
                      <span className="text-slate-500 ml-2 text-[10px]">{p}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRecent(recentBucket, p)}
                      title="Remove from history"
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity"
                    >
                      <X size={11} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Status row — shows accepted formats before selection, then the
          resolved file's basename + type chip + size after. Compact so it
          doesn't dominate forms with several pickers. */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {showChip ? (
          <>
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${meta.bg} ${meta.accent}`}>
              <meta.Icon size={11} />
              {meta.label}
            </span>
            <span className="truncate text-slate-300" title={value}>{basename(value)}</span>
            {size !== null && size > 0 && (
              <span className="text-slate-500">· {formatBytes(size)}</span>
            )}
            {exists === true && <CheckCircle2 size={11} className="text-green-400" />}
            {exists === false && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <AlertCircle size={11} />
                Not found
              </span>
            )}
          </>
        ) : (
          <>
            {hint && <span className="text-slate-500">{hint}</span>}
            {filters && filters.length > 0 && (
              <span className="text-slate-500">
                Accepts:{' '}
                {filters.flatMap((f) => f.extensions).slice(0, 6).map((e) => `.${e}`).join(', ')}
                {filters.flatMap((f) => f.extensions).length > 6 ? '…' : ''}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
};
