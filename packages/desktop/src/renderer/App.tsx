import React, { useEffect, Component, ReactNode } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { LoginScreen } from './pages/LoginScreen';
import { useAuthStore } from './store';

// Error boundary to prevent page crashes from killing the entire app
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="card max-w-md text-center">
            <h2 className="mb-2 text-lg font-bold text-red-400">Page Error</h2>
            <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>{this.state.error}</p>
            <button onClick={() => { this.setState({ hasError: false }); window.location.hash = '#/'; }} className="btn-primary">
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
import { IosBackup } from './pages/IosBackup';
import { IosFileExtraction } from './pages/IosFileExtraction';
import { IosMessages } from './pages/IosMessages';
import { IosCallHistory } from './pages/IosCallHistory';
import { IosContacts } from './pages/IosContacts';
import { IosPhotos } from './pages/IosPhotos';
import { IosAppData } from './pages/IosAppData';
import { IosLocationHistory } from './pages/IosLocationHistory';
import { IosDeletedData } from './pages/IosDeletedData';

// Analysis
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
import { AcquisitionReport } from './pages/AcquisitionReport';
import { JadxDecompiler } from './pages/JadxDecompiler';
import { SqliteBrowser } from './pages/SqliteBrowser';
import { ExifViewer } from './pages/ExifViewer';

// Settings
import { ToolConfiguration } from './pages/ToolConfiguration';
import { SyncSettings } from './pages/SyncSettings';

const App: React.FC = () => {
  const { isLoggedIn, loading, checkStatus } = useAuthStore();

  useEffect(() => {
    checkStatus();
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gradient-to-br from-[#1a2a3a] to-[#0d3b5e]">
        <div className="animate-pulse text-white text-sm">Loading RMPG Forensics...</div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  return (
    <ErrorBoundary>
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Case */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/case-manager" element={<CaseManager />} />

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
          <Route path="/ios/backup" element={<IosBackup />} />
          <Route path="/ios/file-extraction" element={<IosFileExtraction />} />
          <Route path="/ios/messages" element={<IosMessages />} />
          <Route path="/ios/call-history" element={<IosCallHistory />} />
          <Route path="/ios/contacts" element={<IosContacts />} />
          <Route path="/ios/photos" element={<IosPhotos />} />
          <Route path="/ios/app-data" element={<IosAppData />} />
          <Route path="/ios/location-history" element={<IosLocationHistory />} />
          <Route path="/ios/deleted-data" element={<IosDeletedData />} />

          {/* Analysis */}
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
          <Route path="/tools/acquisition-report" element={<AcquisitionReport />} />
          <Route path="/tools/jadx" element={<JadxDecompiler />} />
          <Route path="/tools/sqlite-browser" element={<SqliteBrowser />} />
          <Route path="/tools/exif-viewer" element={<ExifViewer />} />

          {/* Settings */}
          <Route path="/settings/tools" element={<ToolConfiguration />} />
          <Route path="/settings/sync" element={<SyncSettings />} />
        </Route>
      </Routes>
    </HashRouter>
    </ErrorBoundary>
  );
};

export default App;
