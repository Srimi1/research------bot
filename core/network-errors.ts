const messages = {
  dns: 'Android could not resolve the server address. Check your connection and private DNS settings.',
  tls: 'Android could not verify the secure connection. Check automatic date and time and Android system updates.',
  timeout: 'The network request timed out. Try again on a reliable connection.',
  connect: 'Android could not connect to the server. Check your connection, VPN and firewall settings.',
  redirect: 'The server answered with an unexpected redirect. The request was stopped to protect your credentials.',
  response: 'Android received an invalid response from the network service. Try again or report this error.',
  io: 'The Android network request failed. Check your connection and try again.',
} as const;
export type NetworkCode = keyof typeof messages;
export class NetworkFailure extends TypeError {
  constructor(readonly networkCode: NetworkCode) {
    super(messages[networkCode]);
  }
}

/** Capacitor rejects with serialized codes; never expose its raw message, URL or response data. */
export function nativeNetworkFailure(error: unknown): NetworkFailure {
  if (error instanceof NetworkFailure) return error;
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const reasons: Record<string, NetworkCode> = {
    RB_NET_DNS: 'dns',
    RB_NET_TLS: 'tls',
    RB_NET_TIMEOUT: 'timeout',
    RB_NET_CONNECT: 'connect',
    RB_NET_IO: 'io',
  };
  return new NetworkFailure(typeof code === 'string' && Object.hasOwn(reasons, code) ? reasons[code] : 'io');
}
