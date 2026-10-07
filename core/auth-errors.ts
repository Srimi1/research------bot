/** Only these fixed messages may reach the callback page or the saved sign-in notice. */
const messages = {
  declined: 'ChatGPT authorization was declined. Enable app access in ChatGPT Settings to continue.',
  expired: 'This ChatGPT session has expired or was revoked. Continue with ChatGPT again.',
  plan_limit:
    'The ChatGPT usage allowance for this app has been reached. Review your limits in ChatGPT Settings → Usage.',
  plan_unavailable: 'ChatGPT plan usage is currently unavailable. Review app access in ChatGPT Settings → Usage.',
  rejected: 'ChatGPT rejected the authorization request. Review Research Bot access in ChatGPT Settings and try again.',
  registration: 'ChatGPT returned an unexpected client registration. Start a new sign-in.',
  invalid_client: 'ChatGPT did not accept this app registration. Start a fresh sign-in from Research Bot.',
  invalid_request: 'ChatGPT rejected the sign-in request as invalid. Update Research Bot and start a fresh sign-in.',
  invalid_scope: 'ChatGPT did not accept the requested app permissions. Update Research Bot and try again.',
  unauthorized_client:
    'ChatGPT did not authorize this app registration. Review Research Bot access in ChatGPT Settings.',
  server_error: 'ChatGPT sign-in is temporarily unavailable. Try again later.',
  code: 'ChatGPT did not return a valid authorization code. Continue with ChatGPT again.',
  response: 'ChatGPT returned an invalid authorization response. Check your connection and try again.',
  credentials: 'ChatGPT returned an invalid credential response. Continue with ChatGPT again.',
  exchange_network:
    'Research Bot could not reach the ChatGPT token server. Check your connection, VPN and private DNS settings, then try again.',
  identity_missing: 'ChatGPT did not return an identity token. Continue with ChatGPT again.',
  identity_keys: 'Research Bot could not load ChatGPT identity verification keys. Check your connection and try again.',
  identity_signature:
    'ChatGPT identity verification failed. The token signature could not be verified. Start a new sign-in.',
  identity_audience:
    'ChatGPT identity verification failed. The token was not issued for this app registration. Start a new sign-in.',
  identity_issuer: 'ChatGPT identity verification failed. The token issuer did not match OpenAI. Start a new sign-in.',
  identity_expired:
    'ChatGPT identity verification failed. The token has expired. Enable automatic date and time on your device, then start a new sign-in.',
  identity_nonce:
    'ChatGPT identity verification failed. The token did not match this sign-in attempt. Start a new sign-in.',
  identity_claims:
    'ChatGPT identity verification failed. Required identity claims were missing or invalid. Start a new sign-in.',
  account:
    'The signed-in ChatGPT account does not match this saved registration. Sign out before connecting a different account.',
  storage: 'Research Bot could not save ChatGPT credentials securely on this device. Restart the app and try again.',
  storage_unavailable: 'Encrypted OS keychain storage is unavailable. Enable an OS keychain before signing in.',
  browser: 'The system browser could not open ChatGPT sign-in. Check that a browser is installed and try again.',
  timeout: 'ChatGPT sign-in timed out. Continue with ChatGPT again.',
  cancelled: 'ChatGPT sign-in was cancelled.',
  setup: 'Research Bot could not start ChatGPT sign-in. Restart the app and try again.',
} as const;

type Reason = keyof typeof messages;
export type AuthStage = 'setup' | 'exchange_network' | 'identity_claims' | 'storage';

export class AuthFailure extends Error {
  constructor(
    readonly reason: Reason,
    readonly status?: number,
  ) {
    const http = status !== undefined ? ` (HTTP ${status})` : '';
    super(`${messages[reason]}${http} [RB-AUTH-${reason.replaceAll('_', '-').toUpperCase()}]`);
  }
  notice(): { reason: Reason; status?: number } {
    return { reason: this.reason, ...(this.status !== undefined ? { status: this.status } : {}) };
  }
}

export function safeAuthFailure(error: unknown, stage: AuthStage): AuthFailure {
  if (error instanceof AuthFailure) return error;
  return new AuthFailure(stage);
}

export function readAuthFailure(value: unknown): AuthFailure | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { reason?: unknown; status?: unknown };
  if (typeof record.reason !== 'string' || !Object.hasOwn(messages, record.reason)) return undefined;
  if (
    record.status !== undefined &&
    (!Number.isInteger(record.status) || Number(record.status) < 200 || Number(record.status) > 599)
  )
    return undefined;
  return new AuthFailure(record.reason as Reason, record.status as number | undefined);
}

export function oauthFailure(code: unknown, status?: number): AuthFailure {
  const reasons: Record<string, Reason> = {
    access_denied: 'declined',
    invalid_grant: 'expired',
    subscription_sharing_usage_limit_exceeded: 'plan_limit',
    subscription_sharing_usage_unavailable: 'plan_unavailable',
    invalid_client: 'invalid_client',
    invalid_request: 'invalid_request',
    invalid_scope: 'invalid_scope',
    unauthorized_client: 'unauthorized_client',
    server_error: 'server_error',
    temporarily_unavailable: 'server_error',
  };
  return new AuthFailure(typeof code === 'string' && Object.hasOwn(reasons, code) ? reasons[code] : 'rejected', status);
}
