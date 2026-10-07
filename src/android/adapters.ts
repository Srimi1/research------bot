import { randomId, type CredentialStore, type Fetch, type FileStore, type StartLoopback } from '../../core/platform';
import { NetworkFailure, nativeNetworkFailure } from '../../core/network-errors';
import { Native, fromBase64, toBase64, type ResearchNativePlugin } from './native';

type Bridge = Pick<ResearchNativePlugin, 'httpOpen' | 'httpRead' | 'httpClose'>;

const aborted = (signal?: AbortSignal | null) =>
  signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');

/**
 * fetch() through the native HTTPS client. The WebView's own fetch is subject to CORS, which the
 * ChatGPT and OpenID endpoints do not grant to apps. Bodies stream chunk by chunk, so responses
 * stream exactly as they do on desktop, and aborting the signal closes the connection.
 */
export function createNativeFetch(bridge: Bridge): Fetch {
  return async (input, init = {}) => {
    const url = String(input);
    const signal = init.signal;
    if (signal?.aborted) throw aborted(signal);
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string')
      throw new TypeError('Only text request bodies are supported.');
    const id = randomId();
    const close = () => void bridge.httpClose({ id }).catch(() => undefined);
    signal?.addEventListener('abort', close, { once: true });
    const release = () => signal?.removeEventListener('abort', close);
    let head: Awaited<ReturnType<Bridge['httpOpen']>>;
    try {
      head = await bridge.httpOpen({
        id,
        url,
        method: init.method ?? 'GET',
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        ...(typeof init.body === 'string' ? { body: init.body } : {}),
        follow: init.redirect !== 'error' && init.redirect !== 'manual',
      });
    } catch (error) {
      release();
      if (signal?.aborted) throw aborted(signal);
      throw nativeNetworkFailure(error);
    }
    if (signal?.aborted) {
      release();
      close();
      throw aborted(signal);
    }
    if (!Number.isInteger(head.status) || head.status < 200 || head.status > 599) {
      // Response() only accepts 200-599; HttpURLConnection reports -1 for an unreadable reply.
      release();
      close();
      throw new NetworkFailure('response');
    }
    if (head.status >= 300 && head.status < 400 && init.redirect === 'error') {
      release();
      close();
      throw new NetworkFailure('redirect');
    }
    const empty = [204, 205, 304].includes(head.status) || init.method === 'HEAD';
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      release();
      close();
    };
    const body = empty
      ? null
      : new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (signal?.aborted) {
              finish();
              controller.error(aborted(signal));
              return;
            }
            try {
              const chunk = await bridge.httpRead({ id });
              if (signal?.aborted) throw aborted(signal);
              if (chunk.done) {
                finish();
                controller.close();
              } else controller.enqueue(fromBase64(chunk.data ?? ''));
            } catch (error) {
              finish();
              controller.error(signal?.aborted ? aborted(signal) : nativeNetworkFailure(error));
            }
          },
          cancel: finish,
        });
    if (empty) finish();
    try {
      return new Response(body, { status: head.status, statusText: head.statusText, headers: head.headers });
    } catch {
      finish();
      throw new NetworkFailure('response');
    }
  };
}

export const nativeFetch = createNativeFetch(Native);

type LoopbackBridge = Pick<ResearchNativePlugin, 'addListener' | 'loopbackStart' | 'loopbackRespond' | 'loopbackClose'>;

export function createNativeLoopback(bridge: LoopbackBridge): StartLoopback {
  return async handler => {
    let serverId = '';
    const listener = await bridge.addListener('loopbackRequest', event => {
      if (event.serverId !== serverId) return;
      let answered = false;
      handler({
        method: event.method,
        url: event.url,
        async respond(status, body, returnToApp = false) {
          if (answered) return;
          answered = true;
          await bridge
            .loopbackRespond({ requestId: event.requestId, status, body, returnToApp })
            .catch(() => undefined);
        },
      });
    });
    try {
      const server = await bridge.loopbackStart();
      serverId = server.serverId;
      return {
        port: server.port,
        close() {
          void listener.remove();
          void bridge.loopbackClose({ serverId: server.serverId }).catch(() => undefined);
        },
      };
    } catch (error) {
      await listener.remove();
      throw error;
    }
  };
}

export const nativeLoopback = createNativeLoopback(Native);

/** App-private files (Context.getFilesDir()/research), replaced atomically. */
export const nativeFiles: FileStore = {
  async read(name) {
    const result = await Native.fileRead({ name });
    return result.missing ? undefined : fromBase64(result.data ?? '');
  },
  async write(name, data) {
    await Native.fileWrite({ name, data: toBase64(data) });
  },
  async remove(name) {
    await Native.fileRemove({ name });
  },
};

/** AES-256-GCM with a non-exportable Android Keystore key. */
export const keystoreCredentials: CredentialStore = {
  available: () => true,
  encrypt: async text => fromBase64((await Native.encrypt({ text })).data),
  decrypt: async data => (await Native.decrypt({ data: toBase64(data) })).text,
};
