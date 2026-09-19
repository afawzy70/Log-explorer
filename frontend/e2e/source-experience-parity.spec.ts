import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { assertNoHorizontalOverflow } from './helpers';

/*
 * SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - the owner requirement (register §28) that OpenShift, once
 * connected, uses the exact same primary Search workspace, Search button, Results table, and Inspector as
 * Docker - never a second, OpenShift-specific pipeline. MOCKED EVIDENCE, same convention as
 * os-1f-openshift-professional-ux.spec.ts: this repository has no real OpenShift credentials
 * (REAL_OPENSHIFT_VALIDATION=NOT_AVAILABLE), so the OpenShift-specific HTTP responses are intercepted via
 * `page.route` against the real running app/backend - never against a real cluster.
 */

const CONNECTED_SUMMARY = {
  state: 'CONNECTED',
  connectionName: 'Production',
  server: 'api.example.com:6443',
  username: 'developer',
  projectCount: 2,
  projects: ['payments-dev', 'accounts-dev'],
  selectedProject: null as string | null,
  tlsVerified: true,
  usingPrivateCa: false,
  proxy: null,
  projectApi: 'PROJECTS',
};

const WORKLOAD_DISCOVERY = {
  status: 'SUCCESS',
  workloads: [{ kind: 'DEPLOYMENT', name: 'payment-api', desiredReplicas: 2, readyReplicas: 2 }],
  kindOutcomes: [{ kind: 'DEPLOYMENT', status: 'AVAILABLE' }],
};

const EMPTY_PODS = { status: 'COMPLETE', pods: [] };

const OPENSHIFT_EVENT = {
  timestamp: '2026-01-01T00:00:00Z',
  timestampRaw: null,
  schemaVersion: null,
  service: 'payment-api',
  serviceSourceHint: null,
  severity: 'ERROR',
  severityNumber: null,
  message: 'Payment authorization failed: ledger reservation timed out',
  logger: null,
  thread: null,
  exception: null,
  traceId: 'trace-abc123',
  spanId: null,
  journeyId: null,
  eventId: null,
  businessStep: null,
  uiIdentifier: null,
  errorCode: null,
  correlationId: null,
  protectedFields: { cif: null, userName: null, customerId: null, deviceId: null, deviceIp: null },
  devicePlatformType: null,
  language: null,
  serverIp: null,
  serverHost: null,
  unknownTopLevelFields: {},
  unknownMdcFields: {},
  malformed: false,
  rawLine: null,
  sourceId: null,
  composeProject: null,
  composeService: null,
  containerId: null,
  containerName: null,
  stream: null,
  namespace: 'payments-dev',
  pod: 'payment-api-abc123',
  contextTargetProof: 'mock-opaque-proof-token',
  tags: [],
  classifications: [],
};

function jsonRoute(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

let scope = {
  selectedProject: null as string | null,
  discoveryApi: null as string | null,
  selectedWorkloadKind: null as string | null,
  selectedWorkloadName: null as string | null,
  selectedPod: null as string | null,
  selectedContainer: null as string | null,
};

async function mockConnectedOpenShift(page: Page) {
  scope = {
    selectedProject: null,
    discoveryApi: null,
    selectedWorkloadKind: null,
    selectedWorkloadName: null,
    selectedPod: null,
    selectedContainer: null,
  };
  await page.route('**/api/v1/sources', (route) =>
    jsonRoute(route, [
      {
        id: 'fixture',
        displayName: 'Fixture (dev/test only)',
        capabilities: {
          historicalSearch: true,
          liveTail: true,
          rawLogQL: false,
          serviceDiscovery: true,
          queryStatistics: false,
          contextView: true,
          composeProjectScoping: false,
          originalSchemaSampling: true,
        },
      },
      {
        id: 'openshift',
        displayName: 'OpenShift',
        capabilities: {
          historicalSearch: true,
          liveTail: true,
          rawLogQL: false,
          serviceDiscovery: false,
          queryStatistics: false,
          contextView: true,
          composeProjectScoping: false,
          originalSchemaSampling: true,
        },
      },
    ]),
  );
  await page.route('**/api/v1/sources/fixture/health', (route) =>
    jsonRoute(route, { status: 'UP', message: null, checkedAt: new Date().toISOString(), warnings: [] }),
  );
  await page.route('**/api/v1/sources/fixture/services', (route) => jsonRoute(route, []));
  // SOURCE_EXPERIENCE_PARITY_TARGETED_RECOVERY_1 - mirrors OpenShiftLogSource#health() exactly: DEGRADED with
  // a "select a project" warning while connected but unscoped, UP once a project is selected - so a real
  // Project change can be shown to reconcile the health badge without any separate polling mechanism.
  await page.route('**/api/v1/sources/openshift/health', (route) =>
    jsonRoute(
      route,
      scope.selectedProject
        ? {
            status: 'UP',
            message: `Connected to api.example.com:6443 (${scope.selectedProject})`,
            checkedAt: new Date().toISOString(),
            warnings: [],
          }
        : {
            status: 'DEGRADED',
            message: 'Connected to api.example.com:6443, but no project/namespace is selected',
            checkedAt: new Date().toISOString(),
            warnings: ['Select a project/namespace in Search to search'],
          },
    ),
  );
  await page.route('**/api/v1/settings/field-mapping**', (route) =>
    jsonRoute(route, { sourceId: 'openshift', scopeLabel: null, fields: [], modifiedFromDefault: false, searchReady: true }),
  );
  await page.route('**/api/v1/sources/openshift/connection/intake-allowed', (route) => jsonRoute(route, true));
  await page.route('**/api/v1/sources/openshift/connection', (route) =>
    jsonRoute(route, { ...CONNECTED_SUMMARY, selectedProject: scope.selectedProject }),
  );
  await page.route('**/api/v1/sources/openshift/scope', (route) => jsonRoute(route, scope));
  await page.route('**/api/v1/sources/openshift/project', (route) => {
    const body = route.request().postDataJSON() as { project: string | null };
    scope = { ...scope, selectedProject: body.project, discoveryApi: body.project ? 'PROJECTS' : null };
    return jsonRoute(route, { ...CONNECTED_SUMMARY, selectedProject: scope.selectedProject });
  });
  await page.route('**/api/v1/sources/openshift/workloads', (route) => jsonRoute(route, WORKLOAD_DISCOVERY));
  await page.route('**/api/v1/sources/openshift/workload', (route) => {
    const body = route.request().postDataJSON() as { kind: string | null; name: string | null };
    scope = { ...scope, selectedWorkloadKind: body.kind, selectedWorkloadName: body.name };
    return jsonRoute(route, scope);
  });
  await page.route('**/api/v1/sources/openshift/pods', (route) => jsonRoute(route, EMPTY_PODS));
}

test.describe('SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - one primary Search pipeline', () => {
  test('an OpenShift search result renders in the same ResultsTable and opens the same Inspector as any other source', async ({
    page,
  }) => {
    await mockConnectedOpenShift(page);
    let searchBody: Record<string, unknown> | null = null;
    await page.route('**/api/v1/logs/search', (route) => {
      searchBody = JSON.parse(route.request().postData() ?? '{}');
      jsonRoute(route, {
        events: [OPENSHIFT_EVENT],
        counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null,
        queryPlan: null,
      });
    });

    await page.goto('/');
    await page.getByRole('combobox', { name: /^source$/i }).selectOption('openshift');
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');
    await page.getByRole('combobox', { name: /^workload$/i }).selectOption({ label: 'payment-api (Deployment)' });

    // The exact same Search button/path Docker/Fixture already use - no OpenShift-specific trigger.
    const searchButton = page.getByRole('button', { name: /^search$/i });
    await expect(searchButton).toBeEnabled();
    await searchButton.click();

    // The request never carries OpenShift-specific scope fields - the backend reads its own committed
    // session scope, exactly as the SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT contract discovery found.
    await expect.poll(() => searchBody).not.toBeNull();
    expect(searchBody).not.toHaveProperty('workload');
    expect(searchBody).not.toHaveProperty('pod');
    expect((searchBody as Record<string, unknown>)?.sourceId).toBe('openshift');

    // The SAME results table every other source's search renders into.
    const row = page.locator('tbody tr').filter({ hasText: 'Payment authorization failed' });
    await expect(row).toBeVisible();

    // The SAME row-actions path into the SAME Inspector.
    await row.getByRole('button', { name: /actions for this event/i }).click();
    await page.getByRole('menuitem', { name: /view details/i }).click();
    const dialog = page.getByRole('dialog', { name: /event details/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Payment authorization failed');
    await expect(dialog.getByRole('tab', { name: /^overview$/i })).toBeVisible();
  });

  test('switching Docker -> OpenShift -> Docker leaves no scope leakage in either direction', async ({ page }) => {
    await mockConnectedOpenShift(page);
    await page.goto('/');

    // sourcePolicy.ts orders OpenShift ahead of the dev-only Fixture source for auto-selection, so this test
    // starts on Fixture explicitly rather than depending on which one loads first.
    const source = page.getByRole('combobox', { name: /^source$/i });
    await source.selectOption('fixture');
    // Docker/Fixture's own Service selector is present before ever touching OpenShift.
    await expect(page.getByRole('button', { name: /all services/i })).toBeVisible();

    await source.selectOption('openshift');
    // OpenShift's scope control replaces it - Docker's Service selector never lingers alongside it.
    await expect(page.getByRole('combobox', { name: /^project$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /all services/i })).not.toBeVisible();

    await source.selectOption('fixture');
    // Back to a Docker-shaped source: the Service selector returns, and no OpenShift scope control survives.
    await expect(page.getByRole('button', { name: /all services/i })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^project$/i })).toHaveCount(0);
    await expect(page.getByText(/openshift is not connected/i)).toHaveCount(0);
  });

  test('no page-level horizontal overflow with the OpenShift scope controls populated, at 390px', async ({ page }) => {
    await mockConnectedOpenShift(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('combobox', { name: /^source$/i }).selectOption('openshift');
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');
    await page.getByRole('combobox', { name: /^workload$/i }).selectOption({ label: 'payment-api (Deployment)' });

    await assertNoHorizontalOverflow(page);
  });
});

test.describe('SOURCE_EXPERIENCE_PARITY_TARGETED_RECOVERY_1 - scope-change invalidation and health reconciliation', () => {
  test('changing Project A -> Project B invalidates Project A\'s results immediately, and never auto-fires a new Search', async ({
    page,
  }) => {
    await mockConnectedOpenShift(page);
    let searchCallCount = 0;
    await page.route('**/api/v1/logs/search', (route) => {
      searchCallCount += 1;
      jsonRoute(route, {
        events: [OPENSHIFT_EVENT],
        counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null,
        queryPlan: null,
      });
    });

    await page.goto('/');
    await page.getByRole('combobox', { name: /^source$/i }).selectOption('openshift');
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');
    await page.getByRole('button', { name: /^search$/i }).click();

    const row = page.locator('tbody tr').filter({ hasText: 'Payment authorization failed' });
    await expect(row).toBeVisible();
    expect(searchCallCount).toBe(1);

    // Project A -> Project B: Project A's row must disappear immediately, without the investigator clicking
    // Search again, and no automatic Search must fire on their behalf.
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('accounts-dev');
    await expect(row).toHaveCount(0);
    await expect(page.getByText(/run a search to see results/i)).toBeVisible();

    await page.waitForTimeout(300); // give a wrongly-auto-fired search time to appear, if one exists
    expect(searchCallCount).toBe(1);
  });

  test('changing Workload A -> Workload B invalidates the old results the same way', async ({ page }) => {
    await mockConnectedOpenShift(page);
    let searchCallCount = 0;
    await page.route('**/api/v1/logs/search', (route) => {
      searchCallCount += 1;
      jsonRoute(route, {
        events: [OPENSHIFT_EVENT],
        counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null,
        queryPlan: null,
      });
    });
    // A second workload so the select has something to change to.
    await page.route('**/api/v1/sources/openshift/workloads', (route) =>
      jsonRoute(route, {
        status: 'SUCCESS',
        workloads: [
          { kind: 'DEPLOYMENT', name: 'payment-api', desiredReplicas: 2, readyReplicas: 2 },
          { kind: 'STATEFUL_SET', name: 'payment-ledger', desiredReplicas: 1, readyReplicas: 1 },
        ],
        kindOutcomes: [{ kind: 'DEPLOYMENT', status: 'AVAILABLE' }, { kind: 'STATEFUL_SET', status: 'AVAILABLE' }],
      }),
    );

    await page.goto('/');
    await page.getByRole('combobox', { name: /^source$/i }).selectOption('openshift');
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');
    await page.getByRole('combobox', { name: /^workload$/i }).selectOption({ label: 'payment-api (Deployment)' });
    await page.getByRole('button', { name: /^search$/i }).click();

    const row = page.locator('tbody tr').filter({ hasText: 'Payment authorization failed' });
    await expect(row).toBeVisible();
    expect(searchCallCount).toBe(1);

    await page.getByRole('combobox', { name: /^workload$/i }).selectOption({ label: 'payment-ledger (StatefulSet)' });
    await expect(row).toHaveCount(0);

    await page.waitForTimeout(300);
    expect(searchCallCount).toBe(1);
  });

  test('a stale in-flight Search from the old scope cannot land after the scope changes', async ({ page }) => {
    await mockConnectedOpenShift(page);
    let releaseFirstSearch: (() => void) | null = null;
    let searchCallCount = 0;
    await page.route('**/api/v1/logs/search', async (route) => {
      searchCallCount += 1;
      if (searchCallCount === 1) {
        await new Promise<void>((resolve) => { releaseFirstSearch = resolve; });
      }
      jsonRoute(route, {
        events: [OPENSHIFT_EVENT],
        counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null,
        queryPlan: null,
      });
    });

    await page.goto('/');
    await page.getByRole('combobox', { name: /^source$/i }).selectOption('openshift');
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');
    await page.getByRole('button', { name: /^search$/i }).click();
    await expect.poll(() => searchCallCount).toBe(1); // in flight, held open by releaseFirstSearch

    // Change scope while that request is still in flight, then let its (stale) response land.
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('accounts-dev');
    releaseFirstSearch?.();

    // The stale response must never populate the table under the new scope.
    await page.waitForTimeout(300);
    await expect(page.locator('tbody tr').filter({ hasText: 'Payment authorization failed' })).toHaveCount(0);
  });

  test('OpenShift health guidance names Search, not Settings, and reconciles from Degraded to Healthy after a Project is selected - without polling', async ({
    page,
  }) => {
    await mockConnectedOpenShift(page);
    await page.goto('/');
    await page.getByRole('combobox', { name: /^source$/i }).selectOption('openshift');

    const badge = page.getByRole('status').filter({ hasText: /degraded/i });
    await expect(badge).toBeVisible();
    await badge.getByRole('button', { name: /source health details/i }).click();
    const dialog = page.getByRole('dialog', { name: /source health details/i });
    await expect(dialog).toContainText('Select a project/namespace in Search to search');
    await expect(dialog).not.toContainText('Settings');
    await page.keyboard.press('Escape');

    // A second, more specific route registered on top of `mockConnectedOpenShift`'s own dynamic health route
    // (Playwright runs the most-recently-registered matching handler first) - it must still `jsonRoute` the
    // same scope-aware response itself, never `route.continue()` (which would bypass the mock and hit the
    // real, actually-disconnected dev backend instead).
    let healthCallCount = 0;
    await page.route('**/api/v1/sources/openshift/health', (route) => {
      healthCallCount += 1;
      jsonRoute(
        route,
        scope.selectedProject
          ? { status: 'UP', message: `Connected to api.example.com:6443 (${scope.selectedProject})`, checkedAt: new Date().toISOString(), warnings: [] }
          : { status: 'DEGRADED', message: 'Connected to api.example.com:6443, but no project/namespace is selected', checkedAt: new Date().toISOString(), warnings: ['Select a project/namespace in Search to search'] },
      );
    });

    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');

    await expect(page.getByRole('status').filter({ hasText: /healthy/i })).toBeVisible();
    // Exactly one explicit health re-check for this one Project mutation - never a polling loop.
    expect(healthCallCount).toBe(1);
  });

  test('a Workload change does not trigger an extra health request (only Project affects OpenShiftLogSource#health())', async ({
    page,
  }) => {
    await mockConnectedOpenShift(page);
    await page.goto('/');
    await page.getByRole('combobox', { name: /^source$/i }).selectOption('openshift');
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');
    await expect(page.getByRole('status').filter({ hasText: /healthy/i })).toBeVisible();

    let healthCallCount = 0;
    await page.route('**/api/v1/sources/openshift/health', (route) => {
      healthCallCount += 1;
      jsonRoute(route, { status: 'UP', message: `Connected to api.example.com:6443 (${scope.selectedProject})`, checkedAt: new Date().toISOString(), warnings: [] });
    });

    await page.getByRole('combobox', { name: /^workload$/i }).selectOption({ label: 'payment-api (Deployment)' });
    await page.waitForTimeout(300);
    expect(healthCallCount).toBe(0);
  });
});
