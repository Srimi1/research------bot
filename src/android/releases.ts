import type { Fetch } from '../../core/platform';
import { readLimited, requestJson, timeoutSignal } from '../../core/platform';

const REPOSITORY = 'https://github.com/Srimi1/research------bot';
const RELEASES = 'https://api.github.com/repos/Srimi1/research------bot/releases?per_page=30';

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
  sha256: string;
}

export interface InstalledAndroidApp {
  version: string;
  versionCode: number;
  sdk: number;
  packageName?: string;
  certificateSha256?: string;
}

/** GitHub assets redirect to its CDN; these bounded public reads contain no credentials. */
export async function releaseAssetText(fetch: Fetch, url: string): Promise<string> {
  const response = await fetch(url, { redirect: 'follow', signal: timeoutSignal(60_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`The update metadata answered HTTP ${response.status}.`);
  }
  return readLimited(response, 100_000);
}

/** Select a compatible Android release independently of desktop Latest. */
export async function findUpdate(fetch: Fetch, current: InstalledAndroidApp): Promise<AndroidRelease | undefined> {
  if (!current.packageName || !/^[a-f0-9]{64}$/.test(current.certificateSha256 ?? ''))
    throw new Error('The installed app signing information is unavailable. No update can be offered safely.');
  const releases = await requestJson<Release[]>(fetch, RELEASES, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!Array.isArray(releases)) throw new Error('GitHub returned invalid release information.');
  const candidates = releases
    .filter(release => !release.draft && !release.prerelease && typeof release.tag_name === 'string')
    .map(release => ({ release, version: (release.tag_name as string).replace(/^v/, '') }))
    .filter(({ version }) => /^\d+\.\d+\.\d+$/.test(version) && newer(version, current.version))
    .sort((a, b) => (newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0));
  for (const { release, version } of candidates) {
    const asset = (name: string) => {
      const url = release.assets?.find(item => item.name === name)?.browser_download_url;
      return url === `${REPOSITORY}/releases/download/${release.tag_name}/${name}` ? url : undefined;
    };
    const apkUrl = asset(`research-bot-${version}-android.apk`);
    const sumsUrl = asset('SHA256SUMS-android.txt');
    const infoUrl = asset('BUILD_INFO-android.json');
    if (!apkUrl || !sumsUrl || !infoUrl) continue;
    const info = JSON.parse(await releaseAssetText(fetch, infoUrl));
    if (
      !info ||
      (info.kind !== undefined && info.kind !== 'release') ||
      info.version !== version ||
      info.package !== current.packageName ||
      info.certificateSha256 !== current.certificateSha256 ||
      !Number.isSafeInteger(info.versionCode) ||
      info.versionCode <= current.versionCode ||
      !Number.isSafeInteger(info.minSdk) ||
      info.minSdk > current.sdk ||
      !/^[a-f0-9]{64}$/.test(info.apkSha256)
    )
      continue;
    return { version, apkUrl, sumsUrl, sha256: info.apkSha256 };
  }
  return undefined;
}
