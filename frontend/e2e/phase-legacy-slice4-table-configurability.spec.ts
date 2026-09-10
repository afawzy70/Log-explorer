import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport } from './helpers';

/*
 * Legacy Remediation Slice 4 — RESULTS TABLE CONFIGURABILITY & POWER-USER
 * CONTROLS. Browser checks required by the owner-approved plan
 * (docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md §"Slice 4"):
 *
 *  1. Verify initial seven-column default exactly.
 *  2. Open Columns control.
 *  3. Enable at least two optional safe columns.
 *  4. Reorder one column using keyboard-accessible controls.
 *  5. Verify rows still correspond correctly to headers.
 *  6. Change to Compact density.
 *  7. Select a row and open inspector.
 *  8. Load another page and prove table configuration remains.
 *  9. Refresh and prove configuration remains while search semantics
 *     remain correct.
 * 10. Reload browser and prove safe table preferences persist.
 * 11. Reset table and prove exact seven-column default restored.
 * 12. Verify no query/filter/result values were persisted.
 * 13. Narrow viewport/table overflow remains usable.
 *
 * "Do not replace existing E2E coverage; extend it" - this is a new file,
 * every existing spec (including phase-g-results-table.spec.ts's own
 * seven-column/geometry checks) runs unmodified alongside it.
 *
 * Requires the real backend running (`SPRING_PROFILES_ACTIVE=dev`, Fixture
 * source) and the frontend dev server, matching every other live
 * verification in this project. The 250-event, >200-default-limit corpus
 * (see phase-legacy-slice1-pagination.spec.ts's own comment on
 * `FixtureLogSource`) is reused here to exercise Load More under a
 * customized table.
 *
 * Each Playwright test gets a fresh browser context (empty localStorage) -
 * items 7-13 each re-establish the customized configuration themselves via
 * `customizeTableColumns`, rather than depending on state left behind by an
 * earlier test.
 */

const DEFAULT_HEADERS = ['Time', 'Level', 'Service', 'What happened', 'User/Customer', 'Correlation/Trace', 'Actions'];
const CUSTOMIZED_HEADERS = ['Time', 'Service', 'Level', 'What happened', 'User/Customer', 'Correlation/Trace', 'Logger', 'Trace ID', 'Actions'];
const STORAGE_KEY = 'logexplorer.tablePreferences.v1';

async function gotoFixtureAllLevels(page: Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: /^all$/i }).click(); // severity: All - the 250-event corpus, exceeds the 200 default page limit
}

async function search(page: Page) {
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

async function headers(page: Page): Promise<string[]> {
  return page.getByRole('columnheader').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
}

async function openColumns(page: Page) {
  await page.getByRole('button', { name: /^columns$/i }).click();
  await expect(page.getByRole('dialog', { name: /table settings/i })).toBeVisible();
}

/** Items 2-6: show two optional columns, reorder Service up via a keyboard-focused Move button, switch to Compact. */
async function customizeTableColumns(page: Page) {
  await openColumns(page);
  await page.getByRole('checkbox', { name: 'Logger' }).check();
  await page.getByRole('checkbox', { name: 'Trace ID' }).check();

  const moveServiceUp = page.getByRole('button', { name: 'Move Service up' });
  await moveServiceUp.focus();
  await page.keyboard.press('Enter'); // keyboard-driven, not .click()

  await page.getByRole('button', { name: 'Compact' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
}

test.describe('Legacy Remediation Slice 4 — results table configurability & power-user controls', () => {
  test('1-6. default seven columns, then two optional columns shown, one column reordered by keyboard, Compact density applied', async ({ page }) => {
    await gotoFixtureAllLevels(page);
    await search(page);

    // 1. Exact seven-column default.
    expect(await headers(page)).toEqual(DEFAULT_HEADERS);
    await captureScreenshot(page, 'legacy-slice4', 'default-seven-columns');

    // 2-6.
    await customizeTableColumns(page);

    // 5. Rows still correspond correctly to headers.
    expect(await headers(page)).toEqual(CUSTOMIZED_HEADERS);
    const firstRowCells = await page
      .locator('tbody tr')
      .first()
      .locator('td')
      .evaluateAll((tds) => tds.map((t) => (t.textContent ?? '').trim()));
    expect(firstRowCells).toHaveLength(CUSTOMIZED_HEADERS.length);
    // Level moved to index 2 (after Time, Service) - still a real severity token, correctly aligned under its own header.
    expect(['INFO', 'WARN', 'ERROR', 'DEBUG', '—']).toContain(firstRowCells[2]);

    await assertTableGeometry(page, 'table', 2);
    await captureScreenshot(page, 'legacy-slice4', 'customized-compact-columns');
  });

  test('7. selecting a row and opening the inspector works normally with a customized table', async ({ page }) => {
    await gotoFixtureAllLevels(page);
    await search(page);
    await customizeTableColumns(page);

    const row = page.locator('tbody tr').first();
    await row.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /inspect event/i }).click();
    await expect(page.getByRole('dialog', { name: /event details/i })).toBeVisible();
  });

  test('8. table configuration survives Load More (the appended page keeps every customization)', async ({ page }) => {
    await gotoFixtureAllLevels(page);
    await search(page);
    await customizeTableColumns(page);
    const page1RowCount = await page.locator('tbody tr').count();

    await page.getByRole('button', { name: /^load more$/i }).click();
    await expect.poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 }).toBeGreaterThan(page1RowCount);

    expect(await headers(page)).toEqual(CUSTOMIZED_HEADERS);
    await expect(page.locator('table')).toHaveClass(/compact/i);
    await assertTableGeometry(page, 'table', 2);
  });

  test('9. Refresh preserves table configuration while search semantics stay correct (paging resets to page 1)', async ({ page }) => {
    await gotoFixtureAllLevels(page);
    await search(page);
    await customizeTableColumns(page);

    const page1RowCount = await page.locator('tbody tr').count();
    await page.getByRole('button', { name: /^load more$/i }).click();
    await expect.poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 }).toBeGreaterThan(page1RowCount);

    await page.getByRole('button', { name: /refresh/i }).click(); // "↻ Refresh" - not an exact match
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 }).toBe(page1RowCount);

    expect(await headers(page)).toEqual(CUSTOMIZED_HEADERS); // configuration survived the refresh
    await expect(page.getByRole('button', { name: /^load more$/i })).toBeVisible(); // paging genuinely reset to page 1
  });

  test('10. reloading the browser and re-running the search restores the persisted safe table preferences', async ({ page }) => {
    await gotoFixtureAllLevels(page);
    await search(page);
    await customizeTableColumns(page);
    expect(await headers(page)).toEqual(CUSTOMIZED_HEADERS);

    await page.reload();
    // A reload clears in-memory SearchState entirely (no results to show
    // yet, and the source selection itself resets to its own default) -
    // the search itself is not persisted (correctly - see item 12) and
    // must be re-run from scratch, but the table's own presentation
    // preferences are read from localStorage independently of that.
    await expect(page.getByText(/run a search to see results/i)).toBeVisible();
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
    await page.getByRole('button', { name: /^all$/i }).click();
    await search(page);

    expect(await headers(page)).toEqual(CUSTOMIZED_HEADERS);
    await expect(page.locator('table')).toHaveClass(/compact/i);
    await captureScreenshot(page, 'legacy-slice4', 'preferences-survive-reload');
  });

  test('11. Reset table restores the exact seven-column default, discarding every customization', async ({ page }) => {
    await gotoFixtureAllLevels(page);
    await search(page);
    await customizeTableColumns(page);
    expect(await headers(page)).toEqual(CUSTOMIZED_HEADERS);

    await openColumns(page);
    await page.getByRole('button', { name: 'Reset table' }).click();
    await page.getByRole('button', { name: 'Close' }).click();

    expect(await headers(page)).toEqual(DEFAULT_HEADERS);
    await expect(page.locator('table')).not.toHaveClass(/compact/i);
    await captureScreenshot(page, 'legacy-slice4', 'reset-to-default');
  });

  test('12. only safe presentation preferences are ever persisted - no query, filter, or result value in localStorage', async ({ page }) => {
    await gotoFixtureAllLevels(page);
    await search(page);
    await customizeTableColumns(page);

    // A real, currently-displayed result value - proof the shape check
    // below is not vacuous (there genuinely is result content on the page
    // that must NOT have leaked into storage).
    const firstRowText = await page.locator('tbody tr').first().textContent();
    expect(firstRowText).toBeTruthy();

    const raw = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(Object.keys(parsed).sort()).toEqual(['columnOrder', 'density', 'hiddenColumnIds', 'version']);
    // Every persisted columnOrder/hiddenColumnIds entry is a short known
    // column id (e.g. "logger", "traceId") - never row/message content.
    for (const id of [...parsed.columnOrder, ...parsed.hiddenColumnIds]) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeLessThan(20);
    }

    // A distinctive, guaranteed-not-to-collide search text filter, so if
    // it (or any log/result content) ever leaked into localStorage, this
    // sentinel would catch it - whether or not it happens to match any
    // fixture event (a zero-result search is a legitimate outcome here).
    const sentinel = 'LEAK-SENTINEL-slice4-e2e-77c3';
    await page.getByPlaceholder(/search messages/i).fill(sentinel);
    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('table').or(page.getByText(/no results/i))).toBeVisible({ timeout: 10_000 });

    const allStorageText = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(allStorageText).not.toContain(sentinel);
    expect(allStorageText).not.toContain(firstRowText!.trim().slice(0, 15)); // no row content leaked either
  });

  test('13. at a narrow viewport, the customized table remains usable - only the table wrapper scrolls, the page never overflows', async ({ page }) => {
    await gotoFixtureAllLevels(page);
    await search(page);
    await customizeTableColumns(page);

    await setViewport(page, 390);
    await assertNoHorizontalOverflow(page);
    await assertTableGeometry(page, 'table', 2);

    const wrapperOverflowsX = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="results-scroll-wrapper"]') as HTMLElement | null;
      return el ? el.scrollWidth > el.clientWidth : false;
    });
    expect(wrapperOverflowsX).toBe(true); // the wide 9-column configuration legitimately needs its own horizontal scroll

    expect(await headers(page)).toEqual(CUSTOMIZED_HEADERS); // narrowing the viewport did not silently drop/hide any configured column
    await captureScreenshot(page, 'legacy-slice4', 'narrow-viewport-390px');
  });
});
