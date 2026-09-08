import { defineConfig } from '@playwright/test';

/*
 * H4b (Phase A2b) — points the relocated A2a helper library at the real
 * frontend dev server. `webServer` auto-starts `npm run dev` and waits for
 * it to be ready, so `npx playwright test` (and `--list`) work from one
 * command with no manual server juggling.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
