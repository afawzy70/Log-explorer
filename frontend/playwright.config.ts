import { defineConfig } from '@playwright/test';

/*
 * H4b (Phase A2b) — points the relocated A2a helper library at the real
 * frontend dev server. `webServer` auto-starts `npm run dev` and waits for
 * it to be ready, so `npx playwright test` (and `--list`) work from one
 * command with no manual server juggling.
 *
 * CI (`.github/workflows/ci.yml`, `E2E` job): the `html` reporter is added
 * only under `process.env.CI` (GitHub Actions sets this automatically) so
 * a local run's `test-results/`/`playwright-report/` output stays exactly
 * as before; in CI it is what the workflow uploads as an artifact on
 * failure. `trace`/`screenshot` are captured only on a failed test's
 * first retry/at all, never on a passing run, keeping local runs just as
 * fast as before.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
  retries: process.env.CI ? 1 : 0,
  use: {
    // Legacy Remediation Slice 9 §K: the frontend dev server's formal port is 3435.
    baseURL: 'http://localhost:3435',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3435',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
