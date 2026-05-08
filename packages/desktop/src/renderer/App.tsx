import React, { useEffect, useState, Component, ReactNode } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { LoginScreen } from './pages/LoginScreen';
import { useAuthStore } from './store';
import { useSettingsStore } from './store/settings-store';
import { ShortcutsModal } from './components/common';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ErrorEvent } from '@rmpg/shared';
import { useErrorStore } from './store/error-store';

// Error boundary to prevent page crashes from killing the entire app
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string; stack: string }> {
  state = { hasError: false, error: '', stack: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
    this.setState({ stack: info.componentStack });
    // Audit-log the render error via the central store. We generate the id
    // and timestamp here because this is purely client-side (no main process
    // round-trip). The main-process audit log is missed for these — that's
    // an acceptable gap because the renderer console + store are sufficient
    // for in-session diagnostics.
    try {
      useErrorStore.getState().addError({
        id: crypto.randomUUID(),
        severity: 'critical',
        source: 'react-render',
        message: error.message,
        detail: info.componentStack,
        timestampIso: new Date().toISOString(),
      });
    } catch {
      // Store may not be available during very early render failures; ignore.
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="card max-w-2xl w-full text-center">
            <h2 className="mb-2 text-lg font-bold text-red-400">Page Error</h2>
            <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>{this.state.error}</p>
            {this.state.stack && (
              <pre className="mb-4 max-h-48 overflow-auto rounded p-2 text-left text-[10px]"
                style={{ background: 'rgba(0,0,0,0.3)', color: '#f87171', whiteSpace: 'pre-wrap' }}>
                {this.state.stack.trim()}
              </pre>
            )}
            <button onClick={() => { this.setState({ hasError: false, stack: '' }); window.location.hash = '#/'; }} className="btn-primary">
              Return to Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Case
import { Dashboard } from './pages/Dashboard';
import { CaseManager } from './pages/CaseManager';
import { AcquisitionWizard } from './pages/AcquisitionWizard';
import { CaseTimeline } from './pages/CaseTimeline';

// Android Collections
import { AdbBackup } from './pages/AdbBackup';
import { ApkDowngrade } from './pages/ApkDowngrade';
import { DeviceInfo } from './pages/DeviceInfo';
import { FileExtraction } from './pages/FileExtraction';
import { ApkManager } from './pages/ApkManager';
import { BulkCopy } from './pages/BulkCopy';
import { SpecialDump } from './pages/SpecialDump';
import { TrashRecovery } from './pages/TrashRecovery';
import { DeviceMirror } from './pages/DeviceMirror';
import { DeviceExplorer } from './pages/DeviceExplorer';
import { ContactsExtraction } from './pages/ContactsExtraction';
import { MiscCollections } from './pages/MiscCollections';
import { MultiDevice } from './pages/MultiDevice';
import { DeviceReboot } from './pages/DeviceReboot';
import { WifiDebug } from './pages/WifiDebug';

// WhatsApp
import { WhatsAppExtraction } from './pages/WhatsAppExtraction';
import { WhatsAppContacts } from './pages/WhatsAppContacts';
import { WhatsAppDecrypt } from './pages/WhatsAppDecrypt';
import { WhatsAppMediaDecrypt } from './pages/WhatsAppMediaDecrypt';
import { WhatsAppParser } from './pages/WhatsAppParser';
import { WhatsAppLegacyParser } from './pages/WhatsAppLegacyParser';
import { AudioTranscription } from './pages/AudioTranscription';
import { WhatsAppMerge } from './pages/WhatsAppMerge';

// iOS Collections
import { IosQuickExtract } from './pages/IosQuickExtract';
import { IosBackup } from './pages/IosBackup';
import { IosBackupDecrypt } from './pages/IosBackupDecrypt';
import { IosFileExtraction } from './pages/IosFileExtraction';
import { IosMessages } from './pages/IosMessages';
import { IosCallHistory } from './pages/IosCallHistory';
import { IosContacts } from './pages/IosContacts';
import { IosPhotos } from './pages/IosPhotos';
import { IosAppData } from './pages/IosAppData';
import { IosLocationHistory } from './pages/IosLocationHistory';
import { IosDeletedData } from './pages/IosDeletedData';
import { IosSafariHistory } from './pages/IosSafariHistory';
import { IosNotes } from './pages/IosNotes';
import { IosVoicemail } from './pages/IosVoicemail';
import { IosHealthData } from './pages/IosHealthData';
import { IosScreenTime } from './pages/IosScreenTime';
import { IosIntelligence } from './pages/IosIntelligence';

// Analysis
import { ForensicAgent } from './pages/ForensicAgent';
import { IpedIntegration } from './pages/IpedIntegration';
import { OcrProcessing } from './pages/OcrProcessing';
import { ScreenCapture } from './pages/ScreenCapture';
import { MediaProcessing } from './pages/MediaProcessing';
import { InstagramScraping } from './pages/InstagramScraping';
import { GeolocationMapper } from './pages/GeolocationMapper';
import { ImageFinder } from './pages/ImageFinder';
import { MvtScanner } from './pages/MvtScanner';

// Tools
import { HashGenerator } from './pages/HashGenerator';
import { AbToTar } from './pages/AbToTar';
import { SamsungUnlock } from './pages/SamsungUnlock';
import { LockScreenRecovery } from './pages/LockScreenRecovery';
import { EdlImager } from './pages/EdlImager';
import { MtkClient } from './pages/MtkClient';
import { IosBackupDecrypt } from './pages/IosBackupDecrypt';
import { AcquisitionReport } from './pages/AcquisitionReport';
import { JadxDecompiler } from './pages/JadxDecompiler';
import { SqliteBrowser } from './pages/SqliteBrowser';
import { ExifViewer } from './pages/ExifViewer';

// Breach & Bypass (origin/main side)
import { MtkImager } from './pages/MtkImager';
import { AdvancedDecrypt } from './pages/AdvancedDecrypt';
import { BruteForceAttack } from './pages/BruteForceAttack';
import { NetworkBreach } from './pages/NetworkBreach';
import { SpyTactical } from './pages/SpyTactical';
import { IosTrustUnlock } from './pages/IosTrustUnlock';
import { AndroidBypass } from './pages/AndroidBypass';
import { ForceCompliance } from './pages/ForceCompliance';
import { LiveDeviceView } from './pages/LiveDeviceView';
import { SelectiveExtraction } from './pages/SelectiveExtraction';
import { WebsiteBreach } from './pages/WebsiteBreach';
import { PiiPolling } from './pages/PiiPolling';
import { PeopleSearch } from './pages/PeopleSearch';

// Settings
import { ToolConfiguration } from './pages/ToolConfiguration';
import { Preferences } from './pages/Preferences';
import { DecryptionTools } from './pages/DecryptionTools';
import { SyncSettings } from './pages/SyncSettings';

// ---------------------------------------------------------------------------
// Auto-update banner
// ---------------------------------------------------------------------------

const UpdateBanner: React.FC = () => {
  const [updateReady, setUpdateReady] = useState<{ version: string } | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null);

  useEffect(() => {
    const unsubAvail = window.api.on('update:available', (info: unknown) => {
      setUpdateAvailable(info as { version: string });
    });
    const unsubDl = window.api.on('update:downloaded', (info: unknown) => {
      setUpdateReady(info as { version: string });
      setUpdateAvailable(null);
    });
    return () => { unsubAvail(); unsubDl(); };
  }, []);

  if (updateReady) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-4 py-2 text-sm"
        style={{ background: '#1a3a1a', borderBottom: '1px solid #4ade80' }}>
        <span style={{ color: '#4ade80' }}>
          RMPG Forensics v{updateReady.version} downloaded — ready to install
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => window.api.invoke('update:install-now')}
            className="rounded px-3 py-1 text-xs font-semibold"
            style={{ background: '#4ade80', color: '#000' }}
          >
            Restart &amp; Update
          </button>
          <button onClick={() => setUpdateReady(null)}
            className="rounded px-2 py-1 text-xs opacity-60 hover:opacity-100"
            style={{ color: 'var(--text-muted)' }}>
            Later
          </button>
        </div>
      </div>
    );
  }

  if (updateAvailable) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-4 py-2 text-sm"
        style={{ background: '#1a2a3a', borderBottom: '1px solid #6495ED' }}>
        <span style={{ color: '#6495ED' }}>
          Update available: v{updateAvailable.version} — downloading in background…
        </span>
        <button onClick={() => setUpdateAvailable(null)}
          className="text-xs opacity-60 hover:opacity-100" style={{ color: 'var(--text-muted)' }}>✕</button>
      </div>
    );
  }

  return null;
};

// ---------------------------------------------------------------------------

// Python Security Toolkit
import { PythonToolkit } from './pages/PythonToolkit';

// PI & Spy Integrations
import { SherlockOsint } from './pages/SherlockOsint';
import { SpiderFootScanner } from './pages/SpiderFootScanner';
import { TheHarvester } from './pages/TheHarvester';
import { PhoneInfogaLookup } from './pages/PhoneInfogaLookup';
import { GHuntRecon } from './pages/GHuntRecon';
import { MaigretProfiler } from './pages/MaigretProfiler';
import { HoleheChecker } from './pages/HoleheChecker';
import { SocialAnalyzerTool } from './pages/SocialAnalyzerTool';
import { PhotonCrawler } from './pages/PhotonCrawler';
import { SkiptracerTool } from './pages/SkiptracerTool';
import { ReconNgFramework } from './pages/ReconNgFramework';
import { MaltegoCE } from './pages/MaltegoCE';
import { MetagoofilExtractor } from './pages/MetagoofilExtractor';
import { CreepyGeolocator } from './pages/CreepyGeolocator';
import { TinEyeReverse } from './pages/TinEyeReverse';
import { LicensePlateReader } from './pages/LicensePlateReader';
import { CounterSurveillance } from './pages/CounterSurveillance';
import { VehicleTracker } from './pages/VehicleTracker';
import { StakeoutCamera } from './pages/StakeoutCamera';
import { DeadDropComms } from './pages/DeadDropComms';

// Downloads
import { AppDownloads } from './pages/AppDownloads';

const App: React.FC = () => {
  const { isLoggedIn, loading, checkStatus } = useAuthStore();
  const { preferences } = useSettingsStore();
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Apply theme class to <html> element whenever preference changes
  useEffect(() => {
    const html = document.documentElement;
    if (preferences.theme === 'light') {
      html.classList.add('theme-light');
    } else {
      html.classList.remove('theme-light');
    }
  }, [preferences.theme]);

  // Global '?' key opens shortcuts modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?') setShowShortcuts((v) => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    checkStatus();
  }, []);

  // Subscribe to main-process error broadcasts
  useEffect(() => {
    const off = window.api.on(IPC_CHANNELS.ERROR_REPORT, (event: unknown) => {
      const e = event as ErrorEvent;
      console.error(`[${e.source}] ${e.message}`, e);
      useErrorStore.getState().addError(e);
    });
    return off;
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d3b5e]">
        <div className="animate-pulse text-white text-sm">Loading RMPG Forensics...</div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <ErrorBoundary>
        <LoginScreen />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
    <UpdateBanner />
    {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Case */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/case-manager" element={<CaseManager />} />
          <Route path="/acquisition-wizard" element={<AcquisitionWizard />} />
          <Route path="/case-timeline" element={<CaseTimeline />} />

          {/* Android Collections */}
          <Route path="/android/adb-backup" element={<AdbBackup />} />
          <Route path="/android/apk-downgrade" element={<ApkDowngrade />} />
          <Route path="/android/device-info" element={<DeviceInfo />} />
          <Route path="/android/file-extraction" element={<FileExtraction />} />
          <Route path="/android/device-explorer" element={<DeviceExplorer />} />
          <Route path="/android/device-mirror" element={<DeviceMirror />} />
          <Route path="/android/apk-manager" element={<ApkManager />} />
          <Route path="/android/bulk-copy" element={<BulkCopy />} />
          <Route path="/android/contacts-sms" element={<ContactsExtraction />} />
          <Route path="/android/misc-collections" element={<MiscCollections />} />
          <Route path="/android/multi-device" element={<MultiDevice />} />
          <Route path="/android/special-dump" element={<SpecialDump />} />
          <Route path="/android/trash-recovery" element={<TrashRecovery />} />
          <Route path="/android/reboot" element={<DeviceReboot />} />
          <Route path="/android/wifi-debug" element={<WifiDebug />} />

          {/* WhatsApp */}
          <Route path="/whatsapp/extraction" element={<WhatsAppExtraction />} />
          <Route path="/whatsapp/contacts" element={<WhatsAppContacts />} />
          <Route path="/whatsapp/decrypt" element={<WhatsAppDecrypt />} />
          <Route path="/whatsapp/media-decrypt" element={<WhatsAppMediaDecrypt />} />
          <Route path="/whatsapp/parser" element={<WhatsAppParser />} />
          <Route path="/whatsapp/legacy-parser" element={<WhatsAppLegacyParser />} />
          <Route path="/whatsapp/audio-transcription" element={<AudioTranscription />} />
          <Route path="/whatsapp/merge" element={<WhatsAppMerge />} />

          {/* iOS Collections */}
          <Route path="/ios/quick-extract" element={<IosQuickExtract />} />
          <Route path="/ios/backup" element={<IosBackup />} />
          <Route path="/ios/file-extraction" element={<IosFileExtraction />} />
          <Route path="/ios/messages" element={<IosMessages />} />
          <Route path="/ios/call-history" element={<IosCallHistory />} />
          <Route path="/ios/contacts" element={<IosContacts />} />
          <Route path="/ios/photos" element={<IosPhotos />} />
          <Route path="/ios/app-data" element={<IosAppData />} />
          <Route path="/ios/location-history" element={<IosLocationHistory />} />
          <Route path="/ios/deleted-data" element={<IosDeletedData />} />
          <Route path="/ios/safari-history" element={<IosSafariHistory />} />
          <Route path="/ios/notes" element={<IosNotes />} />
          <Route path="/ios/voicemail" element={<IosVoicemail />} />
          <Route path="/ios/health-data" element={<IosHealthData />} />
          <Route path="/ios/screen-time" element={<IosScreenTime />} />
          <Route path="/ios/intelligence" element={<IosIntelligence />} />

          {/* Analysis */}
          <Route path="/analysis/ai-agent" element={<ForensicAgent />} />
          <Route path="/analysis/iped" element={<IpedIntegration />} />
          <Route path="/analysis/ocr" element={<OcrProcessing />} />
          <Route path="/analysis/screen-capture" element={<ScreenCapture />} />
          <Route path="/analysis/media-processing" element={<MediaProcessing />} />
          <Route path="/analysis/instagram" element={<InstagramScraping />} />
          <Route path="/analysis/geolocation" element={<GeolocationMapper />} />
          <Route path="/analysis/image-finder" element={<ImageFinder />} />
          <Route path="/analysis/mvt-scanner" element={<MvtScanner />} />

          {/* Miscellaneous Tools */}
          <Route path="/tools/hash-generator" element={<HashGenerator />} />
          <Route path="/tools/ab-to-tar" element={<AbToTar />} />
          <Route path="/tools/samsung-unlock" element={<SamsungUnlock />} />
          <Route path="/breach/lockscreen" element={<LockScreenRecovery />} />
          <Route path="/breach/edl" element={<EdlImager />} />
          <Route path="/breach/mtk" element={<MtkClient />} />
          <Route path="/breach/ios-backup-decrypt" element={<IosBackupDecrypt />} />
          <Route path="/tools/acquisition-report" element={<AcquisitionReport />} />
          <Route path="/tools/jadx" element={<JadxDecompiler />} />
          <Route path="/tools/sqlite-browser" element={<SqliteBrowser />} />
          <Route path="/tools/exif-viewer" element={<ExifViewer />} />

          {/* Breach & Bypass */}
          <Route path="/breach/lock-screen" element={<LockScreenRecovery />} />
          <Route path="/breach/edl-imager" element={<EdlImager />} />
          <Route path="/breach/mtk-imager" element={<MtkImager />} />
          <Route path="/breach/ios-backup-decrypt" element={<IosBackupDecrypt />} />
          <Route path="/breach/advanced-decrypt" element={<AdvancedDecrypt />} />
          <Route path="/breach/brute-force" element={<BruteForceAttack />} />
          <Route path="/breach/network-breach" element={<NetworkBreach />} />
          <Route path="/breach/spy-tactical" element={<SpyTactical />} />
          <Route path="/breach/ios-trust-unlock" element={<IosTrustUnlock />} />
          <Route path="/breach/android-bypass" element={<AndroidBypass />} />
          <Route path="/breach/force-compliance" element={<ForceCompliance />} />
          <Route path="/breach/live-view" element={<LiveDeviceView />} />
          <Route path="/breach/selective-extraction" element={<SelectiveExtraction />} />
          <Route path="/breach/website-breach" element={<WebsiteBreach />} />
          <Route path="/breach/pii-polling" element={<PiiPolling />} />
          <Route path="/intel/people-search" element={<PeopleSearch />} />
          <Route path="/intel/python-toolkit" element={<PythonToolkit />} />

          {/* PI & Spy Integrations */}
          <Route path="/pi/sherlock" element={<SherlockOsint />} />
          <Route path="/pi/spiderfoot" element={<SpiderFootScanner />} />
          <Route path="/pi/harvester" element={<TheHarvester />} />
          <Route path="/pi/phoneinfoga" element={<PhoneInfogaLookup />} />
          <Route path="/pi/ghunt" element={<GHuntRecon />} />
          <Route path="/pi/maigret" element={<MaigretProfiler />} />
          <Route path="/pi/holehe" element={<HoleheChecker />} />
          <Route path="/pi/social-analyzer" element={<SocialAnalyzerTool />} />
          <Route path="/pi/photon" element={<PhotonCrawler />} />
          <Route path="/pi/skiptracer" element={<SkiptracerTool />} />
          <Route path="/pi/recon-ng" element={<ReconNgFramework />} />
          <Route path="/pi/maltego" element={<MaltegoCE />} />
          <Route path="/pi/metagoofil" element={<MetagoofilExtractor />} />
          <Route path="/pi/creepy" element={<CreepyGeolocator />} />
          <Route path="/pi/tineye" element={<TinEyeReverse />} />
          <Route path="/pi/plate-reader" element={<LicensePlateReader />} />
          <Route path="/pi/counter-surv" element={<CounterSurveillance />} />
          <Route path="/pi/vehicle-tracker" element={<VehicleTracker />} />
          <Route path="/pi/stakeout" element={<StakeoutCamera />} />
          <Route path="/pi/dead-drop" element={<DeadDropComms />} />

          {/* Settings */}
          <Route path="/settings/tools" element={<ToolConfiguration />} />
          <Route path="/settings/preferences" element={<Preferences />} />
          <Route path="/analysis/decryption" element={<DecryptionTools />} />
          <Route path="/settings/sync" element={<SyncSettings />} />

          {/* Downloads */}
          <Route path="/downloads" element={<AppDownloads />} />
        </Route>
      </Routes>
    </HashRouter>
    </ErrorBoundary>
  );
};

export default App;
