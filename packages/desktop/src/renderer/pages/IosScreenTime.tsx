import React, { useState, useEffect } from 'react';
import {
  Apple,
  Smartphone,
  Download,
  Loader2,
  Search,
  FileDown,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Bell,
  Hand,
  Ban,
  BarChart3,
  Monitor,
  Globe,
  TrendingUp,
  Timer,
  Layers,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, IosDeviceBar } from '../components/common';
import { fmtDate, fmtTime, fmtDateTime } from '../utils/formatDate';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppUsageRecord {
  id: string;
  date: string;
  appName: string;
  bundleId: string;
  category: AppCategory;
  usageMinutes: number;
  notificationCount: number;
  pickupCount: number;
}

type AppCategory =
  | 'Social'
  | 'Entertainment'
  | 'Productivity'
  | 'Games'
  | 'Education'
  | 'Health & Fitness'
  | 'Shopping'
  | 'Finance'
  | 'News'
  | 'Communication'
  | 'Utilities'
  | 'Travel'
  | 'Other';

interface WebsiteUsageRecord {
  id: string;
  date: string;
  domain: string;
  usageMinutes: number;
  category: string;
}

interface DailySummary {
  date: string;
  totalUsageMinutes: number;
  pickupCount: number;
  notificationCount: number;
  firstPickupTime: string;
  topApps: { appName: string; minutes: number }[];
  categoryBreakdown: { category: AppCategory; minutes: number }[];
}

interface AppLimit {
  id: string;
  appName: string;
  bundleId: string;
  limitMinutes: number;
  isEnabled: boolean;
}

interface DowntimeSchedule {
  id: string;
  startTime: string;
  endTime: string;
  daysOfWeek: string[];
  isEnabled: boolean;
}

interface ScreenTimeStats {
  totalApps: number;
  totalDays: number;
  averageDailyUsage: number; // minutes
  averageDailyPickups: number;
  averageDailyNotifications: number;
  totalWebsites: number;
  appLimitsCount: number;
  downtimeEnabled: boolean;
}

type ViewMode = 'daily' | 'weekly';
type ActiveTab = 'apps' | 'websites' | 'limits' | 'downtime';

const CATEGORY_COLORS: Record<AppCategory, string> = {
  Social: '#3b82f6',
  Entertainment: '#f59e0b',
  Productivity: '#10b981',
  Games: '#ef4444',
  Education: '#8b5cf6',
  'Health & Fitness': '#06b6d4',
  Shopping: '#f97316',
  Finance: '#14b8a6',
  News: '#6366f1',
  Communication: '#22c55e',
  Utilities: '#6b7280',
  Travel: '#ec4899',
  Other: '#9ca3af',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatMinutes = (minutes: number): string => {
  if (minutes === 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosScreenTime: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [activeTab, setActiveTab] = useState<ActiveTab>('apps');

  // Data
  const [appUsage, setAppUsage] = useState<AppUsageRecord[]>([]);
  const [websiteUsage, setWebsiteUsage] = useState<WebsiteUsageRecord[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [appLimits, setAppLimits] = useState<AppLimit[]>([]);
  const [downtimeSchedules, setDowntimeSchedules] = useState<DowntimeSchedule[]>([]);
  const [stats, setStats] = useState<ScreenTimeStats | null>(null);

  // Filters
  const [selectedDate, setSelectedDate] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<'usageMinutes' | 'notificationCount' | 'pickupCount' | 'appName'>('usageMinutes');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const pageSize = 50;

  const handleExtract = async () => {
    if (!backupPath) return;
    setLoading(true);
    setAppUsage([]);
    setWebsiteUsage([]);
    setDailySummaries([]);
    setAppLimits([]);
    setDowntimeSchedules([]);
    setStats(null);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_SCREENTIME_EXTRACT, {
        backupPath,
      }) as {
        appUsage: AppUsageRecord[];
        websiteUsage: WebsiteUsageRecord[];
        dailySummaries: DailySummary[];
        appLimits: AppLimit[];
        downtimeSchedules: DowntimeSchedule[];
        stats: ScreenTimeStats;
      };
      setAppUsage(result.appUsage);
      setWebsiteUsage(result.websiteUsage);
      setDailySummaries(result.dailySummaries);
      setAppLimits(result.appLimits);
      setDowntimeSchedules(result.downtimeSchedules);
      setStats(result.stats);
      if (result.dailySummaries.length > 0) {
        setSelectedDate(result.dailySummaries[result.dailySummaries.length - 1].date);
      }
    } catch (err) {
      console.error('Screen Time extraction failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        title: 'Export Screen Time Data as CSV',
        defaultPath: 'ios_screentime.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (savePath) {
        await window.api.invoke(IPC_CHANNELS.IOS_SCREENTIME_EXTRACT, {
          backupPath,
          exportPath: savePath,
          exportFormat: 'csv',
        });
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // Get selected day summary
  const selectedDaySummary = React.useMemo(
    () => dailySummaries.find((d) => d.date === selectedDate),
    [dailySummaries, selectedDate]
  );

  // Filtered app usage for selected date
  const filteredAppUsage = React.useMemo(() => {
    let result = appUsage.filter((a) => a.date === selectedDate);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) => a.appName.toLowerCase().includes(q) || a.bundleId.toLowerCase().includes(q));
    }

    if (categoryFilter !== 'all') {
      result = result.filter((a) => a.category === categoryFilter);
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'usageMinutes') cmp = a.usageMinutes - b.usageMinutes;
      else if (sortField === 'notificationCount') cmp = a.notificationCount - b.notificationCount;
      else if (sortField === 'pickupCount') cmp = a.pickupCount - b.pickupCount;
      else cmp = a.appName.localeCompare(b.appName);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [appUsage, selectedDate, searchQuery, categoryFilter, sortField, sortDir]);

  // Filtered website usage for selected date
  const filteredWebsiteUsage = React.useMemo(() => {
    let result = websiteUsage.filter((w) => w.date === selectedDate);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((w) => w.domain.toLowerCase().includes(q));
    }
    return result.sort((a, b) => b.usageMinutes - a.usageMinutes);
  }, [websiteUsage, selectedDate, searchQuery]);

  // Top 10 apps aggregated
  const top10Apps = React.useMemo(() => {
    const map = new Map<string, { appName: string; totalMinutes: number; category: AppCategory }>();
    const data = selectedDate
      ? appUsage.filter((a) => a.date === selectedDate)
      : appUsage;
    data.forEach((a) => {
      const existing = map.get(a.bundleId);
      if (existing) {
        existing.totalMinutes += a.usageMinutes;
      } else {
        map.set(a.bundleId, { appName: a.appName, totalMinutes: a.usageMinutes, category: a.category });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 10);
  }, [appUsage, selectedDate]);

  const maxAppMinutes = top10Apps.length > 0 ? top10Apps[0].totalMinutes : 1;

  // Category breakdown for selected date
  const categoryBreakdown = React.useMemo(() => {
    if (selectedDaySummary) return selectedDaySummary.categoryBreakdown.sort((a, b) => b.minutes - a.minutes);

    const map = new Map<AppCategory, number>();
    const data = selectedDate ? appUsage.filter((a) => a.date === selectedDate) : appUsage;
    data.forEach((a) => {
      map.set(a.category, (map.get(a.category) || 0) + a.usageMinutes);
    });
    return Array.from(map.entries())
      .map(([category, minutes]) => ({ category, minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [appUsage, selectedDate, selectedDaySummary]);

  const totalCategoryMinutes = categoryBreakdown.reduce((sum, c) => sum + c.minutes, 0);

  // Weekly data for chart
  const weeklyData = React.useMemo(() => {
    return dailySummaries.slice(-7).map((d) => ({
      label: fmtDate(d.date),
      value: d.totalUsageMinutes,
    }));
  }, [dailySummaries]);

  const maxWeeklyMinutes = Math.max(...weeklyData.map((d) => d.value), 1);

  const totalPages = Math.ceil(filteredAppUsage.length / pageSize);
  const paginatedApps = filteredAppUsage.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const hasData = stats !== null;

  const uniqueDates = React.useMemo(() => dailySummaries.map((d) => d.date), [dailySummaries]);

  const tabConfig: { key: ActiveTab; label: string }[] = [
    { key: 'apps', label: 'App Usage' },
    { key: 'websites', label: 'Website Usage' },
    { key: 'limits', label: 'App Limits' },
    { key: 'downtime', label: 'Downtime' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Screen Time"
        description="Extract Screen Time data: app usage, website usage, pickups, notifications, downtime schedules, and app limits"
        icon={<Apple size={24} />}
      />

      {/* Source Selection */}
      <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="space-y-3">
          <IosDeviceBar
            backupPath={backupPath}
            onBackupPath={setBackupPath}
            disabled={loading}
          />
          <div className="flex justify-end">
            <button onClick={handleExtract} className="btn-primary" disabled={!backupPath || loading}>
              {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              {loading ? 'Extracting...' : 'Extract Screen Time'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-6 gap-3">
          {[
            { label: 'Avg Daily Usage', value: formatMinutes(stats.averageDailyUsage), color: 'text-blue-400', icon: <Clock size={18} /> },
            { label: 'Avg Daily Pickups', value: stats.averageDailyPickups.toFixed(0), color: 'text-green-400', icon: <Hand size={18} /> },
            { label: 'Avg Daily Notifications', value: stats.averageDailyNotifications.toFixed(0), color: 'text-yellow-400', icon: <Bell size={18} /> },
            { label: 'Total Apps Tracked', value: stats.totalApps.toLocaleString(), color: 'text-purple-400', icon: <Layers size={18} /> },
            { label: 'Websites Tracked', value: stats.totalWebsites.toLocaleString(), color: 'text-cyan-400', icon: <Globe size={18} /> },
            { label: 'Days of Data', value: stats.totalDays.toLocaleString(), color: 'text-orange-400', icon: <Calendar size={18} /> },
          ].map((s) => (
            <div key={s.label} className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                <span className={s.color}>{s.icon}</span>
              </div>
              <div className={`text-lg font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {hasData && (
        <>
          {/* Date Selector + View Toggle */}
          <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Date:</label>
                <select
                  value={selectedDate}
                  onChange={(e) => { setSelectedDate(e.target.value); setCurrentPage(1); }}
                  className="input-field"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                >
                  {uniqueDates.map((d) => (
                    <option key={d} value={d}>{fmtDate(d)}</option>
                  ))}
                </select>

                <div className="flex items-center gap-1 p-0.5 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <button
                    onClick={() => setViewMode('daily')}
                    className="px-3 py-1 text-xs rounded transition-colors"
                    style={{
                      backgroundColor: viewMode === 'daily' ? 'var(--bg-card)' : 'transparent',
                      color: viewMode === 'daily' ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    Daily
                  </button>
                  <button
                    onClick={() => setViewMode('weekly')}
                    className="px-3 py-1 text-xs rounded transition-colors"
                    style={{
                      backgroundColor: viewMode === 'weekly' ? 'var(--bg-card)' : 'transparent',
                      color: viewMode === 'weekly' ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    Weekly
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const idx = uniqueDates.indexOf(selectedDate);
                    if (idx > 0) setSelectedDate(uniqueDates[idx - 1]);
                  }}
                  disabled={uniqueDates.indexOf(selectedDate) <= 0}
                  className="btn-secondary text-sm"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => {
                    const idx = uniqueDates.indexOf(selectedDate);
                    if (idx < uniqueDates.length - 1) setSelectedDate(uniqueDates[idx + 1]);
                  }}
                  disabled={uniqueDates.indexOf(selectedDate) >= uniqueDates.length - 1}
                  className="btn-secondary text-sm"
                >
                  <ChevronRight size={14} />
                </button>
                <button onClick={handleExport} className="btn-secondary text-sm ml-2" disabled={exporting}>
                  <FileDown size={14} className="mr-1" /> Export CSV
                </button>
              </div>
            </div>
          </div>

          {/* Daily Summary Cards */}
          {selectedDaySummary && (
            <div className="grid grid-cols-4 gap-3">
              <div className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Screen Time</div>
                <div className="text-2xl font-bold text-blue-400 mt-1">{formatMinutes(selectedDaySummary.totalUsageMinutes)}</div>
              </div>
              <div className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Pickups</div>
                <div className="text-2xl font-bold text-green-400 mt-1">{selectedDaySummary.pickupCount}</div>
                {selectedDaySummary.firstPickupTime && (
                  <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    First: {fmtTime(selectedDaySummary.firstPickupTime)}
                  </div>
                )}
              </div>
              <div className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Notifications</div>
                <div className="text-2xl font-bold text-yellow-400 mt-1">{selectedDaySummary.notificationCount}</div>
              </div>
              <div className="card p-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Top App</div>
                {selectedDaySummary.topApps.length > 0 && (
                  <>
                    <div className="text-lg font-bold text-purple-400 mt-1 truncate">{selectedDaySummary.topApps[0].appName}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatMinutes(selectedDaySummary.topApps[0].minutes)}</div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Charts Row: Top 10 Apps + Category Breakdown + Weekly */}
          <div className="grid grid-cols-12 gap-4">
            {/* Top 10 Apps Bar Chart */}
            <div className="col-span-5 card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-blue-400" />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Top 10 Apps {selectedDate ? `- ${fmtDate(selectedDate)}` : ''}
                </span>
              </div>
              <div className="space-y-2">
                {top10Apps.map((app) => (
                  <div key={app.appName} className="flex items-center gap-2">
                    <span className="text-xs w-24 truncate text-right" style={{ color: 'var(--text-secondary)' }}>{app.appName}</span>
                    <div className="flex-1 h-4 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <div
                        className="h-full rounded transition-all"
                        style={{
                          width: `${Math.max((app.totalMinutes / maxAppMinutes) * 100, 2)}%`,
                          backgroundColor: CATEGORY_COLORS[app.category] || '#3b82f6',
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono w-12 text-right" style={{ color: 'var(--text-muted)' }}>{formatMinutes(app.totalMinutes)}</span>
                  </div>
                ))}
                {top10Apps.length === 0 && (
                  <div className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>No app data</div>
                )}
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="col-span-3 card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Layers size={16} className="text-purple-400" />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Categories</span>
              </div>
              <div className="space-y-2">
                {categoryBreakdown.map((cat) => (
                  <div key={cat.category} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat.category] || '#9ca3af' }} />
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{cat.category}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{formatMinutes(cat.minutes)}</span>
                      <span className="text-[10px] w-8 text-right" style={{ color: 'var(--text-muted)' }}>
                        {totalCategoryMinutes > 0 ? `${Math.round((cat.minutes / totalCategoryMinutes) * 100)}%` : '0%'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Category bar */}
              {totalCategoryMinutes > 0 && (
                <div className="flex mt-3 h-3 rounded overflow-hidden">
                  {categoryBreakdown.map((cat) => (
                    <div
                      key={cat.category}
                      style={{
                        width: `${(cat.minutes / totalCategoryMinutes) * 100}%`,
                        backgroundColor: CATEGORY_COLORS[cat.category] || '#9ca3af',
                        minWidth: cat.minutes > 0 ? '2px' : '0',
                      }}
                      title={`${cat.category}: ${formatMinutes(cat.minutes)}`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Weekly Usage Chart */}
            <div className="col-span-4 card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-green-400" />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Last 7 Days</span>
              </div>
              <div className="flex items-end gap-2" style={{ height: '140px' }}>
                {weeklyData.map((d, i) => {
                  const heightPercent = Math.max((d.value / maxWeeklyMinutes) * 100, 3);
                  const isSelected = dailySummaries.slice(-7)[i]?.date === selectedDate;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full cursor-pointer"
                      onClick={() => {
                        const ds = dailySummaries.slice(-7)[i];
                        if (ds) setSelectedDate(ds.date);
                      }}
                    >
                      <span className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>{formatMinutes(d.value)}</span>
                      <div
                        className="w-full rounded-t transition-all"
                        style={{
                          height: `${heightPercent}%`,
                          backgroundColor: isSelected ? '#3b82f6' : '#3b82f680',
                          border: isSelected ? '2px solid #60a5fa' : 'none',
                          minHeight: '3px',
                        }}
                      />
                      <span className="text-[10px] mt-1" style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}>{d.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border-color)' }}>
            {tabConfig.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2 text-sm font-medium rounded-t transition-colors"
                style={{
                  backgroundColor: activeTab === tab.key ? 'var(--bg-card)' : 'transparent',
                  color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderBottom: activeTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ---- APP USAGE TAB ---- */}
          {activeTab === 'apps' && (
            <>
              {/* Filters */}
              <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search app name..."
                      className="input-field w-full pl-9"
                      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                    />
                  </div>

                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="input-field"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                  >
                    <option value="all">All Categories</option>
                    {Object.keys(CATEGORY_COLORS).map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Showing {filteredAppUsage.length} apps for {selectedDate ? fmtDate(selectedDate) : 'selected date'}
                </div>
              </div>

              {/* App Usage Table */}
              {paginatedApps.length > 0 && (
                <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-sm">
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                          <th className="px-3 py-2 text-left cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('appName')}>
                            App {sortField === 'appName' && (sortDir === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Category</th>
                          <th className="px-3 py-2 text-right cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('usageMinutes')}>
                            Usage {sortField === 'usageMinutes' && (sortDir === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="px-3 py-2 text-center cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('notificationCount')}>
                            Notifications {sortField === 'notificationCount' && (sortDir === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="px-3 py-2 text-center cursor-pointer" style={{ color: 'var(--text-secondary)' }} onClick={() => toggleSort('pickupCount')}>
                            Pickups {sortField === 'pickupCount' && (sortDir === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Bundle ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedApps.map((app) => (
                          <tr
                            key={app.id}
                            style={{ borderBottom: '1px solid var(--border-color)' }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{app.appName}</td>
                            <td className="px-3 py-2">
                              <span className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[app.category] || '#9ca3af' }} />
                                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{app.category}</span>
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-20 h-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                                  <div
                                    className="h-full rounded"
                                    style={{
                                      width: `${Math.min((app.usageMinutes / (selectedDaySummary?.totalUsageMinutes || 1)) * 100 * 3, 100)}%`,
                                      backgroundColor: CATEGORY_COLORS[app.category] || '#3b82f6',
                                    }}
                                  />
                                </div>
                                <span className="font-mono text-blue-400 w-12 text-right">{formatMinutes(app.usageMinutes)}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center font-mono" style={{ color: 'var(--text-primary)' }}>
                              {app.notificationCount > 0 ? app.notificationCount : '-'}
                            </td>
                            <td className="px-3 py-2 text-center font-mono" style={{ color: 'var(--text-primary)' }}>
                              {app.pickupCount > 0 ? app.pickupCount : '-'}
                            </td>
                            <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{app.bundleId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border-color)' }}>
                      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {currentPage} of {totalPages}</span>
                      <div className="flex gap-2">
                        <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="btn-secondary text-sm">
                          <ChevronLeft size={14} /> Prev
                        </button>
                        <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="btn-secondary text-sm">
                          Next <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ---- WEBSITE USAGE TAB ---- */}
          {activeTab === 'websites' && (
            <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <table className="data-table w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Domain</th>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Category</th>
                    <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWebsiteUsage.map((ws) => (
                    <tr
                      key={ws.id}
                      style={{ borderBottom: '1px solid var(--border-color)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                        <span className="flex items-center gap-1.5">
                          <Globe size={14} className="text-blue-400" /> {ws.domain}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{ws.category || '-'}</td>
                      <td className="px-3 py-2 text-right font-mono text-blue-400">{formatMinutes(ws.usageMinutes)}</td>
                    </tr>
                  ))}
                  {filteredWebsiteUsage.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>No website usage data for this date</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- APP LIMITS TAB ---- */}
          {activeTab === 'limits' && (
            <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <table className="data-table w-full text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>App</th>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Bundle ID</th>
                    <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Daily Limit</th>
                    <th className="px-3 py-2 text-center" style={{ color: 'var(--text-secondary)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appLimits.map((limit) => (
                    <tr
                      key={limit.id}
                      style={{ borderBottom: '1px solid var(--border-color)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{limit.appName}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{limit.bundleId}</td>
                      <td className="px-3 py-2 text-right font-mono text-orange-400">{formatMinutes(limit.limitMinutes)}</td>
                      <td className="px-3 py-2 text-center">
                        {limit.isEnabled ? (
                          <span className="badge-success text-xs px-2 py-0.5 rounded-full">Active</span>
                        ) : (
                          <span className="badge-danger text-xs px-2 py-0.5 rounded-full">Disabled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {appLimits.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center" style={{ color: 'var(--text-muted)' }}>No app limits configured</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- DOWNTIME TAB ---- */}
          {activeTab === 'downtime' && (
            <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2 mb-4">
                <Ban size={16} className="text-purple-400" />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Downtime Schedules</span>
              </div>
              {downtimeSchedules.length > 0 ? (
                <div className="space-y-3">
                  {downtimeSchedules.map((schedule) => (
                    <div key={schedule.id} className="p-4 rounded" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <Clock size={14} className="text-purple-400" />
                            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                              {schedule.startTime} - {schedule.endTime}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-2">
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                              <span
                                key={day}
                                className="text-xs px-2 py-0.5 rounded"
                                style={{
                                  backgroundColor: schedule.daysOfWeek.includes(day) ? '#3b82f680' : 'var(--bg-primary)',
                                  color: schedule.daysOfWeek.includes(day) ? '#93c5fd' : 'var(--text-muted)',
                                  border: `1px solid ${schedule.daysOfWeek.includes(day) ? '#3b82f6' : 'var(--border-color)'}`,
                                }}
                              >
                                {day}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          {schedule.isEnabled ? (
                            <span className="badge-success text-xs px-2 py-0.5 rounded-full">Active</span>
                          ) : (
                            <span className="badge-danger text-xs px-2 py-0.5 rounded-full">Disabled</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  No downtime schedules configured
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!loading && !hasData && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Smartphone size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and extract Screen Time data to view usage analytics here</p>
        </div>
      )}
    </div>
  );
};
