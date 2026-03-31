import React, { useState } from 'react';
import { Brain, Activity, MapPin, Wifi, FolderOpen } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

// ── Types ──────────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  type: 'message' | 'call' | 'location' | 'browse' | 'note' | 'photo' | 'voicemail';
  timestamp: number;
  summary: string;
  source: string;
  detail?: Record<string, unknown>;
}

interface LocationAccessEntry {
  bundleId: string;
  lastAccessTime: number;
  authorizationType: string;
  accessCount: number;
  executable?: string;
}

interface NetworkEntry {
  ssid: string;
  bssid?: string;
  securityType?: string;
  lastJoined?: number;
  joinCount?: number;
}

type TabId = 'timeline' | 'location-access' | 'network';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTs(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

const TYPE_COLORS: Record<string, string> = {
  message: 'bg-blue-500/20 text-blue-300',
  call: 'bg-green-500/20 text-green-300',
  location: 'bg-orange-500/20 text-orange-300',
  browse: 'bg-purple-500/20 text-purple-300',
  note: 'bg-yellow-500/20 text-yellow-300',
  photo: 'bg-pink-500/20 text-pink-300',
  voicemail: 'bg-cyan-500/20 text-cyan-300',
};

const AUTH_COLORS: Record<string, string> = {
  Always: 'text-red-400',
  WhenInUse: 'text-amber-400',
  Denied: 'text-green-400',
  NotDetermined: 'text-[var(--text-muted)]',
};

// ── Component ──────────────────────────────────────────────────────────────

export const IosIntelligence: React.FC = () => {
  const ipc = useIpc();
  const [activeTab, setActiveTab] = useState<TabId>('timeline');
  const [backupDir, setBackupDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Tab data
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [locationAccess, setLocationAccess] = useState<LocationAccessEntry[]>([]);
  const [networks, setNetworks] = useState<NetworkEntry[]>([]);

  // Timeline filters
  const [search, setSearch] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);

  const canExtract = backupDir.trim().length > 0;

  const handleExtract = async () => {
    if (!canExtract) return;
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'timeline') {
        const result = await ipc.invoke(IPC_CHANNELS.IOS_INTELLIGENCE_TIMELINE, { backupDir }) as { events: TimelineEvent[]; error?: string };
        if (result.error) setError(result.error);
        setEvents(result.events ?? []);
      } else if (activeTab === 'location-access') {
        const result = await ipc.invoke(IPC_CHANNELS.IOS_LOCATION_ACCESS, { backupDir }) as { entries: LocationAccessEntry[]; error?: string };
        if (result.error) setError(result.error);
        setLocationAccess(result.entries ?? []);
      } else {
        const result = await ipc.invoke(IPC_CHANNELS.IOS_NETWORK_TRACE, { backupDir }) as { networks: NetworkEntry[]; error?: string };
        if (result.error) setError(result.error);
        setNetworks(result.networks ?? []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleType = (type: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const filteredEvents = events.filter(e => {
    if (selectedTypes.size > 0 && !selectedTypes.has(e.type)) return false;
    if (search && !e.summary.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'timeline', label: 'Activity Timeline', icon: <Activity size={14} /> },
    { id: 'location-access', label: 'Location Access Trace', icon: <MapPin size={14} /> },
    { id: 'network', label: 'Network Trace', icon: <Wifi size={14} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Intelligence"
        description="Correlate all iOS data sources into a unified forensic picture"
        icon={<Brain size={24} />}
      />

      {/* Backup directory picker */}
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <FolderPicker
            label="iOS Backup Directory"
            value={backupDir}
            onChange={setBackupDir}
            disabled={loading}
          />
        </div>
        <button
          onClick={handleExtract}
          disabled={!canExtract || loading}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <FolderOpen size={14} />
          )}
          {loading ? 'Extracting…' : 'Extract'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearch(''); setSelectedTypes(new Set()); }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Activity Timeline Tab ─────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div className="space-y-4">
          {events.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="Search events…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input-field flex-1 min-w-48"
              />
              <div className="flex flex-wrap gap-2">
                {(['message', 'call', 'location', 'browse', 'note', 'photo', 'voicemail'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-opacity ${
                      TYPE_COLORS[type] ?? ''
                    } ${selectedTypes.size > 0 && !selectedTypes.has(type) ? 'opacity-40' : ''}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <span className="text-xs text-[var(--text-muted)]">{filteredEvents.length} events</span>
            </div>
          )}

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
                {filteredEvents.length === 0 ? (
                  <div className="p-8 text-center text-sm text-[var(--text-muted)]">
                    {events.length === 0
                      ? 'Select a backup directory and click Extract'
                      : 'No events match the current filter'}
                  </div>
                ) : (
                  <div className="max-h-[500px] overflow-y-auto">
                    {filteredEvents.map(event => (
                      <div
                        key={event.id}
                        onClick={() => setSelectedEvent(selectedEvent?.id === event.id ? null : event)}
                        className={`flex items-start gap-3 border-b border-[var(--border-color)] px-4 py-3 text-sm cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors ${
                          selectedEvent?.id === event.id ? 'bg-blue-500/10' : ''
                        }`}
                      >
                        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_COLORS[event.type] ?? ''}`}>
                          {event.type}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[var(--text-primary)]">{event.summary}</p>
                          <p className="text-xs text-[var(--text-muted)]">{formatTs(event.timestamp)} · {event.source}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {selectedEvent && (
              <div className="w-72 shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                <h4 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Event Detail</h4>
                <div className="space-y-1 text-xs">
                  {Object.entries(selectedEvent.detail ?? {}).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="w-28 shrink-0 font-medium text-[var(--text-secondary)] truncate">{k}</span>
                      <span className="break-all text-[var(--text-primary)]">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Location Access Trace Tab ─────────────────────────────────── */}
      {activeTab === 'location-access' && (
        <div className="space-y-4">
          {locationAccess.length > 0 && (
            <p className="text-xs text-[var(--text-muted)]">{locationAccess.length} apps with location access history</p>
          )}
          <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
            {locationAccess.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--text-muted)]">
                Select a backup directory and click Extract
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                    <tr>
                      <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">App Bundle ID</th>
                      <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Authorization</th>
                      <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Last Access</th>
                      <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationAccess.map((entry, i) => (
                      <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                        <td className="px-4 py-2 font-mono text-[var(--text-primary)]">{entry.bundleId}</td>
                        <td className={`px-4 py-2 font-medium ${AUTH_COLORS[entry.authorizationType] ?? 'text-[var(--text-secondary)]'}`}>
                          {entry.authorizationType}
                        </td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">{formatTs(entry.lastAccessTime)}</td>
                        <td className="px-4 py-2 text-[var(--text-muted)]">{entry.accessCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Network Trace Tab ─────────────────────────────────────────── */}
      {activeTab === 'network' && (
        <div className="space-y-4">
          {networks.length > 0 && (
            <p className="text-xs text-[var(--text-muted)]">{networks.length} known networks</p>
          )}
          <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
            {networks.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--text-muted)]">
                Select a backup directory and click Extract
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                    <tr>
                      <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">SSID</th>
                      <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">BSSID</th>
                      <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Security</th>
                      <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Last Joined</th>
                      <th className="px-4 py-2 text-left text-[var(--text-secondary)] font-medium">Joins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {networks.map((net, i) => (
                      <tr key={i} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)]">
                        <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{net.ssid}</td>
                        <td className="px-4 py-2 font-mono text-[var(--text-muted)]">{net.bssid ?? '—'}</td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">{net.securityType ?? '—'}</td>
                        <td className="px-4 py-2 text-[var(--text-secondary)]">{net.lastJoined ? formatTs(net.lastJoined) : '—'}</td>
                        <td className="px-4 py-2 text-[var(--text-muted)]">{net.joinCount ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
