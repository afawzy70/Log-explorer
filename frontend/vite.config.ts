import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Phase F: the dev server proxies /api and /actuator to the real backend
// so the app never needs CORS - matching Phase K's "one deployable image,
// same origin" shape even in dev. Legacy Remediation Slice 9 §K formalizes
// the project's two development ports: Spring Boot on 3434, Vite on 3435 -
// production has no separate Vite port at all (Spring Boot serves the
// built static assets directly - see the Dockerfile).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3435,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3434',
      '/actuator': 'http://127.0.0.1:3434',
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
