/**
 * Update policy shared by the desktop app (electron-updater) and the Android app (APK installer).
 * Free of platform imports so either updater can drive it and tests can use a fake one.
 */

/** Six hours between background checks after the first one. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Let the window finish opening before the first network request. */
export const FIRST_CHECK_DELAY_MS = 15_000;

/** The subset of electron-updater's AppUpdater this module uses; Android implements the same shape. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface UpdateOptions {
  /** Read on every check, so turning the setting off stops future checks without a restart. */
  enabled: () => boolean;
  /** Ask whether to restart now. Declining still installs the update when the app next quits. */
  askToRestart: (version: string) => Promise<boolean>;
  log: (message: string) => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  setRepeat?: (callback: () => void, ms: number) => unknown;
}

export function startUpdates(updater: Updater, options: UpdateOptions): void {
  // In Node, unref() keeps a pending check from holding the process open; browsers have no unref.
  const unref = <T>(handle: T) => ((handle as { unref?: () => void }).unref?.(), handle);
  const setTimer = options.setTimer ?? ((callback, ms) => unref(setTimeout(callback, ms)));
  const setRepeat = options.setRepeat ?? ((callback, ms) => unref(setInterval(callback, ms)));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  let asking = false;
  updater.on('update-downloaded', info => {
    if (asking) return;
    asking = true;
    options
      .askToRestart(info.version)
      .then(restart => {
        if (restart) updater.quitAndInstall();
      })
      .catch(error => options.log(`Update prompt failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        asking = false;
      });
  });
  // Update problems (offline, GitHub rate limits) must never interrupt research, so they are only logged.
  updater.on('error', error => options.log(`Update check failed: ${error.message}`));
  const check = () => {
    if (!options.enabled()) return;
    updater
      .checkForUpdates()
      .catch(error => options.log(`Update check failed: ${error instanceof Error ? error.message : String(error)}`));
  };
  setTimer(check, FIRST_CHECK_DELAY_MS);
  setRepeat(check, CHECK_INTERVAL_MS);
}
