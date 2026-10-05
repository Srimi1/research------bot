import { readFileSync } from 'node:fs';
import { getCACertificates } from 'node:tls';
import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';

// Keep proxy configuration and additional corporate CA roots in the main process.
// Tests can replace the standard undici dispatcher with MockAgent after import.
const extraCertificatePaths = new Set(
  [process.env.NODE_EXTRA_CA_CERTS, process.env.SSL_CERT_FILE, process.env.REQUESTS_CA_BUNDLE].filter(
    (value): value is string => Boolean(value),
  ),
);

/**
 * A missing or unreadable bundle named by an environment variable must not stop the app from
 * starting. Skip it with a warning; the system roots still apply.
 */
export function loadCertificates(
  paths: Iterable<string>,
  read: (path: string) => string = path => readFileSync(path, 'utf8'),
  warn: (message: string) => void = console.warn,
): string[] {
  const certificates = [...getCACertificates('default')];
  for (const path of paths) {
    try {
      const bundle = read(path);
      if (!bundle.includes('-----BEGIN CERTIFICATE-----')) throw new Error('no PEM certificates found');
      certificates.push(bundle);
    } catch (error) {
      warn(
        `Research Bot ignored the CA certificate file ${path}: ${error instanceof Error ? error.message : 'unreadable'}`,
      );
    }
  }
  return certificates;
}

const tlsOptions = { ca: loadCertificates(extraCertificatePaths) };
setGlobalDispatcher(
  new EnvHttpProxyAgent({
    connect: tlsOptions,
    requestTls: tlsOptions,
    proxyTls: tlsOptions,
  }),
);

export async function fetchNetwork(input: string | URL, init?: RequestInit): Promise<Response> {
  return (await undiciFetch(input, init as Parameters<typeof undiciFetch>[1])) as unknown as Response;
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

export async function requestJson<T>(url: string | URL, init?: RequestInit, maxBytes = 2_000_000): Promise<T> {
  const response = await fetchNetwork(url, {
    ...init,
    redirect: 'error',
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Remote request failed (HTTP ${response.status}).`);
  }
  return JSON.parse(await readLimited(response, maxBytes)) as T;
}
