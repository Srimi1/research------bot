import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunEvent } from '../src/shared/types';
import { Runner as CoreRunner } from '../core/runner';
import type { Store } from '../core/store';
import type { AuthService } from '../core/auth';
import { searchEvidence } from './evidence';

export { FormatError, parseResult, validateGrammar } from '../core/runner';

/** The desktop runner reads agent instructions from the packaged agents/ folder. */
export class Runner extends CoreRunner {
  constructor(store: Store, auth: AuthService, agentDirectory: string, emit: (event: RunEvent) => void) {
    super(store, auth, file => readFileSync(join(agentDirectory, file), 'utf8'), emit, searchEvidence);
  }
}
