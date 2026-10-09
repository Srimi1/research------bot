// Synthetic AI/API fixture: exercise review selection, explicit acceptance, recovery and phone controls.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5184'], {
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch('http://127.0.0.1:5184')).ok) break;
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    const date = new Date().toISOString();
    const original = 'My original researcher notes.';
    const project = {
      id: 'f071e967-8430-401e-8b26-3c26f827ffae',
      title: 'Literature fixture',
      topic: 'Plate waste',
      question: 'How do portions affect plate waste?',
      notes: original,
      version: 0,
      createdAt: date,
      updatedAt: date,
    };
    const source = (id, title, abstract) => ({
      id,
      title,
      authors: ['Synthetic Author'],
      year: '2025',
      url: `https://example.org/${id}`,
      doi: '',
      category: 'article',
      inspected: abstract ? 'abstract' : 'metadata',
      retrievedAt: date,
      query: '',
      abstract,
      method: '',
      findings: '',
      limitations: '',
      notes: '',
    });
    const defaults = [
      {
        project,
        sources: [
          source(
            'd494de6b-4efe-4225-8473-e09542cdb6e6',
            'Portion pilot',
            'Smaller portions were associated with less plate waste in one dining hall.',
          ),
          source(
            '3a7d61f3-1931-4b1c-a10f-78988cebb2cb',
            'Waste audit',
            'A campus waste audit recorded leftovers over five days.',
          ),
          source('5a8fbf23-3933-4b83-8e25-c4ad88200870', 'Metadata only', ''),
        ],
        steps: [],
        runs: [],
        undo: [],
        redo: [],
      },
      {
        project: { ...project, id: '5164e275-0201-43d2-b170-9c76a03e69bc', title: 'Other project', notes: '' },
        sources: [],
        steps: [],
        runs: [],
        undo: [],
        redo: [],
      },
    ];
    const details = JSON.parse(localStorage.getItem('literature-ui-fixture') || 'null') || defaults;
    const write = () => localStorage.setItem('literature-ui-fixture', JSON.stringify(details));
    const detail = id => details.find(item => item.project.id === id);
    let event;
    window.reviewRequests = [];
    window.openedSources = [];
    window.research = {
      listProjects: async () => details.map(item => structuredClone(item.project)),
      getProject: async id => structuredClone(detail(id)),
      account: async () => ({ signedIn: true, storageAvailable: true, name: 'Synthetic account' }),
      saveProject: async input => {
        if (window.failNextSave) {
          window.failNextSave = false;
          throw new Error('Synthetic disk write failed');
        }
        const current = detail(input.id);
        if (input.notes !== current.project.notes) {
          current.undo.push(current.project.notes);
          current.redo = [];
        }
        current.project = { ...current.project, ...input, version: current.project.version + 1 };
        write();
        return structuredClone(current.project);
      },
      saveSource: async (id, source) => {
        const current = detail(id);
        current.sources = current.sources.map(item => (item.id === source.id ? source : item));
        write();
        return structuredClone(source);
      },
      deleteSource: async (id, sourceId) => {
        detail(id).sources = detail(id).sources.filter(source => source.id !== sourceId);
        write();
      },
      undoNotes: async id => {
        const current = detail(id);
        current.redo.push(current.project.notes);
        current.project.notes = current.undo.pop();
        current.project.version++;
        write();
        return structuredClone(current.project);
      },
      redoNotes: async id => {
        const current = detail(id);
        current.undo.push(current.project.notes);
        current.project.notes = current.redo.pop();
        current.project.version++;
        write();
        return structuredClone(current.project);
      },
      exportProject: async id => {
        window.exportedNotes = detail(id).project.notes;
        return { saved: true };
      },
      openExternal: async url => {
        window.openedSources.push(url);
      },
      onRunEvent: callback => {
        event = callback;
        return () => {};
      },
      getSettings: async () => ({ model: 'fixture', maxRequests: 20, autoUpdate: false }),
      run: async request => {
        window.reviewRequests.push(structuredClone(request));
        const current = detail(request.projectId);
        const references = request.sourceIds.map((id, index) => {
          const source = current.sources.find(item => item.id === id);
          return {
            id: `S${index + 1}`,
            sourceId: source.id,
            title: source.title,
            authors: source.authors,
            authorCount: source.authors.length,
            year: source.year,
            url: source.url,
            doi: source.doi,
            material: source.notes ? 'abstract-and-notes' : 'abstract',
            truncatedFields: [],
            excerpts: {
              abstract: source.abstract,
              method: source.method,
              findings: source.findings,
              limitations: source.limitations,
              notes: source.notes,
            },
          };
        });
        const run = {
          id: crypto.randomUUID(),
          projectId: request.projectId,
          role: 'literature',
          status: 'completed',
          model: 'fixture',
          input: request.text,
          createdAt: date,
          result: {
            kind: 'literature',
            title: 'Plate waste: a cited draft',
            references,
            sections: [
              {
                heading: 'Evidence and setting',
                paragraphs: references.map(ref => ({
                  text: 'This paper provides evidence from a limited setting.',
                  citations: [{ sourceId: ref.id, field: 'abstract', quote: ref.excerpts.abstract }],
                })),
              },
            ],
            limitations: ['The available abstracts do not establish causality.'],
          },
        };
        event({ runId: run.id, projectId: request.projectId, type: 'status', text: 'Synthetic review' });
        current.runs.unshift(run);
        write();
        return structuredClone(run);
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5184');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const draft = page.getByRole('button', { name: 'Draft literature review', exact: true });
  assert.equal(await draft.isDisabled(), true);
  assert.equal(await page.getByRole('checkbox', { name: /Metadata only/ }).isDisabled(), true);
  await page.getByRole('checkbox', { name: /Portion pilot/ }).check();
  await draft.click();
  const review = page.getByRole('article', { name: 'Literature review draft' });
  await review.waitFor();
  const request = await page.evaluate(() => window.reviewRequests[0]);
  assert.deepEqual(request.sourceIds, ['d494de6b-4efe-4225-8473-e09542cdb6e6']);
  assert.doesNotMatch(request.text, /My original researcher notes/);
  assert.equal(await page.locator('#research-notes').inputValue(), 'My original researcher notes.');
  await review.locator('summary').click();
  await review.getByText('“Smaller portions were associated with less plate waste in one dining hall.”').waitFor();
  await review.getByRole('button', { name: 'Portion pilot' }).click();
  assert.equal((await page.evaluate(() => window.openedSources)).length, 1);
  const accept = review.getByRole('button', { name: 'Add reviewed draft to notes' });
  await page.evaluate(() => {
    window.failNextSave = true;
  });
  await accept.click();
  await review.getByRole('status').filter({ hasText: 'Synthetic disk write failed' }).waitFor();
  assert.equal(await page.locator('#research-notes').inputValue(), 'My original researcher notes.');
  assert.equal(await accept.isEnabled(), true);
  await accept.click();
  await review.getByRole('button', { name: 'Added to notes' }).waitFor();
  const accepted = await page.locator('#research-notes').inputValue();
  assert.match(accepted, /^My original researcher notes\.\n\n## Plate waste/);
  assert.match(accepted, /### References/);
  assert.match(accepted, /not a systematic review/);
  await page.getByRole('button', { name: 'Undo last saved change' }).click();
  assert.equal(await page.locator('#research-notes').inputValue(), 'My original researcher notes.');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal(await page.locator('#research-notes').inputValue(), accepted);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Markdown/ }).click();
  assert.equal(await page.evaluate(() => window.exportedNotes), accepted);
  await page.getByRole('button', { name: 'Undo last saved change' }).click();
  await page.getByRole('button', { name: /Source library/ }).click();
  await page
    .getByRole('textbox', { name: 'notes for Portion pilot', exact: true })
    .fill('New saved reading notes change the supplied evidence.');
  await page.getByRole('row').filter({ hasText: 'Portion pilot' }).getByRole('button', { name: 'Save notes' }).click();
  await page.getByRole('button', { name: 'Literature review', exact: true }).click();
  await review.getByText(/Sources changed after this draft/).waitFor();
  assert.equal(await accept.isDisabled(), true);
  await draft.click();
  assert.equal(await accept.isEnabled(), true);
  await page.getByRole('button', { name: /Source library/ }).click();
  await page.getByRole('button', { name: 'Remove Portion pilot', exact: true }).click();
  await page.getByRole('button', { name: 'Literature review', exact: true }).click();
  await review.getByText(/Sources changed after this draft/).waitFor();
  assert.equal(await review.getByRole('button', { name: 'Portion pilot' }).count(), 1);
  assert.equal(await draft.isDisabled(), true);
  await page.locator('.project-link').filter({ hasText: 'Other project' }).click();
  assert.equal(await page.getByRole('checkbox').count(), 0);
  await page.locator('.project-link').filter({ hasText: 'Literature fixture' }).click();
  await page.setViewportSize({ width: 412, height: 892 });
  await page.locator('.bottom-nav').getByRole('button', { name: 'Assistants', exact: true }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('checkbox', { name: /Waste audit/ }).check();
  await draft.click();
  await review.waitFor();
  const fit = async label => {
    await page.waitForTimeout(200);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${label} scrolls sideways`,
    );
    for (const button of await page.locator('.role-tabs button').all()) {
      const box = await button.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `${label} has a small agent touch control`);
    }
  };
  await fit('412px review');
  if (process.env.LITERATURE_SCREENSHOTS) {
    mkdirSync(process.env.LITERATURE_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: `${process.env.LITERATURE_SCREENSHOTS}/literature-review-412.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await fit('320px review');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = ':root { --text-boost: 8px; --text-boost-large: 8px; } .role-tabs button { font-size: 16px; }';
    style.id = 'large-text-fixture';
    document.head.append(style);
  });
  await fit('320px enlarged text review');
  await page.evaluate(() => document.getElementById('large-text-fixture').remove());
  await page.reload();
  await page.locator('.bottom-nav').getByRole('button', { name: 'Assistants', exact: true }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await review.getByRole('button', { name: 'Waste audit' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS literature UI: explicit source selection, metadata exclusion, cited excerpts, original notes retained, failed-save recovery, acceptance/undo/redo/export, changed/deleted source protection, project isolation, 412px/320px/enlarged text and saved draft reload. AI/API responses were synthetic.',
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
