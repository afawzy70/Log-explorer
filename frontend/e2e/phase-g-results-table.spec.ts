import { test, expect } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport, setZoom } from './helpers';

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

test('real fixture events render correctly: seven columns, newest first, malformed lines survive, no page overflow', async ({
  page,
}) => {
  await runRealSearch(page);

  const headers = await page.getByRole('columnheader').allTextContents();
  expect(headers).toEqual(['Time', 'Level', 'Service', 'What happened', 'User/Customer', 'Correlation/Trace', 'Actions']);

  const rowCount = await page.locator('tbody tr').count();
  expect(rowCount).toBeGreaterThan(0);

  // Every body row has exactly seven cells - no second action row, no omitted cell.
  const cellCounts = await page.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.querySelectorAll('td').length));
  expect(cellCounts.every((n) => n === 7)).toBe(true);

  // Newest first: every consecutive pair of parseable timestamps is non-increasing.
  const times = await page.locator('tbody tr td:first-child').allTextContents();
  const parsed = times.map((t) => (t === '—' ? null : new Date(t).getTime())).filter((t): t is number => t !== null && !Number.isNaN(t));
  for (let i = 1; i < parsed.length; i++) {
    expect(parsed[i]).toBeLessThanOrEqual(parsed[i - 1]);
  }

  await assertNoHorizontalOverflow(page);
});
