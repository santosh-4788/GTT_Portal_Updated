import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { SITEMAP_ALTERNATES, SITEMAP_PAGES } from './src/site/sitemapPages';
import { LANDINGS } from './src/site/seo/landings';
import { prerenderLanding } from './src/site/seo/prerender';

/**
 * __SITE_URL__ in index.html becomes the public site address (VITE_SITE_URL in
 * frontend/.env or the build environment, e.g. https://www.example.com). Link
 * previews and the business JSON-LD want absolute URLs, and link scrapers do
 * not run the app's JavaScript. Left unset it becomes '' and the URLs stay
 * relative - still valid, and the app fills in absolute ones at runtime.
 */
function siteUrl(mode: string): Plugin {
  const url = (loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL ?? '').trim().replace(/\/+$/, '');
  return { name: 'site-url', transformIndexHtml: (html) => html.split('__SITE_URL__').join(url) };
}

/** dist/sitemap-pages.json - the public pages /sitemap.xml lists (see src/site/sitemapPages.ts). */
function sitemapPages(): Plugin {
  return {
    name: 'sitemap-pages',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap-pages.json',
        source: JSON.stringify({ pages: SITEMAP_PAGES, alternates: SITEMAP_ALTERNATES }, null, 1),
      });
    },
  };
}

/**
 * dist/<path>.html for every search landing page (src/site/seo/prerender.ts):
 * index.html with the page's own head tags and text, so the page is complete
 * before any JavaScript runs. Written as <path>.html rather than
 * <path>/index.html so no server adds a trailing-slash redirect; the API
 * server, Vercel (cleanUrls) and GitHub Pages all serve /a/b from a/b.html.
 */
function prerenderLandings(mode: string): Plugin {
  const base = (loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL ?? '').trim().replace(/\/+$/, '');
  let outDir = 'dist';
  return {
    name: 'prerender-landings',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      const template = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      for (const l of LANDINGS) {
        const file = path.join(outDir, `${l.path.replace(/^\//, '')}.html`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, prerenderLanding(template, l, base));
      }
      console.log(`prerendered ${LANDINGS.length} landing pages`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), siteUrl(mode), sitemapPages(), prerenderLandings(mode)],
  server: {
    // 5173 is taken by another local app on this machine, so the dev server
    // uses 5273 and proxies the API on 4100.
    port: 5273,
    strictPort: true,
    // Vite 6 rejects requests whose Host isn't localhost; let ngrok tunnels in.
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io'],
    proxy: {
      '/api': { target: 'http://localhost:4100', changeOrigin: true },
      // Photos live in the project's assets/ folder, not in public/, so that
      // adding one needs no rebuild. In production the API server hands them
      // out; in dev the same requests go through to it. This proxies the WHOLE
      // folder: it used to name only /assets/fleet, so the service-card and
      // destination photos silently 404'd in dev and every card fell back to
      // its placeholder.
      '/assets': { target: 'http://localhost:4100', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
}));
