import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Wand2,
  History,
  Smartphone,
  Info,
  FileOutput,
  Package,
  PackageOpen,
  Copy,
  Database,
  Trash2,
  Monitor,
  FolderSearch,
  UserSearch,
  ListChecks,
  Layers,
  RotateCcw,
  Wifi,
  MessageCircle,
  Contact,
  Lock,
  Image,
  FileText,
  Mic,
  Merge,
  Apple,
  Search,
  ScanLine,
  Camera,
  Film,
  Instagram,
  MapPin,
  ScanSearch,
  ShieldAlert,
  KeyRound,
  Hash,
  FileArchive,
  Unlock,
  FileSpreadsheet,
  Code,
  DatabaseZap,
  Zap,
  FileImage,
  Settings,
  Sliders,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Shield,
  PhoneCall,
  ImagePlus,
  FolderTree,
  Eraser,
  Navigation,
  AppWindow,
  Globe,
  NotebookPen,
  Voicemail,
  Heart,
  Clock,
  Brain,
  Bot,
  Eye,
  Target,
  Users,
  Terminal,
  Download,
} from 'lucide-react';
import { APP_VERSION } from '@rmpg/shared';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: 'Case',
    items: [
      { label: 'Dashboard', path: '/', icon: <LayoutDashboard size={16} /> },
      { label: 'Case Manager', path: '/case-manager', icon: <FolderKanban size={16} /> },
      { label: 'Acquisition Wizard', path: '/acquisition-wizard', icon: <Wand2 size={16} /> },
      { label: 'Case Timeline', path: '/case-timeline', icon: <History size={16} /> },
    ],
  },
  {
    title: 'Android Collections',
    items: [
      { label: 'ADB Backup', path: '/android/adb-backup', icon: <Smartphone size={16} /> },
      { label: 'APK Downgrade', path: '/android/apk-downgrade', icon: <PackageOpen size={16} /> },
      { label: 'Device Info', path: '/android/device-info', icon: <Info size={16} /> },
      { label: 'File Extraction', path: '/android/file-extraction', icon: <FileOutput size={16} /> },
      { label: 'Device Explorer', path: '/android/device-explorer', icon: <FolderSearch size={16} /> },
      { label: 'Device Mirror', path: '/android/device-mirror', icon: <Monitor size={16} /> },
      { label: 'Multi-Device', path: '/android/multi-device', icon: <Layers size={16} /> },
      { label: 'APK Manager', path: '/android/apk-manager', icon: <Package size={16} /> },
      { label: 'Bulk Copy', path: '/android/bulk-copy', icon: <Copy size={16} /> },
      { label: 'Contacts & SMS', path: '/android/contacts-sms', icon: <UserSearch size={16} /> },
      { label: 'Misc Collections', path: '/android/misc-collections', icon: <ListChecks size={16} /> },
      { label: 'Special Dump', path: '/android/special-dump', icon: <Database size={16} /> },
      { label: 'Trash Recovery', path: '/android/trash-recovery', icon: <Trash2 size={16} /> },
      { label: 'Reboot / PIN', path: '/android/reboot', icon: <RotateCcw size={16} /> },
      { label: 'WiFi Debug', path: '/android/wifi-debug', icon: <Wifi size={16} /> },
    ],
  },
  {
    title: 'WhatsApp',
    items: [
      { label: 'Extraction', path: '/whatsapp/extraction', icon: <MessageCircle size={16} /> },
      { label: 'Contact Browser', path: '/whatsapp/contacts', icon: <Contact size={16} /> },
      { label: 'Decrypt (Crypt14/15)', path: '/whatsapp/decrypt', icon: <Lock size={16} /> },
      { label: 'Media .ENC Decrypt', path: '/whatsapp/media-decrypt', icon: <Image size={16} /> },
      { label: 'Chat Parser (New)', path: '/whatsapp/parser', icon: <FileText size={16} /> },
      { label: 'Chat Parser (Legacy)', path: '/whatsapp/legacy-parser', icon: <History size={16} /> },
      { label: 'OPUS Transcription', path: '/whatsapp/audio-transcription', icon: <Mic size={16} /> },
      { label: 'Database Merge', path: '/whatsapp/merge', icon: <Merge size={16} /> },
    ],
  },
  {
    title: 'iOS Collections',
    items: [
      { label: 'iOS Intelligence', path: '/ios/intelligence', icon: <Brain size={16} />, badge: 'NEW' },
      { label: 'Quick Extract', path: '/ios/quick-extract', icon: <Zap size={16} />, badge: 'NEW' },
      { label: 'iOS Backup', path: '/ios/backup', icon: <Apple size={16} /> },
      { label: 'File Extraction', path: '/ios/file-extraction', icon: <FolderTree size={16} /> },
      { label: 'Messages (iMessage/SMS)', path: '/ios/messages', icon: <MessageCircle size={16} /> },
      { label: 'Call History', path: '/ios/call-history', icon: <PhoneCall size={16} /> },
      { label: 'Contacts', path: '/ios/contacts', icon: <Contact size={16} /> },
      { label: 'Photos & Videos', path: '/ios/photos', icon: <ImagePlus size={16} /> },
      { label: 'App Data', path: '/ios/app-data', icon: <AppWindow size={16} /> },
      { label: 'Location History', path: '/ios/location-history', icon: <Navigation size={16} /> },
      { label: 'Deleted Data Recovery', path: '/ios/deleted-data', icon: <Eraser size={16} /> },
      { label: 'Safari History', path: '/ios/safari-history', icon: <Globe size={16} /> },
      { label: 'Notes', path: '/ios/notes', icon: <NotebookPen size={16} /> },
      { label: 'Voicemail', path: '/ios/voicemail', icon: <Voicemail size={16} /> },
      { label: 'Health Data', path: '/ios/health-data', icon: <Heart size={16} /> },
      { label: 'Screen Time', path: '/ios/screen-time', icon: <Clock size={16} /> },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { label: 'Forensic AI Agent', path: '/analysis/ai-agent', icon: <Bot size={16} />, badge: 'AI' },
      { label: 'IPED Integration', path: '/analysis/iped', icon: <Search size={16} /> },
      { label: 'OCR Processing', path: '/analysis/ocr', icon: <ScanLine size={16} /> },
      { label: 'Screen Capture', path: '/analysis/screen-capture', icon: <Camera size={16} /> },
      { label: 'Media Processing', path: '/analysis/media-processing', icon: <Film size={16} /> },
      { label: 'Instagram Scraping', path: '/analysis/instagram', icon: <Instagram size={16} /> },
      { label: 'Geolocation Mapper', path: '/analysis/geolocation', icon: <MapPin size={16} /> },
      { label: 'Image Finder', path: '/analysis/image-finder', icon: <ScanSearch size={16} />, badge: 'BETA' },
      { label: 'MVT Scanner', path: '/analysis/mvt-scanner', icon: <ShieldAlert size={16} /> },
      { label: 'Decryption', path: '/analysis/decryption', icon: <KeyRound size={16} /> },
    ],
  },
  {
    title: 'Breach & Bypass',
    items: [
      { label: 'Lock Screen Recovery', path: '/breach/lock-screen', icon: <Unlock size={16} /> },
      { label: 'EDL Imager (Qualcomm)', path: '/breach/edl-imager', icon: <Smartphone size={16} /> },
      { label: 'MTK Imager (MediaTek)', path: '/breach/mtk-imager', icon: <Smartphone size={16} /> },
      { label: 'iOS Backup Decrypt', path: '/breach/ios-backup-decrypt', icon: <Lock size={16} /> },
      { label: 'Samsung Unlock', path: '/tools/samsung-unlock', icon: <Unlock size={16} /> },
      { label: 'Advanced Decryption', path: '/breach/advanced-decrypt', icon: <Lock size={16} /> },
      { label: 'Brute Force Attack', path: '/breach/brute-force', icon: <Unlock size={16} /> },
      { label: 'Network Breach', path: '/breach/network-breach', icon: <Wifi size={16} /> },
      { label: 'Spy Tactical', path: '/breach/spy-tactical', icon: <ScanSearch size={16} /> },
      { label: 'iOS Trust & Unlock', path: '/breach/ios-trust-unlock', icon: <Apple size={16} /> },
      { label: 'Android ADB Bypass', path: '/breach/android-bypass', icon: <Smartphone size={16} /> },
      { label: 'Force Compliance', path: '/breach/force-compliance', icon: <DatabaseZap size={16} /> },
      { label: 'Live Device View', path: '/breach/live-view', icon: <Eye size={16} /> },
      { label: 'Selective Extraction', path: '/breach/selective-extraction', icon: <Target size={16} /> },
      { label: 'Website Data Extract', path: '/breach/website-breach', icon: <Globe size={16} /> },
      { label: 'PII Polling', path: '/breach/pii-polling', icon: <UserSearch size={16} /> },
    ],
  },
  {
    title: 'Intelligence & Data Collection',
    items: [
      { label: 'People Search', path: '/intel/people-search', icon: <Users size={16} /> },
      { label: 'Python Security Toolkit', path: '/intel/python-toolkit', icon: <Terminal size={16} /> },
    ],
  },
  {
    title: 'PI & Spy Integrations',
    items: [
      { label: 'Sherlock OSINT', path: '/pi/sherlock', icon: <Search size={16} />, badge: 'NEW' },
      { label: 'SpiderFoot Scanner', path: '/pi/spiderfoot', icon: <Globe size={16} />, badge: 'NEW' },
      { label: 'theHarvester', path: '/pi/harvester', icon: <Mail size={16} />, badge: 'NEW' },
      { label: 'PhoneInfoga', path: '/pi/phoneinfoga', icon: <Phone size={16} />, badge: 'NEW' },
      { label: 'GHunt Recon', path: '/pi/ghunt', icon: <Eye size={16} />, badge: 'NEW' },
      { label: 'Maigret Profiler', path: '/pi/maigret', icon: <UserSearch size={16} />, badge: 'NEW' },
      { label: 'Holehe Checker', path: '/pi/holehe', icon: <ScanSearch size={16} />, badge: 'NEW' },
      { label: 'Social Analyzer', path: '/pi/social-analyzer', icon: <Users size={16} />, badge: 'NEW' },
      { label: 'Photon Crawler', path: '/pi/photon', icon: <Search size={16} />, badge: 'NEW' },
      { label: 'Skiptracer', path: '/pi/skiptracer', icon: <Target size={16} />, badge: 'NEW' },
      { label: 'Recon-ng Framework', path: '/pi/recon-ng', icon: <Terminal size={16} />, badge: 'NEW' },
      { label: 'Maltego CE', path: '/pi/maltego', icon: <Share2 size={16} />, badge: 'NEW' },
      { label: 'Metagoofil', path: '/pi/metagoofil', icon: <FileSearch size={16} />, badge: 'NEW' },
      { label: 'Creepy Geolocator', path: '/pi/creepy', icon: <MapPin size={16} />, badge: 'NEW' },
      { label: 'TinEye Reverse', path: '/pi/tineye', icon: <ScanSearch size={16} />, badge: 'NEW' },
      { label: 'License Plate Reader', path: '/pi/plate-reader', icon: <Car size={16} />, badge: 'NEW' },
      { label: 'Counter Surveillance', path: '/pi/counter-surv', icon: <ShieldAlert size={16} />, badge: 'NEW' },
      { label: 'Vehicle Tracker', path: '/pi/vehicle-tracker', icon: <Navigation size={16} />, badge: 'NEW' },
      { label: 'Stakeout Camera', path: '/pi/stakeout', icon: <Camera size={16} />, badge: 'NEW' },
      { label: 'Dead Drop Comms', path: '/pi/dead-drop', icon: <Shield size={16} />, badge: 'NEW' },
    ],
  },
  {
    title: 'Miscellaneous Tools',
    items: [
      { label: 'Hash Calculator', path: '/tools/hash-generator', icon: <Hash size={16} /> },
      { label: 'AB to TAR Converter', path: '/tools/ab-to-tar', icon: <FileArchive size={16} /> },
      { label: 'Acquisition Report', path: '/tools/acquisition-report', icon: <FileSpreadsheet size={16} /> },
      { label: 'JADX Decompiler', path: '/tools/jadx', icon: <Code size={16} /> },
      { label: 'SQLite Browser', path: '/tools/sqlite-browser', icon: <DatabaseZap size={16} /> },
      { label: 'EXIF Viewer', path: '/tools/exif-viewer', icon: <FileImage size={16} /> },
    ],
  },
  {
    title: 'Downloads',
    items: [
      { label: 'App Downloads', path: '/downloads', icon: <Download size={16} /> },
    ],
  },
  {
    title: 'Settings',
    items: [
      { label: 'Preferences', path: '/settings/preferences', icon: <Sliders size={16} /> },
      { label: 'Tool Configuration', path: '/settings/tools', icon: <Settings size={16} /> },
      { label: 'Sync Settings', path: '/settings/sync', icon: <RefreshCw size={16} /> },
    ],
  },
];

const SidebarSection: React.FC<{
  section: NavSection;
  defaultOpen?: boolean;
}> = ({ section, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#6495ED] hover:text-[#4A7BD9]"
      >
        <span>{section.title}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5 px-2">
          {section.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                isActive ? 'sidebar-link-active' : 'sidebar-link'
              }
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'rgba(234,179,8,0.15)', color: '#fbbf24' }}>
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC = () => {
  return (
    <aside
      className="relative flex h-full w-[260px] flex-col shadow-xl"
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 96%, transparent), var(--bg-secondary))',
        borderRight: '1px solid var(--border-color)',
      }}
    >
      {/* vertical accent line on the right edge */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px"
        style={{ background: 'linear-gradient(180deg, transparent, rgba(100,149,237,0.35), transparent)' }} />

      {/* Brand */}
      <div className="relative flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-[#6495ED]/50 to-transparent" />
        <div className="relative">
          <div className="absolute inset-0 -m-1 rounded-xl bg-[#6495ED]/30 blur-md" />
          <div className="relative rounded-xl p-[1.5px]" style={{ background: 'linear-gradient(135deg, #7EAAFF, #4A7BD9 60%, #ef4444)' }}>
            <div className="rounded-[10px] bg-[#0f2238] p-2">
              <Shield size={22} className="text-[#6495ED] drop-shadow-[0_0_6px_rgba(100,149,237,0.7)]" />
            </div>
          </div>
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-extrabold tracking-wide" style={{ color: 'var(--text-primary)' }}>RMPG Forensics</h1>
          <div className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-red-400 animate-pulse" />
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-400">Analysis Suite</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        {navSections.map((section) => (
          <SidebarSection
            key={section.title}
            section={section}
            defaultOpen={section.title === 'Case' || section.title === 'Android Collections'}
          />
        ))}
      </nav>

      {/* Version footer */}
      <div className="relative px-4 py-2.5 text-center text-[10px]" style={{ borderTop: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#6495ED]/40 to-transparent" />
        <span className="font-mono">RMPG Forensics</span> <span className="text-[#6495ED]">v{APP_VERSION}</span>
      </div>
    </aside>
  );
};
