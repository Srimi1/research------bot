import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { describeError, toResult, unwrap } from '../electron/ipc';

const runSchema = z.object({
  projectId: z.string().uuid(),
  text: z.string().min(1).max(30000),
  maxRequests: z.number().int().min(1).max(1000),
  steps: z.array(z.string()).max(2),
});
const failure = (input: unknown) => { try { runSchema.parse(input); } catch (error) { return describeError(error); } throw new Error('Expected validation to fail'); };
const valid = { projectId: '80f5dcb9-6435-4711-9938-3c26626d2823', text: 'ok', maxRequests: 5, steps: [] };

test('validation failures become short sentences, never raw JSON', () => {
  assert.equal(failure({ ...valid, text: 'x'.repeat(30001) }), 'Text is too long. The limit is 30000 characters.');
  assert.equal(failure({ ...valid, text: '' }), 'Text cannot be empty.');
  assert.equal(failure({ ...valid, maxRequests: 5000 }), 'Max requests must be at most 1000.');
  assert.equal(failure({ ...valid, steps: ['a', 'b', 'c'] }), 'Steps has too many items. The limit is 2.');
  assert.equal(failure({ ...valid, projectId: 'nope' }), 'That item is no longer valid. Reload the project and try again.');
  assert.equal(failure({ ...valid, text: undefined }), 'Text is missing or has the wrong type.');
  for (const message of [failure({ ...valid, text: 'x'.repeat(30001) }), failure({})]) {
    assert.doesNotMatch(message, /[{}\[\]"]/); assert.doesNotMatch(message, /Error invoking remote method/);
  }
});

test('several problems are reported together, deduplicated, and capped at three', () => {
  const message = failure({ projectId: 'bad', text: '', maxRequests: 0, steps: ['a', 'b', 'c'] });
  assert.equal(message.split('. ').length >= 3, true);
  assert.ok(message.length < 300);
});

test('ordinary errors keep their own message and unknown throws get a safe fallback', () => {
  assert.equal(describeError(new Error('This project changed since you opened it.')), 'This project changed since you opened it.');
  assert.equal(describeError(new Error('')), 'Something went wrong. Please try again.');
  assert.equal(describeError('plain string'), 'Something went wrong. Please try again.');
  assert.equal(describeError(undefined), 'Something went wrong. Please try again.');
});

test('toResult and unwrap round-trip values, failures and void handlers', async () => {
  assert.equal(unwrap(await toResult(() => 42)), 42);
  assert.equal(unwrap(await toResult(async () => 'later')), 'later');
  assert.equal(unwrap(await toResult(() => undefined)), undefined);
  const failed = await toResult(() => { throw new Error('Project not found.'); });
  assert.deepEqual(failed, { ok: false, message: 'Project not found.' });
  assert.throws(() => unwrap(failed), { message: 'Project not found.' });
  const zodFailed = await toResult(() => runSchema.parse({}));
  assert.equal(zodFailed.ok, false);
  assert.throws(() => unwrap(zodFailed as never), /missing or has the wrong type/);
  assert.throws(() => unwrap(undefined as never), /unexpected response/);
  assert.throws(() => unwrap('raw' as never), /unexpected response/);
});
