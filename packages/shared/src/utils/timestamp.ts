/**
 * Convert WhatsApp Unix timestamp (milliseconds) to Date.
 * Original C# used DateTime(1970,1,1).AddMilliseconds(unixTime)
 */
export function fromWhatsAppTimestamp(unixMs: number): Date {
  return new Date(unixMs);
}

/**
 * Format date for case folder naming.
 * Original C# pattern: "Case-dd-MM-yyyy-HH-mm-ss"
 */
export function formatCaseTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `Case-${d}-${m}-${y}-${h}-${min}-${s}`;
}

/**
 * Format date for display in reports and logs.
 */
export function formatDisplayDate(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Get ISO timestamp string for logging.
 */
export function isoNow(): string {
  return new Date().toISOString();
}
