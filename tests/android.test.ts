import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Store, ConcurrentEditError } from '../core/store';
import {
  base64url,
  constantEqual,
  randomSecret,
  readLimited,
  sha256Base64url,
  type Fetch,
  type FileStore,
} from '../core/platform';
import { createNativeFetch } from '../src/android/adapters';
import { PersistentDatabase, RETRY_DELAY_MS, SAVE_DELAY_MS } from '../src/android/database';
import { checksumFor, findUpdate, newer } from '../src/android/releases';
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

test('update versions and checksums are compared exactly', () => {
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.equal(newer('0.2.0', '0.2.0'), false);
  assert.equal(newer('0.1.9', '0.2.0'), false);
  const sums = `${'a'.repeat(64)}  research-bot-0.3.0-android.apk\n${'b'.repeat(64)} *other.apk\n`;
  assert.equal(checksumFor(sums, 'research-bot-0.3.0-android.apk'), 'a'.repeat(64));
  assert.equal(checksumFor(sums, 'other.apk'), 'b'.repeat(64));
  assert.equal(checksumFor(sums, 'missing.apk'), undefined);
});

test('only a newer, published release with an APK and checksums is offered', async () => {
  const release = (tag: string, extra: object = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: `research-bot-${tag.slice(1)}-android.apk`,
        browser_download_url: `https://github.com/Srimi1/research------bot/releases/download/${tag}/research-bot-${tag.slice(1)}-android.apk`,
      },
      {
        name: 'SHA256SUMS-android.txt',
        browser_download_url: `https://github.com/Srimi1/research------bot/releases/download/${tag}/SHA256SUMS-android.txt`,
      },
    ],
    ...extra,
  });
  const answer =
    (body: unknown, status = 200): Fetch =>
    async (url, init) => {
      assert.equal(String(url), 'https://api.github.com/repos/Srimi1/research------bot/releases/latest');
      assert.equal(init?.redirect, 'error');
      return new Response(JSON.stringify(body), { status });
    };
  const found = await findUpdate(answer(release('v0.3.0')), '0.2.0');
  assert.equal(found?.version, '0.3.0');
  assert.match(found!.apkUrl, /research-bot-0\.3\.0-android\.apk$/);
  assert.equal(await findUpdate(answer(release('v0.2.0')), '0.2.0'), undefined);
  assert.equal(await findUpdate(answer(release('v0.3.0', { prerelease: true })), '0.2.0'), undefined);
  assert.equal(await findUpdate(answer(release('v0.3.0', { assets: [] })), '0.2.0'), undefined);
  const elsewhere = release('v0.3.0');
  elsewhere.assets[0].browser_download_url = 'https://example.com/research-bot-0.3.0-android.apk';
  assert.equal(await findUpdate(answer(elsewhere), '0.2.0'), undefined);
  await assert.rejects(findUpdate(answer({}, 403), '0.2.0'), /HTTP 403/);
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
