// Renders the Android launcher icons from public/app-icon.png: legacy square and round icons, and
// the adaptive-icon foreground (the artwork sits inside the 66 dp safe circle of a 108 dp layer,
// over a background of the same green). Run `npm run icon:android` after changing the app icon.
// Set CHROMIUM_PATH to use a specific browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const RES = 'android/app/src/main/res';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const source = `data:image/png;base64,${readFileSync('public/app-icon.png').toString('base64')}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  const render = (size, shape, scale) =>
    page.evaluate(
      async ({ source, size, shape, scale }) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        if (shape === 'round') {
          context.beginPath();
          context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          context.clip();
        } else if (shape === 'square') {
          const radius = size * 0.18;
          context.beginPath();
          context.roundRect(0, 0, size, size, radius);
          context.clip();
        }
        const drawn = size * scale;
        context.drawImage(image, (size - drawn) / 2, (size - drawn) / 2, drawn, drawn);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { source, size, shape, scale },
    );
  const background = await page.evaluate(async source => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.drawImage(image, 8, 8, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b]
      .map(value => value.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`;
  }, source);
  for (const [name, factor] of Object.entries(densities)) {
    const write = (file, data) => writeFileSync(`${RES}/mipmap-${name}/${file}`, Buffer.from(data, 'base64'));
    write('ic_launcher.png', await render(48 * factor, 'square', 1));
    write('ic_launcher_round.png', await render(48 * factor, 'round', 1));
    // The artwork spans about 76% of the source, so at 0.8 it fits the 66 dp safe circle while the
    // square's edges stay outside the 72 dp area a launcher ever shows.
    write('ic_launcher_foreground.png', await render(108 * factor, 'none', 0.8));
  }
  writeFileSync(
    `${RES}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${background}</color>\n</resources>\n`,
  );
  console.log(`Wrote Android launcher icons (background ${background}).`);
} finally {
  await browser.close();
}
