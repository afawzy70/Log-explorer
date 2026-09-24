import { test, expect } from '@playwright/test';
import type { Page, Response } from '@playwright/test';

/*
 * Owner follow-up to the "Error only surfaced non-error events" fix
 * (`EventFilters.UNKNOWN_SEVERITY_LEVEL`, `frontend/src/features/search/
 * severityLevels.ts`'s new "Unknown" level): a well-formed event with no
 * severity value is now excluded by an active level filter unless the
 * investigator explicitly opts into seeing that bucket via a new,
 * dedicated "Unknown" chip in the Severity popover, rather than its
 * visibility being an accidental side effect of which other levels happen
 * to be selected.
 *
 * Real backend, real Fixture source, real `/api/v1/logs/search` request/
 * response bodies via `page.waitForResponse` (this repo's own established
 * convention - see `pr65-search-requery-and-batch-size.spec.ts`'s
 * identical pattern), never a mocked network.
 *
 * The deterministic Fixture corpus (`FixtureCorpusGenerator`) does not
 * currently generate any WELL-FORMED line with a missing severity value -
 * every well-formed line always carries a real ERROR/WARN/INFO level - but
 * it does have real malformed raw-fallback lines, which also have no
 * severity by definition and are unconditionally exempt from the level
 * filter (HANDOVER.md §5.4 "never dropped", regardless of Unknown being
 * selected or not). Selecting only "Unknown" against the real backend was
 * confirmed empirically (not assumed) to surface exactly those - this
 * proves the full request/response WIRING (the frontend sends the exact
 * sentinel, the backend accepts and processes it, the malformed-exemption
 * and the new Unknown bucket compose correctly against real data), while
 * the well-formed-no-severity inclusion/exclusion LOGIC itself is proven
 * precisely and deterministically at the unit level
 * (`EventFiltersTest.selectingTheUnknownLevelMatchesAWellFormedNoSeverityEventButNotOneWithARealSeverity`).
 * Deliberately does not add a synthetic well-formed no-severity line to
 * the shared fixture corpus for this - CORPUS_SIZE and its exact
 * deterministic content are relied on by several other E2E specs' own
 * row/count
 * assertions (see that constant's own comment), so changing what the
 * corpus contains belongs to a change that actually needs it, not this one.
 */

function searchResponsePromise(page: Page): Promise<Response> {
  return page.waitForResponse((r) => r.url().includes('/api/v1/logs/search') && r.request().method() === 'POST', {
    timeout: 10_000,
  });
}

function requestBodyOf(response: Response): Record<string, unknown> {
  return JSON.parse(response.request().postData() ?? '{}');
}

async function gotoFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
}

async function openSeverityPopover(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^severity:/i }).click();
}

test('the Severity popover offers a distinct "Unknown" level, separate from every real severity', async ({ page }) => {
  await gotoFixture(page);
  await openSeverityPopover(page);

  const dialog = page.getByRole('dialog', { name: 'Severity' });
  for (const label of ['Trace', 'Debug', 'Info', 'Warn', 'Error', 'Unknown']) {
    await expect(dialog.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  // Every level starts selected (owner requirement - fresh default), Unknown included.
  await expect(dialog.getByRole('button', { name: 'Unknown', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('selecting only "Unknown" sends levels=["UNKNOWN"] to the real backend and returns exactly the fixture\'s malformed lines - the only real events with no severity at all', async ({
  page,
}) => {
  // The deterministic Fixture corpus has no WELL-FORMED line with a
  // missing severity - but it does have real malformed raw-fallback
  // lines, which also have no severity by definition and are always
  // exempt from the level filter regardless of what's selected
  // (HANDOVER.md §5.4 "never dropped" - see EventFiltersTest's own
  // `aMalformedLineStaysExemptFromTheLevelFilterEvenWhenUnknownIsNotSelected`).
  // So selecting only "Unknown" is expected to surface exactly those -
  // discovered empirically against the real backend, not assumed.
  await gotoFixture(page);
  await openSeverityPopover(page);

  const dialog = page.getByRole('dialog', { name: 'Severity' });
  // Deselect every real level, leaving only Unknown selected.
  for (const label of ['Trace', 'Debug', 'Info', 'Warn', 'Error']) {
    await dialog.getByRole('button', { name: label, exact: true }).click();
  }
  await page.keyboard.press('Escape');

  const responsePromise = searchResponsePromise(page);
  await page.getByRole('button', { name: /^search$/i }).click();
  const response = await responsePromise;

  const body = requestBodyOf(response);
  expect(body.levels).toEqual(['UNKNOWN']);
  expect(response.status()).toBe(200);

  const json = (await response.json()) as {
    events: Array<{ severity: string | null; malformed: boolean }>;
    counts: { returned: number };
  };
  expect(json.counts.returned).toBeGreaterThan(0);
  for (const event of json.events) {
    expect(event.malformed).toBe(true);
    expect(event.severity).toBeNull();
  }

  await expect(page.getByRole('table')).toBeVisible();
});

test('"Errors only" excludes Unknown - selecting it does not also send UNKNOWN, and every non-malformed returned event is a real ERROR', async ({
  page,
}) => {
  await gotoFixture(page);
  await openSeverityPopover(page);
  const dialog = page.getByRole('dialog', { name: 'Severity' });
  await dialog.getByRole('button', { name: /^errors only$/i }).click();
  await page.keyboard.press('Escape');

  const responsePromise = searchResponsePromise(page);
  await page.getByRole('button', { name: /^search$/i }).click();
  const response = await responsePromise;

  const body = requestBodyOf(response);
  expect(body.levels).toEqual(['ERROR']);

  const json = (await response.json()) as {
    events: Array<{ severity: string | null; malformed: boolean }>;
  };
  expect(json.events.length).toBeGreaterThan(0);
  for (const event of json.events) {
    if (!event.malformed) {
      expect(event.severity).toBe('ERROR');
    }
  }
});
