import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';

// Case
import { Dashboard } from './pages/Dashboard';
import { CaseManager } from './pages/CaseManager';

// Android
import { AdbBackup } from './pages/AdbBackup';
import { DeviceInfo } from './pages/DeviceInfo';
import { FileExtraction } from './pages/FileExtraction';
import { ApkManager } from './pages/ApkManager';
import { BulkCopy } from './pages/BulkCopy';
import { SpecialDump } from './pages/SpecialDump';
import { TrashRecovery } from './pages/TrashRecovery';

// WhatsApp
import { WhatsAppExtraction } from './pages/WhatsAppExtraction';
import { WhatsAppContacts } from './pages/WhatsAppContacts';
import { WhatsAppDecrypt } from './pages/WhatsAppDecrypt';
import { WhatsAppMediaDecrypt } from './pages/WhatsAppMediaDecrypt';
import { WhatsAppParser } from './pages/WhatsAppParser';
import { WhatsAppLegacyParser } from './pages/WhatsAppLegacyParser';
import { AudioTranscription } from './pages/AudioTranscription';

// iOS
import { IosBackup } from './pages/IosBackup';

// Analysis
import { IpedIntegration } from './pages/IpedIntegration';
import { OcrProcessing } from './pages/OcrProcessing';
import { ScreenCapture } from './pages/ScreenCapture';
import { MediaProcessing } from './pages/MediaProcessing';
import { InstagramScraping } from './pages/InstagramScraping';

// Tools
import { HashGenerator } from './pages/HashGenerator';
import { AbToTar } from './pages/AbToTar';
import { SamsungUnlock } from './pages/SamsungUnlock';

// Settings
import { ToolConfiguration } from './pages/ToolConfiguration';
import { SyncSettings } from './pages/SyncSettings';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Case */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/case-manager" element={<CaseManager />} />

          {/* Android */}
          <Route path="/android/adb-backup" element={<AdbBackup />} />
          <Route path="/android/device-info" element={<DeviceInfo />} />
          <Route path="/android/file-extraction" element={<FileExtraction />} />
          <Route path="/android/apk-manager" element={<ApkManager />} />
          <Route path="/android/bulk-copy" element={<BulkCopy />} />
          <Route path="/android/special-dump" element={<SpecialDump />} />
          <Route path="/android/trash-recovery" element={<TrashRecovery />} />

          {/* WhatsApp */}
          <Route path="/whatsapp/extraction" element={<WhatsAppExtraction />} />
          <Route path="/whatsapp/contacts" element={<WhatsAppContacts />} />
          <Route path="/whatsapp/decrypt" element={<WhatsAppDecrypt />} />
          <Route path="/whatsapp/media-decrypt" element={<WhatsAppMediaDecrypt />} />
          <Route path="/whatsapp/parser" element={<WhatsAppParser />} />
          <Route path="/whatsapp/legacy-parser" element={<WhatsAppLegacyParser />} />
          <Route path="/whatsapp/audio-transcription" element={<AudioTranscription />} />

          {/* iOS */}
          <Route path="/ios/backup" element={<IosBackup />} />

          {/* Analysis */}
          <Route path="/analysis/iped" element={<IpedIntegration />} />
          <Route path="/analysis/ocr" element={<OcrProcessing />} />
          <Route path="/analysis/screen-capture" element={<ScreenCapture />} />
          <Route path="/analysis/media-processing" element={<MediaProcessing />} />
          <Route path="/analysis/instagram" element={<InstagramScraping />} />

          {/* Tools */}
          <Route path="/tools/hash-generator" element={<HashGenerator />} />
          <Route path="/tools/ab-to-tar" element={<AbToTar />} />
          <Route path="/tools/samsung-unlock" element={<SamsungUnlock />} />

          {/* Settings */}
          <Route path="/settings/tools" element={<ToolConfiguration />} />
          <Route path="/settings/sync" element={<SyncSettings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
};

export default App;
