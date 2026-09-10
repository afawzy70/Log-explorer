import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport } from './helpers';

/*
 * UI GAP CLOSURE PASS — browser checks for this pass's own four gaps
 * (docs/verification/UI_GAP_CLOSURE_REPORT.md): the environment/profile
 * indicator, the More Filters drawer upgrade, chronological-ascending
 * context ordering with a visually-identifiable root event, and Live
 * keyboard shortcuts. Extends (never replaces) `phase-ui-parity-
 * acceleration.spec.ts`'s own coverage of the same workflows pre-upgrade.
 *
 * Requires the real backend running (`SPRING_PROFILES_ACTIVE=dev`,
 * Fixture source) and the frontend dev server, matching every other live
 * verification in this project.
 */

async function gotoFixture(page: Page) {
  await page.goto('/');
  await page.selectOption('select', 'fixture');
  await page.getByRole('button', { name: /^all$/i }).click(); // severity: All
}

async function search(page: Page) {
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

test.describe('UI Gap Closure Pass', () => {
  test('1-7. More Filters drawer: search produces results, opening it keeps results visible, draft edits, Cancel leaves committed state untouched, reopen->Apply commits new filters, Reset clears the draft without applying', async ({
    page,
  }) => {
    await gotoFixture(page);
    await search(page); // 1. search produces results
    const rowCountBefore = await page.locator('tbody tr').count();

    await page.getByRole('button', { name: /^more filters$/i }).click(); // 2. open More Filters
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'More filters' })).toBeVisible(); // now a visible drawer heading, not accessible-name-only
    await expect(page.getByRole('table')).toBeVisible(); // 3. results remain visible beside the drawer
    await captureScreenshot(page, 'ui-gap-closure', 'more-filters-drawer-open');

    await page.getByLabel('Trace ID').fill('draft-should-never-apply'); // 4. edit draft
    await page.getByRole('button', { name: /^cancel$/i }).click(); // 5. Cancel -> committed state unchanged
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(rowCountBefore);
    await expect(page.locator('[aria-label="Active filters"]').getByText(/trace id/i)).toHaveCount(0);
    // Focus returned to the trigger on close.
    await expect(page.getByRole('button', { name: /^more filters$/i })).toBeFocused();

    await page.getByRole('button', { name: /^more filters$/i }).click(); // 6. reopen
    await expect(page.getByRole('heading', { name: 'More filters' })).toBeFocused(); // focus moves into the drawer on open
    await page.getByLabel('Error code').fill('ERR_TIMEOUT');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const activeFilters = page.locator('[aria-label="Active filters"]');
    await expect(activeFilters.getByText(/error code/i)).toBeVisible();
    await expect(activeFilters.getByText('ERR_TIMEOUT')).toBeVisible(); // new committed filter

    await page.getByRole('button', { name: /more filters.*1.*active/i }).click();
    await page.getByRole('button', { name: /^reset$/i }).click(); // 7. Reset works
    await expect(page.getByLabel('Error code')).toHaveValue('');
    await expect(page.getByRole('dialog')).toBeVisible(); // Reset never closes the panel
    await page.getByRole('button', { name: /^cancel$/i }).click();
    // Reset was never applied - the committed chip from before is untouched.
    await expect(activeFilters.getByText('ERR_TIMEOUT')).toBeVisible();
  });

  test('8-12. Show ±30 seconds: opens the inspector, produces a chronologically-ascending context view with the original event visually marked, then restores the original search', async ({
    page,
  }) => {
    await gotoFixture(page);
    await search(page); // baseline for restoring afterward
    const originalRowCount = await page.locator('tbody tr').count();
    const originalFirstMessage = await page.locator('tbody tr').first().locator('td').nth(3).innerText();

    // The fixture corpus includes a malformed line with no timestamp at a
    // fixed cycle position - "Show +-30 seconds" is correctly absent for
    // that one event (ContextAction.tsx), so pick the first row that has a
    // real Level (a reliable proxy for "has a timestamp").
    const targetRow = page.locator('tbody tr').filter({ hasNot: page.locator('td:nth-child(2):text-is("—")') }).first();
    await targetRow.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /inspect event/i }).click(); // 8. open inspector

    const contextResponsePromise = page.waitForResponse((r) => r.url().includes('/api/v1/logs/context') && r.status() === 200);
    await page.getByRole('dialog', { name: /event details/i }).getByRole('button', { name: /show ±30 seconds/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click(); // 9. Show ±30 seconds

    const contextResponse = await contextResponsePromise;
    const body = (await contextResponse.json()) as { events: Array<{ message: string | null; timestamp: string | null }> };
    await expect(page.getByText(/back to original search/i)).toBeVisible({ timeout: 10_000 });
    await captureScreenshot(page, 'ui-gap-closure', 'context-chronological-with-root-marker');

    // 10. Chronological ascending: sort the real server response ourselves
    // (oldest-first, missing timestamps last) and compare against the
    // actual rendered row order - proves the frontend applied the same
    // ordering to real data, not a synthetic fixture.
    const expectedOrder = [...body.events]
      .sort((a, b) => {
        const ta = a.timestamp ? Date.parse(a.timestamp) : Number.POSITIVE_INFINITY;
        const tb = b.timestamp ? Date.parse(b.timestamp) : Number.POSITIVE_INFINITY;
        return ta - tb;
      })
      .map((e) => e.message ?? '(empty message)');
    // Excludes gap-marker rows (Legacy Remediation Slice 6, `data-testid="gap-row"`)
    // - those are not events, and real backend data for this window may
    // genuinely contain an observed gap; only real event rows are
    // compared against the sorted server response here.
    const rows = page.locator('tbody tr:not([data-testid="gap-row"])');
    const rowCount = await rows.count();
    const actualMessages: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      actualMessages.push(await rows.nth(i).locator('td').nth(3).innerText());
    }
    expect(actualMessages).toEqual(expectedOrder);

    // 11. The original (root) event stays visually identifiable, marked
    // with aria-current="location" and a real (if visually-hidden) label -
    // never conflated with ordinary row selection.
    const markedRow = page.locator('tbody tr[aria-current="location"]');
    await expect(markedRow).toHaveCount(1);
    await expect(markedRow.getByText('Original event you were investigating')).toBeAttached();

    await page.getByRole('button', { name: /back to original search/i }).click(); // 12. return to original search
    await expect(page.getByText(/back to original search/i)).not.toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(originalRowCount);
    await expect(page.locator('tbody tr').first().locator('td').nth(3)).toHaveText(originalFirstMessage);
    // Leaving context view clears the root marker too.
    await expect(page.locator('tbody tr[aria-current="location"]')).toHaveCount(0);
  });

  test('13. the environment/profile indicator shows the real backend-reported profile, never a guess', async ({ page, request }) => {
    const info = (await (await request.get('/actuator/info')).json()) as { environment?: { label?: string } };
    const realLabel = info.environment?.label;
    expect(realLabel).toBeTruthy();

    await page.goto('/');
    const badge = page.getByTitle(`Active backend profile: ${realLabel}`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText((realLabel ?? '').toUpperCase());
    // Never a hardcoded/guessed environment name unrelated to the real profile.
    expect(await badge.textContent()).not.toBe('LOCAL');
    await captureScreenshot(page, 'ui-gap-closure', 'environment-badge');
  });

  test('14-15. Live: keyboard shortcuts (P/S/C/F) and the existing click controls both drive the same real connection', async ({
    page,
  }) => {
    await page.goto('/');
    await page.selectOption('select', 'fixture');
    await page.getByRole('button', { name: /^live$/i }).click();
    const panel = page.getByTestId('live-tail-panel');
    await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 10_000 }); // 15. existing Start-on-click control

    await panel.click(); // ensure focus is not inside any text input before sending shortcuts
    await page.keyboard.press('p'); // 14. keyboard Pause
    await expect(panel.getByRole('status')).toHaveText(/^paused$/i);

    await page.getByRole('button', { name: /^resume$/i }).click(); // 15. existing click control still works
    await expect(panel.getByRole('status')).toHaveText(/^live$/i);

    const followButton = page.getByRole('button', { name: /follow newest/i });
    const before = await followButton.getAttribute('aria-pressed');
    await page.keyboard.press('f'); // 14. keyboard Follow-newest toggle
    await expect(followButton).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');

    await expect.poll(async () => panel.locator('li').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.keyboard.press('c'); // 14. keyboard Clear
    await expect(panel.locator('li')).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveText(/^live$/i); // Clear never stops the connection

    await page.keyboard.press('s'); // 14. keyboard Stop
    await expect(panel.getByRole('status')).toHaveText(/not started|stopped/i);
  });

  test('16. desktop (1440px): environment badge, drawer, and results table geometry all hold together on one screen', async ({ page }) => {
    await setViewport(page, 1440);
    await gotoFixture(page);
    await search(page);

    await expect(page.getByTitle(/active backend profile/i)).toBeVisible();
    await assertTableGeometry(page, 'table', 2);
    await assertNoHorizontalOverflow(page);

    await page.getByRole('button', { name: /^more filters$/i }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'ui-gap-closure', 'desktop-workspace-1440px');
  });

  test('17. 390px: environment badge and the (now full-width) drawer stay usable with no page-level horizontal overflow', async ({ page }) => {
    await setViewport(page, 390);
    await gotoFixture(page);
    await search(page);
    await assertNoHorizontalOverflow(page);

    await page.getByRole('button', { name: /^more filters$/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await expect(page.getByRole('button', { name: /^apply$/i })).toBeVisible(); // action row always reachable, never hidden behind scroll
    await captureScreenshot(page, 'ui-gap-closure', 'narrow-390px-drawer');
  });
});
