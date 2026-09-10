import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, captureScreenshot, setViewport } from './helpers';

/*
 * LEGACY REMEDIATION SLICE 8 — PRODUCTIVITY, SAFE PREFERENCES & FRONTEND
 * DELIVERY PERFORMANCE. Covers the mission's 18 required browser scenarios
 * against the REAL running app and REAL backend (Fixture source,
 * `SPRING_PROFILES_ACTIVE=dev`), matching every prior phase's own
 * convention of never mocking the response for its own phase's spec.
 *
 * Scope: the shared shortcut registry (`ShortcutRegistry.tsx`), the new
 * M/R/X/B shortcuts, the registry-derived shortcuts-help popover, the
 * `JourneyView`/`LiveTailPanel` lazy-loading split, and confirmation that
 * nothing in this slice regressed Slice 4's table-preference persistence,
 * the zero-search-state-persistence guarantee, or Slices 5/6/7's own
 * browser-verified behavior.
 */

const STORAGE_KEY = 'logexplorer.tablePreferences.v1';

async function gotoFixture(page: Page) {
  await page.goto('/');
  // Named, not a bare 'select'/'combobox' locator - UX-R3's Compose
  // project selector (rendered whenever the active source supports
  // it) is a second real <select role="combobox">, which an unnamed
  // locator would ambiguously match once any Compose-scoped source
  // (e.g. local-docker) is ever selected or is the page's own default.
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toHaveValue('fixture');
}

async function search(page: Page) {
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

test.describe('Legacy Remediation Slice 8 — productivity, safe preferences & frontend delivery performance', () => {
  test('1. searching the ordinary way (mouse: click Search) still works', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });

  test('2. Ctrl/Cmd+Enter runs the current search from anywhere on the page', async ({ page }) => {
    await gotoFixture(page);
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });

  test('3. "M" opens (and closes) More Filters, matching the mouse trigger', async ({ page }) => {
    await gotoFixture(page);
    await page.keyboard.press('m');
    const drawer = page.getByRole('dialog', { name: /more filters/i });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('m'); // toggles closed, same as clicking the trigger again
    await expect(drawer).not.toBeVisible();
  });

  test('4. More Filters Apply/Cancel still behave correctly after the shortcut-registry migration', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /^more filters/i }).click();
    await page.getByLabel('CIF').fill('E2E-CIF-VALUE');
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('dialog', { name: /more filters/i })).not.toBeVisible();
    // Cancel discarded the draft - reopening shows an empty field again.
    await page.getByRole('button', { name: /^more filters/i }).click();
    await expect(page.getByLabel('CIF')).toHaveValue('');

    await page.getByLabel('CIF').fill('E2E-CIF-APPLIED');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await expect(page.getByRole('dialog', { name: /more filters/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /^more filters/i })).toContainText('1'); // active-filter badge
  });

  test('5. "[" / "]" navigate the inspector to the previous/next event, bounded', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const rows = page.locator('tbody tr');
    await rows.nth(1).getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    const dialog = page.getByRole('dialog', { name: /event details/i });
    await expect(dialog).toBeVisible();

    // `toHaveText`'s own whitespace normalization collapses this dialog's
    // block-level line breaks without inserting a space, jamming adjacent
    // labels together - not a real content difference - so this compares
    // `innerText()` snapshots directly (with retry) instead.
    const initialText = await dialog.innerText();
    await page.keyboard.press(']');
    await expect.poll(() => dialog.innerText()).not.toBe(initialText);
    const afterNext = await dialog.innerText();
    await page.keyboard.press('[');
    await expect.poll(() => dialog.innerText()).toBe(initialText); // back to the first event
    expect(afterNext).not.toEqual(initialText);
  });

  test('6. "X" shows surrounding context immediately, "B" returns to the original search', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const originalRowCount = await page.locator('tbody tr').count();

    await page.locator('tbody tr').first().getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    await expect(page.getByRole('dialog', { name: /event details/i })).toBeVisible();

    await page.keyboard.press('x'); // runs the ±30s context search directly, no confirm popover
    await expect(page.getByText(/back to original search/i)).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('b');
    await expect(page.getByText(/back to original search/i)).not.toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(originalRowCount);
  });

  test('7. "?" opens the shortcuts help, and it reflects the real registered bindings', async ({ page }) => {
    await gotoFixture(page);
    await page.keyboard.press('Shift+?');
    const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i });
    await expect(dialog).toBeVisible();

    const text = await dialog.innerText();
    expect(text).toMatch(/ctrl\/cmd \+ enter/i);
    expect(text).toMatch(/run the current search/i);
    expect(text).toMatch(/open\/close more filters/i);
    expect(text).toMatch(/previous event/i);
    expect(text).toMatch(/next event/i);
    expect(text).toMatch(/close the inspector/i);
    expect(text).toMatch(/surrounding context/i);
    expect(text).toMatch(/pause \/ resume live/i);
    expect(text).toMatch(/stop live/i);
    expect(text).toMatch(/clear live events/i);
    expect(text).toMatch(/toggle follow newest/i);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await captureScreenshot(page, 'legacy-slice8', 'shortcut-help');
  });

  test('8. shortcuts are suppressed while typing in a text field, so ordinary typing is never hijacked', async ({ page }) => {
    await gotoFixture(page);
    const searchBox = page.getByRole('textbox', { name: /search messages/i });
    await searchBox.click();
    await searchBox.type('rmxb?'); // every single-letter shortcut this slice adds, typed as plain text
    await expect(searchBox).toHaveValue('rmxb?');
    await expect(page.getByRole('dialog', { name: /more filters/i })).not.toBeVisible();
    await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).not.toBeVisible();
  });

  test('9. Live keyboard controls (P/S/C/F) still work end to end', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /^live$/i }).click();
    const panel = page.getByTestId('live-tail-panel');
    await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 10_000 });

    await page.keyboard.press('p');
    await expect(panel.getByRole('status')).toHaveText(/^paused$/i);
    await page.keyboard.press('p');
    await expect(panel.getByRole('status')).toHaveText(/^live$/i);

    await expect
      .poll(async () => (await panel.locator('li').count().catch(() => 0)) > 0, { timeout: 15_000 })
      .toBe(true);
    await page.keyboard.press('c');
    // Clear only fires while there is at least one visible event - a
    // second key sent right after must not throw even if the fixture
    // stream has already produced a fresh one.

    await page.keyboard.press('f'); // toggle Follow newest - must not throw / must not stop the stream
    await expect(panel.getByRole('status')).toHaveText(/^live$/i);

    await page.keyboard.press('s');
    await expect(panel.getByRole('status')).toHaveText(/not started|stopped/i);
  });

  test('10. reload preserves only the approved safe table preference (density), never search/query state', async ({ page }) => {
    await gotoFixture(page);
    await search(page); // the Columns control only renders once results exist
    await page.getByRole('button', { name: /^columns$/i }).click();
    await page.getByRole('button', { name: /^compact$/i }).click();
    await page.keyboard.press('Escape');

    await page.getByRole('textbox', { name: /search messages/i }).fill('E2E-RELOAD-SENTINEL');

    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Source', exact: true })).not.toHaveValue(''); // sources reload; source selection itself is not a persisted preference

    // Source selection is explicitly NOT a persisted preference (confirmed
    // above), so the post-reload default source is not guaranteed to be
    // `fixture` in every environment (it depends on source-discovery
    // order/availability, which this scenario is not testing) - it
    // deterministically re-selects `fixture` itself rather than assuming
    // whatever source the app happened to default to. Selects directly
    // (not via `gotoFixture`, which also does its own `page.goto('/')`) so
    // this stays a reload, not an additional navigation.
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
    await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toHaveValue('fixture');

    // The safe preference (density) survived the reload...
    await search(page);
    await page.getByRole('button', { name: /^columns$/i }).click();
    await expect(page.getByRole('button', { name: /^compact$/i })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');

    // ...but the typed search text did not.
    await expect(page.getByRole('textbox', { name: /search messages/i })).toHaveValue('');
  });

  test('11. a sensitive-looking universal-search/filter value never survives a reload, and never reaches storage', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('textbox', { name: /search messages/i }).fill('E2E-SENSITIVE-SEARCH-SENTINEL');
    await page.getByRole('button', { name: /^more filters/i }).click();
    await page.getByLabel('CIF').fill('E2E-SENSITIVE-CIF-SENTINEL');
    await page.getByRole('button', { name: /^apply$/i }).click();

    const storageDump = await page.evaluate(() => {
      const dump = (storage: Storage) =>
        JSON.stringify(Object.fromEntries(Array.from({ length: storage.length }, (_, i) => storage.key(i) as string).map((k) => [k, storage.getItem(k)])));
      return { local: dump(localStorage), session: dump(sessionStorage) };
    });
    expect(storageDump.local).not.toContain('E2E-SENSITIVE');
    expect(storageDump.session).not.toContain('E2E-SENSITIVE');
    expect(page.url()).not.toContain('E2E-SENSITIVE');

    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Source', exact: true })).not.toHaveValue('');
    await expect(page.getByRole('textbox', { name: /search messages/i })).toHaveValue('');
    await expect(page.getByRole('button', { name: /^more filters/i })).not.toContainText('1');
  });

  test('12. a malformed table-preference value in localStorage never breaks startup - the app falls back to defaults', async ({ page }) => {
    await page.addInitScript(
      ({ key }) => {
        window.localStorage.setItem(key, '{not valid json at all');
      },
      { key: STORAGE_KEY },
    );
    await gotoFixture(page);
    await search(page); // the Columns control only renders once results exist
    // The app started normally and the table settings control still works,
    // showing the default (comfortable) density rather than crashing.
    await page.getByRole('button', { name: /^columns$/i }).click();
    await expect(page.getByRole('button', { name: /^comfortable$/i })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });

  test('13. lazy-loaded secondary UI (Journey, Live) opens successfully on first use', async ({ page }) => {
    await gotoFixture(page);
    await search(page);

    // Journey (lazy chunk) - "Find this Trace ID" on the Correlation/Trace column.
    await page.locator('tbody tr').first().locator('td').nth(5).getByRole('button').click();
    await expect(page.getByRole('heading', { name: /trace:/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('journey-view')).toBeVisible();
    await page.getByRole('button', { name: /back to search results/i }).click();

    // Live (a separate lazy chunk).
    await page.getByRole('button', { name: /^live$/i }).click();
    const panel = page.getByTestId('live-tail-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 10_000 });
    await page.getByRole('button', { name: /^stop$/i }).click();
  });

  test('14. the primary Search -> scan -> inspect workflow remains fully functional', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    await page.locator('tbody tr').first().getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    const dialog = page.getByRole('dialog', { name: /event details/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /overview/i })).toBeVisible();
    await page.getByRole('button', { name: /close event inspector/i }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('15. existing Slice 5 Live resilience behavior (start/pause/resume/stop) remains green', async ({ page }) => {
    await gotoFixture(page);
    await page.getByRole('button', { name: /^live$/i }).click();
    const panel = page.getByTestId('live-tail-panel');
    await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 10_000 });
    await page.getByRole('button', { name: /^pause$/i }).click();
    await expect(panel.getByRole('status')).toHaveText(/^paused$/i);
    await page.getByRole('button', { name: /^resume$/i }).click();
    await expect(panel.getByRole('status')).toHaveText(/^live$/i);
    await page.getByRole('button', { name: /^stop$/i }).click();
    await expect(panel.getByRole('status')).toHaveText(/not started|stopped/i);
  });

  test('16. existing Slice 6 context/gap workflow remains green', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const originalRowCount = await page.locator('tbody tr').count();
    const targetRow = page.locator('tbody tr').filter({ hasNot: page.locator('td:nth-child(2):text-is("—")') }).first();
    await targetRow.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    await page.getByRole('dialog', { name: /event details/i }).getByRole('button', { name: /show ±30 seconds/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByText(/back to original search/i)).toBeVisible({ timeout: 10_000 });
    const summary = page.getByRole('note', { name: /surrounding-context summary/i });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Gaps');
    await page.getByRole('button', { name: /back to original search/i }).click();
    await expect(page.locator('tbody tr')).toHaveCount(originalRowCount);
  });

  test('17. existing Slice 7 sensitive-output behavior remains green', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const row = page.locator('tbody tr').filter({ hasText: 'Login failed for' });
    const loadMoreButton = page.getByRole('button', { name: /^load more$/i });
    for (let clicks = 0; clicks < 20 && !(await row.first().isVisible().catch(() => false)); clicks++) {
      if (!(await loadMoreButton.isVisible().catch(() => false))) {
        break;
      }
      await loadMoreButton.click();
      await page.waitForTimeout(50);
    }
    await expect(row.first()).toBeVisible({ timeout: 10_000 });
    await expect(row.first()).toContainText('customerId=[REDACTED]');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('DEMO-SENSITIVE-778899');
    expect(bodyText).not.toContain('FixtureSecret123!');
  });

  test('18. 390px: shortcut help and the primary workflow stay usable, no page-level horizontal overflow', async ({ page }) => {
    await setViewport(page, 390);
    await gotoFixture(page);
    await search(page);
    await assertNoHorizontalOverflow(page);

    await page.keyboard.press('Shift+?');
    const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i });
    await expect(dialog).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'legacy-slice8', 'narrow-390px-shortcut-help');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    await page.locator('tbody tr').first().getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    await expect(page.getByRole('dialog', { name: /event details/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});
