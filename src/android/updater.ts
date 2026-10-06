import { startUpdates, type Updater } from '../../core/updates';
import type { Fetch } from '../../core/platform';
import { readLimited } from '../../core/platform';
import { Native } from './native';
import { checksumFor, findUpdate } from './releases';

/**
 * The desktop update policy (electron/updater.ts) driving Android's installer: check after start
 * and every six hours, download in the background, verify, then ask before opening the installer.
 */
export function startAndroidUpdates(fetch: Fetch, enabled: () => boolean, log: (message: string) => void) {
  const listeners: { downloaded: ((info: { version: string }) => void)[]; error: ((error: Error) => void)[] } = {
    downloaded: [],
    error: [],
  };
  let ready: string | undefined;
  let checking = false;
  const updater: Updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    async checkForUpdates() {
      if (checking) return;
      checking = true;
      try {
        const info = await Native.appInfo();
        const release = await findUpdate(fetch, info.version);
        if (!release) return;
        if (ready !== release.version) {
          const sums = await fetch(release.sumsUrl, { signal: AbortSignal.timeout(60_000) });
          if (!sums.ok) {
            await sums.body?.cancel();
            throw new Error(`The update checksums answered HTTP ${sums.status}.`);
          }
          const sha256 = checksumFor(await readLimited(sums, 100_000), `research-bot-${release.version}-android.apk`);
          if (!sha256) throw new Error('The update has no published checksum.');
          await Native.downloadUpdate({ url: release.apkUrl, sha256 });
          ready = release.version;
        }
        listeners.downloaded.forEach(listener => listener({ version: release.version }));
      } catch (error) {
        listeners.error.forEach(listener => listener(error instanceof Error ? error : new Error(String(error))));
      } finally {
        checking = false;
      }
    },
    quitAndInstall() {
      Native.installUpdate().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        log(`Update install failed: ${message}`);
        if (/download the update first/i.test(message)) {
          // Android cleared the cached APK. Download it again and ask once it is ready.
          ready = undefined;
          window.alert('The downloaded update was removed by Android. Research Bot will download it again.');
          void updater.checkForUpdates();
        } else window.alert(message || 'The update could not be installed.');
      });
    },
    on(event: 'update-downloaded' | 'error', listener: any) {
      if (event === 'update-downloaded') listeners.downloaded.push(listener);
      else listeners.error.push(listener);
      return updater;
    },
  };
  startUpdates(updater, {
    enabled,
    askToRestart: async version =>
      window.confirm(
        `Research Bot ${version} is ready to install.\n\nInstall it now? Your projects stay on this phone. ` +
          'If you choose Cancel, you will be asked again next time.',
      ),
    log,
  });
}
