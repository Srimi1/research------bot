import initSqlJs, { type Database } from 'sql.js';
import type { FileStore, SqlDatabase, SqlStatement, SqlValue } from '../../core/platform';

const DATABASE_FILE = 'research.sqlite';

/** Batches writes: one save covers every change made within this window. */
export const SAVE_DELAY_MS = 1_000;
/** After a failed save (for example a full disk), try again this much later. */
export const RETRY_DELAY_MS = 5_000;

/**
 * SQLite compiled to WebAssembly, kept in memory and written to app-private storage.
 * Every write goes through run() or exec(). Saving exports the whole file, so changes are batched:
 * the file is written one second after the last change, and immediately when the app goes to the
 * background (see src/android/api.ts). A failed save keeps the changes pending and retries.
 */
export class PersistentDatabase implements SqlDatabase {
  private dirty = false;
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(
    private db: Database,
    private files: FileStore,
    private warn: (message: string) => void,
  ) {}

  static async open(
    files: FileStore,
    wasmUrl?: string,
    warn: (message: string) => void = message => console.warn(message),
  ): Promise<PersistentDatabase> {
    const SQL = await initSqlJs(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
    const saved = await files.read(DATABASE_FILE);
    let db: Database;
    try {
      db = saved ? new SQL.Database(saved) : new SQL.Database();
    } catch {
      throw new Error('Research Bot’s saved projects could not be opened. Your data file has not been changed.');
    }
    return new PersistentDatabase(db, files, warn);
  }

  private changed(): void {
    this.dirty = true;
    this.schedule(SAVE_DELAY_MS);
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush().catch(() => undefined);
    }, ms);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    if (!/^\s*PRAGMA\s+(foreign_keys|busy_timeout)/i.test(sql)) this.changed();
  }

  prepare(sql: string): SqlStatement {
    const db = this.db;
    const bind = (params: SqlValue[]) =>
      params.map(value => (typeof value === 'bigint' ? Number(value) : value)) as (
        string | number | null | Uint8Array
      )[];
    const rows = (params: SqlValue[], limit: number) => {
      const statement = db.prepare(sql);
      try {
        statement.bind(bind(params));
        const result: Record<string, SqlValue>[] = [];
        while (result.length < limit && statement.step())
          result.push(statement.getAsObject() as Record<string, SqlValue>);
        return result;
      } finally {
        statement.free();
      }
    };
    return {
      run: (...params) => {
        const statement = db.prepare(sql);
        try {
          statement.run(bind(params));
        } finally {
          statement.free();
        }
        const changes = db.getRowsModified();
        this.changed();
        return { changes };
      },
      get: (...params) => rows(params, 1)[0],
      all: (...params) => rows(params, Infinity),
    };
  }

  /** Write pending changes to disk. Safe to call often; writes are serialized. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (!this.dirty || this.closed) return;
        this.dirty = false;
        // export() closes and reopens the connection, which resets per-connection pragmas.
        const bytes = this.db.export();
        this.db.exec('PRAGMA foreign_keys = ON;');
        try {
          await this.files.write(DATABASE_FILE, bytes);
        } catch (error) {
          this.dirty = true;
          this.warn(
            `Research Bot could not save its data and will retry: ${error instanceof Error ? error.message : error}`,
          );
          if (!this.closed) this.schedule(RETRY_DELAY_MS);
          throw error;
        }
      });
    return this.queue;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.db.close();
  }
}
