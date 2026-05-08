/**
 * Safely format a date value that may be null, undefined, or invalid.
 * Returns a fallback string instead of "Invalid Date".
 */
export function formatDate(
  value: string | number | null | undefined,
  style: 'date' | 'time' | 'datetime' = 'date',
  fallback = '-'
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const d = new Date(value);
  if (isNaN(d.getTime())) return fallback;
  if (style === 'date') return d.toLocaleDateString();
  if (style === 'time') return d.toLocaleTimeString();
  return d.toLocaleString();
}

/** Shorthand for date-only formatting */
export const fmtDate = (v: string | number | null | undefined) => formatDate(v, 'date');
/** Shorthand for time-only formatting */
export const fmtTime = (v: string | number | null | undefined) => formatDate(v, 'time');
/** Shorthand for full datetime formatting */
export const fmtDateTime = (v: string | number | null | undefined) => formatDate(v, 'datetime');
