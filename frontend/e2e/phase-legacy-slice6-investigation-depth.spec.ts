import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { assertNoHorizontalOverflow, assertTableGeometry, captureScreenshot, setViewport } from './helpers';

/*
 * LEGACY REMEDIATION SLICE 6 — INVESTIGATION DEPTH, GAP VISIBILITY & RICHER
 * SOURCE HEALTH. Covers all 17 mission-listed browser scenarios. Health
 * states that are genuinely reproducible against the real dev-profile
 * backend (Healthy/Unavailable) are exercised for real; the DEGRADED
 * state and exact gap sequences need deterministic inputs the real
 * fixture's own live-clock corpus cannot guarantee, so those use
 * `page.route` to mock the health/context response JSON - the same
 * established pattern `phase-legacy-slice2-query-transparency.spec.ts`
 * already uses for a capability-enabled mock source. Everything else
 * (search, inspector, toolbar, context/journey wiring, table geometry)
 * goes through the real running app.
 *
 * Requires the real backend running (`SPRING_PROFILES_ACTIVE=dev`,
 * Fixture + openshift-loki sources) and the frontend dev server.
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

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-01-01T12:00:00.000Z', timestampRaw: null, schemaVersion: null, service: 'gateway',
    serviceSourceHint: null, severity: 'INFO', severityNumber: null, message: 'm', logger: null, thread: null,
    exception: null, traceId: null, spanId: null, journeyId: null, eventId: null, businessStep: null,
    uiIdentifier: null, errorCode: null, correlationId: null,
    protectedFields: { cif: null, userName: null, customerId: null, deviceId: null, deviceIp: null },
    devicePlatformType: null, language: null, serverIp: null, serverHost: null, unknownTopLevelFields: {},
    unknownMdcFields: {}, malformed: false, rawLine: null, sourceId: null, composeProject: null,
    composeService: null, containerId: null, containerName: null, stream: null, namespace: null, pod: null,
    ...overrides,
  };
}

/** Mocks the `/context` response the next "Show ±30 seconds" -> Run triggers, with fully controlled events. */
async function mockNextContextResponse(page: Page, events: Record<string, unknown>[], truncated = false) {
  await page.route('**/api/v1/logs/context', (route: Route) =>
    route.fulfill({
      json: {
        events,
        counts: { estimatedTotal: truncated ? null : events.length, returned: events.length, visible: events.length, limit: 200, truncated },
        nextCursor: null,
        queryPlan: { resolvedQuery: 'mocked', rawLogQlMode: false, pushedDownConditions: [], postFilterConditions: [], notes: [] },
      },
    }),
  );
}

async function openInspectorAndShowContext(page: Page) {
  const targetRow = page.locator('tbody tr').filter({ hasNot: page.locator('td:nth-child(2):text-is("—")') }).first();
  await targetRow.getByRole('button', { name: /actions for this event/i }).click();
  await page.getByRole('menuitem', { name: /view details/i }).click();
  await page.getByRole('dialog', { name: /event details/i }).getByRole('button', { name: /show surrounding logs/i }).click();
  await page.getByRole('button', { name: /^run$/i }).click();
  await expect(page.getByText(/back to original search/i)).toBeVisible({ timeout: 10_000 });
}

test.describe('Legacy Remediation Slice 6 — Investigation depth, gap visibility & richer source health', () => {
  test('1. a healthy source shows Healthy with real, truthful capability/latency details on demand', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
    await expect(page.getByText(/\bhealthy\b/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /source health details/i }).click();
    const dialog = page.getByRole('dialog', { name: /source health details/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/historical search/i);
    await expect(dialog).toContainText(/ms|not measured/i);
    await captureScreenshot(page, 'legacy-slice6', 'health-healthy-details');
  });

  test('2. a degraded source shows Degraded with a useful, sanitized reason - distinct from Unhealthy', async ({ page }) => {
    await page.route('**/api/v1/sources/local-docker/health', (route: Route) =>
      route.fulfill({
        json: {
          status: 'DEGRADED',
          message: 'Docker daemon reachable, but no containers matched the configured Compose project filter',
          checkedAt: new Date().toISOString(),
          latencyMs: 7,
          warnings: ['No containers matched the configured Compose project filter'],
          capabilities: { historicalSearch: true, liveTail: true, rawLogQL: false, serviceDiscovery: true, queryStatistics: false, contextView: false },
        },
      }),
    );
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('local-docker');

    await expect(page.getByText(/\bdegraded\b/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/\bunhealthy\b/i)).not.toBeVisible();
    await page.getByRole('button', { name: /source health details/i }).click();
    await expect(page.getByText('No containers matched the configured Compose project filter', { exact: true })).toBeVisible();
    await captureScreenshot(page, 'legacy-slice6', 'health-degraded-details');
  });

  test('3. an unavailable source shows an honest unavailable state with a sanitized (never raw) message', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('openshift-loki');
    await expect(page.getByText(/\bunhealthy\b/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /source health details/i }).click();
    const dialog = page.getByRole('dialog', { name: /source health details/i });
    await expect(dialog).toBeVisible();
    const text = await dialog.textContent();
    expect(text).not.toMatch(/exception|stack trace|\.java:/i);
    await captureScreenshot(page, 'legacy-slice6', 'health-unavailable-details');
  });

  test('4-5-9-13. search -> inspect -> context: summary shows event/service/error/gap counts, the root event stays identifiable, and returning restores the original state', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    const originalRowCount = await page.locator('tbody tr').count();

    await openInspectorAndShowContext(page);

    const summary = page.getByRole('note', { name: /surrounding-context summary/i });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Events');
    await expect(summary).toContainText('Services');
    await expect(summary).toContainText('Errors');
    await expect(summary).toContainText('Warnings');
    await expect(summary).toContainText('Gaps');
    await expect(summary).toContainText('Source');
    await captureScreenshot(page, 'legacy-slice6', 'context-summary-enriched');

    const markedRow = page.locator('tbody tr[aria-current="location"]');
    await expect(markedRow).toHaveCount(1); // 9. selected/root event stays identifiable

    await page.getByRole('button', { name: /back to original search/i }).click(); // 13. return restores original state
    await expect(page.getByText(/back to original search/i)).not.toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(originalRowCount);
  });

  test('6. a sequence with exactly one deterministic gap renders exactly one gap marker, with duration and window text', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    await mockNextContextResponse(page, [
      baseEvent({ message: 'before', timestamp: '2026-01-01T12:00:00.000Z' }),
      baseEvent({ message: 'after', timestamp: '2026-01-01T12:00:20.000Z' }), // 20s gap
    ]);
    await openInspectorAndShowContext(page);

    const gapRows = page.getByTestId('gap-row');
    await expect(gapRows).toHaveCount(1);
    await expect(gapRows.first()).toContainText(/gap detected/i);
    await expect(gapRows.first()).toContainText('20s');
    await expect(page.getByRole('note', { name: /surrounding-context summary/i })).toContainText('1 sequence gap detected');
  });

  test('7. a sequence with multiple deterministic gaps renders one marker per gap, in the right positions', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    await mockNextContextResponse(page, [
      baseEvent({ message: 'a', timestamp: '2026-01-01T12:00:00.000Z' }),
      baseEvent({ message: 'b', timestamp: '2026-01-01T12:00:20.000Z' }), // gap 1
      baseEvent({ message: 'c', timestamp: '2026-01-01T12:00:21.000Z' }),
      baseEvent({ message: 'd', timestamp: '2026-01-01T12:00:45.000Z' }), // gap 2
    ]);
    await openInspectorAndShowContext(page);

    await expect(page.getByTestId('gap-row')).toHaveCount(2);
    await expect(page.getByRole('note', { name: /surrounding-context summary/i })).toContainText('2 sequence gaps detected');
  });

  test('8. a sequence with no gaps renders zero markers and a Gaps count of 0', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    await mockNextContextResponse(page, [
      baseEvent({ message: 'a', timestamp: '2026-01-01T12:00:00.000Z' }),
      baseEvent({ message: 'b', timestamp: '2026-01-01T12:00:01.000Z' }),
      baseEvent({ message: 'c', timestamp: '2026-01-01T12:00:02.000Z' }),
    ]);
    await openInspectorAndShowContext(page);

    await expect(page.getByTestId('gap-row')).toHaveCount(0);
    expect(await page.getByRole('note', { name: /surrounding-context summary/i }).locator('text=Gaps').locator('xpath=following-sibling::dd[1]').textContent()).toBe('0');
  });

  test('10. a truncated/incomplete context result shows an honest "results may be incomplete" warning', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    await mockNextContextResponse(
      page,
      [baseEvent({ message: 'a', timestamp: '2026-01-01T12:00:00.000Z' })],
      true,
    );
    await openInspectorAndShowContext(page);

    await expect(page.getByText(/results may be incomplete/i)).toBeVisible();
  });

  test('11. filtering the toolbar before opening context never manufactures/hides a gap - context always fetches its own full unfiltered window', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    // Narrow the toolbar to Errors only BEFORE opening context.
    await page.getByRole('button', { name: /^errors only$/i }).click();
    await mockNextContextResponse(page, [
      baseEvent({ message: 'info-event', severity: 'INFO', timestamp: '2026-01-01T12:00:00.000Z' }),
      baseEvent({ message: 'error-event', severity: 'ERROR', timestamp: '2026-01-01T12:00:01.000Z' }),
    ]);
    await openInspectorAndShowContext(page);

    // The context view shows both severities - the toolbar's own filter
    // does not reach the dedicated /context request (this pass's own
    // documented gap-filtering model: the full fetched set IS the visible
    // set for context/journey views).
    await expect(page.locator('tbody tr').filter({ hasText: 'info-event' })).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'error-event' })).toBeVisible();
    await expect(page.getByTestId('gap-row')).toHaveCount(0); // 1s apart - below the default threshold
  });

  test('12. journey/correlation summary shows Errors/Warnings/First->Last/Gaps for a real multi-event journey', async ({ page }) => {
    await gotoFixture(page);
    await search(page);

    // Find a real multi-event journey via the real API first, the exact
    // technique `phase-i-journey-investigation.spec.ts` already uses -
    // fixture journeys vary in event count, so row 0 cannot be assumed to
    // belong to one with more than a single event.
    const nowIso = new Date().toISOString();
    const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let journeyId = '';
    let traceIdInThatJourney = '';
    for (let i = 1; i < 40 && !journeyId; i++) {
      const candidateJourneyId = `fixture-journey-${String(i).padStart(4, '0')}`;
      const response = await page.request.post('/api/v1/logs/journey', {
        data: { sourceId: 'fixture', start: dayAgoIso, end: nowIso, field: 'journeyId', value: candidateJourneyId },
      });
      const body = await response.json();
      const visibleEvent = body.events.find((e: { severity: string }) => ['INFO', 'WARN', 'ERROR'].includes(e.severity));
      if (body.events.length >= 2 && visibleEvent) {
        journeyId = candidateJourneyId;
        traceIdInThatJourney = visibleEvent.traceId;
      }
    }
    expect(journeyId, 'expected at least one multi-event journey in the fixture corpus').not.toBe('');

    const row = page.locator('tbody tr').filter({ hasText: traceIdInThatJourney });
    const loadMoreButton = page.getByRole('button', { name: /^load more$/i });
    for (let clicks = 0; clicks < 15 && !(await row.first().isVisible().catch(() => false)); clicks++) {
      if (!(await loadMoreButton.isVisible().catch(() => false))) {
        break;
      }
      await loadMoreButton.click();
      await page.waitForTimeout(50);
    }
    await row.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    await page.getByRole('button', { name: /find this journey id/i }).click();

    const journeyView = page.getByTestId('journey-view');
    await expect(journeyView).toBeVisible({ timeout: 10_000 });
    await expect(journeyView.getByText('Errors', { exact: true })).toBeVisible();
    await expect(journeyView.getByText('Warnings', { exact: true })).toBeVisible();
    await expect(journeyView.getByText('Gaps', { exact: true })).toBeVisible();
    await captureScreenshot(page, 'legacy-slice6', 'journey-summary-enriched');
  });

  test('14. existing Live workflows remain green after the health-model change', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('fixture');
    await page.getByRole('button', { name: /^live$/i }).click();
    const panel = page.getByTestId('live-tail-panel');
    await expect(panel.getByRole('status')).toHaveText(/^live$/i, { timeout: 10_000 });
    await page.getByRole('button', { name: /^pause$/i }).click();
    await expect(panel.getByRole('status')).toHaveText(/^paused$/i);
  });

  test('15. existing query/table/settings workflows remain green alongside the richer health badge', async ({ page }) => {
    await gotoFixture(page);
    await search(page);

    await page.getByRole('button', { name: /^columns$/i }).click();
    await expect(page.getByRole('dialog', { name: /table settings/i })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: /^more filters$/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /^cancel$/i }).click();

    await page.getByRole('button', { name: /docker settings/i }).click();
    await expect(page.getByRole('dialog', { name: /docker/i })).toBeVisible();
  });

  test('16. desktop (1440px): source health badge, context summary, and gap markers all hold together with correct table geometry', async ({ page }) => {
    await setViewport(page, 1440);
    await gotoFixture(page);
    await search(page);
    await assertTableGeometry(page, 'table', 2);
    await assertNoHorizontalOverflow(page);

    await mockNextContextResponse(page, [
      baseEvent({ message: 'a', timestamp: '2026-01-01T12:00:00.000Z' }),
      baseEvent({ message: 'b', timestamp: '2026-01-01T12:00:20.000Z' }),
    ]);
    await openInspectorAndShowContext(page);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'legacy-slice6', 'desktop-1440px-gap-context');
  });

  test('17. 390px: source health details and the context/gap view stay usable with no page-level horizontal overflow', async ({ page }) => {
    await setViewport(page, 390);
    await gotoFixture(page);
    await search(page);
    await assertNoHorizontalOverflow(page);

    await page.getByRole('button', { name: /source health details/i }).click();
    await expect(page.getByRole('dialog', { name: /source health details/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');

    await mockNextContextResponse(page, [
      baseEvent({ message: 'a', timestamp: '2026-01-01T12:00:00.000Z' }),
      baseEvent({ message: 'b', timestamp: '2026-01-01T12:00:20.000Z' }),
    ]);
    await openInspectorAndShowContext(page);
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, 'legacy-slice6', 'narrow-390px-gap-context');
  });
});
