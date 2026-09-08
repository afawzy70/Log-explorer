import { test, expect } from '@playwright/test';
import { setViewport, setZoom, assertNoHorizontalOverflow } from './helpers';

/*
 * H4b (Phase A2b) — proves Playwright is wired to the real running app
 * (the Vite dev server auto-started by playwright.config.ts's webServer),
 * not just to static fixture files. Deliberately minimal: this page is a
 * placeholder (see frontend/src/App.tsx), not the real product UI - Phase
 * F builds that. This test exercises the relocated A2a helper library
 * against a real app for the first time.
 */

test('the real dev server serves the placeholder app and renders its heading', async ({ page }) => {
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
