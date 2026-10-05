/**
 * Auto-update policy, kept free of Electron imports so it can be tested with a fake updater.
 * The real updater is electron-updater reading GitHub Releases (see package.json build.publish).
 */

/** Six hours between background checks after the first one. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Let the window finish opening before the first network request. */
export const FIRST_CHECK_DELAY_MS = 15_000;

export interface UpdateHost {
  isPackaged: boolean;
  dev: boolean;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

/** Why this build cannot update itself, or undefined when it can. */
export function updateBlocker(host: UpdateHost): string | undefined {
  if (host.dev || !host.isPackaged) return 'this is a development build';
  if (host.env.RESEARCH_BOT_DISABLE_UPDATES === '1') return 'RESEARCH_BOT_DISABLE_UPDATES is set';
  // Squirrel.Mac refuses to install an update into an unsigned app.
  if (host.platform === 'darwin') return 'macOS updates need a signed app';
  // On Linux only the AppImage format can replace itself; electron-updater reads its path from $APPIMAGE.
  if (host.platform === 'linux' && !host.env.APPIMAGE) return 'only the AppImage build can update itself';
  return undefined;
}

/** The subset of electron-updater's AppUpdater this module uses. */
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
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms).unref());
  const setRepeat = options.setRepeat ?? ((callback, ms) => setInterval(callback, ms).unref());
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
