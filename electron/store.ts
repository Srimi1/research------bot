import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase } from '../core/platform';
import { Store as CoreStore } from '../core/store';

export { ConcurrentEditError, NOTE_HISTORY_CHARS, NOTE_HISTORY_LIMIT } from '../core/store';

/** The desktop store: a node:sqlite file with owner-only permissions and a durable WAL journal. */
export class Store extends CoreStore {
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    super(new DatabaseSync(path) as unknown as SqlDatabase);
    if (path !== ':memory:') {
      try {
        chmodSync(path, 0o600);
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      } catch (error) {
        this.db.close();
        throw error;
      }
    }
  }
}
