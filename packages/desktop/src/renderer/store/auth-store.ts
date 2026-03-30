import { create } from 'zustand';
import { IPC_CHANNELS } from '@rmpg/shared';

interface AuthState {
  isLoggedIn: boolean;
  hasUsers: boolean;
  currentUser: string | null;
  requires2FASetup: boolean;
  requires2FAVerify: boolean;
  loading: boolean;

  checkStatus: () => Promise<void>;
  login: (username: string, password: string, deviceToken?: string) => Promise<{ success: boolean; error?: string }>;
  setup2FA: () => Promise<{ secret?: string; otpauthUrl?: string; error?: string }>;
  verify2FA: (token: string) => Promise<{ success: boolean; error?: string }>;
  createUser: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  resetAll2FA: () => Promise<{ success: boolean; count: number }>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isLoggedIn: false,
  hasUsers: false,
  currentUser: null,
  requires2FASetup: false,
  requires2FAVerify: false,
  loading: true,

  checkStatus: async () => {
    try {
      const status = await window.api.invoke(IPC_CHANNELS.AUTH_CHECK_STATUS);
      set({
        isLoggedIn: status.isLoggedIn,
        hasUsers: status.hasUsers,
        currentUser: status.currentUser,
        requires2FASetup: status.requires2FASetup,
        requires2FAVerify: status.requires2FAVerify,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  login: async (username, password, deviceToken?) => {
    const result = await window.api.invoke(IPC_CHANNELS.AUTH_LOGIN, username, password, deviceToken);
    if (result.success) {
      const needs2FA = result.needs2FASetup || result.needs2FAVerify;
      set({
        isLoggedIn: !needs2FA, // If trusted device, skip 2FA and log in immediately
        currentUser: username,
        requires2FASetup: result.needs2FASetup ?? false,
        requires2FAVerify: result.needs2FAVerify ?? false,
      });
    }
    return result;
  },

  setup2FA: async () => {
    const user = get().currentUser;
    if (!user) return { error: 'No user' };
    return await window.api.invoke(IPC_CHANNELS.AUTH_SETUP_2FA, user);
  },

  verify2FA: async (token) => {
    const user = get().currentUser;
    if (!user) return { success: false, error: 'No user' };
    const result = await window.api.invoke(IPC_CHANNELS.AUTH_VERIFY_2FA, user, token);
    if (result.success) {
      set({
        isLoggedIn: true,
        requires2FASetup: false,
        requires2FAVerify: false,
      });
    }
    return result;
  },

  createUser: async (username, password) => {
    const result = await window.api.invoke(IPC_CHANNELS.AUTH_CREATE_USER, username, password);
    if (result.success) {
      set({ hasUsers: true });
    }
    return result;
  },

  resetAll2FA: async () => {
    return await window.api.invoke(IPC_CHANNELS.AUTH_RESET_ALL_2FA);
  },

  logout: async () => {
    await window.api.invoke(IPC_CHANNELS.AUTH_LOGOUT);
    set({
      isLoggedIn: false,
      currentUser: null,
      requires2FASetup: false,
      requires2FAVerify: false,
    });
  },
}));
