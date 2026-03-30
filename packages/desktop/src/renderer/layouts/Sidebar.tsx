import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
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
  History,
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
  Hash,
  FileArchive,
  Unlock,
  FileSpreadsheet,
  Code,
  DatabaseZap,
  FileImage,
  Settings,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Shield,
  Phone,
  PhoneCall,
  ImagePlus,
  FolderTree,
  Eraser,
  Navigation,
  AppWindow,
} from 'lucide-react';

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
      { label: 'iOS Backup', path: '/ios/backup', icon: <Apple size={16} /> },
      { label: 'File Extraction', path: '/ios/file-extraction', icon: <FolderTree size={16} /> },
      { label: 'Messages (iMessage/SMS)', path: '/ios/messages', icon: <MessageCircle size={16} /> },
      { label: 'Call History', path: '/ios/call-history', icon: <PhoneCall size={16} /> },
      { label: 'Contacts', path: '/ios/contacts', icon: <Contact size={16} /> },
      { label: 'Photos & Videos', path: '/ios/photos', icon: <ImagePlus size={16} /> },
      { label: 'App Data', path: '/ios/app-data', icon: <AppWindow size={16} /> },
      { label: 'Location History', path: '/ios/location-history', icon: <Navigation size={16} /> },
      { label: 'Deleted Data Recovery', path: '/ios/deleted-data', icon: <Eraser size={16} /> },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { label: 'IPED Integration', path: '/analysis/iped', icon: <Search size={16} /> },
      { label: 'OCR Processing', path: '/analysis/ocr', icon: <ScanLine size={16} /> },
      { label: 'Screen Capture', path: '/analysis/screen-capture', icon: <Camera size={16} /> },
      { label: 'Media Processing', path: '/analysis/media-processing', icon: <Film size={16} /> },
      { label: 'Instagram Scraping', path: '/analysis/instagram', icon: <Instagram size={16} /> },
      { label: 'Geolocation Mapper', path: '/analysis/geolocation', icon: <MapPin size={16} /> },
      { label: 'Image Finder', path: '/analysis/image-finder', icon: <ScanSearch size={16} />, badge: 'BETA' },
      { label: 'MVT Scanner', path: '/analysis/mvt-scanner', icon: <ShieldAlert size={16} /> },
    ],
  },
  {
    title: 'Miscellaneous Tools',
    items: [
      { label: 'Hash Calculator', path: '/tools/hash-generator', icon: <Hash size={16} /> },
      { label: 'AB to TAR Converter', path: '/tools/ab-to-tar', icon: <FileArchive size={16} /> },
      { label: 'Samsung Unlock', path: '/tools/samsung-unlock', icon: <Unlock size={16} /> },
      { label: 'Acquisition Report', path: '/tools/acquisition-report', icon: <FileSpreadsheet size={16} /> },
      { label: 'JADX Decompiler', path: '/tools/jadx', icon: <Code size={16} /> },
      { label: 'SQLite Browser', path: '/tools/sqlite-browser', icon: <DatabaseZap size={16} /> },
      { label: 'EXIF Viewer', path: '/tools/exif-viewer', icon: <FileImage size={16} /> },
    ],
  },
  {
    title: 'Settings',
    items: [
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
    <aside className="flex h-full w-[260px] flex-col shadow-xl" style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-color)' }}>
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="rounded-lg bg-[#6495ED]/15 p-2">
          <Shield size={22} className="text-[#6495ED]" />
        </div>
        <div>
          <h1 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>RMPG Forensics</h1>
          <p className="text-[10px] font-medium uppercase tracking-wide text-red-400">Analysis</p>
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
      <div className="px-4 py-2 text-center text-[10px]" style={{ borderTop: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
        RMPG Forensics Analysis v1.0.0
      </div>
    </aside>
  );
};
