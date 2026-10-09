import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAndroidApk } from './verify-android-apk.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const kind = process.argv[2] || 'release';
assert.ok(
  ['release', 'fresh-release', 'install-check'].includes(kind),
  'Choose release, fresh-release or install-check',
);
if (kind === 'fresh-release') process.env.RESEARCH_ANDROID_FRESH_INSTALL = 'true';
const signedRelease = kind === 'release' || kind === 'fresh-release';
const gradle = (...tasks) => {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const wrapper = process.platform === 'win32' ? ['/d', '/c', 'gradlew.bat'] : ['./gradlew'];
  execFileSync(command, [...wrapper, '--no-daemon', '--console=plain', ...tasks], {
    cwd: join(root, 'android'),
    stdio: 'inherit',
  });
};
// Fail before rebuilding web assets if an installable release cannot be signed.
if (signedRelease) gradle(':app:verifyReleaseSigning');
assert.ok(process.env.npm_execpath, 'Run this build through npm run android:apk or npm run android:apk:check');
execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'build:android'], { cwd: root, stdio: 'inherit' });
const variant = signedRelease ? 'Release' : 'InstallCheck';
gradle(`:app:assemble${variant}`, `:app:lint${variant}`);
const directory = signedRelease ? 'release' : 'installCheck';
const filename = signedRelease ? 'app-release.apk' : 'app-installCheck.apk';
verifyAndroidApk(join(root, `android/app/build/outputs/apk/${directory}/${filename}`), kind);
