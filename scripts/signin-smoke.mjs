// "Sign in with ChatGPT" entry points: the welcome screen, the top bar and the agent panel each
// start the official sign-in exactly once, on a phone-sized and a desktop-sized window.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const shots = process.env.SIGNIN_SCREENSHOTS;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5178'], {
  stdio: 'ignore',
});

/** A signed-out account whose sign-in succeeds after a short wait. Runs before the app loads. */
function mockSignedOut(withProject) {
  const project = {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Food waste study',
    topic: 'Sustainability',
    question: '',
    notes: 'Notes',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const detail = { project, sources: [], steps: [], runs: [] };
  let account = { signedIn: false, storageAvailable: true };
  window.signInCalls = 0;
  window.cancelCalls = 0;
  let pending = false;
  let cancel;
  window.research = {
    listProjects: async () => (withProject ? [project] : []),
    getProject: async () => structuredClone(detail),
    createProject: async () => detail,
    saveProject: async input => ({ ...project, ...input, version: input.version + 1 }),
    deleteProject: async () => {},
    saveSource: async (_, source) => source,
    deleteSource: async () => {},
    saveSteps: async () => {},
    undoNotes: async () => project,
    redoNotes: async () => project,
    exportProject: async () => ({ saved: false }),
    account: async () => account,
    // Like AuthService: one sign-in at a time. With window.hangSignIn set, sign-in waits for the
    // browser until cancelled.
    signIn: async () => {
      if (pending) throw new Error('A ChatGPT sign-in is already in progress.');
      window.signInCalls++;
      pending = true;
      try {
        await new Promise((resolve, reject) => {
          if (window.hangSignIn) cancel = () => reject(new Error('ChatGPT sign-in was cancelled.'));
          else setTimeout(resolve, 300);
        });
      } finally {
        pending = false;
      }
      account = { signedIn: true, storageAvailable: true, name: 'Researcher', email: 'researcher@example.com' };
      return account;
    },
    cancelSignIn: async () => {
      window.cancelCalls++;
      cancel?.();
    },
    signOut: async () => {},
    models: async () => (account.signedIn ? ['model-a'] : []),
    getSettings: async () => ({ model: '', maxRequests: 20, autoUpdate: true }),
    saveSettings: async () => {},
    run: async () => {
      throw new Error('not used');
    },
    cancelRun: async () => {},
    openExternal: async () => {},
    onRunEvent: () => () => {},
  };
}

let browser;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:5178')).ok) break;
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
  const errors = [];

  // Phone: welcome screen and top bar.
  const phone = await browser.newPage({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true });
  phone.on('pageerror', error => errors.push(error.message));
  await phone.addInitScript(mockSignedOut, false);
  await phone.goto('http://127.0.0.1:5178');
  const welcomeButton = phone.locator('.welcome-actions').getByRole('button', { name: 'Sign in with ChatGPT' });
  await welcomeButton.waitFor();
  await phone.locator('.topbar-signin').waitFor();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `welcome scrolls sideways by ${overflow}px`);
  if (shots) await phone.screenshot({ path: `${shots}/phone-welcome.png` });
  await welcomeButton.click();
  await phone.getByText('Your ChatGPT account is connected.').waitFor();
  assert.equal(await phone.evaluate(() => window.signInCalls), 1);
  if (shots) await phone.screenshot({ path: `${shots}/phone-connected.png` });
  await phone.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await phone.locator('.topbar-signin').waitFor({ state: 'detached' });
  await phone.getByText('Signed in to ChatGPT as researcher@example.com.').waitFor();

  // Desktop: the agent panel prompt and the top bar button.
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  desktop.on('pageerror', error => errors.push(error.message));
  await desktop.addInitScript(mockSignedOut, true);
  await desktop.goto('http://127.0.0.1:5178');
  const agentPrompt = desktop.locator('.auth-prompt');
  await agentPrompt.getByText('Sign in with ChatGPT to use this agent.').waitFor();
  await desktop.locator('.topbar-signin').waitFor();
  if (shots) await desktop.screenshot({ path: `${shots}/desktop-agent.png` });
  await agentPrompt.getByRole('button', { name: 'Sign in with ChatGPT' }).click();
  await desktop.getByText('Your ChatGPT account is connected.').waitFor();
  assert.equal(await desktop.evaluate(() => window.signInCalls), 1);
  await desktop.keyboard.press('Escape');
  await agentPrompt.waitFor({ state: 'detached' });
  await desktop.locator('.topbar-signin').waitFor({ state: 'detached' });

  // Closing the dialog while the browser sign-in is still open cancels it, so trying again works.
  const closing = await browser.newPage({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true });
  closing.on('pageerror', error => errors.push(error.message));
  await closing.addInitScript(mockSignedOut, false);
  await closing.addInitScript(() => {
    window.hangSignIn = true;
  });
  await closing.goto('http://127.0.0.1:5178');
  await closing.locator('.topbar-signin').click();
  await closing.getByText('Waiting for sign-in…').waitFor();
  await closing.keyboard.press('Escape');
  await closing.waitForFunction(() => window.cancelCalls === 1);
  await closing.locator('.topbar-signin').click();
  await closing.getByText('Waiting for sign-in…').waitFor();
  assert.equal(await closing.evaluate(() => window.signInCalls), 2);
  assert.equal(await closing.getByText('already in progress').count(), 0);

  assert.deepEqual(errors, []);
  console.log(
    'Sign-in entry points passed: welcome, top bar and agent panel each start sign-in once; closing the dialog cancels it.',
  );
} finally {
  await browser?.close();
  server.kill();
}
