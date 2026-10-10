// Run the shipped Android backend, native adapters and WebCrypto/JWT checks under its production CSP.
// Native services and OpenAI responses are synthetic; no real account, browser consent or tokens are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { chromium } from 'playwright';

const legacyAbort = process.argv.includes('--legacy-abort') || process.env.ANDROID_AUTH_LEGACY === '1';
const legacyTimeout = process.argv.includes('--legacy-timeout') || process.argv.includes('--legacy-all');
const legacyUuid = process.argv.includes('--legacy-all');
const missingInfo = process.argv.includes('--missing-info');
const buildVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const issuer = 'https://auth.openai.com';
const clientId = 'oaiapp_packaged_android_fixture';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5182'],
  { stdio: 'ignore' },
);
const keys = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'fixture-key', alg: 'RS256' };
const encryptionKey = randomBytes(32);
const files = new Map();
const bodies = new Map();
const authorizations = [];
const replies = [];
// Native lifecycle and exchange order for the current attempt.
let events = [];
let mode = 'response';
let authorization;
let idToken;
let page;
let browser;
let tokenRequests = 0;

function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:5182')).ok) break;
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
    if (method === 'encrypt') {
      if (mode === 'storage') throw new Error('Private credential contents must never escape this fixture.');
      return { data: encrypt(options.text) };
    }
    if (method === 'decrypt') {
      const value = Buffer.from(options.data, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return { text: Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8') };
    }
    if (method === 'loopbackStart') return { serverId: 'fixture-loopback', port: 37147 };
    if (method === 'loopbackClose') return {};
    if (method === 'signInKeepAliveStart' || method === 'signInKeepAliveStop') {
      events.push(method === 'signInKeepAliveStart' ? 'keepAliveStart' : 'keepAliveStop');
      return {};
    }
    if (method === 'openAppSettings') return {};
    if (method === 'loopbackRespond') {
      replies.push(options);
      events.push('reply');
      return {};
    }
    if (method === 'awaitForeground') {
      events.push('foreground');
      return {};
    }
    if (method === 'appInfo') {
      if (missingInfo) throw new Error('Optional device information is unavailable.');
      return { version: buildVersion, versionCode: 309, sdk: 36, webviewVersion: '115.0.0.0', canInstall: false };
    }
    if (method === 'openUrl') {
      authorization = new URL(options.url);
      assert.equal(authorization.origin + authorization.pathname, `${issuer}/api/accounts/authorize`);
      authorizations.push(authorization);
      assert.equal(events.at(-1), 'keepAliveStart', 'The service must start before the browser opens');
      if (mode === 'pending') return {};
      idToken = await new SignJWT({
        nonce: mode === 'nonce' ? 'incorrect-nonce' : authorization.searchParams.get('nonce'),
        name: 'Fixture Researcher',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject('fixture-subject')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
      const callback = new URL(authorization.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({
        state: authorization.searchParams.get('state'),
        code: 'synthetic-code',
        client_id: clientId,
      }).toString();
      await page.evaluate(
        url =>
          window.__emitNative('loopbackRequest', {
            serverId: 'fixture-loopback',
            requestId: 'fixture-request',
            method: 'GET',
            url,
          }),
        callback.pathname + callback.search,
      );
      return {};
    }
    if (method === 'httpOpen') {
      let status = 200;
      let data;
      if (
        options.url === `${issuer}/api/accounts/oauth/token` &&
        new URLSearchParams(options.body).get('client_id') === 'oaiapp_research_connectivity_check'
      ) {
        status = 400;
        data = { error: 'invalid_client' };
      } else if (options.url === `${issuer}/api/accounts/oauth/token`) {
        tokenRequests++;
        events.push('token');
        if (mode === 'dns')
          return { __fixtureFailure: { code: 'RB_NET_DNS', message: 'private native request details' } };
        const form = new URLSearchParams(options.body);
        assert.equal(form.get('client_id'), clientId);
        assert.equal(form.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
        assert.equal(
          createHash('sha256').update(form.get('code_verifier')).digest('base64url'),
          authorization.searchParams.get('code_challenge'),
        );
        if (mode === 'response') {
          status = 403;
          data = '<html>private upstream diagnostics</html>';
        } else
          data = {
            access_token: 'synthetic-access',
            refresh_token: 'synthetic-refresh',
            id_token: idToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: scopes,
          };
      } else if (options.url === `${issuer}/.well-known/openid-configuration`) {
        data = {
          issuer,
          jwks_uri: `${issuer}/.well-known/jwks.json`,
          revocation_endpoint: `${issuer}/api/accounts/oauth/revoke`,
        };
      } else if (options.url === `${issuer}/.well-known/jwks.json`) data = { keys: [jwk] };
      else if (options.url === 'https://api.openai.com/v1/models')
        data = { models: [{ slug: 'fixture-model', visibility: 'list' }] };
      else if (options.url === 'https://api.openai.com/v1/responses') {
        const request = JSON.parse(options.body);
        const supplied = JSON.parse(request.input[0].content);
        assert.equal(request.store, false);
        assert.equal(request.stream, true);
        assert.match(request.instructions, /literature review/i);
        assert.equal(supplied.sources.length, 1);
        assert.doesNotMatch(request.input[0].content, /PRIVATE PROJECT|UNSELECTED EVIDENCE/);
        const review = {
          title: 'Packaged literature review',
          sections: [
            {
              heading: 'Pilot evidence',
              paragraphs: [
                {
                  text: 'The saved abstract describes an association in one dining hall.',
                  citations: [{ sourceId: 'S1', field: 'abstract', quote: 'associated with less plate waste' }],
                },
              ],
            },
          ],
          limitations: ['One pilot does not establish causality.'],
        };
        data =
          `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: JSON.stringify(review) })}\n\n` +
          `data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 120, output_tokens: 80 } } })}\n\n`;
      } else if (options.url === 'https://api.github.com/repos/Srimi1/research------bot/releases/latest')
        data = { tag_name: `v${buildVersion}`, draft: false, prerelease: false, assets: [] };
      else throw new Error(`Unexpected fixture endpoint: ${new URL(options.url).pathname}`);
      bodies.set(options.id, Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)));
      return { status, statusText: '', headers: { 'content-type': 'application/json' } };
    }
    if (method === 'httpRead') {
      const body = bodies.get(options.id);
      if (!body?.length) return { done: true };
      // Real Android responses arrive in chunks. Cover incremental token/JWKS parsing as well.
      const chunk = body.subarray(0, 127);
      bodies.set(options.id, body.subarray(127));
      return { done: false, data: chunk.toString('base64') };
    }
    if (method === 'httpClose') {
      bodies.delete(options.id);
      return {};
    }
    throw new Error(`Unexpected native fixture method: ${method}`);
  });
  await context.addInitScript(
    ({ legacyAbort, legacyTimeout, legacyUuid }) => {
      if (legacyAbort) Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
      if (legacyTimeout) Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
      if (legacyUuid) Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
      const listeners = new Map();
      let counter = 0;
      window.__emitNative = (eventName, event) => {
        for (const listener of listeners.values()) if (listener.eventName === eventName) listener.callback(event);
      };
      window.androidBridge = {};
      window.Capacitor = {
        PluginHeaders: [
          {
            name: 'ResearchNative',
            methods: [
              'fileRead',
              'fileWrite',
              'fileRemove',
              'encrypt',
              'decrypt',
              'loopbackStart',
              'loopbackRespond',
              'loopbackClose',
              'awaitForeground',
              'signInKeepAliveStart',
              'signInKeepAliveStop',
              'openAppSettings',
              'openUrl',
              'httpOpen',
              'httpRead',
              'httpClose',
              'appInfo',
            ]
              .map(name => ({ name, rtype: 'promise' }))
              .concat([
                { name: 'addListener', rtype: 'callback' },
                { name: 'removeListener', rtype: 'promise' },
              ]),
          },
          {
            name: 'App',
            methods: [
              { name: 'addListener', rtype: 'callback' },
              { name: 'removeListener', rtype: 'promise' },
            ],
          },
        ],
        nativePromise(plugin, method, options) {
          if (method === 'removeListener') {
            listeners.delete(options.callbackId);
            return Promise.resolve({});
          }
          return window.__nativePromise(plugin, method, options).then(result => {
            if (result.__fixtureFailure) throw result.__fixtureFailure;
            return result;
          });
        },
        nativeCallback(_plugin, _method, { eventName }, callback) {
          const id = String(++counter);
          listeners.set(id, { eventName, callback });
          return id;
        },
      };
    },
    { legacyAbort: legacyAbort || legacyUuid, legacyTimeout, legacyUuid },
  );
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5182');
  await page.waitForFunction(() => typeof window.research?.account === 'function');
  await page.evaluate(async () =>
    window.research.saveSettings({ ...(await window.research.getSettings()), autoUpdate: false }),
  );
  events = [];
  await page.locator('.topbar-signin').click();
  for (const [failureMode, code] of [
    ['response', 'RESPONSE'],
    ['dns', 'EXCHANGE-DNS'],
    ['nonce', 'IDENTITY-NONCE'],
    ['storage', 'STORAGE'],
  ]) {
    mode = failureMode;
    // The first attempt already started when the dialog opened; its events were recorded from the start.
    if (failureMode !== 'response') events = [];
    if (failureMode !== 'response') {
      // A retry can scroll the preferences sheet to its button; the resulting error must return into view.
      await page.getByRole('dialog').evaluate(dialog => {
        dialog.scrollTop = dialog.scrollHeight;
      });
      await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
    }
    const alert = page.getByRole('alert');
    await alert
      .filter({ hasText: `RB-AUTH-${code}` })
      .waitFor({ timeout: legacyAbort || legacyTimeout ? 5000 : 30000 });
    const box = await alert.boundingBox();
    assert.ok(
      box.y >= 0 && box.y + box.height < 892,
      'The complete sign-in error must be visible on a phone without scrolling',
    );
    // The browser is answered and the app brought back before any token request; Android blocks
    // networking for the app while the browser is in front. The outcome is shown only in the app.
    assert.deepEqual(events, ['keepAliveStart', 'reply', 'foreground', 'token', 'keepAliveStop']);
    assert.equal(replies.at(-1).status, 200);
    assert.equal(replies.at(-1).returnToApp, true);
    assert.match(replies.at(-1).body, /Authorization received/);
    assert.doesNotMatch(
      replies.at(-1).body,
      /RB-AUTH|synthetic-access|synthetic-refresh|private upstream|Private credential/,
    );
    assert.equal((await page.evaluate(() => window.research.account())).signedIn, false);
    assert.equal(files.has('account.enc'), false);
    await page
      .locator('p.help')
      .filter({ hasText: `Research Bot ${buildVersion} · Android System WebView` })
      .waitFor({ timeout: 5000 });
    if (failureMode === 'response') {
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.reload();
      await page.getByRole('button', { name: 'Account and preferences', exact: true }).click();
      await page.locator('.callout').filter({ hasText: 'RB-AUTH-RESPONSE' }).waitFor();
      await page.getByText('Previous sign-in attempt', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Check connection', exact: true }).click();
      const report = page.getByRole('status').filter({ hasText: 'Sign-in connection check' });
      await report.waitFor();
      assert.match(await report.textContent(), /Native HTTPS: HTTP 200/);
      assert.match(await report.textContent(), /Dummy token exchange: HTTP 400/);
      const diagnostic = await page.evaluate(() => window.research.checkSignInConnection(new AbortController().signal));
      assert.equal(diagnostic.device.appVersion, buildVersion);
      if (legacyUuid)
        assert.deepEqual(diagnostic.features, { signalAny: false, signalTimeout: false, randomUuid: false });
      assert.doesNotMatch(
        JSON.stringify(diagnostic),
        /synthetic-code|synthetic-access|synthetic-refresh|Fixture Researcher|private/,
      );
    }
  }
  // Native/browser pause and resume must keep the dialog and its pending operation alive.
  mode = 'pending';
  events = [];
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel sign-in', exact: true }).waitFor();
  await page.waitForFunction(() => Boolean(window.research));
  for (let attempt = 0; attempt < 50 && events.length === 0; attempt++)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(events, ['keepAliveStart']);
  const marker = JSON.parse(Buffer.from(files.get('signin.json'), 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(marker), ['startedAt']);
  await page.evaluate(() => {
    window.__emitNative('pause', {});
    window.__emitNative('appStateChange', { isActive: false });
    window.__emitNative('resume', {});
    window.__emitNative('appStateChange', { isActive: true });
    window.dispatchEvent(new Event('focus'));
  });
  await page.getByRole('button', { name: 'Cancel sign-in', exact: true }).waitFor();
  assert.deepEqual(events, ['keepAliveStart']);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.waitForFunction(async () => (await window.research.account()).message?.includes('RB-AUTH-CANCELLED'));
  assert.deepEqual(events, ['keepAliveStart', 'keepAliveStop']);
  await page.getByRole('button', { name: 'Account and preferences', exact: true }).click();

  // Exercise the real sign-in timeout path with a shortened fixture clock.
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = (handler, delay, ...args) => original(handler, delay === 165_000 ? 200 : delay, ...args);
  });
  events = [];
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'RB-AUTH-TIMEOUT' }).waitFor();
  assert.deepEqual(events, ['keepAliveStart', 'keepAliveStop']);

  // A reload models loss of the JS process without its finally block running.
  events = [];
  await page.reload();
  await page.getByRole('button', { name: 'Account and preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  for (let attempt = 0; attempt < 50 && events.length === 0; attempt++)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(events, ['keepAliveStart']);
  await page.reload();
  await page.getByRole('button', { name: 'Account and preferences', exact: true }).click();
  await page.locator('.callout').filter({ hasText: 'RB-AUTH-INTERRUPTED' }).waitFor();
  await page.getByRole('button', { name: 'Open battery settings', exact: true }).click();

  mode = 'success';
  events = [];
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  await Promise.race([
    page.getByText('Your ChatGPT account is connected.').waitFor(),
    page.getByRole('alert').waitFor(),
  ]);
  assert.equal(await page.getByRole('alert').count(), 0, await page.getByRole('alert').allTextContents());
  await page.getByText('Your ChatGPT account is connected.').waitFor();
  assert.equal(replies.at(-1).status, 200);
  assert.deepEqual(events, ['keepAliveStart', 'reply', 'foreground', 'token', 'keepAliveStop']);
  assert.equal(authorizations[0].searchParams.get('client_id'), 'dynamic_agent_client');
  for (const retry of authorizations.slice(1)) {
    assert.equal(retry.searchParams.get('client_id'), clientId);
    assert.equal(retry.searchParams.get('agent_name_hint'), null);
    assert.equal(retry.searchParams.get('ext_agent_host_id'), authorizations[0].searchParams.get('ext_agent_host_id'));
  }
  assert.equal(files.has('signin.json'), false);
  assert.equal(files.has('registration.json'), false);
  assert.ok(files.has('account.enc'));
  assert.doesNotMatch(
    Buffer.from(files.get('account.enc'), 'base64').toString('utf8'),
    /synthetic-access|synthetic-refresh/,
  );
  const literatureProject = await page.evaluate(async () => {
    const api = window.research;
    const { project } = await api.createProject({ title: 'Packaged review fixture', topic: 'Portion sizes' });
    await api.saveProject({ ...project, notes: 'PRIVATE PROJECT NOTES' });
    await api.saveSettings({ ...(await api.getSettings()), model: 'fixture-model' });
    const source = {
      id: '23c8ae56-e136-4357-9f29-278f941031ee',
      title: 'Dining hall pilot',
      authors: ['Fixture Author'],
      year: '2025',
      url: 'https://example.org/selected-paper',
      doi: '',
      category: 'article',
      inspected: 'abstract',
      retrievedAt: new Date().toISOString(),
      query: '',
      abstract: 'Smaller portions were associated with less plate waste in one dining hall.',
      method: '',
      findings: '',
      limitations: '',
      notes: '',
    };
    await api.saveSource(project.id, source);
    await api.saveSource(project.id, {
      ...source,
      id: 'a2b5c607-3f37-4559-8112-63c6d018fd88',
      url: 'https://example.org/unselected-paper',
      abstract: 'UNSELECTED EVIDENCE MUST STAY LOCAL',
    });
    const run = await api.run({
      projectId: project.id,
      role: 'literature',
      text: 'Compare themes',
      sourceIds: [source.id],
    });
    if (run.status !== 'completed') throw new Error(run.error || 'The packaged review failed');
    if ((await api.getProject(project.id)).project.notes !== 'PRIVATE PROJECT NOTES')
      throw new Error('A review altered notes without acceptance');
    return { projectId: project.id, runId: run.id };
  });
  await page.evaluate(() => window.__emitNative('pause', {}));
  // The real Android database batches private-file writes; wait for the lifecycle flush.
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => typeof window.research?.getProject === 'function');
  const restoredReview = await page.evaluate(async id => window.research.getProject(id), literatureProject.projectId);
  assert.equal(restoredReview.runs[0].id, literatureProject.runId);
  assert.equal(restoredReview.runs[0].result.kind, 'literature');
  assert.equal(restoredReview.runs[0].result.references[0].title, 'Dining hall pilot');
  assert.equal(restoredReview.project.notes, 'PRIVATE PROJECT NOTES');
  await page.getByRole('button', { name: 'Account and preferences', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Account & preferences' })
    .getByText('Fixture Researcher', { exact: true })
    .waitFor();
  assert.equal((await page.evaluate(() => window.research.account())).signedIn, true);
  assert.deepEqual(errors, []);
  console.log(
    `Packaged Android OAuth and cited literature review passed${legacyUuid ? ' without AbortSignal.any, AbortSignal.timeout or crypto.randomUUID' : legacyTimeout ? ' without AbortSignal.timeout' : legacyAbort ? ' without AbortSignal.any' : ''}${missingInfo ? ' with optional native information unavailable' : ''}: safe visible failures, token exchange only after returning to the app, safe native DNS code, WebView version, restart recovery, retained issued registration, PKCE, RSA verification, encrypted persistence, successful reconnect and streamed review with selected evidence and saved citations under production CSP. Native and OpenAI services were synthetic.`,
  );
} catch (error) {
  console.error('Packaged auth fixture failure:', {
    mode,
    tokenRequests,
    replyStatuses: replies.map(reply => reply.status),
    events,
    visibleErrors: await page
      ?.getByRole('alert')
      .allTextContents()
      .catch(() => []),
  });
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
