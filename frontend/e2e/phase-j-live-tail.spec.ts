import { test, expect } from '@playwright/test';
import { assertNoHorizontalOverflow, captureScreenshot, setViewport, setZoom } from './helpers';

/*
 * Browser checks - IMPLEMENTATION_PLAN.md "Phase J": live tail Start /
 * Pause / Resume / Stop against a real streaming source, visually
 * distinct from historical search, with honest dropped/buffered counts
 * and capability gating. Drives the real backend's `fixture` source,
 * whose real live generator (`FixtureLogSource.follow`) emits one event
 * every 700ms with a burst of 5 every 6th tick - not a mock. Requires the
 * real backend running (`SPRING_PROFILES_ACTIVE=dev`) and the frontend
 * dev server.
 *
 * The toolbar's "Live" button (`Toolbar.tsx` -> `App.tsx`'s `onStartLive`)
 * is wired directly to `live.start(...)` - one click both opens the panel
 * AND begins streaming immediately. The panel's own "Start" button only
 * ever appears afterward, for restarting from `idle`/`stopped`/`error`
 * (e.g. after Stop).
 */

async function selectFixtureSource(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
}

function panelOf(page: import('@playwright/test').Page) {
  return page.getByTestId('live-tail-panel');
}

test('the Live button is only shown for a source whose real capabilities advertise live tail', async ({ page }) => {
  await selectFixtureSource(page);
  await expect(page.getByRole('button', { name: /^live$/i })).toBeVisible();

  // openshift-loki's real backend-reported capabilities say liveTail:
  // false (CLAUDE.md "never show Live for a source that cannot support
  // it") - confirmed against the real /api/v1/sources response, not
  // assumed.
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('openshift-loki');
  await expect(page.getByRole('button', { name: /^live$/i })).not.toBeVisible();
});

test('clicking Live immediately streams real, masked events from the fixture source; visually distinct from historical search', async ({
  page,
}) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();

  const panel = panelOf(page);
  await expect(panel).toBeVisible();
  await expect(page.getByRole('table')).not.toBeVisible();
  await expect(panel.getByRole('status')).toHaveText(/connecting|live/i);

  // The real fixture generator emits its first tick within ~700ms.
  await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 5_000 });
  await expect(panel.locator('[class*="list"] li').first()).toBeVisible({ timeout: 5_000 });

  // No raw sensitive value ever reaches the DOM - only masked forms.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/cif[":]\s*[^*\s][^*]{2,}/i);

  await captureScreenshot(page, 'j', 'live-tail-streaming-1280px');
});

test('Pause diverts new events into a buffered count without changing the visible list; Resume flushes them', async ({
  page,
}) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  const panel = panelOf(page);

  await expect(panel.locator('[class*="list"] li').first()).toBeVisible({ timeout: 5_000 });
  const visibleBeforePause = await panel.locator('[class*="list"] li').count();

  await panel.getByRole('button', { name: /^pause$/i }).click();
  await expect(panel.getByRole('status')).toHaveText(/^paused$/i);

  // Real ticks keep arriving (700ms cadence) while paused - wait long
  // enough for at least one, then confirm it went to the buffer, not the
  // visible list.
  await expect(panel.getByText(/buffered while paused/i)).toBeVisible({ timeout: 5_000 });
  const visibleWhilePaused = await panel.locator('[class*="list"] li').count();
  expect(visibleWhilePaused).toBe(visibleBeforePause);

  await panel.getByRole('button', { name: /^resume$/i }).click();
  await expect(panel.getByRole('status')).toHaveText(/^live$/i);
  await expect(panel.getByText(/buffered while paused/i)).not.toBeVisible();

  const visibleAfterResume = await panel.locator('[class*="list"] li').count();
  expect(visibleAfterResume).toBeGreaterThan(visibleBeforePause);

  await captureScreenshot(page, 'j', 'live-tail-paused-then-resumed-1280px');
});

test('Stop ends the stream and returns to a startable state; Start again resumes streaming cleanly', async ({
  page,
}) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  const panel = panelOf(page);
  await expect(panel.locator('[class*="list"] li').first()).toBeVisible({ timeout: 5_000 });

  await panel.getByRole('button', { name: /^stop$/i }).click();
  await expect(panel.getByRole('status')).toHaveText(/^stopped$/i);
  await expect(panel.getByRole('button', { name: /^start$/i })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^pause$/i })).not.toBeVisible();

  await panel.getByRole('button', { name: /^start$/i }).click();
  await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 5_000 });
  await expect(panel.locator('[class*="list"] li').first()).toBeVisible({ timeout: 5_000 });
});

test('"Back to search results" leaves live mode, and a fresh Live click starts an entirely new session', async ({
  page,
}) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  const panel = panelOf(page);
  await expect(panel.locator('[class*="list"] li').first()).toBeVisible({ timeout: 5_000 });

  await panel.getByRole('button', { name: /back to search results/i }).click();
  await expect(panel).not.toBeVisible();

  // Re-entering live mode starts a fresh session (totalReceived resets to
  // 0) - proof the prior EventSource was actually torn down, not merely
  // hidden, since a leaked connection would keep counts climbing in the
  // background even while the panel is unmounted.
  await page.getByRole('button', { name: /^live$/i }).click();
  await expect(panelOf(page).getByText(/received: 0/i)).toBeVisible();
});

test('no page-level horizontal overflow while live tail is streaming, at 1280px and under 200% zoom', async ({
  page,
}) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  await expect(panelOf(page).locator('[class*="list"] li').first()).toBeVisible({ timeout: 5_000 });

  await setViewport(page, 1280);
  await assertNoHorizontalOverflow(page);

  await setZoom(page, 200);
  await assertNoHorizontalOverflow(page);
});

test('the disclaimer that live tail is not a complete historical record is always visible', async ({ page }) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  await expect(page.getByText(/not a complete historical record/i)).toBeVisible();
});
