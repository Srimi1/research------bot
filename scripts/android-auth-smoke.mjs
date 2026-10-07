// Run the shipped Android backend, native adapters and WebCrypto/JWT checks under its production CSP.
// Native services and OpenAI responses are synthetic; no real account, browser consent or tokens are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { chromium } from 'playwright';

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
let mode = 'response';
let authorization;
let idToken;
let page;
let browser;

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
    if (method === 'loopbackRespond') {
      replies.push(options);
      return {};
    }
    if (method === 'appInfo') return { version: '0.3.6', versionCode: 306, sdk: 36, canInstall: false };
    if (method === 'openUrl') {
      authorization = new URL(options.url);
      assert.equal(authorization.origin + authorization.pathname, `${issuer}/api/accounts/authorize`);
      authorizations.push(authorization);
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
      if (options.url === `${issuer}/api/accounts/oauth/token`) {
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
      else if (options.url === 'https://api.github.com/repos/Srimi1/research------bot/releases/latest')
        data = { tag_name: 'v0.3.6', draft: false, prerelease: false, assets: [] };
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
  await context.addInitScript(() => {
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
        return window.__nativePromise(plugin, method, options);
      },
      nativeCallback(_plugin, _method, { eventName }, callback) {
        const id = String(++counter);
        listeners.set(id, { eventName, callback });
        return id;
      },
    };
  });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5182');
  await page.waitForFunction(() => typeof window.research?.account === 'function');
  await page.evaluate(async () =>
    window.research.saveSettings({ ...(await window.research.getSettings()), autoUpdate: false }),
  );
  await page.locator('.topbar-signin').click();
  for (const [failureMode, code] of [
    ['response', 'RESPONSE'],
    ['nonce', 'IDENTITY-NONCE'],
    ['storage', 'STORAGE'],
  ]) {
    mode = failureMode;
    if (failureMode !== 'response')
      await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
    const alert = page.getByRole('alert');
    await alert.filter({ hasText: `RB-AUTH-${code}` }).waitFor();
    const box = await alert.boundingBox();
    assert.ok(
      box.y >= 0 && box.y + box.height < 892,
      'The complete sign-in error must be visible on a phone without scrolling',
    );
    assert.equal(replies.at(-1).status, 400);
    assert.equal(replies.at(-1).returnToApp, true);
    assert.match(replies.at(-1).body, new RegExp(`RB-AUTH-${code}`));
    assert.doesNotMatch(replies.at(-1).body, /synthetic-access|synthetic-refresh|private upstream|Private credential/);
    assert.equal((await page.evaluate(() => window.research.account())).signedIn, false);
    assert.equal(files.has('account.enc'), false);
    if (failureMode === 'response') {
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.reload();
      await page.getByRole('button', { name: 'Account and preferences', exact: true }).click();
      await page.locator('.callout').filter({ hasText: 'RB-AUTH-RESPONSE' }).waitFor();
    }
  }
  mode = 'success';
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  await Promise.race([
    page.getByText('Your ChatGPT account is connected.').waitFor(),
    page.getByRole('alert').waitFor(),
  ]);
  assert.equal(await page.getByRole('alert').count(), 0, await page.getByRole('alert').allTextContents());
  await page.getByText('Your ChatGPT account is connected.').waitFor();
  assert.equal(replies.at(-1).status, 200);
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
  await page.reload();
  await page.getByRole('button', { name: 'Account and preferences', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Account & preferences' })
    .getByText('Fixture Researcher', { exact: true })
    .waitFor();
  assert.equal((await page.evaluate(() => window.research.account())).signedIn, true);
  assert.deepEqual(errors, []);
  console.log(
    'Packaged Android OAuth passed: safe visible failures, restart recovery, retained issued registration, PKCE, RSA verification, encrypted persistence and successful reconnect under production CSP. Native and OpenAI services were synthetic.',
  );
} catch (error) {
  console.error('Packaged auth fixture failure:', {
    mode,
    replyStatuses: replies.map(reply => reply.status),
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
