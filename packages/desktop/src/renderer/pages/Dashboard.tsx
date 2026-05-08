import React, { useState, useEffect } from 'react';
import {
  FolderPlus,
  FolderOpen,
  Smartphone,
  Apple,
  CheckCircle,
  Clock,
  Shield,
  Battery,
  Wifi,
  HardDrive,
  Cpu,
  MapPin,
  Package,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Phone,
  Hash,
  Info,
  Download,
  BarChart2,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, ToolStatus } from '../components/common';
import { useDeviceStatus } from '../hooks';
import { useDeviceStore } from '../store/device-store';
import type { DeviceProfile } from '../store/device-store';
import { exportToCsv } from '../utils/exportCsv';

interface RecentCase {
  name: string;
  localPath: string;
  path?: string;
  createdAt: string;
  caseNumber: string;
}

const QUICK_TOOLS: { name: string; tool: string; description: string }[] = [
  { name: 'ADB', tool: 'adb', description: 'Android Debug Bridge — required for all Android device operations' },
  { name: 'Java', tool: 'java', description: 'Java Runtime — required for JADX decompiler and some Android tools' },
  { name: 'Tesseract', tool: 'tesseract', description: 'OCR engine — required for text recognition in images' },
  { name: 'Python', tool: 'python', description: 'Python interpreter — required for WhatsApp decryption and various parsers' },
  { name: 'libimobiledevice', tool: 'idevicebackup2', description: 'iOS device library — required for all iOS backup and extraction operations' },
  { name: 'Instaloader', tool: 'instaloader', description: 'Instagram scraping tool — required for Instagram data acquisition' },
];

// ---------------------------------------------------------------------------
// Device Profile Card
// ---------------------------------------------------------------------------

const ProfileRow: React.FC<{ label: string; value?: string | number | null }> = ({ label, value }) => {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-2 py-0.5 text-xs">
      <span className="w-36 shrink-0 text-right font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="break-all" style={{ color: 'var(--text-primary)' }}>{String(value)}</span>
    </div>
  );
};

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-white/5"
        style={{ color: 'var(--text-secondary)' }}
      >
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {open && <div className="mt-1 px-2">{children}</div>}
    </div>
  );
};

const DeviceProfileCard: React.FC<{ profile: DeviceProfile; onRescan: () => void }> = ({ profile, onRescan }) => {
  const isAndroid = profile.platform === 'android';
  const accentColor = isAndroid ? '#4ade80' : '#6495ED';
  const Icon = isAndroid ? Smartphone : Apple;

  return (
    <div className="card space-y-2" style={{ borderColor: accentColor + '44' }}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="flex items-center gap-2">
          <div className="rounded-lg p-1.5" style={{ background: accentColor + '22' }}>
            <Icon size={16} style={{ color: accentColor }} />
          </div>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {profile.deviceName || profile.model || (isAndroid ? 'Android Device' : 'iPhone')}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {(profile.serial ?? '').substring(0, 20)}{(profile.serial ?? '').length > 20 ? '…' : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {profile.scanning && <Loader2 size={14} className="animate-spin" style={{ color: accentColor }} />}
          {/* lucide-react icons don't accept a `title` prop directly — wrap
              in a span so the tooltip still renders on hover. */}
          {profile.error && (
            <span title={profile.error} className="inline-flex">
              <AlertCircle size={14} className="text-red-400" />
            </span>
          )}
          {!profile.scanning && (
            <button onClick={onRescan} title="Re-scan device" className="rounded p-1 hover:bg-white/10">
              <RefreshCw size={13} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {profile.scanning && (
        <div className="py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="mx-auto mb-2 animate-spin" style={{ color: accentColor }} />
          Scanning device…
        </div>
      )}

      {!profile.scanning && !profile.error && (
        <div className="max-h-[420px] overflow-y-auto pr-1">
          {/* Identity */}
          <Section title="Identity" icon={<Info size={12} />}>
            <ProfileRow label="Model" value={profile.model} />
            <ProfileRow label="Manufacturer" value={profile.manufacturer} />
            <ProfileRow label={isAndroid ? 'Android Version' : 'iOS Version'} value={profile.androidVersion ?? profile.productVersion} />
            <ProfileRow label="Build" value={profile.buildId ?? profile.buildVersion} />
            <ProfileRow label="SDK" value={profile.sdkVersion} />
            <ProfileRow label="Serial No." value={profile.serialNumber} />
            <ProfileRow label="IMEI" value={profile.imei} />
            <ProfileRow label="Phone Number" value={profile.phoneNumber} />
            <ProfileRow label="Hardware" value={profile.hardwareModel ?? profile.cpuAbi} />
            <ProfileRow label="CPU" value={profile.cpuInfo} />
            <ProfileRow label="Security Patch" value={profile.securityPatch} />
            <ProfileRow label="Encrypted" value={profile.encrypted} />
            <ProfileRow label="Bootloader" value={profile.bootloaderStatus} />
            <ProfileRow label="Uptime" value={profile.uptimeHours ? `${profile.uptimeHours}h` : undefined} />
          </Section>

          {/* Battery */}
          {profile.battery && (
            <Section title="Battery" icon={<Battery size={12} />}>
              <ProfileRow label="Level" value={`${profile.battery.level}%`} />
              <ProfileRow label="Status" value={profile.battery.status} />
              <ProfileRow label="Health" value={profile.battery.health} />
              <ProfileRow label="Temperature" value={profile.battery.temperature} />
              <ProfileRow label="Voltage" value={profile.battery.voltage} />
              <ProfileRow label="Technology" value={(profile.battery as Record<string, unknown>).technology as string} />
            </Section>
          )}

          {/* Network */}
          {(profile.wifi?.ssid || (profile.ipAddresses?.length ?? 0) > 0) && (
            <Section title="Network" icon={<Wifi size={12} />}>
              <ProfileRow label="WiFi SSID" value={profile.wifi?.ssid} />
              <ProfileRow label="WiFi Address" value={profile.wifiAddress} />
              <ProfileRow label="Bluetooth" value={profile.bluetoothAddress} />
              {profile.ipAddresses?.map((ip, i) => (
                <ProfileRow key={i} label={`IP ${i + 1}`} value={ip} />
              ))}
            </Section>
          )}

          {/* Storage */}
          {profile.storage && (
            <Section title="Storage" icon={<HardDrive size={12} />}>
              {typeof profile.storage === 'object' ? (
                Object.entries(profile.storage as Record<string, string>).map(([k, v]) => (
                  <ProfileRow key={k} label={k} value={v} />
                ))
              ) : (
                <pre className="text-[10px] whitespace-pre-wrap break-all" style={{ color: 'var(--text-secondary)' }}>
                  {profile.storage as string}
                </pre>
              )}
            </Section>
          )}

          {/* Memory */}
          {profile.memory && (
            <Section title="Memory" icon={<Cpu size={12} />}>
              {Object.entries(profile.memory).slice(0, 6).map(([k, v]) => (
                <ProfileRow key={k} label={k} value={v} />
              ))}
            </Section>
          )}

          {/* Location */}
          {profile.lastLocation && (
            <Section title="Last Known Location" icon={<MapPin size={12} />}>
              <ProfileRow label="Latitude" value={profile.lastLocation.lat} />
              <ProfileRow label="Longitude" value={profile.lastLocation.lon} />
            </Section>
          )}

          {/* Installed Apps */}
          {(profile.installedAppCount ?? 0) > 0 && (
            <Section title="Installed Apps" icon={<Package size={12} />}>
              <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                {profile.installedAppCount} user-installed apps
              </div>
              {profile.installedApps?.slice(0, 10).map((pkg) => (
                <div key={pkg} className="truncate py-0.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>{pkg}</div>
              ))}
              {(profile.installedAppCount ?? 0) > 10 && (
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  +{(profile.installedAppCount ?? 0) - 10} more
                </div>
              )}
            </Section>
          )}

          {/* Accounts */}
          {(profile.accounts?.length ?? 0) > 0 && (
            <Section title="Accounts" icon={<Hash size={12} />}>
              {profile.accounts?.map((a, i) => (
                <div key={i} className="truncate py-0.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>{a}</div>
              ))}
            </Section>
          )}
        </div>
      )}

      {profile.error && (
        <div className="rounded p-2 text-xs text-red-300" style={{ background: 'rgba(239,68,68,0.1)' }}>
          {profile.error}
        </div>
      )}

      <div className="pt-1 text-[10px]" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}>
        Scanned: {profile.scannedAt ? new Date(profile.scannedAt).toLocaleTimeString() : '—'}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Connection Toast Overlay
// ---------------------------------------------------------------------------

const ConnectionToasts: React.FC = () => {
  const { connectionNotices, dismissConnectionNotice } = useDeviceStore();

  useEffect(() => {
    // Auto-dismiss after 6 seconds
    const timers = connectionNotices.map((n) =>
      setTimeout(() => dismissConnectionNotice(n.serial), 6000)
    );
    return () => timers.forEach(clearTimeout);
  }, [connectionNotices, dismissConnectionNotice]);

  if (connectionNotices.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {connectionNotices.map((n) => (
        <div
          key={n.serial}
          className="flex items-center gap-3 rounded-lg px-4 py-3 shadow-xl animate-fade-in"
          style={{
            background: n.platform === 'ios' ? 'rgba(30,60,120,0.97)' : 'rgba(20,60,30,0.97)',
            border: `1px solid ${n.platform === 'ios' ? '#6495ED' : '#4ade80'}`,
            minWidth: 260,
          }}
        >
          {n.platform === 'ios' ? (
            <Apple size={18} style={{ color: '#6495ED' }} />
          ) : (
            <Smartphone size={18} className="text-green-400" />
          )}
          <div className="flex-1">
            <div className="text-sm font-semibold text-white">Device Connected</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{n.label}</div>
          </div>
          <div className="text-xs text-green-400 font-medium">Scanning…</div>
          <button
            onClick={() => dismissConnectionNotice(n.serial)}
            className="ml-1 text-xs opacity-50 hover:opacity-100"
            style={{ color: 'var(--text-muted)' }}
          >✕</button>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const Dashboard: React.FC = () => {
  const { androidDevices, iosDevices, refresh } = useDeviceStatus();
  const { deviceProfiles, setDeviceScanning, setDeviceProfile } = useDeviceStore();
  const [allCases, setAllCases] = useState<RecentCase[]>([]);
  const [recentCases, setRecentCases] = useState<RecentCase[]>([]);
  const [caseError, setCaseError] = useState<string | null>(null);

  useEffect(() => {
    const loadCases = async () => {
      try {
        const cases = (await window.api.invoke(IPC_CHANNELS.CASE_LIST)) as RecentCase[];
        if (Array.isArray(cases)) {
          setAllCases(cases);
          setRecentCases(cases.slice(0, 5));
        }
      } catch {
        // No cases yet
      }
    };
    loadCases();
  }, []);

  const handleCreateCase = () => {
    setCaseError(null);
    window.api.invoke(IPC_CHANNELS.CASE_CREATE).catch((err) => {
      setCaseError(err instanceof Error ? err.message : String(err));
    });
  };
  const handleOpenCase = () => {
    setCaseError(null);
    window.api.invoke(IPC_CHANNELS.CASE_OPEN).catch((err) => {
      setCaseError(err instanceof Error ? err.message : String(err));
    });
  };

  const handleRescan = async (serial: string, platform: 'android' | 'ios') => {
    setDeviceScanning(serial, true);
    try {
      const profile = await window.api.invoke(IPC_CHANNELS.DEVICE_AUTO_SCAN, { serial, platform });
      if (profile) setDeviceProfile(serial, { ...(profile as object), scanning: false });
      else setDeviceScanning(serial, false);
    } catch (err) {
      setDeviceProfile(serial, {
        serial, platform, scanning: false,
        error: err instanceof Error ? err.message : String(err),
        scannedAt: new Date().toISOString(),
        deviceName: '', model: '', manufacturer: platform === 'ios' ? 'Apple' : '',
      });
    }
  };

  const allDevices = [...androidDevices, ...iosDevices];
  const profileList = Object.values(deviceProfiles);

  return (
    <>
    <div className="space-y-6">
      {/* Hero */}
      <div
        className="relative overflow-hidden rounded-2xl p-10 text-center"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 0%, rgba(100,149,237,0.25) 0%, rgba(13,59,94,0.5) 40%, #0a1828 100%)',
          border: '1px solid rgba(100,149,237,0.25)',
          boxShadow: '0 20px 60px -20px rgba(100,149,237,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Grid backdrop */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          }}
        />
        {/* Floating glows */}
        <div className="pointer-events-none absolute -top-20 -left-20 h-72 w-72 rounded-full bg-[#6495ED]/30 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-red-500/15 blur-[80px]" />

        <div className="relative">
          <div className="mb-4 flex items-center justify-center">
            <div className="relative">
              <div className="absolute inset-0 -m-2 animate-pulse rounded-2xl bg-[#6495ED]/30 blur-xl" />
              <div className="relative rounded-2xl p-[1.5px]" style={{ background: 'linear-gradient(135deg, #7EAAFF, transparent 50%, #ef4444)' }}>
                <div className="rounded-2xl bg-[#0f2238]/90 p-3 backdrop-blur">
                  <Shield size={36} className="text-[#6495ED] drop-shadow-[0_0_10px_rgba(100,149,237,0.7)]" />
                </div>
              </div>
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-wide">
            <span className="bg-gradient-to-b from-white to-gray-300 bg-clip-text text-transparent">RMPG</span>{' '}
            <span className="bg-gradient-to-b from-red-400 to-red-600 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(239,68,68,0.4)]">FORENSICS</span>
          </h1>
          <p className="mt-2 text-xs uppercase tracking-[0.4em]" style={{ color: 'var(--text-secondary)' }}>
            Digital Forensics Acquisition &amp; Analysis Toolkit
          </p>
          <div className="mx-auto mt-4 flex w-fit items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] uppercase tracking-widest text-emerald-300">
            <span className="live-dot" /> System Online · All Modules Ready
          </div>
        </div>
      </div>

      {/* Case Statistics */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Cases', value: allCases.length, icon: <BarChart2 size={20} />, color: '#6495ED' },
          { label: 'Android Devices', value: androidDevices.length, icon: <Smartphone size={20} />, color: '#4ade80' },
          { label: 'iOS Devices', value: iosDevices.length, icon: <Apple size={20} />, color: '#9bb8ee' },
        ].map((stat) => (
          <div key={stat.label} className="stat-card flex items-center gap-4">
            <div
              className="icon-tile h-12 w-12 shrink-0"
              style={{
                background: `linear-gradient(135deg, ${stat.color}33, ${stat.color}10)`,
                border: `1px solid ${stat.color}40`,
                color: stat.color,
              }}
            >
              {stat.icon}
            </div>
            <div className="flex-1">
              <div className="stat-number">{stat.value}</div>
              <div className="stat-label">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={handleCreateCase}
          className="card group relative flex flex-col items-center gap-3 overflow-hidden p-8 text-center transition-all hover:scale-[1.01] hover:border-[#6495ED]"
        >
          <div className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-[#6495ED]/15 blur-2xl transition-opacity group-hover:opacity-100" />
          <div
            className="icon-tile relative h-16 w-16"
            style={{
              background: 'linear-gradient(135deg, rgba(100,149,237,0.25), rgba(100,149,237,0.05))',
              border: '1px solid rgba(100,149,237,0.4)',
              boxShadow: '0 8px 24px rgba(100,149,237,0.25)',
            }}
          >
            <FolderPlus size={32} className="text-[#6495ED] drop-shadow-[0_0_8px_rgba(100,149,237,0.6)]" />
          </div>
          <div className="relative">
            <h3 className="text-lg font-extrabold tracking-wide" style={{ color: 'var(--text-primary)' }}>NEW CASE</h3>
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Start a new forensic case</p>
          </div>
        </button>
        <button
          onClick={handleOpenCase}
          className="card group relative flex flex-col items-center gap-3 overflow-hidden p-8 text-center transition-all hover:scale-[1.01] hover:border-green-500"
        >
          <div className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-green-500/15 blur-2xl" />
          <div
            className="icon-tile relative h-16 w-16"
            style={{
              background: 'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(34,197,94,0.05))',
              border: '1px solid rgba(34,197,94,0.4)',
              boxShadow: '0 8px 24px rgba(34,197,94,0.25)',
            }}
          >
            <FolderOpen size={32} className="text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
          </div>
          <div className="relative">
            <h3 className="text-lg font-extrabold tracking-wide" style={{ color: 'var(--text-primary)' }}>LOAD EXISTING</h3>
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Resume work on a case</p>
          </div>
        </button>
      </div>

      {caseError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-2 text-sm text-red-400">
          <AlertCircle size={14} className="shrink-0" />
          <span>{caseError}</span>
          <button onClick={() => setCaseError(null)} className="ml-auto text-red-400 hover:text-red-300">✕</button>
        </div>
      )}

      {/* Live Device Profiles — shown when any device is connected */}
      {profileList.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
              <Phone size={16} className="text-[#6495ED]" />
              Connected Devices — Live Profile
            </h3>
            <button onClick={refresh} className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-white/5"
              style={{ color: 'var(--text-muted)' }}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          <div className={`grid gap-4 ${profileList.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {profileList.map((profile) => (
              <DeviceProfileCard
                key={profile.serial}
                profile={profile}
                onRescan={() => handleRescan(profile.serial, profile.platform)}
              />
            ))}
          </div>
        </div>
      )}

      {/* No devices placeholder */}
      {allDevices.length === 0 && (
        <div className="card space-y-3 py-4" style={{ borderStyle: 'dashed' }}>
          <div className="flex items-center gap-3">
            <Smartphone size={20} style={{ color: 'var(--text-muted)' }} />
            <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No devices connected</div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="flex items-start gap-2 rounded p-2" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}>
              <Smartphone size={14} className="text-green-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-green-400 mb-0.5">Android</div>
                <div>Connect via USB and enable <strong>USB Debugging</strong> in Developer Options. Then unlock your device and tap <em>Allow</em> on the authorization prompt.</div>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded p-2" style={{ background: 'rgba(100,149,237,0.06)', border: '1px solid rgba(100,149,237,0.15)' }}>
              <Apple size={14} className="text-[#6495ED] mt-0.5 shrink-0" />
              <div>
                <div className="font-medium mb-0.5" style={{ color: '#6495ED' }}>iOS</div>
                <div>Connect via USB and tap <strong>Trust This Computer</strong> on the device. Enter your passcode if prompted. iTunes or Apple Configurator must be installed.</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Cases */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
            <Clock size={18} style={{ color: 'var(--text-muted)' }} />
            Recent Cases
          </h3>
          {recentCases.length > 0 && (
            <button
              onClick={() => exportToCsv(recentCases.map(c => ({
                Name: c.name, Number: c.caseNumber, Created: c.createdAt, Path: c.localPath ?? c.path ?? ''
              })), 'recent-cases')}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-white/5"
              style={{ color: 'var(--text-muted)' }}
              title="Export to CSV"
            >
              <Download size={12} /> CSV
            </button>
          )}
        </div>
        {recentCases.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No recent cases</p>
        ) : (
          <table className="data-table w-full text-sm">
            <thead>
              <tr>
                <th>Case Name</th>
                <th>Number</th>
                <th>Created</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {recentCases.map((c, i) => (
                <tr key={i} className="cursor-pointer"
                  onClick={() => window.api.invoke(IPC_CHANNELS.CASE_SET_PATH, c.localPath ?? c.path)}>
                  <td>{c.name}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{c.caseNumber || '-'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="max-w-[200px] truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {c.localPath ?? c.path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tool Status */}
      <div className="card">
        <div className="mb-3">
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Required Tools</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            These external tools must be installed and accessible in your PATH for full functionality.
            Go to <strong>Tool Configuration</strong> in the sidebar to install missing tools.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {QUICK_TOOLS.map((t) => (
            <ToolStatus key={t.tool} toolName={t.tool} label={t.name} description={t.description} />
          ))}
        </div>
      </div>
    </div>

    {/* Device connection acknowledgement toasts */}
    <ConnectionToasts />
    </>
  );
};
