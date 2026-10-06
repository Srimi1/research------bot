// Phone-sized browser workflow (the OnePlus 7T Pro's 412x892 CSS viewport): every screen fits
// without sideways scrolling, the project drawer opens and closes, and work survives a reload.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const shots = process.env.MOBILE_SCREENSHOTS;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5176'], {
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:5176');
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
  const page = await browser.newPage({
    viewport: { width: 412, height: 892 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
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
              DOI: '10.1234/mobile-fixture',
              title: ['Reducing campus food waste: a review of interventions with a long title'],
              author: [{ given: 'Test', family: 'Author' }],
              published: { 'date-parts': [[2025]] },
              type: 'journal-article',
            },
          ],
        },
      }),
    }),
  );
  if (shots) mkdirSync(shots, { recursive: true });
  const check = async name => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${name} scrolls sideways by ${overflow}px`);
    if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  };
  await page.goto('http://127.0.0.1:5176');
  await check('welcome');
  await page.getByRole('button', { name: 'Create your first project' }).click();
  await check('create');
  await page.locator('#project-title').fill('Food waste study');
  await page.locator('#project-topic').fill('Sustainability');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.locator('#research-notes').fill('He go to university.\n');
  await page.locator('#research-question').fill('How can campus food waste be reduced?');
  await page.locator('.save-indicator').filter({ hasText: 'Saved' }).waitFor();
  await check('project');
  // Phones show notes and assistants as separate screens, switched from the bottom bar.
  const bottom = page.locator('.bottom-nav');
  await bottom.getByRole('button', { name: 'Assistants' }).click();
  assert.equal(await page.locator('.notes-panel').isVisible(), false);
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await page.locator('#task-input').fill('campus food waste');
  await page.getByRole('button', { name: 'Find sources', exact: true }).click();
  await page.getByRole('button', { name: 'Save source', exact: true }).click();
  await check('evidence');
  assert.equal(await page.locator('.view-nav').isVisible(), false);
  await bottom.getByRole('button', { name: /Sources/ }).click();
  // Each saved source is a card with labelled fields, not a sideways-scrolling table.
  await page.locator('.literature-matrix td[data-label="Key findings"]').first().waitFor();
  assert.equal(await page.locator('.literature-matrix thead').isVisible(), false);
  await check('library');
  await bottom.getByRole('button', { name: /Plan/ }).click();
  await check('plan');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('.sidebar-open').waitFor();
  await check('drawer');
  await page.getByRole('button', { name: 'Close navigation' }).first().click();
  await page.locator('.sidebar-open').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Account and preferences' }).click();
  await check('settings');
  await page.keyboard.press('Escape');
  await page.reload();
  assert.equal(await page.locator('#research-notes').inputValue(), 'He go to university.\n');
  assert.deepEqual(errors, []);
  console.log('Mobile layout checks passed.');
} finally {
  await browser?.close();
  server.kill();
}
