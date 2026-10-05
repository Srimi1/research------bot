import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175'], {
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:5175');
      if (response.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (!process.env.CI && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.crossref.org/works**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        message: {
          items: [
            {
              DOI: '10.1234/ui-fixture',
              title: ['UI test source'],
              author: [{ given: 'Test', family: 'Author' }],
              published: { 'date-parts': [[2025]] },
              type: 'journal-article',
            },
          ],
        },
      }),
    }),
  );
  await page.goto('http://127.0.0.1:5175');
  await page.getByRole('button', { name: 'Create your first project' }).click();
  await page.locator('#project-title').fill('Food waste study');
  await page.locator('#project-topic').fill('Sustainability');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.locator('#research-notes').fill('He go to university.\n');
  await page.locator('#research-question').fill('How can campus food waste be reduced?');
  await page.locator('.save-indicator').filter({ hasText: 'Saved' }).waitFor();
  await page.reload();
  assert.equal(await page.locator('#research-notes').inputValue(), 'He go to university.\n');
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await page.locator('#task-input').fill('campus food waste');
  await page.getByRole('button', { name: 'Find sources', exact: true }).click();
  await page.getByRole('button', { name: 'Save source', exact: true }).click();
  await page.getByRole('button', { name: /^Source library/ }).click();
  await page.getByLabel('notes for UI test source').fill('Read page 3; retained for relevance.');
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await page.getByRole('button', { name: /^Research plan/ }).click();
  await page.getByRole('button', { name: 'Add a step', exact: true }).click();
  await page.getByRole('button', { name: 'Complete: New research step', exact: true }).click();
  await page.getByText('1 of 1 complete', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Account and preferences' }).click();
  const limit = page.locator('#requests');
  await limit.fill('20');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByText('Preferences saved.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Structured assistant fixtures test review controls, not live AI generation.
  await page.evaluate(() => {
    const key = 'research-bot-preview-v1';
    const data = JSON.parse(localStorage.getItem(key));
    const detail = data.projects[0];
    detail.runs.unshift({
      id: crypto.randomUUID(),
      projectId: detail.project.id,
      role: 'grammar',
      status: 'completed',
      model: 'test-fixture',
      input: detail.project.notes,
      createdAt: new Date().toISOString(),
      result: {
        kind: 'grammar',
        original: detail.project.notes,
        proposed: 'He goes to university.\n',
        clarification: '',
        edits: [
          { id: crypto.randomUUID(), before: 'go', after: 'goes', start: 3, end: 5, reason: 'Subject agreement' },
        ],
      },
    });
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Grammar', exact: true }).click();
  assert.equal(await page.locator('#research-notes').inputValue(), 'He go to university.\n');
  await page.getByRole('button', { name: 'Accept correction', exact: true }).click();
  assert.equal(await page.locator('#research-notes').inputValue(), 'He goes to university.\n');
  await page.locator('.save-indicator').filter({ hasText: 'Saved' }).waitFor();
  await page.getByRole('button', { name: 'Undo last saved change', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#research-notes')?.value === 'He go to university.\n');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#research-notes')?.value === 'He goes to university.\n');
  await page.getByRole('button', { name: 'Undo last saved change', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#research-notes')?.value === 'He go to university.\n');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.locator('#project-title').fill('Second project');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  assert.equal(await page.locator('#research-notes').inputValue(), '');
  await page.getByRole('button', { name: /^Source library/ }).click();
  assert.equal(await page.locator('.literature-matrix tbody tr').count(), 0);
  await page.getByRole('button', { name: 'Food waste study Sustainability' }).click();
  await page.getByRole('button', { name: /^Source library/ }).click();
  assert.equal(await page.getByLabel('notes for UI test source').inputValue(), 'Read page 3; retained for relevance.');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON project archive', exact: true }).click();
  const file = await download;
  assert.match(file.suggestedFilename(), /\.json$/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(
    'UI smoke passed: persistence, source notes, plan, settings, grammar review/undo/redo, project isolation, export, and narrow viewport.',
  );
} finally {
  await browser?.close();
  server.kill();
}
