// Exercise the release task against a real temporary keystore, never the maintainer's private key.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeKeystoreSecret } from './restore-android-signing.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), 'research-signing-test-'));
const store = join(fixture, 'fixture.jks');
const certificate = join(fixture, 'fixture.der');
const storePassword = randomBytes(24).toString('hex');
const keyPassword = randomBytes(24).toString('hex');
const environment = {
  ...process.env,
  RESEARCH_TEST_STORE_PASSWORD: storePassword,
  RESEARCH_TEST_KEY_PASSWORD: keyPassword,
};
for (const name of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'])
  delete environment[name];
const keytool = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool')
  : 'keytool';
const key = args => execFileSync(keytool, args, { env: environment, stdio: 'ignore', timeout: 60_000 });
const marker = 'Fixture packaging ran';
try {
  key([
    '-genkeypair',
    '-keystore',
    store,
    '-storetype',
    'JKS',
    '-alias',
    'fixture',
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '1',
    '-dname',
    'CN=Research Bot signing fixture',
    '-storepass:env',
    'RESEARCH_TEST_STORE_PASSWORD',
    '-keypass:env',
    'RESEARCH_TEST_KEY_PASSWORD',
  ]);
  key([
    '-exportcert',
    '-keystore',
    store,
    '-alias',
    'fixture',
    '-file',
    certificate,
    '-storepass:env',
    'RESEARCH_TEST_STORE_PASSWORD',
  ]);
  const pin = createHash('sha256').update(readFileSync(certificate)).digest('hex');
  const storeBytes = readFileSync(store);
  const encoded = storeBytes.toString('base64');
  for (const candidate of [
    encoded,
    `\uFEFF${encoded.match(/.{1,64}/g).join('\r\n')}\n`,
    `"${encoded}"`,
    `'${encoded}'`,
    `data:application/octet-stream;base64,${encoded}`,
    storeBytes.toString('base64url'),
    `ANDROID_KEYSTORE_BASE64=${encoded}`,
    `export ANDROID_KEYSTORE_BASE64='${encoded}'`,
    `\`\`\`base64\n${encoded}\n\`\`\``,
    JSON.stringify({ ANDROID_KEYSTORE_BASE64: encoded }),
    JSON.stringify({ keystoreBase64: encoded }),
    encoded.match(/.{1,64}/g).join('\\r\\n'),
  ])
    assert.deepEqual(decodeKeystoreSecret(candidate), storeBytes);
  for (const candidate of [
    '',
    '/tmp/release.jks',
    'base64 -w0 release.jks',
    'a===',
    'A',
    Buffer.from('not a key').toString('base64'),
  ])
    assert.throws(() => decodeKeystoreSecret(candidate), /ANDROID_KEYSTORE_BASE64/);
  console.log(
    'Passed: copy/paste wrappers preserve the exact keystore; malformed or non-keystore secrets are rejected.',
  );
  const pinPath = join(fixture, 'release-signing-certificate.sha256');
  writeFileSync(pinPath, `${pin}\n`);
  writeFileSync(join(fixture, 'settings.gradle'), "rootProject.name = 'release-signing-fixture'\n");
  const script = join(root, 'android/release-signing.gradle').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  writeFileSync(
    join(fixture, 'build.gradle'),
    `apply from: '${script}'\ntasks.register('packageRelease') { doLast { println '${marker}' } }\n`,
  );
  const configured = {
    ...environment,
    ANDROID_KEYSTORE_PATH: store,
    ANDROID_KEYSTORE_PASSWORD: storePassword,
    ANDROID_KEY_ALIAS: 'fixture',
    ANDROID_KEY_PASSWORD: keyPassword,
  };
  const run = env => {
    const command = process.platform === 'win32' ? 'cmd.exe' : 'bash';
    const wrapper =
      process.platform === 'win32' ? ['/d', '/c', join(root, 'android/gradlew.bat')] : [join(root, 'android/gradlew')];
    const result = spawnSync(
      command,
      [...wrapper, '--no-daemon', '--console=plain', '--max-workers=2', 'packageRelease'],
      { cwd: fixture, env, encoding: 'utf8', timeout: 120_000 },
    );
    assert.equal(result.error, undefined, result.error?.message);
    return { status: result.status, text: `${result.stdout || ''}\n${result.stderr || ''}` };
  };
  const cases = [
    ['missing signing configuration', environment, /Release APK signing is not configured/],
    [
      'wrong private-key password',
      { ...configured, ANDROID_KEY_PASSWORD: randomBytes(24).toString('hex') },
      /release private key could not be opened/,
    ],
    ['wrong alias', { ...configured, ANDROID_KEY_ALIAS: 'missing' }, /release private key could not be opened/],
  ];
  for (const [name, env, expected] of cases) {
    const result = run(env);
    assert.notEqual(result.status, 0, name);
    assert.match(result.text, expected, name);
    assert.ok(!result.text.includes(marker), `${name}: no release packaging can run`);
    assert.ok(
      !result.text.includes(storePassword) && !result.text.includes(keyPassword),
      'Signing passwords must not appear in build output',
    );
    console.log(`Passed: ${name} stops release packaging.`);
  }
  writeFileSync(pinPath, `${'0'.repeat(64)}\n`);
  const mismatch = run(configured);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.text, /does not match the pinned release certificate/);
  assert.ok(!mismatch.text.includes(marker));
  console.log('Passed: a replacement key stops release packaging.');
  writeFileSync(pinPath, `${pin}\n`);
  const valid = run(configured);
  assert.equal(valid.status, 0, valid.text);
  assert.ok(valid.text.includes(marker));
  assert.match(valid.text, /Verified release signing certificate/);
  console.log('Passed: the pinned private key permits release packaging.');
  const freshPinPath = join(fixture, 'fresh-release-signing-certificate.sha256');
  writeFileSync(freshPinPath, `${pin}\n`);
  writeFileSync(pinPath, `${'0'.repeat(64)}\n`);
  const fresh = run({ ...configured, RESEARCH_ANDROID_FRESH_INSTALL: 'true' });
  assert.equal(fresh.status, 0, fresh.text);
  assert.ok(fresh.text.includes(marker));
  assert.equal(readFileSync(pinPath, 'utf8'), `${'0'.repeat(64)}\n`, 'Fresh signing must not replace the legacy pin');
  writeFileSync(freshPinPath, `${'1'.repeat(64)}\n`);
  const freshMismatch = run({ ...configured, RESEARCH_ANDROID_FRESH_INSTALL: 'true' });
  assert.notEqual(freshMismatch.status, 0);
  assert.match(freshMismatch.text, /does not match the pinned release certificate/);
  assert.ok(!freshMismatch.text.includes(marker));
  console.log('Passed: fresh production signing uses its independent pin and rejects a different key.');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
