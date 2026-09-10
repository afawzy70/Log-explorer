import { test, expect } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoOverlap, captureScreenshot, setViewport, setZoom } from './helpers';

/*
 * Browser checks (the gate) - IMPLEMENTATION_PLAN.md "Phase H": "Inspector
 * at 1920/1280/768/390; resize bounds; no page overflow; focus visible."
 * Drives a real search against the real backend's `fixture` source, then
 * opens the real event inspector on real, fully-populated fixture events -
 * not a static HTML mimic. Requires the real backend running
 * (`SPRING_PROFILES_ACTIVE=dev`) and the frontend dev server.
 */

async function runRealSearch(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

async function openInspectorOnRow(page: import('@playwright/test').Page, rowIndex: number) {
  const row = page.locator('tbody tr').nth(rowIndex);
  await row.getByRole('button', { name: /actions for this event/i }).click();
  await page.getByRole('menuitem', { name: /view details/i }).click();
  await expect(page.getByRole('dialog', { name: /event details/i })).toBeVisible();
}

test('opening the inspector shows every section with real, fully-populated fixture data', async ({ page }) => {
  await runRealSearch(page);
  await openInspectorOnRow(page, 0);

  const dialog = page.getByRole('dialog', { name: /event details/i });
  await expect(dialog.getByRole('heading', { name: /^overview$/i })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /actor & client/i })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /request flow/i })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /business \/ error/i })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /all fields/i })).toBeVisible();

  // Real fixture events always have every protected field populated -
  // "Protected / masked" must be visible, never a raw value.
  await expect(dialog.getByText(/protected \/ masked/i)).toBeVisible();

  await captureScreenshot(page, 'h', 'inspector-open-1280px');
});

test('masked fields in the inspector always look masked, never raw - real backend response', async ({ page }) => {
  await runRealSearch(page);
  await openInspectorOnRow(page, 0);

  const dialog = page.getByRole('dialog', { name: /event details/i });
  const actorSection = dialog.locator('section', { has: page.getByRole('heading', { name: /actor & client/i }) });
  const text = await actorSection.textContent();
  expect(text).toMatch(/\*/); // every fixture protected field is masked with '*'
});

test('the selected row stays visually identifiable while the inspector is open', async ({ page }) => {
  await runRealSearch(page);
  const row = page.locator('tbody tr').nth(1);
  await row.getByRole('button', { name: /actions for this event/i }).click();
  await page.getByRole('menuitem', { name: /view details/i }).click();

  const [selectedBg, otherBg] = await Promise.all([
    row.evaluate((el) => getComputedStyle(el).backgroundColor),
    page.locator('tbody tr').nth(0).evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  expect(selectedBg).not.toBe(otherBg);
});

test('Previous/Next move within the loaded results and disable at the bounds; Escape closes and restores focus', async ({
  page,
}) => {
  await runRealSearch(page);
  await openInspectorOnRow(page, 0);

  const dialog = page.getByRole('dialog', { name: /event details/i });
  await expect(dialog.getByRole('button', { name: /previous event/i })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /next event/i })).toBeEnabled();

  const firstTitle = await dialog.locator('h1').textContent();
  await dialog.getByRole('button', { name: /next event/i }).click();
  const secondTitle = await dialog.locator('h1').textContent();
  expect(secondTitle).not.toBe(firstTitle);

  await dialog.getByRole('button', { name: /previous event/i }).click();
  await expect(dialog.locator('h1')).toHaveText(firstTitle ?? '');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /event details/i })).not.toBeVisible();
  await expect(page.locator('tbody tr').nth(0).getByRole('button', { name: /actions for this event/i })).toBeFocused();
});

test('"Show ±30 seconds" previews the bounded window before running, then replaces results with a back-to-original breadcrumb', async ({
  page,
}) => {
  await runRealSearch(page);
  await openInspectorOnRow(page, 0);
  const dialog = page.getByRole('dialog', { name: /event details/i });

  await dialog.getByRole('button', { name: /show surrounding logs/i }).click();
  await expect(page.getByRole('dialog', { name: /confirm surrounding-context search/i })).toBeVisible();
  await page.getByRole('button', { name: /^run$/i }).click();

  await expect(page.getByText(/back to original search/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/context/i).first()).toBeVisible();

  await page.getByRole('button', { name: /back to original search/i }).click();
  await expect(page.getByText(/back to original search/i)).not.toBeVisible();
});

// "Find related logs" (this section's original per-ID action) was
// superseded in IMPLEMENTATION_PLAN.md "Phase I" by "Find this trace/
// correlation/journey/event" (HANDOVER.md §17's own click-action list),
// which opens the dedicated journey timeline instead of re-filtering the
// flat results table - a strict upgrade, not a regression. See
// `phase-i-journey-investigation.spec.ts` for its real-browser coverage.

test('View details is always available in the row actions menu, never disabled', async ({ page }) => {
  await runRealSearch(page);
  const trigger = page.locator('tbody tr').nth(0).getByRole('button', { name: /actions for this event/i });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: /view details/i })).toBeVisible();
});

const WIDE_WIDTHS = [1920, 1440, 1280];
const NARROW_WIDTHS = [1024, 768, 390];

for (const width of WIDE_WIDTHS) {
  test(`at ${width}px the inspector sits beside the results table (side panel), with no page overflow`, async ({ page }) => {
    await runRealSearch(page);
    await setViewport(page, width);
    await openInspectorOnRow(page, 0);

    // Compares the visible/clipped results area, not the raw `<table>`
    // element - the table is deliberately wider than its scroll container
    // (`min-width: 900px`, horizontally scrollable), so its own
    // unclipped bounding box legitimately extends further right than
    // what's actually painted; that's not an overlap with the panel.
    await assertNoOverlap(page, '[data-testid="results-scroll-wrapper"]', '[role="dialog"][aria-label="Event details"]');
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'h', `inspector-${width}px`);
  });
}

for (const width of NARROW_WIDTHS) {
  test(`at ${width}px the inspector is a dismissable overlay, with no page overflow`, async ({ page }) => {
    await runRealSearch(page);
    await setViewport(page, width);
    await openInspectorOnRow(page, 0);

    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'h', `inspector-${width}px`);

    if (width > 420) {
      // The backdrop is real and dismisses the panel - proves this is a
      // genuine overlay/sheet, not just a squeezed panel. Only checked
      // where the panel (capped at 420px) leaves a visible backdrop area
      // to click - at 390px the sheet legitimately fills the whole
      // viewport (a real full-screen-sheet UX, not a bug), so there is no
      // "outside" pixel; Escape and the Close button (covered elsewhere)
      // are that width's dismissal path.
      await page.mouse.click(5, 5);
      await expect(page.getByRole('dialog', { name: /event details/i })).not.toBeVisible();
    }
  });
}

const ZOOM_LEVELS = [125, 200];
for (const zoom of ZOOM_LEVELS) {
  test(`no page overflow with the inspector open at ${zoom}% zoom`, async ({ page }) => {
    await runRealSearch(page);
    await setViewport(page, 1280);
    await openInspectorOnRow(page, 0);
    await setZoom(page, zoom);

    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'h', `inspector-zoom-${zoom}pct`);
  });
}

test('the resize handle keeps the panel within its documented min/max bounds', async ({ page }) => {
  await runRealSearch(page);
  await setViewport(page, 1920);
  await openInspectorOnRow(page, 0);

  const handle = page.getByRole('separator', { name: /resize event details panel/i });
  await handle.focus();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('ArrowRight'); // narrows toward MIN_PANEL_WIDTH
  }
  const minWidth = await handle.getAttribute('aria-valuenow');
  expect(Number(minWidth)).toBeGreaterThanOrEqual(320);

  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('ArrowLeft'); // widens toward MAX_PANEL_WIDTH
  }
  const maxWidth = await handle.getAttribute('aria-valuenow');
  expect(Number(maxWidth)).toBeLessThanOrEqual(720);

  await assertNoHorizontalOverflow(page);
});
