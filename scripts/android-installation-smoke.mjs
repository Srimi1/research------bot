// Real Package Manager checks for the shipped 0.4.0 APK and the separate test build.
// Run only on an emulator without an existing Research Bot package or research data.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyAndroidApk } from './verify-android-apk.mjs';

const testApk = process.argv[2];
assert.ok(testApk, 'Pass the separately packaged install-check APK');
const serial = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const adb = (...args) => execFileSync('adb', [...serial, ...args], { encoding: 'utf8', timeout: 60_000 });
const adbResult = (...args) => {
  const result = spawnSync('adb', [...serial, ...args], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.error, undefined, result.error?.message);
  return { status: result.status, text: `${result.stdout || ''}\n${result.stderr || ''}`.trim() };
};
const packageName = 'com.researchbot.android';
const testPackage = `${packageName}.installcheck`;
const output = resolve('android-startup-results/installation');
const hasPackage = name =>
  adb('shell', 'pm', 'list', 'packages', '-u', name).split(/\r?\n/).includes(`package:${name}`);
assert.equal(adb('shell', 'getprop', 'ro.kernel.qemu').trim(), '1', 'This test requires an emulator');
assert.ok(
  !hasPackage(packageName) && !hasPackage(testPackage),
  'Use an emulator without existing Research Bot packages',
);
const files = {
  previous: [
    'downloads/android/research-bot-0.3.9-android.apk',
    '4ecaac44c15ea2d500b9e2be85e971fa583b6f3ed92c8453c91f3aedff3df2ff',
  ],
  published: [
    'downloads/android/research-bot-0.4.0-android.apk',
    '280356ec59459cf853408f70ec0316f24c979988a2fbbba1e82e7147835ea39c',
  ],
};
for (const [path, expected] of Object.values(files))
  assert.equal(
    createHash('sha256').update(readFileSync(path)).digest('hex'),
    expected,
    'Use the exact published APK fixture',
  );
const testInfo = verifyAndroidApk(testApk, 'install-check');
mkdirSync(output, { recursive: true });
let profile;
let canonicalInstalled = false;
let testInstalled = false;
const report = { sdk: adb('shell', 'getprop', 'ro.build.version.sdk').trim(), testApk: testInfo, checks: {} };
const install = (apk, user = '0') => adbResult('install', '--no-streaming', '--user', user, resolve(apk));
try {
  const separate = install(testApk);
  assert.equal(separate.status, 0, separate.text);
  testInstalled = true;
  report.checks.installCheckFresh = 'passed';
  const previous = install(files.previous[0]);
  assert.equal(previous.status, 0, previous.text);
  canonicalInstalled = true;
  const created = adbResult('shell', 'pm', 'create-user', 'research-apk-signing-fixture');
  // Android 8 returns status 1 even when this command successfully creates a user.
  // Check its success message and the resulting user before using the fixture.
  profile = created.text.match(/Success: created user id (\d+)/)?.[1];
  assert.ok(profile, `A separate user is required for this regression check: ${created.text}`);
  assert.ok(created.status === 0 || created.status === 1, created.text);
  assert.match(adb('shell', 'pm', 'list', 'users'), new RegExp(`UserInfo\\{${profile}:`));
  // Android 8's legacy pm command lacks install-existing. Reinstall the same
  // verified fixture for the secondary user with the supported install flags.
  const profileInstall = adbResult('install', '--no-streaming', '-r', '--user', profile, resolve(files.previous[0]));
  assert.equal(profileInstall.status, 0, profileInstall.text);
  assert.ok(
    adb('shell', 'pm', 'list', 'packages', '--user', profile, packageName)
      .split(/\r?\n/)
      .includes(`package:${packageName}`),
    'The previous APK must remain installed in the secondary user',
  );
  assert.match(adb('shell', 'pm', 'uninstall', '--user', '0', packageName), /Success/);
  const conflict = install(files.published[0]);
  assert.notEqual(conflict.status, 0, 'The old certificate in another user must not silently accept a new signer');
  assert.match(conflict.text, /INSTALL_FAILED_(UPDATE_INCOMPATIBLE|DUPLICATE_PERMISSION)/);
  report.checks.oldKeyInOtherUser = conflict.text;
  console.log(`Reproduced rejection after removal from the primary user: ${conflict.text}`);
  assert.match(adb('shell', 'pm', 'remove-user', profile), /Success/);
  profile = undefined;
  if (hasPackage(packageName)) adb('uninstall', packageName);
  canonicalInstalled = false;
  const published = install(files.published[0]);
  assert.equal(published.status, 0, published.text);
  canonicalInstalled = true;
  report.checks.publishedFresh = 'passed';
  assert.ok(hasPackage(packageName) && hasPackage(testPackage));
  report.checks.separatePackagesCoexist = 'passed';
  console.log(`Passed: the official 0.4.0 APK and the test APK install together on SDK ${report.sdk}.`);
} finally {
  writeFileSync(`${output}/package-manager.json`, JSON.stringify(report, null, 2) + '\n');
  if (profile) adb('shell', 'pm', 'remove-user', profile);
  if (canonicalInstalled && hasPackage(packageName)) adb('uninstall', packageName);
  if (testInstalled && hasPackage(testPackage)) adb('uninstall', testPackage);
}
