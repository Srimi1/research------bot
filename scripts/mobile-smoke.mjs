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
    // Capture the settled layout, not an entry animation halfway through its fade.
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${name} scrolls sideways by ${overflow}px`);
    if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  };
  await page.goto('http://127.0.0.1:5176');
  await check('welcome');
  // Welcome cards offer a real starting point, while cancelling creates no project.
  await page.getByRole('button', { name: 'Start a project with Evidence finder' }).click();
  await page.locator('#project-title').waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Create your first project' }).click();
  await check('create');
  await page.locator('#project-title').fill('Food waste study');
  await page.locator('#project-topic').fill('Sustainability');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await check('empty-notes');
  await page.getByRole('button', { name: 'Write a first note', exact: true }).click();
  assert.equal(await page.locator('#research-notes').evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'Add a note outline', exact: true }).click();
  assert.match(await page.locator('#research-notes').inputValue(), /What I know\n\nWhat I want to understand/);
  await page.locator('#research-notes').fill('He go to university.\n');
  await page.locator('#research-question').fill('How can campus food waste be reduced?');
  await page.locator('.save-indicator').filter({ hasText: 'Saved' }).waitFor();
  await check('project');
  // Phones show notes and assistants as separate screens, switched from the bottom bar.
  const bottom = page.locator('.bottom-nav');
  await page.getByRole('button', { name: 'Discover sources', exact: true }).click();
  assert.equal(await bottom.getByRole('button', { name: 'Assistants' }).getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.notes-panel').isVisible(), false);
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Search my topic', exact: true }).click();
  assert.equal(await page.locator('#task-input').inputValue(), 'How can campus food waste be reduced?');
  assert.equal(await page.locator('.source-result').count(), 0, 'a prompt must not start an unrequested search');
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
  // Check narrow phones and large text without clipping content horizontally.
  await page.setViewportSize({ width: 320, height: 760 });
  await check('narrow-plan');
  await bottom.getByRole('button', { name: 'Notes', exact: true }).click();
  await check('narrow-notes');
  await page.addStyleTag({
    content: ':root { --text-2xs: 20px; --text-xs: 21px; --text-sm: 22px; --text-base: 23px; --text-md: 24px; }',
  });
  await check('larger-text');
  await page.setViewportSize({ width: 412, height: 892 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bottom.getByRole('button', { name: 'Assistants', exact: true }).click();
  assert.equal(
    await page.locator('.assistant-panel').evaluate(element => getComputedStyle(element).animationName),
    'none',
  );
  assert.equal(
    await page.locator('.bottom-nav-indicator').evaluate(element => getComputedStyle(element).transitionDuration),
    '0s',
  );
  await bottom.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('.sidebar-open').waitFor();
  await check('drawer');
  // The open drawer and its dimmed backdrop sit above the bottom bar, so the bar cannot be tapped.
  const covering = await page.evaluate(() => {
    const bar = document.querySelector('.bottom-nav').getBoundingClientRect();
    const hit = document.elementFromPoint(bar.left + bar.width * 0.75, bar.top + bar.height / 2);
    return Boolean(hit?.closest('.bottom-nav'));
  });
  assert.equal(covering, false, 'the bottom bar is drawn over the open drawer');
  await page.getByRole('button', { name: 'Close navigation' }).first().click();
  await page.locator('.sidebar-open').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Account and preferences' }).click();
  await check('settings');
  await page.keyboard.press('Escape');
  await page.reload();
  assert.equal(await page.locator('#research-notes').inputValue(), 'He go to university.\n');

  // The bottom bar only steps aside for the keyboard: a shorter window without typing (split
  // screen) keeps it, and it returns when the keyboard closes even if the field keeps focus.
  const barVisible = () => page.locator('.bottom-nav').isVisible();
  await page.setViewportSize({ width: 412, height: 440 });
  await page.waitForTimeout(50);
  assert.equal(await barVisible(), true, 'split screen hid the bottom bar');
  await page.setViewportSize({ width: 412, height: 892 });
  await page.locator('#research-notes').focus();
  await page.setViewportSize({ width: 412, height: 520 });
  await page.waitForTimeout(400);
  assert.equal(await barVisible(), false, 'the bottom bar stayed over the keyboard');
  // Moving from one field to another keeps the keyboard up, so the bar stays hidden.
  await page.locator('#research-question').focus();
  await page.waitForTimeout(400);
  assert.equal(await barVisible(), false, 'the bottom bar came back when focus moved between fields');
  await page.setViewportSize({ width: 412, height: 892 });
  await page.waitForTimeout(50);
  assert.equal(await barVisible(), true, 'the bottom bar did not come back after the keyboard closed');
  await page.locator('#research-notes').blur();

  // Notifications stay on screen while they animate in (deleting the project shows one).
  await page.getByRole('button', { name: 'Edit project details' }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();
  await page
    .getByRole('button', { name: /^Delete/ })
    .last()
    .click();
  const toast = page.locator('.toast');
  await toast.waitFor();
  for (let sample = 0; sample < 4; sample++) {
    const box = await toast.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 412, `the notification is off screen (x ${box.x})`);
    await page.waitForTimeout(60);
  }
  assert.deepEqual(errors, []);
  // The welcome shortcut remembers which assistant was chosen after project creation.
  await page.getByRole('button', { name: 'Start a project with Evidence finder' }).click();
  await page.locator('#project-title').fill('A new question');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.locator('.assistant-panel').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Evidence', exact: true }).getAttribute('aria-pressed'), 'true');
  console.log('Mobile layout checks passed.');
} finally {
  await browser?.close();
  server.kill();
}
