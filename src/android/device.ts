import { version } from '../../package.json';
import type { Account } from '../shared/types';
import type { ResearchNativePlugin } from './native';

type Device = NonNullable<Account['device']>;
const webviewVersion = (value: unknown) =>
  typeof value === 'string' && /^\d{1,6}(?:\.\d{1,10}){1,4}$/.test(value) ? value : undefined;

/** Optional platform information must not hide the version or block a successful sign-in. */
export async function readDeviceInfo(
  getInfo: ResearchNativePlugin['appInfo'],
  userAgent: string,
  waitMs = 2000,
): Promise<Device> {
  const fallback: Device = {
    appVersion: version,
    webviewVersion: webviewVersion(userAgent.match(/(?:Chrome|Chromium)\/([\d.]{1,50})/)?.[1]) || 'unavailable',
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      getInfo(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Optional Android information timed out.')), waitMs);
      }),
    ]);
    return {
      ...fallback,
      webviewVersion: webviewVersion(info.webviewVersion) || fallback.webviewVersion,
      ...(typeof info.version === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(info.version)
        ? { nativeVersion: info.version }
        : {}),
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
