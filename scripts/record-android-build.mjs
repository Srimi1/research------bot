// Record the actual signed release artifact. No keystore or passwords are read here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyAndroidApk } from './verify-android-apk.mjs';

const [apk, output, kind = 'release'] = process.argv.slice(2);
assert.ok(apk && output, 'Pass the signed APK and output BUILD_INFO JSON paths');
assert.equal(kind, 'release', 'Record production updates only with the original application identity');
const verified = verifyAndroidApk(apk, kind);
const tools = join(process.env.ANDROID_HOME, 'build-tools/36.0.0');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 60_000 });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const expected = verified.certificateSha256;
assert.match(expected, /^[a-f0-9]{64}$/);
const certs = run(join(tools, 'apksigner'), ['verify', '--print-certs', apk]);
const fingerprints = [...certs.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$/gm)].map(m => m[1]);
assert.deepEqual(fingerprints, [expected], 'APK must use the committed release signing certificate');
const badging = run(join(tools, 'aapt2'), ['dump', 'badging', apk]);
const packageInfo = badging.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
const [major, minor, patch] = version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + patch;
assert.deepEqual(packageInfo?.slice(1), [verified.package, String(versionCode), version]);
const minSdk = Number(badging.match(/^minSdkVersion:'(\d+)'/m)?.[1]);
const targetSdk = Number(badging.match(/^targetSdkVersion:'(\d+)'/m)?.[1]);
assert.equal(minSdk, 26);
assert.equal(targetSdk, 36);
run(join(tools, 'zipalign'), ['-c', '-P', '16', '4', apk]);
const bytes = readFileSync(apk);
const info = {
  kind,
  version,
  versionCode,
  package: verified.package,
  minSdk,
  targetSdk,
  sourceCommit: run('git', ['rev-parse', 'HEAD']).trim(),
  certificateSha256: expected,
  apkSha256: createHash('sha256').update(bytes).digest('hex'),
  apkBytes: bytes.length,
  validation: {
    regressionTests: 'passed (release workflow npm test)',
    androidReleaseBuildAndLint: 'passed',
    signatureAnd16KiBAlignment: 'passed',
    android16SignedApkStartupAndPersistence: 'pending release workflow',
  },
  limits: [
    'Live ChatGPT sign-in and inference on the physical OnePlus 7T Pro / Legion OS require maintainer confirmation',
  ],
};
writeFileSync(output, JSON.stringify(info, null, 2) + '\n');
console.log(`Recorded signed Android ${version}: ${info.apkSha256}, certificate ${expected}`);
