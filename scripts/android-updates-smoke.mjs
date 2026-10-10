// Exercise the shipped Android UI, real SQLite and update controller with synthetic native services.
// This does not establish production signing compatibility or a physical-phone upgrade.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const repository = 'https://github.com/Srimi1/research------bot';
const certificate = 'e07d0f1bb2e400e248c1b2af756d314686d912718127aed1e65d4344ad555a35';
const sha256 = 'a'.repeat(64);
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5187'],
  { stdio: 'ignore' },
);
const files = new Map();
const bodies = new Map();
let mode = 'current';
let allowInstall = false;
let downloads = 0;
let installs = 0;
let browser;
const candidate = {
  tag_name: 'v0.4.3',
  draft: false,
  prerelease: false,
  assets: ['research-bot-0.4.3-android.apk', 'BUILD_INFO-android.json', 'SHA256SUMS-android.txt'].map(name => ({
    name,
    browser_download_url: `${repository}/releases/download/v0.4.3/${name}`,
  })),
};
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:5187')).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (!process.env.CI && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true });
  await context.exposeBinding('__nativePromise', async (_, plugin, method, options) => {
    assert.equal(plugin, 'ResearchNative');
    if (method === 'fileRead') return files.has(options.name) ? { data: files.get(options.name) } : { missing: true };
    if (method === 'fileWrite') {
      files.set(options.name, options.data);
      return {};
    }
    if (method === 'fileRemove') {
      files.delete(options.name);
      return {};
    }
    if (method === 'appInfo')
      return {
        version: '0.4.0',
        versionCode: 400,
        sdk: 36,
        packageName: 'com.researchbot.android',
        certificateSha256: certificate,
        webviewVersion: '133.0.0.0',
        canInstall: allowInstall,
      };
    if (method === 'httpOpen') {
      let body;
      if (options.url.endsWith('/releases?per_page=30')) {
        if (mode === 'offline') return { status: 503, statusText: '', headers: {} };
        assert.equal(options.follow, false);
        body = JSON.stringify(mode === 'current' ? [] : [candidate]);
      } else if (options.url.endsWith('/BUILD_INFO-android.json')) {
        assert.equal(options.follow, true);
        body = JSON.stringify({
          kind: 'release',
          version: '0.4.3',
          versionCode: 403,
          minSdk: 26,
          apkSha256: sha256,
          package: mode === 'wrong-package' ? 'com.researchbot.android.fresh' : 'com.researchbot.android',
          certificateSha256: mode === 'wrong-key' ? 'b'.repeat(64) : certificate,
        });
      } else if (options.url.endsWith('/SHA256SUMS-android.txt'))
        body = `${mode === 'bad-checksum' ? 'b'.repeat(64) : sha256}  research-bot-0.4.3-android.apk\n`;
      else throw new Error(`Unexpected update request: ${options.url}`);
      bodies.set(options.id, body);
      return { status: 200, statusText: '', headers: {} };
    }
    if (method === 'httpRead') {
      const body = bodies.get(options.id);
      bodies.delete(options.id);
      return body === undefined ? { done: true } : { done: false, data: Buffer.from(body).toString('base64') };
    }
    if (method === 'httpClose') {
      bodies.delete(options.id);
      return {};
    }
    if (method === 'downloadUpdate') {
      assert.equal(options.sha256, sha256);
      assert.equal(options.url, `${repository}/releases/download/v0.4.3/research-bot-0.4.3-android.apk`);
      downloads++;
      if (mode === 'rejected-apk') throw new Error('The update was signed by a different key.');
      return { version: '0.4.3' };
    }
    if (method === 'installUpdate') {
      if (!allowInstall)
        throw new Error(
          'Allow Research Bot to install updates in the screen that just opened, then choose Install again.',
        );
      installs++;
      return {};
    }
    throw new Error(`Unexpected native call: ${method}`);
  });
  await context.addInitScript(() => {
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [
        {
          name: 'ResearchNative',
          methods: [
            'fileRead',
            'fileWrite',
            'fileRemove',
            'appInfo',
            'httpOpen',
            'httpRead',
            'httpClose',
            'downloadUpdate',
            'installUpdate',
          ].map(name => ({ name, rtype: 'promise' })),
        },
        {
          name: 'App',
          methods: [
            { name: 'addListener', rtype: 'callback' },
            { name: 'removeListener', rtype: 'callback' },
          ],
        },
      ],
      nativePromise: (...args) => window.__nativePromise(...args),
      nativeCallback: () => 'update-fixture-listener',
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5187');
  await page.waitForFunction(() => typeof window.research?.checkForUpdates === 'function');
  const project = await page.evaluate(async () => {
    await window.research.saveSettings({ ...(await window.research.getSettings()), autoUpdate: false });
    const detail = await window.research.createProject({ title: 'Retain this research', topic: 'Update fixture' });
    await window.research.saveProject({ ...detail.project, notes: 'Keep these notes when checking updates.' });
    return detail.project;
  });
  await page.waitForFunction(() => !document.querySelector('.page-loading'));
  await page.getByRole('button', { name: 'Account and preferences', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Account & preferences' });
  const check = dialog.getByRole('button', { name: 'Check for updates', exact: true });
  assert.equal(await dialog.getByRole('checkbox', { name: 'Check for updates automatically' }).isChecked(), false);
  for (const next of ['current', 'wrong-package', 'wrong-key']) {
    mode = next;
    await check.click();
    await dialog.getByText('No newer compatible update is published.').waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Install update 0.4.3' }).count(), 0);
    assert.equal(downloads, 0);
  }
  for (const [next, message] of [
    ['offline', /HTTP 503/],
    ['bad-checksum', /checksum and build information differ/],
    ['rejected-apk', /signed by a different key/],
  ]) {
    mode = next;
    await check.click();
    await dialog.getByRole('alert').filter({ hasText: message }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Install update 0.4.3' }).count(), 0);
    assert.equal(installs, 0);
  }
  mode = 'ready';
  await check.click();
  await dialog.getByText('Research Bot 0.4.3 is downloaded and verified.').waitFor();
  assert.equal(downloads, 2, 'One rejected download and one verified retry');
  assert.equal(installs, 0, 'Checking must not open the Android installer');
  const install = dialog.getByRole('button', { name: 'Install update 0.4.3', exact: true });
  await install.click();
  await dialog
    .getByRole('alert')
    .filter({ hasText: /choose Install again/ })
    .waitFor();
  allowInstall = true;
  await install.click();
  assert.equal(installs, 1);
  assert.equal(downloads, 2, 'Granting permission must not discard the downloaded update');
  const saved = await page.evaluate(id => window.research.getProject(id), project.id);
  assert.equal(saved.project.notes, 'Keep these notes when checking updates.');
  assert.deepEqual(errors, []);
  console.log(
    'Android manual updates work with automatic checks off; incompatible builds and failed verification cannot be installed; installer permission retry preserves the download and saved notes. Native services are synthetic.',
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
