import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { get } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { AuthService, directoryFiles, nodeLoopback } from '../electron/auth';
import { AuthService as CoreAuthService } from '../core/auth';
import { fetchNetwork } from '../electron/network';
import { createNativeLoopback } from '../src/android/adapters';
import type { CallbackRequest, LoopbackServer } from '../core/platform';
import type { ResearchNativePlugin } from '../src/android/native';

const issuer = 'https://auth.openai.com';
const clientId = 'oaiapp_research_test';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const metadata = {
  issuer,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
  revocation_endpoint: `${issuer}/api/accounts/oauth/revoke`,
};
function callback(url: URL): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode!, body }));
    }).on('error', reject);
  });
}
async function fixture(deferredResponse = false) {
  const directory = await mkdtemp(join(tmpdir(), 'research-bot-auth-'));
  const original = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const pool = agent.get(issuer);
  const api = agent.get('https://api.openai.com');
  const keys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256' };
  pool.intercept({ path: '/.well-known/openid-configuration' }).reply(200, metadata).persist();
  let jwksCalls = 0;
  pool
    .intercept({ path: '/.well-known/jwks.json' })
    .reply(() => {
      jwksCalls++;
      return { statusCode: 200, data: { keys: [jwk] } };
    })
    .persist();
  const encryptionKey = randomBytes(32);
  const credentialStore = {
    available: () => true,
    encrypt(value: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decrypt(value: Buffer) {
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  const state = {
    subject: 'subject-1',
    nonceOverride: undefined as string | undefined,
    audience: clientId,
    scope: scopes,
    expiresIn: 3600,
    kid: 'test-key',
    omitClient: false,
    wrongStateFirst: false,
    invalidGrant: false,
    invalidGrantOnce: false,
    callbackCode: 'issued-code',
    tokenError: undefined as string | undefined,
  };
  const authorizations: URL[] = [];
  const exchanges: URLSearchParams[] = [];
  let callbackReply: Promise<{ status: number; body: string }> | undefined;
  const responseOrder: string[] = [];
  const returnToApps: boolean[] = [];
  const openBrowser = async (url: string) => {
    const authorize = new URL(url);
    authorizations.push(authorize);
    const jwt = await new SignJWT({
      nonce: state.nonceOverride ?? authorize.searchParams.get('nonce'),
      email: 'researcher@example.com',
      name: 'Researcher',
    })
      .setProtectedHeader({ alg: 'RS256', kid: state.kid })
      .setIssuer(issuer)
      .setAudience(state.audience)
      .setSubject(state.subject)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey);
    pool.intercept({ path: '/api/accounts/oauth/token', method: 'POST' }).reply(options => {
      const form = new URLSearchParams(String(options.body));
      exchanges.push(form);
      const invalidGrant = state.invalidGrant || state.invalidGrantOnce;
      state.invalidGrantOnce = false;
      return state.tokenError
        ? {
            statusCode: 403,
            data: JSON.stringify({
              error: state.tokenError,
              error_description: 'access-secret refresh-secret private URL',
            }),
          }
        : invalidGrant
          ? { statusCode: 400, data: JSON.stringify({ error: 'invalid_grant' }) }
          : {
              statusCode: 200,
              data: JSON.stringify({
                access_token: 'access-secret',
                refresh_token: 'refresh-secret',
                id_token: jwt,
                token_type: 'Bearer',
                expires_in: state.expiresIn,
                scope: state.scope,
              }),
            };
    });
    const returning = authorize.searchParams.get('client_id') !== 'dynamic_agent_client';
    const redirect = new URL(authorize.searchParams.get('redirect_uri')!);
    redirect.search = new URLSearchParams({
      code: state.callbackCode,
      state: authorize.searchParams.get('state')!,
      ...(!state.omitClient && !returning ? { client_id: clientId } : {}),
    }).toString();
    if (state.wrongStateFirst) {
      const invalid = new URL(redirect);
      invalid.searchParams.set('state', 'incorrect');
      assert.equal((await callback(invalid)).status, 400);
    }
    if (deferredResponse) {
      callbackReply = callback(redirect);
      void callbackReply.catch(() => undefined);
    } else await callback(redirect);
  };
  const auth = deferredResponse
    ? new CoreAuthService({
        fetch: fetchNetwork,
        files: directoryFiles(directory),
        openBrowser,
        credentials: credentialStore,
        startLoopback: (() => {
          let listener: Parameters<ResearchNativePlugin['addListener']>[1];
          let server: LoopbackServer;
          const requests = new Map<string, CallbackRequest>();
          return createNativeLoopback({
            async addListener(_event, callback) {
              listener = callback;
              return { remove: async () => {} };
            },
            async loopbackStart() {
              server = await nodeLoopback(request => {
                const requestId = crypto.randomUUID();
                requests.set(requestId, request);
                listener({ serverId: 'native-test', requestId, method: request.method, url: request.url });
              });
              return { serverId: 'native-test', port: server.port };
            },
            async loopbackRespond({ requestId, status, body, returnToApp }) {
              // Native acknowledgements arrive after the worker has written the browser reply.
              await new Promise(resolve => setTimeout(resolve, 20));
              responseOrder.push('respond');
              returnToApps.push(Boolean(returnToApp));
              requests.get(requestId)!.respond(status, body);
              requests.delete(requestId);
            },
            async loopbackClose() {
              responseOrder.push('close');
              server.close();
            },
          });
        })(),
      })
    : new AuthService(directory, openBrowser, credentialStore);
  return {
    auth,
    agent,
    pool,
    api,
    state,
    directory,
    credentialStore,
    authorizations,
    exchanges,
    responseOrder,
    returnToApps,
    openBrowser,
    get callbackReply() {
      return callbackReply;
    },
    get jwksCalls() {
      return jwksCalls;
    },
    async close() {
      auth.cancelSignIn();
      setGlobalDispatcher(original);
      await agent.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('asynchronous native callback replies finish before the sign-in server closes', async () => {
  for (const declined of [false, true]) {
    const f = await fixture(true);
    try {
      if (declined) f.state.nonceOverride = 'invalid-nonce';
      if (declined) await assert.rejects(f.auth.signIn(), /identity verification failed/);
      else assert.equal((await f.auth.signIn()).signedIn, true);
      assert.deepEqual(f.responseOrder, ['respond', 'close']);
      assert.deepEqual(f.returnToApps, [true]);
      const reply = await f.callbackReply!;
      assert.equal(reply.status, declined ? 400 : 200);
      assert.match(reply.body, declined ? /sign-in did not complete/ : /ChatGPT is connected/);
    } finally {
      await f.close();
    }
  }
});

test('dynamic registration uses PKCE, exact loopback URI and verified identity; credentials stay encrypted', async () => {
  const f = await fixture();
  try {
    f.state.wrongStateFirst = true;
    const account = await f.auth.signIn();
    assert.equal(account.signedIn, true);
    assert.equal(account.email, 'researcher@example.com');
    const authorize = f.authorizations[0];
    const form = f.exchanges[0];
    assert.equal(authorize.origin + authorize.pathname, `${issuer}/api/accounts/authorize`);
    assert.equal(authorize.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(authorize.searchParams.get('agent_name_hint'), 'Research Bot');
    assert.equal(new URL(form.get('redirect_uri')!).hostname, '127.0.0.1');
    assert.equal(new URL(form.get('redirect_uri')!).pathname, '/auth/callback');
    assert.equal(form.get('redirect_uri'), authorize.searchParams.get('redirect_uri'));
    assert.equal(form.get('client_id'), clientId);
    assert.equal(form.get('resource'), 'https://api.openai.com/v1');
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(
      createHash('sha256').update(form.get('code_verifier')!).digest('base64url'),
      authorize.searchParams.get('code_challenge'),
    );
    const encrypted = await readFile(join(f.directory, 'account.enc'));
    assert.ok(!encrypted.includes(Buffer.from('access-secret')));
    assert.ok(!encrypted.includes(Buffer.from('refresh-secret')));
    const reloaded = new AuthService(f.directory, async () => {}, f.credentialStore);
    assert.equal((await reloaded.account()).signedIn, true);
    await f.auth.signIn();
    assert.equal(f.authorizations[1].searchParams.get('client_id'), clientId);
    assert.equal(f.authorizations[1].searchParams.get('agent_name_hint'), null);
    assert.ok(f.authorizations[1].searchParams.get('id_token_hint'));
    assert.equal(
      f.authorizations[1].searchParams.get('ext_agent_host_id'),
      authorize.searchParams.get('ext_agent_host_id'),
    );
    assert.equal(f.jwksCalls, 1);
  } finally {
    await f.close();
  }
});

test('a failed identity check survives restart without tokens and reuses the issued registration', async () => {
  const f = await fixture();
  try {
    f.state.nonceOverride = 'wrong-nonce';
    await assert.rejects(f.auth.signIn(), /RB-AUTH-IDENTITY-NONCE/);
    assert.equal((await f.auth.account()).signedIn, false);
    const restored = new AuthService(f.directory, f.openBrowser, f.credentialStore);
    assert.match((await restored.account()).message!, /RB-AUTH-IDENTITY-NONCE/);
    assert.equal((await restored.account()).signedIn, false);
    assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'signin.json'), 'utf8')), {
      reason: 'identity_nonce',
    });
    assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'registration.json'), 'utf8')), { clientId });
    await assert.rejects(readFile(join(f.directory, 'account.enc')), { code: 'ENOENT' });
    f.state.nonceOverride = undefined;
    assert.equal((await restored.signIn()).signedIn, true);
    assert.equal(f.authorizations[1].searchParams.get('client_id'), clientId);
    assert.equal(f.authorizations[1].searchParams.get('agent_name_hint'), null);
    assert.equal(
      f.authorizations[1].searchParams.get('ext_agent_host_id'),
      f.authorizations[0].searchParams.get('ext_agent_host_id'),
    );
    assert.equal((await restored.account()).message, undefined);
    await assert.rejects(readFile(join(f.directory, 'signin.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(f.directory, 'registration.json')), { code: 'ENOENT' });
  } finally {
    await f.close();
  }
});

test('callback and saved sign-in diagnostics never expose unknown OAuth errors or credentials', async () => {
  const f = await fixture(true);
  try {
    f.state.tokenError = 'access-secret refresh-secret private URL';
    await assert.rejects(f.auth.signIn(), /RB-AUTH-REJECTED/);
    const reply = await f.callbackReply!;
    assert.equal(reply.status, 400);
    assert.match(reply.body, /HTTP 403/);
    assert.match(reply.body, /RB-AUTH-REJECTED/);
    const saved = await readFile(join(f.directory, 'signin.json'), 'utf8');
    for (const value of [reply.body, saved, (await f.auth.account()).message!]) {
      assert.doesNotMatch(value, /access-secret|refresh-secret|private URL/);
    }
    assert.deepEqual(JSON.parse(saved), { reason: 'rejected', status: 403 });
  } finally {
    await f.close();
  }
});

test('an untrusted callback cannot return the user to the app, but the verified outcome can', async () => {
  const f = await fixture(true);
  try {
    f.state.wrongStateFirst = true;
    assert.equal((await f.auth.signIn()).signedIn, true);
    assert.deepEqual(f.returnToApps, [false, true]);
  } finally {
    await f.close();
  }
});

test('missing issued client ID is rejected before code exchange', async () => {
  const f = await fixture();
  try {
    f.state.omitClient = true;
    await assert.rejects(f.auth.signIn(), /unexpected client registration/);
    assert.equal(f.exchanges.length, 0);
    assert.equal((await f.auth.account()).signedIn, false);
  } finally {
    await f.close();
  }
});

test('ID-token nonce and audience must match the pending authorization', async () => {
  for (const condition of ['nonce', 'audience']) {
    const f = await fixture();
    try {
      if (condition === 'nonce') f.state.nonceOverride = 'wrong-nonce';
      else f.state.audience = 'another-client';
      await assert.rejects(f.auth.signIn(), /identity verification failed/);
      assert.equal((await f.auth.account()).signedIn, false);
      await assert.rejects(readFile(join(f.directory, 'account.enc')), { code: 'ENOENT' });
    } finally {
      await f.close();
    }
  }
});

test('an unknown JWT signing key triggers only one JWKS refetch', async () => {
  const f = await fixture();
  try {
    f.state.kid = 'unknown-key';
    await assert.rejects(f.auth.signIn(), /identity verification failed/);
    assert.equal(f.jwksCalls, 2);
  } finally {
    await f.close();
  }
});

test('returning sign-in cannot replace the saved subject with a different account', async () => {
  const f = await fixture();
  try {
    await f.auth.signIn();
    f.state.subject = 'different-subject';
    await assert.rejects(f.auth.signIn(), /does not match/);
    assert.equal((await f.auth.account()).signedIn, true);
  } finally {
    await f.close();
  }
});

test('after sign-out a different ChatGPT account can sign in, and the new account is pinned again', async () => {
  const f = await fixture();
  try {
    await f.auth.signIn();
    f.pool.intercept({ path: '/api/accounts/oauth/revoke', method: 'POST' }).reply(200, '');
    await f.auth.signOut();
    f.state.subject = 'different-subject';
    assert.equal((await f.auth.signIn()).signedIn, true);
    assert.equal(f.authorizations[1].searchParams.get('login_hint'), null);
    assert.equal(f.authorizations[1].searchParams.get('client_id'), clientId);
    const saved = JSON.parse(f.credentialStore.decrypt(await readFile(join(f.directory, 'account.enc'))));
    assert.equal(saved.subject, 'different-subject');
    f.state.subject = 'subject-1';
    await assert.rejects(f.auth.signIn(), /does not match/);
    assert.equal((await f.auth.account()).signedIn, true);
  } finally {
    await f.close();
  }
});

test('granted token scopes determine plan permission; callback scope cannot authorize inference', async () => {
  const f = await fixture();
  try {
    f.state.scope = 'openid profile email';
    const account = await f.auth.signIn();
    assert.match(account.message!, /plan usage is not authorized/);
    await assert.rejects(f.auth.models(), /not authorized/);
  } finally {
    await f.close();
  }
});

test('near-expiry refreshes serialize, store the rotating refresh token, and preserve listed model order', async () => {
  const f = await fixture();
  try {
    f.state.expiresIn = 10;
    await f.auth.signIn();
    let refreshes = 0;
    f.pool.intercept({ path: '/api/accounts/oauth/token', method: 'POST' }).reply(options => {
      refreshes++;
      const form = new URLSearchParams(String(options.body));
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('client_id'), clientId);
      assert.equal(form.get('refresh_token'), 'refresh-secret');
      assert.equal(form.has('scope'), false);
      return {
        statusCode: 200,
        data: {
          access_token: 'access-rotated',
          refresh_token: 'refresh-rotated',
          token_type: 'Bearer',
          expires_in: 3600,
        },
      };
    });
    f.api
      .intercept({ path: '/v1/models', headers: { authorization: 'Bearer access-rotated' } })
      .reply(200, {
        models: [
          { slug: 'model-b', visibility: 'list' },
          { slug: 'internal', visibility: 'hide' },
          { slug: 'model-a', visibility: 'list' },
        ],
      })
      .persist();
    const [first, second] = await Promise.all([f.auth.models(), f.auth.models()]);
    assert.deepEqual(first, ['model-b', 'model-a']);
    assert.deepEqual(second, first);
    assert.equal(refreshes, 1);
    const saved = JSON.parse(f.credentialStore.decrypt(await readFile(join(f.directory, 'account.enc'))));
    assert.equal(saved.refreshToken, 'refresh-rotated');
  } finally {
    await f.close();
  }
});

test('invalid_grant clears unusable tokens and retains the account registration', async () => {
  const f = await fixture();
  try {
    f.state.expiresIn = 10;
    await f.auth.signIn();
    f.pool
      .intercept({ path: '/api/accounts/oauth/token', method: 'POST' })
      .reply(400, { error: 'invalid_grant', error_description: 'sensitive diagnostics omitted' });
    await assert.rejects(f.auth.models(), /expired or was revoked/);
    assert.equal((await f.auth.account()).signedIn, false);
    const saved = JSON.parse(f.credentialStore.decrypt(await readFile(join(f.directory, 'account.enc'))));
    assert.equal(saved.clientId, clientId);
    assert.equal(saved.refreshToken, undefined);
    assert.equal(saved.accessToken, undefined);
  } finally {
    await f.close();
  }
});

test('Responses uses supported HTTP fields, streams deltas, and succeeds only after response.completed', async () => {
  const f = await fixture();
  try {
    await f.auth.signIn();
    let payload: Record<string, unknown> = {};
    const events =
      'data: {"type":"response.output_text.delta","delta":"Hello "}\r\n\r\ndata: {"type":"response.output_text.delta","delta":"world"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":4}}}\n\n';
    f.api
      .intercept({ path: '/v1/responses', method: 'POST', headers: { authorization: 'Bearer access-secret' } })
      .reply(options => {
        payload = JSON.parse(String(options.body));
        return { statusCode: 200, data: events, responseOptions: { headers: { 'content-type': 'text/event-stream' } } };
      });
    const deltas: string[] = [];
    const result = await f.auth.stream(
      'model-a',
      'Correct grammar only.',
      'Hello world',
      new AbortController().signal,
      delta => deltas.push(delta),
    );
    assert.deepEqual(deltas, ['Hello ', 'world']);
    assert.deepEqual(result, { text: 'Hello world', usage: { input: 12, output: 4 } });
    assert.deepEqual(payload, {
      model: 'model-a',
      instructions: 'Correct grammar only.',
      input: [{ role: 'user', content: 'Hello world' }],
      store: false,
      stream: true,
    });
    f.api
      .intercept({ path: '/v1/responses', method: 'POST' })
      .reply(200, 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n');
    await assert.rejects(
      f.auth.stream('model-a', '', 'input', new AbortController().signal, () => {}),
      /before completion/,
    );
    f.api
      .intercept({ path: '/v1/responses', method: 'POST' })
      .reply(
        200,
        'data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n',
      );
    await assert.rejects(
      f.auth.stream('model-a', '', 'input', new AbortController().signal, () => {}),
      /usage allowance/,
    );
    f.api
      .intercept({ path: '/v1/responses', method: 'POST' })
      .reply(200, 'data: {"type":"response.output_text.delta","delta":"par\n\n');
    await assert.rejects(
      f.auth.stream('model-a', '', 'input', new AbortController().signal, () => {}),
      error => {
        assert.match((error as Error).message, /unreadable response stream/);
        assert.doesNotMatch((error as Error).message, /JSON|Unexpected/);
        return true;
      },
    );
  } finally {
    await f.close();
  }
});

test('sign-out revokes the renewable session and clears tokens; returning registration remains stable', async () => {
  const f = await fixture();
  try {
    await f.auth.signIn();
    let revokeForm: URLSearchParams | undefined;
    f.pool.intercept({ path: '/api/accounts/oauth/revoke', method: 'POST' }).reply(options => {
      revokeForm = new URLSearchParams(String(options.body));
      return { statusCode: 200, data: '' };
    });
    await f.auth.signOut();
    assert.equal((await f.auth.account()).signedIn, false);
    assert.equal(revokeForm!.get('token'), 'refresh-secret');
    assert.equal(revokeForm!.get('token_type_hint'), 'refresh_token');
    assert.equal(revokeForm!.get('client_id'), clientId);
    await f.auth.signIn();
    assert.equal(f.authorizations[1].searchParams.get('client_id'), clientId);
    assert.equal(f.authorizations[1].searchParams.get('id_token_hint'), null);
  } finally {
    await f.close();
  }
});

test('failed remote revocation retries, signs out locally, and explains the remaining remote session', async () => {
  const f = await fixture();
  try {
    await f.auth.signIn();
    f.pool.intercept({ path: '/api/accounts/oauth/revoke', method: 'POST' }).reply(503, '').times(3);
    await f.auth.signOut();
    const account = await f.auth.account();
    assert.equal(account.signedIn, false);
    assert.match(account.message!, /revocation was not confirmed/);
    f.agent.assertNoPendingInterceptors();
  } finally {
    await f.close();
  }
});

test('cancellation closes the local listener and never stores credentials', async () => {
  const f = await fixture();
  try {
    let opened!: (url: string) => void;
    const browserOpened = new Promise<string>(resolve => {
      opened = resolve;
    });
    const auth = new AuthService(
      f.directory,
      async url => {
        opened(url);
      },
      f.credentialStore,
    );
    const pending = auth.signIn();
    const authorize = new URL(await browserOpened);
    auth.cancelSignIn();
    await assert.rejects(pending, /cancelled/);
    await assert.rejects(callback(new URL(authorize.searchParams.get('redirect_uri')!)));
    await assert.rejects(readFile(join(f.directory, 'account.enc')), { code: 'ENOENT' });
  } finally {
    await f.close();
  }
});

test('sign-in fails closed when secure OS credential storage is unavailable', async () => {
  const f = await fixture();
  try {
    const auth = new AuthService(
      f.directory,
      async () => {
        throw new Error('Browser must not open');
      },
      { ...f.credentialStore, available: () => false },
    );
    assert.equal((await auth.account()).storageAvailable, false);
    await assert.rejects(auth.signIn(), /OS keychain/);
  } finally {
    await f.close();
  }
});

test('concurrent sign-in calls reserve one attempt before asynchronous initialization', async () => {
  const f = await fixture();
  try {
    let opened!: (url: string) => void;
    const browserOpened = new Promise<string>(resolve => {
      opened = resolve;
    });
    const auth = new AuthService(
      f.directory,
      async url => {
        opened(url);
      },
      f.credentialStore,
    );
    const first = auth.signIn();
    await assert.rejects(auth.signIn(), /already in progress/);
    await browserOpened;
    auth.cancelSignIn();
    await assert.rejects(first, /cancelled/);
    assert.equal((await auth.account()).signedIn, false);
  } finally {
    await f.close();
  }
});

test('invalid authorization code starts one fresh attempt with the already-issued client', async () => {
  const f = await fixture();
  try {
    f.state.invalidGrantOnce = true;
    assert.equal((await f.auth.signIn()).signedIn, true);
    assert.equal(f.authorizations.length, 2);
    assert.equal(f.authorizations[0].searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(f.authorizations[1].searchParams.get('client_id'), clientId);
    assert.equal(f.authorizations[1].searchParams.get('agent_name_hint'), null);
    assert.notEqual(f.authorizations[1].searchParams.get('state'), f.authorizations[0].searchParams.get('state'));
    assert.notEqual(f.exchanges[1].get('code_verifier'), f.exchanges[0].get('code_verifier'));
  } finally {
    await f.close();
  }
});

test('sign-out aborts an in-flight refresh and old credentials cannot reappear', async () => {
  const f = await fixture();
  try {
    f.state.expiresIn = 10;
    await f.auth.signIn();
    let started!: () => void;
    const refreshStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    f.pool
      .intercept({ path: '/api/accounts/oauth/token', method: 'POST' })
      .reply(() => {
        started();
        return {
          statusCode: 200,
          data: {
            access_token: 'stale-access',
            refresh_token: 'stale-refresh',
            token_type: 'Bearer',
            expires_in: 3600,
          },
        };
      })
      .delay(100);
    f.pool.intercept({ path: '/api/accounts/oauth/revoke', method: 'POST' }).reply(200, '');
    const pending = f.auth.models();
    const rejected = assert.rejects(pending);
    await refreshStarted;
    await f.auth.signOut();
    await rejected;
    assert.equal((await f.auth.account()).signedIn, false);
    const restored = new AuthService(f.directory, async () => {}, f.credentialStore);
    assert.equal((await restored.account()).signedIn, false);
    const saved = JSON.parse(f.credentialStore.decrypt(await readFile(join(f.directory, 'account.enc'))));
    assert.equal(saved.refreshToken, undefined);
  } finally {
    await f.close();
  }
});

test('system-browser errors cannot disclose the retained ID token through the renderer', async () => {
  const f = await fixture();
  try {
    await f.auth.signIn();
    const auth = new AuthService(
      f.directory,
      async url => {
        throw new Error(`Failed to open ${url}`);
      },
      f.credentialStore,
    );
    await assert.rejects(auth.signIn(), error => {
      assert.match((error as Error).message, /system browser could not open/);
      assert.equal((error as Error).message.includes('id_token_hint'), false);
      return true;
    });
  } finally {
    await f.close();
  }
});
