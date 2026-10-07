import { NetworkFailure, nativeNetworkFailure } from '../../core/network-errors';
import { combineSignals, randomSecret, readLimited, timeoutSignal, type Fetch } from '../../core/platform';
import type { Account, ConnectionDiagnostics } from '../shared/types';
import type { ResearchNativePlugin } from './native';

const issuer = 'https://auth.openai.com';
type Bridge = Pick<ResearchNativePlugin, 'httpOpen' | 'httpClose'>;

async function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new NetworkFailure('timeout');
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        abort = () => reject(new NetworkFailure('timeout'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

/** Return only fixed labels, numeric HTTP status, allowlisted codes and curated version fields. */
export function createConnectionCheck(fetch: Fetch, native: Bridge, device: Promise<NonNullable<Account['device']>>) {
  return async (signal: AbortSignal): Promise<ConnectionDiagnostics> => {
    if (signal.aborted) throw new DOMException('Connection check cancelled.', 'AbortError');
    const deadline = combineSignals([signal, timeoutSignal(20_000)]);
    const probe = async (service: string, operation: () => Promise<number>) => {
      try {
        const status = await bounded(operation, deadline);
        if (!Number.isInteger(status) || status < 200 || status > 599) throw new NetworkFailure('response');
        return { service, result: `HTTP ${status}` };
      } catch (error) {
        const failure = nativeNetworkFailure(error);
        return { service, result: `RB-NET-${failure.networkCode.toUpperCase().replaceAll('_', '-')}` };
      }
    };
    const request = async (path: string, body?: string) => {
      const response = await fetch(`${issuer}${path}`, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: deadline,
        ...(body ? { body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {}),
      });
      try {
        await readLimited(response, 100_000);
      } catch (error) {
        if (error instanceof NetworkFailure) throw error;
        throw new NetworkFailure('response');
      }
      return response.status;
    };
    const nativeRequest = async () => {
      const id = `diagnostic-${randomSecret()}`;
      const close = () => {
        void native.httpClose({ id }).catch(() => undefined);
      };
      deadline.addEventListener('abort', close, { once: true });
      try {
        return (
          await native.httpOpen({
            id,
            url: `${issuer}/.well-known/openid-configuration`,
            method: 'GET',
            headers: {},
            follow: false,
            readTimeout: 20_000,
          })
        ).status;
      } finally {
        deadline.removeEventListener('abort', close);
        close();
      }
    };
    const checks = await Promise.all([
      probe('Native HTTPS', nativeRequest),
      probe('Identity metadata', () => request('/.well-known/openid-configuration')),
      probe('Identity keys', () => request('/.well-known/jwks.json')),
      probe('Dummy token exchange', () =>
        request(
          '/api/accounts/oauth/token',
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: 'oaiapp_research_connectivity_check',
            code: 'synthetic-invalid-code',
            code_verifier: 'synthetic-invalid-verifier',
            redirect_uri: 'http://127.0.0.1:1/auth/callback',
            resource: 'https://api.openai.com/v1',
          }).toString(),
        ),
      ),
    ]);
    if (signal.aborted) throw new DOMException('Connection check cancelled.', 'AbortError');
    return {
      device: await device,
      features: {
        signalAny: typeof AbortSignal.any === 'function',
        signalTimeout: typeof AbortSignal.timeout === 'function',
        randomUuid: typeof crypto.randomUUID === 'function',
      },
      checks,
    };
  };
}
