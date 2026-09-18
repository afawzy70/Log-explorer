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
  projectCount: 1,
  projects: ['payments-dev'],
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
  await page.route('**/api/v1/sources/openshift/health', (route) =>
    jsonRoute(route, { status: 'UP', message: null, checkedAt: new Date().toISOString(), warnings: [] }),
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
