import React, { useState } from 'react';
import {
  FileText,
  Loader2,
  Upload,
  Image,
  Download,
  X,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FolderPicker } from '../components/common';

type OutputFormat = 'separate_html' | 'unified_html';

interface ReportFormData {
  title: string;
  caseName: string;
  computerExpert: string;
  deviceOwner: string;
  deviceModel: string;
  serialNumber: string;
  systemVersion: string;
  comments: string;
  logoPath: string | null;
  outputFormat: OutputFormat;
}

const INITIAL_FORM: ReportFormData = {
  title: 'Avilla Acquisition Report',
  caseName: '',
  computerExpert: '',
  deviceOwner: '',
  deviceModel: '',
  serialNumber: '',
  systemVersion: '',
  comments: '',
  logoPath: null,
  outputFormat: 'unified_html',
};

export const AcquisitionReport: React.FC = () => {
  const [form, setForm] = useState<ReportFormData>(INITIAL_FORM);
  const [outputFolder, setOutputFolder] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const updateField = <K extends keyof ReportFormData>(key: K, value: ReportFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSuccess(null);
  };

  const handleLogoUpload = async () => {
    try {
      const result = (await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, {
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif'] }],
        properties: ['openFile'],
      })) as string[] | null;
      if (result && result.length > 0) {
        updateField('logoPath', result[0]);
        setLogoPreview(`file://${result[0]}`);
      }
    } catch {
      // Dialog cancelled
    }
  };

  const handleRemoveLogo = () => {
    updateField('logoPath', null);
    setLogoPreview(null);
  };

  const handleGenerate = async () => {
    if (!outputFolder) {
      setError('Please select an output folder.');
      return;
    }
    if (!form.caseName.trim()) {
      setError('Case Name is required.');
      return;
    }

    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const result = (await window.api.invoke(IPC_CHANNELS.REPORT_GENERATE, {
        ...form,
        outputPath: outputFolder,
        generatedAt: new Date().toISOString(),
      })) as { filePath: string } | undefined;

      setSuccess(
        result?.filePath
          ? `Report generated successfully: ${result.filePath}`
          : 'Report generated successfully.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleReset = () => {
    setForm(INITIAL_FORM);
    setLogoPreview(null);
    setError(null);
    setSuccess(null);
  };

  const formFields: { key: keyof ReportFormData; label: string; placeholder: string; required?: boolean }[] = [
    { key: 'title', label: 'Report Title', placeholder: 'Avilla Acquisition Report' },
    { key: 'caseName', label: 'Case Name', placeholder: 'Enter case name or number', required: true },
    { key: 'computerExpert', label: 'Computer Expert', placeholder: 'Name of the forensic examiner' },
    { key: 'deviceOwner', label: 'Device Owner', placeholder: 'Name of the device owner' },
    { key: 'deviceModel', label: 'Device Model', placeholder: 'e.g., Samsung Galaxy S23' },
    { key: 'serialNumber', label: 'Serial Number', placeholder: 'Device serial or IMEI' },
    { key: 'systemVersion', label: 'System Version', placeholder: 'e.g., Android 14' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Acquisition Report"
        description="Generate forensic acquisition reports in HTML format"
        icon={<FileText size={24} />}
      />

      <div className="grid grid-cols-3 gap-6">
        {/* Left - Form fields */}
        <div className="col-span-2 space-y-4">
          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Report Information</h3>
            <div className="grid grid-cols-2 gap-4">
              {formFields.map(({ key, label, placeholder, required }) => (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                    {label}
                    {required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <input
                    type="text"
                    value={form[key] as string}
                    onChange={(e) => updateField(key, e.target.value)}
                    placeholder={placeholder}
                    disabled={generating}
                    className="input-field text-sm"
                  />
                </div>
              ))}
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                Comments / Additional Notes
              </label>
              <textarea
                value={form.comments}
                onChange={(e) => updateField('comments', e.target.value)}
                placeholder="Enter any additional comments, observations, or notes about the acquisition..."
                disabled={generating}
                rows={4}
                className="input-field text-sm resize-none"
              />
            </div>
          </div>

          {/* Output settings */}
          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Output Settings</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-[var(--text-muted)]">Output Format</label>
                <div className="space-y-2">
                  {[
                    { value: 'unified_html' as const, label: 'Unified HTML', desc: 'Single HTML file with all sections' },
                    { value: 'separate_html' as const, label: 'Separate HTML', desc: 'Multiple HTML files per section' },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        form.outputFormat === opt.value
                          ? 'border-[#6495ED] bg-blue-50'
                          : 'border-[var(--border-color)] hover:border-[var(--border-color)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="outputFormat"
                        value={opt.value}
                        checked={form.outputFormat === opt.value}
                        onChange={() => updateField('outputFormat', opt.value)}
                        disabled={generating}
                        className="mt-0.5 text-[#6495ED] focus:ring-[#6495ED]"
                      />
                      <div>
                        <span className="text-sm font-medium text-[var(--text-primary)]">{opt.label}</span>
                        <p className="text-xs text-[var(--text-muted)]">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <FolderPicker
                  label="Output Folder"
                  value={outputFolder}
                  onChange={setOutputFolder}
                  disabled={generating}
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              {success}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={generating || !outputFolder}
              className="btn-primary flex flex-1 items-center justify-center gap-2"
            >
              {generating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              {generating ? 'Generating Report...' : 'Generate Report'}
            </button>
            <button
              onClick={handleReset}
              disabled={generating}
              className="btn-secondary"
            >
              Reset Form
            </button>
          </div>
        </div>

        {/* Right - Logo & Preview */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Organization Logo</h3>
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-32 w-full items-center justify-center rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-hover)]">
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="max-h-28 max-w-full object-contain"
                  />
                ) : (
                  <div className="text-center">
                    <Image size={32} className="mx-auto mb-1 text-[var(--text-muted)]" />
                    <p className="text-xs text-[var(--text-muted)]">No logo uploaded</p>
                  </div>
                )}
              </div>
              <div className="flex w-full gap-2">
                <button
                  onClick={handleLogoUpload}
                  disabled={generating}
                  className="btn-secondary flex flex-1 items-center justify-center gap-2 text-sm"
                >
                  <Upload size={14} />
                  Upload Logo
                </button>
                {logoPreview && (
                  <button
                    onClick={handleRemoveLogo}
                    disabled={generating}
                    className="btn-ghost !p-2 text-red-500 hover:text-red-700"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Report Preview</h3>
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-hover)] p-4 text-xs text-[var(--text-secondary)] space-y-2">
              <div className="border-b border-[var(--border-color)] pb-2 mb-2">
                <p className="font-semibold text-[var(--text-primary)] text-sm">{form.title || 'Report Title'}</p>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <span className="text-[var(--text-muted)]">Case:</span>
                <span>{form.caseName || '--'}</span>
                <span className="text-[var(--text-muted)]">Expert:</span>
                <span>{form.computerExpert || '--'}</span>
                <span className="text-[var(--text-muted)]">Owner:</span>
                <span>{form.deviceOwner || '--'}</span>
                <span className="text-[var(--text-muted)]">Model:</span>
                <span>{form.deviceModel || '--'}</span>
                <span className="text-[var(--text-muted)]">Serial:</span>
                <span className="font-mono">{form.serialNumber || '--'}</span>
                <span className="text-[var(--text-muted)]">OS:</span>
                <span>{form.systemVersion || '--'}</span>
              </div>
              {form.comments && (
                <div className="pt-2 border-t border-[var(--border-color)]">
                  <span className="text-[var(--text-muted)]">Notes:</span>
                  <p className="mt-1">{form.comments.substring(0, 120)}{form.comments.length > 120 ? '...' : ''}</p>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">About</h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Generates an HTML acquisition report compatible with the Avilla
              Forensics report format. Reports include device metadata, examiner
              information, hash values, and optional organization branding.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
