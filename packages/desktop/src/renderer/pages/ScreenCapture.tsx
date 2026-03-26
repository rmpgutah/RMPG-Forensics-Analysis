import React, { useState } from 'react';
import { Camera, MonitorDown, ArrowDownWideNarrow, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, DeviceSelector, FolderPicker } from '../components/common';
import { useDeviceStatus } from '../hooks';

export const ScreenCapture: React.FC = () => {
  const { allDevices, selectedDevice, selectDevice, refresh } = useDeviceStatus();

  const [saveFolder, setSaveFolder] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [scrollCapturing, setScrollCapturing] = useState(false);

  const handleScreenshot = async () => {
    if (!selectedDevice || !saveFolder) return;
    setCapturing(true);
    try {
      const result = (await window.api.invoke(IPC_CHANNELS.SCREEN_CAPTURE, {
        serial: selectedDevice.serial,
        outputPath: saveFolder,
      })) as { filePath: string };
      if (result?.filePath) {
        setPreviewUrl(`file://${result.filePath}?t=${Date.now()}`);
      }
    } catch {
      // Error handled by main process
    } finally {
      setCapturing(false);
    }
  };

  const handleScrollCapture = async () => {
    if (!selectedDevice || !saveFolder) return;
    setScrollCapturing(true);
    try {
      const result = (await window.api.invoke(IPC_CHANNELS.SCREEN_SCROLL_CAPTURE, {
        serial: selectedDevice.serial,
        outputPath: saveFolder,
      })) as { filePath: string };
      if (result?.filePath) {
        setPreviewUrl(`file://${result.filePath}?t=${Date.now()}`);
      }
    } catch {
      // Error handled by main process
    } finally {
      setScrollCapturing(false);
    }
  };

  const isRunning = capturing || scrollCapturing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Screen Capture"
        description="Capture device screen as single screenshot or scrolling capture"
        icon={<Camera size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <DeviceSelector
            devices={allDevices}
            selected={selectedDevice}
            onSelect={selectDevice}
            onRefresh={refresh}
            disabled={isRunning}
          />

          <FolderPicker
            label="Save Location"
            value={saveFolder}
            onChange={setSaveFolder}
            disabled={isRunning}
          />

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleScreenshot}
              disabled={isRunning || !selectedDevice || !saveFolder}
              className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {capturing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <MonitorDown size={16} />
              )}
              {capturing ? 'Capturing...' : 'Screenshot'}
            </button>

            <button
              onClick={handleScrollCapture}
              disabled={isRunning || !selectedDevice || !saveFolder}
              className="flex items-center justify-center gap-2 rounded-md bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scrollCapturing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ArrowDownWideNarrow size={16} />
              )}
              {scrollCapturing ? 'Capturing...' : 'Scroll Capture'}
            </button>
          </div>
        </div>

        {/* Preview area */}
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-3 text-sm font-medium text-white">Preview</h4>
            <div className="flex min-h-[400px] items-center justify-center rounded-md border border-slate-700 bg-slate-950 overflow-hidden">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Screen capture preview"
                  className="max-h-[500px] w-auto object-contain"
                />
              ) : (
                <div className="text-center">
                  <Camera size={48} className="mx-auto mb-2 text-slate-700" />
                  <p className="text-sm text-slate-500">
                    No capture yet. Select a device and capture the screen.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
