import { test, expect } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoOverlap, captureScreenshot, setViewport, setZoom } from './helpers';

/*
 * Browser checks (IMPLEMENTATION_PLAN.md "Phase F"): "Custom-range popover
 * does not overlap severity at 1920/1440/1280/1024/768/390 and at
 * 125%/200%/high zoom; fields stack at narrow widths; no page-level
 * horizontal overflow. Screenshots captured for each."
 *
 * Self-contained: nothing here depends on the real backend being up -
 * every control this spec touches renders from local component state
 * alone (no data fetched from `sources`/`services` is required to open
 * the time-range popover or read its geometry).
 */

const REQUIRED_WIDTHS = [1920, 1440, 1280, 1024, 768, 390];
const DIALOG_SELECTOR = '[role="dialog"][aria-label="Custom time range"]';
const SEVERITY_SELECTOR = '[role="group"][aria-label="Severity"]';

async function openCustomRangePopover(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /last 1 day/i }).click();
  await page.getByRole('button', { name: /custom/i }).click();
  await expect(page.locator(DIALOG_SELECTOR)).toBeVisible();
}

for (const width of REQUIRED_WIDTHS) {
  test(`custom time range popover does not overlap severity and the page has no horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await page.goto('/');
    await setViewport(page, width);
    await openCustomRangePopover(page);

    await assertNoOverlap(page, DIALOG_SELECTOR, SEVERITY_SELECTOR);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'f', `timerange-popover-${width}px`);
  });
}

test('fields stack (do not sit side by side) at a narrow width', async ({ page }) => {
  await page.goto('/');
  await setViewport(page, 390);
  await openCustomRangePopover(page);

  const startBox = await page.getByLabel('Start').boundingBox();
  const endBox = await page.getByLabel('End').boundingBox();
  expect(startBox).not.toBeNull();
  expect(endBox).not.toBeNull();
  // Stacked means End is below Start, not beside it.
  expect(endBox!.y).toBeGreaterThanOrEqual(startBox!.y + startBox!.height - 1);

  await captureScreenshot(page, 'f', 'timerange-popover-390px-stacked-fields');
});

const ZOOM_LEVELS = [125, 200, 400];

for (const zoom of ZOOM_LEVELS) {
  test(`no horizontal overflow with the custom time range popover open at ${zoom}% zoom`, async ({ page }) => {
    await page.goto('/');
    await setViewport(page, 1280);
    await setZoom(page, zoom);
    await openCustomRangePopover(page);

    await assertNoHorizontalOverflow(page);
    await assertNoOverlap(page, DIALOG_SELECTOR, SEVERITY_SELECTOR);
    await captureScreenshot(page, 'f', `timerange-popover-zoom-${zoom}pct`);
  });
}

test('the shell, toolbar, and active-filters row render with no page-level horizontal overflow at every required width', async ({
  page,
}) => {
  for (const width of REQUIRED_WIDTHS) {
    await page.goto('/');
    await setViewport(page, width);
    await assertNoHorizontalOverflow(page);
  }
});
