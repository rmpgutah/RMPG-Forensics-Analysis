import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { AcquisitionManifest } from './forensic-output';

/**
 * acquisition-report — read a `MANIFEST.json` and the parsed JSON
 * companions next to it, synthesise a single HTML report (for sharing /
 * printing) and a Markdown summary (for examiner notes / case files).
 *
 * The report is intentionally portable: zero JS, all styles inline, all
 * media data-URI'd if needed. Drop the .html on a USB stick and it opens
 * the same on Windows / macOS / Linux without losing layout.
 *
 * Section emission rules:
 *   - Every artefact in the manifest gets its own <section> with a header
 *     (name + extracted-at) and a body shaped to the data type:
 *       * `Record<string,string>`        → 2-col table (key, value)
 *       * `Array<Record<string,unknown>>`→ regular table with column union
 *       * Anything else                  → JSON.stringify in <pre>
 *   - If a parsed JSON companion is missing, we fall back to a 200-line
 *     preview of the raw text artefact. Better than empty section.
 *   - Hashes (sha256) are computed lazily during report build and added
 *     to the manifest's artefact entries so the report doubles as a
 *     chain-of-custody document.
 */

export interface ReportOutput {
  htmlPath: string;
  markdownPath: string;
  artefactsIncluded: number;
  totalSize: number;
}

/**
 * Build the report. `acquisitionDir` is the folder produced by
 * `startAcquisition()` — contains MANIFEST.json plus the per-artefact
 * .txt/.json files. Outputs go to that same folder by default; pass
 * `outputDir` to redirect (useful for case-folder collation).
 */
export async function buildAcquisitionReport(opts: {
  acquisitionDir: string;
  outputDir?: string;
  /** When true, also re-hash each artefact and write the updated
   *  manifest. Skip for fast preview during scrolling. Default true. */
  computeHashes?: boolean;
}): Promise<ReportOutput> {
  const { acquisitionDir, outputDir = opts.acquisitionDir, computeHashes = true } = opts;
  const manifestPath = path.join(acquisitionDir, 'MANIFEST.json');
  const manifest: AcquisitionManifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

  // Walk artefacts, hash if requested, collect parsed payloads.
  const sections: Array<{
    name: string;
    extractedAt: string;
    bytes: number;
    sha256?: string;
    payload: unknown | null;
    rawPreview?: string;
    notes?: string;
  }> = [];

  let totalSize = 0;
  for (const a of manifest.artefacts) {
    const fullPath = path.join(acquisitionDir, a.relativePath);
    let bytes = a.bytes ?? 0;
    let sha256 = a.sha256;
    try {
      const stat = await fs.stat(fullPath);
      bytes = stat.size;
      if (computeHashes && !sha256) {
        const data = await fs.readFile(fullPath);
        sha256 = createHash('sha256').update(data).digest('hex');
        a.sha256 = sha256;
        a.bytes = bytes;
      }
    } catch {
      // Artefact missing on disk — keep the manifest entry but flag in
      // notes; report will surface this so the examiner notices.
    }
    totalSize += bytes;

    // Try the JSON companion first (parsed/structured), fall back to raw
    // text preview. The companion lives at the same basename with .json.
    const ext = path.extname(a.relativePath);
    const baseNoExt = a.relativePath.slice(0, -ext.length);
    const jsonCompanion = path.join(acquisitionDir, `${baseNoExt}.json`);
    let payload: unknown | null = null;
    let rawPreview: string | undefined;
    try {
      payload = JSON.parse(await fs.readFile(jsonCompanion, 'utf-8'));
    } catch {
      try {
        const raw = await fs.readFile(fullPath, 'utf-8');
        rawPreview = raw.split('\n').slice(0, 200).join('\n');
        if (raw.split('\n').length > 200) rawPreview += '\n[…truncated…]';
      } catch { /* artefact gone — section becomes a "missing" notice */ }
    }

    sections.push({
      name: a.name,
      extractedAt: a.extractedAt,
      bytes,
      sha256,
      payload,
      rawPreview,
      notes: a.notes,
    });
  }

  // Persist the (possibly hash-updated) manifest back to disk
  if (computeHashes) {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  await fs.mkdir(outputDir, { recursive: true });
  const htmlPath = path.join(outputDir, 'AcquisitionReport.html');
  const markdownPath = path.join(outputDir, 'AcquisitionReport.md');

  const html = renderHtml(manifest, sections);
  const md = renderMarkdown(manifest, sections);
  await fs.writeFile(htmlPath, html, 'utf-8');
  await fs.writeFile(markdownPath, md, 'utf-8');

  return { htmlPath, markdownPath, artefactsIncluded: sections.length, totalSize };
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function renderHtml(m: AcquisitionManifest, sections: Awaited<ReturnType<typeof buildAcquisitionReport>> extends infer _ ? Array<{ name: string; extractedAt: string; bytes: number; sha256?: string; payload: unknown | null; rawPreview?: string; notes?: string }> : never): string {
  const headerStyle = `
    *,*::before,*::after{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:24px 32px;background:#fafafa;color:#222;line-height:1.5}
    header{border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:24px}
    h1{margin:0;font-size:24px}
    h2{margin:24px 0 8px;font-size:18px;color:#333;border-bottom:1px solid #ddd;padding-bottom:4px}
    h3{margin:18px 0 6px;font-size:14px;color:#555}
    .meta{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;font-size:13px;margin-top:8px}
    .meta dt{font-weight:600;color:#666;text-align:right}
    .meta dd{margin:0;font-family:Menlo,Consolas,monospace;font-size:12px}
    table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0;background:#fff}
    th,td{border:1px solid #e0e0e0;padding:6px 10px;text-align:left;vertical-align:top}
    th{background:#f5f5f5;font-weight:600}
    tr:nth-child(even) td{background:#fafafa}
    pre{background:#f4f4f4;padding:8px 12px;border-radius:4px;font-size:12px;overflow:auto;max-height:400px;border:1px solid #e0e0e0}
    .artefact{background:#fff;border:1px solid #e0e0e0;border-radius:6px;padding:14px 18px;margin-bottom:18px;break-inside:avoid}
    .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#eef;color:#446}
    .hash{font-family:Menlo,Consolas,monospace;font-size:11px;color:#888;word-break:break-all}
    .missing{color:#a33;font-style:italic;font-size:13px}
    footer{margin-top:32px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#888}
  `;

  const platformBadge = `<span class="badge">${esc(m.device.platform.toUpperCase())}</span>`;
  const headerBlock = `
    <header>
      <h1>Acquisition Report ${platformBadge}</h1>
      <dl class="meta">
        <dt>Acquisition ID</dt><dd>${esc(m.id)}</dd>
        <dt>Case</dt><dd>${esc(m.caseName ?? '')} ${m.caseNumber ? `<em>(${esc(m.caseNumber)})</em>` : ''}</dd>
        <dt>Examiner</dt><dd>${esc(m.examiner)}</dd>
        <dt>Device</dt><dd>${esc(m.device.id)}${m.device.label ? ` · ${esc(m.device.label)}` : ''}${m.device.osVersion ? ` · ${esc(m.device.osVersion)}` : ''}</dd>
        <dt>Started</dt><dd>${esc(m.startedAt)}</dd>
        <dt>Completed</dt><dd>${esc(m.completedAt ?? '(in progress)')}</dd>
        <dt>Artefacts</dt><dd>${m.artefacts.length} item(s)</dd>
      </dl>
    </header>
  `;

  const body = sections.map((s) => `
    <div class="artefact">
      <h2>${esc(s.name)}</h2>
      <dl class="meta">
        <dt>Extracted</dt><dd>${esc(s.extractedAt)}</dd>
        <dt>Size</dt><dd>${formatBytes(s.bytes)}</dd>
        ${s.sha256 ? `<dt>SHA-256</dt><dd class="hash">${esc(s.sha256)}</dd>` : ''}
        ${s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : ''}
      </dl>
      ${renderPayload(s.payload, s.rawPreview)}
    </div>
  `).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Acquisition Report — ${esc(m.device.id)}</title>
<style>${headerStyle}</style>
</head>
<body>
${headerBlock}
${body || '<p class="missing">No artefacts in this acquisition.</p>'}
<footer>Generated by RMPG Forensics Analysis · ${esc(new Date().toISOString())}</footer>
</body>
</html>`;
}

function renderPayload(payload: unknown, rawPreview: string | undefined): string {
  if (payload == null && !rawPreview) {
    return '<p class="missing">Artefact file not found on disk.</p>';
  }
  if (payload == null && rawPreview) {
    return `<h3>Raw output (preview)</h3><pre>${esc(rawPreview)}</pre>`;
  }
  // Most parsed companions wrap their data in `{ artefact, platform,
  // deviceId, extractedAt, data }`. Drill into `.data` if present.
  const data = (payload as { data?: unknown })?.data ?? payload;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    // Record<string, primitive> → 2-col key/value table
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return '<p class="missing">(empty)</p>';
    const allPrimitive = entries.every(([, v]) => typeof v !== 'object' || v === null);
    if (allPrimitive) {
      const rows = entries.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(String(v ?? ''))}</td></tr>`).join('');
      return `<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
  }

  if (Array.isArray(data) && data.length > 0 && data.every((r) => r && typeof r === 'object')) {
    // Array of objects → real table (column union)
    const cols = Array.from(data.reduce((set: Set<string>, row) => {
      Object.keys(row as Record<string, unknown>).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()));
    const head = `<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`;
    const rowsHtml = data.slice(0, 500).map((r) => {
      const tds = cols.map((c) => `<td>${esc(String((r as Record<string, unknown>)[c] ?? ''))}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    const more = data.length > 500 ? `<p class="missing">[…${data.length - 500} more rows truncated for report; full data in JSON…]</p>` : '';
    return `<table>${head}<tbody>${rowsHtml}</tbody></table>${more}`;
  }

  // Fallback — pretty JSON
  return `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderMarkdown(m: AcquisitionManifest, sections: Array<{ name: string; extractedAt: string; bytes: number; sha256?: string; payload: unknown | null; rawPreview?: string; notes?: string }>): string {
  const lines: string[] = [];
  lines.push(`# Acquisition Report — ${m.device.platform.toUpperCase()}`);
  lines.push('');
  lines.push(`- **Acquisition ID**: \`${m.id}\``);
  lines.push(`- **Case**: ${m.caseName ?? '—'}${m.caseNumber ? ` (${m.caseNumber})` : ''}`);
  lines.push(`- **Examiner**: ${m.examiner}`);
  lines.push(`- **Device**: \`${m.device.id}\`${m.device.label ? ` · ${m.device.label}` : ''}${m.device.osVersion ? ` · ${m.device.osVersion}` : ''}`);
  lines.push(`- **Started**: ${m.startedAt}`);
  lines.push(`- **Completed**: ${m.completedAt ?? '(in progress)'}`);
  lines.push(`- **Artefacts**: ${m.artefacts.length}`);
  lines.push('');

  for (const s of sections) {
    lines.push(`## ${s.name}`);
    lines.push('');
    lines.push(`- Extracted: ${s.extractedAt}`);
    lines.push(`- Size: ${formatBytes(s.bytes)}`);
    if (s.sha256) lines.push(`- SHA-256: \`${s.sha256}\``);
    if (s.notes) lines.push(`- Notes: ${s.notes}`);
    lines.push('');
    // Brief preview only — full data lives in the per-artefact files.
    const data = (s.payload as { data?: unknown })?.data ?? s.payload;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const entries = Object.entries(data as Record<string, unknown>).slice(0, 20);
      for (const [k, v] of entries) lines.push(`- \`${k}\`: ${String(v ?? '')}`);
      if (Object.keys(data as object).length > 20) {
        lines.push(`- … (${Object.keys(data as object).length - 20} more keys in JSON file)`);
      }
    } else if (Array.isArray(data)) {
      lines.push(`- ${data.length} record(s); see JSON file for full data.`);
    } else if (s.rawPreview) {
      lines.push('```');
      lines.push(s.rawPreview.split('\n').slice(0, 30).join('\n'));
      lines.push('```');
    }
    lines.push('');
  }
  lines.push(`---`);
  lines.push(`Generated by RMPG Forensics Analysis · ${new Date().toISOString()}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
