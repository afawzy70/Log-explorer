import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport } from './helpers';

/*
 * UI PARITY ACCELERATION PASS. Browser checks for the workflows this pass
 * restored/strengthened (owner-authorized mission, no dedicated slice
 * number - see docs/verification/UI_PARITY_ACCELERATION_REPORT.md):
 *
 *  1. search -> select -> inspector.
 *  2. inspector next/previous.
 *  3. More Filters draft -> Reset -> Cancel (results/committed state unchanged).
 *  4. More Filters Apply (committed filter reflected in Active filters).
 *  5. active filter chip visibility (no editor reopen needed).
 *  6. filter refinement with results/context preserved (opening an editor
 *     never loses the currently-shown results).
 *  7. Show +-30 seconds -> context -> return to original search.
 *  8. context summary (event/service/error counts, window, timezone).
 *  9. table controls (Slice 4's Columns control) still integrated, not duplicated.
 * 10. keyboard navigation/help (Ctrl+Enter run search, "/" focus search,
 *     ArrowDown row navigation, "?" shortcuts help, Escape dismiss).
 * 11. Live visible control workflow - Clear.
 * 12. desktop information-density/geometry at 1440px.
 * 13. 390px regression (header + toolbar + table stay usable, no page overflow).
 *
 * Requires the real backend running (`SPRING_PROFILES_ACTIVE=dev`, Fixture
 * source) and the frontend dev server, matching every other live
 * verification in this project.
 */

async function gotoFixture(page: Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: /^all$/i }).click(); // severity: All
}

async function search(page: Page) {
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

test.describe('UI Parity Acceleration Pass', () => {
  test('1-2. search -> select -> inspector, then Previous/Next navigate bounded', async ({ page }) => {
    await gotoFixture(page);
    await search(page);

    const row = page.locator('tbody tr').first();
    await row.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /inspect event/i }).click();

    const dialog = page.getByRole('dialog', { name: /event details/i });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible(); // results stay visible beside the inspector
    await captureScreenshot(page, 'ui-parity', 'inspector-open');

    const firstTitle = await dialog.locator('h1').textContent();
    await dialog.getByRole('button', { name: /next event/i }).click();
    const secondTitle = await dialog.locator('h1').textContent();
    expect(secondTitle).not.toBe(firstTitle);
    await dialog.getByRole('button', { name: /previous event/i }).click();
    await expect(dialog.locator('h1')).toHaveText(firstTitle ?? '');
  });

  test('3. More Filters: typing a draft, then Reset, then Cancel - never applies, results/committed state untouched', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const rowCountBefore = await page.locator('tbody tr').count();

    await page.getByRole('button', { name: /^more filters$/i }).click();
    await page.getByLabel('Trace ID').fill('draft-trace-should-never-apply');
    await captureScreenshot(page, 'ui-parity', 'more-filters-open');
    await page.getByRole('button', { name: /^reset$/i }).click();
    await expect(page.getByLabel('Trace ID')).toHaveValue('');
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Nothing was applied - committed results/filters are exactly as before.
    await expect(page.locator('tbody tr')).toHaveCount(rowCountBefore);
    await expect(page.locator('[aria-label="Active filters"]').getByText(/trace id/i)).toHaveCount(0);
  });

  test('4-5. More Filters Apply reflects immediately as a visible Active filters chip - no editor reopen needed', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /^more filters$/i }).click();
    await page.getByLabel('Error code').fill('ERR_TIMEOUT');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    const activeFilters = page.locator('[aria-label="Active filters"]');
    await expect(activeFilters.getByText(/error code/i)).toBeVisible();
    await expect(activeFilters.getByText('ERR_TIMEOUT')).toBeVisible();

    await search(page);
    // The chip is still visible without reopening More Filters, alongside real results.
    await expect(activeFilters.getByText('ERR_TIMEOUT')).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('6. refining a filter never loses the currently-shown results while the editor is open', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    await expect(page.getByRole('table')).toBeVisible();

    await page.getByRole('button', { name: /^more filters$/i }).click();
    // Results remain visible/rendered underneath the (non-blocking) panel.
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('7-8. Show +-30 seconds shows a richer context summary, then Back to original search restores the prior results', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const originalRowCount = await page.locator('tbody tr').count();

    await page.locator('tbody tr').first().getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /inspect event/i }).click();
    await page.getByRole('dialog', { name: /event details/i }).getByRole('button', { name: /show ±30 seconds/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click();

    await expect(page.getByText(/back to original search/i)).toBeVisible({ timeout: 10_000 });
    const summary = page.getByRole('note', { name: /surrounding-context summary/i });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Events');
    await expect(summary).toContainText('Services');
    await expect(summary).toContainText('Errors');
    await expect(summary).toContainText('60 seconds');
    await expect(summary).toContainText(/does not indicate causality/i);
    await captureScreenshot(page, 'ui-parity', 'context-summary');

    await page.getByRole('button', { name: /back to original search/i }).click();
    await expect(page.getByText(/back to original search/i)).not.toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(originalRowCount);
  });

  test('9. the Columns control (Slice 4) is still present and functions alongside the new workspace controls', async ({ page }) => {
    await gotoFixture(page);
    await search(page);

    await page.getByRole('button', { name: /^columns$/i }).click();
    await expect(page.getByRole('dialog', { name: /table settings/i })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('10. keyboard navigation and help: Ctrl+Enter runs search, "/" focuses search, ArrowDown moves row focus, "?" opens help, Escape dismisses it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
    await page.getByRole('button', { name: /^all$/i }).click();

    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('/');
    await expect(page.locator('[data-shortcut="universal-search"]')).toBeFocused();
    await page.keyboard.press('Escape');

    const firstTrigger = page.locator('tbody tr').nth(0).getByRole('button', { name: /actions for this event/i });
    const secondTrigger = page.locator('tbody tr').nth(1).getByRole('button', { name: /actions for this event/i });
    await firstTrigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(secondTrigger).toBeFocused();

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeVisible();
    await captureScreenshot(page, 'ui-parity', 'keyboard-shortcuts-help');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).not.toBeVisible();
  });

  test('11. Live: Clear empties the view without stopping the connection', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture'); // Fixture advertises liveTail=true
    await page.getByRole('button', { name: /^live$/i }).click();
    const panel = page.getByTestId('live-tail-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 10_000 });

    await expect.poll(async () => panel.locator('li').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await captureScreenshot(page, 'ui-parity', 'live-state');

    await page.getByRole('button', { name: /^clear$/i }).click();
    await expect(panel.locator('li')).toHaveCount(0);
    // Still connected - the state label never reverted to "Not started".
    await expect(panel.getByRole('status')).toHaveText(/^live$/i);
  });

  test('12. desktop (1440px) information density: toolbar, active filters, and results table geometry all hold together on one screen', async ({ page }) => {
    await setViewport(page, 1440);
    await gotoFixture(page);
    await search(page);

    // Active filters (always at least the committed time range) stay
    // visible above the table, without needing to reopen any editor.
    await expect(page.locator('[aria-label="Active filters"]')).toBeVisible();
    await assertTableGeometry(page, 'table', 2);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'ui-parity', 'desktop-workspace-1440px');
  });

  test('13. 390px: header, toolbar, and table remain usable with no page-level horizontal overflow', async ({ page }) => {
    await setViewport(page, 390);
    await gotoFixture(page);
    await search(page);

    await expect(page.getByRole('button', { name: /keyboard shortcuts/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertTableGeometry(page, 'table', 2);
    await captureScreenshot(page, 'ui-parity', 'narrow-390px');
  });
});
