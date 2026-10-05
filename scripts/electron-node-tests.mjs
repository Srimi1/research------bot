// Runs the SQLite-backed tests inside Electron's bundled Node, the runtime users actually get,
// so a node:sqlite change in an Electron upgrade fails CI instead of failing on someone's machine.
import { spawnSync } from 'node:child_process';
import electron from 'electron';

const result = spawnSync(electron, ['node_modules/tsx/dist/cli.mjs', '--test', 'tests/store.test.ts', 'tests/runner.test.ts', 'tests/network.test.ts'], {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(result.status ?? 1);
