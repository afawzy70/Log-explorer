import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Phase F: the dev server proxies /api and /actuator to the real backend
// (default port 8080) so the app never needs CORS - matching Phase K's
// "one deployable image, same origin" shape even in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/actuator': 'http://127.0.0.1:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    restoreMocks: true,
    // e2e/** is Playwright's own suite (test:e2e) - vitest must never pick
    // it up, its test()/describe() come from a different test runner.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
