import { test, expect } from '@playwright/test';
import { setViewport, setZoom, assertNoHorizontalOverflow } from './helpers';

/*
 * H4b (Phase A2b) — proves Playwright is wired to the real running app
 * (the Vite dev server auto-started by playwright.config.ts's webServer),
 * not just to static fixture files. Originally written against Phase
 * A2b's placeholder page; the title and "Log Explorer" heading assertions
 * still hold verbatim now that Phase F's real Shell renders them (see
 * frontend/src/app/Shell.tsx) - see e2e/phase-f-search-ux.spec.ts for
 * Phase F's own dedicated browser checks.
 */

test('the real dev server serves the app and renders its heading', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Log Explorer');
  await expect(page.getByRole('heading', { name: 'Log Explorer' })).toBeVisible();
});

test('the real running app has no page-level horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await setViewport(page, 1280);
  await assertNoHorizontalOverflow(page);
});

test('the real running app survives 200% zoom without horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await setViewport(page, 1280);
  await setZoom(page, 200);
  await assertNoHorizontalOverflow(page);
});
