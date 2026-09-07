import { defineConfig } from '@playwright/test';

/*
 * H4a (Phase A2a) config. No `webServer` — every test in this phase loads a
 * static local fixture file directly, since there is no app to serve yet.
 * Phase A2b replaces/extends this once frontend/ exists and points it at a
 * real dev server.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 900 },
  },
});
