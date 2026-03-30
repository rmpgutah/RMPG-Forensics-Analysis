import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import {
  checkAuthStatus,
  login,
  loginWithTrust,
  setup2FA,
  verify2FA,
  resetAll2FA,
  logout,
  createUser,
  listUsers,
  trustDevice,
} from '../services/auth-service';

export function registerAuthHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.AUTH_CHECK_STATUS, () => {
    return checkAuthStatus();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, (_e, username: string, password: string, deviceToken?: string) => {
    return loginWithTrust(username, password, deviceToken);
  });

  ipcMain.handle('auth:trust-device', (_e, username: string) => {
    return trustDevice(username);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SETUP_2FA, (_e, username: string) => {
    return setup2FA(username);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_VERIFY_2FA, (_e, username: string, token: string) => {
    return verify2FA(username, token);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_RESET_ALL_2FA, () => {
    return resetAll2FA();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, () => {
    logout();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_CREATE_USER, (_e, username: string, password: string) => {
    return createUser(username, password);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LIST_USERS, () => {
    return listUsers();
  });
}
