/**
 * Desktop update rules. The shared policy lives in core/updates.ts; the real updater is
 * electron-updater reading GitHub Releases (see package.json build.publish).
 */

export {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  startUpdates,
  type UpdateOptions,
  type Updater,
} from '../core/updates';

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
