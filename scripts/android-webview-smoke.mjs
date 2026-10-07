// Exercise the production Android bundle and real SQLite/WASM under the shipped CSP.
// Only device file storage and lifecycle callbacks are mocked; no account or AI calls are made.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5180'],
  {
    stdio: 'ignore',
  },
);
const files = new Map();
let browser;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:5180')).ok) break;
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
  const context = await browser.newContext({ viewport: { width: 412, height: 892 } });
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
    throw new Error(`Unexpected native call in the packaged Android test: ${method}`);
  });
  await context.addInitScript(() => {
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [
        {
          name: 'ResearchNative',
          methods: ['fileRead', 'fileWrite', 'fileRemove'].map(name => ({ name, rtype: 'promise' })),
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
      nativeCallback: () => 'test-lifecycle-listener',
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5180');
  await page.waitForFunction(() => typeof window.research?.getProject === 'function');
  const project = await page.evaluate(async () => {
    const api = window.research;
    await api.saveSettings({ ...(await api.getSettings()), autoUpdate: false });
    const detail = await api.createProject({ title: 'Android packaged startup', topic: 'SQLite under CSP' });
    await api.saveProject({ ...detail.project, notes: 'A note saved by the actual Android backend.' });
    return detail.project;
  });
  await page.waitForFunction(() => !document.querySelector('.page-loading'));
  await page.waitForTimeout(1_500);
  assert.ok(files.has('research.sqlite'), 'The production Android backend must write a real SQLite database');
  assert.deepEqual(
    [...Buffer.from(files.get('research.sqlite'), 'base64').subarray(0, 16)],
    [...Buffer.from('SQLite format 3\0')],
  );
  await page.reload();
  await page.waitForFunction(() => typeof window.research?.getProject === 'function');
  const restored = await page.evaluate(async id => window.research.getProject(id), project.id);
  assert.equal(restored.project.notes, 'A note saved by the actual Android backend.');
  await page.getByRole('heading', { name: project.title }).waitFor();
  assert.equal(await page.locator('#research-notes').inputValue(), restored.project.notes);
  // Allow WebAssembly without allowing eval() or Function() for JavaScript.
  // Run this from an ordinary same-origin script: DevTools evaluation can bypass eval restrictions.
  await page.route('http://127.0.0.1:5180/__csp-probe.js', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "try { window.eval('1 + 1'); window.__scriptEvalAllowed = true; } catch { window.__scriptEvalAllowed = false; }",
    }),
  );
  await page.addScriptTag({ url: 'http://127.0.0.1:5180/__csp-probe.js' });
  const unsafeEval = await page.evaluate(() => window.__scriptEvalAllowed);
  assert.equal(unsafeEval, false, 'The shipped CSP must still block JavaScript eval');
  assert.deepEqual(errors, []);
  console.log(
    'Production Android bundle opened SQLite, saved/restored a project and rendered notes under the shipped CSP. JavaScript eval remains blocked.',
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
