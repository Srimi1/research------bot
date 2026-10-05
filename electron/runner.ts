import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentResult, GrammarResult, Run, RunEvent, RunRequest } from '../src/shared/types';
import type { Store } from './store';
import type { AuthService } from './auth';
import { searchEvidence } from './evidence';

const text = z.string().max(30000);
const grammarSchema = z.object({
  proposed: text,
  clarification: text.default(''),
  edits: z
    .array(
      z.object({
        before: z.string().min(1).max(1000),
        after: z.string().max(1000),
        reason: z.string().max(1000),
        start: z.number().int().nonnegative(),
      }),
    )
    .max(100),
});
const methodsSchema = z.object({
  question: text,
  assumptions: z.array(text).max(20),
  explanation: text,
  options: z.array(z.object({ name: text, rationale: text, limitations: text })).max(10),
  steps: z
    .array(z.object({ title: text, purpose: text, output: text, dependsOn: text, check: text }))
    .min(1)
    .max(30),
});
const brainstormSchema = z.object({
  ideas: z
    .array(z.object({ title: text, explanation: text, assumptions: text, evidenceNeeded: text, nextStep: text }))
    .min(1)
    .max(12),
});

/**
 * Models are unreliable at counting UTF-16 offsets, especially after emoji or accents. Treat the claimed
 * offset as a hint and anchor each edit to the real text, preferring the occurrence nearest the claim.
 */
function locate(original: string, before: string, claimed: number, floor: number): number {
  if (claimed >= floor && original.startsWith(before, claimed)) return claimed;
  let best = -1;
  for (let at = original.indexOf(before, floor); at !== -1; at = original.indexOf(before, at + 1)) {
    if (best === -1 || Math.abs(at - claimed) < Math.abs(best - claimed)) best = at;
    if (at > claimed) break;
  }
  return best;
}

/** The model answered in the wrong shape. Worth one automatic retry, unlike a policy rejection. */
export class FormatError extends Error {}

export function validateGrammar(original: string, data: unknown): GrammarResult {
  const parsed = grammarSchema.parse(data);
  const edits: GrammarResult['edits'] = [];
  let floor = 0;
  for (const claimed of [...parsed.edits].sort((a, b) => a.start - b.start)) {
    const start = locate(original, claimed.before, claimed.start, floor);
    if (start === -1) throw new FormatError('Grammar edits do not match the original passage. Nothing was changed.');
    const edit = { ...claimed, id: randomUUID(), start, end: start + claimed.before.length };
    if (
      (edit.before.match(/\d+(?:[.,]\d+)*/g) || []).join('|') !== (edit.after.match(/\d+(?:[.,]\d+)*/g) || []).join('|')
    )
      throw new Error('A grammar suggestion changed a number. Nothing was changed.');
    if (/https?:\/\/|\[[\d,\s-]+\]/.test(edit.before + edit.after))
      throw new Error('A grammar suggestion changes a link or citation. Please edit this passage manually.');
    if (edit.before.length > 300 || edit.after.length > edit.before.length + 80)
      throw new Error('A grammar suggestion rewrites too much text. Please select a shorter passage.');
    floor = edit.end;
    edits.push(edit);
  }
  let proposed = original;
  for (const edit of [...edits].reverse())
    proposed = proposed.slice(0, edit.start) + edit.after + proposed.slice(edit.end);
  if (proposed !== parsed.proposed)
    throw new FormatError('Grammar response contains changes outside its edit list. Nothing was changed.');
  return { kind: 'grammar', original, proposed, edits, clarification: parsed.clarification };
}

export function parseResult(role: RunRequest['role'], input: string, raw: string): AgentResult {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new FormatError('The assistant returned an invalid response. Your work is unchanged; retry the request.');
  }
  try {
    if (role === 'grammar') return validateGrammar(input, data);
    if (role === 'methods') {
      const value = methodsSchema.parse(data);
      return {
        ...value,
        kind: 'methods',
        steps: value.steps.map(step => ({ ...step, id: randomUUID(), done: false })),
      };
    }
    if (role === 'brainstorm') return { ...brainstormSchema.parse(data), kind: 'brainstorm' };
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new FormatError('The assistant response did not match the required format. Your work is unchanged.');
    throw error;
  }
  throw new Error('Evidence discovery must use retrieved source metadata.');
}

const formats = {
  grammar:
    'Return ONLY JSON: {"proposed":"complete corrected passage","clarification":"question if ambiguous or empty","edits":[{"before":"exact original substring","after":"minimal replacement","reason":"grammar reason","start":0}]}. start is the zero-based JavaScript UTF-16 character offset in the original text. Edits must not overlap. proposed must equal exactly those edits applied. Return no edits when already correct. Preserve numbers, links, citations, and quotations.',
  methods:
    'Return ONLY JSON: {"question":"proposed research question","assumptions":["explicit assumptions"],"explanation":"method guidance","options":[{"name":"method","rationale":"why it fits","limitations":"tradeoffs"}],"steps":[{"title":"step","purpose":"why","output":"deliverable","dependsOn":"earlier step title or none","check":"completion check"}]}. Keep the plan feasible and explain uncertainties.',
  brainstorm:
    'Return ONLY JSON: {"ideas":[{"title":"candidate direction","explanation":"untested idea","assumptions":"assumptions","evidenceNeeded":"evidence required","nextStep":"small next step"}]}. Give 3-5 ideas, with alternative explanations. Label ideas as untested.',
};
export class Runner {
  private active = new Map<string, AbortController>();
  private requests = 0;
  constructor(
    private store: Store,
    private auth: AuthService,
    private agentDirectory: string,
    private emit: (event: RunEvent) => void,
  ) {}
  cancel(id: string) {
    this.active.get(id)?.abort();
  }
  cancelProject(id: string) {
    for (const [runId, controller] of this.active) {
      if (this.store.getProject(id).runs.some(r => r.id === runId)) controller.abort();
    }
  }
  stop() {
    for (const controller of this.active.values()) controller.abort();
  }
  async run(request: RunRequest): Promise<Run> {
    if (this.active.size >= 2) throw new Error('Two research tasks are already running. Wait or cancel one.');
    this.store.getProject(request.projectId);
    const settings = this.store.getSettings();
    if (request.role !== 'evidence') {
      if (!(await this.auth.account()).signedIn)
        throw new Error('Continue with ChatGPT in settings before using this assistant.');
      if (this.requests >= settings.maxRequests)
        throw new Error(
          'The request limit for this app session has been reached. Change the limit in settings to continue.',
        );
      if (!settings.model) throw new Error('Choose an available ChatGPT model in settings.');
    }
    const detail = this.store.getProject(request.projectId);
    const controller = new AbortController();
    if (this.active.size >= 2) throw new Error('Two research tasks are already running. Wait or cancel one.');
    const timeout = setTimeout(() => controller.abort(), 180000);
    const run: Run = {
      id: randomUUID(),
      projectId: request.projectId,
      role: request.role,
      status: 'running',
      model: request.role === 'evidence' ? 'Crossref' : settings.model,
      input: request.text,
      createdAt: new Date().toISOString(),
    };
    this.active.set(run.id, controller);
    try {
      this.store.saveRun(run);
      this.emit({ runId: run.id, projectId: run.projectId, type: 'status', text: 'running' });
      if (request.role === 'evidence') {
        const key = `crossref:${request.text.trim().toLowerCase()}`;
        const cached = request.refresh ? undefined : this.store.getCache(key);
        run.result = cached
          ? { ...cached, cached: true, sources: cached.sources.map(source => ({ ...source, id: randomUUID() })) }
          : await searchEvidence(request.text, controller.signal);
        if (!cached) this.store.setCache(key, run.result);
      } else {
        const names = {
          grammar: 'grammar-editor.md',
          methods: 'methods-coach.md',
          brainstorm: 'brainstorming-partner.md',
        };
        const instructions =
          readFileSync(join(this.agentDirectory, 'shared.md'), 'utf8') +
          '\n' +
          readFileSync(join(this.agentDirectory, names[request.role]), 'utf8') +
          '\n' +
          formats[request.role];
        const context =
          request.role === 'grammar'
            ? request.text
            : JSON.stringify({
                project: {
                  title: detail.project.title,
                  topic: detail.project.topic,
                  question: detail.project.question,
                },
                researcherInput: request.text,
              });
        // A wrongly shaped answer gets one more attempt, still counted against the session budget.
        for (let attempt = 1; ; attempt++) {
          if (this.requests >= settings.maxRequests)
            throw new Error('The request limit for this app session has been reached.');
          this.requests++;
          const response = await this.auth.stream(settings.model, instructions, context, controller.signal, delta =>
            this.emit({ runId: run.id, projectId: run.projectId, type: 'delta', text: delta }),
          );
          if (response.usage)
            run.usage = {
              input: (run.usage?.input ?? 0) + response.usage.input,
              output: (run.usage?.output ?? 0) + response.usage.output,
            };
          try {
            run.result = parseResult(request.role, request.text, response.text);
            break;
          } catch (error) {
            if (
              !(error instanceof FormatError) ||
              attempt >= 2 ||
              controller.signal.aborted ||
              this.requests >= settings.maxRequests
            )
              throw error;
            this.emit({
              runId: run.id,
              projectId: run.projectId,
              type: 'status',
              text: 'The answer was not in the expected format. Asking once more…',
            });
          }
        }
      }
      if (controller.signal.aborted) throw new Error('Cancelled');
      run.status = 'completed';
    } catch (error) {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed';
      run.error = controller.signal.aborted
        ? 'Task cancelled or timed out. Your accepted work is unchanged.'
        : error instanceof Error
          ? error.message
          : 'The task failed. Please retry.';
    } finally {
      clearTimeout(timeout);
      this.active.delete(run.id);
      // A project may have been deleted while its request was in flight.
      try {
        this.store.saveRun(run);
      } catch {}
      this.emit({ runId: run.id, projectId: run.projectId, type: 'status', text: run.status });
    }
    return run;
  }
}
