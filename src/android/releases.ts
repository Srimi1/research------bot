import type { Fetch } from '../../core/platform';
import { requestJson } from '../../core/platform';

const RELEASES = 'https://api.github.com/repos/Srimi1/research------bot/releases/latest';

interface Release {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown }[];
}

/** Compare dotted numeric versions such as 0.2.0 and 0.10.1. */
export function newer(candidate: string, current: string): boolean {
  const parse = (value: string) => value.split('.').map(part => Number.parseInt(part, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

/** The checksum listed for `file` in a sha256sum file, if any. */
export function checksumFor(sums: string, file: string): string | undefined {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match && match[2] === file) return match[1].toLowerCase();
  }
  return undefined;
}

export interface AndroidRelease {
  version: string;
  apkUrl: string;
  sumsUrl: string;
}

/** The newest published Android build, when it is newer than `current`. */
export async function findUpdate(fetch: Fetch, current: string): Promise<AndroidRelease | undefined> {
  const release = await requestJson<Release>(fetch, RELEASES, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (release.draft || release.prerelease || typeof release.tag_name !== 'string') return undefined;
  const version = release.tag_name.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !newer(version, current)) return undefined;
  const asset = (name: string) => {
    const url = release.assets?.find(item => item.name === name)?.browser_download_url;
    return typeof url === 'string' && url.startsWith('https://github.com/') ? url : undefined;
  };
  const apkUrl = asset(`research-bot-${version}-android.apk`);
  const sumsUrl = asset('SHA256SUMS-android.txt');
  return apkUrl && sumsUrl ? { version, apkUrl, sumsUrl } : undefined;
}
