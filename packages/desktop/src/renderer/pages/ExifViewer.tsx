import React, { useState, useMemo } from 'react';
import {
  Camera,
  Play,
  Loader2,
  FileImage,
  Download,
  Search,
  MapPin,
  Clock,
  Aperture,
  ChevronDown,
  ChevronRight,
  FolderOpen,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FilePicker, FolderPicker, LogConsole } from '../components/common';
import { useIpc } from '../hooks';

type InputMode = 'file' | 'directory';

interface ExifData {
  id: string;
  filename: string;
  path: string;
  fields: Record<string, string>;
  hasThumbnail: boolean;
  hasGps: boolean;
}

const EXIF_CATEGORIES: Record<string, string[]> = {
  Camera: ['Make', 'Model', 'LensModel', 'LensInfo', 'BodySerialNumber', 'LensSerialNumber'],
  Exposure: ['ExposureTime', 'FNumber', 'ISO', 'ExposureProgram', 'ExposureCompensation', 'MeteringMode'],
  Image: ['ImageWidth', 'ImageHeight', 'Orientation', 'ColorSpace', 'XResolution', 'YResolution', 'BitsPerSample'],
  GPS: ['GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSTimeStamp', 'GPSDateStamp', 'GPSVersionID'],
  DateTime: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'DateTimeDigitized'],
  Software: ['Software', 'HostComputer', 'ProcessingSoftware'],
};

export const ExifViewer: React.FC = () => {
  const ipc = useIpc();

  const [inputMode, setInputMode] = useState<InputMode>('file');
  const [filePath, setFilePath] = useState('');
  const [dirPath, setDirPath] = useState('');
  const [reading, setReading] = useState(false);
  const [results, setResults] = useState<ExifData[]>([]);
  const [selectedFile, setSelectedFile] = useState<ExifData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(EXIF_CATEGORIES))
  );

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleRead = async () => {
    const path = inputMode === 'file' ? filePath : dirPath;
    if (!path) return;
    setReading(true);
    setResults([]);
    setSelectedFile(null);
    addLog(`Reading EXIF data from: ${path}`);

    try {
      const result = await ipc.invoke<{
        success: boolean;
        data?: ExifData[];
        message?: string;
      }>(IPC_CHANNELS.EXIF_READ, {
        path,
        mode: inputMode,
      });

      if (result?.success && result.data) {
        setResults(result.data);
        addLog(`Read EXIF data from ${result.data.length} file(s).`);
        if (result.data.length === 1) {
          setSelectedFile(result.data[0]);
        }
      } else {
        addLog(`Failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReading(false);
    }
  };

  const handleExport = async () => {
    if (results.length === 0) return;
    try {
      const savePath = await ipc.invoke<string>(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'JSON Files', extensions: ['json'] },
        ],
        defaultPath: `exif_data_${Date.now()}.csv`,
      });
      if (savePath) {
        if (savePath.endsWith('.json')) {
          const json = JSON.stringify(
            results.map((r) => ({ filename: r.filename, path: r.path, ...r.fields })),
            null,
            2
          );
          await ipc.invoke('fs:write-file', savePath, json);
        } else {
          const allKeys = new Set<string>();
          results.forEach((r) => Object.keys(r.fields).forEach((k) => allKeys.add(k)));
          const keys = Array.from(allKeys);
          const header = ['Filename', 'Path', ...keys].join(',');
          const rows = results.map(
            (r) =>
              `"${r.filename}","${r.path}",${keys.map((k) => `"${r.fields[k] ?? ''}"`).join(',')}`
          );
          await ipc.invoke('fs:write-file', savePath, [header, ...rows].join('\n'));
        }
        addLog(`Exported ${results.length} file(s) to: ${savePath}`);
      }
    } catch (err) {
      addLog(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const filteredFields = useMemo(() => {
    if (!selectedFile) return {};
    if (!searchTerm) return selectedFile.fields;
    const lower = searchTerm.toLowerCase();
    return Object.fromEntries(
      Object.entries(selectedFile.fields).filter(
        ([key, value]) =>
          key.toLowerCase().includes(lower) || value.toLowerCase().includes(lower)
      )
    );
  }, [selectedFile, searchTerm]);

  const getCategoryFields = (category: string) => {
    const categoryKeys = EXIF_CATEGORIES[category] || [];
    return Object.entries(filteredFields).filter(([key]) =>
      categoryKeys.some((ck) => key.toLowerCase().includes(ck.toLowerCase()))
    );
  };

  const getUncategorizedFields = () => {
    const allCategoryKeys = Object.values(EXIF_CATEGORIES).flat();
    return Object.entries(filteredFields).filter(
      ([key]) => !allCategoryKeys.some((ck) => key.toLowerCase().includes(ck.toLowerCase()))
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="EXIF Viewer"
        description="View and extract EXIF metadata from images using jExifTool -- camera info, GPS coordinates, timestamps, and more"
        icon={<Camera size={24} />}
      />

      {/* Input configuration */}
      <div className="card">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-3">
            {/* Mode toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setInputMode('file')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === 'file'
                    ? 'bg-[#6495ED] text-white'
                    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
                disabled={reading}
              >
                <FileImage size={14} />
                Single File
              </button>
              <button
                onClick={() => setInputMode('directory')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === 'directory'
                    ? 'bg-[#6495ED] text-white'
                    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
                disabled={reading}
              >
                <FolderOpen size={14} />
                Batch (Directory)
              </button>
            </div>

            {inputMode === 'file' ? (
              <FilePicker
                label="Image File"
                value={filePath}
                onChange={setFilePath}
                placeholder="Select an image file..."
                filters={[
                  {
                    name: 'Images',
                    extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'heic', 'heif', 'raw', 'cr2', 'nef', 'arw'],
                  },
                  { name: 'All Files', extensions: ['*'] },
                ]}
                disabled={reading}
              />
            ) : (
              <FolderPicker
                label="Image Directory"
                value={dirPath}
                onChange={setDirPath}
                disabled={reading}
              />
            )}
          </div>

          <div className="flex flex-col justify-end gap-2">
            <button
              onClick={handleRead}
              disabled={reading || (inputMode === 'file' ? !filePath : !dirPath)}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {reading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {reading ? 'Reading...' : 'Read EXIF Data'}
            </button>
            {results.length > 0 && (
              <button
                onClick={handleExport}
                className="btn-secondary flex items-center justify-center gap-1.5 text-sm"
              >
                <Download size={14} />
                Export Results
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results layout */}
      {results.length > 0 && (
        <div className="flex gap-4">
          {/* File list (for batch mode) */}
          {results.length > 1 && (
            <div className="w-56 shrink-0">
              <div className="card p-3 space-y-2">
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  Files ({results.length})
                </h3>
                <div className="max-h-[500px] overflow-y-auto space-y-0.5">
                  {results.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => {
                        setSelectedFile(file);
                        setSearchTerm('');
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                        selectedFile?.id === file.id
                          ? 'bg-[#6495ED] text-white'
                          : 'text-[var(--text-primary)] hover:bg-[#2a2f3a]'
                      }`}
                    >
                      <p className="font-medium truncate">{file.filename}</p>
                      <div className="flex gap-2 mt-0.5">
                        {file.hasGps && (
                          <MapPin
                            size={10}
                            className={selectedFile?.id === file.id ? 'text-blue-100' : 'text-[#6495ED]'}
                          />
                        )}
                        <span
                          className={`text-[10px] ${
                            selectedFile?.id === file.id ? 'text-blue-100' : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {Object.keys(file.fields).length} fields
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* EXIF data display */}
          <div className="flex-1">
            {selectedFile ? (
              <div className="card space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">{selectedFile.filename}</h3>
                    <p className="text-xs text-[var(--text-muted)] font-mono">{selectedFile.path}</p>
                  </div>
                  <div className="flex gap-2">
                    {selectedFile.hasGps && (
                      <span className="badge-info flex items-center gap-1 text-[10px]">
                        <MapPin size={10} />
                        GPS
                      </span>
                    )}
                    <span className="badge text-[10px] bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                      {Object.keys(selectedFile.fields).length} fields
                    </span>
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search EXIF fields..."
                    className="input-field pl-9 text-sm"
                  />
                </div>

                {/* Categorized fields */}
                <div className="space-y-2 max-h-[450px] overflow-y-auto">
                  {Object.keys(EXIF_CATEGORIES).map((category) => {
                    const fields = getCategoryFields(category);
                    if (fields.length === 0) return null;
                    const isExpanded = expandedCategories.has(category);

                    return (
                      <div key={category} className="border border-[var(--border-color)] rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleCategory(category)}
                          className="w-full flex items-center justify-between px-3 py-2 bg-[var(--bg-hover)] hover:bg-[#2a2f3a] transition-colors"
                        >
                          <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {category}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">{fields.length}</span>
                        </button>
                        {isExpanded && (
                          <div className="divide-y divide-[var(--border-color)]">
                            {fields.map(([key, value]) => (
                              <div key={key} className="flex px-3 py-1.5 hover:bg-[var(--bg-hover)]">
                                <span className="text-xs text-[var(--text-muted)] w-48 shrink-0 truncate">
                                  {key}
                                </span>
                                <span className="text-xs text-[var(--text-primary)] font-mono">{value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Uncategorized fields */}
                  {getUncategorizedFields().length > 0 && (
                    <div className="border border-[var(--border-color)] rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleCategory('Other')}
                        className="w-full flex items-center justify-between px-3 py-2 bg-[var(--bg-hover)] hover:bg-[#2a2f3a]"
                      >
                        <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                          {expandedCategories.has('Other') ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronRight size={12} />
                          )}
                          Other
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {getUncategorizedFields().length}
                        </span>
                      </button>
                      {expandedCategories.has('Other') && (
                        <div className="divide-y divide-[var(--border-color)]">
                          {getUncategorizedFields().map(([key, value]) => (
                            <div key={key} className="flex px-3 py-1.5 hover:bg-[var(--bg-hover)]">
                              <span className="text-xs text-[var(--text-muted)] w-48 shrink-0 truncate">{key}</span>
                              <span className="text-xs text-[var(--text-primary)] font-mono">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="card flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
                <Camera size={32} className="mb-3" />
                <p className="text-sm">Select a file to view EXIF data</p>
              </div>
            )}
          </div>
        </div>
      )}

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
