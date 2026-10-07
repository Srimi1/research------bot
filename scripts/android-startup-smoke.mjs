// Launch the packaged APK on a real Android runtime, including the native bridge and WebView.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const apk = process.argv[2];
const upgradeFrom = process.argv[3];
assert.ok(apk, 'Pass the signed or debug APK to install');
const packageName = 'com.researchbot.android';
const output = resolve('android-startup-results');
mkdirSync(output, { recursive: true });
const serialArgs = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const adb = (...args) =>
  execFileSync('adb', [...serialArgs, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let uiDriver;
let treeRequest;

function readHierarchy() {
  if (!uiDriver) {
    uiDriver = spawn(process.env.RESEARCH_UIAUTOMATOR_PYTHON || 'python3', ['scripts/android-ui-tree.py'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    createInterface({ input: uiDriver.stdout }).on('line', line => {
      if (!line.startsWith('{')) return console.log(`UI driver: ${line}`);
      const result = JSON.parse(line);
      if (!treeRequest) return;
      clearTimeout(treeRequest.timer);
      if (result.error) treeRequest.reject(new Error(result.error));
      else treeRequest.resolve(result.xml);
      treeRequest = undefined;
    });
    const stopped = error => {
      if (!treeRequest) return;
      clearTimeout(treeRequest.timer);
      treeRequest.reject(error);
      treeRequest = undefined;
    };
    uiDriver.on('error', stopped);
    uiDriver.on('exit', code => stopped(new Error(`The Android UI driver stopped (${code})`)));
  }
  return new Promise((resolve, reject) => {
    treeRequest = {
      resolve,
      reject,
      timer: setTimeout(() => {
        treeRequest = undefined;
        uiDriver.kill();
        reject(new Error('The Android accessibility tree timed out'));
      }, 60_000),
    };
    uiDriver.stdin.write('{}\n');
  });
}

function capture(label) {
  const log = adb('logcat', '-d');
  const crash = adb('logcat', '-b', 'crash', '-d');
  writeFileSync(`${output}/${label}-logcat.txt`, log);
  writeFileSync(`${output}/${label}-crash.txt`, crash);
  writeFileSync(
    `${output}/${label}.png`,
    execFileSync('adb', [...serialArgs, 'exec-out', 'screencap', '-p'], {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    }),
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

async function treeFor(label) {
  // One-shot uiautomator dump reconnects on every call and can expose stale WebView nodes.
  const tree = await readHierarchy();
  writeFileSync(`${output}/${label}-ui.xml`, tree);
  return tree;
}

async function waitForTree(label, expected) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await pause(1_000);
    const crash = adb('logcat', '-b', 'crash', '-d');
    assert.ok(!crash.includes(`Process: ${packageName}`), `Native startup crash:\n${crash}`);
    if (attempt % 3 !== 0) continue;
    const tree = await treeFor(label);
    assert.ok(!tree.includes('CompileError'), 'The actual APK must initialize SQLite under its shipped CSP');
    if (expected(tree)) return tree;
  }
  throw new Error(`The APK did not render the expected ${label} screen`);
}

async function tapNode(label, predicate) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const list = nodes(await treeFor(label));
    const frame = bounds(list.find(node => node.package === packageName && node.class === 'android.webkit.WebView'));
    const footer = bounds(
      list.find(
        node =>
          node.package === packageName &&
          (node.text === 'Project sections' || node['content-desc'] === 'Project sections') &&
          bounds(node) &&
          frame &&
          bounds(node).top > frame.top + (frame.bottom - frame.top) / 2,
      ),
    );
    const headerBottom = Math.max(
      frame?.top ?? 0,
      ...list
        .filter(
          node =>
            node.package === packageName &&
            ['Open navigation', 'Account and preferences'].includes(node.text || node['content-desc']) &&
            bounds(node),
        )
        .map(node => bounds(node).bottom),
    );
    const target = list.find(node => node.package === packageName && predicate(node) && bounds(node));
    const targetBounds = bounds(target);
    // Accessibility can report a button's bounds behind fixed controls as visible. Scroll it fully
    // into the XML-derived content area before tapping, or a navigation button receives the touch.
    if (
      targetBounds &&
      targetBounds.top >= headerBottom &&
      targetBounds.bottom <= (footer?.top ?? frame?.bottom ?? Infinity)
    ) {
      const { left, top, right, bottom } = bounds(target);
      console.log(`Tap ${label}: ${JSON.stringify(target)}`);
      adb('shell', 'input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
      return;
    }
    if (attempt === 3) break;
    // Find coordinates from the accessibility tree; scroll and re-dump before declaring it missing.
    const scroll = list.find(node => node.package === packageName && node.scrollable === 'true' && bounds(node));
    assert.ok(scroll, `No visible target or scrollable region on ${label}`);
    const region = bounds(scroll);
    const { left, right } = region;
    const top = Math.max(region.top, headerBottom);
    const bottom = Math.min(region.bottom, footer?.top ?? region.bottom);
    // The WebView bounds include fixed header/bottom controls. Swipe within its middle content.
    const x = Math.round(left + (right - left) / 3);
    const start = Math.round(top + (bottom - top) * 0.75);
    const end = Math.round(top + (bottom - top) * 0.25);
    adb('shell', 'input', 'swipe', String(x), String(start), String(x), String(end), '350');
    await pause(500);
  }
  throw new Error(`The ${label} target is not visible after scrolling`);
}

const named = text => node => node.text === text || node['content-desc'] === text;

function coldStart() {
  const crash = adb('logcat', '-b', 'crash', '-d');
  assert.ok(!crash.includes(`Process: ${packageName}`), `Native startup crash:\n${crash}`);
  adb('shell', 'am', 'force-stop', packageName);
  adb('logcat', '-c');
  console.log(adb('shell', 'am', 'start', '-W', '-n', `${packageName}/.MainActivity`).trim());
}

try {
  console.log(adb('shell', 'getprop', 'ro.build.version.release').trim());
  console.log(adb('install', '--no-streaming', '-r', resolve(upgradeFrom || apk)).trim());
  adb('shell', 'input', 'keyevent', '224');
  adb('shell', 'wm', 'dismiss-keyguard');
  adb('shell', 'settings', 'put', 'system', 'screen_off_timeout', '1800000');
  adb('shell', 'svc', 'power', 'stayon', 'true');
  for (let launch = 1; launch <= 2; launch++) {
    const label = `launch-${launch}`;
    coldStart();
    if (launch === 1) {
      await waitForTree(label, tree => tree.includes('Create your first project'));
      await tapNode('start-project', named('Create your first project'));
      await pause(1_000);
      capture('project-form');
      // The modal focuses its close button. Tab reaches the title; Enter submits the form.
      // WebView 133 can retain its previous accessibility subtree until a cold restart.
      // Verify real UI creation and persistence after reopening, instead of trusting that stale tree.
      adb('shell', 'input', 'keyevent', '61');
      // Let Android finish focusing/resizing the input, and simulate typing instead of flooding keys.
      await pause(1_000);
      for (const character of 'AndroidStartupTest') {
        adb('shell', 'input', 'text', character);
        await pause(75);
      }
      await pause(500);
      adb('shell', 'input', 'keyevent', '66');
      await pause(3_000);
      capture('project-submitted');
      assert.ok(adb('shell', 'pidof', packageName).trim(), 'The app must stay running while creating the project');
      coldStart();
      await waitForTree(
        'project-created',
        tree => tree.includes('AndroidStartupTest') && tree.includes('Your research notes'),
      );
      await tapNode('note-outline', named('Add a note outline'));
      await pause(2_000);
      if (upgradeFrom) {
        adb('shell', 'am', 'force-stop', packageName);
        console.log(adb('install', '--no-streaming', '-r', resolve(apk)).trim());
        console.log('Installed the new signed APK over the previous version with the project and notes retained.');
        // Installing an update stops the old activity. Launch the new version before checking its UI/PID.
        coldStart();
        await waitForTree(
          'upgrade-restored',
          tree => tree.includes('AndroidStartupTest') && tree.includes('What I know'),
        );
      }
    } else {
      await waitForTree(label, tree => tree.includes('AndroidStartupTest') && tree.includes('What I know'));
    }
    const { crash } = capture(label);
    assert.ok(!crash.includes(`Process: ${packageName}`), `Native startup crash:\n${crash}`);
    assert.ok(adb('shell', 'pidof', packageName).trim(), 'The app must remain running after its screen loads');
    console.log(
      `${label}: actual APK opened SQLite and ${launch === 1 ? 'created a project and requested a note outline' : 'restored that project and notes after a cold restart'}.`,
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
        nodes(await treeFor('failure')).filter(
          node => node.text || node['content-desc'] || node.class === 'android.widget.EditText',
        ),
      ),
    );
    console.log(adb('shell', 'dumpsys', 'activity', 'top').slice(-12_000));
    // Flush evidence before throwing: console's pipe writes can otherwise be truncated at process exit.
    const shot = readFileSync(`${output}/failure.png`).toString('base64');
    for (let offset = 0; offset < shot.length; offset += 4_000)
      await new Promise((resolve, reject) =>
        process.stdout.write(`ANDROID_FAILURE_SCREENSHOT_CHUNK:${shot.slice(offset, offset + 4_000)}\n`, error =>
          error ? reject(error) : resolve(),
        ),
      );
  } catch {}
  throw error;
} finally {
  uiDriver?.kill();
}
