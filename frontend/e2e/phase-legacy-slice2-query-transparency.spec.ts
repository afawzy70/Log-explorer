import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { captureScreenshot } from './helpers';

/*
 * Legacy Remediation Slice 2 — QUERY TRANSPARENCY & ADVANCED QUERY
 * AUTHORING. Browser checks required by the owner-approved plan
 * (docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md §"Slice 2"), against
 * deterministic Fixture/mock sources:
 *
 *   1. Build `service = X AND level = ERROR`, execute, verify results.
 *   2. Nested query `service = X AND (level = ERROR OR level = WARN)`.
 *   3. Combine guided/text query with existing structured filters.
 *   4. Open Query editor after results exist: results stay visible.
 *   5. Edit then Cancel: committed search/query unchanged.
 *   6. Apply: only then does the committed query change (no auto-search).
 *   7. Query syntax error: useful error, no execution.
 *   8. Query-plan disclosure: pushed vs post-filter values.
 *   9. Sensitive field: exact lookup accepted, unsafe contains rejected without leaking the value.
 *  10. Docker source: Raw LogQL absent — substituted with the real Fixture
 *      source here (also `rawLogQL=false`, and reachable in this dev-profile
 *      environment; Docker's own identical false capability is already
 *      unit-tested — DockerLogSourceTest#capabilitiesReportLiveTailTrueNow...
 *      asserts `caps.rawLogQL()).isFalse()` — Docker itself is not
 *      reachable in this environment, matching the CI E2E job's own
 *      Fixture-only posture).
 *  11. Mock/capability-enabled Loki: Raw LogQL control appears and executes
 *      through the real API contract — via Playwright network mocking of
 *      /api/v1/sources and /api/v1/logs/search (the app's real fetch/client
 *      code path is exercised end-to-end; only the server is a double).
 *  12. Existing responsive/a11y/table geometry tests remain green — proven
 *      by running the full Playwright suite alongside this file, not
 *      duplicated here.
 *
 * Items 1-10 require the real backend running (`SPRING_PROFILES_ACTIVE=dev`,
 * Fixture source) and the frontend dev server, matching every other live
 * verification in this project (see phase-legacy-slice1-pagination.spec.ts).
 * Item 11 needs no backend at all — it is fully network-mocked.
 */

async function gotoFixture(page: Page) {
  await page.goto('/');
  await page.selectOption('select', 'fixture');
  await page.getByRole('button', { name: /^all$/i }).click(); // severity: All
}

async function openQuery(page: Page) {
  await page.getByRole('button', { name: /^query/i }).click();
  await expect(page.getByRole('dialog', { name: /^query$/i })).toBeVisible();
}

async function search(page: Page) {
  await page.getByRole('button', { name: /^search$/i }).click();
}

/** Every visible row's Level (col 1) / Service (col 2) cell, 0-indexed columns per CLAUDE.md's fixed 7-column order. */
async function rowServiceLevelPairs(page: Page): Promise<Array<{ service: string; level: string }>> {
  return page.locator('tbody tr').evaluateAll((rows) =>
    rows.map((r) => {
      const cells = r.querySelectorAll('td');
      return { level: (cells[1]?.textContent ?? '').trim(), service: (cells[2]?.textContent ?? '').trim() };
    }),
  );
}

test.describe('Legacy Remediation Slice 2 — query transparency & advanced query authoring', () => {
  test('1. guided AND query (service = X AND level = ERROR) executes and every row satisfies both conditions', async ({ page }) => {
    await gotoFixture(page);
    await openQuery(page);

    await page.getByRole('button', { name: /\+ condition/i }).click();
    await page.getByLabel('Field').selectOption('service');
    await page.getByLabel('Value').fill('payments-api');

    await page.getByRole('button', { name: /\+ condition/i }).click();
    const fields = page.getByLabel('Field');
    const values = page.getByLabel('Value');
    await fields.nth(1).selectOption('level');
    await values.nth(1).fill('ERROR');

    await expect(page.getByText('service = "payments-api" AND level = "ERROR"')).toBeVisible();
    await captureScreenshot(page, 'legacy-slice2', 'guided-query-and-before-apply');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await search(page);

    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const rows = await rowServiceLevelPairs(page);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.service).toBe('payments-api');
      expect(row.level).toBe('ERROR');
    }
    await captureScreenshot(page, 'legacy-slice2', 'guided-query-and-results');
  });

  test('2. nested guided query service = X AND (level = ERROR OR level = WARN) executes and every row satisfies it', async ({ page }) => {
    await gotoFixture(page);
    await openQuery(page);

    await page.getByRole('button', { name: /\+ condition/i }).click();
    await page.getByLabel('Field').first().selectOption('service');
    await page.getByLabel('Value').first().fill('payments-api');

    await page.getByRole('button', { name: /\+ group/i }).click();
    // The nested group's own fieldset (with its own trailing "+ Condition")
    // renders as a child of the root's children list, before the root's
    // own trailing actions row - so the nested group's button is first in
    // DOM order.
    const addCondition = () => page.getByRole('button', { name: /\+ condition/i }).first();
    await addCondition().click();
    await addCondition().click();

    const fields = page.getByLabel('Field');
    const values = page.getByLabel('Value');
    await fields.nth(1).selectOption('level');
    await values.nth(1).fill('ERROR');
    await fields.nth(2).selectOption('level');
    await values.nth(2).fill('WARN');

    await expect(page.getByText('service = "payments-api" AND (level = "ERROR" OR level = "WARN")')).toBeVisible();
    await page.getByRole('button', { name: /^apply$/i }).click();
    await search(page);

    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const rows = await rowServiceLevelPairs(page);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.service).toBe('payments-api');
      expect(['ERROR', 'WARN']).toContain(row.level);
    }
  });

  test('3. a guided query composes with an existing structured filter (service multi-select)', async ({ page }) => {
    await gotoFixture(page);
    await openQuery(page);
    await page.getByRole('button', { name: /\+ condition/i }).click();
    await page.getByLabel('Field').selectOption('level');
    await page.getByLabel('Value').fill('ERROR');
    await page.getByRole('button', { name: /^apply$/i }).click();

    // Structured filter: narrow to a single service via the existing
    // service multi-select, entirely independent of the Query popover.
    await page.getByRole('button', { name: /^all services$/i }).click();
    await page.getByRole('dialog', { name: /select services/i }).getByRole('checkbox', { name: /^payments-api/ }).check();
    await page.keyboard.press('Escape');

    await search(page);
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const rows = await rowServiceLevelPairs(page);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.service).toBe('payments-api');
      expect(row.level).toBe('ERROR');
    }
  });

  test('4. opening the Query editor after results exist keeps the results visible and does not navigate away', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const urlBefore = page.url();

    await openQuery(page);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    expect(page.url()).toBe(urlBefore);
  });

  test('5. editing the query draft then Cancel leaves the committed search/query unchanged', async ({ page }) => {
    await gotoFixture(page);
    await search(page);
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const baselineRowCount = await page.locator('tbody tr').count();

    await openQuery(page);
    await page.getByRole('button', { name: /\+ condition/i }).click();
    await page.getByLabel('Field').selectOption('service');
    await page.getByLabel('Value').fill('no-such-service-xyz');
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    await search(page);
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => page.locator('tbody tr').count()).toBe(baselineRowCount);
  });

  test('6. Apply commits the query but does not itself run a search; only Search executes it', async ({ page }) => {
    await gotoFixture(page);
    await expect(page.getByRole('table')).not.toBeVisible();

    await openQuery(page);
    await page.getByRole('button', { name: /\+ condition/i }).click();
    await page.getByLabel('Field').selectOption('service');
    await page.getByLabel('Value').fill('gateway');
    await page.getByRole('button', { name: /^apply$/i }).click();

    // Apply alone must not have fired a request or rendered a table.
    await expect(page.getByRole('table')).not.toBeVisible();

    await search(page);
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    const rows = await rowServiceLevelPairs(page);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.service).toBe('gateway');
    }
  });

  test('7. an invalid query shows a useful error and never renders results', async ({ page }) => {
    await gotoFixture(page);
    await openQuery(page);
    await page.getByRole('tab', { name: /^text$/i }).click();
    await page.getByLabel('Query text').fill('bogusField = "x"');
    await page.getByRole('button', { name: /^apply$/i }).click();

    await search(page);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText(/unknown field/i);
    await expect(page.getByRole('table')).not.toBeVisible();
  });

  test('9. a sensitive-field exact lookup is accepted; an unsafe "contains" is rejected without leaking the supplied value', async ({ page }) => {
    await gotoFixture(page);

    // Exact match, deterministic fixture value (FixtureCorpusGenerator: cif
    // = "FAKE-CIF-" + pad(1000 + (i % 900), 4), i=0 -> "FAKE-CIF-1000").
    await openQuery(page);
    await page.getByRole('button', { name: /\+ condition/i }).click();
    await page.getByLabel('Field').selectOption('cif');
    await expect(page.getByLabel('Operator')).not.toContainText('contains');
    await page.getByLabel('Value').fill('FAKE-CIF-1000');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await search(page);
    await expect(page.getByRole('table').or(page.getByText(/no results/i))).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('alert')).not.toBeVisible();

    // Unsafe operator: typed directly as text (the guided builder cannot
    // even select "contains" for cif - proven above), with a sentinel
    // value that must never appear anywhere on the page if rejected.
    const sentinel = 'LEAK-SENTINEL-cif-e2e-91a2';
    await openQuery(page);
    await page.getByRole('tab', { name: /^text$/i }).click();
    await page.getByLabel('Query text').fill(`cif contains "${sentinel}"`);
    await page.getByRole('button', { name: /^apply$/i }).click();
    await search(page);

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText(/not allowed/i);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain(sentinel);
  });

  test('10. the Fixture source (rawLogQL=false, same as Docker) never offers a Raw LogQL mode', async ({ page }) => {
    await gotoFixture(page);
    await openQuery(page);
    await expect(page.getByRole('tab', { name: /raw logql/i })).toHaveCount(0);
  });

  test('8 + 11. a capability-enabled (mocked) Loki-like source shows Raw LogQL, off by default, and executes through the real API contract with honest push-down disclosure', async ({ page }) => {
    const mockCapabilities = {
      historicalSearch: true,
      liveTail: false,
      rawLogQL: true,
      serviceDiscovery: false,
      queryStatistics: false,
      contextView: false,
    };

    await page.route('**/api/v1/sources', (route) =>
      route.fulfill({
        json: [{ id: 'mock-loki', displayName: 'Mock Loki', capabilities: mockCapabilities }],
      }),
    );
    await page.route('**/api/v1/sources/mock-loki/health', (route) =>
      route.fulfill({ json: { status: 'UP', message: null, checkedAt: new Date().toISOString() } }),
    );

    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/api/v1/logs/search', (route) => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      route.fulfill({
        json: {
          events: [
            {
              timestamp: '2026-01-01T00:00:00Z', timestampRaw: null, schemaVersion: null, service: 'gateway',
              serviceSourceHint: null, severity: 'INFO', severityNumber: null, message: 'mocked raw logql result',
              logger: null, thread: null, exception: null, traceId: null, spanId: null, journeyId: null, eventId: null,
              businessStep: null, uiIdentifier: null, errorCode: null, correlationId: null,
              protectedFields: { cif: null, userName: null, customerId: null, deviceId: null, deviceIp: null },
              devicePlatformType: null, language: null, serverIp: null, serverHost: null, unknownTopLevelFields: {},
              unknownMdcFields: {}, malformed: false, rawLine: null, sourceId: null, composeProject: null,
              containerId: null, containerName: null, stream: null, namespace: null, pod: null,
            },
          ],
          counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false },
          nextCursor: null,
          queryPlan: {
            resolvedQuery: '(raw LogQL query — content not displayed)',
            rawLogQlMode: true,
            pushedDownConditions: ['Raw LogQL executed verbatim against Loki (bypasses the generated selector entirely)'],
            postFilterConditions: [],
            notes: ['Raw LogQL mode: the query text is sent to the source as-is and never translated into the structured DSL.'],
          },
        },
      });
    });

    await page.goto('/');
    await page.selectOption('select', 'mock-loki');

    await openQuery(page);
    const rawTab = page.getByRole('tab', { name: /raw logql/i });
    await expect(rawTab).toBeVisible(); // appears only because capabilities.rawLogQL is true
    await expect(rawTab).toHaveAttribute('aria-selected', 'false'); // off by default
    await rawTab.click();
    await expect(page.getByText(/advanced.*bypassing the generated query.*off by default/i)).toBeVisible();

    await page.getByLabel('Raw LogQL').fill('{namespace="prod",app="gateway"}');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await search(page);

    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('mocked raw logql result')).toBeVisible();

    // Executed through the real client code / API contract: the actual
    // POST body carried rawLogQl, not a translated DSL query.
    expect(capturedBody).not.toBeNull();
    expect((capturedBody as unknown as Record<string, unknown>).rawLogQl).toBe('{namespace="prod",app="gateway"}');
    expect((capturedBody as unknown as Record<string, unknown>).query).toBeUndefined();

    // Query-plan disclosure: honest, non-fabricated push-down vs post-filter.
    await page.getByText('Query details').first().click();
    await expect(page.getByText('Raw LogQL', { exact: true })).toBeVisible();
    await expect(page.getByText('Raw LogQL executed verbatim against Loki (bypasses the generated selector entirely)')).toBeVisible();
    await expect(page.getByText(/none.*no structured filters or query conditions are active/i)).toBeVisible();
    await captureScreenshot(page, 'legacy-slice2', 'raw-logql-query-plan-disclosure');
  });
});
