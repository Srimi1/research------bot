// Verify the package that will actually be installed, including its signature and release flags.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function verifyAndroidApk(apk, kind = 'release') {
  assert.ok(['release', 'debug', 'install-check'].includes(kind), 'Choose release, debug or install-check');
  assert.ok(process.env.ANDROID_HOME, 'Set ANDROID_HOME to the Android SDK location');
  const tools = join(process.env.ANDROID_HOME, 'build-tools/36.0.0');
  const run = (tool, args) => {
    if (tool === 'apksigner') {
      const java = process.env.JAVA_HOME
        ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
        : 'java';
      return execFileSync(java, ['-jar', join(tools, 'lib/apksigner.jar'), ...args], {
        encoding: 'utf8',
        timeout: 60_000,
      });
    }
    return execFileSync(join(tools, tool + (process.platform === 'win32' ? '.exe' : '')), args, {
      encoding: 'utf8',
      timeout: 60_000,
    });
  };
  apk = resolve(apk);
  const signature = run('apksigner', [
    'verify',
    '--verbose',
    '--print-certs',
    '--min-sdk-version',
    '26',
    '--max-sdk-version',
    '36',
    apk,
  ]);
  const fingerprints = [...signature.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$/gm)].map(
    match => match[1],
  );
  assert.equal(fingerprints.length, 1, 'The APK must have exactly one verified signer');
  const releasePin = readFileSync(join(root, 'android/release-signing-certificate.sha256'), 'utf8').trim();
  assert.match(releasePin, /^[a-f0-9]{64}$/);
  if (kind === 'release')
    assert.equal(fingerprints[0], releasePin, 'The APK must retain the existing release certificate');
  else assert.notEqual(fingerprints[0], releasePin, 'Test APKs must not use the private release key');
  const badging = run('aapt2', ['dump', 'badging', apk]);
  const packageInfo = badging.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const [major, minor, patch] = version.split('.').map(Number);
  const versionCode = major * 10000 + minor * 100 + patch;
  const packageName = kind === 'install-check' ? 'com.researchbot.android.installcheck' : 'com.researchbot.android';
  assert.deepEqual(
    packageInfo?.slice(1),
    [packageName, String(versionCode), version],
    'APK package or version differs from the intended build',
  );
  assert.equal(Number(badging.match(/^minSdkVersion:'(\d+)'/m)?.[1]), 26);
  assert.equal(Number(badging.match(/^targetSdkVersion:'(\d+)'/m)?.[1]), 36);
  const debuggable = /^application-debuggable\s*$/m.test(badging);
  assert.equal(debuggable, kind === 'debug', 'Release and install-check APKs must disable debugging');
  const manifest = run('aapt2', ['dump', 'xmltree', apk, '--file', 'AndroidManifest.xml']);
  assert.ok(!/:testOnly\([^)]*\)=true/.test(manifest), 'The APK must install without ADB test-only flags');
  if (kind === 'install-check') assert.match(badging, /^application-label:'Research Bot APK Test'$/m);
  run('zipalign', ['-c', '-P', '16', '4', apk]);
  const bytes = readFileSync(apk);
  const info = {
    kind,
    package: packageName,
    version,
    versionCode,
    minSdk: 26,
    targetSdk: 36,
    debuggable,
    certificateSha256: fingerprints[0],
    apkSha256: createHash('sha256').update(bytes).digest('hex'),
    apkBytes: bytes.length,
  };
  console.log(JSON.stringify(info, null, 2));
  return info;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [apk, kind = 'release'] = process.argv.slice(2);
  assert.ok(apk, 'Pass an APK path and optionally release, debug or install-check');
  verifyAndroidApk(apk, kind);
}
