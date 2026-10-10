import { startUpdates, type Updater } from '../../core/updates';
import type { Fetch } from '../../core/platform';
import type { UpdateCheckResult } from '../shared/types';
import { Native, type ResearchNativePlugin } from './native';
import { checksumFor, findUpdate, releaseAssetText } from './releases';

type Bridge = Pick<ResearchNativePlugin, 'appInfo' | 'downloadUpdate' | 'installUpdate'>;

/** Manual and background checks share one verified download and never change the app identity. */
export function createAndroidUpdateController(fetch: Fetch, bridge: Bridge) {
  let ready: string | undefined;
  let checking: Promise<UpdateCheckResult> | undefined;
  const checkForUpdates = (): Promise<UpdateCheckResult> => {
    if (checking) return checking;
    checking = (async (): Promise<UpdateCheckResult> => {
      const release = await findUpdate(fetch, await bridge.appInfo());
      if (!release) {
        ready = undefined;
        return { status: 'current' };
      }
      if (ready !== release.version) {
        // The shared native cache is overwritten by a download, including a failed download.
        ready = undefined;
        const sums = await releaseAssetText(fetch, release.sumsUrl);
        const sha256 = checksumFor(sums, `research-bot-${release.version}-android.apk`);
        if (!sha256 || sha256 !== release.sha256) throw new Error('The update checksum and build information differ.');
        const downloaded = await bridge.downloadUpdate({ url: release.apkUrl, sha256 });
        if (downloaded.version !== release.version)
          throw new Error('The downloaded APK version differs from its release.');
        ready = release.version;
      }
      return { status: 'ready', version: ready };
    })().finally(() => {
      checking = undefined;
    });
    return checking;
  };
  return {
    checkForUpdates,
    async installUpdate() {
      if (!ready) throw new Error('Download the update first.');
      try {
        await bridge.installUpdate();
      } catch (error) {
        if (/download the update first/i.test(error instanceof Error ? error.message : String(error)))
          ready = undefined;
        throw error;
      }
    },
  };
}

/** Manual checks work even when the shared background update policy is disabled. */
export function startAndroidUpdates(fetch: Fetch, enabled: () => boolean, log: (message: string) => void) {
  const controller = createAndroidUpdateController(fetch, Native);
  const listeners: { downloaded: ((info: { version: string }) => void)[]; error: ((error: Error) => void)[] } = {
    downloaded: [],
    error: [],
  };
  const updater: Updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    async checkForUpdates() {
      try {
        const result = await controller.checkForUpdates();
        if (result.status === 'ready') listeners.downloaded.forEach(listener => listener({ version: result.version }));
      } catch (error) {
        listeners.error.forEach(listener => listener(error instanceof Error ? error : new Error(String(error))));
      }
    },
    quitAndInstall() {
      controller.installUpdate().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        log(`Update install failed: ${message}`);
        window.alert(message || 'The update could not be installed.');
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
        `Research Bot ${version} is ready to install.\n\nInstall it now? Your projects stay on this phone.`,
      ),
    log,
  });
  return controller;
}
