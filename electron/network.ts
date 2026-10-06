import { readFileSync } from 'node:fs';
import { getCACertificates } from 'node:tls';
import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';
import { requestJson as coreRequestJson } from '../core/platform';

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

export { readLimited } from '../core/platform';

export async function requestJson<T>(url: string | URL, init?: RequestInit, maxBytes = 2_000_000): Promise<T> {
  return coreRequestJson<T>(fetchNetwork, String(url), init, maxBytes);
}
