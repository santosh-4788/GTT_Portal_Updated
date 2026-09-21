import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 is taken by another local app on this machine, so the dev server
    // uses 5273 and proxies the API on 4100.
    port: 5273,
    strictPort: true,
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
});
