import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * LRU-style recent-paths store, keyed by a logical "bucket" so each kind
 * of picker keeps its own short history rather than mixing iOS backups,
 * output folders, and source files together.
 *
 * Buckets are open-ended strings — typical values: 'output', 'source',
 * 'backup', 'case', 'database', or any per-page tag callers want.
 *
 * Entries are de-duplicated case-insensitively (paths are
 * filesystem-resolvable so exact-match dedupe could miss `/Users/x/Foo`
 * vs `/Users/x/foo` on case-insensitive macOS volumes; but since we
 * persist what the user actually picked, a literal-string compare is the
 * least surprising behaviour). Most-recent-first; capped at 5 per bucket
 * to keep the dropdown scannable.
 */
const MAX_PER_BUCKET = 5;

export interface RecentPathsState {
  byBucket: Record<string, string[]>;
  push: (bucket: string, path: string) => void;
  remove: (bucket: string, path: string) => void;
  clear: (bucket?: string) => void;
}

export const useRecentPathsStore = create<RecentPathsState>()(
  persist(
    (set) => ({
      byBucket: {},
      push: (bucket, path) =>
        set((s) => {
          const trimmed = path?.trim();
          if (!trimmed) return s;
          const existing = s.byBucket[bucket] ?? [];
          const next = [trimmed, ...existing.filter((p) => p !== trimmed)].slice(0, MAX_PER_BUCKET);
          return { byBucket: { ...s.byBucket, [bucket]: next } };
        }),
      remove: (bucket, path) =>
        set((s) => {
          const existing = s.byBucket[bucket] ?? [];
          return {
            byBucket: { ...s.byBucket, [bucket]: existing.filter((p) => p !== path) },
          };
        }),
      clear: (bucket) =>
        set((s) => {
          if (!bucket) return { byBucket: {} };
          const { [bucket]: _, ...rest } = s.byBucket;
          return { byBucket: rest };
        }),
    }),
    { name: 'rmpg-recent-paths' }
  )
);

/**
 * Convenience selector — pull the list for a single bucket without
 * forcing every consumer to re-implement the lookup + default-array
 * dance. Returns the same array reference between renders when nothing
 * changed, so consumers get cheap React equality checks.
 */
export function useRecentPaths(bucket: string): string[] {
  return useRecentPathsStore((s) => s.byBucket[bucket] ?? EMPTY);
}
const EMPTY: string[] = [];
