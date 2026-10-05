import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { ConcurrentEditError, NOTE_HISTORY_CHARS, NOTE_HISTORY_LIMIT, Store } from '../electron/store';
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
  direct.exec('PRAGMA user_version = 3');
  assert.throws(() => new Store(path), /newer Research Bot version/);
  assert.equal((direct.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 3);
});

const historyRows = (path: string) => {
  const direct = new DatabaseSync(path);
  try { return (direct.prepare('SELECT notes FROM note_history ORDER BY id').all() as { notes: string }[]).map(row => row.notes); } finally { direct.close(); }
};

test('autosave history is capped per project and keeps the newest revisions in order', t => {
  const { store, path } = diskStore(t);
  const other = store.createProject({ title: 'Other', topic: '' }).project;
  store.saveProject({ ...other, notes: 'other project, untouched' }); store.saveProject({ ...store.getProject(other.id).project, notes: 'other project, second save' });
  let project = store.createProject({ title: 'Long session', topic: '' }).project;
  const saves = NOTE_HISTORY_LIMIT + 30;
  for (let i = 1; i <= saves; i++) project = store.saveProject({ ...project, notes: `draft ${i}` });
  const rows = historyRows(path).filter(notes => notes.startsWith('draft'));
  assert.equal(rows.length, NOTE_HISTORY_LIMIT);
  assert.equal(rows.at(-1), `draft ${saves - 1}`); assert.equal(rows[0], `draft ${saves - NOTE_HISTORY_LIMIT}`);
  for (let i = saves - 1; i > saves - NOTE_HISTORY_LIMIT; i--) { project = store.undoNotes(project.id); assert.equal(project.notes, `draft ${i}`); }
  assert.equal(project.notes, `draft ${saves - NOTE_HISTORY_LIMIT + 1}`);
  assert.ok(historyRows(path).includes('other project, untouched'), 'other projects keep their own history');
  assert.equal(store.undoNotes(other.id).notes, 'other project, untouched');
});

test('history is also capped by total size, so large notes cannot bloat the database', t => {
  const { store, path } = diskStore(t);
  let project = store.createProject({ title: 'Big notes', topic: '' }).project;
  const size = 450_000; const note = (i: number) => String(i).padStart(2, '0') + 'x'.repeat(size - 2);
  for (let i = 1; i <= 30; i++) project = store.saveProject({ ...project, notes: note(i) });
  const rows = historyRows(path);
  const total = rows.reduce((sum, notes) => sum + notes.length, 0);
  assert.ok(total <= NOTE_HISTORY_CHARS, `history holds ${total} characters`);
  assert.equal(rows.length, Math.floor(NOTE_HISTORY_CHARS / size)); assert.equal(rows.at(-1), note(29));
  assert.equal(store.undoNotes(project.id).notes, note(29));
});

test('undo can be reversed with redo, in order, and a new edit clears the redo stack', t => {
  const { store } = diskStore(t);
  let project = store.createProject({ title: 'Draft', topic: '' }).project;
  assert.throws(() => store.redoNotes(project.id), /no undone change/);
  project = store.saveProject({ ...project, notes: 'one' }); project = store.saveProject({ ...project, notes: 'two' }); project = store.saveProject({ ...project, notes: 'three' });
  project = store.undoNotes(project.id); assert.equal(project.notes, 'two');
  project = store.undoNotes(project.id); assert.equal(project.notes, 'one');
  const versionBeforeRedo = project.version;
  project = store.redoNotes(project.id); assert.equal(project.notes, 'two'); assert.equal(project.version, versionBeforeRedo + 1);
  project = store.undoNotes(project.id); assert.equal(project.notes, 'one');
  project = store.redoNotes(project.id); project = store.redoNotes(project.id); assert.equal(project.notes, 'three');
  assert.throws(() => store.redoNotes(project.id), /no undone change/);
  project = store.undoNotes(project.id); assert.equal(project.notes, 'two');
  project = store.saveProject({ ...project, notes: 'two, then something new' });
  assert.throws(() => store.redoNotes(project.id), /no undone change/);
  project = store.undoNotes(project.id); assert.equal(project.notes, 'two');
  project = store.saveProject({ ...project, title: 'Metadata only' });
  assert.equal(store.redoNotes(project.id).notes, 'two, then something new');
});

test('undo never destroys the notes it replaces, and redo state belongs to its own project', t => {
  const { store } = diskStore(t);
  const a = store.createProject({ title: 'A', topic: '' }).project; const b = store.createProject({ title: 'B', topic: '' }).project;
  const written = store.saveProject({ ...a, notes: 'precious draft' });
  const undone = store.undoNotes(a.id); assert.equal(undone.notes, '');
  assert.throws(() => store.redoNotes(b.id), /no undone change/);
  assert.equal(store.redoNotes(a.id).notes, 'precious draft'); assert.equal(written.notes, 'precious draft');
  store.undoNotes(a.id); store.deleteProject(a.id);
  assert.throws(() => store.redoNotes(a.id), /Project not found/);
});

test('a version 1 database upgrades in place without losing notes, history or sources', t => {
  const { store, path } = diskStore(t);
  let project = store.createProject({ title: 'Existing', topic: 'Energy' }).project;
  project = store.saveProject({ ...project, notes: 'first' }); project = store.saveProject({ ...project, notes: 'second' });
  const source = store.saveSource(project.id, makeSource({ notes: 'kept' }));
  store.close();
  const direct = new DatabaseSync(path);
  direct.exec('DROP TABLE note_redo; ALTER TABLE note_history DROP COLUMN size; PRAGMA user_version = 1');
  direct.close();
  const upgraded = new Store(path); t.after(() => upgraded.close());
  const detail = upgraded.getProject(project.id);
  assert.equal(detail.project.notes, 'second'); assert.deepEqual(detail.sources, [source]);
  const check = new DatabaseSync(path); t.after(() => check.close());
  assert.equal((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
  assert.deepEqual((check.prepare('SELECT size FROM note_history ORDER BY id').all() as { size: number }[]).map(row => row.size), [0, 5]);
  const undone = upgraded.undoNotes(project.id); assert.equal(undone.notes, 'first');
  assert.equal(upgraded.redoNotes(project.id).notes, 'second');
});
