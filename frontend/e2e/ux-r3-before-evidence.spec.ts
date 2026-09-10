import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { captureScreenshot, setViewport } from './helpers';

const PHASE = 'UX_R3_EVIDENCE';

async function gotoFixture(page: Page) {
  await page.goto('/');
  await page.selectOption('select', 'fixture');
}

async function alwaysFailLiveConnections(page: Page) {
  await page.route('**/api/v1/logs/live**', (route: Route) => route.abort('failed'));
}

test.describe('UX-R3 BEFORE evidence - current rendered UI, pre-redesign', () => {
  test('A/B: Docker Settings - Local and Remote modes', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /docker settings/i }).click();
    await expect(page.getByRole('dialog', { name: /docker connection/i })).toBeVisible();
    await captureScreenshot(page, PHASE, 'BEFORE-A-docker-settings-local');

    await page.getByLabel('Mode').selectOption('REMOTE');
    await captureScreenshot(page, PHASE, 'BEFORE-B-docker-settings-remote');
  });

  test('G: Search workspace - no scope visibility beyond source name', async ({ page }) => {
    await gotoFixture(page);
    await captureScreenshot(page, PHASE, 'BEFORE-G-search-workspace-scope');
  });

  test('I/J/K/M: Live states - connecting, active, paused, back-to-search', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /^live$/i }).click();
    await captureScreenshot(page, PHASE, 'BEFORE-I-live-connecting');

    await expect(page.getByText(/^live$/i).first()).toBeVisible({ timeout: 10_000 });
    await captureScreenshot(page, PHASE, 'BEFORE-J-live-active');

    await page.getByRole('button', { name: /^pause$/i }).click();
    await captureScreenshot(page, PHASE, 'BEFORE-K-live-paused');

    await page.getByRole('button', { name: /back to search results/i }).click();
    await expect(page.getByRole('button', { name: /^search$/i })).toBeVisible();
    await captureScreenshot(page, PHASE, 'BEFORE-M-back-to-search');
  });

  test('L: Live reconnecting (deterministic route-abort stub)', async ({ page }) => {
    await gotoFixture(page);
    await alwaysFailLiveConnections(page);
    await page.getByRole('button', { name: /^live$/i }).click();
    await expect(page.getByText(/reconnecting/i).first()).toBeVisible({ timeout: 10_000 });
    await captureScreenshot(page, PHASE, 'BEFORE-L-live-reconnecting');
  });

  test('N: narrow/mobile - Settings and Search', async ({ page }) => {
    await gotoFixture(page);
    await setViewport(page, 390, 844);
    await captureScreenshot(page, PHASE, 'BEFORE-N-narrow-search');
    await page.getByRole('button', { name: /docker settings/i }).click();
    await captureScreenshot(page, PHASE, 'BEFORE-N-narrow-settings');
  });
});
