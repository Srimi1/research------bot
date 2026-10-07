// Launch the packaged APK on a real Android runtime, including the native bridge and WebView.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';

const apk = process.argv[2];
assert.ok(apk, 'Pass the signed or debug APK to install');
const packageName = 'com.researchbot.android';
const output = resolve('android-startup-results');
mkdirSync(output, { recursive: true });
const serialArgs = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const adb = (...args) =>
  execFileSync('adb', [...serialArgs, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
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

function nodes(tree) {
  return [...tree.matchAll(/<node\b([^>]+)>/g)].map(match =>
    Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]])),
  );
}

function bounds(node) {
  const match = node?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!match) return undefined;
  const [left, top, right, bottom] = match.slice(1).map(Number);
  return right > left && bottom > top ? { left, top, right, bottom } : undefined;
}

function treeFor(label) {
  adb('shell', 'rm', '-f', '/sdcard/research-bot-startup.xml');
  adb('shell', 'uiautomator', 'dump', '/sdcard/research-bot-startup.xml');
  const dumped = spawnSync('adb', [...serialArgs, 'shell', 'test', '-s', '/sdcard/research-bot-startup.xml'], {
    timeout: 15_000,
  });
  // Immediately after boot, Android can return a null accessibility root. Retry the dump.
  if (dumped.status !== 0) return '';
  const tree = adb('shell', 'cat', '/sdcard/research-bot-startup.xml');
  writeFileSync(`${output}/${label}-ui.xml`, tree);
  return tree;
}

async function waitForTree(label, expected) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await pause(1_000);
    const crash = adb('logcat', '-b', 'crash', '-d');
    assert.ok(!crash.includes(`Process: ${packageName}`), `Native startup crash:\n${crash}`);
    if (attempt % 3 !== 0) continue;
    const tree = treeFor(label);
    assert.ok(!tree.includes('CompileError'), 'The actual APK must initialize SQLite under its shipped CSP');
    if (expected(tree)) return tree;
  }
  throw new Error(`The APK did not render the expected ${label} screen`);
}

async function tapNode(label, predicate) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const list = nodes(treeFor(label));
    const target = list.find(node => predicate(node) && bounds(node));
    if (target) {
      const { left, top, right, bottom } = bounds(target);
      console.log(`Tap ${label}: ${JSON.stringify(target)}`);
      adb('shell', 'input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
      return;
    }
    // Find coordinates from the accessibility tree; scroll and re-dump before declaring it missing.
    const scroll = list.find(node => node.scrollable === 'true' && bounds(node));
    assert.ok(scroll, `No visible target or scrollable region on ${label}`);
    const { left, top, right, bottom } = bounds(scroll);
    const x = Math.round((left + right) / 2);
    adb('shell', 'input', 'swipe', String(x), String(bottom - 150), String(x), String(top + 150), '350');
    await pause(500);
  }
  throw new Error(`The ${label} target is not visible after scrolling`);
}

const named = text => node => node.text === text || node['content-desc'] === text;

try {
  console.log(adb('shell', 'getprop', 'ro.build.version.release').trim());
  console.log(adb('install', '--no-streaming', '-r', resolve(apk)).trim());
  adb('shell', 'input', 'keyevent', '224');
  adb('shell', 'wm', 'dismiss-keyguard');
  adb('shell', 'settings', 'put', 'system', 'screen_off_timeout', '1800000');
  adb('shell', 'svc', 'power', 'stayon', 'true');
  for (let launch = 1; launch <= 2; launch++) {
    const label = `launch-${launch}`;
    adb('shell', 'am', 'force-stop', packageName);
    adb('logcat', '-c');
    console.log(adb('shell', 'am', 'start', '-W', '-n', `${packageName}/.MainActivity`).trim());
    if (launch === 1) {
      await waitForTree(label, tree => tree.includes('Create your first project'));
      // Wait for the first screen to settle; an initial touch can focus a newly opened WebView.
      let form;
      for (let attempt = 0; attempt < 3; attempt++) {
        await tapNode('start-project', named('Create your first project'));
        await pause(1_000);
        form = treeFor('project-form');
        console.log(`Project form nodes: ${JSON.stringify(nodes(form))}`);
        if (nodes(form).some(node => node.class === 'android.widget.EditText')) break;
      }
      assert.ok(
        nodes(form).some(node => node.class === 'android.widget.EditText'),
        'Create project must open its form',
      );
      await tapNode('project-title', node => node.class === 'android.widget.EditText');
      adb('shell', 'input', 'text', 'AndroidStartupTest');
      adb('shell', 'input', 'keyevent', '4');
      await pause(500);
      await tapNode('create-project', named('Create project'));
      await waitForTree(
        'project-created',
        tree => tree.includes('AndroidStartupTest') && tree.includes('Your research notes'),
      );
      await tapNode('note-outline', named('Add a note outline'));
      await waitForTree('notes-saved', tree => tree.includes('What I know'));
      await pause(2_000);
      adb('shell', 'input', 'keyevent', '4');
    } else {
      await waitForTree(label, tree => tree.includes('AndroidStartupTest') && tree.includes('What I know'));
    }
    const { crash } = capture(label);
    assert.ok(!crash.includes(`Process: ${packageName}`), `Native startup crash:\n${crash}`);
    assert.ok(adb('shell', 'pidof', packageName).trim(), 'The app must remain running after its screen loads');
    console.log(
      `${label}: actual APK opened SQLite and ${launch === 1 ? 'created a project with saved notes' : 'restored that project and notes after a cold restart'}.`,
    );
  }
} catch (error) {
  try {
    const { log, crash } = capture('failure');
    console.log(crash);
    console.log(
      log
        .split('\n')
        .filter(
          line =>
            /Capacitor|AndroidRuntime|chromium|WebView|com\.researchbot\.android/.test(line) &&
            !line.includes('"data":"'),
        )
        .slice(-200)
        .join('\n'),
    );
    console.log(adb('shell', 'dumpsys', 'webviewupdate'));
    console.log(
      JSON.stringify(
        nodes(treeFor('failure')).filter(
          node => node.text || node['content-desc'] || node.class === 'android.widget.EditText',
        ),
      ),
    );
    console.log(adb('shell', 'dumpsys', 'activity', 'top').slice(-12_000));
    // Flush evidence before throwing: console's pipe writes can otherwise be truncated at process exit.
    const shot = readFileSync(`${output}/failure.png`).toString('base64');
    for (let offset = 0; offset < shot.length; offset += 4_000)
      writeSync(1, `ANDROID_FAILURE_SCREENSHOT_CHUNK:${shot.slice(offset, offset + 4_000)}\n`);
  } catch {}
  throw error;
}
