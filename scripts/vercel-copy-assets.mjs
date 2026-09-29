// Copy the brand and fleet images from assets/ into the built website, so
// Vercel serves them from its CDN at the same /assets/... addresses the portal
// uses on the office PC (where Express serves them from assets/ directly).
// Files the website build already produced under dist/assets are left alone.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const from = path.join(root, 'assets');
const to = path.join(root, 'frontend', 'dist', 'assets');

let copied = 0;
const walk = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) walk(s, d);
    else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); copied++; }
  }
};
walk(from, to);
console.log(`vercel-copy-assets: ${copied} files copied into frontend/dist/assets`);
