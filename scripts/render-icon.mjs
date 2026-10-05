// Renders build/icon.svg to build/icon.png (1024 x 1024, transparent corners).
// electron-builder turns that PNG into the macOS .icns and Windows .ico on its own.
// Run `npm run icon` after editing the SVG. Set CHROMIUM_PATH to use a specific browser.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('build/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body>`);
  await page.locator('svg').screenshot({ path: 'build/icon.png', omitBackground: true });
  console.log('Wrote build/icon.png');
} finally {
  await browser.close();
}
