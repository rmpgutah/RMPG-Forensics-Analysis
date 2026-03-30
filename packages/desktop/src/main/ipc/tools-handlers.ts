import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@rmpg/shared';
import type { ToolName } from '@rmpg/shared';
import { resolveAllTools, saveUserToolPath } from '../services/tool-resolver';
import { clearAdbPathCache } from '../services/adb-service';
import { getPlatform } from '../services/platform-service';
import { APP_VERSION } from '@rmpg/shared';

/**
 * Register tool management IPC handlers.
 *
 * Provides the renderer with the ability to check which external tools
 * are installed and reachable, and to configure custom paths for tools
 * that are not on the system PATH.
 */
export function registerToolsHandlers(): void {
  // ---------------------------------------------------------------------------
  // TOOLS_CHECK - Resolve all known tools and return their status
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.TOOLS_CHECK, async (_event, toolName?: ToolName) => {
    if (toolName) {
      // Single tool lookup
      const { resolveTool } = require('../services/tool-resolver');
      return resolveTool(toolName);
    }
    return resolveAllTools();
  });

  // ---------------------------------------------------------------------------
  // TOOLS_CONFIGURE - Save a user-configured path for a specific tool
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.TOOLS_CONFIGURE,
    async (_event, toolName: ToolName, toolPath: string) => {
      await saveUserToolPath(toolName, toolPath);

      // Clear cached paths so the new configuration takes effect immediately
      if (toolName === 'adb') {
        clearAdbPathCache();
      }

      return { success: true, toolName, toolPath };
    }
  );

  // ---------------------------------------------------------------------------
  // APP_GET_PLATFORM - Return the current OS platform
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.APP_GET_PLATFORM, () => {
    return getPlatform();
  });

  // ---------------------------------------------------------------------------
  // APP_GET_VERSION - Return the application version
  // ---------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return APP_VERSION;
  });
}
