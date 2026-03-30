import React, { useState } from 'react';
import {
  MapPin,
  Globe,
  FileDown,
  Upload,
  Loader2,
  Database,
  Image,
  Smartphone,
  FileSpreadsheet,
  Trash2,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, DeviceSelector, FolderPicker, FilePicker } from '../components/common';
import { useDeviceStatus } from '../hooks';

type ExtractionSource = 'device' | 'images' | 'database' | 'csv';

interface GeoPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
  timestamp?: string;
  source: string;
  label?: string;
}

export const GeolocationMapper: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();
  const [source, setSource] = useState<ExtractionSource>('device');
  const [filePath, setFilePath] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kmlName, setKmlName] = useState('forensic_locations');
  const [includeTimestamp, setIncludeTimestamp] = useState(true);
  const [includeAltitude, setIncludeAltitude] = useState(true);

  const sourceOptions: { key: ExtractionSource; label: string; icon: React.ReactNode; description: string }[] = [
    { key: 'device', label: 'Device GPS', icon: <Smartphone size={16} />, description: 'Extract cached GPS data from connected Android device' },
    { key: 'images', label: 'Image EXIF', icon: <Image size={16} />, description: 'Extract GPS coordinates from photo EXIF metadata' },
    { key: 'database', label: 'Database', icon: <Database size={16} />, description: 'Parse location data from SQLite databases' },
    { key: 'csv', label: 'CSV Import', icon: <FileSpreadsheet size={16} />, description: 'Import coordinates from CSV file (lat, lon columns)' },
  ];

  const handleExtract = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { source };
      if (source === 'device' && selectedDevice) {
        payload.serial = selectedDevice.serial;
      } else if (source !== 'device') {
        payload.filePath = filePath;
      }

      const result = (await window.api.invoke(IPC_CHANNELS.GEO_EXTRACT, payload)) as GeoPoint[];
      if (result && result.length > 0) {
        setPoints((prev) => [...prev, ...result]);
      } else {
        setError('No geolocation data found from the selected source.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateKml = async () => {
    if (points.length === 0 || !outputFolder) return;
    setGenerating(true);
    setError(null);
    try {
      await window.api.invoke(IPC_CHANNELS.GEO_GENERATE_KML, {
        points,
        outputPath: outputFolder,
        fileName: kmlName || 'forensic_locations',
        includeTimestamp,
        includeAltitude,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleExportCsv = async () => {
    if (points.length === 0 || !outputFolder) return;
    try {
      const csvPath = `${outputFolder}/${kmlName || 'forensic_locations'}.csv`;
      const header = 'Latitude,Longitude,Altitude,Timestamp,Source,Label';
      const rows = points.map(
        (p) => `${p.latitude},${p.longitude},${p.altitude ?? ''},${p.timestamp ?? ''},${p.source},${p.label ?? ''}`
      );
      await window.api.invoke('fs:write-file', csvPath, [header, ...rows].join('\n'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Geolocation Mapper"
        description="Extract GPS coordinates and generate KML files for Google Earth"
        icon={<MapPin size={24} />}
      />

      <div className="grid grid-cols-3 gap-6">
        {/* Left - Source Selection & Extraction */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Extraction Source</h3>
            <div className="space-y-2">
              {sourceOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setSource(opt.key);
                    setError(null);
                  }}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    source === opt.key
                      ? 'border-[#6495ED] bg-blue-50'
                      : 'border-[var(--border-color)] hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className={source === opt.key ? 'text-[#6495ED]' : 'text-[var(--text-muted)]'}>
                    {opt.icon}
                  </span>
                  <div>
                    <span className={`text-sm font-medium ${source === opt.key ? 'text-[#6495ED]' : 'text-[var(--text-primary)]'}`}>
                      {opt.label}
                    </span>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Source Input</h3>
            {source === 'device' ? (
              <DeviceSelector
                devices={allDevices}
                selected={selectedDevice}
                onSelect={selectDevice}
                onRefresh={refresh}
                filter="android"
                disabled={loading}
              />
            ) : (
              <FilePicker
                label={source === 'images' ? 'Image File or Folder' : source === 'database' ? 'SQLite Database' : 'CSV File'}
                value={filePath}
                onChange={setFilePath}
                disabled={loading}
                filters={
                  source === 'csv'
                    ? [{ name: 'CSV Files', extensions: ['csv'] }]
                    : source === 'database'
                    ? [{ name: 'SQLite DB', extensions: ['db', 'sqlite', 'sqlite3'] }]
                    : [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tiff'] }]
                }
              />
            )}

            <button
              onClick={handleExtract}
              disabled={loading || (source === 'device' ? !selectedDevice : !filePath)}
              className="btn-primary mt-4 flex w-full items-center justify-center gap-2 text-sm"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {loading ? 'Extracting...' : 'Extract GPS Data'}
            </button>
          </div>
        </div>

        {/* Middle - Results Table */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Extracted Points ({points.length})
              </h3>
              {points.length > 0 && (
                <button
                  onClick={() => setPoints([])}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                >
                  <Trash2 size={12} />
                  Clear
                </button>
              )}
            </div>

            <div className="max-h-[440px] overflow-y-auto rounded-lg border border-[var(--border-color)]">
              {points.length === 0 ? (
                <div className="py-12 text-center">
                  <Globe size={32} className="mx-auto mb-2 text-[var(--text-muted)]" />
                  <p className="text-sm text-[var(--text-muted)]">No points extracted yet.</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Select a source and extract GPS data.</p>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-[var(--bg-hover)] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-muted)]">#</th>
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-muted)]">Latitude</th>
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-muted)]">Longitude</th>
                      <th className="px-3 py-2 text-left font-medium text-[var(--text-muted)]">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {points.map((p, i) => (
                      <tr key={i} className="hover:bg-[#F0F0FF]">
                        <td className="px-3 py-1.5 text-[var(--text-muted)]">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-[var(--text-primary)]">{p.latitude.toFixed(6)}</td>
                        <td className="px-3 py-1.5 font-mono text-[var(--text-primary)]">{p.longitude.toFixed(6)}</td>
                        <td className="px-3 py-1.5 text-[var(--text-muted)]">{p.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Right - KML Generation */}
        <div className="col-span-1 space-y-4">
          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">KML Export</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Output File Name</label>
                <input
                  type="text"
                  value={kmlName}
                  onChange={(e) => setKmlName(e.target.value)}
                  className="input-field text-sm"
                  placeholder="forensic_locations"
                />
              </div>

              <FolderPicker
                label="Output Folder"
                value={outputFolder}
                onChange={setOutputFolder}
              />

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeTimestamp}
                    onChange={(e) => setIncludeTimestamp(e.target.checked)}
                    className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
                  />
                  Include timestamps
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAltitude}
                    onChange={(e) => setIncludeAltitude(e.target.checked)}
                    className="rounded border-[var(--border-color)] text-[#6495ED] focus:ring-[#6495ED]"
                  />
                  Include altitude data
                </label>
              </div>
            </div>
          </div>

          <button
            onClick={handleGenerateKml}
            disabled={generating || points.length === 0 || !outputFolder}
            className="btn-primary flex w-full items-center justify-center gap-2 text-sm"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
            {generating ? 'Generating...' : 'Generate KML for Google Earth'}
          </button>

          <button
            onClick={handleExportCsv}
            disabled={points.length === 0 || !outputFolder}
            className="btn-secondary flex w-full items-center justify-center gap-2 text-sm"
          >
            <FileDown size={14} />
            Export as CSV
          </button>

          <div className="card">
            <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Quick Info</h3>
            <ul className="space-y-1.5 text-xs text-[var(--text-muted)]">
              <li>KML files open directly in Google Earth</li>
              <li>EXIF extraction supports JPEG, PNG, and TIFF</li>
              <li>CSV must contain latitude and longitude columns</li>
              <li>Multiple sources can be combined before export</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
