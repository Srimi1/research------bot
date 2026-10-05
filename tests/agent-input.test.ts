import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentInput } from '../src/shared/agent-input';
import { MAX_AGENT_INPUT, MAX_SEARCH_QUERY } from '../src/shared/limits';

const draft = (overrides: Partial<{ question: string; notes: string; taskInput: string }> = {}) => ({ question: '', notes: '', taskInput: '', ...overrides });

test('short input is sent whole and unchanged for every role', () => {
  assert.deepEqual(buildAgentInput('grammar', draft({ notes: 'He go home.' })), { text: 'He go home.' });
  assert.deepEqual(buildAgentInput('evidence', draft({ taskInput: ' food waste ' })), { text: 'food waste' });
  const methods = buildAgentInput('methods', draft({ question: 'Why?', notes: 'My notes', taskInput: 'Help' }));
  assert.equal(methods.text, "Help\n\nResearch question: Why?\n\nResearcher's notes:\nMy notes");
  assert.equal(methods.notice, undefined);
});

test('grammar review refuses oversized notes with a readable message instead of a partial copy', () => {
  assert.throws(() => buildAgentInput('grammar', draft({ notes: 'a'.repeat(MAX_AGENT_INPUT + 1) })), /30,001 characters long.*up to 30,000/);
  assert.equal(buildAgentInput('grammar', draft({ notes: 'a'.repeat(MAX_AGENT_INPUT) })).text.length, MAX_AGENT_INPUT);
  assert.throws(() => buildAgentInput('grammar', draft({ notes: '  \n ' })), /Write a few sentences/);
});

test('methods and brainstorm share an excerpt of long notes, say so, and stay under the limit', () => {
  for (const role of ['methods', 'brainstorm'] as const) {
    const notes = 'word '.repeat(60_000);
    const result = buildAgentInput(role, draft({ question: 'What drives food waste?', taskInput: 'Narrow this down', notes }));
    assert.ok(result.text.length <= MAX_AGENT_INPUT, `length ${result.text.length}`);
    assert.match(result.text, /^Narrow this down\n\nResearch question: What drives food waste\?\n\nResearcher's notes:\n/);
    assert.match(result.text, /\[Notes truncated: only the first [\d,]+ of 300,000 characters were shared\.\]$/);
    assert.match(result.notice!, /only the first [\d,]+ of 300,000 characters/);
  }
});

test('truncation never splits a surrogate pair and fails clearly when the instruction leaves no room', () => {
  const emoji = buildAgentInput('methods', draft({ notes: '😀'.repeat(40_000) }));
  assert.ok(emoji.text.length <= MAX_AGENT_INPUT);
  assert.doesNotMatch(emoji.text, /[\ud800-\udbff](?![\udc00-\udfff])/);
  assert.throws(() => buildAgentInput('brainstorm', draft({ taskInput: 'x'.repeat(29_900), notes: 'some notes' + ' y'.repeat(2_000) })), /too long to share with your notes/);
});

test('evidence search uses the instruction, then the question, then a short excerpt of the notes', () => {
  assert.equal(buildAgentInput('evidence', draft({ taskInput: 'a', question: 'b', notes: 'c' })).text, 'a');
  assert.equal(buildAgentInput('evidence', draft({ question: ' campus food waste ', notes: 'c' })).text, 'campus food waste');
  const notes = 'sustainable   building\nmaterials '.repeat(2_000);
  const fallback = buildAgentInput('evidence', draft({ notes })).text;
  assert.ok(fallback.length <= 500 && fallback.length > 100); assert.doesNotMatch(fallback, /\s{2}/);
  assert.throws(() => buildAgentInput('evidence', draft()), /Add a question/);
  assert.throws(() => buildAgentInput('evidence', draft({ question: 'q'.repeat(MAX_SEARCH_QUERY + 1) })), /up to 1,000 characters/);
});
