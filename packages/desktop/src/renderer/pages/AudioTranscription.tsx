import React, { useState } from 'react';
import { Mic, Play } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, ProgressIndicator, FolderPicker } from '../components/common';
import { useProcess } from '../hooks';

export const AudioTranscription: React.FC = () => {
  const process = useProcess({
    channel: IPC_CHANNELS.AUDIO_TRANSCRIBE,
    progressChannel: IPC_CHANNELS.AUDIO_TRANSCRIBE_PROGRESS,
  });

  const [inputFolder, setInputFolder] = useState('');
  const [outputFolder, setOutputFolder] = useState('');

  const handleStart = async () => {
    if (!inputFolder || !outputFolder) return;
    await process.start({
      inputPath: inputFolder,
      outputPath: outputFolder,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audio Transcription"
        description="Transcribe Opus voice messages and audio files to text"
        icon={<Mic size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <FolderPicker
            label="Input Folder (Opus Files)"
            value={inputFolder}
            onChange={setInputFolder}
            disabled={process.isRunning}
          />

          <FolderPicker
            label="Output Folder (Reports)"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={process.isRunning}
          />

          <button
            onClick={handleStart}
            disabled={process.isRunning || !inputFolder || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {process.isRunning ? 'Transcription in Progress...' : 'Start Transcription'}
          </button>
        </div>

        <div className="space-y-4">
          {(process.isRunning || process.progress.percent > 0) && (
            <ProgressIndicator
              percent={process.progress.percent}
              message={process.progress.message}
              isRunning={process.isRunning}
            />
          )}
        </div>
      </div>

      <LogConsole logs={process.logs} onClear={process.clearLogs} />
    </div>
  );
};
