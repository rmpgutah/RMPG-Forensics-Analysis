import React, { useState } from 'react';
import { ScanLine, Play, Copy, Check, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FilePicker, ToolStatus } from '../components/common';
import { useProcess } from '../hooks';

const LANGUAGES = [
  { value: 'eng', label: 'English' },
  { value: 'por', label: 'Portuguese' },
  { value: 'spa', label: 'Spanish' },
  { value: 'fra', label: 'French' },
  { value: 'deu', label: 'German' },
  { value: 'ita', label: 'Italian' },
  { value: 'jpn', label: 'Japanese' },
  { value: 'kor', label: 'Korean' },
  { value: 'chi_sim', label: 'Chinese (Simplified)' },
];

export const OcrProcessing: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.OCR_PROCESS,
    progressChannel: IPC_CHANNELS.OCR_PROCESS_PROGRESS,
  });

  const [filePath, setFilePath] = useState('');
  const [language, setLanguage] = useState('eng');
  const [extractedText, setExtractedText] = useState('');
  const [copied, setCopied] = useState(false);

  const handleProcess = async () => {
    if (!filePath) return;
    setExtractedText('');
    const result = await process.start({
      filePath,
      language,
    });
    if (result && typeof result === 'object' && 'text' in result) {
      setExtractedText((result as { text: string }).text);
    } else if (typeof result === 'string') {
      setExtractedText(result);
    }
  };

  const handleCopy = async () => {
    if (!extractedText) return;
    try {
      await navigator.clipboard.writeText(extractedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access may fail
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="OCR Processing"
        description="Extract text from images using Tesseract optical character recognition"
        icon={<ScanLine size={24} />}
      />

      <ToolStatus toolName="tesseract" label="Tesseract OCR" />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <FilePicker
            label="Image File"
            value={filePath}
            onChange={setFilePath}
            placeholder="Select an image file..."
            filters={[
              {
                name: 'Image Files',
                extensions: ['png', 'jpg', 'jpeg', 'tiff', 'tif', 'bmp', 'webp', 'gif'],
              },
            ]}
            disabled={process.isRunning}
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[var(--text-primary)]">
              OCR Language
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={process.isRunning}
              className="input-field w-full"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleProcess}
            disabled={process.isRunning || !filePath}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {process.isRunning ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {process.isRunning ? 'Processing...' : 'Run OCR'}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-medium text-[var(--text-primary)]">Extracted Text</h4>
              {extractedText && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition"
                >
                  {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            {/*
              `wrap="off"` keeps OCR output line-for-line with the source
              document — long table rows and pre-formatted blocks scroll
              horizontally instead of soft-wrapping, which would otherwise
              shred the column layout. `whiteSpace: pre` matches that on
              the rendering side. Tall default height so multi-page docs
              show enough context without immediate scrolling.
            */}
            <textarea
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              placeholder="OCR results will appear here..."
              readOnly={process.isRunning}
              wrap="off"
              spellCheck={false}
              style={{ whiteSpace: 'pre', tabSize: 4 }}
              className="h-[520px] w-full resize-y overflow-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 font-mono text-xs leading-relaxed text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#6495ED]/50"
            />
          </div>
        </div>
      </div>

      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
