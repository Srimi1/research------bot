import type { Account, ProjectDetail, ResearchAPI, Run, RunEvent, Settings, Source } from './shared/types';

export const isBrowserPreview = !window.research;
const KEY = 'research-bot-preview-v1';
interface Store { projects: ProjectDetail[]; history: Record<string, string[]>; redo?: Record<string, string[]>; settings: Settings; }
const defaults = (): Store => ({ projects: [], history: {}, settings: { model: '', maxRequests: 20 } });
function read(): Store {
  const value = localStorage.getItem(KEY);
  if (!value) return defaults();
  try {
    const parsed = JSON.parse(value) as Store;
    if (!Array.isArray(parsed.projects) || !parsed.history || !parsed.settings) throw new Error();
    return parsed;
  } catch { throw new Error('Browser storage could not be read. Your saved data has not been overwritten.'); }
}
function write(store: Store) { localStorage.setItem(KEY, JSON.stringify(store)); }
function project(store: Store, id: string) {
  const result = store.projects.find(item => item.project.id === id);
  if (!result) throw new Error('This project no longer exists.');
  return result;
}
const account: Account = { signedIn: false, storageAvailable: false, message: 'This is a browser preview. Install the desktop app to sign in with ChatGPT. Projects here are stored in this browser.' };
const iso = () => new Date().toISOString();
const listeners = new Set<(event: RunEvent) => void>();
const controllers = new Map<string, AbortController>();
const emit = (event: RunEvent) => listeners.forEach(callback => callback(event));
function filename(title: string) { return title.replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '-') || 'research-project'; }
function markdown(detail: ProjectDetail) {
  return `# ${detail.project.title}\n\nTopic: ${detail.project.topic}\n\n## Research question\n\n${detail.project.question}\n\n## Researcher's notes\n\n${detail.project.notes}\n\n## Research plan\n\n` + detail.steps.map((step, index) => `${index + 1}. [${step.done ? 'x' : ' '}] ${step.title}\n   Purpose: ${step.purpose}\n   Output: ${step.output}\n   Depends on: ${step.dependsOn}\n   Completion check: ${step.check}`).join('\n\n') + '\n\n## Literature matrix\n\n' + detail.sources.map(source => `### ${source.title}\n\n${source.authors.join(', ')} (${source.year || 'Undated'})\n\nSource: ${source.url}\nDOI: ${source.doi || 'Unavailable'}\nCategory: ${source.category}\nInspected: ${source.inspected}\nRetrieved: ${source.retrievedAt}\nSearch query: ${source.query}\n\nMethod: ${source.method || 'Not recorded'}\n\nFindings: ${source.findings || 'Not recorded'}\n\nLimitations: ${source.limitations || 'Not recorded'}\n\nResearcher's notes: ${source.notes || 'Not recorded'}`).join('\n\n');
}

export const browserAPI: ResearchAPI = {
  async listProjects() { return read().projects.map(detail => detail.project).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
  async createProject(input) {
    if (!input.title.trim()) throw new Error('Give your project a title.');
    const store = read();
    const detail: ProjectDetail = { project: { id: crypto.randomUUID(), title: input.title.trim(), topic: input.topic.trim(), question: '', notes: '', version: 0, createdAt: iso(), updatedAt: iso() }, sources: [], steps: [], runs: [] };
    store.projects.push(detail); write(store); return structuredClone(detail);
  },
  async getProject(id) { return structuredClone(project(read(), id)); },
  async saveProject(input) {
    const store = read(); const detail = project(store, input.id);
    if (detail.project.version !== input.version) throw new Error('This project changed in another window. Reopen it before saving to protect your work.');
    if (detail.project.notes !== input.notes) {
      store.history[input.id] = [...(store.history[input.id] || []), detail.project.notes].slice(-30);
      if (store.redo) delete store.redo[input.id];
    }
    detail.project = { ...detail.project, ...input, version: input.version + 1, updatedAt: iso() };
    write(store); return structuredClone(detail.project);
  },
  async deleteProject(id) { const store = read(); store.projects = store.projects.filter(detail => detail.project.id !== id); delete store.history[id]; if (store.redo) delete store.redo[id]; write(store); },
  async saveSource(id, source) {
    if (!source.title.trim()) throw new Error('A source title is required.');
    const url = new URL(source.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Source links must use HTTP or HTTPS.');
    const store = read(); const detail = project(store, id);
    const index = detail.sources.findIndex(item => item.id === source.id);
    if (index >= 0) detail.sources[index] = structuredClone(source); else detail.sources.push(structuredClone(source));
    write(store); return structuredClone(source);
  },
  async deleteSource(id, sourceId) { const store = read(); const detail = project(store, id); detail.sources = detail.sources.filter(source => source.id !== sourceId); write(store); },
  async saveSteps(id, steps) { const store = read(); project(store, id).steps = structuredClone(steps); write(store); },
  async undoNotes(id) {
    const store = read(); const detail = project(store, id); const history = store.history[id] || [];
    if (!history.length) throw new Error('There is no earlier saved version of these notes.');
    store.redo = { ...store.redo, [id]: [...(store.redo?.[id] || []), detail.project.notes].slice(-30) };
    detail.project.notes = history.pop()!; detail.project.version++; detail.project.updatedAt = iso(); write(store); return structuredClone(detail.project);
  },
  async redoNotes(id) {
    const store = read(); const detail = project(store, id); const redo = store.redo?.[id] || [];
    if (!redo.length) throw new Error('There is no undone change to restore.');
    store.history[id] = [...(store.history[id] || []), detail.project.notes].slice(-30);
    detail.project.notes = redo.pop()!; detail.project.version++; detail.project.updatedAt = iso(); write(store); return structuredClone(detail.project);
  },
  async exportProject(id, format) {
    const detail = project(read(), id); const data = format === 'json' ? JSON.stringify(detail, null, 2) : markdown(detail);
    const url = URL.createObjectURL(new Blob([data], { type: format === 'json' ? 'application/json' : 'text/markdown' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filename(detail.project.title)}.${format === 'json' ? 'json' : 'md'}`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); return { saved: true };
  },
  async account() { return { ...account }; },
  async signIn() { throw new Error('ChatGPT sign-in uses the desktop app and its secure local authentication flow. Browser preview cannot sign in.'); },
  async cancelSignIn() {},
  async signOut() {},
  async models() { return []; },
  async getSettings() { return structuredClone(read().settings); },
  async saveSettings(settings) {
    if (!Number.isInteger(settings.maxRequests) || settings.maxRequests < 1 || settings.maxRequests > 1000) throw new Error('Choose an app-session request limit from 1 to 1,000.');
    const store = read(); store.settings = structuredClone(settings); write(store);
  },
  async run(request) {
    const store = read(); const detail = project(store, request.projectId);
    const run: Run = { id: crypto.randomUUID(), projectId: request.projectId, role: request.role, status: 'running', model: request.role === 'evidence' ? 'Crossref' : '', input: request.text, createdAt: iso() };
    detail.runs.unshift(run); write(store);
    const controller = new AbortController(); controllers.set(run.id, controller);
    emit({ runId: run.id, projectId: run.projectId, type: 'status', text: 'Searching scholarly source metadata…' });
    const timeout = setTimeout(() => controller.abort(new Error('Source search timed out. Please try again.')), 20000);
    try {
      if (request.role !== 'evidence') throw new Error('Sign in with ChatGPT in the desktop app to use this agent. No AI request was sent.');
      if (!request.text.trim()) throw new Error('Enter a topic or research question to search.');
      const response = await fetch(`https://api.crossref.org/works?query=${encodeURIComponent(request.text)}&rows=12`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Crossref search returned ${response.status}. Please try again.`);
      const data = await response.json();
      if (!Array.isArray(data.message?.items)) throw new Error('The source service returned an unexpected response.');
      const sources: Source[] = data.message.items.filter((item: any) => item.title?.[0] && item.DOI).map((item: any) => ({
        id: crypto.randomUUID(), title: String(item.title[0]).replace(/<[^>]+>/g, ''), authors: (item.author || []).map((author: any) => [author.given, author.family].filter(Boolean).join(' ') || author.name || 'Unknown author'),
        year: String((item.published?.['date-parts'] || item.issued?.['date-parts'])?.[0]?.[0] || ''), url: `https://doi.org/${item.DOI}`, doi: item.DOI,
        category: item.type === 'report' ? 'report' : 'article', inspected: 'metadata', retrievedAt: iso(), abstract: String(item.abstract || '').replace(/<[^>]+>/g, ''), query: request.text, method: '', findings: '', limitations: '', notes: '',
      }));
      run.result = { kind: 'evidence', query: request.text, sources, cached: false, limitations: 'Crossref provides scholarly metadata. Results are candidates for your review; their contents and support for claims have not been verified. Reports and forums require other search routes or manual entry.' };
      run.status = 'completed';
    } catch (error) {
      run.status = controller.signal.aborted && !controller.signal.reason?.message?.includes('timed out') ? 'cancelled' : 'failed';
      run.error = error instanceof Error ? error.message : 'Source search failed.';
    } finally { clearTimeout(timeout); controllers.delete(run.id); }
    const latest = read(); const target = latest.projects.find(item => item.project.id === run.projectId);
    if (target) { target.runs = target.runs.map(item => item.id === run.id ? run : item); write(latest); }
    return structuredClone(run);
  },
  async cancelRun(id) { controllers.get(id)?.abort(); },
  async openExternal(url) {
    const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Only web links can be opened.');
    window.open(parsed.href, '_blank', 'noopener,noreferrer');
  },
  onRunEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
};
