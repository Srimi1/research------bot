import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { parseCrossref, searchEvidence } from '../electron/evidence';

const payload = {
  status: 'ok', message: { items: [
    { DOI: '10.1234/Example', title: ['<i>Materials</i> &amp; sustainability'], author: [{ given: 'Ada', family: 'Lovelace' }, { name: 'Research Institute' }], published: { 'date-parts': [[2025, 1, 5]] }, type: 'journal-article', abstract: '<jats:p>Publisher-deposited abstract.</jats:p>' },
    { DOI: '10.1234/example', title: ['A duplicate record'], type: 'journal-article' },
    { DOI: '10.1234/report', title: ['A deposited technical report'], type: 'report', issued: { 'date-parts': [[2024]] } },
    { DOI: 'invalid DOI', title: ['Invalid record'] },
    { DOI: '10.1234/missing-title' },
  ] },
};

let mock: MockAgent;
let previousDispatcher: ReturnType<typeof getGlobalDispatcher>;
beforeEach(() => { previousDispatcher = getGlobalDispatcher(); mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock); });
afterEach(async () => { setGlobalDispatcher(previousDispatcher); await mock.close(); });

test('deposited metadata has traceable DOI links, provenance, no fabricated extraction, and no duplicate citations', () => {
  const result = parseCrossref(payload, 'building sustainability', '2026-10-05T00:00:00.000Z');
  assert.equal(result.sources.length, 2); assert.equal(result.sources[0].title, 'Materials & sustainability');
  assert.deepEqual(result.sources[0].authors, ['Ada Lovelace', 'Research Institute']);
  assert.equal(result.sources[0].year, '2025'); assert.equal(result.sources[0].url, 'https://doi.org/10.1234/example');
  assert.equal(result.sources[0].abstract, 'Publisher-deposited abstract.'); assert.equal(result.sources[0].inspected, 'metadata');
  assert.equal(result.sources[1].category, 'report'); assert.equal(result.sources[1].year, '2024');
  for (const source of result.sources) {
    assert.equal(source.method, ''); assert.equal(source.findings, ''); assert.equal(source.limitations, '');
    assert.equal(source.query, 'building sustainability'); assert.equal(source.retrievedAt, '2026-10-05T00:00:00.000Z');
    assert.match(source.id, /^[\da-f]{8}-[\da-f-]{27}$/i);
  }
  assert.match(result.limitations, /Read each linked source/); assert.match(result.limitations, /Forums:/);
});

test('missing metadata stays blank and malformed envelopes are rejected', () => {
  const result = parseCrossref({ status: 'ok', message: { items: [{ DOI: '10.1234/minimal', title: ['Minimal'] }] } }, 'query');
  assert.deepEqual(result.sources[0].authors, []); assert.equal(result.sources[0].year, ''); assert.equal(result.sources[0].abstract, '');
  assert.throws(() => parseCrossref({ status: 'ok', message: {} }, 'query'), /unexpected metadata/);
  assert.throws(() => parseCrossref({ status: 'error', message: { items: [] } }, 'query'), /unexpected metadata/);
});

test('scholarly search encodes the query and only contacts the fixed official Crossref endpoint', async () => {
  let requestPath = '';
  mock.get('https://api.crossref.org').intercept({ method: 'GET', path: path => { requestPath = path; return path.startsWith('/works?'); } }).reply(200, payload, { headers: { 'content-type': 'application/json' } });
  const result = await searchEvidence('sustainability & https://untrusted.example/a', new AbortController().signal);
  const url = new URL(requestPath, 'https://api.crossref.org');
  assert.equal(url.pathname, '/works'); assert.equal(url.searchParams.get('query.bibliographic'), 'sustainability & https://untrusted.example/a');
  assert.equal(url.searchParams.get('rows'), '12'); assert.match(url.searchParams.get('select') ?? '', /DOI,title/);
  assert.equal(result.sources.length, 2); assert.equal(result.cached, false); mock.assertNoPendingInterceptors();
});

test('rate limiting, server errors, and invalid JSON report failures instead of fabricated results', async () => {
  const pool = mock.get('https://api.crossref.org');
  pool.intercept({ path: /^\/works\?/, method: 'GET' }).reply(429, 'slow down');
  await assert.rejects(searchEvidence('climate', new AbortController().signal), /limiting requests/);
  pool.intercept({ path: /^\/works\?/, method: 'GET' }).reply(503, 'offline');
  await assert.rejects(searchEvidence('climate', new AbortController().signal), /HTTP 503/);
  pool.intercept({ path: /^\/works\?/, method: 'GET' }).reply(200, 'not-json');
  await assert.rejects(searchEvidence('climate', new AbortController().signal), /invalid JSON/);
});

test('response size bounds reject oversized metadata and redirects cannot fetch an arbitrary host', async () => {
  const pool = mock.get('https://api.crossref.org');
  pool.intercept({ path: /^\/works\?/, method: 'GET' }).reply(200, 'x'.repeat(2_000_001));
  await assert.rejects(searchEvidence('climate', new AbortController().signal), /size limit/);
  pool.intercept({ path: /^\/works\?/, method: 'GET' }).reply(302, '', { headers: { location: 'https://untrusted.example/' } });
  await assert.rejects(searchEvidence('climate', new AbortController().signal));
});

test('empty queries and cancellation perform no network request', async () => {
  await assert.rejects(searchEvidence(' ', new AbortController().signal), /search query/);
  await assert.rejects(searchEvidence('a'.repeat(1_001), new AbortController().signal), /search query/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(searchEvidence('climate', controller.signal), error => error instanceof DOMException && error.name === 'AbortError');
});
