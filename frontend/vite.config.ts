import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SITEMAP_PAGES } from './src/site/sitemapPages';

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
        source: JSON.stringify({ pages: SITEMAP_PAGES }, null, 1),
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), siteUrl(mode), sitemapPages()],
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
