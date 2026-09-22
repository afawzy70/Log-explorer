import { test, expect } from '@playwright/test';
import { assertNoHorizontalOverflow, captureScreenshot, setViewport, setZoom } from './helpers';
import { openSettingsSection } from './settings-helpers';

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
 *
 * B7 (Session 10) - the event list is now a real <table> (`tbody tr` per
 * row), not the earlier card-list <ol>/<li> (COMPONENT_INVENTORY.md's own
 * RECOMPOSE classification, CLAUDE.md §5). Row-count/visibility locators
 * were updated to match; the button/label/state-badge contract this file
 * verifies is otherwise unchanged.
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

  // Owner decision (PR #59 pre-merge) supersedes the earlier step that
  // selected openshift-loki to prove Live is hidden for a source without
  // liveTail: OpenShift Loki is now visible but NOT selectable in the UI,
  // so it can never become the active source (Live included). Loki's own
  // liveTail:false capability remains covered by backend tests
  // (LokiLogSourceTest).
  const lokiOption = page.getByRole('combobox', { name: 'Source', exact: true }).locator('option[value="openshift-loki"]');
  await expect(lokiOption).toBeDisabled();
  await expect(lokiOption).toHaveText('OpenShift Loki — Not available');
});

test('clicking Live immediately streams real, masked events from the fixture source; visually distinct from historical search', async ({
  page,
}) => {
  await selectFixtureSource(page);

  // Mission "Field Mapping Schema Scan + Masking Policy Extension" §B:
  // the fresh/default masking state is now OFF - this test is
  // specifically about the MASKED-display guarantee, so it explicitly
  // enables CIF masking first (the real, current owner-facing workflow).
  // Reset at the end so this shared-singleton backend policy never leaks
  // into a later test in the same run.
  await openSettingsSection(page, /privacy & masking/i);
  const maskingDialog = page.getByTestId('privacy-masking-settings-panel');
  await expect(maskingDialog).toBeVisible();
  if (!(await maskingDialog.getByLabel('CIF').isChecked())) {
    await maskingDialog.getByLabel('CIF').click();
  }
  // B6.2 (Session 7) - Privacy & masking is no longer a popover with its own "Close" - only the
  // consolidated Settings workspace itself (a full-page takeover) needs closing, otherwise it would keep
  // outranking Live in App.tsx's render precedence, the same way Field Mapping/Classification already did.
  await page.getByRole('button', { name: /back to search results/i }).click();

  await page.getByRole('button', { name: /^live$/i }).click();

  const panel = panelOf(page);
  await expect(panel).toBeVisible();
  await expect(page.getByRole('table')).not.toBeVisible();
  await expect(panel.getByRole('status')).toHaveText(/connecting|live/i);

  // The real fixture generator emits its first tick within ~700ms.
  await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 5_000 });
  await expect(panel.locator('tbody tr').first()).toBeVisible({ timeout: 5_000 });

  // No raw sensitive value ever reaches the DOM - only masked forms.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/cif[":]\s*[^*\s][^*]{2,}/i);

  await captureScreenshot(page, 'j', 'live-tail-streaming-1280px');

  // Restore the fresh default (unmasked) so this shared-singleton
  // backend policy never leaks into a later test in the same run.
  await openSettingsSection(page, /privacy & masking/i);
  const cleanupDialog = page.getByTestId('privacy-masking-settings-panel');
  await expect(cleanupDialog).toBeVisible();
  if (await cleanupDialog.getByLabel('CIF').isChecked()) {
    await cleanupDialog.getByLabel('CIF').click();
  }
});

/*
 * LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - a real scoping gap found and fixed: Live previously
 * never sent Search's own EXCLUDE service-filter mode at all, so the backend always resolved the
 * selected services as an INCLUDE list regardless of what the investigator had actually chosen. This
 * proves, in a real browser against the real backend, that starting Live with EXCLUDE mode active still
 * connects and streams cleanly (the frontend->backend wiring works end to end) - the container-state
 * root cause itself (a stopped Docker container silently selected as a follow target) is proven
 * separately against a real, isolated Docker container in DockerLogSourceTest and via direct API
 * verification, since the Fixture source this E2E suite runs against has no container-state concept.
 */
test('starting Live with an EXCLUDE service filter active still connects and streams cleanly', async ({ page }) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /all services/i }).click();
  await page.getByRole('button', { name: 'Exclude selected' }).click();
  const servicesGroup = page.getByRole('group', { name: 'Services' });
  const firstService = servicesGroup.getByRole('checkbox').first();
  await firstService.check();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^live$/i }).click();

  const panel = panelOf(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 5_000 });
  await expect(panel.locator('tbody tr').first()).toBeVisible({ timeout: 5_000 });
});

test('Pause diverts new events into a buffered count without changing the visible list; Resume flushes them', async ({
  page,
}) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  const panel = panelOf(page);

  await expect(panel.locator('tbody tr').first()).toBeVisible({ timeout: 5_000 });
  const visibleBeforePause = await panel.locator('tbody tr').count();

  await panel.getByRole('button', { name: /^pause$/i }).click();
  await expect(panel.getByRole('status')).toHaveText(/^paused$/i);

  // Real ticks keep arriving (700ms cadence) while paused - wait long
  // enough for at least one, then confirm it went to the buffer, not the
  // visible list.
  await expect(panel.getByText(/buffered while paused/i)).toBeVisible({ timeout: 5_000 });
  const visibleWhilePaused = await panel.locator('tbody tr').count();
  expect(visibleWhilePaused).toBe(visibleBeforePause);

  await panel.getByRole('button', { name: /^resume$/i }).click();
  await expect(panel.getByRole('status')).toHaveText(/^live$/i);
  await expect(panel.getByText(/buffered while paused/i)).not.toBeVisible();

  const visibleAfterResume = await panel.locator('tbody tr').count();
  expect(visibleAfterResume).toBeGreaterThan(visibleBeforePause);

  await captureScreenshot(page, 'j', 'live-tail-paused-then-resumed-1280px');
});

test('Stop ends the stream and returns to a startable state; Start again resumes streaming cleanly', async ({
  page,
}) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  const panel = panelOf(page);
  await expect(panel.locator('tbody tr').first()).toBeVisible({ timeout: 5_000 });

  await panel.getByRole('button', { name: /^stop$/i }).click();
  await expect(panel.getByRole('status')).toHaveText(/^stopped$/i);
  await expect(panel.getByRole('button', { name: /^start$/i })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^pause$/i })).not.toBeVisible();

  await panel.getByRole('button', { name: /^start$/i }).click();
  await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 5_000 });
  await expect(panel.locator('tbody tr').first()).toBeVisible({ timeout: 5_000 });
});

test('"Back to search results" leaves live mode, and a fresh Live click starts an entirely new session', async ({
  page,
}) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  const panel = panelOf(page);
  await expect(panel.locator('tbody tr').first()).toBeVisible({ timeout: 5_000 });

  await panel.getByRole('button', { name: /back to search results/i }).click();
  await expect(panel).not.toBeVisible();

  // Re-entering live mode starts a fresh session (totalReceived resets to
  // 0) - proof the prior EventSource was actually torn down, not merely
  // hidden, since a leaked connection would keep counts climbing in the
  // background even while the panel is unmounted.
  await page.getByRole('button', { name: /^live$/i }).click();
  await expect(panelOf(page).getByText(/received: 0/i)).toBeVisible();
});

// Final Functional Closure - closes the one narrow, explicitly-named gap
// register DEC-C/§5 "Live to Search" recorded as still `IN_PROGRESS`:
// the button itself was already real-browser click-tested (the test
// above) and unit-tested for its click handler
// (`LiveTailPanel.test.tsx`), but never re-verified with real rendered
// evidence that it is reachable and activatable by KEYBOARD alone - the
// specific thing DEC-C's own text names as still pending. `<Button>` is
// a native `<button>` element (keyboard-focusable/activatable by the
// browser itself, not custom JS), so this is expected to pass - but
// "expected to pass" is not the same as verified, per CLAUDE.md §3.
test('"Back to search results" is reachable and activatable by keyboard alone (DEC-C closure)', async ({ page }) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  const panel = panelOf(page);
  await expect(panel.locator('tbody tr').first()).toBeVisible({ timeout: 5_000 });

  const exitButton = panel.getByRole('button', { name: /back to search results/i });
  await exitButton.focus();
  await expect(exitButton).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(panel).not.toBeVisible();
  // Search itself is restored, reachable, and usable - not just "the
  // panel closed" (which could just as easily mean a crash).
  await expect(page.getByRole('button', { name: /^search$/i })).toBeVisible();
});

test('no page-level horizontal overflow while live tail is streaming, at 1280px and under 200% zoom', async ({
  page,
}) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  await expect(panelOf(page).locator('tbody tr').first()).toBeVisible({ timeout: 5_000 });

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

// LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - the same clipping bug as Results' own Time column
// (`phase-g-results-table.spec.ts`) existed here too (`.colTime` was 172px, `.timeText` needed ~203px) -
// real DOM-level proof, not a screenshot, that Live's own Time cell now shows the complete value.
test('Time column shows the complete timestamp with no clipping in Live', async ({ page }) => {
  await selectFixtureSource(page);
  await page.getByRole('button', { name: /^live$/i }).click();
  await expect(panelOf(page).locator('tbody tr').first()).toBeVisible({ timeout: 5_000 });

  const timeTexts = panelOf(page).locator('[class*="timeText"]');
  await expect(timeTexts.first()).toBeVisible();
  const count = await timeTexts.count();
  for (let i = 0; i < count; i++) {
    const el = timeTexts.nth(i);
    const { clientWidth, scrollWidth, text } = await el.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      text: node.textContent ?? '',
    }));
    expect(scrollWidth, `Live time cell #${i} ("${text}") is clipped`).toBeLessThanOrEqual(clientWidth);
    expect(text).toMatch(/\d{1,2}:\d{2}:\d{2}\.\d{3}/);
  }
});
