import React, { useState, useEffect } from 'react';
import {
  Apple,
  Image,
  Camera,
  MapPin,
  Download,
  Loader2,
  Search,
  Grid3X3,
  List,
  Map,
  Calendar,
  FileDown,
  Trash2,
  Info,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  Maximize2,
  Filter,
  Clock,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PhotoRecord {
  id: string;
  filename: string;
  filePath: string;
  thumbnailPath: string;
  mediaType: 'photo' | 'video';
  dateTaken: string;
  dateCreated: string;
  dateModified: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAltitude: number | null;
  cameraMake: string;
  cameraModel: string;
  lensModel: string;
  focalLength: string;
  aperture: string;
  shutterSpeed: string;
  iso: number;
  width: number;
  height: number;
  fileSize: number;
  album: string;
  isFavorite: boolean;
  isDeleted: boolean;
  deletedDate: string;
  duration: number; // for videos, in seconds
  orientation: number;
}

interface PhotoStats {
  totalPhotos: number;
  totalVideos: number;
  totalSize: number;
  geotagged: number;
  deleted: number;
  albums: number;
  dateRange: { earliest: string; latest: string };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosPhotos: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [filteredPhotos, setFilteredPhotos] = useState<PhotoRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [stats, setStats] = useState<PhotoStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'map'>('grid');
  const [mediaFilter, setMediaFilter] = useState<string>('all');
  const [albumFilter, setAlbumFilter] = useState<string>('all');
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const [showGeoOnly, setShowGeoOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoRecord | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [extractProgress, setExtractProgress] = useState<number>(0);
  const pageSize = viewMode === 'grid' ? 60 : 50;

  const handleBrowseBackup = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, { title: 'Select iOS Backup Folder' });
      if (result) setBackupPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleBrowseOutput = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, { title: 'Select Output Folder' });
      if (result) setOutputPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleExtractMetadata = async () => {
    if (!backupPath) return;
    setLoading(true);
    setPhotos([]);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_PHOTOS_EXTRACT, {
        backupPath,
        metadataOnly: true,
        includeDeleted: true,
      }) as { photos: PhotoRecord[]; stats: PhotoStats };
      setPhotos(result.photos);
      setStats(result.stats);
    } catch (err) {
      console.error('Photo extraction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkExtract = async () => {
    if (!outputPath) return;
    setExtracting(true);
    setExtractProgress(0);
    try {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
      await window.api.invoke(IPC_CHANNELS.IOS_PHOTOS_EXTRACT, {
        backupPath,
        outputPath,
        preserveMetadata: true,
        photoIds: ids,
        extractAll: !ids,
      });
    } catch (err) {
      console.error('Bulk extract failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  useEffect(() => {
    const cleanup = window.api.on(IPC_CHANNELS.IOS_PHOTOS_EXTRACT_PROGRESS, (_event: unknown, data: { percent: number }) => {
      setExtractProgress(data.percent);
      if (data.percent >= 100) setExtracting(false);
    });
    return () => { cleanup?.(); };
  }, []);

  // Filters
  useEffect(() => {
    let result = [...photos];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.filename.toLowerCase().includes(q) ||
          p.album.toLowerCase().includes(q) ||
          p.cameraMake.toLowerCase().includes(q) ||
          p.cameraModel.toLowerCase().includes(q)
      );
    }

    if (mediaFilter !== 'all') result = result.filter((p) => p.mediaType === mediaFilter);
    if (albumFilter !== 'all') result = result.filter((p) => p.album === albumFilter);
    if (showDeletedOnly) result = result.filter((p) => p.isDeleted);
    if (showGeoOnly) result = result.filter((p) => p.gpsLatitude !== null);
    if (dateFrom) result = result.filter((p) => p.dateTaken >= dateFrom);
    if (dateTo) result = result.filter((p) => p.dateTaken <= dateTo);

    setFilteredPhotos(result);
    setCurrentPage(1);
  }, [photos, searchQuery, mediaFilter, albumFilter, showDeletedOnly, showGeoOnly, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredPhotos.length / pageSize);
  const paginatedPhotos = filteredPhotos.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const albums = Array.from(new Set(photos.map((p) => p.album).filter(Boolean))).sort();

  const toggleSelectPhoto = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Photos & Videos"
        description="Extract all photos and videos with full EXIF/metadata, GPS coordinates, Recently Deleted recovery, and map view"
        icon={<Apple size={24} />}
      />

      {/* Source + Output */}
      <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>iOS Backup Source</label>
            <div className="flex gap-2">
              <input type="text" value={backupPath} readOnly placeholder="Select iOS backup folder..." className="input-field flex-1" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              <button onClick={handleBrowseBackup} className="btn-secondary" disabled={loading || extracting}>Browse</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Output Folder</label>
            <div className="flex gap-2">
              <input type="text" value={outputPath} readOnly placeholder="Select output folder..." className="input-field flex-1" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              <button onClick={handleBrowseOutput} className="btn-secondary" disabled={extracting}>Browse</button>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExtractMetadata} className="btn-primary" disabled={!backupPath || loading}>
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <Image size={16} className="mr-2" />}
            {loading ? 'Scanning...' : 'Scan Photos & Videos'}
          </button>
          <button onClick={handleBulkExtract} className="btn-primary" disabled={!outputPath || extracting || photos.length === 0}>
            {extracting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Download size={16} className="mr-2" />}
            {selectedIds.size > 0 ? `Extract Selected (${selectedIds.size})` : 'Extract All'}
          </button>
        </div>
      </div>

      {/* Progress */}
      {extracting && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color: 'var(--text-primary)' }}>Extracting media files...</span>
            <span style={{ color: 'var(--text-secondary)' }}>{Math.round(extractProgress)}%</span>
          </div>
          <div className="w-full rounded-full h-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${extractProgress}%` }} />
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-6 gap-3">
          {[
            { label: 'Photos', value: stats.totalPhotos.toLocaleString(), color: 'text-green-400' },
            { label: 'Videos', value: stats.totalVideos.toLocaleString(), color: 'text-purple-400' },
            { label: 'Total Size', value: formatBytes(stats.totalSize), color: 'text-blue-400' },
            { label: 'Geotagged', value: stats.geotagged.toLocaleString(), color: 'text-cyan-400' },
            { label: 'Deleted (Recoverable)', value: stats.deleted.toLocaleString(), color: 'text-red-400' },
            { label: 'Albums', value: stats.albums.toLocaleString(), color: 'text-orange-400' },
          ].map((s) => (
            <div key={s.label} className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              <div className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters + View Toggle */}
      {photos.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by filename, camera, album..." className="input-field w-full pl-9" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            </div>

            <select value={mediaFilter} onChange={(e) => setMediaFilter(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
              <option value="all">All Media</option>
              <option value="photo">Photos</option>
              <option value="video">Videos</option>
            </select>

            <select value={albumFilter} onChange={(e) => setAlbumFilter(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
              <option value="all">All Albums</option>
              {albums.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>

            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            <span style={{ color: 'var(--text-muted)' }}>to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />

            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={showDeletedOnly} onChange={(e) => setShowDeletedOnly(e.target.checked)} />
              Deleted
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={showGeoOnly} onChange={(e) => setShowGeoOnly(e.target.checked)} />
              Geotagged
            </label>

            <div className="flex gap-1 ml-auto">
              <button onClick={() => setViewMode('grid')} className={`btn-secondary text-xs ${viewMode === 'grid' ? 'ring-1 ring-blue-400' : ''}`}><Grid3X3 size={14} /></button>
              <button onClick={() => setViewMode('list')} className={`btn-secondary text-xs ${viewMode === 'list' ? 'ring-1 ring-blue-400' : ''}`}><List size={14} /></button>
              <button onClick={() => setViewMode('map')} className={`btn-secondary text-xs ${viewMode === 'map' ? 'ring-1 ring-blue-400' : ''}`}><Map size={14} /></button>
            </div>
          </div>
          <div className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            {filteredPhotos.length.toLocaleString()} of {photos.length.toLocaleString()} items
          </div>
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && paginatedPhotos.length > 0 && (
        <div className="grid grid-cols-6 gap-3">
          {paginatedPhotos.map((photo) => (
            <div
              key={photo.id}
              className="card overflow-hidden cursor-pointer transition-all relative group"
              style={{ backgroundColor: 'var(--bg-card)', border: selectedIds.has(photo.id) ? '2px solid #3b82f6' : '1px solid var(--border-color)' }}
              onClick={() => setSelectedPhoto(photo)}
            >
              <div className="aspect-square flex items-center justify-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                {photo.thumbnailPath ? (
                  <img src={`file://${photo.thumbnailPath}`} alt={photo.filename} className="w-full h-full object-cover" />
                ) : (
                  <Camera size={32} style={{ color: 'var(--text-muted)' }} />
                )}
                {photo.isDeleted && (
                  <div className="absolute top-1 right-1">
                    <Trash2 size={14} className="text-red-400" />
                  </div>
                )}
                {photo.gpsLatitude !== null && (
                  <div className="absolute top-1 left-1">
                    <MapPin size={14} className="text-cyan-400" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Eye size={24} className="text-white" />
                </div>
              </div>
              <div className="p-2">
                <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{photo.filename}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {photo.width}x{photo.height} &middot; {formatBytes(photo.fileSize)}
                </div>
              </div>
              <button
                className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); toggleSelectPhoto(photo.id); }}
              >
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${selectedIds.has(photo.id) ? 'bg-blue-500 border-blue-500' : 'border-white/60'}`}>
                  {selectedIds.has(photo.id) && <span className="text-white text-xs">&#10003;</span>}
                </div>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && paginatedPhotos.length > 0 && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Filename</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Date Taken</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>GPS</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Camera</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Dimensions</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Size</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Album</th>
                  <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPhotos.map((photo) => (
                  <tr
                    key={photo.id}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--border-color)' }}
                    onClick={() => setSelectedPhoto(photo)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {photo.mediaType === 'video' ? <Camera size={14} className="text-purple-400" /> : <Image size={14} className="text-green-400" />}
                        <span style={{ color: 'var(--text-primary)' }}>{photo.filename}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(photo.dateTaken).toLocaleDateString()}{' '}
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(photo.dateTaken).toLocaleTimeString()}</span>
                      {photo.dateTaken !== photo.dateModified && (
                        <div className="text-xs text-yellow-400 flex items-center gap-1"><Clock size={10} /> Modified: {new Date(photo.dateModified).toLocaleDateString()}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {photo.gpsLatitude !== null ? (
                        <span className="flex items-center gap-1 text-cyan-400">
                          <MapPin size={12} /> {photo.gpsLatitude.toFixed(4)}, {photo.gpsLongitude?.toFixed(4)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {photo.cameraMake || photo.cameraModel ? `${photo.cameraMake} ${photo.cameraModel}`.trim() : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {photo.width}x{photo.height}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {formatBytes(photo.fileSize)}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{photo.album || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {photo.isDeleted && <span className="badge-danger text-xs px-2 py-0.5 rounded-full">Deleted</span>}
                      {photo.isFavorite && <span className="text-yellow-400 text-xs">&#9733;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Map View Placeholder */}
      {viewMode === 'map' && photos.length > 0 && (
        <div className="card p-8 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', minHeight: '400px' }}>
          <Map size={64} className="mx-auto mb-4 text-cyan-400" />
          <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Geotagged Photo Map</h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            {filteredPhotos.filter((p) => p.gpsLatitude !== null).length} geotagged items ready for map display
          </p>
          <div className="max-w-md mx-auto space-y-2">
            {filteredPhotos.filter((p) => p.gpsLatitude !== null).slice(0, 10).map((p) => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <span style={{ color: 'var(--text-primary)' }}>{p.filename}</span>
                <span className="text-xs text-cyan-400">{p.gpsLatitude?.toFixed(4)}, {p.gpsLongitude?.toFixed(4)}</span>
              </div>
            ))}
            {filteredPhotos.filter((p) => p.gpsLatitude !== null).length > 10 && (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                ... and {filteredPhotos.filter((p) => p.gpsLatitude !== null).length - 10} more locations
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pagination */}
      {paginatedPhotos.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {currentPage} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="btn-secondary text-sm"><ChevronLeft size={14} /> Prev</button>
            <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="btn-secondary text-sm">Next <ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {/* Photo Detail Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }} onClick={() => setSelectedPhoto(null)}>
          <div className="card p-6 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {selectedPhoto.filename}
                {selectedPhoto.isDeleted && <span className="badge-danger text-xs px-2 py-0.5 rounded-full ml-2">DELETED</span>}
              </h3>
              <button onClick={() => setSelectedPhoto(null)} className="btn-secondary p-1"><X size={18} /></button>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Preview */}
              <div className="aspect-square rounded flex items-center justify-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                {selectedPhoto.thumbnailPath ? (
                  <img src={`file://${selectedPhoto.thumbnailPath}`} alt={selectedPhoto.filename} className="max-w-full max-h-full object-contain" />
                ) : (
                  <Camera size={64} style={{ color: 'var(--text-muted)' }} />
                )}
              </div>

              {/* EXIF Data */}
              <div className="space-y-3 text-sm">
                <h4 className="font-medium" style={{ color: 'var(--text-secondary)' }}>File Information</h4>
                {[
                  { label: 'Filename', value: selectedPhoto.filename },
                  { label: 'Type', value: selectedPhoto.mediaType },
                  { label: 'Dimensions', value: `${selectedPhoto.width} x ${selectedPhoto.height}` },
                  { label: 'File Size', value: formatBytes(selectedPhoto.fileSize) },
                  { label: 'Album', value: selectedPhoto.album || 'N/A' },
                ].map((r) => (
                  <div key={r.label} className="flex justify-between py-0.5" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{r.value}</span>
                  </div>
                ))}

                <h4 className="font-medium pt-2" style={{ color: 'var(--text-secondary)' }}>Dates</h4>
                {[
                  { label: 'Date Taken', value: new Date(selectedPhoto.dateTaken).toLocaleString() },
                  { label: 'Date Created', value: new Date(selectedPhoto.dateCreated).toLocaleString() },
                  { label: 'Date Modified', value: new Date(selectedPhoto.dateModified).toLocaleString() },
                ].map((r) => (
                  <div key={r.label} className="flex justify-between py-0.5" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                    <span style={{ color: selectedPhoto.dateTaken !== selectedPhoto.dateModified ? '#eab308' : 'var(--text-primary)' }}>{r.value}</span>
                  </div>
                ))}

                <h4 className="font-medium pt-2" style={{ color: 'var(--text-secondary)' }}>Camera</h4>
                {[
                  { label: 'Make/Model', value: `${selectedPhoto.cameraMake} ${selectedPhoto.cameraModel}`.trim() || 'N/A' },
                  { label: 'Lens', value: selectedPhoto.lensModel || 'N/A' },
                  { label: 'Focal Length', value: selectedPhoto.focalLength || 'N/A' },
                  { label: 'Aperture', value: selectedPhoto.aperture || 'N/A' },
                  { label: 'Shutter Speed', value: selectedPhoto.shutterSpeed || 'N/A' },
                  { label: 'ISO', value: selectedPhoto.iso ? String(selectedPhoto.iso) : 'N/A' },
                ].map((r) => (
                  <div key={r.label} className="flex justify-between py-0.5" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{r.value}</span>
                  </div>
                ))}

                {selectedPhoto.gpsLatitude !== null && (
                  <>
                    <h4 className="font-medium pt-2" style={{ color: 'var(--text-secondary)' }}>GPS Location</h4>
                    <div className="flex justify-between py-0.5" style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Coordinates</span>
                      <span className="text-cyan-400">{selectedPhoto.gpsLatitude?.toFixed(6)}, {selectedPhoto.gpsLongitude?.toFixed(6)}</span>
                    </div>
                    {selectedPhoto.gpsAltitude !== null && (
                      <div className="flex justify-between py-0.5" style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Altitude</span>
                        <span style={{ color: 'var(--text-primary)' }}>{selectedPhoto.gpsAltitude?.toFixed(1)}m</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && photos.length === 0 && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Image size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and scan to view photos and videos with metadata</p>
        </div>
      )}
    </div>
  );
};
