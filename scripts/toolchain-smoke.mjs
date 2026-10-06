// Exercise the APIs used by build tools whose vulnerable transitive dependencies are overridden.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const quote = createRequire(require.resolve('concurrently'))('shell-quote');
assert.deepEqual(quote.parse('vite --host "127.0.0.1"'), ['vite', '--host', '127.0.0.1']);
const xcode = createRequire(require.resolve('@capacitor/cli/package.json'))('xcode');
const project = xcode.project('compatibility.pbxproj');
project.hash = { project: { objects: {} } };
const ids = new Set(Array.from({ length: 100 }, () => project.generateUuid()));
assert.equal(ids.size, 100);
for (const id of ids) assert.match(id, /^[0-9A-F]{24}$/);

// Legacy @electron/get calls global-agent.bootstrap(). Verify actual proxy routing in a child
// process: the bootstrap patches Node's HTTP globals, so it must stay isolated from other tests.
const builderRequire = createRequire(require.resolve('app-builder-lib'));
const getPath = builderRequire.resolve('@electron/get');
const proxyCheck = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
  import assert from 'node:assert/strict';
  import http from 'node:http';
  import { createRequire } from 'node:module';
  const proxy = http.createServer((req, res) => {
    assert.equal(req.url, 'http://proxy-check.invalid/artifact');
    res.end('proxied artifact');
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    process.env.GLOBAL_AGENT_HTTP_PROXY = 'http://127.0.0.1:' + proxy.address().port;
    createRequire(import.meta.url)(${JSON.stringify(getPath)}).initializeProxy();
    const body = await new Promise((resolve, reject) => {
      http.get('http://proxy-check.invalid/artifact', res => {
        let text = '';
        res.on('data', chunk => text += chunk);
        res.on('end', () => resolve(text));
      }).on('error', reject);
    });
    assert.equal(body, 'proxied artifact');
  } finally { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
`,
  ],
  {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, GLOBAL_AGENT_NO_PROXY: '', GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE: 'GLOBAL_AGENT_' },
  },
);
assert.equal(proxyCheck.status, 0, proxyCheck.stderr || proxyCheck.error?.message);
console.log('Build dependency compatibility checks passed (command parsing, Xcode IDs, Electron proxy).');
