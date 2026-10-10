import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Fetch } from '../core/platform';
import { findUpdate } from '../src/android/releases';
import { createAndroidUpdateController } from '../src/android/updater';

const repository = 'https://github.com/Srimi1/research------bot';
const certificate = 'e07d0f1bb2e400e248c1b2af756d314686d912718127aed1e65d4344ad555a35';
const sha256 = 'a'.repeat(64);
const installed = {
  version: '0.4.0',
  versionCode: 400,
  sdk: 36,
  packageName: 'com.researchbot.android',
  certificateSha256: certificate,
};
const release = (version: string, extra: object = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  assets: [`research-bot-${version}-android.apk`, 'SHA256SUMS-android.txt', 'BUILD_INFO-android.json'].map(name => ({
    name,
    browser_download_url: `${repository}/releases/download/v${version}/${name}`,
  })),
  ...extra,
});
const build = (version: string, extra: object = {}) => ({
  kind: 'release',
  version,
  versionCode: Number(version.split('.')[2]) + 400,
  package: installed.packageName,
  certificateSha256: certificate,
  minSdk: 26,
  apkSha256: sha256,
  ...extra,
});
function fixture(releases = [release('0.4.3')], builds: Record<string, object> = {}, sums?: string) {
  const requests: string[] = [];
  const fetch: Fetch = async (input, options) => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://api.github.com/repos/Srimi1/research------bot/releases?per_page=30') {
      assert.equal(options?.redirect, 'error');
      return new Response(JSON.stringify(releases));
    }
    assert.equal(options?.redirect, 'follow', 'Release assets must follow the public CDN redirect');
    const match = url.match(/\/v(\d+\.\d+\.\d+)\/(.+)$/);
    assert.ok(match, url);
    if (match[2] === 'BUILD_INFO-android.json')
      return new Response(JSON.stringify(builds[match[1]] ?? build(match[1])));
    if (match[2] === 'SHA256SUMS-android.txt')
      return new Response(sums ?? `${sha256}  research-bot-${match[1]}-android.apk\n`);
    throw new Error(`The APK must be downloaded by the native verifier: ${url}`);
  };
  return { fetch, requests };
}

test('Android finds its newest compatible release when desktop is Latest and GitHub lists dates out of version order', async () => {
  const { fetch } = fixture([release('0.4.4', { assets: [] }), release('0.4.1'), release('0.4.3')]);
  assert.equal((await findUpdate(fetch, installed))?.version, '0.4.3');
});

test('a separate package or a replacement signing key cannot be offered as an update', async () => {
  for (const info of [
    build('0.4.3', { package: 'com.researchbot.android.fresh' }),
    build('0.4.3', { certificateSha256: 'b'.repeat(64) }),
    build('0.4.3', { kind: 'fresh-release' }),
  ]) {
    const { fetch, requests } = fixture([release('0.4.3')], { '0.4.3': info });
    assert.equal(await findUpdate(fetch, installed), undefined);
    assert.equal(
      requests.some(url => url.endsWith('.apk') || url.includes('SHA256SUMS')),
      false,
    );
  }
  const { fetch } = fixture([release('0.4.4'), release('0.4.3')], {
    '0.4.4': build('0.4.4', { certificateSha256: 'b'.repeat(64) }),
  });
  assert.equal((await findUpdate(fetch, installed))?.version, '0.4.3');
});

test('drafts, prereleases, old versions, unavailable SDKs and invalid build identity are excluded', async () => {
  for (const candidate of [
    release('0.4.3', { draft: true }),
    release('0.4.3', { prerelease: true }),
    release('0.4.0'),
    release('0.4.3', { assets: [] }),
  ])
    assert.equal(await findUpdate(fixture([candidate]).fetch, installed), undefined);
  for (const changes of [{ version: '0.4.2' }, { versionCode: 400 }, { minSdk: 37 }, { apkSha256: 'missing' }])
    assert.equal(
      await findUpdate(fixture([release('0.4.3')], { '0.4.3': build('0.4.3', changes) }).fetch, installed),
      undefined,
    );
  const elsewhere = release('0.4.3');
  elsewhere.assets[0].browser_download_url =
    'https://github.com/other/repo/releases/download/v0.4.3/research-bot-0.4.3-android.apk';
  assert.equal(await findUpdate(fixture([elsewhere]).fetch, installed), undefined);
});

test('missing signing identity and GitHub errors surface rather than reporting up to date', async () => {
  await assert.rejects(
    findUpdate(fixture().fetch, { ...installed, certificateSha256: undefined }),
    /signing information is unavailable/,
  );
  await assert.rejects(
    findUpdate(async () => new Response('{}', { status: 403 }), installed),
    /HTTP 403/,
  );
  await assert.rejects(
    findUpdate(async () => new Response('{}'), installed),
    /invalid release information/,
  );
});

function bridge() {
  let downloads = 0;
  let installs = 0;
  let failure = '';
  return {
    get downloads() {
      return downloads;
    },
    get installs() {
      return installs;
    },
    setFailure(value: string) {
      failure = value;
    },
    async appInfo() {
      return { ...installed, canInstall: true };
    },
    async downloadUpdate(options: { sha256: string }) {
      assert.equal(options.sha256, sha256);
      downloads++;
      return { version: '0.4.3' };
    },
    async installUpdate() {
      installs++;
      if (failure) throw new Error(failure);
    },
  };
}

test('concurrent checks share a download, and installation requires an explicit action', async () => {
  const native = bridge();
  const controller = createAndroidUpdateController(fixture().fetch, native);
  await assert.rejects(controller.installUpdate(), /Download the update first/);
  const first = controller.checkForUpdates();
  assert.equal(controller.checkForUpdates(), first);
  assert.deepEqual(await first, { status: 'ready', version: '0.4.3' });
  await controller.checkForUpdates();
  assert.equal(native.downloads, 1);
  assert.equal(native.installs, 0);
  native.setFailure('Allow Research Bot to install updates, then choose Install again.');
  await assert.rejects(controller.installUpdate(), /choose Install again/);
  native.setFailure('');
  await controller.installUpdate();
  assert.equal(native.downloads, 1, 'Permission changes must retain the already verified APK');
  native.setFailure('Download the update first.');
  await assert.rejects(controller.installUpdate(), /Download the update first/);
  native.setFailure('');
  await controller.checkForUpdates();
  assert.equal(native.downloads, 2, 'Android clearing the cache must trigger another verified download');
});

test('a mismatched checksum, rejected APK or mismatched version never opens the installer', async () => {
  const native = bridge();
  const mismatch = createAndroidUpdateController(
    fixture(undefined, undefined, `${'b'.repeat(64)}  research-bot-0.4.3-android.apk`).fetch,
    native,
  );
  await assert.rejects(mismatch.checkForUpdates(), /checksum and build information differ/);
  assert.equal(native.downloads, 0);
  const rejected = createAndroidUpdateController(fixture().fetch, {
    ...native,
    downloadUpdate: async () => {
      throw new Error('The update was signed by a different key.');
    },
  });
  await assert.rejects(rejected.checkForUpdates(), /different key/);
  await assert.rejects(rejected.installUpdate(), /Download the update first/);
  const wrongVersion = createAndroidUpdateController(fixture().fetch, {
    ...native,
    downloadUpdate: async () => ({ version: '0.4.4' }),
  });
  await assert.rejects(wrongVersion.checkForUpdates(), /APK version differs/);
  await assert.rejects(wrongVersion.installUpdate(), /Download the update first/);
  assert.equal(native.installs, 0);
});
