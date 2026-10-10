import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Store, ConcurrentEditError } from '../core/store';
import {
  base64url,
  constantEqual,
  combineSignals,
  randomSecret,
  randomId,
  readLimited,
  sha256Base64url,
  timeoutSignal,
  type FileStore,
} from '../core/platform';
import { createNativeFetch } from '../src/android/adapters';
import { NetworkFailure } from '../core/network-errors';
import { safeAuthFailure } from '../core/auth-errors';
import { readDeviceInfo } from '../src/android/device';
import { createConnectionCheck } from '../src/android/diagnostics';
import { version } from '../package.json';
import { PersistentDatabase, RETRY_DELAY_MS, SAVE_DELAY_MS } from '../src/android/database';
import { checksumFor, newer } from '../src/android/releases';
import type { Run, Source } from '../src/shared/types';

function memoryFiles() {
  const files = new Map<string, Uint8Array>();
  let writes = 0;
  const store: FileStore = {
    read: async name => files.get(name),
    write: async (name, data) => {
      writes++;
      files.set(name, new Uint8Array(data));
    },
    remove: async name => void files.delete(name),
  };
  return { store, files, writes: () => writes };
}

const source = (overrides: Partial<Source> = {}): Source => ({
  id: randomUUID(),
  title: 'A publisher-deposited article',
  authors: ['A. Researcher'],
  year: '2025',
  url: 'https://doi.org/10.1234/article',
  doi: '10.1234/article',
  category: 'article',
  inspected: 'metadata',
  retrievedAt: '2026-10-05T00:00:00.000Z',
  abstract: '',
  query: 'sustainability',
  method: '',
  findings: '',
  limitations: '',
  notes: '',
  ...overrides,
});

test('the Android store keeps projects, sources, plans, runs and settings across an app restart', async () => {
  const disk = memoryFiles();
  const db = await PersistentDatabase.open(disk.store);
  const store = new Store(db);
  const project = store.createProject({ title: 'Food waste', topic: 'Campus dining' }).project;
  const saved = store.saveProject({ ...project, notes: 'First thoughts', question: 'How much food is wasted?' });
  store.saveSource(project.id, source({ notes: 'Read before citing' }));
  store.saveSteps(project.id, [
    { id: 's1', title: 'Scope', purpose: 'p', output: 'o', dependsOn: '', check: 'c', done: false },
  ]);
  const run: Run = {
    id: randomUUID(),
    projectId: project.id,
    role: 'brainstorm',
    status: 'running',
    model: 'model',
    input: 'ideas',
    createdAt: '2026-10-05T00:00:00.000Z',
  };
  store.saveRun(run);
  store.saveSettings({ model: 'model', maxRequests: 7, autoUpdate: false });
  await db.flush();
  const snapshot = store.getProject(project.id);
  db.close();

  const reopened = new Store(await PersistentDatabase.open(disk.store));
  assert.deepEqual(reopened.getProject(project.id).project, snapshot.project);
  assert.deepEqual(reopened.getProject(project.id).sources, snapshot.sources);
  assert.deepEqual(reopened.getProject(project.id).steps, snapshot.steps);
  assert.deepEqual(reopened.getSettings(), { model: 'model', maxRequests: 7, autoUpdate: false });
  // json_extract must exist in the WebAssembly build for crash recovery.
  assert.equal(reopened.failInterruptedRuns(), 1);
  assert.equal(reopened.getProject(project.id).runs[0].status, 'failed');
  assert.throws(() => reopened.saveProject({ ...saved, version: saved.version - 1 }), ConcurrentEditError);
});

test('undo, redo, duplicate sources and cascading deletes behave as on desktop after a save to disk', async () => {
  const disk = memoryFiles();
  const db = await PersistentDatabase.open(disk.store);
  const store = new Store(db);
  let project = store.createProject({ title: 'A', topic: '' }).project;
  project = store.saveProject({ ...project, notes: 'one' });
  project = store.saveProject({ ...project, notes: 'two' });
  // Saving exports the database, which reopens the connection; foreign keys must stay on.
  await db.flush();
  assert.equal(store.undoNotes(project.id).notes, 'one');
  assert.equal(store.redoNotes(project.id).notes, 'two');
  const first = store.saveSource(project.id, source({ findings: 'kept' }));
  const duplicate = store.saveSource(project.id, source({ url: 'https://doi.org/10.1234/ARTICLE' }));
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.findings, 'kept');
  await db.flush();
  store.deleteProject(project.id);
  await db.flush();
  const reopened = new Store(await PersistentDatabase.open(disk.store));
  assert.equal(reopened.listProjects().length, 0);
  const orphans = (await PersistentDatabase.open(disk.store)).prepare('SELECT COUNT(*) AS n FROM sources').get();
  assert.equal(orphans?.n, 0);
});

test('Android saves are batched and skipped when nothing changed', async () => {
  const disk = memoryFiles();
  const db = await PersistentDatabase.open(disk.store);
  const store = new Store(db);
  await db.flush();
  const afterMigration = disk.writes();
  store.listProjects();
  store.getSettings();
  await db.flush();
  assert.equal(disk.writes(), afterMigration);
  store.createProject({ title: 'B', topic: '' });
  store.createProject({ title: 'C', topic: '' });
  await Promise.all([db.flush(), db.flush()]);
  assert.equal(disk.writes(), afterMigration + 1);
});

test('a failed write keeps the changes pending for the next save', async () => {
  const disk = memoryFiles();
  let fail = true;
  const flaky: FileStore = {
    ...disk.store,
    write: async (name, data) => {
      if (fail) throw new Error('disk full');
      await disk.store.write(name, data);
    },
  };
  const db = await PersistentDatabase.open(flaky);
  new Store(db).createProject({ title: 'Kept', topic: '' });
  await assert.rejects(db.flush(), /disk full/);
  fail = false;
  await db.flush();
  assert.equal(new Store(await PersistentDatabase.open(disk.store)).listProjects()[0].title, 'Kept');
});

test('PKCE and secret helpers give the same results as Node crypto without depending on it', async () => {
  for (const verifier of ['dBjftJeZ4CVP-mB92K9uhvdq7JYbsMPf5Yh4h7Q7jVA', randomSecret()])
    assert.equal(await sha256Base64url(verifier), createHash('sha256').update(verifier).digest('base64url'));
  assert.match(randomSecret(), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(base64url(new Uint8Array([251, 255, 191])), '-_-_');
  assert.equal(constantEqual('state', 'state'), true);
  assert.equal(constantEqual('state', 'stat'), false);
  assert.equal(constantEqual('état', 'etat'), false);
});

test('signal composition preserves cancellation before and after startup without AbortSignal.any', () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!;
  Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
  try {
    const first = new AbortController();
    const second = new AbortController();
    const combined = combineSignals([first.signal, second.signal, second.signal]);
    const reason = new Error('cancel this request');
    assert.equal(combined.aborted, false);
    second.abort(reason);
    assert.equal(combined.aborted, true);
    assert.equal(combined.reason, reason);
    first.abort(new Error('a later abort must not replace the first reason'));
    assert.equal(combined.reason, reason);
    assert.equal(combineSignals([first.signal, second.signal]).reason, first.signal.reason);
    assert.equal(combineSignals([]).aborted, false);
  } finally {
    Object.defineProperty(AbortSignal, 'any', original);
  }
});

test('secure UUIDs remain usable without the WebView UUID convenience API', () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const first = randomId();
    const second = randomId();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(second, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first, second);
  } finally {
    if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
    else delete (crypto as Partial<Crypto>).randomUUID;
  }
});

test('deadlines still abort with a timeout reason without AbortSignal.timeout', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!;
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
  try {
    const signal = timeoutSignal(1);
    assert.equal(signal.aborted, false);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason.name, 'TimeoutError');
    assert.throws(() => timeoutSignal(-1), RangeError);
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', descriptor);
  }
});

test('a failed optional Android query preserves the bundled version and safe WebView fallback', async () => {
  const device = await readDeviceInfo(async () => {
    throw new Error('private-token private-account private-platform-message');
  }, 'Chrome/102.0.5005.125 private-device-text');
  assert.equal(device.appVersion, version);
  assert.equal(device.webviewVersion, '102.0.5005.125');
  assert.doesNotMatch(JSON.stringify(device), /private-|token|account/);
  const invalid = await readDeviceInfo(
    async () => ({
      version: 'private-platform-message',
      versionCode: 307,
      sdk: 36,
      canInstall: false,
      webviewVersion: 'private-token',
    }),
    'Chrome/103.0.0.0',
  );
  assert.equal(invalid.webviewVersion, '103.0.0.0');
  assert.equal(invalid.nativeVersion, undefined);
});

test('an unanswered optional Android query does not block account results', { timeout: 1000 }, async () => {
  const device = await readDeviceInfo(() => new Promise(() => {}), '', 1);
  assert.equal(device.appVersion, version);
  assert.equal(device.webviewVersion, 'unavailable');
});

test('update versions and checksums are compared exactly', () => {
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.equal(newer('0.2.0', '0.2.0'), false);
  assert.equal(newer('0.1.9', '0.2.0'), false);
  const sums = `${'a'.repeat(64)}  research-bot-0.3.0-android.apk\n${'b'.repeat(64)} *other.apk\n`;
  assert.equal(checksumFor(sums, 'research-bot-0.3.0-android.apk'), 'a'.repeat(64));
  assert.equal(checksumFor(sums, 'other.apk'), 'b'.repeat(64));
  assert.equal(checksumFor(sums, 'missing.apk'), undefined);
});

test('response bodies are read with a size limit', async () => {
  assert.equal(await readLimited(new Response('hello'), 10), 'hello');
  await assert.rejects(readLimited(new Response('x'.repeat(20)), 10), /size limit/);
});

function fakeBridge(status: number, chunks: string[], headers: Record<string, string> = {}) {
  const calls: { open: any[]; closed: string[] } = { open: [], closed: [] };
  let index = 0;
  let release: (() => void) | undefined;
  const bridge = {
    calls,
    hold: false,
    async httpOpen(options: any) {
      calls.open.push(options);
      if (bridge.hold) await new Promise<void>(resolve => (release = resolve));
      if (calls.closed.includes(options.id)) throw new Error('Request cancelled.');
      return { status, statusText: '', headers };
    },
    async httpRead() {
      if (index >= chunks.length) return { done: true };
      return { done: false, data: Buffer.from(chunks[index++]).toString('base64') };
    },
    async httpClose({ id }: { id: string }) {
      calls.closed.push(id);
      release?.();
    },
  };
  return bridge;
}

test('native fetch streams the body, sends text and closes the connection when done', async () => {
  const bridge = fakeBridge(200, ['data: {"a"', ':1}\n\n'], { 'content-type': 'text/event-stream' });
  const fetch = createNativeFetch(bridge);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: '{"stream":true}',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(await response.text(), 'data: {"a":1}\n\n');
  const [open] = bridge.calls.open;
  assert.deepEqual(
    { method: open.method, body: open.body, follow: open.follow, auth: open.headers.authorization },
    { method: 'POST', body: '{"stream":true}', follow: false, auth: 'Bearer token' },
  );
  assert.deepEqual(bridge.calls.closed, [open.id]);
});

test('native fetch refuses redirects when asked and reports aborts as aborts', async () => {
  await assert.rejects(createNativeFetch(fakeBridge(302, []))('https://auth.openai.com/x', { redirect: 'error' }), {
    name: 'TypeError',
  });
  assert.equal((await createNativeFetch(fakeBridge(302, []))('https://github.com/x')).status, 302);
  const bridge = fakeBridge(200, ['never']);
  bridge.hold = true;
  const controller = new AbortController();
  const pending = createNativeFetch(bridge)('https://api.openai.com/v1/models', { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(
    createNativeFetch(fakeBridge(200, []))('https://x.test', { body: new Uint8Array([1]) as any }),
    /text request bodies/,
  );
});

test('native fetch rejects an unreadable status and closes the connection', async () => {
  const bridge = fakeBridge(-1, []);
  await assert.rejects(createNativeFetch(bridge)('https://api.openai.com/v1/models'), {
    name: 'TypeError',
    message: /invalid response/,
  });
  assert.deepEqual(bridge.calls.closed, [bridge.calls.open[0].id]);
});

test('serialized native connection failures retain safe diagnostic codes without private messages', async () => {
  for (const [code, suffix] of [
    ['RB_NET_DNS', 'DNS'],
    ['RB_NET_TLS', 'TLS'],
    ['RB_NET_TIMEOUT', 'TIMEOUT'],
    ['RB_NET_CONNECT', 'CONNECT'],
    ['private-code', 'NETWORK'],
  ]) {
    const fetch = createNativeFetch({
      async httpOpen() {
        throw { code, message: 'private-code authorization-secret private-url', data: 'private response' };
      },
      async httpRead() {
        throw new Error('No body should be read');
      },
      async httpClose() {},
    });
    await assert.rejects(fetch('https://auth.openai.com/api/accounts/oauth/token'), error => {
      assert.ok(error instanceof NetworkFailure);
      const safe = safeAuthFailure(error, 'exchange_network').message;
      assert.match(safe, new RegExp(`RB-AUTH-EXCHANGE-${suffix}`));
      assert.doesNotMatch(safe, /private-code|authorization-secret|private-url|private response/);
      return true;
    });
  }
});

test('native stream read failures preserve the fixed timeout reason without exposing response data', async () => {
  const bridge = fakeBridge(200, []);
  bridge.httpRead = async () => {
    throw { code: 'RB_NET_TIMEOUT', message: 'private response body' };
  };
  const response = await createNativeFetch(bridge)('https://auth.openai.com/api/accounts/oauth/token');
  await assert.rejects(response.text(), error => {
    assert.ok(error instanceof NetworkFailure);
    assert.equal(error.networkCode, 'timeout');
    assert.doesNotMatch(error.message, /private response body/);
    return true;
  });
});

test('native fetch rejects a late response after cancellation, including bodyless responses', async () => {
  for (const status of [200, 204]) {
    let resume!: (value: { status: number; statusText: string; headers: Record<string, string> }) => void;
    const closed: string[] = [];
    const bridge = {
      httpOpen: () => new Promise<Parameters<typeof resume>[0]>(resolve => (resume = resolve)),
      httpRead: async () => ({ done: true }),
      httpClose: async ({ id }: { id: string }) => void closed.push(id),
    };
    const controller = new AbortController();
    const pending = createNativeFetch(bridge)('https://example.org', { signal: controller.signal });
    controller.abort();
    // A bridge completion already queued on the native side can arrive after httpClose.
    resume({ status, statusText: '', headers: {} });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(closed.length > 0);
  }
});

test('native fetch discards a chunk that arrives after cancellation', async () => {
  let resume!: (value: { done: boolean; data: string }) => void;
  const bridge = {
    httpOpen: async () => ({ status: 200, statusText: '', headers: {} }),
    httpRead: () => new Promise<Parameters<typeof resume>[0]>(resolve => (resume = resolve)),
    httpClose: async () => {},
  };
  const controller = new AbortController();
  const response = await createNativeFetch(bridge)('https://example.org', { signal: controller.signal });
  const reader = response.body!.getReader();
  const pending = reader.read();
  controller.abort();
  resume({ done: false, data: Buffer.from('cancelled output').toString('base64') });
  await assert.rejects(pending, { name: 'AbortError' });
  reader.releaseLock();
});

test('Android saves happen after a pause in changes and retry after a failed write', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const disk = memoryFiles();
  let failures = 1;
  const warnings: string[] = [];
  const flaky: FileStore = {
    ...disk.store,
    write: async (name, data) => {
      if (failures-- > 0) throw new Error('disk full');
      await disk.store.write(name, data);
    },
  };
  const db = await PersistentDatabase.open(flaky, undefined, message => warnings.push(message));
  const store = new Store(db);
  store.createProject({ title: 'Kept', topic: '' });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(SAVE_DELAY_MS - 1);
  await settle();
  assert.equal(disk.writes(), 0);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(disk.writes(), 0);
  assert.match(warnings[0], /disk full/);
  t.mock.timers.tick(RETRY_DELAY_MS);
  await settle();
  assert.equal(disk.writes(), 1);
  db.close();
  assert.equal(new Store(await PersistentDatabase.open(disk.store)).listProjects()[0].title, 'Kept');
});

test('the optional connection check separates native HTTPS from the adapter without account credentials', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const closed: string[] = [];
  const check = createConnectionCheck(
    async (input, init = {}) => {
      requests.push({ url: String(input), init });
      return new Response('private response contents', { status: init.method === 'POST' ? 400 : 200 });
    },
    {
      async httpOpen(options) {
        assert.equal(options.url, 'https://auth.openai.com/.well-known/openid-configuration');
        assert.deepEqual(options.headers, {});
        assert.equal(options.body, undefined);
        return { status: 200, statusText: '', headers: {} };
      },
      async httpClose({ id }) {
        closed.push(id);
      },
    },
    Promise.resolve({ appVersion: version, nativeVersion: version, webviewVersion: '115.0.0.0' }),
  );
  const result = await check(new AbortController().signal);
  assert.deepEqual(
    result.checks.map(item => item.result),
    ['HTTP 200', 'HTTP 200', 'HTTP 200', 'HTTP 400'],
  );
  assert.equal(closed.length, 1);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(new URL(request.url).origin, 'https://auth.openai.com');
    assert.equal(new Headers(request.init.headers).has('Authorization'), false);
    assert.equal(new Headers(request.init.headers).has('Cookie'), false);
    assert.equal(request.init.redirect, 'error');
  }
  const dummy = new URLSearchParams(String(requests.find(request => request.init.method === 'POST')!.init.body));
  assert.equal(dummy.get('code'), 'synthetic-invalid-code');
  assert.equal(dummy.get('client_id'), 'oaiapp_research_connectivity_check');
  assert.doesNotMatch(JSON.stringify(result), /private response|synthetic-invalid|auth.openai.com|127.0.0.1/);
});

test('connection checks redact native, JavaScript and response-read failures into fixed codes', async () => {
  const check = createConnectionCheck(
    async input => {
      if (String(input).includes('openid')) throw new Error('private URL authorization code');
      if (String(input).includes('jwks'))
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new NetworkFailure('timeout'));
            },
          }),
        );
      return new Response('upstream details', { status: 403 });
    },
    {
      async httpOpen() {
        throw { code: 'RB_NET_TLS', message: 'private certificate credentials' };
      },
      async httpClose() {},
    },
    Promise.resolve({ appVersion: version }),
  );
  const result = await check(new AbortController().signal);
  assert.deepEqual(
    result.checks.map(item => item.result),
    ['RB-NET-TLS', 'RB-NET-IO', 'RB-NET-TIMEOUT', 'HTTP 403'],
  );
  assert.doesNotMatch(JSON.stringify(result), /private|credentials|authorization|upstream/);
});

test('cancelling a connection check closes native HTTPS and bounds a nonresponsive bridge', async () => {
  let closes = 0;
  const check = createConnectionCheck(
    () => new Promise<Response>(() => {}),
    {
      httpOpen: () => new Promise(() => {}),
      async httpClose() {
        closes++;
      },
    },
    Promise.resolve({ appVersion: version }),
  );
  const controller = new AbortController();
  const pending = check(controller.signal);
  controller.abort(new Error('private cancellation reason'));
  await assert.rejects(pending, { name: 'AbortError', message: 'Connection check cancelled.' });
  assert.ok(closes >= 1);
  await assert.rejects(check(controller.signal), { name: 'AbortError' });
});
