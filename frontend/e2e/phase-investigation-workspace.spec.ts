import { test, expect } from '@playwright/test';
import { captureScreenshot } from './helpers';
import { openInspectorTab } from './inspector-helpers';

/*
 * Browser checks for owner mission "Mapping Verification and Investigation
 * Workspace" - Part B (Investigation Workspace). Drives a real search
 * against the real backend's `fixture` source, opens a real event's
 * inspector, and exercises the new View Span / Find same Correlation
 * actions plus root-event anchoring, position indicator, and the
 * "Back to Trace" continuity flow (Surroundings launched from within a
 * Trace view). Requires the real backend (`SPRING_PROFILES_ACTIVE=dev`)
 * and the frontend dev server - real rendered evidence, never inferred
 * from source (CLAUDE.md §6).
 */

async function runRealSearch(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  await page.getByRole('button', { name: /^search$/i }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

/** Opens the inspector on the first visible row and switches to the Request flow tab, where all five investigation actions live. */
async function openFirstRowRequestFlow(page: import('@playwright/test').Page) {
  await page.locator('tbody tr').first().click();
  const dialog = page.getByRole('dialog', { name: /event details/i });
  await expect(dialog).toBeVisible();
  await openInspectorTab(dialog, page, /request flow/i);
  return dialog;
}

test('View Span opens a real bounded span timeline, rooted on the event it was launched from', async ({ page }) => {
  await runRealSearch(page);

  // Not every fixture event carries a spanId - find a real row that does
  // via the actual Request flow tab, rather than assuming row 0 has one.
  const rows = page.locator('tbody tr');
  const rowCount = await rows.count();
  let opened = false;
  for (let i = 0; i < rowCount && !opened; i++) {
    await rows.nth(i).click();
    const dialog = page.getByRole('dialog', { name: /event details/i });
    await expect(dialog).toBeVisible();
    await openInspectorTab(dialog, page, /request flow/i);
    const viewSpan = dialog.getByRole('button', { name: /^view span$/i });
    if (await viewSpan.isVisible().catch(() => false)) {
      await viewSpan.click();
      opened = true;
    } else {
      await page.getByRole('button', { name: /^close$/i }).click();
    }
  }
  expect(opened, 'expected at least one fixture event with a spanId').toBe(true);

  await expect(page.getByRole('heading', { name: /span:/i })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /event details/i })).not.toBeVisible();
  // Root anchoring + position indicator (owner mission - "Selected event: N of M").
  // B5 RECOMPOSE - "Selected event" (the stat-row label) and its value ("N of M") are now adjacent
  // sibling spans (InvestigationStatRow's own grammar), not one combined "Selected event: N of M" string.
  // The timeline plot's own trigger flag repeats "Selected event" as its own label too (real text, not
  // colour alone) - the stat row renders first in the DOM, so .first() is the stat-row's own label.
  const selectedEventLabel = page.getByText('Selected event').first();
  await expect(selectedEventLabel).toBeVisible();
  await expect(selectedEventLabel.locator('xpath=following-sibling::*[1]')).toHaveText(/\d+ of \d+/i);
  await expect(page.locator('[aria-current="location"]')).toBeVisible();

  await captureScreenshot(page, 'investigation-workspace', 'view-span-timeline');
});

test('Find same Correlation opens a real bounded correlation timeline, rooted on the launching event', async ({
  page,
}) => {
  await runRealSearch(page);

  const rows = page.locator('tbody tr');
  const rowCount = await rows.count();
  let opened = false;
  for (let i = 0; i < rowCount && !opened; i++) {
    await rows.nth(i).click();
    const dialog = page.getByRole('dialog', { name: /event details/i });
    await expect(dialog).toBeVisible();
    await openInspectorTab(dialog, page, /request flow/i);
    const findCorrelation = dialog.getByRole('button', { name: /^find same correlation$/i });
    if (await findCorrelation.isVisible().catch(() => false)) {
      await findCorrelation.click();
      opened = true;
    } else {
      await page.getByRole('button', { name: /^close$/i }).click();
    }
  }
  expect(opened, 'expected at least one fixture event with a correlationId').toBe(true);

  await expect(page.getByRole('heading', { name: /correlation:/i })).toBeVisible();
  // B5 RECOMPOSE - "Selected event" (the stat-row label) and its value ("N of M") are now adjacent
  // sibling spans (InvestigationStatRow's own grammar), not one combined "Selected event: N of M" string.
  // The timeline plot's own trigger flag repeats "Selected event" as its own label too (real text, not
  // colour alone) - the stat row renders first in the DOM, so .first() is the stat-row's own label.
  const selectedEventLabel = page.getByText('Selected event').first();
  await expect(selectedEventLabel).toBeVisible();
  await expect(selectedEventLabel.locator('xpath=following-sibling::*[1]')).toHaveText(/\d+ of \d+/i);

  await captureScreenshot(page, 'investigation-workspace', 'find-same-correlation-timeline');
});

test('Show Surroundings launched from inside a Trace view, then Back to Trace, restores that same trace timeline', async ({
  page,
}) => {
  await runRealSearch(page);

  const idCell = page.locator('tbody tr').first().locator('td').nth(6);
  const idText = (await idCell.textContent()) ?? '';
  const traceIdValue = idText.replace(/^.*ID:/i, '').trim();
  await idCell.getByRole('button').click();
  await expect(page.getByRole('heading', { name: /trace:/i })).toBeVisible();

  // B5 RECOMPOSE - the card list's own listitems are gone (`JourneyEntryRow` -> `SequenceTable`, a real
  // <table>); row count is now every real event row in the sequence table body.
  const journeyView = page.getByTestId('journey-view');
  const eventCountBefore = await journeyView.locator('table tbody tr').count();

  // Launch Surroundings from the root entry inside the Trace view.
  await journeyView.getByRole('button', { name: /^show surroundings$/i }).first().click();
  await page.getByRole('button', { name: /^run$/i }).click();

  // The journey overlay is gone while Surroundings is showing - a real results table instead.
  await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('journey-view')).not.toBeVisible();

  const backButton = page.getByRole('button', { name: /back to trace/i });
  await expect(backButton).toBeVisible();
  await backButton.click();

  // The same Trace view is restored, not plain search - same title, same event count.
  await expect(page.getByRole('heading', { name: /trace:/i })).toBeVisible();
  await expect(page.getByText(traceIdValue, { exact: false }).first()).toBeVisible();
  await expect(journeyView.locator('table tbody tr')).toHaveCount(eventCountBefore);

  await captureScreenshot(page, 'investigation-workspace', 'back-to-trace-after-surroundings');
});
