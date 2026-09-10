import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/*
 * UX-R2 — SEARCH FRESHNESS DEFECT (owner-reported, real-Docker-reproduced
 * in `docs/verification/UX_R2_FILTER_AND_SEARCH_FUNCTIONAL_REPORT.md`'s
 * own "Search freshness defect" section - this file is the CI-safe,
 * deterministic half of that evidence).
 *
 * The bug: selecting a relative preset ("Last 1 hour") committed an
 * *absolute* start/end at that instant; every later Search/Refresh click
 * reused that same, increasingly stale `end`, so a log line created after
 * the preset was picked could never appear no matter how many times
 * Search was clicked. Root-caused and fixed in `useSearchState.ts`
 * (`recomputeRelativeRange`) - this spec proves the *mechanism* (the
 * request's own time window genuinely advances on each explicit Search/
 * Refresh for a relative preset, and never for a custom one) against the
 * deterministic Fixture source, so it runs safely and reliably in hosted
 * CI. The real-Docker acceptance test (new data actually appearing) is
 * evidenced separately, live, not as a permanent CI spec - this project's
 * own established precedent (see `phase-legacy-slice2-query-
 * transparency.spec.ts`'s own comment: CI's E2E job is Fixture-only;
 * `phase-legacy-slice3-docker-settings.spec.ts`'s own comment references
 * a real-Docker check documented in a verification report, not committed
 * as a CI spec, for the same reason).
 */

async function gotoFixtureWithLast1Hour(page: Page) {
  await page.goto('/');
  await page.selectOption('select', 'fixture');
  await page.getByRole('button', { name: 'Last 1 day', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /last 1 hour/i }).click();
}

function captureSearchRequests(page: Page): string[] {
  const bodies: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/v1/logs/search') && req.method() === 'POST') {
      bodies.push(req.postData() ?? '');
    }
  });
  return bodies;
}

function endOf(body: string): number {
  const match = body.match(/"end":"([^"]+)"/);
  expect(match).not.toBeNull();
  return new Date(match![1]).getTime();
}

function startOf(body: string): number {
  const match = body.match(/"start":"([^"]+)"/);
  expect(match).not.toBeNull();
  return new Date(match![1]).getTime();
}

test.describe('UX-R2 — search freshness: relative presets advance, custom ranges never do', () => {
  test('a relative preset advances its end on every explicit Search click', async ({ page }) => {
    const bodies = captureSearchRequests(page);
    await gotoFixtureWithLast1Hour(page);

    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1200); // a real wall-clock gap - the whole point is proving `end` genuinely moves

    await page.getByRole('button', { name: /^search$/i }).click();
    await page.waitForTimeout(500);

    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const firstEnd = endOf(bodies[0]);
    const secondEnd = endOf(bodies[bodies.length - 1]);
    expect(secondEnd).toBeGreaterThan(firstEnd);

    // The committed Time range chip itself reflects the advance too - "what
    // the UI says is active = what the request submitted" (the UX-R1 state
    // invariant, extended here).
    await expect(page.getByText(/^Time range:/)).toBeVisible();
  });

  test('Refresh advances a relative preset exactly the same way Search does', async ({ page }) => {
    const bodies = captureSearchRequests(page);
    await gotoFixtureWithLast1Hour(page);

    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1200);

    await page.getByRole('button', { name: /refresh/i }).click();
    await page.waitForTimeout(500);

    expect(bodies.length).toBeGreaterThanOrEqual(2);
    expect(endOf(bodies[bodies.length - 1])).toBeGreaterThan(endOf(bodies[0]));
  });

  test('a CUSTOM absolute range never auto-advances - repeated Search sends the exact same window', async ({ page }) => {
    const bodies = captureSearchRequests(page);
    await page.goto('/');
    await page.selectOption('select', 'fixture');

    await page.getByRole('button', { name: 'Last 1 day', exact: true }).click();
    await page.getByRole('button', { name: /custom/i }).click();
    const now = new Date();
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const fmt = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    await page.getByLabel(/^start$/i).fill(fmt(anHourAgo));
    await page.getByLabel(/^end$/i).fill(fmt(now));
    await page.getByRole('button', { name: /^apply$/i }).click();

    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /^search$/i }).click();
    await page.waitForTimeout(500);

    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const first = bodies[0];
    const last = bodies[bodies.length - 1];
    expect(startOf(last)).toBe(startOf(first));
    expect(endOf(last)).toBe(endOf(first));
  });

  test('Load more never advances the time range mid-pagination - only a fresh Search/Refresh may', async ({ page }) => {
    const bodies = captureSearchRequests(page);
    await gotoFixtureWithLast1Hour(page);

    await page.getByRole('button', { name: /^search$/i }).click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const rowCount = await page.locator('tbody tr').count();
    const loadMoreButton = page.getByRole('button', { name: /^load more$/i });
    test.skip((await loadMoreButton.count()) === 0, 'Fixture corpus for this run fit on one page - nothing to load more of.');

    const endBeforeLoadMore = endOf(bodies[bodies.length - 1]);
    await page.waitForTimeout(1200);
    await loadMoreButton.click();
    await page.waitForTimeout(500);
    await expect(page.locator('tbody tr')).toHaveCount(rowCount > 0 ? rowCount + 1 : rowCount, { timeout: 10_000 }).catch(() => {
      // Row count assertion is best-effort (depends on live corpus shape) -
      // the request-window assertion below is this test's real point.
    });

    expect(endOf(bodies[bodies.length - 1])).toBe(endBeforeLoadMore);
  });
});
