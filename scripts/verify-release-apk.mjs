// A committed signed APK can be released without sending its private key to CI.
// Require the release's app inputs to match the build commit before reusing it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const { version } = json('package.json');
const info = json('downloads/android/BUILD_INFO.json');
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.equal(info.version, version, 'APK build version must match package.json');
assert.match(info.sourceCommit, /^[a-f0-9]{40}$/);
assert.match(info.apkSha256, /^[a-f0-9]{64}$/);
assert.match(info.certificateSha256, /^[a-f0-9]{64}$/);
assert.equal(
  info.certificateSha256,
  readFileSync(join(root, 'android/release-signing-certificate.sha256'), 'utf8').trim(),
  'Prebuilt APK must use the committed release signing certificate',
);
assert.equal(info.package, 'com.researchbot.android');
const [major, minor, patch] = version.split('.').map(Number);
assert.equal(info.versionCode, major * 10000 + minor * 100 + patch);

const name = `research-bot-${version}-android.apk`;
const apk = join(root, 'downloads/android', name);
const bytes = readFileSync(apk);
assert.equal(bytes.length, info.apkBytes, 'APK size differs from build information');
assert.equal(
  createHash('sha256').update(bytes).digest('hex'),
  info.apkSha256,
  'APK hash differs from build information',
);
assert.equal(readFileSync(join(root, 'downloads/android/SHA256SUMS.txt'), 'utf8').trim(), `${info.apkSha256}  ${name}`);

const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
run('git', ['merge-base', '--is-ancestor', info.sourceCommit, 'HEAD']);
const appInputs = [
  'src',
  'core',
  'android',
  'public',
  'agents',
  'index.html',
  'package.json',
  'package-lock.json',
  'capacitor.config.ts',
  'vite.config.ts',
  'tsconfig.json',
];
run('git', ['diff', '--exit-code', info.sourceCommit, 'HEAD', '--', ...appInputs]);
// Also reject local changes while running this verification outside CI.
run('git', ['diff', '--exit-code', 'HEAD', '--', ...appInputs]);

assert.ok(process.env.ANDROID_HOME, 'Set ANDROID_HOME to the Android SDK location');
const tools = join(process.env.ANDROID_HOME, 'build-tools/36.0.0');
const certificates = run(join(tools, 'apksigner'), ['verify', '--print-certs', apk]);
const fingerprints = [...certificates.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$/gm)].map(
  match => match[1],
);
assert.deepEqual(fingerprints, [info.certificateSha256], 'APK signing certificate differs from build information');
const badging = run(join(tools, 'aapt2'), ['dump', 'badging', apk]);
const packageInfo = badging.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
assert.ok(packageInfo, 'APK must contain package and version metadata');
assert.deepEqual(packageInfo.slice(1), [info.package, String(info.versionCode), info.version]);
assert.equal(Number(badging.match(/^minSdkVersion:'(\d+)'/m)?.[1]), info.minSdk);
assert.equal(Number(badging.match(/^targetSdkVersion:'(\d+)'/m)?.[1]), info.targetSdk);
run(join(tools, 'zipalign'), ['-c', '-P', '16', '4', apk]);
console.log(
  `Verified ${name}: SHA-256, signing certificate, version, SDK, alignment and source commit ${info.sourceCommit}.`,
);
