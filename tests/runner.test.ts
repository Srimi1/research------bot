import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runner, parseResult, validateGrammar } from '../electron/runner';
import { Store } from '../electron/store';
import type { AuthService } from '../electron/auth';
import type { RunEvent } from '../src/shared/types';
test('grammar requires exact original offsets and no undisclosed changes', () => {
  const valid = validateGrammar('He go home.', {
    proposed: 'He goes home.',
    edits: [{ before: 'go', after: 'goes', start: 3, reason: 'Subject agreement' }],
  });
  assert.equal(valid.edits[0].end, 5);
  assert.throws(() =>
    validateGrammar('He go home.', {
      proposed: 'He goes home. A new idea.',
      edits: [{ before: 'go', after: 'goes', start: 3, reason: 'Subject agreement' }],
    }),
  );
  assert.throws(() =>
    validateGrammar('He go home.', {
      proposed: 'He goes home.',
      edits: [{ before: 'went', after: 'goes', start: 3, reason: 'Subject agreement' }],
    }),
  );
});
test('grammar anchors edits to the real text when the model miscounts offsets', () => {
  const fixed = validateGrammar('He go home.', {
    proposed: 'He goes home.',
    edits: [{ before: 'go', after: 'goes', start: 0, reason: 'Subject agreement' }],
  });
  assert.deepEqual([fixed.edits[0].start, fixed.edits[0].end], [3, 5]);
  assert.equal(fixed.proposed, 'He goes home.');
  const text = 'I go. You go. We go.';
  const nearest = validateGrammar(text, {
    proposed: 'I go. You goes. We go.',
    edits: [{ before: 'go', after: 'goes', start: 9, reason: 'x' }],
  });
  assert.equal(nearest.edits[0].start, 10);
  const both = validateGrammar(text, {
    proposed: 'I goes. You go. We goes.',
    edits: [
      { before: 'go', after: 'goes', start: 0, reason: 'x' },
      { before: 'go', after: 'goes', start: 100, reason: 'x' },
    ],
  });
  assert.deepEqual(
    both.edits.map(e => e.start),
    [2, 17],
  );
  const drifted = 'Café 😀 😀 😀 teh result.';
  const emoji = validateGrammar(drifted, {
    proposed: 'Café 😀 😀 😀 the result.',
    edits: [{ before: 'teh', after: 'the', start: drifted.indexOf('teh') - 5, reason: 'Spelling' }],
  });
  assert.equal(emoji.original.slice(emoji.edits[0].start, emoji.edits[0].end), 'teh');
  assert.throws(
    () =>
      validateGrammar(text, {
        proposed: 'I go. You go. We go.',
        edits: [{ before: 'went', after: 'goes', start: 0, reason: 'x' }],
      }),
    /do not match the original/,
  );
  assert.throws(
    () =>
      validateGrammar(text, {
        proposed: 'I go. You go. We go. Extra.',
        edits: [{ before: 'go', after: 'goes', start: 2, reason: 'x' }],
      }),
    /outside its edit list/,
  );
});
test('grammar rejects changed numbers, citations, and overlapping edits', () => {
  assert.throws(() =>
    validateGrammar('We tested 12 cases.', {
      proposed: 'We tested 21 cases.',
      edits: [{ before: '12', after: '21', start: 10, reason: 'x' }],
    }),
  );
  assert.throws(() =>
    validateGrammar('See [1].', {
      proposed: 'See [2].',
      edits: [{ before: '[1]', after: '[2]', start: 4, reason: 'x' }],
    }),
  );
  assert.throws(() =>
    validateGrammar('They goes.', {
      proposed: 'They go.',
      edits: [
        { before: 'goes', after: 'go', start: 5, reason: 'x' },
        { before: 'es', after: '', start: 7, reason: 'x' },
      ],
    }),
  );
});
test('empty edits preserve original and malformed structured output fails', () => {
  assert.equal(validateGrammar('Correct text.', { proposed: 'Correct text.', edits: [] }).proposed, 'Correct text.');
  assert.throws(() => parseResult('brainstorm', 'input', 'not JSON'));
  assert.throws(() => parseResult('methods', 'input', '{"question":"unsupported result"}'));
  const result = parseResult(
    'brainstorm',
    'input',
    JSON.stringify({
      ideas: [
        { title: 'Idea', explanation: 'Untested', assumptions: 'Access', evidenceNeeded: 'Data', nextStep: 'Ask' },
      ],
    }),
  );
  assert.equal(result.kind, 'brainstorm');
});
test('runner stores suggestions without changing accepted notes, enforces session budget', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-run-'));
  const store = new Store(join(dir, 'test.sqlite'));
  try {
    const detail = store.createProject({ title: 'A', topic: 'Food' });
    store.saveSettings({ model: 'eligible-model', maxRequests: 1, autoUpdate: true });
    const events: RunEvent[] = [];
    const auth = {
      account: async () => ({ signedIn: true }),
      stream: async (_m: string, _i: string, _input: string, _s: AbortSignal, delta: (v: string) => void) => {
        delta('{');
        return {
          text: JSON.stringify({
            ideas: [
              {
                title: 'Test',
                explanation: 'Untested',
                assumptions: 'Scope',
                evidenceNeeded: 'Data',
                nextStep: 'Read',
              },
            ],
          }),
          usage: { input: 10, output: 20 },
        };
      },
    } as unknown as AuthService;
    const runner = new Runner(store, auth, join(process.cwd(), 'agents'), e => events.push(e));
    const run = await runner.run({ projectId: detail.project.id, role: 'brainstorm', text: 'food waste' });
    assert.equal(run.status, 'completed');
    assert.equal(events[0].type, 'status');
    assert.equal(store.getProject(detail.project.id).project.notes, detail.project.notes);
    assert.equal(store.getProject(detail.project.id).runs[0].id, run.id);
    await assert.rejects(
      () => runner.run({ projectId: detail.project.id, role: 'brainstorm', text: 'again' }),
      /limit/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('cancelled and failed streams are recorded without accepting a suggestion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-cancel-'));
  const store = new Store(join(dir, 'test.sqlite'));
  try {
    const detail = store.createProject({ title: 'A', topic: '' });
    store.saveSettings({ model: 'eligible', maxRequests: 5, autoUpdate: true });
    const auth = {
      account: async () => ({ signedIn: true }),
      stream: async (_m: string, _i: string, _input: string, signal: AbortSignal) => {
        assert.equal(signal.aborted, true);
        throw new Error('aborted');
      },
    } as unknown as AuthService;
    const runner: Runner = new Runner(store, auth, join(process.cwd(), 'agents'), event => {
      if (event.text === 'running') runner.cancel(event.runId);
    });
    const result = await runner.run({ projectId: detail.project.id, role: 'grammar', text: 'He go.' });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.result, undefined);
    assert.equal(store.getProject(detail.project.id).project.notes, '');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('cached evidence can be saved independently in two projects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-cache-'));
  const store = new Store(join(dir, 'test.sqlite'));
  try {
    const first = store.createProject({ title: 'A', topic: '' });
    const second = store.createProject({ title: 'B', topic: '' });
    const source = {
      id: '80f5dcb9-6435-4711-9938-3c26626d2823',
      title: 'Paper',
      authors: [],
      year: '2025',
      url: 'https://doi.org/10.1234/example',
      doi: '10.1234/example',
      category: 'article' as const,
      inspected: 'metadata' as const,
      retrievedAt: new Date().toISOString(),
      abstract: '',
      query: 'food waste',
      method: '',
      findings: '',
      limitations: '',
      notes: '',
    };
    store.setCache('crossref:food waste', {
      kind: 'evidence',
      sources: [source],
      query: 'food waste',
      cached: false,
      limitations: 'Metadata only',
    });
    const runner = new Runner(store, {} as AuthService, join(process.cwd(), 'agents'), () => {});
    const a = await runner.run({ projectId: first.project.id, role: 'evidence', text: 'food waste' });
    const b = await runner.run({ projectId: second.project.id, role: 'evidence', text: 'food waste' });
    assert.equal(a.result?.kind, 'evidence');
    assert.equal(b.result?.kind, 'evidence');
    if (a.result?.kind !== 'evidence' || b.result?.kind !== 'evidence') throw new Error('Missing evidence');
    assert.notEqual(a.result.sources[0].id, b.result.sources[0].id);
    store.saveSource(first.project.id, a.result.sources[0]);
    store.saveSource(second.project.id, b.result.sources[0]);
    assert.equal(store.getProject(second.project.id).sources.length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('a wrongly formatted answer is retried once within the budget; policy rejections are not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-retry-'));
  const store = new Store(join(dir, 'test.sqlite'));
  try {
    const project = store.createProject({ title: 'A', topic: '' }).project;
    const good = JSON.stringify({
      ideas: [{ title: 'Idea', explanation: 'Untested', assumptions: 'a', evidenceNeeded: 'e', nextStep: 'n' }],
    });
    const runWith = async (
      answers: string[],
      maxRequests: number,
      role: 'brainstorm' | 'grammar' = 'brainstorm',
      text = 'food waste',
    ) => {
      store.saveSettings({ model: 'm', maxRequests, autoUpdate: true });
      let calls = 0;
      const events: RunEvent[] = [];
      const auth = {
        account: async () => ({ signedIn: true }),
        stream: async () => ({ text: answers[Math.min(calls++, answers.length - 1)], usage: { input: 10, output: 5 } }),
      } as unknown as AuthService;
      const run = await new Runner(store, auth, join(process.cwd(), 'agents'), e => events.push(e)).run({
        projectId: project.id,
        role,
        text,
      });
      return { run, calls, events };
    };
    const retried = await runWith(['Sure! Here are ideas.', good], 5);
    assert.equal(retried.run.status, 'completed');
    assert.equal(retried.calls, 2);
    assert.deepEqual(retried.run.usage, { input: 20, output: 10 });
    assert.ok(retried.events.some(e => e.type === 'status' && /once more/.test(e.text)));
    const twice = await runWith(['nope', 'still nope'], 5);
    assert.equal(twice.run.status, 'failed');
    assert.equal(twice.calls, 2);
    assert.match(twice.run.error!, /invalid response/);
    const schema = await runWith(['{"ideas":[]}'], 5);
    assert.equal(schema.calls, 2);
    assert.match(schema.run.error!, /did not match the required format/);
    const noBudget = await runWith(['nope', good], 1);
    assert.equal(noBudget.run.status, 'failed');
    assert.equal(noBudget.calls, 1);
    const policy = await runWith(
      [
        JSON.stringify({
          proposed: 'We tested 21 cases.',
          edits: [{ before: '12', after: '21', start: 10, reason: 'x' }],
        }),
      ],
      5,
      'grammar',
      'We tested 12 cases.',
    );
    assert.equal(policy.calls, 1);
    assert.match(policy.run.error!, /changed a number/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
