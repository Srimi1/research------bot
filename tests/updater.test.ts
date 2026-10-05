import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  startUpdates,
  updateBlocker,
  type Updater,
} from '../electron/updater';

const packaged = { isPackaged: true, dev: false, platform: 'win32' as NodeJS.Platform, env: {} };

test('updates run only in packaged builds that can replace themselves', () => {
  assert.equal(updateBlocker(packaged), undefined);
  assert.equal(
    updateBlocker({ ...packaged, platform: 'linux', env: { APPIMAGE: '/opt/research-bot.AppImage' } }),
    undefined,
  );
  assert.match(updateBlocker({ ...packaged, platform: 'linux' })!, /only the AppImage/);
  assert.match(updateBlocker({ ...packaged, platform: 'darwin' })!, /signed/);
  assert.match(updateBlocker({ ...packaged, isPackaged: false })!, /development/);
  assert.match(updateBlocker({ ...packaged, dev: true })!, /development/);
  assert.match(updateBlocker({ ...packaged, env: { RESEARCH_BOT_DISABLE_UPDATES: '1' } })!, /DISABLE_UPDATES/);
});

function fakeUpdater() {
  const listeners: Record<string, ((value: never) => void)[]> = {};
  const state = { checks: 0, installs: 0, failNext: false };
  const updater: Updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    async checkForUpdates() {
      state.checks++;
      if (state.failNext) throw new Error('offline');
    },
    quitAndInstall: () => void state.installs++,
    on: (event: string, listener: (value: never) => void) => (listeners[event] ??= []).push(listener),
  };
  const emit = (event: string, value: unknown) => listeners[event]?.forEach(listener => listener(value as never));
  return { updater, state, emit };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('checks after a short delay, then on a schedule, and only while the setting is on', async () => {
  const { updater, state } = fakeUpdater();
  const timers: { ms: number; run: () => void }[] = [];
  let enabled = true;
  startUpdates(updater, {
    enabled: () => enabled,
    askToRestart: async () => false,
    log: () => {},
    setTimer: (run, ms) => timers.push({ ms, run }),
    setRepeat: (run, ms) => timers.push({ ms, run }),
  });
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.deepEqual(
    timers.map(timer => timer.ms),
    [FIRST_CHECK_DELAY_MS, CHECK_INTERVAL_MS],
  );
  assert.equal(state.checks, 0, 'nothing is checked while the window opens');
  timers[0].run();
  assert.equal(state.checks, 1);
  enabled = false;
  timers[1].run();
  assert.equal(state.checks, 1, 'turning the setting off stops later checks');
  enabled = true;
  timers[1].run();
  assert.equal(state.checks, 2);
});

test('a downloaded update installs only when the researcher chooses to restart', async () => {
  for (const restart of [true, false]) {
    const { updater, state, emit } = fakeUpdater();
    const asked: string[] = [];
    startUpdates(updater, {
      enabled: () => true,
      askToRestart: async version => (asked.push(version), restart),
      log: () => {},
      setTimer: () => {},
      setRepeat: () => {},
    });
    emit('update-downloaded', { version: '0.2.0' });
    emit('update-downloaded', { version: '0.2.0' });
    await tick();
    assert.deepEqual(asked, ['0.2.0'], 'one prompt even if the event repeats');
    assert.equal(state.installs, restart ? 1 : 0);
  }
});

test('update failures are logged and never thrown into the app', async () => {
  const { updater, state, emit } = fakeUpdater();
  const logs: string[] = [];
  let first!: () => void;
  startUpdates(updater, {
    enabled: () => true,
    askToRestart: async () => {
      throw new Error('window closed');
    },
    log: message => logs.push(message),
    setTimer: run => (first = run),
    setRepeat: () => {},
  });
  state.failNext = true;
  first();
  emit('error', new Error('GitHub rate limit'));
  emit('update-downloaded', { version: '0.2.0' });
  await tick();
  await tick();
  assert.deepEqual(logs.sort(), [
    'Update check failed: GitHub rate limit',
    'Update check failed: offline',
    'Update prompt failed: window closed',
  ]);
  assert.equal(state.installs, 0);
});
