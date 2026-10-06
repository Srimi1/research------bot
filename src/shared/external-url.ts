/** Validate a source link before opening it in the system browser. No source URL is fetched here. */
export function safeExternal(url: string): string {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('Only public HTTP or HTTPS links can be opened.');
  // URL canonicalizes unusual IPv4 forms (127.1, hexadecimal and decimal addresses).
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  const a = Number(ipv4?.[1]);
  const b = Number(ipv4?.[2]);
  const localIpv4 =
    ipv4 &&
    (a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)));
  // Permit global-unicast IPv6 (2000::/3); reject local, link-local and mapped IPv4 forms.
  const ipv6Prefix = host.startsWith('[') ? parseInt(host.slice(1).split(':')[0], 16) : undefined;
  const localIpv6 = ipv6Prefix !== undefined && !(ipv6Prefix >= 0x2000 && ipv6Prefix <= 0x3fff);
  if (host === 'localhost' || host.endsWith('.localhost') || localIpv4 || localIpv6)
    throw new Error('Local network links are not supported.');
  return parsed.href;
}
