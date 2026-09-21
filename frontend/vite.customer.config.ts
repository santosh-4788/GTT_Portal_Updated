import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { renameSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * The customer Android app.
 *
 * A third bundle beside the website and the staff app, containing only what a
 * customer needs: book a trip, see their trips, track one, manage their
 * account. No admin screens are reachable from it and no staff session can
 * exist in it — see the note in src/customer/main.tsx.
 *
 *   npm run build:customer                      ->  dist-customer/
 *   cd customer-app && npx cap sync android     ->  into its Android project
 *
 * VITE_SERVER_URL is compiled in as the default portal address, exactly as for
 * the staff app. It is only a default: the app stores an override, so the
 * address can be changed on the phone without rebuilding.
 */
export default defineConfig({
  plugins: [
    react(),
    {
      /**
       * Vite names the output after the input, giving `index.customer.html`.
       * Capacitor will only load `index.html`, so it is renamed once the
       * bundle is on disk — which keeps the build a single command.
       */
      name: 'gtt-customer-index',
      closeBundle() {
        const out = resolve(__dirname, 'dist-customer');
        const built = resolve(out, 'index.customer.html');
        if (existsSync(built)) renameSync(built, resolve(out, 'index.html'));
      },
    },
  ],

  // Relative, so assets resolve under Capacitor's http://localhost origin.
  base: './',

  build: {
    outDir: 'dist-customer',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: resolve(__dirname, 'index.customer.html'),
    },
  },
});
