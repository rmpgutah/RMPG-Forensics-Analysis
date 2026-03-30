import React, { useState, useMemo } from 'react';
import {
  ImageIcon,
  Search,
  Loader2,
  MapPin,
  Grid3X3,
  List,
  Filter,
  Download,
  X,
  Calendar,
  Hash,
  Camera,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

type SearchMode = 'hash' | 'exif' | 'geolocation';
type ViewMode = 'grid' | 'list';

interface ImageResult {
  id: string;
  path: string;
  filename: string;
  thumbnail?: string;
  hash: string;
  size: number;
  width: number;
  height: number;
  mimeType: string;
  dateTaken?: string;
  cameraMake?: string;
  cameraModel?: string;
  latitude?: number;
  longitude?: number;
  tags?: string[];
}

export const ImageFinder: React.FC = () => {
  const ipc = useIpc();

  const [searchMode, setSearchMode] = useState<SearchMode>('hash');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sourceDir, setSourceDir] = useState('');
  const [hashQuery, setHashQuery] = useState('');
  const [exifQuery, setExifQuery] = useState('');
  const [geoLat, setGeoLat] = useState('');
  const [geoLng, setGeoLng] = useState('');
  const [geoRadius, setGeoRadius] = useState('1.0');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [filterText, setFilterText] = useState('');

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleSearch = async () => {
    if (!sourceDir) return;
    setSearching(true);
    setResults([]);
    setSelectedImage(null);

    const params: Record<string, unknown> = {
      sourceDir,
      mode: searchMode,
    };

    if (searchMode === 'hash') {
      params.hash = hashQuery;
      addLog(`Searching by hash: ${hashQuery || '(indexing all)'}`);
    } else if (searchMode === 'exif') {
      params.exifQuery = exifQuery;
      params.dateFrom = dateFrom || undefined;
      params.dateTo = dateTo || undefined;
      addLog(`Searching EXIF metadata: "${exifQuery}"`);
    } else {
      params.latitude = parseFloat(geoLat);
      params.longitude = parseFloat(geoLng);
      params.radiusKm = parseFloat(geoRadius);
      addLog(`Searching geolocation: ${geoLat}, ${geoLng} (radius: ${geoRadius}km)`);
    }

    try {
      const result = await ipc.invoke<{
        success: boolean;
        images?: ImageResult[];
        message?: string;
      }>(IPC_CHANNELS.IMAGE_SEARCH, params);

      if (result?.success && result.images) {
        setResults(result.images);
        addLog(`Found ${result.images.length} images.`);
      } else {
        addLog(`Search failed: ${result?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSearching(false);
    }
  };

  const handleExport = async () => {
    if (results.length === 0) return;
    try {
      const savePath = await ipc.invoke<string>(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        defaultPath: `image_search_${Date.now()}.csv`,
      });
      if (savePath) {
        const csv = [
          'Filename,Path,Hash,Size,Dimensions,Date Taken,Camera,Latitude,Longitude',
          ...results.map(
            (r) =>
              `"${r.filename}","${r.path}","${r.hash}",${r.size},"${r.width}x${r.height}","${r.dateTaken ?? ''}","${r.cameraMake ?? ''} ${r.cameraModel ?? ''}",${r.latitude ?? ''},${r.longitude ?? ''}`
          ),
        ].join('\n');
        await ipc.invoke('fs:write-file', savePath, csv);
        addLog(`Exported ${results.length} results to CSV.`);
      }
    } catch {
      addLog('Export failed.');
    }
  };

  const filteredResults = useMemo(() => {
    if (!filterText) return results;
    const lower = filterText.toLowerCase();
    return results.filter(
      (r) =>
        r.filename.toLowerCase().includes(lower) ||
        r.hash.toLowerCase().includes(lower) ||
        r.cameraMake?.toLowerCase().includes(lower) ||
        r.cameraModel?.toLowerCase().includes(lower)
    );
  }, [results, filterText]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Image Finder"
        description="Search images by hash, EXIF metadata, or geolocation across extracted forensic data"
        icon={<ImageIcon size={24} />}
      />
      <div className="flex items-center">
        <span className="badge bg-yellow-100 text-yellow-700 text-[10px]">BETA</span>
      </div>

      {/* Search configuration */}
      <div className="card">
        <div className="space-y-4">
          <FolderPicker
            label="Source Directory"
            value={sourceDir}
            onChange={setSourceDir}
            disabled={searching}
          />

          {/* Search mode tabs */}
          <div className="flex gap-2">
            {([
              { key: 'hash', label: 'Hash Search', icon: <Hash size={14} /> },
              { key: 'exif', label: 'EXIF Metadata', icon: <Camera size={14} /> },
              { key: 'geolocation', label: 'Geolocation', icon: <MapPin size={14} /> },
            ] as const).map((mode) => (
              <button
                key={mode.key}
                onClick={() => setSearchMode(mode.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  searchMode === mode.key
                    ? 'bg-[#6495ED] text-white'
                    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
                disabled={searching}
              >
                {mode.icon}
                {mode.label}
              </button>
            ))}
          </div>

          {/* Mode-specific inputs */}
          {searchMode === 'hash' && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Image Hash (MD5/SHA1/SHA256)
              </label>
              <input
                type="text"
                value={hashQuery}
                onChange={(e) => setHashQuery(e.target.value)}
                placeholder="Enter hash or leave empty to index all images..."
                className="input-field font-mono"
                disabled={searching}
              />
            </div>
          )}

          {searchMode === 'exif' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  EXIF Search Query
                </label>
                <input
                  type="text"
                  value={exifQuery}
                  onChange={(e) => setExifQuery(e.target.value)}
                  placeholder="Camera model, lens, etc."
                  className="input-field"
                  disabled={searching}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Date From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="input-field"
                  disabled={searching}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Date To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="input-field"
                  disabled={searching}
                />
              </div>
            </div>
          )}

          {searchMode === 'geolocation' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Latitude</label>
                <input
                  type="number"
                  value={geoLat}
                  onChange={(e) => setGeoLat(e.target.value)}
                  placeholder="40.7128"
                  step="0.0001"
                  className="input-field"
                  disabled={searching}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Longitude</label>
                <input
                  type="number"
                  value={geoLng}
                  onChange={(e) => setGeoLng(e.target.value)}
                  placeholder="-74.0060"
                  step="0.0001"
                  className="input-field"
                  disabled={searching}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Radius (km)
                </label>
                <input
                  type="number"
                  value={geoRadius}
                  onChange={(e) => setGeoRadius(e.target.value)}
                  placeholder="1.0"
                  step="0.1"
                  min="0.1"
                  className="input-field"
                  disabled={searching}
                />
              </div>
            </div>
          )}

          <button
            onClick={handleSearch}
            disabled={searching || !sourceDir}
            className="btn-primary flex items-center gap-2"
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {searching ? 'Searching...' : 'Search Images'}
          </button>
        </div>
      </div>

      {/* Results toolbar */}
      {results.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="text-sm text-[var(--text-secondary)] font-medium">{filteredResults.length} images</p>
            <div className="relative">
              <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter results..."
                className="input-field pl-8 py-1.5 text-xs w-60"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-[#6495ED] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Grid3X3 size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-[#6495ED] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <List size={16} />
            </button>
            <button onClick={handleExport} className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3">
              <Download size={12} />
              Export
            </button>
          </div>
        </div>
      )}

      {/* Results display */}
      <div className="flex gap-6">
        <div className="flex-1">
          {searching && (
            <div className="card flex items-center justify-center py-16">
              <div className="text-center">
                <Loader2 size={32} className="animate-spin text-[#6495ED] mx-auto mb-3" />
                <p className="text-sm text-[var(--text-secondary)]">Scanning images...</p>
              </div>
            </div>
          )}

          {!searching && results.length > 0 && viewMode === 'grid' && (
            <div className="grid grid-cols-5 gap-3">
              {filteredResults.map((img) => (
                <div
                  key={img.id}
                  onClick={() => setSelectedImage(img)}
                  className={`card p-2 cursor-pointer transition-all hover:shadow-md ${
                    selectedImage?.id === img.id ? 'ring-2 ring-[#6495ED]' : ''
                  }`}
                >
                  <div className="aspect-square bg-[var(--bg-hover)] rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                    {img.thumbnail ? (
                      <img src={img.thumbnail} alt={img.filename} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={24} className="text-[var(--text-muted)]" />
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text-primary)] truncate font-medium">{img.filename}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">{formatSize(img.size)}</p>
                  {img.latitude && img.longitude && (
                    <MapPin size={10} className="text-[#6495ED] mt-0.5" />
                  )}
                </div>
              ))}
            </div>
          )}

          {!searching && results.length > 0 && viewMode === 'list' && (
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-hover)]">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Filename</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Size</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Dimensions</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Hash</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">GPS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {filteredResults.map((img) => (
                    <tr
                      key={img.id}
                      onClick={() => setSelectedImage(img)}
                      className={`cursor-pointer hover:bg-[var(--bg-hover)] ${
                        selectedImage?.id === img.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="px-3 py-2 text-xs font-medium text-[var(--text-primary)] truncate max-w-[200px]">
                        {img.filename}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{formatSize(img.size)}</td>
                      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{img.width}x{img.height}</td>
                      <td className="px-3 py-2 text-xs font-mono text-[var(--text-muted)] truncate max-w-[120px]">
                        {img.hash}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{img.dateTaken ?? '--'}</td>
                      <td className="px-3 py-2 text-xs">
                        {img.latitude && img.longitude ? (
                          <MapPin size={12} className="text-[#6495ED]" />
                        ) : (
                          <span className="text-[var(--text-muted)]">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedImage && (
          <div className="w-72 shrink-0">
            <div className="card space-y-3 sticky top-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">{selectedImage.filename}</h4>
                <button onClick={() => setSelectedImage(null)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                  <X size={14} />
                </button>
              </div>

              <div className="aspect-video bg-[var(--bg-hover)] rounded-lg flex items-center justify-center overflow-hidden">
                {selectedImage.thumbnail ? (
                  <img src={selectedImage.thumbnail} alt={selectedImage.filename} className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon size={32} className="text-[var(--text-muted)]" />
                )}
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Path</span>
                  <span className="text-[var(--text-primary)] font-mono text-[10px] max-w-[180px] truncate text-right">
                    {selectedImage.path}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Hash</span>
                  <span className="text-[var(--text-primary)] font-mono text-[10px] max-w-[160px] truncate">
                    {selectedImage.hash}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Size</span>
                  <span className="text-[var(--text-primary)]">{formatSize(selectedImage.size)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Dimensions</span>
                  <span className="text-[var(--text-primary)]">{selectedImage.width}x{selectedImage.height}</span>
                </div>
                {selectedImage.dateTaken && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Date Taken</span>
                    <span className="text-[var(--text-primary)]">{selectedImage.dateTaken}</span>
                  </div>
                )}
                {selectedImage.cameraMake && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Camera</span>
                    <span className="text-[var(--text-primary)]">
                      {selectedImage.cameraMake} {selectedImage.cameraModel}
                    </span>
                  </div>
                )}
                {selectedImage.latitude && selectedImage.longitude && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">GPS</span>
                    <span className="text-[var(--text-primary)] font-mono text-[10px]">
                      {selectedImage.latitude.toFixed(6)}, {selectedImage.longitude.toFixed(6)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
