import { test, expect } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport, setZoom } from './helpers';

/*
 * Legacy Remediation Slice 1 — RESULT-SET COMPLETENESS (pagination,
 * truthful statistics, Refresh). Browser checks required by the
 * owner-approved plan (docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md §"Slice 1"):
 *
 *   1. Fixture search >200 events.
 *   2. Page repeatedly until exhausted.
 *   3. Verify count increases correctly.
 *   4. Verify no duplicate event rows.
 *   5. Open inspector before Load More and prove investigation context survives.
 *   6. Verify table header/cell geometry remains <=2px invariant.
 *   7. Repeat relevant narrow/zoom regression.
 *   8. Mock Loki boundary with identical timestamps — see
 *      docs/verification/LEGACY_REMEDIATION_SLICE_1_REPORT.md for why this
 *      is verified at the backend/adapter level (LokiLogSourceTest) rather
 *      than re-run here: the frontend's pagination/dedup rendering is
 *      100% source-agnostic (it renders the same SearchResponse JSON
 *      shape regardless of which adapter produced it), and that exact
 *      rendering path IS exercised live here, against Fixture data.
 *   9. Refresh and verify paging returns to page 1.
 *
 * Requires the real backend running (`SPRING_PROFILES_ACTIVE=dev`, per
 * `FixtureLogSource`'s corpus, deliberately sized to 250 events so a
 * genuinely un-doctored default-limit (200) search needs "Load more" —
 * see that class's own comment) and the frontend dev server, matching how
 * every other live verification in this project has been done.
 */

async function runFixtureSearchAllLevels(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.selectOption('select', 'fixture');
  await page.getByRole('button', { name: /^all$/i }).click(); // severity: All - include every fixture event, not just INFO/WARN/ERROR
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

async function pageThroughUntilExhausted(page: import('@playwright/test').Page): Promise<number> {
  const loadMoreButton = page.getByRole('button', { name: /^load more$/i });
  let previousCount = await page.locator('tbody tr').count();
  let guard = 0;
  while (await loadMoreButton.isVisible().catch(() => false)) {
    await loadMoreButton.click();
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 })
      .toBeGreaterThan(previousCount);
    previousCount = await page.locator('tbody tr').count();
    guard++;
    expect(guard, 'pagination must terminate, not loop forever').toBeLessThan(10);
  }
  return previousCount;
}

test('Fixture search exceeds 200 events; paging repeatedly reaches exhaustion with a correctly increasing count and no duplicate rows', async ({
  page,
}) => {
  await runFixtureSearchAllLevels(page);

  // Check 1: page 1 alone is capped at the default limit (200), and a
  // real Load more control is present - proof the corpus genuinely
  // exceeds one page, not a doctored/trivial case.
  const page1RowCount = await page.locator('tbody tr').count();
  expect(page1RowCount).toBeGreaterThan(0);
  expect(page1RowCount).toBeLessThanOrEqual(200);
  await expect(page.getByRole('button', { name: /^load more$/i })).toBeVisible();

  // Check 3 (count increases correctly): the counts summary reflects the
  // cumulative total, not just the latest page's own return count.
  const summaryBefore = await page.getByText(/^Showing /i).first().textContent();
  expect(summaryBefore).toMatch(/showing \d+ (of \d+|events?)/i);

  // Checks 2 + 3: page repeatedly until "Load more" itself disappears
  // (real exhaustion, not an arbitrary loop count).
  const finalRowCount = await pageThroughUntilExhausted(page);
  expect(finalRowCount).toBeGreaterThan(200); // proves real multi-page traversal happened
  expect(finalRowCount).toBeGreaterThan(page1RowCount);

  const summaryAfter = await page.getByText(/^Showing /i).first().textContent();
  expect(summaryAfter).toContain(String(finalRowCount));

  // Check 4: no duplicate rows anywhere in the final, fully-paged table.
  const rowTexts = await page.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.textContent ?? ''));
  expect(rowTexts).toHaveLength(finalRowCount);
  expect(new Set(rowTexts).size).toBe(rowTexts.length);
});

test('opening the inspector before Load More preserves the selected event through the page append (investigation context survives)', async ({
  page,
}) => {
  await setViewport(page, 1440); // side-panel inspector layout, not an overlay - Load more stays reachable
  await runFixtureSearchAllLevels(page);

  const firstRow = page.locator('tbody tr').nth(0);
  const firstRowTimeBefore = await firstRow.locator('td').first().textContent();
  await firstRow.getByRole('button', { name: /actions for this event/i }).click();
  await page.getByRole('menuitem', { name: /inspect event/i }).click();

  const dialog = page.getByRole('dialog', { name: /event details/i });
  await expect(dialog).toBeVisible();
  const inspectorTimeBefore = await dialog.getByRole('heading', { name: /^overview$/i }).locator('..').textContent();

  await page.getByRole('button', { name: /^load more$/i }).click();
  await expect.poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 }).toBeGreaterThan(200);

  // The inspector is still open, on the same event, after the page grew.
  await expect(dialog).toBeVisible();
  const inspectorTimeAfter = await dialog.getByRole('heading', { name: /^overview$/i }).locator('..').textContent();
  expect(inspectorTimeAfter).toBe(inspectorTimeBefore);
  const firstRowTimeAfter = await page.locator('tbody tr').nth(0).locator('td').first().textContent();
  expect(firstRowTimeAfter).toBe(firstRowTimeBefore); // the underlying result set was appended to, never reordered/replaced
});

test('table geometry stays within the 2px invariant, and there is no horizontal overflow, after Load More and at a narrow width/zoom', async ({
  page,
}) => {
  await runFixtureSearchAllLevels(page);
  await page.getByRole('button', { name: /^load more$/i }).click();
  await expect.poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 }).toBeGreaterThan(200);

  await assertTableGeometry(page, 'table', 2);
  await assertNoHorizontalOverflow(page);
  await captureScreenshot(page, 'legacy-slice1', 'paginated-table-1280px');

  await setViewport(page, 390);
  await assertTableGeometry(page, 'table', 2);
  await assertNoHorizontalOverflow(page);

  await setViewport(page, 1280);
  await setZoom(page, 200);
  await assertTableGeometry(page, 'table', 2);
  await assertNoHorizontalOverflow(page);
  await captureScreenshot(page, 'legacy-slice1', 'paginated-table-200pct-zoom');
});

test('Refresh resets paging back to page 1, discarding any previously-appended pages', async ({ page }) => {
  await runFixtureSearchAllLevels(page);

  const page1RowCount = await page.locator('tbody tr').count();
  await pageThroughUntilExhausted(page);
  const exhaustedRowCount = await page.locator('tbody tr').count();
  expect(exhaustedRowCount).toBeGreaterThan(page1RowCount);

  await page.getByRole('button', { name: /refresh/i }).click(); // button label is "↻ Refresh" - not an exact match
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 }).toBe(page1RowCount);

  // A fresh page 1 offers "Load more" again - pagination genuinely reset, not just the row count coincidentally matching.
  await expect(page.getByRole('button', { name: /^load more$/i })).toBeVisible();
});
