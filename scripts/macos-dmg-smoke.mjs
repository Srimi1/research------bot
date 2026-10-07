// Mount the installer, copy its actual app as a researcher would, and drive the packaged runtime.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

assert.equal(process.platform, 'darwin', 'DMG validation requires macOS');
const dmg = process.argv[2];
assert.ok(dmg && existsSync(dmg), 'Pass a built DMG');
const work = mkdtempSync(join(tmpdir(), 'research-bot-dmg-'));
const mount = join(work, 'mounted');
let attached = false;
try {
  execFileSync('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount], { stdio: 'inherit' });
  attached = true;
  const app = join(mount, 'Research Bot.app');
  assert.ok(existsSync(app), 'DMG must contain Research Bot.app');
  assert.ok(existsSync(join(mount, 'Applications')), 'DMG must offer an Applications shortcut');
  const installed = join(work, 'Research Bot.app');
  execFileSync('ditto', [app, installed]);
  const executable = join(installed, 'Contents/MacOS/Research Bot');
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  execFileSync('lipo', ['-verify_arch', architecture, executable]);
  assert.ok(existsSync(join(installed, 'Contents/Resources/icon.icns')), 'Packaged app must include its Mac icon');
  execFileSync(process.execPath, ['scripts/electron-smoke.mjs'], {
    stdio: 'inherit',
    timeout: 180_000,
    env: { ...process.env, ELECTRON_SMOKE_EXECUTABLE: executable, RESEARCH_BOT_DISABLE_UPDATES: '1' },
  });
  console.log(`DMG passed: mount, install, ${architecture} executable, icon and packaged research workflows.`);
} finally {
  if (attached) execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit' });
  rmSync(work, { recursive: true, force: true });
}
