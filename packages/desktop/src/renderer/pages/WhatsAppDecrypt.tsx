import React, { useState } from 'react';
import { Lock, Play, Loader2 } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader, LogConsole, FilePicker, FolderPicker } from '../components/common';
import { useIpc } from '../hooks';

export const WhatsAppDecrypt: React.FC = () => {
  const ipc = useIpc();

  const [encryptedDb, setEncryptedDb] = useState('');
  const [keyFile, setKeyFile] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [decrypting, setDecrypting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleDecrypt = async () => {
    if (!encryptedDb || !keyFile || !outputFolder) return;
    setDecrypting(true);
    addLog(`Starting decryption of: ${encryptedDb}`);
    addLog(`Key file: ${keyFile}`);
    addLog(`Output: ${outputFolder}`);

    const result = await ipc.invoke<{ success: boolean; outputPath?: string; message?: string }>(
      IPC_CHANNELS.WHATSAPP_DECRYPT,
      {
        encryptedDbPath: encryptedDb,
        keyFilePath: keyFile,
        outputPath: outputFolder,
      }
    );

    if (result?.success) {
      addLog(`Decryption completed successfully.`);
      if (result.outputPath) {
        addLog(`Decrypted database saved to: ${result.outputPath}`);
      }
    } else {
      addLog(`Decryption failed: ${result?.message ?? ipc.error ?? 'Unknown error'}`);
    }
    setDecrypting(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Decrypt"
        description="Decrypt WhatsApp encrypted database files (.crypt14/.crypt15)"
        icon={<Lock size={24} />}
      />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <FilePicker
            label="Encrypted Database"
            value={encryptedDb}
            onChange={setEncryptedDb}
            placeholder="Select .db.crypt14 or .crypt15 file..."
            filters={[
              { name: 'WhatsApp Encrypted DB', extensions: ['crypt14', 'crypt15', 'crypt12'] },
            ]}
            disabled={decrypting}
          />

          <FilePicker
            label="Key File"
            value={keyFile}
            onChange={setKeyFile}
            placeholder="Select key file..."
            filters={[{ name: 'Key Files', extensions: ['*'] }]}
            disabled={decrypting}
          />

          <FolderPicker
            label="Output Folder"
            value={outputFolder}
            onChange={setOutputFolder}
            disabled={decrypting}
          />

          <button
            onClick={handleDecrypt}
            disabled={decrypting || !encryptedDb || !keyFile || !outputFolder}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {decrypting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {decrypting ? 'Decrypting...' : 'Decrypt Database'}
          </button>

          {ipc.error && (
            <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-300">
              {ipc.error}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-white">Instructions</h4>
            <ul className="space-y-1.5 text-xs text-slate-400">
              <li>1. Select the encrypted WhatsApp database file (.crypt14 or .crypt15).</li>
              <li>2. Select the corresponding key file extracted from the device.</li>
              <li>3. Choose an output folder for the decrypted database.</li>
              <li>4. Click "Decrypt Database" to begin the decryption process.</li>
            </ul>
          </div>
        </div>
      </div>

      <LogConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
};
