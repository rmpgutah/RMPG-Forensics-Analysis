import React, { useState } from 'react';
import { Image, Play, Square } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, ProgressIndicator, FolderPicker } from '../components/common';
import { useProcess } from '../hooks';

export const WhatsAppMediaDecrypt: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.WHATSAPP_DECRYPT_MEDIA,
    progressChannel: IPC_CHANNELS.WHATSAPP_DECRYPT_MEDIA_PROGRESS,
  });

  const [sourceFolder, setSourceFolder] = useState('');
  const [outputFolder, setOutputFolder] = useState('');

  const handleStart = async () => {
    if (!sourceFolder || !outputFolder) return;
    await process.start({
      sourcePath: sourceFolder,
      outputPath: outputFolder,
    });
  };

  const handleCancel = () => {
    process.cancel();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Media Decrypt"
        description="Decrypt encrypted WhatsApp media files (images, videos, audio)"
        icon={<Image size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <FolderPicker
            label="Encrypted Media Folder"
            value={sourceFolder}
            onChange={setSourceFolder}
            disabled={process.isRunning}
          />

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={process.isRunning}
          />

          <div className="flex gap-3">
            <button
              onClick={handleStart}
              disabled={process.isRunning || !sourceFolder || !outputFolder}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              {process.isRunning ? 'Decrypting...' : 'Start Decryption'}
            </button>

            {process.isRunning && (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 rounded-md border border-red-700/50 bg-red-900/20 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-900/40"
              >
                <Square size={16} />
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {(process.isRunning || process.progress.percent > 0) && (
            <ProgressIndicator
              percent={process.progress.percent}
              message={process.progress.message}
              isRunning={process.isRunning}
            />
          )}

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">About</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              This tool decrypts encrypted WhatsApp media files stored on the device
              or extracted from a backup. Point to the folder containing .enc files
              and choose an output destination. Supported formats include images,
              videos, audio messages, documents, and stickers.
            </p>
          </div>
        </div>
      </div>

      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
