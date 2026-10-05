import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { ConcurrentEditError, Store } from '../electron/store';
import type { EvidenceResult, PlanStep, Run, Source } from '../src/shared/types';

const makeSource = (overrides: Partial<Source> = {}): Source => ({
  id: randomUUID(), title: 'A publisher-deposited article', authors: ['A. Researcher'], year: '2025',
  url: 'https://doi.org/10.1234/article', doi: '10.1234/article', category: 'article', inspected: 'metadata',
  retrievedAt: '2026-10-05T00:00:00.000Z', abstract: '', query: 'sustainability', method: '', findings: '', limitations: '', notes: '', ...overrides,
});
const steps: PlanStep[] = [{ id: 'step-1', title: 'Scope the question', purpose: 'Make the scope feasible', output: 'A bounded question', dependsOn: '', check: 'Population and period specified', done: false }];

function diskStore(t: TestContext): { store: Store; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'research-bot-store-'));
  const path = join(directory, 'research.sqlite'); const store = new Store(path);
  t.after(() => { try { store.close(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  return { store, path };
}

test('projects, annotations, plans, runs, settings and source cache survive a restart', t => {
  const { store, path } = diskStore(t);
  const initial = store.createProject({ title: "Researcher's sustainability project", topic: 'Buildings' }).project;
  const saved = store.saveProject({ ...initial, notes: 'My own explanation', question: 'How can embodied emissions be reduced?' });
  const source = store.saveSource(initial.id, makeSource({ notes: 'Read the source before interpreting it' }));
  store.saveSteps(initial.id, steps);
  const run: Run = { id: randomUUID(), projectId: initial.id, role: 'evidence', status: 'completed', model: 'Crossref', input: 'building sustainability', createdAt: '2026-10-05T00:00:00.000Z' };
  store.saveRun(run);
  store.saveSettings({ model: 'account-authorized-model', maxRequests: 12 });
  const evidence: EvidenceResult = { kind: 'evidence', sources: [source], query: run.input, cached: false, limitations: 'Metadata only' };
  store.setCache('crossref:building sustainability', evidence);
  const snapshot = store.getProject(initial.id);
  assert.equal(snapshot.project.version, saved.version);
  store.close();
  const reopened = new Store(path); t.after(() => reopened.close());
  assert.deepEqual(reopened.getProject(initial.id), snapshot);
  assert.deepEqual(reopened.getSettings(), { model: 'account-authorized-model', maxRequests: 12 });
  assert.deepEqual(reopened.getCache('crossref:building sustainability'), { ...evidence, cached: true });
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('stale concurrent edits cannot overwrite newer notes or add undo history', t => {
  const { store, path } = diskStore(t);
  const other = new Store(path); t.after(() => other.close());
  const project = store.createProject({ title: 'Draft', topic: 'Energy' }).project;
  const stale = other.getProject(project.id).project;
  const latest = store.saveProject({ ...project, notes: 'New work saved first', title: 'New title' });
  assert.throws(() => other.saveProject({ ...stale, notes: 'Stale overwrite', title: 'Stale title' }), ConcurrentEditError);
  assert.deepEqual(other.getProject(project.id).project, latest);
  const undone = other.undoNotes(project.id);
  assert.equal(undone.notes, ''); assert.equal(undone.title, 'New title'); assert.equal(undone.version, latest.version + 1);
  assert.throws(() => store.undoNotes(project.id), /no earlier saved version/);
});

test('undo restores prior notes in order and metadata edits do not create note revisions', t => {
  const { store } = diskStore(t);
  let project = store.createProject({ title: 'Draft', topic: '' }).project;
  project = store.saveProject({ ...project, notes: 'First notes' });
  project = store.saveProject({ ...project, title: 'A title change' });
  project = store.saveProject({ ...project, notes: 'Second notes' });
  project = store.undoNotes(project.id); assert.equal(project.notes, 'First notes');
  project = store.undoNotes(project.id); assert.equal(project.notes, '');
  assert.equal(project.title, 'A title change');
  assert.throws(() => store.undoNotes(project.id), /no earlier/);
});

test('source IDs and run history cannot be reassigned across projects', t => {
  const { store } = diskStore(t);
  const a = store.createProject({ title: 'Project A', topic: 'Climate' }).project;
  const b = store.createProject({ title: 'Project B', topic: 'Water' }).project;
  const source = store.saveSource(a.id, makeSource());
  const run: Run = { id: 'one-run', projectId: a.id, role: 'evidence', status: 'running', model: 'Crossref', input: 'climate', createdAt: '2026-10-05T00:00:00.000Z' };
  store.saveRun(run); store.saveSteps(a.id, steps);
  assert.throws(() => store.saveSource(b.id, source), /different project/);
  assert.throws(() => store.deleteSource(b.id, source.id), /not found in this project/);
  assert.throws(() => store.saveRun({ ...run, projectId: b.id }), /different project/);
  assert.deepEqual(store.getProject(b.id).sources, []); assert.deepEqual(store.getProject(b.id).runs, []);
  const independentlyRetrieved = store.saveSource(b.id, { ...source, id: randomUUID() });
  assert.notEqual(independentlyRetrieved.id, source.id);
  store.deleteProject(a.id);
  assert.throws(() => store.getProject(a.id), /Project not found/);
  assert.deepEqual(store.getProject(b.id).sources, [independentlyRetrieved]);
  assert.deepEqual(store.getProject(b.id).steps, []);
});

test('duplicate DOI and canonical URL keep one saved source and preserve reviewed fields', t => {
  const { store } = diskStore(t);
  const project = store.createProject({ title: 'Sources', topic: '' }).project;
  const first = store.saveSource(project.id, makeSource({ doi: 'https://doi.org/10.1234/ARTICLE', findings: 'I checked this myself', notes: 'Annotated', inspected: 'full-text' }));
  const duplicate = store.saveSource(project.id, makeSource({ url: 'https://doi.org/10.1234/article?utm_source=newsletter#section' }));
  assert.equal(duplicate.id, first.id); assert.equal(duplicate.doi, '10.1234/article');
  assert.equal(duplicate.findings, first.findings); assert.equal(duplicate.inspected, 'full-text');
  assert.equal(store.getProject(project.id).sources.length, 1);
  const document = store.saveSource(project.id, makeSource({ doi: '', url: 'https://example.org/report/?a=1&b=2&utm_source=email', title: 'A report' }));
  const repeated = store.saveSource(project.id, makeSource({ doi: '', url: 'https://EXAMPLE.org/report?b=2&a=1#page=2', title: 'A report' }));
  assert.equal(repeated.id, document.id); assert.equal(store.getProject(project.id).sources.length, 2);
  const cleared = store.saveSource(project.id, { ...duplicate, findings: '', notes: '' });
  assert.equal(cleared.findings, ''); assert.equal(cleared.notes, '');
});

test('validation failures are atomic and deletion removes only the selected source', t => {
  const { store } = diskStore(t);
  const project = store.createProject({ title: 'Research', topic: '' }).project;
  const source = store.saveSource(project.id, makeSource());
  const second = store.saveSource(project.id, makeSource({ doi: '10.1234/second', url: 'https://doi.org/10.1234/second' }));
  store.saveSteps(project.id, steps);
  assert.throws(() => store.saveProject({ ...project, title: '', notes: 'Must not be saved' }), /nonempty/);
  assert.throws(() => store.saveSteps(project.id, [...steps, ...steps]), /unique IDs/);
  assert.throws(() => store.saveSource(project.id, { ...source, url: 'javascript:alert(1)' }), /HTTP/);
  assert.deepEqual(store.getProject(project.id).steps, steps); assert.equal(store.getProject(project.id).project.notes, '');
  assert.throws(() => store.undoNotes(project.id), /no earlier/);
  store.deleteSource(project.id, source.id);
  assert.deepEqual(store.getProject(project.id).sources, [second]);
});

test('cache expiration and future schema version are handled without destroying stored data', t => {
  const { store, path } = diskStore(t);
  const result: EvidenceResult = { kind: 'evidence', query: 'water', sources: [], cached: false, limitations: 'Metadata only' };
  store.setCache('crossref:water', result);
  const direct = new DatabaseSync(path); t.after(() => direct.close());
  direct.prepare('UPDATE search_cache SET expires_at = 0 WHERE cache_key = ?').run('crossref:water');
  assert.equal(store.getCache('crossref:water'), undefined);
  direct.exec('PRAGMA user_version = 2');
  assert.throws(() => new Store(path), /newer Research Bot version/);
  assert.equal((direct.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
});
