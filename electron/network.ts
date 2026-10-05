import { readFileSync } from 'node:fs';
import { getCACertificates } from 'node:tls';
import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';

// Keep proxy configuration and additional corporate CA roots in the main process.
// Tests can replace the standard undici dispatcher with MockAgent after import.
const extraCertificatePaths = new Set([
  process.env.NODE_EXTRA_CA_CERTS,
  process.env.SSL_CERT_FILE,
  process.env.REQUESTS_CA_BUNDLE,
].filter((value): value is string => Boolean(value)));
const certificates = [...getCACertificates('default')];
for (const path of extraCertificatePaths) certificates.push(readFileSync(path, 'utf8'));
const tlsOptions = { ca: certificates };
setGlobalDispatcher(new EnvHttpProxyAgent({
  connect: tlsOptions,
  requestTls: tlsOptions,
  proxyTls: tlsOptions,
}));

export async function fetchNetwork(input: string | URL, init?: RequestInit): Promise<Response> {
  return await undiciFetch(input, init as Parameters<typeof undiciFetch>[1]) as unknown as Response;
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
