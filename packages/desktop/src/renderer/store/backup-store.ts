import { create } from 'zustand';
import { IPC_CHANNELS } from '@rmpg/shared';

export interface BackupProgress {
  percent: number;
  message: string;
  bytes?: number;
  totalBytes?: number;
  speed?: number;
  eta?: number;
  filesCount?: number;
  totalFiles?: number;
}

export interface BackupTask {
  udid: string;
  deviceName: string;
  outputPath: string;
  startTime: number;
  status: 'idle' | 'running' | 'done' | 'error';
  progress: BackupProgress;
  backupPath?: string;
  error?: string;
  dismissed: boolean;
}

interface BackupStore {
  task: BackupTask | null;
  // Called by IosQuickExtract / IosBackup to start a background backup
  startBackup: (udid: string, deviceName: string, outputPath: string) => Promise<{ success: boolean; backupPath?: string; error?: string }>;
  updateProgress: (progress: Partial<BackupProgress>) => void;
  setDone: (backupPath: string) => void;
  setError: (error: string) => void;
  dismiss: () => void;
  reset: () => void;
}

export const useBackupStore = create<BackupStore>((set, get) => ({
  task: null,

  startBackup: async (udid, deviceName, outputPath) => {
    // If a backup is already running, don't start another
    const current = get().task;
    if (current?.status === 'running') {
      return { success: false, error: 'A backup is already in progress' };
    }

    set({
      task: {
        udid,
        deviceName,
        outputPath,
        startTime: Date.now(),
        status: 'running',
        progress: { percent: 0, message: 'Starting backup…' },
        dismissed: false,
      },
    });

    try {
      const result = await window.api.invoke(IPC_CHANNELS.IOS_BACKUP, {
        udid,
        outputPath,
        encrypted: false,
      }) as { success?: boolean; backupPath?: string; error?: string };

      if (result?.backupPath || result?.success) {
        get().setDone(result.backupPath ?? outputPath);
        return { success: true, backupPath: result.backupPath ?? outputPath };
      } else {
        const err = result?.error ?? 'Backup failed';
        get().setError(err);
        return { success: false, error: err };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      get().setError(msg);
      return { success: false, error: msg };
    }
  },

  updateProgress: (progress) => {
    set((state) => {
      if (!state.task) return state;
      return {
        task: {
          ...state.task,
          progress: { ...state.task.progress, ...progress },
        },
      };
    });
  },

  setDone: (backupPath) => {
    set((state) => {
      if (!state.task) return state;
      return {
        task: {
          ...state.task,
          status: 'done',
          backupPath,
          progress: { ...state.task.progress, percent: 100, message: 'Backup complete' },
        },
      };
    });
  },

  setError: (error) => {
    set((state) => {
      if (!state.task) return state;
      return { task: { ...state.task, status: 'error', error } };
    });
  },

  dismiss: () => {
    set((state) => {
      if (!state.task) return state;
      return { task: { ...state.task, dismissed: true } };
    });
  },

  reset: () => set({ task: null }),
}));
