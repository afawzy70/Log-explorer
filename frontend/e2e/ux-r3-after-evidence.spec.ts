import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { captureScreenshot, setViewport } from './helpers';

const PHASE = 'UX_R3_EVIDENCE';

async function gotoFixture(page: Page) {
  await page.goto('/');
  // Named, not the generic 'select' locator - a Compose-project-scoped
  // source (e.g. local-docker, if it happens to be the initial default)
  // renders a second <select> in the toolbar, which a bare 'select'
  // locator would ambiguously match.
  await page.getByLabel('Source').selectOption('fixture');
}

async function gotoLocalDocker(page: Page) {
  await page.goto('/');
  await page.getByLabel('Source').selectOption('local-docker');
  // Compose project discovery fires on source select - wait for the
  // toolbar's Compose project control to actually appear before
  // interacting with it, rather than racing the fetch.
  await expect(page.getByLabel(/compose project/i)).toBeVisible({ timeout: 10_000 });
}

async function alwaysFailLiveConnections(page: Page) {
  await page.route('**/api/v1/logs/live**', (route: Route) => route.abort('failed'));
}

test.describe('UX-R3 AFTER evidence - real rendered UI, post-redesign', () => {
  test('A/B/C: Docker Settings - Local, Remote, Connection name field, masking panel', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /docker settings/i }).click();
    await expect(page.getByRole('dialog', { name: /docker connection/i })).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-A-docker-settings-local');

    await page.getByLabel('Mode').selectOption('REMOTE');
    await captureScreenshot(page, PHASE, 'AFTER-B-docker-settings-remote-with-connection-name-field');

    // Masking-policy panel is visible in the same dialog, informational
    // only - assert it's genuinely there, not just present in the screenshot.
    await expect(page.getByText(/protected field masking/i)).toBeVisible();
    await expect(page.getByText(/^CIF$/)).toBeVisible();
    await expect(page.getByRole('button', { name: /reveal|unmask|copy/i })).toHaveCount(0);
  });

  test('D/E: Compose project discovery - real projects offered, active scope visible once selected', async ({ page }) => {
    await gotoLocalDocker(page);
    await captureScreenshot(page, PHASE, 'AFTER-D-compose-project-discovered');

    await page.getByLabel(/compose project/i).selectOption('logexplorer-evidence-demo');
    // The active-scope trail in the header must reflect the selection immediately.
    await expect(page.locator('header').getByText('logexplorer-evidence-demo')).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-E-compose-project-selected-scope-visible');
  });

  test('F: Last 30 minutes preset selectable', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: 'Last 1 day', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: /last 30 minutes/i })).toBeVisible();
    await page.getByRole('menuitemradio', { name: /last 30 minutes/i }).click();
    await expect(page.getByRole('button', { name: 'Last 30 minutes', exact: true })).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-F-last-30-minutes-preset');
  });

  test('G/H/I/J/K: Live states - connecting, active (LIVE), paused, reconnecting, back-to-search - redesigned state badge', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /^live$/i }).click();
    await captureScreenshot(page, PHASE, 'AFTER-G-live-connecting');

    // Wait for the panel's own status badge (role=status), never the
    // toolbar's always-visible "Live" button - the BEFORE spec's flaky
    // wait condition matched the wrong element; fixed here.
    await expect(page.getByTestId('live-tail-panel').getByRole('status')).toHaveText(/^LIVE$/, { timeout: 10_000 });
    await captureScreenshot(page, PHASE, 'AFTER-H-live-active');

    await page.getByRole('button', { name: /^pause$/i }).click();
    await expect(page.getByTestId('live-tail-panel').getByRole('status')).toHaveText(/^PAUSED$/);
    await captureScreenshot(page, PHASE, 'AFTER-I-live-paused-distinct-badge');

    await page.getByRole('button', { name: /back to search results/i }).click();
    await expect(page.getByRole('button', { name: /^search$/i })).toBeVisible();
    await captureScreenshot(page, PHASE, 'AFTER-K-back-to-search');
  });

  test('J: Live reconnecting (deterministic route-abort stub) - distinct badge text', async ({ page }) => {
    await gotoFixture(page);
    await alwaysFailLiveConnections(page);
    await page.getByRole('button', { name: /^live$/i }).click();
    await expect(page.getByTestId('live-tail-panel').getByRole('status')).toHaveText(/^RECONNECTING/, { timeout: 10_000 });
    await captureScreenshot(page, PHASE, 'AFTER-J-live-reconnecting');
  });

  test('L/M: narrow/mobile - Search and Settings still usable, no horizontal overflow', async ({ page }) => {
    await gotoFixture(page);
    await setViewport(page, 390, 844);
    await captureScreenshot(page, PHASE, 'AFTER-L-narrow-search');
    await page.getByRole('button', { name: /docker settings/i }).click();
    await captureScreenshot(page, PHASE, 'AFTER-M-narrow-settings');
  });
});
