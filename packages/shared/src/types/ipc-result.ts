/**
 * Standard result type for IPC handler responses.
 *
 * Every `ipcMain.handle` callback should return either a success or failure
 * variant of this type. This eliminates ad-hoc `{ success, error }` objects
 * scattered across handlers and gives the renderer type-safe results.
 *
 * @example
 * ```ts
 * // In a handler:
 * return ipcSuccess(data);
 * return ipcFailure('Device not found');
 *
 * // In the renderer:
 * const result = await window.api.invoke(channel) as IpcResult<MyData>;
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export type IpcResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

/** Create a successful IPC result. */
export function ipcSuccess<T>(data: T): IpcResult<T> {
  return { success: true, data };
}

/** Create a failed IPC result from an error message or caught exception. */
export function ipcFailure(error: unknown): IpcResult<never> {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);
  return { success: false, error: message };
}
