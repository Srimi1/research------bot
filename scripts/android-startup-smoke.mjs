// Launch the packaged APK on a real Android runtime, including the native bridge and WebView.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const apk = process.argv[2];
assert.ok(apk, 'Pass the signed or debug APK to install');
const packageName = 'com.researchbot.android';
const output = resolve('android-startup-results');
mkdirSync(output, { recursive: true });
const serialArgs = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const adb = (...args) => execFileSync('adb', [...serialArgs, ...args], { encoding: 'utf8', timeout: 60_000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function capture(label) {
  const log = adb('logcat', '-d');
  const crash = adb('logcat', '-b', 'crash', '-d');
  writeFileSync(`${output}/${label}-logcat.txt`, log);
  writeFileSync(`${output}/${label}-crash.txt`, crash);
  writeFileSync(
    `${output}/${label}.png`,
    execFileSync('adb', [...serialArgs, 'exec-out', 'screencap', '-p'], { timeout: 30_000 }),
  );
  return { log, crash };
}

try {
  console.log(adb('shell', 'getprop', 'ro.build.version.release').trim());
  console.log(adb('install', '--no-streaming', '-r', resolve(apk)).trim());
  for (let launch = 1; launch <= 2; launch++) {
    const label = `launch-${launch}`;
    adb('shell', 'am', 'force-stop', packageName);
    adb('logcat', '-c');
    console.log(adb('shell', 'am', 'start', '-W', '-n', `${packageName}/.MainActivity`).trim());
    let visible = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await pause(1_000);
      const crash = adb('logcat', '-b', 'crash', '-d');
      assert.ok(!crash.includes(`Process: ${packageName}`), `Native startup crash:\n${crash}`);
      if (attempt % 3 !== 0) continue;
      adb('shell', 'uiautomator', 'dump', '/sdcard/research-bot-startup.xml');
      const dumped = spawnSync('adb', [...serialArgs, 'shell', 'test', '-s', '/sdcard/research-bot-startup.xml'], {
        timeout: 15_000,
      });
      // Immediately after boot, Android can return a null accessibility root. Retry the dump.
      if (dumped.status !== 0) continue;
      const tree = adb('shell', 'cat', '/sdcard/research-bot-startup.xml');
      writeFileSync(`${output}/${label}-ui.xml`, tree);
      if (tree.includes('Create your first project')) {
        visible = true;
        break;
      }
    }
    const { crash } = capture(label);
    assert.ok(!crash.includes(`Process: ${packageName}`), `Native startup crash:\n${crash}`);
    assert.ok(visible, 'The APK must render the welcome screen, not remain blank or show an Android error');
    assert.ok(adb('shell', 'pidof', packageName).trim(), 'The app must remain running after its screen loads');
    console.log(`${label}: native activity and packaged WebView welcome screen are running.`);
  }
} catch (error) {
  try {
    const { log, crash } = capture('failure');
    console.log(crash);
    console.log(
      log
        .split('\n')
        .filter(line => /Capacitor|AndroidRuntime|chromium|WebView|com\.researchbot\.android/.test(line))
        .slice(-200)
        .join('\n'),
    );
    console.log(adb('shell', 'dumpsys', 'webviewupdate'));
    console.log(adb('shell', 'dumpsys', 'activity', 'top').slice(-12_000));
  } catch {}
  throw error;
}
