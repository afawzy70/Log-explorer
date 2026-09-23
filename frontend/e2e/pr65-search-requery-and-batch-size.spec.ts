import { test, expect } from '@playwright/test';
import type { Page, Response } from '@playwright/test';

/*
 * PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY — defect 1 (search
 * re-query) and defect 3 (batch size / pagination) E2E coverage.
 *
 * Same shape as `phase-uxr2-search-freshness.spec.ts` and this repo's other
 * owner-reported-defect specs: deterministic Fixture-source E2E, capturing
 * REAL `/api/v1/logs/search` request AND response bodies via
 * `page.waitForResponse`, asserting on their content, never mocking the
 * network. This hits the real backend, the real `SearchService`, and the
 * real `FixtureLogSource`/`EventFilters` pipeline — the same pipeline every
 * other source (including `DockerLogSource`) goes through, so proving
 * "a selective Search sends a genuinely fresh request and finds events the
 * broad search's first page didn't return" here proves the mechanism the
 * Docker-specific progressive-scan fix (defect 1) depends on, without
 * needing a live Docker daemon.
 *
 * Per this project's own established convention (see this file's sibling's
 * own comment, and `phase-legacy-slice3-docker-settings.spec.ts`'s
 * identical precedent): this repo's CI E2E job is Fixture-source-only. A
 * live-Docker acceptance check for defect 1 is verified separately and
 * documented in a verification report, never committed as a permanent CI
 * spec.
 *
 * The Fixture corpus (`FixtureLogSource.CORPUS_SIZE`) was raised from 250
 * to 640 events specifically so it still exceeds the new default page size
 * (500, `DEFAULT_PAGE_SIZE` in `frontend/src/shared/api/pageSize.ts`) the
 * same way it used to exceed the old one (200) — see that constant's own
 * comment for the full reasoning and the sibling specs updated in lockstep.
 */

function searchResponsePromise(page: Page): Promise<Response> {
  return page.waitForResponse(
    (r) => r.url().includes('/api/v1/logs/search') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
}

function requestBodyOf(response: Response): Record<string, unknown> {
  return JSON.parse(response.request().postData() ?? '{}');
}

interface FixtureEvent {
  timestamp: string | null;
  severity: string | null;
  malformed: boolean;
}

interface FixtureSearchResponse {
  events: FixtureEvent[];
  counts: { estimatedTotal: number | null; returned: number; visible: number; limit: number; truncated: boolean };
  nextCursor: string | null;
}

async function gotoFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
  // "Last 1 day" is the default committed preset already — no need to open
  // the Time range menu just to re-select it; the 640-event fixture corpus
  // spans well under 11 minutes from its anchor, comfortably inside it.
}

async function selectErrorsOnly(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^severity:/i }).click();
  await page.getByRole('button', { name: /^errors only$/i }).click();
  await page.keyboard.press('Escape');
}

test.describe('PR65 — search re-query is a real, fresh request (defect 1)', () => {
  test('a broad first Search succeeds, shows results, and requests every level (no levels restriction sent)', async ({
    page,
  }) => {
    await gotoFixture(page);
    const responsePromise = searchResponsePromise(page);
    await page.getByRole('button', { name: /^search$/i }).click();
    const response = await responsePromise;

    const body = requestBodyOf(response);
    expect(body.levels).toBeUndefined(); // every level selected by default == no restriction sent

    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('tbody tr').first()).toBeVisible();
    const json = (await response.json()) as FixtureSearchResponse;
    expect(json.events.length).toBeGreaterThan(0);
  });

  test('selecting ERROR severity and clicking Search sends a genuinely NEW request, whose results include an ERROR event absent from the broad search\'s first page', async ({
    page,
  }) => {
    await gotoFixture(page);

    const broadResponsePromise = searchResponsePromise(page);
    await page.getByRole('button', { name: /^search$/i }).click();
    const broadResponse = await broadResponsePromise;
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });

    const broadBody = requestBodyOf(broadResponse);
    expect(broadBody.levels).toBeUndefined();
    const broadJson = (await broadResponse.json()) as FixtureSearchResponse;
    // Proof the corpus genuinely exceeds one page (640 events > the 500
    // default limit) so this test is not vacuous - some ERROR event is
    // guaranteed to sit outside page 1 by construction.
    expect(broadJson.counts.truncated).toBe(true);
    expect(broadJson.events.length).toBeLessThanOrEqual(500);
    // Malformed fixture lines (CLAUDE.md §4 "Malformed lines become raw
    // fallback events" - one per 40-record cycle here) carry a null
    // canonical `timestamp` even though they have a real sourceTimestamp
    // ordering position; excluded here so a null-timestamp artifact never
    // masquerades as "the oldest real event on page 1".
    const page1WithTimestamps = broadJson.events.filter((e) => e.timestamp);
    expect(page1WithTimestamps.length).toBeGreaterThan(0);
    const oldestOnBroadPage1 = Math.min(...page1WithTimestamps.map((e) => new Date(e.timestamp as string).getTime()));

    // A genuinely new, user-initiated Search - real POST #2 (proven by
    // `searchResponsePromise` resolving to a fresh network exchange, not a
    // client-side re-filter of the 500 rows already on screen).
    await selectErrorsOnly(page);
    const errorResponsePromise = searchResponsePromise(page);
    await page.getByRole('button', { name: /^search$/i }).click();
    const errorResponse = await errorResponsePromise;
    expect(errorResponse.url()).toContain('/api/v1/logs/search');

    const errorBody = requestBodyOf(errorResponse);
    expect(errorBody.levels).toEqual(['ERROR']);
    // Never the same cursor/page reused - this is page 1 of a brand new query.
    expect(errorBody.cursor).toBeUndefined();

    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const errorJson = (await errorResponse.json()) as FixtureSearchResponse;
    expect(errorJson.events.length).toBeGreaterThan(0);
    // Every returned event is either genuinely ERROR, or a malformed
    // fallback event with unknown severity - CLAUDE.md §4's "never exclude
    // an event with a missing or unrecognized severity" applies to a
    // severity filter same as any other, so malformed lines legitimately
    // still appear; nothing with a KNOWN, non-ERROR severity may appear.
    expect(errorJson.events.every((e) => e.severity === 'ERROR' || e.malformed)).toBe(true);
    const realErrorEvents = errorJson.events.filter((e) => e.severity === 'ERROR' && e.timestamp);
    expect(realErrorEvents.length).toBeGreaterThan(0);

    // The core proof: at least one real ERROR event returned by the
    // selective search is OLDER than every real event visible on the broad
    // search's first page - i.e. it was not, and could never have been, on
    // screen before this fresh request ran. This is only possible because
    // the request actually re-scanned the corpus with the new criteria, not
    // because the UI re-filtered the 500 rows it already had.
    const hasEventBeyondBroadPage1 = realErrorEvents.some(
      (e) => new Date(e.timestamp as string).getTime() < oldestOnBroadPage1,
    );
    expect(hasEventBeyondBroadPage1).toBe(true);

    // What the UI shows reflects the fresh request too (the UX-R1/UX-R2
    // state invariant extended to severity).
    await expect(page.getByRole('button', { name: /^severity:/i })).toHaveAccessibleName(/errors only/i);
  });
});

test.describe('PR65 — a narrower custom time interval sends a distinctly-bounded fresh request (defect 1)', () => {
  test('switching from the broad default range to a narrow custom interval sends a new request with different start/end', async ({
    page,
  }) => {
    await gotoFixture(page);

    const broadResponsePromise = searchResponsePromise(page);
    await page.getByRole('button', { name: /^search$/i }).click();
    const broadResponse = await broadResponsePromise;
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const broadBody = requestBodyOf(broadResponse);

    // A genuinely narrower window: the last 2 minutes, set via the Custom
    // popover - same interaction pattern as
    // `phase-uxr2-search-freshness.spec.ts`'s own custom-range test.
    await page.getByRole('button', { name: 'Last 1 day', exact: true }).click();
    // Exact match: once results are on screen, a broader /custom/i regex
    // also matches the "User / Customer" column's sortable header button.
    await page.getByRole('button', { name: 'Custom…', exact: true }).click();
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    const fmt = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    await page.getByLabel(/^start$/i).fill(fmt(twoMinutesAgo));
    await page.getByLabel(/^end$/i).fill(fmt(now));
    await page.getByRole('button', { name: /^apply$/i }).click();

    const narrowResponsePromise = searchResponsePromise(page);
    await page.getByRole('button', { name: /^search$/i }).click();
    const narrowResponse = await narrowResponsePromise;
    await expect(page.getByRole('table').or(page.getByText(/no results/i))).toBeVisible({ timeout: 10_000 });
    const narrowBody = requestBodyOf(narrowResponse);

    // A distinctly new, bounded request - not the same window replayed.
    expect(narrowBody.start).not.toBe(broadBody.start);
    expect(narrowBody.end).not.toBe(broadBody.end);
    const startMs = new Date(narrowBody.start as string).getTime();
    const endMs = new Date(narrowBody.end as string).getTime();
    expect(endMs - startMs).toBeLessThanOrEqual(3 * 60 * 1000); // genuinely ~2 minutes, not the ~24h broad window

    // The committed Time range chip reflects the new, actual interval -
    // never a stale or generic label (CLAUDE.md §4 "Time range").
    await expect(page.getByText(/^Time range:/)).toBeVisible();
    await expect(page.getByText(/^Time range:/)).not.toHaveText(/custom range/i);
  });
});

test.describe('PR65 — batch size: the default requested page size is 500 (defect 3)', () => {
  test('a fresh Search and a Load More both explicitly request limit 500, and Load More appends the remainder with no duplicate rows', async ({
    page,
  }) => {
    await gotoFixture(page);

    const firstResponsePromise = searchResponsePromise(page);
    await page.getByRole('button', { name: /^search$/i }).click();
    const firstResponse = await firstResponsePromise;
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });

    const firstBody = requestBodyOf(firstResponse);
    expect(firstBody.limit).toBe(500);
    const firstJson = (await firstResponse.json()) as FixtureSearchResponse;
    expect(firstJson.counts.limit).toBe(500);
    expect(firstJson.counts.truncated).toBe(true); // 640-event corpus exceeds the 500-event page
    expect(firstJson.nextCursor).toBeTruthy();

    const page1RowCount = await page.locator('tbody tr').count();
    expect(page1RowCount).toBeGreaterThan(0);
    expect(page1RowCount).toBeLessThanOrEqual(500);
    const page1RowTexts = await page.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.textContent ?? ''));

    await expect(page.getByRole('button', { name: /^load more$/i })).toBeVisible();
    const loadMoreResponsePromise = searchResponsePromise(page);
    await page.getByRole('button', { name: /^load more$/i }).click();
    const loadMoreResponse = await loadMoreResponsePromise;

    const loadMoreBody = requestBodyOf(loadMoreResponse);
    expect(loadMoreBody.limit).toBe(500);
    expect(loadMoreBody.cursor).toBe(firstJson.nextCursor); // continues the SAME page's cursor, page size unchanged

    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 10_000 })
      .toBeGreaterThan(page1RowCount);

    const finalRowTexts = await page.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.textContent ?? ''));
    // Every page-1 row is still present, unchanged and un-reordered, and
    // the appended set introduces no duplicates anywhere in the table.
    expect(finalRowTexts.slice(0, page1RowTexts.length)).toEqual(page1RowTexts);
    expect(new Set(finalRowTexts).size).toBe(finalRowTexts.length);
  });

  test('changing severity after a paginated search and clicking Search again does not carry over the previous cursor', async ({
    page,
  }) => {
    await gotoFixture(page);

    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^load more$/i })).toBeVisible();

    const loadMoreResponsePromise = searchResponsePromise(page);
    await page.getByRole('button', { name: /^load more$/i }).click();
    const loadMoreResponse = await loadMoreResponsePromise;
    const loadMoreBody = requestBodyOf(loadMoreResponse);
    expect(loadMoreBody.cursor).toBeTruthy(); // a real, non-empty cursor was in flight

    await selectErrorsOnly(page);
    const freshResponsePromise = searchResponsePromise(page);
    await page.getByRole('button', { name: /^search$/i }).click();
    const freshResponse = await freshResponsePromise;
    const freshBody = requestBodyOf(freshResponse);

    expect(freshBody.cursor).toBeUndefined(); // no stale cursor carried into the new criteria's page 1
    expect(freshBody.levels).toEqual(['ERROR']);
    expect(freshBody.limit).toBe(500); // page size itself is unaffected by the cursor reset

    await expect(page.getByRole('table').or(page.getByText(/no results/i))).toBeVisible({ timeout: 10_000 });
  });
});
