// Render the Navratri posters in poster.html to PNG files in this folder.
//
//   node render.js            (needs playwright-core and Microsoft Edge)
//
// Edit the text in poster.html, run this again, and the four images update.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const HERE = __dirname;
const JOBS = [
  ['greeting', 'feed', 1350], ['greeting', 'story', 1920],
  ['garba', 'feed', 1350], ['garba', 'story', 1920],
];

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--allow-file-access-from-files'] });
  for (const [design, size, h] of JOBS) {
    const page = await browser.newPage({ viewport: { width: 1080, height: h }, deviceScaleFactor: 1 });
    await page.goto(`file:///${path.join(HERE, 'poster.html').replace(/\\/g, '/')}?design=${design}&size=${size}`);
    await page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
    await page.waitForTimeout(400);
    const out = path.join(HERE, `GTT-Navratri-${design === 'garba' ? 'Garba-Pickup-Drop' : 'Greeting'}-${size === 'feed' ? 'Post-1080x1350' : 'Status-1080x1920'}.png`);
    // Render to a temporary file first: if the PNG is open in a photo viewer,
    // Windows locks it, and the new design is kept under a "-new" name instead.
    const tmp = out.replace(/\.png$/, '.tmp.png');
    await page.locator('#root').screenshot({ path: tmp });
    let saved = out;
    for (let i = 0; ; i++) {
      try { fs.copyFileSync(tmp, out); break; } catch (e) {
        if (i < 5) { await new Promise((r) => setTimeout(r, 800)); continue; }
        saved = out.replace(/\.png$/, '-new.png');
        fs.copyFileSync(tmp, saved);
        break;
      }
    }
    fs.unlinkSync(tmp);
    console.log('saved', path.basename(saved), saved !== out ? '(the original is open in another program)' : '');
    await page.close();
  }
  await browser.close();
})();
