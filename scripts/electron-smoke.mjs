// Drives the real desktop app (main process, preload, IPC and SQLite) under Electron.
// Run after `npm run build`. On Linux CI wrap it in xvfb-run. Set ELECTRON_SMOKE_EXECUTABLE to test a packaged build.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';

const userData = mkdtempSync(join(tmpdir(), 'research-bot-electron-'));
const executable = process.env.ELECTRON_SMOKE_EXECUTABLE || electronPath;
const args = process.env.ELECTRON_SMOKE_EXECUTABLE ? ['--no-sandbox'] : ['.', '--no-sandbox'];
const env = { ...process.env, RESEARCH_BOT_USER_DATA: userData };
const launch = async () => {
  const app = await electron.launch({ executablePath: executable, args, env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return { app, page, errors };
};
const notes = page => page.locator('#research-notes');
const toast = page => page.locator('.toast');

try {
  let { app, page, errors } = await launch();
  await page.getByRole('button', { name: 'Create your first project' }).click();
  await page.locator('#project-title').fill('Electron smoke');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  for (const draft of ['First draft', 'Second draft']) {
    await notes(page).fill(draft);
    await page.locator('.save-indicator').filter({ hasText: 'Saved' }).waitFor();
  }
  await page.getByRole('button', { name: 'Undo last saved change', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#research-notes')?.value === 'First draft');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#research-notes')?.value === 'Second draft');

  // A backend failure must arrive as a plain sentence, without Electron's IPC prefix.
  // Clear the success notice first so the check cannot read it instead of the error.
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await toast(page).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const error = page.locator('.toast.toast-error');
  await error.waitFor();
  const message = await error.innerText();
  assert.match(message, /There is no undone change to restore\./);
  assert.doesNotMatch(message, /Error invoking remote method|Error:/);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();

  // The main process answers account requests (no keychain is available under xvfb).
  await page.getByRole('button', { name: 'Account and preferences' }).click();
  await page.getByText('Account & preferences').waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // A second launch with the same data folder must exit without opening a window.
  const second = spawn(executable, args, { env, stdio: 'ignore' });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('Second instance did not exit'));
    }, 20_000);
    second.on('exit', value => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  assert.equal(code, 0);
  assert.equal(app.windows().length, 1);
  assert.deepEqual(errors, []);
  await app.close();

  // Simulate a crash during an assistant run, then restart.
  const db = new DatabaseSync(join(userData, 'research.sqlite'));
  const project = db.prepare('SELECT id FROM projects').get();
  db.prepare('INSERT INTO runs(id, project_id, created_at, data) VALUES (?, ?, ?, ?)').run(
    'crashed-run',
    project.id,
    '2026-10-05T00:00:00.000Z',
    JSON.stringify({
      id: 'crashed-run',
      projectId: project.id,
      role: 'brainstorm',
      status: 'running',
      model: 'm',
      input: 'interrupted',
      createdAt: '2026-10-05T00:00:00.000Z',
    }),
  );
  db.close();

  ({ app, page, errors } = await launch());
  await page.waitForFunction(() => document.querySelector('#research-notes')?.value === 'Second draft');
  await page.getByRole('button', { name: /^Task history/ }).click();
  await page.getByText('Research Bot closed before this task finished', { exact: false }).waitFor();
  assert.deepEqual(errors, []);
  await app.close();
  console.log(
    'Electron smoke passed: IPC, persistence, undo/redo, readable errors, single instance, interrupted runs.',
  );
} finally {
  rmSync(userData, { recursive: true, force: true });
}
