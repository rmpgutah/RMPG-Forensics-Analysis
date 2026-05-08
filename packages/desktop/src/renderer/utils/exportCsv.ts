/**
 * Export an array of objects to a CSV file download in the renderer.
 * Uses the browser Blob API — no Electron IPC needed.
 */
export function exportToCsv(rows: Record<string, unknown>[], filename: string): void {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((h) => csvEscape(String(row[h] ?? ''))).join(',')),
  ];

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
