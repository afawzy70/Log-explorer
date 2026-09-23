import { test, expect } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  assertNoOverlap,
  captureScreenshot,
  setViewport,
  setZoom,
  waitForFontsReady,
} from './helpers';

/*
 * PR #65 fix - permanent regression coverage (CLAUDE.md §4 "Results
 * table"/"Time range": a fix is not "verified" without one, and §6's
 * debugging sequence step 7 requires it).
 *
 * The bug: opening "Custom" in the Time Range control resized the whole
 * search toolbar - `CustomRangePopover`'s own `.popover` rendered in
 * normal document flow (a deliberate earlier choice, see
 * `CustomRangePopover.module.css`'s history comment), so it grew
 * `TimeRangeControl`'s `.wrapper` (an `inline-block` flex item in the
 * toolbar's own `flex-wrap` row), which reflowed every sibling control -
 * Source, Severity, the search input, Search itself all jumped position
 * the instant Custom opened. Measured before the fix: Severity shifted
 * ~170px horizontally and ~111px vertically, and the toolbar grew ~222px
 * taller.
 *
 * The fix: `.popover` is now `position: absolute`, anchored off
 * `TimeRangeControl`'s already-`position: relative` `.wrapper` (mirroring
 * how the preset `.menu` already anchors itself), so it is removed from
 * the toolbar's flex flow entirely and can never move a sibling. Its own
 * explicit `width: 280px` (so `.fields`' internal `flex-wrap` still has a
 * real box to react to, at any viewport width or `zoom`) is unchanged, and
 * `CustomRangePopover.tsx` additionally clamps its `left` on open so the
 * fixed-width popover never overflows the viewport regardless of where in
 * the toolbar its trigger lands (`popoverPosition.ts` has the pure clamp
 * math, unit-tested separately in `popoverPosition.test.ts`).
 *
 * Self-contained: every control this spec touches renders from local
 * component state alone (no real backend required - matches
 * `phase-f-search-ux.spec.ts`, which already covers overlap/stacking/zoom
 * for this same popover; this spec adds the toolbar-reflow geometry
 * invariant that spec did not check, plus the Apply/Cancel/Escape/
 * outside-click focus-restoration coverage that was also missing).
 */

const REQUIRED_WIDTHS = [1920, 1440, 1280, 1024, 768, 390];
const ZOOM_LEVELS = [125, 200];
const GEOMETRY_TOLERANCE_PX = 2;

const DIALOG_SELECTOR = '[role="dialog"][aria-label="Custom time range"]';
const TOOLBAR_SELECTOR = '[class*="toolbar"]';
// B2 (Session 4) - the level chips live behind this field trigger's popover; the trigger itself, always
// in the DOM, is what a competing popover could actually overlap (matches phase-f-search-ux.spec.ts).
const SEVERITY_SELECTOR = 'button[aria-label^="Severity:"]';
const SEARCH_INPUT_LABEL = 'Search messages, errors, users or paste an ID';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

async function rectOfLocator(locator: import('@playwright/test').Locator, label: string): Promise<Rect> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`rectOfLocator: "${label}" has no visible box`);
  }
  // Document-relative, not viewport-relative (root cause below) - `boundingBox()`
  // is viewport-relative (same coordinate space as `getBoundingClientRect()`), so
  // it moves with the page's own scroll position even when nothing in the DOM
  // actually reflowed. At 200%/1440px specifically, the "Last 1 day" preset
  // menu's own "Custom" option renders below the fold (verified live: its own
  // rect top sat at y=967 against a 900px-tall viewport) - clicking it is a
  // completely ordinary Playwright (and real-browser) auto-scroll-into-view,
  // unrelated to `CustomRangePopover`/its CSS entirely, but it moves every
  // viewport-relative rect captured afterward by the scrolled amount (measured:
  // exactly the toolbar's own reported "moved by 24px", one-to-one with the
  // page's own `scrollY` delta between the two snapshots). Adding each
  // snapshot's own scroll offset back in cancels that out and leaves only a
  // genuine reflow - CLAUDE.md §4's actual invariant here ("opening Custom does
  // not move the toolbar") is about the toolbar's position IN THE PAGE, not
  // relative to whatever the viewport happened to be scrolled to when it was
  // measured.
  const page = locator.page();
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  return { left: box.x + scroll.x, top: box.y + scroll.y, width: box.width, height: box.height };
}

/** Every rect this spec watches for movement, captured together for one before/after diff. */
async function captureToolbarRects(page: import('@playwright/test').Page) {
  return {
    toolbar: await rectOfLocator(page.locator(TOOLBAR_SELECTOR).first(), 'toolbar'),
    // Exact name, not a substring match: the ActiveFilters "remove time range" chip button also mentions
    // "Last 1 day" in its own accessible name once the range shows in the active-filters row - a loose
    // regex would then match two buttons (matches phase-f-search-ux.spec.ts's own `openCustomRangePopover`).
    trigger: await rectOfLocator(page.getByRole('button', { name: 'Last 1 day', exact: true }), 'Time Range trigger'),
    search: await rectOfLocator(page.getByRole('textbox', { name: SEARCH_INPUT_LABEL }), 'search input'),
    severity: await rectOfLocator(page.locator(SEVERITY_SELECTOR).first(), 'Severity control'),
    searchButton: await rectOfLocator(page.getByRole('button', { name: /^search$/i }), 'Search button'),
  };
}

function assertWithinTolerance(before: Rect, after: Rect, label: string) {
  expect(Math.abs(after.left - before.left), `${label}.left moved`).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(after.top - before.top), `${label}.top moved`).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(after.width - before.width), `${label}.width changed`).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
  expect(Math.abs(after.height - before.height), `${label}.height changed`).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
}

async function openCustom(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Last 1 day', exact: true }).click();
  await page.getByRole('button', { name: /custom/i }).click();
  await expect(page.locator(DIALOG_SELECTOR)).toBeVisible();
}

for (const width of REQUIRED_WIDTHS) {
  test(`opening Custom does not move the toolbar or any sibling control at ${width}px`, async ({ page }) => {
    await page.goto('/');
    await setViewport(page, width);
    await waitForFontsReady(page);

    const before = await captureToolbarRects(page);
    await openCustom(page);
    const after = await captureToolbarRects(page);

    assertWithinTolerance(before.toolbar, after.toolbar, 'toolbar');
    assertWithinTolerance(before.trigger, after.trigger, 'Time Range trigger');
    assertWithinTolerance(before.search, after.search, 'search input');
    assertWithinTolerance(before.severity, after.severity, 'Severity control');
    assertWithinTolerance(before.searchButton, after.searchButton, 'Search button');

    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'pr65', `toolbar-geometry-${width}px`);
  });
}

for (const zoom of ZOOM_LEVELS) {
  test(`opening Custom does not move the toolbar or any sibling control at ${zoom}% zoom`, async ({ page }) => {
    await page.goto('/');
    await setViewport(page, 1440);
    await setZoom(page, zoom);
    await waitForFontsReady(page);

    const before = await captureToolbarRects(page);
    await openCustom(page);
    const after = await captureToolbarRects(page);

    assertWithinTolerance(before.toolbar, after.toolbar, 'toolbar');
    assertWithinTolerance(before.trigger, after.trigger, 'Time Range trigger');
    assertWithinTolerance(before.search, after.search, 'search input');
    assertWithinTolerance(before.severity, after.severity, 'Severity control');
    assertWithinTolerance(before.searchButton, after.searchButton, 'Search button');

    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'pr65', `toolbar-geometry-zoom-${zoom}pct`);
  });
}

test('the popover does not overlap Severity and stays reasonably within the viewport at 390px', async ({ page }) => {
  await page.goto('/');
  await setViewport(page, 390);
  await openCustom(page);

  await assertNoOverlap(page, DIALOG_SELECTOR, SEVERITY_SELECTOR);
  await assertNoHorizontalOverflow(page);

  const popRect = await rectOfLocator(page.locator(DIALOG_SELECTOR), 'Custom time range popover');
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  // "Legitimately touch the edge, never unusably clipped or off-page"
  // (CLAUDE.md §4 / the driving task): most of the popover's own box must
  // sit inside the viewport, not merely its top-left corner.
  expect(popRect.left).toBeGreaterThanOrEqual(-1);
  expect(popRect.left + popRect.width).toBeLessThanOrEqual(viewport!.width + 1);
});

test('fields stack (do not sit side by side) at a narrow width, confirming the internal flex-wrap still reacts to the popover box after switching to position: absolute', async ({
  page,
}) => {
  await page.goto('/');
  await setViewport(page, 390);
  await openCustom(page);

  const startBox = await page.getByLabel('Start').boundingBox();
  const endBox = await page.getByLabel('End').boundingBox();
  expect(startBox).not.toBeNull();
  expect(endBox).not.toBeNull();
  expect(endBox!.y).toBeGreaterThanOrEqual(startBox!.y + startBox!.height - 1);
});

test('no horizontal overflow with the popover open at 200% zoom (proves position: absolute did not reintroduce the old zoom/reflow bug)', async ({
  page,
}) => {
  await page.goto('/');
  await setViewport(page, 1280);
  await setZoom(page, 200);
  await openCustom(page);

  await assertNoHorizontalOverflow(page);
  await assertNoOverlap(page, DIALOG_SELECTOR, SEVERITY_SELECTOR);
});

test.describe('Apply/Cancel/Escape/outside-click', () => {
  test('Apply commits the new range, closes the popover, and restores focus to the Time Range trigger', async ({
    page,
  }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Last 1 day', exact: true });
    await trigger.click();
    await page.getByRole('button', { name: /custom/i }).click();
    await expect(page.locator(DIALOG_SELECTOR)).toBeVisible();

    await page.getByLabel('Start').fill('2026-08-01T00:00');
    await page.getByLabel('End').fill('2026-08-01T01:00');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect(page.locator(DIALOG_SELECTOR)).toBeHidden();
    // The trigger's own accessible name changes to the actual committed
    // interval - never a generic "Custom range" label (CLAUDE.md §4) - and
    // it, not the popover, is where focus lands back.
    await expect(page.getByRole('button', { name: 'Last 1 day', exact: true })).toHaveCount(0);
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? null);
    expect(focused).not.toBeNull();
    expect(focused).not.toMatch(/^Last 1 day$/);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
  });

  test('Cancel discards the draft, restores focus to the trigger, and does not mutate the committed range', async ({
    page,
  }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Last 1 day', exact: true });
    await trigger.click();
    await page.getByRole('button', { name: /custom/i }).click();
    await expect(page.locator(DIALOG_SELECTOR)).toBeVisible();

    await page.getByLabel('Start').fill('2026-08-01T00:00');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(page.locator(DIALOG_SELECTOR)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Last 1 day', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Last 1 day', exact: true })).toBeFocused();
  });

  test('Escape discards the draft, restores focus to the trigger, and does not mutate the committed range', async ({
    page,
  }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Last 1 day', exact: true });
    await trigger.click();
    await page.getByRole('button', { name: /custom/i }).click();
    await expect(page.locator(DIALOG_SELECTOR)).toBeVisible();

    await page.getByLabel('Start').fill('2026-08-01T00:00');
    await page.keyboard.press('Escape');

    await expect(page.locator(DIALOG_SELECTOR)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Last 1 day', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Last 1 day', exact: true })).toBeFocused();
  });

  test('outside click discards the draft without mutating the committed range', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Last 1 day', exact: true });
    await trigger.click();
    await page.getByRole('button', { name: /custom/i }).click();
    await expect(page.locator(DIALOG_SELECTOR)).toBeVisible();

    await page.getByLabel('Start').fill('2026-08-01T00:00');
    // Click far outside the popover/toolbar entirely.
    await page.mouse.click(10, 600);

    await expect(page.locator(DIALOG_SELECTOR)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Last 1 day', exact: true })).toBeVisible();
  });

  test('reopening Custom after a Cancel restores the still-committed preset values, not the discarded draft', async ({
    page,
  }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Last 1 day', exact: true });
    await trigger.click();
    await page.getByRole('button', { name: /custom/i }).click();
    await page.getByLabel('Start').fill('2026-08-01T00:00');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await trigger.click();
    await page.getByRole('button', { name: /custom/i }).click();
    const startValue = await page.getByLabel('Start').inputValue();
    expect(startValue).not.toBe('2026-08-01T00:00');
  });
});
