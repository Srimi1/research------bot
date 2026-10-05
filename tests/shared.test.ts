import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownExport } from '../src/shared/export';
import type { ProjectDetail, ResearchAPI, Source } from '../src/shared/types';

const memory = new Map<string, string>();
Object.assign(globalThis, {
  window: {},
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  },
});
const preview = async (): Promise<ResearchAPI> => (await import('../src/browser-api')).browserAPI;

const source = (overrides: Partial<Source> = {}): Source => ({
  id: crypto.randomUUID(),
  title: 'Paper',
  authors: ['A. Author', 'B. Author'],
  year: '2025',
  url: 'https://doi.org/10.1234/x',
  doi: '10.1234/x',
  category: 'article',
  inspected: 'metadata',
  retrievedAt: '2026-10-05T00:00:00.000Z',
  abstract: '',
  query: 'q',
  method: '',
  findings: '',
  limitations: '',
  notes: '',
  ...overrides,
});

test('markdown export includes every section, marks completed steps, and labels unrecorded fields', () => {
  const detail: ProjectDetail = {
    project: {
      id: 'p',
      title: 'Food waste',
      topic: 'Sustainability',
      question: 'Why?',
      notes: 'My notes',
      version: 1,
      createdAt: '',
      updatedAt: '',
    },
    steps: [
      { id: 's1', title: 'Scope', purpose: 'Focus', output: 'Question', dependsOn: 'none', check: 'Done', done: true },
      { id: 's2', title: 'Read', purpose: '', output: '', dependsOn: '', check: '', done: false },
    ],
    sources: [source({ findings: 'Less waste', year: '' })],
    runs: [],
  };
  const markdown = markdownExport(detail);
  for (const expected of [
    '# Food waste',
    'Topic: Sustainability',
    '## Research question\n\nWhy?',
    '## Notes\n\nMy notes',
    '1. [x] Scope',
    '2. [ ] Read',
    '### Paper',
    'A. Author, B. Author (date unavailable)',
    'Findings: Less waste',
    'Method: not recorded',
  ]) {
    assert.ok(markdown.includes(expected), `missing: ${expected}`);
  }
});

test('browser preview applies the desktop duplicate rules and keeps reviewed fields', async () => {
  const api = await preview();
  const { project } = await api.createProject({ title: 'Preview', topic: '' });
  const first = await api.saveSource(
    project.id,
    source({ doi: 'https://doi.org/10.1234/X', findings: 'Checked myself', inspected: 'full-text' }),
  );
  assert.equal(first.doi, '10.1234/x');
  const duplicate = await api.saveSource(project.id, source({ url: 'https://doi.org/10.1234/x?utm_source=mail' }));
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.findings, 'Checked myself');
  assert.equal(duplicate.inspected, 'full-text');
  const byUrl = await api.saveSource(project.id, source({ doi: '', url: 'https://example.org/report/?b=2&a=1' }));
  const again = await api.saveSource(project.id, source({ doi: '', url: 'https://EXAMPLE.org/report?a=1&b=2#top' }));
  assert.equal(again.id, byUrl.id);
  assert.equal((await api.getProject(project.id)).sources.length, 2);
  await assert.rejects(api.saveSource(project.id, source({ url: 'javascript:alert(1)', doi: '' })), /HTTP/);
});
