import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport } from './helpers';

/*
 * LEGACY REMEDIATION SLICE 7 — CONSERVATIVE FREE-TEXT SENSITIVE-DATA
 * REDACTION. Covers all 16 mission-listed browser scenarios against the
 * REAL running app and REAL backend redaction - deliberately never
 * mocking the search/context/journey/live response for this mission,
 * since the redaction logic itself lives server-side and a mocked
 * response would only prove the frontend renders whatever fake JSON was
 * written, not that the real TextRedactor actually ran.
 *
 * `FixtureCorpusGenerator`'s own slot 10 (added by this slice) is a
 * deterministic, always-present-once-per-cycle event whose message and
 * exception embed several high-confidence redactable patterns at once
 * (customerId, a valid-Luhn card, a password, a Bearer JWT) plus one
 * deliberately Luhn-INVALID 16-digit "referenceNumber" that must remain
 * visible - see that file's own doc comment for the exact content.
 *
 * Requires the real backend running (`SPRING_PROFILES_ACTIVE=dev`,
 * Fixture source) and the frontend dev server.
 */

const SENTINEL_LABEL = 'customerId=[REDACTED]';
const SENTINEL_CARD = '[REDACTED_CARD]';
const SENTINEL_PASSWORD = 'password=[REDACTED]';
const SENTINEL_BEARER = 'Authorization: Bearer [REDACTED]';
const SAFE_REFERENCE_NUMBER = '1234567890123456'; // Luhn-invalid, must stay visible

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

/** Finds the real, deterministic slot-10 sensitive-data row (may need a few "Load more" clicks since fixture volume exceeds one page). */
async function findSensitiveRow(page: Page) {
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
  return row.first();
}

test.describe('Legacy Remediation Slice 7 — Conservative free-text sensitive-data redaction', () => {
  test('1-2-13. searching finds the event; the raw customer ID never appears anywhere in browser-visible content; the table workflow is otherwise unaffected', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const row = await findSensitiveRow(page);

    await expect(row).toContainText(SENTINEL_LABEL);
    // The raw sentinel value itself never reaches the page at all.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('DEMO-SENSITIVE-778899');
    expect(bodyText).not.toContain('FixtureSecret123!');

    // 13. ordinary table workflow (geometry/columns) unaffected by this row's presence.
    await assertTableGeometry(page, 'table', 2);
    await captureScreenshot(page, 'legacy-slice7', 'search-redacted-row');
  });

  test('3-8-9-10-11-12. the inspector shows every redaction marker, the stack trace stays structurally useful, the invalid-Luhn number and normal IDs remain visible', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const row = await findSensitiveRow(page);

    await row.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    const dialog = page.getByRole('dialog', { name: /event details/i });
    await expect(dialog).toBeVisible();

    const dialogText = await dialog.innerText();
    expect(dialogText).toContain(SENTINEL_LABEL); // 3. redaction marker shown
    expect(dialogText).toContain(SENTINEL_CARD); // 9 (card, verified again below distinctly)
    expect(dialogText).toContain(SENTINEL_PASSWORD); // 10. password key=value redacted
    expect(dialogText).toContain(SENTINEL_BEARER); // 9. Bearer/JWT secret redacted
    expect(dialogText).toContain(SAFE_REFERENCE_NUMBER); // 8. invalid-Luhn 16-digit number stays visible

    // 11. stack trace remains structurally useful - class/method/file/line survive.
    expect(dialogText).toContain('com.logexplorer.fixture.accountsapi.AuthException');
    expect(dialogText).toContain('Auth.check(Auth.java:88)');

    // 12. normal trace/correlation/event IDs remain usable (never redacted).
    expect(dialogText).toMatch(/fixture-trace-\d+/);
    expect(dialogText).toMatch(/fixture-corr-\d+/);
    expect(dialogText).toMatch(/fixture-event-\d+/);

    // No raw secret anywhere, including the inspector's own raw-JSON dump.
    await dialog.getByText('Raw JSON').click();
    const dialogTextWithJson = await dialog.innerText();
    expect(dialogTextWithJson).not.toContain('DEMO-SENSITIVE-778899');
    expect(dialogTextWithJson).not.toContain('FixtureSecret123!');
    expect(dialogTextWithJson).not.toMatch(/Bearer eyJ/);

    await captureScreenshot(page, 'legacy-slice7', 'inspector-redacted');
  });

  test('7. a valid Luhn card-like PAN is specifically redacted, distinct from the password/token markers', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const row = await findSensitiveRow(page);
    await expect(row).toContainText(SENTINEL_CARD);
    // The original card digits never appear anywhere on the page.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('4111 1111 1111 1111');
    expect(bodyText).not.toContain('4111111111111111');
  });

  test('4. the context view ("Show +-30 seconds") keeps the sensitive event redacted', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const row = await findSensitiveRow(page);

    await row.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    await page.getByRole('dialog', { name: /event details/i }).getByRole('button', { name: /show ±30 seconds/i }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByText(/back to original search/i)).toBeVisible({ timeout: 10_000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain(SENTINEL_LABEL);
    expect(bodyText).not.toContain('DEMO-SENSITIVE-778899');
    await captureScreenshot(page, 'legacy-slice7', 'context-redacted');
  });

  test('5. the journey/correlation view keeps the sensitive event redacted', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const row = await findSensitiveRow(page);

    // "Find this Trace ID" - the slot-10 fixture event's own stable, unique traceId.
    await row.locator('td').nth(5).getByRole('button').click();
    await expect(page.getByRole('heading', { name: /trace:/i })).toBeVisible({ timeout: 10_000 });

    const journeyView = page.getByTestId('journey-view');
    await expect(journeyView).toContainText(SENTINEL_LABEL);
    const journeyText = await journeyView.innerText();
    expect(journeyText).not.toContain('DEMO-SENSITIVE-778899');
    await captureScreenshot(page, 'legacy-slice7', 'journey-redacted');
  });

  test('6. a Live event containing the same protected free-text pattern remains redacted', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
    await page.getByRole('button', { name: /^live$/i }).click();
    const panel = page.getByTestId('live-tail-panel');
    await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 10_000 });

    // Fixture live-tail emits one event per 700ms tick (a burst of 5 every
    // 6th tick) - slot 10 (this event) lands at the real corpus's own
    // deterministic global index 10, reached within a handful of real
    // ticks; a generous timeout absorbs real scheduling/dev-server jitter.
    await expect
      .poll(async () => (await panel.innerText()).includes(SENTINEL_LABEL), { timeout: 30_000, intervals: [500] })
      .toBe(true);

    const panelText = await panel.innerText();
    expect(panelText).not.toContain('DEMO-SENSITIVE-778899');
    expect(panelText).not.toContain('FixtureSecret123!');
    await captureScreenshot(page, 'legacy-slice7', 'live-redacted');
  });

  test('14. existing Slice 5 Live behavior (start/pause/resume/stop) remains green', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
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

  test('15. existing Slice 6 context/gap workflow remains green alongside redaction', async ({ page }) => {
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
    await expect(summary).toContainText('Gaps'); // Slice 6's own gap-count stat still present

    await page.getByRole('button', { name: /back to original search/i }).click();
    await expect(page.locator('tbody tr')).toHaveCount(originalRowCount);
  });

  test('16. 390px: redacted content in the table and inspector stays usable with no page-level horizontal overflow', async ({ page }) => {
    await setViewport(page, 390);
    await gotoFixture(page);
    await search(page);
    await assertNoHorizontalOverflow(page);

    const row = await findSensitiveRow(page);
    await expect(row).toContainText(SENTINEL_LABEL);
    await row.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    await expect(page.getByRole('dialog', { name: /event details/i })).toContainText(SENTINEL_LABEL);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'legacy-slice7', 'narrow-390px-redacted');
  });
});
