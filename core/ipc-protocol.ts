/**
 * Electron prefixes a rejected invoke() with "Error invoking remote method ...", so handlers
 * answer with an envelope instead and the preload turns a failure back into a plain Error.
 * Kept free of other imports so the sandboxed preload bundle stays small.
 */
export type IpcResult<T = unknown> = { ok: true; value: T } | { ok: false; message: string };

export function unwrap<T>(result: IpcResult<T>): T {
  if (result && typeof result === 'object' && 'ok' in result) {
    if (result.ok) return result.value;
    throw new Error(result.message);
  }
  throw new Error('The application returned an unexpected response.');
}
