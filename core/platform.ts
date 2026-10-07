/**
 * What the research backend needs from the device it runs on. The desktop app supplies Node and
 * Electron implementations (electron/*); the Android app supplies WebView and native ones
 * (src/android/*). Everything in core/ stays free of Node and browser-only APIs beyond Web standards.
 */

/** A standards fetch. Implementations must honor `redirect: 'error'`, `signal` and stream the body. */
export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Small private files, such as the host identity and the encrypted credential record. */
export interface FileStore {
  /** The file contents, or undefined when the file does not exist. */
  read(name: string): Promise<Uint8Array | undefined>;
  /** Replace the file atomically, readable only by this app. */
  write(name: string, data: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

/** OS-protected encryption for credentials (Electron safeStorage, Android Keystore). */
export interface CredentialStore {
  available(): boolean;
  encrypt(text: string): Uint8Array | Promise<Uint8Array>;
  decrypt(data: Uint8Array): string | Promise<string>;
}

/** One HTTP request that reached the local sign-in callback. */
export interface CallbackRequest {
  method: string;
  /** Path and query, for example `/auth/callback?code=...`. */
  url: string;
  /** Answer once with plain text; await the write. Return to the app only after a state-validated outcome. */
  respond(status: number, body: string, returnToApp?: boolean): void | Promise<void>;
}

export interface LoopbackServer {
  port: number;
  close(): void;
}

/** Listen on 127.0.0.1 with a random port for the OAuth redirect (RFC 8252 loopback). */
export type StartLoopback = (handler: (request: CallbackRequest) => void) => Promise<LoopbackServer>;

/** The subset of node:sqlite's DatabaseSync that the store uses. */
export interface SqlStatement {
  run(...params: SqlValue[]): { changes: number | bigint };
  get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
  all(...params: SqlValue[]): Record<string, SqlValue>[];
}
export type SqlValue = string | number | bigint | null | Uint8Array;
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

const BASE64URL = /[+/=]/g;
const BASE64URL_MAP: Record<string, string> = { '+': '-', '/': '_', '=': '' };

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(BASE64URL, match => BASE64URL_MAP[match]);
}

export function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Keep device IDs cryptographically random when WebView lacks the UUID convenience API. */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** WebView's optional timeout API must not prevent a request from starting. */
export function timeoutSignal(milliseconds: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(milliseconds);
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647)
    throw new RangeError('The timeout must be a nonnegative 32-bit integer.');
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('The request timed out.', 'TimeoutError')),
    milliseconds,
  );
  // Node's timers should behave like the native timeout signal, which does not keep Node alive.
  (timer as unknown as { unref?: () => void }).unref?.();
  return controller.signal;
}

export async function sha256Base64url(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** AbortSignal.any arrived in WebView 116, later than the bundled JavaScript's baseline. */
export function combineSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  const parents = [...new Set(signals)];
  const already = parents.find(signal => signal.aborted);
  if (already) {
    controller.abort(already.reason);
    return controller.signal;
  }
  const listeners = parents.map(signal => {
    const listener = () => controller.abort(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    return { signal, listener };
  });
  controller.signal.addEventListener(
    'abort',
    () => {
      for (const { signal, listener } of listeners) signal.removeEventListener('abort', listener);
    },
    { once: true },
  );
  return controller.signal;
}

/** Compare secrets without returning early on the first differing character. */
export function constantEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

export async function readLimited(response: Response, maxBytes = 2_000_000): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return result + decoder.decode();
      total += value.byteLength;
      if (total > maxBytes) throw new Error('Remote response exceeded the size limit.');
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function requestJson<T>(fetch: Fetch, url: string, init?: RequestInit, maxBytes = 2_000_000): Promise<T> {
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: init?.signal ? combineSignals([init.signal, timeoutSignal(30_000)]) : timeoutSignal(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Remote request failed (HTTP ${response.status}).`);
  }
  return JSON.parse(await readLimited(response, maxBytes)) as T;
}
