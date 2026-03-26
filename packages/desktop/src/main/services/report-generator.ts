import * as fs from 'fs/promises';
import * as path from 'path';
import type { WhatsAppChat, WhatsAppMessage, WhatsAppMediaType } from '@rmpg/shared';
import { formatDisplayDate, fromWhatsAppTimestamp } from '@rmpg/shared';

/**
 * Entry describing a media file for inclusion in the media report.
 */
export interface MediaFileEntry {
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** Optional thumbnail path (for images/videos). */
  thumbnailPath?: string;
  /** Category label (e.g. "Images", "Videos", "Documents"). */
  category: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an HTML report listing media files with thumbnails and metadata.
 *
 * Replaces the C# FormProcess.cs string-based HTML construction.
 * Uses Bootstrap 5 CDN for styling and responsive layout.
 *
 * @returns The absolute path of the generated HTML file.
 */
export async function generateMediaReport(config: {
  title: string;
  files: MediaFileEntry[];
  outputPath: string;
}): Promise<string> {
  const { title, files, outputPath } = config;

  // Group files by category
  const grouped = new Map<string, MediaFileEntry[]>();
  for (const file of files) {
    const list = grouped.get(file.category) ?? [];
    list.push(file);
    grouped.set(file.category, list);
  }

  const categorySections = Array.from(grouped.entries())
    .map(
      ([category, categoryFiles]) => `
      <div class="card mb-4">
        <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
          <h5 class="mb-0">${escapeHtml(category)}</h5>
          <span class="badge bg-light text-primary">${categoryFiles.length} file(s)</span>
        </div>
        <div class="card-body">
          <div class="table-responsive">
            <table class="table table-striped table-hover align-middle">
              <thead>
                <tr>
                  <th style="width: 50px">#</th>
                  <th>Preview</th>
                  <th>File Name</th>
                  <th>Type</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                ${categoryFiles
                  .map(
                    (file, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td>${renderMediaPreview(file)}</td>
                  <td>
                    <a href="file:///${escapeHtml(file.filePath.replace(/\\/g, '/'))}" target="_blank" class="text-decoration-none">
                      ${escapeHtml(file.fileName)}
                    </a>
                  </td>
                  <td><span class="badge bg-secondary">${escapeHtml(file.mimeType)}</span></td>
                  <td>${formatFileSize(file.size)}</td>
                </tr>`
                  )
                  .join('\n')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`
    )
    .join('\n');

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const html = buildHtmlPage({
    title,
    bodyContent: `
      <div class="container-fluid py-4">
        <div class="row mb-4">
          <div class="col">
            <h1 class="display-6">${escapeHtml(title)}</h1>
            <p class="text-muted">
              Generated: ${formatDisplayDate(new Date())} |
              Total files: ${files.length} |
              Total size: ${formatFileSize(totalSize)}
            </p>
          </div>
        </div>

        <div class="row mb-3">
          <div class="col">
            <div class="d-flex gap-3">
              ${Array.from(grouped.entries())
                .map(
                  ([cat, catFiles]) =>
                    `<div class="card text-center" style="min-width:120px">
                  <div class="card-body py-2">
                    <div class="fs-4 fw-bold text-primary">${catFiles.length}</div>
                    <small class="text-muted">${escapeHtml(cat)}</small>
                  </div>
                </div>`
                )
                .join('\n')}
            </div>
          </div>
        </div>

        ${categorySections}

        ${renderFooter()}
      </div>`,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf-8');
  return outputPath;
}

/**
 * Generate an HTML report for WhatsApp conversations.
 *
 * Replaces the C# WhatsParser.cs HTML generation. Renders each chat as a
 * collapsible section with a chat-bubble styled message list.
 *
 * @returns The absolute path of the generated HTML file.
 */
export async function generateWhatsAppReport(config: {
  chats: WhatsAppChat[];
  messages: Map<number, WhatsAppMessage[]>;
  outputPath: string;
  title?: string;
}): Promise<string> {
  const { chats, messages, outputPath, title = 'WhatsApp Report' } = config;

  const totalMessages = Array.from(messages.values()).reduce((sum, m) => sum + m.length, 0);

  const chatSections = chats
    .map((chat) => {
      const chatMessages = messages.get(chat.id) ?? [];
      if (chatMessages.length === 0) return '';

      const chatLabel = chat.isGroup ? '(Group)' : '(Direct)';

      return `
      <div class="card mb-4">
        <div class="card-header bg-success text-white" data-bs-toggle="collapse" data-bs-target="#chat-${chat.id}" role="button" aria-expanded="false">
          <div class="d-flex justify-content-between align-items-center">
            <h5 class="mb-0">${escapeHtml(chat.displayName)} <small>${chatLabel}</small></h5>
            <span class="badge bg-light text-success">${chatMessages.length} message(s)</span>
          </div>
          <small>${escapeHtml(chat.jid)}</small>
        </div>
        <div class="collapse" id="chat-${chat.id}">
          <div class="card-body" style="max-height: 600px; overflow-y: auto; background-color: #ece5dd;">
            ${chatMessages.map((msg) => renderChatMessage(msg)).join('\n')}
          </div>
        </div>
      </div>`;
    })
    .filter((s) => s.length > 0)
    .join('\n');

  const html = buildHtmlPage({
    title,
    bodyContent: `
      <div class="container-fluid py-4">
        <div class="row mb-4">
          <div class="col">
            <h1 class="display-6">${escapeHtml(title)}</h1>
            <p class="text-muted">
              Generated: ${formatDisplayDate(new Date())} |
              Chats: ${chats.length} |
              Messages: ${totalMessages}
            </p>
          </div>
        </div>

        <div class="row mb-3">
          <div class="col">
            <div class="d-flex gap-3 flex-wrap">
              <div class="card text-center" style="min-width:120px">
                <div class="card-body py-2">
                  <div class="fs-4 fw-bold text-success">${chats.length}</div>
                  <small class="text-muted">Chats</small>
                </div>
              </div>
              <div class="card text-center" style="min-width:120px">
                <div class="card-body py-2">
                  <div class="fs-4 fw-bold text-success">${totalMessages}</div>
                  <small class="text-muted">Messages</small>
                </div>
              </div>
              <div class="card text-center" style="min-width:120px">
                <div class="card-body py-2">
                  <div class="fs-4 fw-bold text-success">${chats.filter((c) => c.isGroup).length}</div>
                  <small class="text-muted">Groups</small>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p class="text-muted mb-3"><em>Click on a chat header to expand or collapse the conversation.</em></p>

        ${chatSections}

        ${renderFooter()}
      </div>`,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf-8');
  return outputPath;
}

// ---------------------------------------------------------------------------
// HTML template helpers
// ---------------------------------------------------------------------------

function buildHtmlPage(opts: { title: string; bodyContent: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(opts.title)} - RMPG Forensics Analysis</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
        rel="stylesheet"
        integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YcnS/1fk8CF0mN/EGO3QsYy4m9qpbwmvJq7"
        crossorigin="anonymous">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8f9fa;
    }
    .chat-bubble {
      max-width: 75%;
      padding: 8px 14px;
      border-radius: 10px;
      margin-bottom: 6px;
      word-wrap: break-word;
      position: relative;
    }
    .chat-bubble.sent {
      background-color: #dcf8c6;
      margin-left: auto;
    }
    .chat-bubble.received {
      background-color: #ffffff;
      margin-right: auto;
    }
    .chat-bubble .sender {
      font-weight: bold;
      font-size: 0.8rem;
      color: #075e54;
      margin-bottom: 2px;
    }
    .chat-bubble .timestamp {
      font-size: 0.7rem;
      color: #999;
      text-align: right;
      margin-top: 4px;
    }
    .chat-bubble .media-badge {
      display: inline-block;
      padding: 2px 8px;
      background: #e0e0e0;
      border-radius: 4px;
      font-size: 0.75rem;
      color: #555;
      margin-bottom: 4px;
    }
    .media-thumb {
      max-width: 100px;
      max-height: 100px;
      object-fit: cover;
      border-radius: 4px;
    }
    .footer-info {
      border-top: 1px solid #dee2e6;
      padding-top: 1rem;
      margin-top: 2rem;
      text-align: center;
      color: #6c757d;
    }
  </style>
</head>
<body>
  ${opts.bodyContent}
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
          integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz"
          crossorigin="anonymous"></script>
</body>
</html>`;
}

function renderChatMessage(msg: WhatsAppMessage): string {
  const bubbleClass = msg.isFromMe ? 'sent' : 'received';
  const alignClass = msg.isFromMe ? 'd-flex justify-content-end' : 'd-flex justify-content-start';
  const senderLabel = msg.isFromMe ? 'You' : msg.senderName || msg.senderJid || 'Unknown';
  const timestamp = msg.timestamp
    ? formatDisplayDate(fromWhatsAppTimestamp(msg.timestamp))
    : '';

  let mediaHtml = '';
  if (msg.mediaType) {
    mediaHtml = `<div class="media-badge">${getMediaIcon(msg.mediaType)} ${msg.mediaType}</div><br>`;
  }

  return `
    <div class="${alignClass}">
      <div class="chat-bubble ${bubbleClass}">
        <div class="sender">${escapeHtml(senderLabel)}</div>
        ${mediaHtml}
        <div>${escapeHtml(msg.text || '')}</div>
        ${msg.latitude && msg.longitude ? `<div class="media-badge">Location: ${msg.latitude}, ${msg.longitude}</div>` : ''}
        <div class="timestamp">${escapeHtml(timestamp)}</div>
      </div>
    </div>`;
}

function renderMediaPreview(file: MediaFileEntry): string {
  if (file.mimeType.startsWith('image/')) {
    const src = file.thumbnailPath || file.filePath;
    return `<img src="file:///${escapeHtml(src.replace(/\\/g, '/'))}" class="media-thumb" alt="${escapeHtml(file.fileName)}" onerror="this.style.display='none'">`;
  }
  if (file.mimeType.startsWith('video/')) {
    return `<span class="badge bg-info">Video</span>`;
  }
  if (file.mimeType.startsWith('audio/')) {
    return `<span class="badge bg-warning text-dark">Audio</span>`;
  }
  return `<span class="badge bg-secondary">File</span>`;
}

function renderFooter(): string {
  return `
    <div class="footer-info">
      <p>Report generated by <strong>RMPG Forensics Analysis</strong></p>
      <p><small>This report is intended for forensic analysis purposes only.
      All data should be handled in accordance with applicable legal and privacy requirements.</small></p>
    </div>`;
}

function getMediaIcon(mediaType: WhatsAppMediaType): string {
  switch (mediaType) {
    case 'image':      return '[Image]';
    case 'video':      return '[Video]';
    case 'audio':      return '[Audio]';
    case 'voice_note': return '[Voice]';
    case 'document':   return '[Doc]';
    case 'sticker':    return '[Sticker]';
    case 'contact':    return '[Contact]';
    case 'location':   return '[Location]';
    default:           return '[Media]';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
