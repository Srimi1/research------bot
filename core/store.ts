import type { SqlDatabase, SqlValue } from './platform';
import type { EvidenceResult, PlanStep, Project, ProjectDetail, Run, Settings, Source } from '../src/shared/types';
import { canonicalSourceUrl, normalizeDoi } from '../src/shared/source-keys';

type Row = Record<string, SqlValue>;
const randomUUID = () => crypto.randomUUID();
const DEFAULT_SETTINGS: Settings = { model: '', maxRequests: 20, autoUpdate: true };
const SCHEMA_VERSION = 2;
/** Autosave writes a revision after most pauses, so history is bounded per project. */
export const NOTE_HISTORY_LIMIT = 50;
export const NOTE_HISTORY_CHARS = 10_000_000;
const now = () => new Date().toISOString();

function text(value: unknown, name: string, max = 100_000, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`${name} must be ${required ? 'a nonempty' : 'a'} string of at most ${max} characters.`);
  }
  return value;
}

function projectFromRow(row: Row): Project {
  return {
    id: String(row.id),
    title: String(row.title),
    topic: String(row.topic),
    question: String(row.question),
    notes: String(row.notes),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ConcurrentEditError extends Error {
  constructor() {
    super('This project changed since you opened it. Reload it before saving so your newer notes are preserved.');
    this.name = 'ConcurrentEditError';
  }
}

/** All research data stays in the local database; credentials are deliberately stored elsewhere. */
export class Store {
  protected db: SqlDatabase;

  /** Takes ownership of `db`: migrates it, and closes it if the migration fails. */
  constructor(db: SqlDatabase) {
    this.db = db;
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      const version = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
      if (version > SCHEMA_VERSION) throw new Error('This database was created by a newer Research Bot version.');
      if (version < 1)
        this.transaction(() => {
          this.db.exec(`
          CREATE TABLE projects (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, question TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE TABLE note_history (
            id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            notes TEXT NOT NULL, saved_at TEXT NOT NULL
          );
          CREATE INDEX note_history_project ON note_history(project_id, id);
          CREATE TABLE sources (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            doi_key TEXT, url_key TEXT, data TEXT NOT NULL,
            UNIQUE(project_id, doi_key), UNIQUE(project_id, url_key)
          );
          CREATE TABLE plans (
            project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL
          );
          CREATE TABLE runs (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL, data TEXT NOT NULL
          );
          CREATE INDEX runs_project ON runs(project_id, created_at);
          CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
          CREATE TABLE search_cache (cache_key TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
          PRAGMA user_version = 1;
        `);
        });
      if (version < 2)
        this.transaction(() => {
          this.db.exec(`
          ALTER TABLE note_history ADD COLUMN size INTEGER NOT NULL DEFAULT 0;
          UPDATE note_history SET size = LENGTH(notes);
          CREATE TABLE note_redo (
            id INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            notes TEXT NOT NULL, saved_at TEXT NOT NULL
          );
          CREATE INDEX note_redo_project ON note_redo(project_id, id);
          PRAGMA user_version = 2;
        `);
        });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private project(id: string): Project {
    text(id, 'Project ID', 200, true);
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Project not found.');
    return projectFromRow(row);
  }

  private pushHistory(projectId: string, notes: string): void {
    this.db
      .prepare('INSERT INTO note_history(project_id, notes, size, saved_at) VALUES (?, ?, ?, ?)')
      .run(projectId, notes, notes.length, now());
  }

  /** Keep the newest revisions that fit the count and size budgets; the newest is always kept. */
  private pruneHistory(projectId: string): void {
    const rows = this.db
      .prepare('SELECT id, size FROM note_history WHERE project_id = ? ORDER BY id DESC')
      .all(projectId) as Row[];
    let kept = 0;
    let characters = 0;
    const stale: number[] = [];
    for (const row of rows) {
      characters += Number(row.size);
      if (kept >= NOTE_HISTORY_LIMIT || (kept > 0 && characters > NOTE_HISTORY_CHARS)) stale.push(Number(row.id));
      else kept++;
    }
    const remove = this.db.prepare('DELETE FROM note_history WHERE id = ?');
    for (const id of stale) remove.run(id);
  }

  private touch(id: string): void {
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), id);
  }

  listProjects(): Project[] {
    return (this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC, id').all() as Row[]).map(projectFromRow);
  }

  createProject(input: { title: string; topic: string }): ProjectDetail {
    const title = text(input.title, 'Project title', 200, true).trim();
    const topic = text(input.topic, 'Topic', 2_000).trim();
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare('INSERT INTO projects(id, title, topic, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, title, topic, timestamp, timestamp);
    return this.getProject(id);
  }

  getProject(id: string): ProjectDetail {
    const project = this.project(id);
    const sources = (
      this.db.prepare('SELECT data FROM sources WHERE project_id = ? ORDER BY rowid').all(id) as Row[]
    ).map(row => JSON.parse(String(row.data)) as Source);
    const plan = this.db.prepare('SELECT data FROM plans WHERE project_id = ?').get(id) as Row | undefined;
    const runs = (
      this.db
        .prepare('SELECT data FROM runs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC')
        .all(id) as Row[]
    ).map(row => JSON.parse(String(row.data)) as Run);
    return { project, sources, steps: plan ? (JSON.parse(String(plan.data)) as PlanStep[]) : [], runs };
  }

  saveProject(input: Pick<Project, 'id' | 'title' | 'topic' | 'question' | 'notes' | 'version'>): Project {
    text(input.title, 'Project title', 200, true);
    text(input.topic, 'Topic', 2_000);
    text(input.question, 'Research question', 20_000);
    text(input.notes, 'Notes', 1_000_000);
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new Error('Invalid project version.');
    return this.transaction(() => {
      const previous = this.project(input.id);
      if (previous.version !== input.version) throw new ConcurrentEditError();
      if (previous.notes !== input.notes) {
        this.pushHistory(input.id, previous.notes);
        this.pruneHistory(input.id);
        // A fresh edit starts a new timeline, so anything that was undone can no longer be redone.
        this.db.prepare('DELETE FROM note_redo WHERE project_id = ?').run(input.id);
      }
      this.db
        .prepare(
          'UPDATE projects SET title = ?, topic = ?, question = ?, notes = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
        )
        .run(input.title.trim(), input.topic, input.question, input.notes, now(), input.id, input.version);
      return this.project(input.id);
    });
  }

  deleteProject(id: string): void {
    this.project(id);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  saveSource(projectId: string, input: Source): Source {
    this.project(projectId);
    text(input.id, 'Source ID', 200, true);
    text(input.title, 'Source title', 5_000, true);
    if (!Array.isArray(input.authors) || input.authors.length > 1_000) throw new Error('Invalid source authors.');
    input.authors.forEach(author => text(author, 'Author', 2_000));
    for (const field of ['year', 'url', 'doi', 'retrievedAt', 'query'] as const)
      text(input[field], field, field === 'query' ? 20_000 : 4_000);
    for (const field of ['abstract', 'method', 'findings', 'limitations', 'notes'] as const)
      text(input[field], field, 100_000);
    if (
      !['article', 'report', 'forum', 'document'].includes(input.category) ||
      !['metadata', 'abstract', 'full-text', 'user-added'].includes(input.inspected)
    )
      throw new Error('Invalid source classification.');
    const doi = normalizeDoi(input.doi);
    const urlKey = canonicalSourceUrl(input.url);
    return this.transaction(() => {
      const byId = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(input.id) as Row | undefined;
      if (byId && byId.project_id !== projectId) throw new Error('This source belongs to a different project.');
      const matches = this.db
        .prepare(
          'SELECT * FROM sources WHERE project_id = ? AND ((doi_key IS NOT NULL AND doi_key = ?) OR (url_key IS NOT NULL AND url_key = ?))',
        )
        .all(projectId, doi || null, urlKey || null) as Row[];
      const ids = new Set(matches.map(row => row.id));
      if (byId) ids.add(byId.id);
      if (ids.size > 1)
        throw new Error('The DOI and URL refer to different saved sources. Review the source details before saving.');
      const existing = byId ?? matches[0];
      const source: Source = {
        ...input,
        authors: [...input.authors],
        doi,
        id: existing ? String(existing.id) : input.id,
      };
      if (existing && existing.id !== input.id) {
        const previous = JSON.parse(String(existing.data)) as Source;
        for (const field of ['method', 'findings', 'limitations', 'notes'] as const)
          if (!source[field]) source[field] = previous[field];
        if (previous.inspected !== 'metadata' && source.inspected === 'metadata') source.inspected = previous.inspected;
        if (!source.abstract) source.abstract = previous.abstract;
      }
      this.db
        .prepare(
          `INSERT INTO sources(id, project_id, doi_key, url_key, data) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET doi_key = excluded.doi_key, url_key = excluded.url_key, data = excluded.data`,
        )
        .run(source.id, projectId, doi || null, urlKey || null, JSON.stringify(source));
      this.touch(projectId);
      return source;
    });
  }

  deleteSource(projectId: string, sourceId: string): void {
    this.project(projectId);
    const result = this.db.prepare('DELETE FROM sources WHERE project_id = ? AND id = ?').run(projectId, sourceId);
    if (Number(result.changes) !== 1) throw new Error('Source not found in this project.');
    this.touch(projectId);
  }

  saveSteps(projectId: string, steps: PlanStep[]): void {
    this.project(projectId);
    if (!Array.isArray(steps) || steps.length > 200) throw new Error('A research plan supports at most 200 steps.');
    const ids = new Set<string>();
    for (const step of steps) {
      text(step.id, 'Step ID', 200, true);
      text(step.title, 'Step title', 2_000, true);
      for (const field of ['purpose', 'output', 'dependsOn', 'check'] as const) text(step[field], field, 20_000);
      if (typeof step.done !== 'boolean' || ids.has(step.id))
        throw new Error('Plan steps need unique IDs and a completion state.');
      ids.add(step.id);
    }
    this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO plans(project_id, data) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET data = excluded.data',
        )
        .run(projectId, JSON.stringify(steps));
      this.touch(projectId);
    });
  }

  undoNotes(projectId: string): Project {
    return this.transaction(() => {
      const project = this.project(projectId);
      const history = this.db
        .prepare('SELECT id, notes FROM note_history WHERE project_id = ? ORDER BY id DESC LIMIT 1')
        .get(projectId) as Row | undefined;
      if (!history) throw new Error('There is no earlier saved version of these notes.');
      // Keep the text being replaced so the undo itself can be reversed.
      this.db
        .prepare('INSERT INTO note_redo(project_id, notes, saved_at) VALUES (?, ?, ?)')
        .run(projectId, project.notes, now());
      this.db
        .prepare('UPDATE projects SET notes = ?, version = version + 1, updated_at = ? WHERE id = ?')
        .run(history.notes, now(), project.id);
      this.db.prepare('DELETE FROM note_history WHERE id = ? AND project_id = ?').run(history.id, projectId);
      return this.project(projectId);
    });
  }

  redoNotes(projectId: string): Project {
    return this.transaction(() => {
      const project = this.project(projectId);
      const redo = this.db
        .prepare('SELECT id, notes FROM note_redo WHERE project_id = ? ORDER BY id DESC LIMIT 1')
        .get(projectId) as Row | undefined;
      if (!redo) throw new Error('There is no undone change to restore.');
      this.pushHistory(projectId, project.notes);
      this.db
        .prepare('UPDATE projects SET notes = ?, version = version + 1, updated_at = ? WHERE id = ?')
        .run(redo.notes, now(), project.id);
      this.db.prepare('DELETE FROM note_redo WHERE id = ? AND project_id = ?').run(redo.id, projectId);
      return this.project(projectId);
    });
  }

  saveRun(run: Run): void {
    this.project(run.projectId);
    text(run.id, 'Run ID', 200, true);
    text(run.model, 'Model', 200);
    text(run.input, 'Run input', 1_000_000);
    text(run.createdAt, 'Run timestamp', 100, true);
    if (
      !['methods', 'evidence', 'grammar', 'brainstorm'].includes(run.role) ||
      !['running', 'completed', 'cancelled', 'failed'].includes(run.status)
    )
      throw new Error('Invalid agent run.');
    const data = JSON.stringify(run);
    if (data.length > 4_000_000) throw new Error('The agent result is too large to save.');
    this.transaction(() => {
      const existing = this.db.prepare('SELECT project_id FROM runs WHERE id = ?').get(run.id) as Row | undefined;
      if (existing && existing.project_id !== run.projectId)
        throw new Error('This agent run belongs to a different project.');
      this.db
        .prepare(
          'INSERT INTO runs(id, project_id, created_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
        )
        .run(run.id, run.projectId, run.createdAt, data);
    });
  }

  /**
   * A run still marked "running" when the app starts was interrupted by a crash or forced quit.
   * Call once at startup, before any new run begins.
   */
  failInterruptedRuns(): number {
    return this.transaction(() => {
      const rows = this.db
        .prepare("SELECT id, data FROM runs WHERE json_extract(data, '$.status') = 'running'")
        .all() as Row[];
      const update = this.db.prepare('UPDATE runs SET data = ? WHERE id = ?');
      for (const row of rows) {
        const run = JSON.parse(String(row.data)) as Run;
        update.run(
          JSON.stringify({
            ...run,
            status: 'failed',
            error:
              'Research Bot closed before this task finished. Your accepted work is unchanged; run it again if you still need it.',
          }),
          row.id,
        );
      }
      return rows.length;
    });
  }

  getSettings(): Settings {
    const row = this.db.prepare('SELECT data FROM settings WHERE id = 1').get() as Row | undefined;
    // Settings saved before a field existed pick up its default.
    return row
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(String(row.data)) as Partial<Settings>) }
      : { ...DEFAULT_SETTINGS };
  }

  saveSettings(settings: Settings): void {
    text(settings.model, 'Model', 200);
    if (!Number.isSafeInteger(settings.maxRequests) || settings.maxRequests < 1 || settings.maxRequests > 1000)
      throw new Error('Request budget must be an integer between 1 and 1,000.');
    if (typeof settings.autoUpdate !== 'boolean') throw new Error('Automatic updates must be on or off.');
    this.db
      .prepare('INSERT INTO settings(id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(
        JSON.stringify({ model: settings.model, maxRequests: settings.maxRequests, autoUpdate: settings.autoUpdate }),
      );
  }

  getCache(key: string): EvidenceResult | undefined {
    const row = this.db.prepare('SELECT data, expires_at FROM search_cache WHERE cache_key = ?').get(key) as
      Row | undefined;
    if (!row) return undefined;
    if (Number(row.expires_at) <= Date.now()) {
      this.db.prepare('DELETE FROM search_cache WHERE cache_key = ?').run(key);
      return undefined;
    }
    return { ...(JSON.parse(String(row.data)) as EvidenceResult), cached: true };
  }

  setCache(key: string, value: EvidenceResult): void {
    text(key, 'Cache key', 20_000, true);
    const data = JSON.stringify(value);
    if (data.length > 2_000_000 || value.kind !== 'evidence') throw new Error('Invalid evidence cache result.');
    this.transaction(() => {
      this.db.prepare('DELETE FROM search_cache WHERE expires_at <= ?').run(Date.now());
      this.db
        .prepare(
          'INSERT INTO search_cache(cache_key, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at',
        )
        .run(key, data, Date.now() + 24 * 60 * 60 * 1_000);
      this.db.exec(
        'DELETE FROM search_cache WHERE cache_key NOT IN (SELECT cache_key FROM search_cache ORDER BY expires_at DESC LIMIT 200)',
      );
    });
  }

  close(): void {
    this.db.close();
  }
}
