import React, { useState, useEffect } from 'react';
import {
  Apple,
  Heart,
  Activity,
  Download,
  Loader2,
  Search,
  FileDown,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Moon,
  Footprints,
  Dumbbell,
  Thermometer,
  Droplets,
  TrendingUp,
  BarChart3,
  ArrowUpDown,
  X,
  AlertTriangle,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, IosDeviceBar } from '../components/common';
import { fmtDate, fmtTime, fmtDateTime } from '../utils/formatDate';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type HealthCategory =
  | 'steps'
  | 'heartRate'
  | 'sleep'
  | 'workouts'
  | 'bloodPressure'
  | 'weight'
  | 'bodyTemperature'
  | 'bloodOxygen'
  | 'ecg';

interface HealthDataPoint {
  id: string;
  date: string;
  value: number;
  unit: string;
  source: string;
  deviceName: string;
}

interface StepsData extends HealthDataPoint {
  distance?: number; // meters
}

interface HeartRateData extends HealthDataPoint {
  context: string; // resting, walking, workout
}

interface SleepData {
  id: string;
  date: string;
  bedtime: string;
  wakeTime: string;
  totalMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  lightMinutes: number;
  awakeMinutes: number;
  source: string;
}

interface WorkoutData {
  id: string;
  date: string;
  type: string;
  duration: number; // minutes
  calories: number;
  distance: number; // meters
  averageHeartRate: number;
  maxHeartRate: number;
  source: string;
}

interface BloodPressureData extends HealthDataPoint {
  systolic: number;
  diastolic: number;
}

interface EcgData {
  id: string;
  date: string;
  classification: string; // sinusRhythm, atrialFibrillation, inconclusive
  averageHeartRate: number;
  samplingRate: number;
  source: string;
}

interface CategorySummary {
  count: number;
  average: number;
  min: number;
  max: number;
  latest: number;
  latestDate: string;
  unit: string;
}

interface HealthStats {
  totalRecords: number;
  dateRange: { earliest: string; latest: string };
  categoryCounts: Record<HealthCategory, number>;
  sources: string[];
}

type ExportFormat = 'csv' | 'xml';

/* ------------------------------------------------------------------ */
/*  Category Config                                                    */
/* ------------------------------------------------------------------ */

const CATEGORY_CONFIG: Record<HealthCategory, { label: string; icon: React.ReactNode; color: string; unit: string }> = {
  steps: { label: 'Steps', icon: <Footprints size={16} />, color: 'text-green-400', unit: 'steps' },
  heartRate: { label: 'Heart Rate', icon: <Heart size={16} />, color: 'text-red-400', unit: 'bpm' },
  sleep: { label: 'Sleep', icon: <Moon size={16} />, color: 'text-purple-400', unit: 'hours' },
  workouts: { label: 'Workouts', icon: <Dumbbell size={16} />, color: 'text-orange-400', unit: 'sessions' },
  bloodPressure: { label: 'Blood Pressure', icon: <Activity size={16} />, color: 'text-blue-400', unit: 'mmHg' },
  weight: { label: 'Weight', icon: <TrendingUp size={16} />, color: 'text-cyan-400', unit: 'kg' },
  bodyTemperature: { label: 'Body Temperature', icon: <Thermometer size={16} />, color: 'text-yellow-400', unit: '\u00B0C' },
  bloodOxygen: { label: 'Blood Oxygen', icon: <Droplets size={16} />, color: 'text-blue-300', unit: '%' },
  ecg: { label: 'ECG Readings', icon: <Activity size={16} />, color: 'text-pink-400', unit: 'readings' },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const formatDistance = (meters: number): string => {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(0)} m`;
};

/* ------------------------------------------------------------------ */
/*  Bar Chart Subcomponent                                             */
/* ------------------------------------------------------------------ */

const SimpleBarChart: React.FC<{
  data: { label: string; value: number }[];
  unit: string;
  color: string;
  maxBars?: number;
}> = ({ data, unit, color, maxBars = 30 }) => {
  const displayData = data.slice(-maxBars);
  const maxValue = Math.max(...displayData.map((d) => d.value), 1);

  return (
    <div className="flex items-end gap-1" style={{ height: '160px' }}>
      {displayData.map((d, i) => {
        const heightPercent = Math.max((d.value / maxValue) * 100, 2);
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`${d.label}: ${d.value.toLocaleString()} ${unit}`}>
            <div
              className="w-full rounded-t transition-all"
              style={{
                height: `${heightPercent}%`,
                backgroundColor: color.replace('text-', '').includes('-')
                  ? `rgb(var(--${color.replace('text-', '')}))`
                  : '#3b82f6',
                minHeight: '2px',
                background: '#3b82f6',
                opacity: 0.8,
              }}
            />
            {displayData.length <= 14 && (
              <span className="text-[9px] mt-1 truncate w-full text-center" style={{ color: 'var(--text-muted)' }}>
                {d.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const IosHealthData: React.FC = () => {
  const [backupPath, setBackupPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeCategory, setActiveCategory] = useState<HealthCategory>('steps');

  // Data
  const [healthData, setHealthData] = useState<Record<HealthCategory, HealthDataPoint[]>>({
    steps: [],
    heartRate: [],
    sleep: [],
    workouts: [],
    bloodPressure: [],
    weight: [],
    bodyTemperature: [],
    bloodOxygen: [],
    ecg: [],
  });
  const [sleepData, setSleepData] = useState<SleepData[]>([]);
  const [workoutData, setWorkoutData] = useState<WorkoutData[]>([]);
  const [bpData, setBpData] = useState<BloodPressureData[]>([]);
  const [ecgData, setEcgData] = useState<EcgData[]>([]);
  const [stats, setStats] = useState<HealthStats | null>(null);
  const [categorySummaries, setCategorySummaries] = useState<Record<string, CategorySummary>>({});
  const [extractError, setExtractError] = useState<string | null>(null);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const handleExtract = async () => {
    if (!backupPath) return;
    setLoading(true);
    setStats(null);
    setCategorySummaries({});
    setExtractError(null);
    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_HEALTH_EXTRACT, {
        backupPath,
        categories: Object.keys(CATEGORY_CONFIG),
      }) as {
        data: Record<HealthCategory, HealthDataPoint[]>;
        sleepData: SleepData[];
        workoutData: WorkoutData[];
        bloodPressureData: BloodPressureData[];
        ecgData: EcgData[];
        stats: HealthStats;
        summaries: Record<string, CategorySummary>;
        error?: string;
      };
      if (result.error) setExtractError(result.error);
      if (result.data) setHealthData(result.data);
      setSleepData(result.sleepData ?? []);
      setWorkoutData(result.workoutData ?? []);
      setBpData(result.bloodPressureData ?? []);
      setEcgData(result.ecgData ?? []);
      setStats(result.stats);
      setCategorySummaries(result.summaries ?? {});
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const ext = format;
      const savePath = await window.api.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, {
        title: `Export Health Data as ${format.toUpperCase()}`,
        defaultPath: `ios_health_${activeCategory}.${ext}`,
        filters: [{ name: format.toUpperCase(), extensions: [ext] }],
      });
      if (savePath) {
        await window.api.invoke(IPC_CHANNELS.IOS_HEALTH_EXTRACT, {
          backupPath,
          exportPath: savePath,
          exportFormat: format,
          exportCategory: activeCategory,
        });
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  // Get data for active category
  const activeCategoryData = React.useMemo(() => {
    let data = healthData[activeCategory] || [];
    if (dateFrom) data = data.filter((d) => d.date >= dateFrom);
    if (dateTo) data = data.filter((d) => d.date <= dateTo);
    return data.sort((a, b) => b.date.localeCompare(a.date));
  }, [healthData, activeCategory, dateFrom, dateTo]);

  const totalPages = Math.ceil(activeCategoryData.length / pageSize);
  const paginatedData = activeCategoryData.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Chart data (daily aggregates)
  const chartData = React.useMemo(() => {
    const data = healthData[activeCategory] || [];
    let filtered = data;
    if (dateFrom) filtered = filtered.filter((d) => d.date >= dateFrom);
    if (dateTo) filtered = filtered.filter((d) => d.date <= dateTo);

    const dailyMap = new Map<string, number[]>();
    filtered.forEach((d) => {
      const day = d.date.substring(0, 10);
      const existing = dailyMap.get(day);
      if (existing) existing.push(d.value);
      else dailyMap.set(day, [d.value]);
    });

    const aggregateMode = activeCategory === 'steps' ? 'sum' : 'avg';
    return Array.from(dailyMap.entries())
      .map(([date, values]) => ({
        label: date.substring(5), // MM-DD
        value: aggregateMode === 'sum'
          ? values.reduce((a, b) => a + b, 0)
          : values.reduce((a, b) => a + b, 0) / values.length,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [healthData, activeCategory, dateFrom, dateTo]);

  const hasData = stats !== null;
  const summary = categorySummaries[activeCategory];
  const categoryConfig = CATEGORY_CONFIG[activeCategory];

  return (
    <div className="space-y-6">
      <PageHeader
        title="iOS Health Data"
        description="Extract Apple Health data including steps, heart rate, sleep, workouts, blood pressure, and more"
        icon={<Apple size={24} />}
      />

      {extractError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-2 text-sm text-red-400">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{extractError}</span>
        </div>
      )}

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
              {loading ? 'Extracting...' : 'Extract Health Data'}
            </button>
          </div>
        </div>
      </div>

      {/* Overview Stats */}
      {stats && (
        <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-blue-400" />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Health Data Overview - {stats.totalRecords.toLocaleString()} total records
              </span>
            </div>
            {stats.dateRange.earliest && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {fmtDate(stats.dateRange.earliest)} - {fmtDate(stats.dateRange.latest)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-9 gap-2">
            {(Object.keys(CATEGORY_CONFIG) as HealthCategory[]).map((cat) => {
              const config = CATEGORY_CONFIG[cat];
              const count = stats.categoryCounts[cat] || 0;
              return (
                <div
                  key={cat}
                  className="card p-2 cursor-pointer transition-all text-center"
                  style={{
                    backgroundColor: activeCategory === cat ? 'var(--bg-hover)' : 'var(--bg-secondary)',
                    border: activeCategory === cat ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                  }}
                  onClick={() => { setActiveCategory(cat); setCurrentPage(1); }}
                >
                  <div className={config.color}>{config.icon}</div>
                  <div className="text-xs mt-1 font-medium" style={{ color: 'var(--text-primary)' }}>{count.toLocaleString()}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{config.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Category Summary + Chart */}
      {hasData && (
        <>
          <div className="grid grid-cols-12 gap-4">
            {/* Summary Cards */}
            {summary && (
              <div className="col-span-4 space-y-3">
                <div className="card p-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <h3 className={`text-sm font-medium mb-3 flex items-center gap-2 ${categoryConfig.color}`}>
                    {categoryConfig.icon} {categoryConfig.label} Summary
                  </h3>
                  <div className="space-y-2">
                    {[
                      { label: 'Records', value: summary.count.toLocaleString() },
                      { label: 'Average', value: `${summary.average.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${summary.unit}` },
                      { label: 'Min', value: `${summary.min.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${summary.unit}` },
                      { label: 'Max', value: `${summary.max.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${summary.unit}` },
                      { label: 'Latest', value: `${summary.latest.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${summary.unit}` },
                      { label: 'Latest Date', value: summary.latestDate ? fmtDate(summary.latestDate) : '-' },
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between items-center py-1" style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Chart */}
            <div className={`${summary ? 'col-span-8' : 'col-span-12'} card p-4`} style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-sm font-medium flex items-center gap-2 ${categoryConfig.color}`}>
                  {categoryConfig.icon} {categoryConfig.label} Over Time
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    ({activeCategory === 'steps' ? 'daily total' : 'daily average'})
                  </span>
                </h3>
                <div className="flex gap-2">
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field text-xs" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', padding: '2px 6px' }} />
                  <span className="text-xs self-center" style={{ color: 'var(--text-muted)' }}>to</span>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field text-xs" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', padding: '2px 6px' }} />
                </div>
              </div>
              {chartData.length > 0 ? (
                <SimpleBarChart
                  data={chartData}
                  unit={categoryConfig.unit}
                  color={categoryConfig.color}
                />
              ) : (
                <div className="h-40 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                  No data for selected date range
                </div>
              )}
            </div>
          </div>

          {/* Category-specific Data Tables */}
          {activeCategory === 'sleep' && sleepData.length > 0 && (
            <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Date</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Bedtime</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Wake Time</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Total</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Deep</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>REM</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Light</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Awake</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sleepData.slice(0, 50).map((s) => (
                      <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{fmtDate(s.date)}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{fmtTime(s.bedtime)}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{fmtTime(s.wakeTime)}</td>
                        <td className="px-3 py-2 text-right font-mono text-purple-400">{formatDuration(s.totalMinutes)}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>{formatDuration(s.deepMinutes)}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>{formatDuration(s.remMinutes)}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>{formatDuration(s.lightMinutes)}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{formatDuration(s.awakeMinutes)}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{s.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeCategory === 'workouts' && workoutData.length > 0 && (
            <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Date</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Type</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Duration</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Calories</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Distance</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Avg HR</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Max HR</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workoutData.slice(0, 50).map((w) => (
                      <tr key={w.id} style={{ borderBottom: '1px solid var(--border-color)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{fmtDate(w.date)}</td>
                        <td className="px-3 py-2">
                          <span className="badge-info text-xs px-2 py-0.5 rounded-full">{w.type}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>{formatDuration(w.duration)}</td>
                        <td className="px-3 py-2 text-right font-mono text-orange-400">{w.calories.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>{w.distance > 0 ? formatDistance(w.distance) : '-'}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{w.averageHeartRate > 0 ? w.averageHeartRate : '-'}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{w.maxHeartRate > 0 ? w.maxHeartRate : '-'}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{w.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeCategory === 'ecg' && ecgData.length > 0 && (
            <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Date</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Classification</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Avg Heart Rate</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Sampling Rate</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ecgData.slice(0, 50).map((e) => (
                      <tr key={e.id} style={{ borderBottom: '1px solid var(--border-color)' }}
                        onMouseEnter={(ev) => (ev.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                        onMouseLeave={(ev) => (ev.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{fmtDateTime(e.date)}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            e.classification === 'sinusRhythm' ? 'badge-success' :
                            e.classification === 'atrialFibrillation' ? 'badge-danger' :
                            'badge-info'
                          }`}>
                            {e.classification === 'sinusRhythm' ? 'Sinus Rhythm' :
                             e.classification === 'atrialFibrillation' ? 'Atrial Fibrillation' :
                             'Inconclusive'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-red-400">{e.averageHeartRate} bpm</td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{e.samplingRate} Hz</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{e.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Generic data table for simple categories */}
          {!['sleep', 'workouts', 'ecg'].includes(activeCategory) && paginatedData.length > 0 && (
            <div className="card overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between p-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Showing {activeCategoryData.length.toLocaleString()} records
                </span>
                <div className="flex gap-2">
                  <button onClick={() => handleExport('csv')} className="btn-secondary text-sm" disabled={exporting}>
                    <FileDown size={14} className="mr-1" /> CSV
                  </button>
                  <button onClick={() => handleExport('xml')} className="btn-secondary text-sm" disabled={exporting}>
                    <FileDown size={14} className="mr-1" /> XML
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Date</th>
                      <th className="px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>Value</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Unit</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Source</th>
                      <th className="px-3 py-2 text-left" style={{ color: 'var(--text-secondary)' }}>Device</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedData.map((dp) => (
                      <tr key={dp.id} style={{ borderBottom: '1px solid var(--border-color)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                          {fmtDate(dp.date)}{' '}
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {fmtTime(dp.date)}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-medium ${categoryConfig.color}`}>
                          {dp.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{dp.unit}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{dp.source}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{dp.deviceName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
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
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!loading && !hasData && (
        <div className="card p-12 text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <Heart size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Select an iOS backup and extract Health data to view metrics and charts here</p>
        </div>
      )}
    </div>
  );
};
