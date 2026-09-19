import { test, expect } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport, setZoom } from './helpers';
import { headerLabel } from './inspector-helpers';

/*
 * Browser checks (the gate) - IMPLEMENTATION_PLAN.md "Phase G": "For each
 * visible header and its corresponding cell, compare
 * getBoundingClientRect().left and .width; tolerance <= 2 CSS px. Run at
 * 1920/1440/1280/1024/768/390, and at 125%/200% zoom. Also assert no
 * page-level horizontal overflow, and run performance checks at 100 /
 * 1,000 / configured-max events."
 *
 * Drives a real search against the real backend's `fixture` source (its
 * own deterministic corpus - real parsed events, real masked sensitive
 * fields, real malformed lines) - not a static HTML mimic. Requires the
 * real backend running (`SPRING_PROFILES_ACTIVE=dev`) and the frontend
 * dev server, matching how every other live verification in this project
 * has been done.
 */

const REQUIRED_WIDTHS = [1920, 1440, 1280, 1024, 768, 390];

async function runRealSearch(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  // Real fixture corpus - proves this isn't an empty-state coincidence.
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

for (const width of REQUIRED_WIDTHS) {
  test(`header/cell geometry matches within 2px and there is no horizontal overflow at ${width}px`, async ({ page }) => {
    await runRealSearch(page);
    await setViewport(page, width);

    await assertTableGeometry(page, 'table', 2);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'g', `results-table-${width}px`);
  });
}

const ZOOM_LEVELS = [125, 200];

for (const zoom of ZOOM_LEVELS) {
  test(`header/cell geometry matches within 2px and there is no horizontal overflow at ${zoom}% zoom`, async ({ page }) => {
    await runRealSearch(page);
    await setViewport(page, 1280);
    await setZoom(page, zoom);

    await assertTableGeometry(page, 'table', 2);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'g', `results-table-zoom-${zoom}pct`);
  });
}

test('compact density (the default, D1) rows measure close to the design\'s 28px target, not 36-37px, without shrinking the Actions hit target', async ({
  page,
}) => {
  await runRealSearch(page);

  const rowHeight = await page.locator('tbody tr').first().evaluate((el) => el.getBoundingClientRect().height);
  // Was 36-37px before the fix: the Actions column's own 4px top/bottom padding around an untouched 28x28px
  // trigger button forced the whole row taller than every other (shorter-content) column needed. Zeroing only
  // that one cell's vertical padding in compact density brought the row to ~28-29px - allow a small border/
  // rounding tolerance, never the old ~36-37px value.
  expect(rowHeight).toBeLessThanOrEqual(31);
  expect(rowHeight).toBeGreaterThanOrEqual(26);

  // The trigger button itself is untouched - same accessible 28x28px hit target, still fully functional.
  const trigger = page.locator('tbody tr').first().getByRole('button', { name: /actions for this event/i });
  const box = await trigger.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(28);
  expect(box?.height).toBeGreaterThanOrEqual(28);
  await trigger.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('real fixture events render correctly: the eight default columns, newest first, malformed lines survive, no page overflow', async ({
  page,
}) => {
  await runRealSearch(page);

  // Pre-closure functional recovery (PCFR-4): sortable headers now render
  // a <button> with an appended visually-hidden sort-state description -
  // strip it back to the plain column label before comparing.
  const headers = (await page.getByRole('columnheader').allTextContents()).map(headerLabel);
  expect(headers).toEqual([
    'Time',
    'Level',
    'Service',
    'What happened',
    'Tags',
    'User / Customer',
    'Correlation / Trace',
    'Actions',
  ]);

  const rowCount = await page.locator('tbody tr').count();
  expect(rowCount).toBeGreaterThan(0);

  // Every body row has exactly eight cells - no second action row, no omitted cell.
  const cellCounts = await page.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.querySelectorAll('td').length));
  expect(cellCounts.every((n) => n === 8)).toBe(true);

  // Newest first: every consecutive pair of parseable timestamps is non-increasing.
  const times = await page.locator('tbody tr td:first-child').allTextContents();
  const parsed = times.map((t) => (t === '—' ? null : new Date(t).getTime())).filter((t): t is number => t !== null && !Number.isNaN(t));
  for (let i = 1; i < parsed.length; i++) {
    expect(parsed[i]).toBeLessThanOrEqual(parsed[i - 1]);
  }

  await assertNoHorizontalOverflow(page);
});
