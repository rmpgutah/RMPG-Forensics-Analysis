import React from 'react';
import { FolderOpen } from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';

interface FolderPickerProps {
  label: string;
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const FolderPicker: React.FC<FolderPickerProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Select a folder...',
  disabled = false,
}) => {
  const handlePick = async () => {
    try {
      const result = await window.api.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER);
      if (result && typeof result === 'string') {
        onChange(result);
      } else if (Array.isArray(result) && result.length > 0) {
        onChange(result[0]);
      }
    } catch {
      // User cancelled
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-300">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          onClick={handlePick}
          disabled={disabled}
          className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          <FolderOpen size={16} />
          Browse
        </button>
      </div>
    </div>
  );
};
