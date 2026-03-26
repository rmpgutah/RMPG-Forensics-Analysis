import React, { useState } from 'react';
import { History, Play, FileOutput, Loader2, AlertTriangle } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FilePicker, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

interface ChatMessage {
  id: number;
  sender: string;
  message: string;
  timestamp: string;
  isFromMe: boolean;
}

export const WhatsAppLegacyParser: React.FC = () => {
  const { invoke, logs, clearLogs } = useIpc();

  const [dbPath, setDbPath] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [parsing, setParsing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleParse = async () => {
    if (!dbPath) return;
    setParsing(true);
    setMessages([]);
    try {
      const result = (await invoke(IPC_CHANNELS.WHATSAPP_PARSE_LEGACY_DB, {
        dbPath,
      })) as ChatMessage[];
      setMessages(result ?? []);
    } catch {
      // Error handled by logs
    } finally {
      setParsing(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!outputFolder || messages.length === 0) return;
    setGenerating(true);
    try {
      await invoke(IPC_CHANNELS.WHATSAPP_GENERATE_REPORT, {
        messages,
        outputPath: outputFolder,
      });
    } catch {
      // Error handled by logs
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Legacy Parser"
        description="Parse older WhatsApp SQLite database formats"
        icon={<History size={24} />}
      />

      <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            For older WhatsApp database formats (msgstore.db from Android 4.x/5.x era).
            If your database is from a recent WhatsApp version, use the standard WhatsApp
            Parser instead.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <FilePicker
            label="Legacy WhatsApp Database File"
            value={dbPath}
            onChange={setDbPath}
            placeholder="Select .db file..."
            filters={[{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'crypt5', 'crypt7', 'crypt8'] }]}
            disabled={parsing}
          />

          <button
            onClick={handleParse}
            disabled={parsing || !dbPath}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {parsing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {parsing ? 'Parsing Legacy Database...' : 'Parse Legacy Database'}
          </button>

          {messages.length > 0 && (
            <>
              <FolderPicker
                label="Report Output Folder"
                value={outputFolder}
                onChange={setOutputFolder}
                disabled={generating}
              />

              <button
                onClick={handleGenerateReport}
                disabled={generating || !outputFolder}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <FileOutput size={16} />
                )}
                {generating ? 'Generating Report...' : 'Generate HTML Report'}
              </button>
            </>
          )}
        </div>

        {/* Chat-like message view */}
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-3 text-sm font-medium text-white">
              Parsed Messages {messages.length > 0 && `(${messages.length})`}
            </h4>
            <div className="max-h-[500px] space-y-2 overflow-y-auto pr-2">
              {messages.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No messages parsed yet. Select a legacy database and click Parse.
                </p>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.isFromMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 ${
                        msg.isFromMe
                          ? 'bg-blue-600/30 border border-blue-700/50'
                          : 'bg-slate-700/50 border border-slate-600/50'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-300">
                          {msg.sender}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {msg.timestamp}
                        </span>
                      </div>
                      <p className="text-sm text-slate-200 break-words">{msg.message}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <LogConsole logs={logs} onClear={clearLogs} />
    </div>
  );
};
