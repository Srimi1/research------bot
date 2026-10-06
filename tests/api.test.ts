import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandlers, safeExternal, type ApiHost } from '../core/api';
import { Store } from '../electron/store';

test('external links block local address forms while preserving public sources', () => {
  for (const url of [
    'http://localhost.',
    'http://app.localhost.',
    'http://0.0.0.0',
    'http://127.1',
    'http://0x7f000001',
    'http://10.1.2.3',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://169.254.1.1',
    'http://100.64.0.1',
    'http://[::]',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[fd00::1234]',
    'http://[fe80::1]',
    'http://224.0.0.1',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@example.org',
  ])
    assert.throws(() => safeExternal(url), { name: 'Error' }, url);
  for (const url of [
    'https://doi.org/10.1234/article',
    'https://example.org/paper?q=1#section',
    'https://8.8.8.8',
    'https://[2001:4860:4860::8888]',
  ])
    assert.equal(safeExternal(url), new URL(url).href);
});

test('the shared API saves long notes supported by the store and refuses oversized notes atomically', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const handlers = createHandlers({ store } as ApiHost);
  const { project } = store.createProject({ title: 'Long research draft', topic: '' });
  const saved = await handlers.saveProject({ ...project, notes: 'x'.repeat(100_001) });
  assert.equal(saved.notes.length, 100_001);
  await assert.rejects(handlers.saveProject({ ...saved, notes: 'x'.repeat(1_000_001) }));
  assert.equal(store.getProject(project.id).project.notes, saved.notes);
});
