import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { renameSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * The Android build.
 *
 * Separate from vite.config.ts on purpose: this bundle contains the staff
 * portal and nothing else. The public website — the fleet pages, the wedding
 * planner, the trip assistant — is roughly two thirds of the source and none of
 * it belongs in an app for the office, so it is simply not an entry point here.
 *
 *   npm run build:mobile     ->  dist-mobile/
 *   npx cap sync android     ->  copies that into the Android project
 *
 * VITE_SERVER_URL is compiled in as the default portal address. It is only a
 * default: the app stores an override, so the address can be changed on the
 * phone without rebuilding.
 */
export default defineConfig({
  plugins: [
    react(),
    {
      /**
       * Vite names the output after the input, giving `index.mobile.html`.
       * Capacitor will only load `index.html`, so it is renamed once the
       * bundle is on disk. Doing it here keeps `npm run build:mobile` a
       * single command with no shell glue around it.
       */
      name: 'gtt-mobile-index',
      closeBundle() {
        const out = resolve(__dirname, 'dist-mobile');
        const built = resolve(out, 'index.mobile.html');
        if (existsSync(built)) renameSync(built, resolve(out, 'index.html'));
      },
    },
  ],

  // Assets are referenced relatively so they resolve under Capacitor's
  // https://localhost origin as readily as from a file path.
  base: './',

  build: {
    outDir: 'dist-mobile',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: resolve(__dirname, 'index.mobile.html'),
    },
  },
});
