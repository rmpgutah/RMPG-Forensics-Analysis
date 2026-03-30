import React, { useState, useEffect } from 'react';
import {
  Apple,
  MapPin,
  Wifi,
  Radio,
  Camera,
  Navigation,
  Download,
  Loader2,
  Search,
  Map,
  Calendar,
  FileDown,
  Clock,
  Filter,
  Layers,
  ChevronLeft,
  ChevronRight,
  Activity,
  Eye,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LocationRecord {
  id: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  timestamp: string;
  source: 'significant' | 'frequent' | 'wifi' | 'cell_tower' | 'app_location' | 'photo_gps';
  sourceName: string;
  address: string;
  duration: number; // seconds spent at location
  confidence: number; // 0-100
  ssid?: string; // wifi network name
  bssid?: string; // wifi MAC
  cellTowerId?: string;
  appBundleId?: string;
  photoFilename?: string;
}

interface LocationStats {
  totalRecords: number;
  significantLocations: number;
  frequentLocations: number;
  wifiLocations: number;
  cellTowerLogs: number;
  appLocationAccess: number;
  photoGpsPoints: number;
  dateRange: { earliest: string; latest: string };
  uniqueLocations: number;
}

type ExportFormat = 'kml' | 'csv';

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosLocationHistory: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [filteredLocations, setFilteredLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<LocationStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'map' | 'heatmap'>('list');
  const [currentPage, setCurrentPage] = useState(1);
  const [timelineValue, setTimelineValue] = useState(100); // percent of timeline
  const [selectedLocation, setSelectedLocation] = useState<LocationRecord | null>(null);
  const pageSize = 50;

  const handleBrowseBackup = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, { title: 'Select iOS Backup Folder' });
      if (result) setBackupPath(result as string);
    } catch { /* cancelled */ }
  };

  const handleExtract = async () => {
    if (!backupPath) return;
    setLoading(true);
    setLocations([]);
    setStats(null);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_LOCATION_EXTRACT, {
        backupPath,
        includeAll: true,
      }) as { locations: LocationRecord[]; stats: LocationStats };
      setLocations(result.locations);
      setStats(result.stats);
    } catch (err) {
      console.error('Location extraction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        title: `Export Locations as ${format.toUpperCase()}`,
        defaultPath: `ios_locations.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (savePath) {
        await window.api.invoke(IPC_CHANNELS.IOS_LOCATION_EXTRACT, {
          backupPath,
          exportPath: savePath,
          exportFormat: format,
          locationIds: filteredLocations.map((l) => l.id),
        });
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  // Filters
  useEffect(() => {
    let result = [...locations];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (l) =>
          l.address.toLowerCase().includes(q) ||
          l.sourceName.toLowerCase().includes(q) ||
          l.ssid?.toLowerCase().includes(q) ||
          l.appBundleId?.toLowerCase().includes(q)
      );
    }

    if (sourceFilter !== 'all') result = result.filter((l) => l.source === sourceFilter);
    if (dateFrom) result = result.filter((l) => l.timestamp >= dateFrom);
    if (dateTo) result = result.filter((l) => l.timestamp <= dateTo);

    // Timeline slider filter
    if (timelineValue < 100 && result.length > 0) {
      const sorted = [...result].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const cutoff = Math.floor(sorted.length * (timelineValue / 100));
      result = sorted.slice(0, cutoff);
    }

    setFilteredLocations(result);
    setCurrentPage(1);
  }, [locations, searchQuery, sourceFilter, dateFrom, dateTo, timelineValue]);

  const totalPages = Math.ceil(filteredLocations.length / pageSize);
  const paginatedLocations = filteredLocations.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'significant': return <MapPin size={14} className="text-red-400" />;
      case 'frequent': return <Navigation size={14} className="text-orange-400" />;
      case 'wifi': return <Wifi size={14} className="text-blue-400" />;
      case 'cell_tower': return <Radio size={14} className="text-purple-400" />;
      case 'app_location': return <Activity size={14} className="text-green-400" />;
      case 'photo_gps': return <Camera size={14} className="text-cyan-400" />;
      default: return <MapPin size={14} style={{ color: 'var(--text-muted)' }} />;
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'significant': return 'badge-danger';
      case 'frequent': return 'text-orange-400 bg-orange-400/10';
      case 'wifi': return 'badge-info';
      case 'cell_tower': return 'text-purple-400 bg-purple-400/10';
      case 'app_location': return 'badge-success';
      case 'photo_gps': return 'text-cyan-400 bg-cyan-400/10';
      default: return '';
    }
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  // Top locations summary
  const topLocations = React.useMemo(() => {
    const map = new Map<string, { address: string; visits: number; totalDuration: number; lat: number; lon: number }>();
    locations.forEach((l) => {
      const key = `${l.latitude.toFixed(3)},${l.longitude.toFixed(3)}`;
      const existing = map.get(key);
      if (existing) {
        existing.visits++;
        existing.totalDuration += l.duration;
      } else {
        map.set(key, { address: l.address || `${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)}`, visits: 1, totalDuration: l.duration, lat: l.latitude, lon: l.longitude });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.visits - a.visits).slice(0, 8);
  }, [locations]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Location History"
        description="Extract all location data — significant locations, WiFi history, cell tower logs, app location access, and GPS from photos"
        icon={<Apple size={24} />}
      />

      {/* Source */}
      <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>iOS Backup Source</label>
            <div className="flex gap-2">
              <input type="text" value={backupPath} readOnly placeholder="Select iOS backup folder..." className="input-field flex-1" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
              <button onClick={handleBrowseBackup} className="btn-secondary" disabled={loading}>Browse</button>
            </div>
          </div>
          <button onClick={handleExtract} className="btn-primary" disabled={!backupPath || loading}>
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <MapPin size={16} className="mr-2" />}
            {loading ? 'Extracting...' : 'Extract Location Data'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Records', value: stats.totalRecords.toLocaleString(), sub: `${stats.uniqueLocations} unique`, color: 'text-blue-400' },
            { label: 'Significant / Frequent', value: `${stats.significantLocations} / ${stats.frequentLocations}`, sub: 'Apple tracked', color: 'text-red-400' },
            { label: 'WiFi / Cell Tower', value: `${stats.wifiLocations} / ${stats.cellTowerLogs}`, sub: 'Network-based', color: 'text-purple-400' },
            { label: 'App / Photo GPS', value: `${stats.appLocationAccess} / ${stats.photoGpsPoints}`, sub: 'App + media', color: 'text-cyan-400' },
          ].map((s) => (
            <div key={s.label} className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
              <div className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top Locations */}
      {topLocations.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Navigation size={16} className="text-orange-400" /> Most Visited Locations
          </h3>
          <div className="grid grid-cols-4 gap-3">
            {topLocations.map((loc, i) => (
              <div key={i} className="p-3 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{loc.address}</div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-orange-400">{loc.visits} visits</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDuration(loc.totalDuration)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters + View Toggle */}
      {locations.length > 0 && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by address, WiFi SSID, app..." className="input-field w-full pl-9" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            </div>

            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
              <option value="all">All Sources</option>
              <option value="significant">Significant Locations</option>
              <option value="frequent">Frequent Locations</option>
              <option value="wifi">WiFi History</option>
              <option value="cell_tower">Cell Tower</option>
              <option value="app_location">App Access</option>
              <option value="photo_gps">Photo GPS</option>
            </select>

            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
            <span style={{ color: 'var(--text-muted)' }}>to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />

            <div className="flex gap-1 ml-auto">
              <button onClick={() => setViewMode('list')} className={`btn-secondary text-xs ${viewMode === 'list' ? 'ring-1 ring-blue-400' : ''}`}>List</button>
              <button onClick={() => setViewMode('map')} className={`btn-secondary text-xs ${viewMode === 'map' ? 'ring-1 ring-blue-400' : ''}`}>Map</button>
              <button onClick={() => setViewMode('heatmap')} className={`btn-secondary text-xs ${viewMode === 'heatmap' ? 'ring-1 ring-blue-400' : ''}`}>Heatmap</button>
            </div>

            <button onClick={() => handleExport('kml')} className="btn-secondary text-sm" disabled={exporting}><FileDown size={14} className="mr-1" /> KML</button>
            <button onClick={() => handleExport('csv')} className="btn-secondary text-sm" disabled={exporting}><FileDown size={14} className="mr-1" /> CSV</button>
          </div>

          {/* Timeline Slider */}
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-3">
              <Clock size={14} style={{ color: 'var(--text-muted)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Timeline</span>
              <input
                type="range"
                min={0}
                max={100}
                value={timelineValue}
                onChange={(e) => setTimelineValue(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{timelineValue}%</span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {filteredLocations.length.toLocaleString()} records
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Map / Heatmap View */}
      {(viewMode === 'map' || viewMode === 'heatmap') && filteredLocations.length > 0 && (
        <div className="card p-6" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', minHeight: '400px' }}>
          <div className="text-center">
            <Map size={64} className="mx-auto mb-4 text-cyan-400" />
            <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              {viewMode === 'heatmap' ? 'Location Heatmap' : 'Location Map'}
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              {filteredLocations.length.toLocaleString()} location points ready for visualization
            </p>
            <div className="max-w-lg mx-auto space-y-2">
              {filteredLocations.slice(0, 8).map((loc) => (
                <div key={loc.id} className="flex items-center justify-between p-2 rounded text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <div className="flex items-center gap-2">
                    {getSourceIcon(loc.source)}
                    <span style={{ color: 'var(--text-primary)' }}>{loc.address || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}</span>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(loc.timestamp).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && paginatedLocations.length > 0 && (
        <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Source</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Address / Location</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Coordinates</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Duration</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Accuracy</th>
                  <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLocations.map((loc) => (
                  <tr
                    key={loc.id}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--border-color)' }}
                    onClick={() => setSelectedLocation(loc)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${getSourceColor(loc.source)}`}>
                        {getSourceIcon(loc.source)} {loc.source.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[250px] truncate" style={{ color: 'var(--text-primary)' }}>
                      {loc.address || loc.sourceName}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-cyan-400">
                      {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(loc.timestamp).toLocaleDateString()}{' '}
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(loc.timestamp).toLocaleTimeString()}</span>
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                      {loc.duration > 0 ? formatDuration(loc.duration) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      ±{loc.accuracy}m
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {loc.ssid && <span>WiFi: {loc.ssid}</span>}
                      {loc.cellTowerId && <span>Cell: {loc.cellTowerId}</span>}
                      {loc.appBundleId && <span>App: {loc.appBundleId}</span>}
                      {loc.photoFilename && <span>Photo: {loc.photoFilename}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border-color)' }}>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {currentPage} of {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="btn-secondary text-sm"><ChevronLeft size={14} /> Prev</button>
              <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="btn-secondary text-sm">Next <ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      )}

      {/* Location Detail Modal */}
      {selectedLocation && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setSelectedLocation(null)}>
          <div className="card p-6 max-w-lg w-full mx-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Location Detail</h3>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Source', value: selectedLocation.source.replace('_', ' ') },
                { label: 'Address', value: selectedLocation.address || 'N/A' },
                { label: 'Coordinates', value: `${selectedLocation.latitude.toFixed(6)}, ${selectedLocation.longitude.toFixed(6)}` },
                { label: 'Altitude', value: selectedLocation.altitude ? `${selectedLocation.altitude.toFixed(1)}m` : 'N/A' },
                { label: 'Accuracy', value: `±${selectedLocation.accuracy}m` },
                { label: 'Timestamp', value: new Date(selectedLocation.timestamp).toLocaleString() },
                { label: 'Duration', value: selectedLocation.duration > 0 ? formatDuration(selectedLocation.duration) : 'N/A' },
                { label: 'Confidence', value: `${selectedLocation.confidence}%` },
                ...(selectedLocation.ssid ? [{ label: 'WiFi SSID', value: selectedLocation.ssid }] : []),
                ...(selectedLocation.bssid ? [{ label: 'WiFi BSSID', value: selectedLocation.bssid }] : []),
                ...(selectedLocation.cellTowerId ? [{ label: 'Cell Tower', value: selectedLocation.cellTowerId }] : []),
                ...(selectedLocation.appBundleId ? [{ label: 'App', value: selectedLocation.appBundleId }] : []),
                ...(selectedLocation.photoFilename ? [{ label: 'Photo', value: selectedLocation.photoFilename }] : []),
              ].map((r) => (
                <div key={r.label} className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{r.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setSelectedLocation(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && locations.length === 0 && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <MapPin size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and extract location data to view history here</p>
        </div>
      )}
    </div>
  );
};
