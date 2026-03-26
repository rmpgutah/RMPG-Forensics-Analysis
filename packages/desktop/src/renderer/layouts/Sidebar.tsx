import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Smartphone,
  Info,
  FileOutput,
  Package,
  Copy,
  Database,
  Trash2,
  MessageCircle,
  Contact,
  Lock,
  Image,
  FileText,
  History,
  Mic,
  Apple,
  Search,
  ScanLine,
  Camera,
  Film,
  Instagram,
  Hash,
  FileArchive,
  Unlock,
  Settings,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Shield,
} from 'lucide-react';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
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
    title: 'Android',
    items: [
      { label: 'ADB Backup', path: '/android/adb-backup', icon: <Smartphone size={16} /> },
      { label: 'Device Info', path: '/android/device-info', icon: <Info size={16} /> },
      { label: 'File Extraction', path: '/android/file-extraction', icon: <FileOutput size={16} /> },
      { label: 'APK Manager', path: '/android/apk-manager', icon: <Package size={16} /> },
      { label: 'Bulk Copy', path: '/android/bulk-copy', icon: <Copy size={16} /> },
      { label: 'Special Dump', path: '/android/special-dump', icon: <Database size={16} /> },
      { label: 'Trash Recovery', path: '/android/trash-recovery', icon: <Trash2 size={16} /> },
    ],
  },
  {
    title: 'WhatsApp',
    items: [
      { label: 'Extraction', path: '/whatsapp/extraction', icon: <MessageCircle size={16} /> },
      { label: 'Contact Browser', path: '/whatsapp/contacts', icon: <Contact size={16} /> },
      { label: 'Decrypt', path: '/whatsapp/decrypt', icon: <Lock size={16} /> },
      { label: 'Media Decrypt', path: '/whatsapp/media-decrypt', icon: <Image size={16} /> },
      { label: 'Parser', path: '/whatsapp/parser', icon: <FileText size={16} /> },
      { label: 'Legacy Parser', path: '/whatsapp/legacy-parser', icon: <History size={16} /> },
      { label: 'Audio Transcription', path: '/whatsapp/audio-transcription', icon: <Mic size={16} /> },
    ],
  },
  {
    title: 'iOS',
    items: [
      { label: 'iOS Backup', path: '/ios/backup', icon: <Apple size={16} /> },
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
    ],
  },
  {
    title: 'Tools',
    items: [
      { label: 'Hash Generator', path: '/tools/hash-generator', icon: <Hash size={16} /> },
      { label: 'AB to TAR Converter', path: '/tools/ab-to-tar', icon: <FileArchive size={16} /> },
      { label: 'Samsung Unlock', path: '/tools/samsung-unlock', icon: <Unlock size={16} /> },
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
        className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-400"
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
                isActive
                  ? 'sidebar-link-active'
                  : 'sidebar-link'
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC = () => {
  return (
    <aside className="flex h-full w-[280px] flex-col border-r border-slate-700 bg-slate-900">
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-slate-700 px-4 py-4">
        <div className="rounded-lg bg-blue-600/20 p-2">
          <Shield size={20} className="text-blue-400" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-white">RMPG Forensics</h1>
          <p className="text-xs text-slate-500">Analysis Toolkit</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        {navSections.map((section) => (
          <SidebarSection
            key={section.title}
            section={section}
            defaultOpen={section.title === 'Case' || section.title === 'Android'}
          />
        ))}
      </nav>

      {/* Version footer */}
      <div className="border-t border-slate-700 px-4 py-2 text-center text-xs text-slate-600">
        v1.0.0
      </div>
    </aside>
  );
};
