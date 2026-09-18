import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { assertNoHorizontalOverflow, captureScreenshot, setViewport } from './helpers';
import { openSettingsSection } from './settings-helpers';

/*
 * OS-1F - the OpenShift professional UX integration slice (LERUX-1
 * audit -> targeted implementation -> real rendered-browser evidence).
 *
 * MOCKED EVIDENCE, LABELLED HONESTLY (mission §14/§15): this repository
 * has never had real OpenShift credentials (`REAL_OPENSHIFT_1A..1F =
 * BLOCKED_CREDENTIALS`, consistent across every OS-1x slice). Every
 * "connected"/"scoped" screenshot and assertion in this file drives the
 * REAL rendered app against a REAL running backend, but with the
 * OpenShift-specific HTTP responses intercepted via `page.route` to
 * simulate a connected session and a discovered project/workload/pod/
 * container scope - never against a real cluster. This is NOT
 * `REAL_OPENSHIFT_1F` evidence; it is deterministic, mocked UI evidence,
 * exactly as mission §15 explicitly sanctions when real credentials are
 * blocked. The disconnected-state form itself (Connect, paste command,
 * validation, token-never-persisted) IS already covered against the real
 * backend by `os-1a-openshift-connection.spec.ts` (`docs/verification/OS_1A_EVIDENCE/`)
 * and is not re-captured here.
 */

const PHASE = 'OS_1F_EVIDENCE';

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
  workloads: [
    { kind: 'DEPLOYMENT', name: 'payment-api', desiredReplicas: 2, readyReplicas: 2 },
    { kind: 'STATEFUL_SET', name: 'payment-ledger', desiredReplicas: 1, readyReplicas: 1 },
  ],
  kindOutcomes: [
    { kind: 'DEPLOYMENT', status: 'AVAILABLE' },
    { kind: 'DEPLOYMENT_CONFIG', status: 'UNAVAILABLE_RESOURCE_TYPE' },
    { kind: 'STATEFUL_SET', status: 'AVAILABLE' },
    { kind: 'DAEMON_SET', status: 'AVAILABLE' },
  ],
};

const PODS = {
  status: 'COMPLETE',
  pods: [
    {
      name: 'payment-api-abc123',
      phase: 'Running',
      readySummary: '1/1',
      restartCount: 0,
      containerNames: ['app', 'istio-proxy'],
      workloadKind: 'DEPLOYMENT',
      workloadName: 'payment-api',
    },
  ],
};

const CONTAINERS = ['app', 'istio-proxy'];

let scope = {
  selectedProject: null as string | null,
  discoveryApi: null as string | null,
  selectedWorkloadKind: null as string | null,
  selectedWorkloadName: null as string | null,
  selectedPod: null as string | null,
  selectedContainer: null as string | null,
};

function jsonRoute(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Wires every OpenShift endpoint this flow touches to an in-memory mock session - never the real cluster. */
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
        },
      },
    ]),
  );
  await page.route('**/api/v1/sources/openshift/health', (route) =>
    jsonRoute(route, { status: 'UP', message: null, checkedAt: new Date().toISOString(), warnings: [] }),
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
  await page.route('**/api/v1/sources/openshift/pods', (route) => jsonRoute(route, PODS));
  await page.route('**/api/v1/sources/openshift/pod', (route) => {
    const body = route.request().postDataJSON() as { pod: string | null };
    scope = { ...scope, selectedPod: body.pod };
    return jsonRoute(route, scope);
  });
  await page.route('**/api/v1/sources/openshift/containers', (route) => jsonRoute(route, CONTAINERS));
  await page.route('**/api/v1/sources/openshift/container', (route) => {
    const body = route.request().postDataJSON() as { container: string | null };
    scope = { ...scope, selectedContainer: body.container };
    return jsonRoute(route, scope);
  });
}

async function openPanel(page: Page) {
  await page.goto('/');
  await openSettingsSection(page, 'OpenShift');
  await expect(page.getByTestId('openshift-settings-panel')).toBeVisible();
}

/** SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - scope is now selected from Search, not Settings. */
async function openSearchAsOpenShift(page: Page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: /^source$/i }).selectOption('openshift');
}

test.describe('OS-1F - OpenShift connected Settings, scope hierarchy and ScopeTrail (MOCKED, not a real cluster)', () => {
  test('B: connected Settings shows Server/User/TLS, a read-only current scope, and never a token', async ({
    page,
  }) => {
    await setViewport(page, 1440, 900);
    await mockConnectedOpenShift(page);
    await openPanel(page);

    await expect(page.getByText(/^connected$/i)).toBeVisible();
    await expect(page.getByText('api.example.com:6443')).toBeVisible();
    await expect(page.getByText('developer')).toBeVisible();
    await expect(page.getByText(/^verified/i)).toBeVisible();
    // SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - read-only, not a select: Project/Workload/Pod/Container are
    // now chosen from Search (`OpenShiftScopeSelect.tsx`), never here.
    await expect(page.getByText('None selected')).toBeVisible();
    await expect(page.getByText(/selected from search, not here/i)).toBeVisible();
    await expect(page.getByLabel(/^project$/i)).toHaveCount(0);
    // The one truth this whole panel exists to never leak, even mocked.
    await expect(page.locator('body')).not.toContainText('sha256~');
    await captureScreenshot(page, PHASE, 'B-connected-settings');
  });

  test('D/E/F: selecting Project -> Workload -> Pod -> Container from Search narrows scope one level at a time', async ({
    page,
  }) => {
    await setViewport(page, 1440, 900);
    await mockConnectedOpenShift(page);
    await openSearchAsOpenShift(page);

    await expect(page.getByRole('combobox', { name: /^project$/i })).toBeVisible();
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');
    await expect(page.getByRole('combobox', { name: /^workload$/i })).toBeVisible();
    await captureScreenshot(page, PHASE, 'D-workload-selector');

    await page.getByRole('combobox', { name: /^workload$/i }).selectOption({ label: 'payment-api (Deployment)' });
    await expect(
      page.getByRole('combobox', { name: /^pod$/i }).getByRole('option', { name: /payment-api-abc123/i }),
    ).toBeAttached();
    await captureScreenshot(page, PHASE, 'E-pod-selector');

    await page.getByRole('combobox', { name: /^pod$/i }).selectOption('payment-api-abc123');
    await expect(page.getByRole('combobox', { name: /^container$/i })).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: /^container$/i }).getByRole('option', { name: 'app', exact: true }),
    ).toBeAttached();
    await captureScreenshot(page, PHASE, 'F-container-selector');

    await page.getByRole('combobox', { name: /^container$/i }).selectOption('app');
    await expect(page.getByRole('combobox', { name: /^container$/i })).toHaveValue('app');
  });

  test('G: the header ScopeTrail reads the full effective hierarchy, truthfully, from a scope set entirely in Search', async ({
    page,
  }) => {
    await setViewport(page, 1440, 900);
    await mockConnectedOpenShift(page);
    await openSearchAsOpenShift(page);

    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');
    await page.getByRole('combobox', { name: /^workload$/i }).selectOption({ label: 'payment-api (Deployment)' });
    await page.getByRole('combobox', { name: /^pod$/i }).selectOption('payment-api-abc123');
    await page.getByRole('combobox', { name: /^container$/i }).selectOption('app');

    const trail = page.getByTestId('scope-trail');
    await expect(trail).toContainText('OpenShift');
    await expect(trail).toContainText('payments-dev');
    await expect(trail).toContainText('Deployment: payment-api');
    await expect(trail).toContainText('payment-api-abc123');
    await expect(trail).toContainText('app');
    await captureScreenshot(page, PHASE, 'G-scope-trail');

    // SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - the trail (and the scope it reflects) survives opening and
    // closing Settings, since Settings never owns this state - it only mirrors it read-only.
    await openSettingsSection(page, 'OpenShift');
    await expect(page.getByTestId('openshift-settings-panel').getByText('payments-dev')).toBeVisible();
    await page.getByRole('button', { name: /back to search results/i }).click();
    await expect(page.getByTestId('settings-workspace')).toHaveCount(0);
    await expect(trail).toContainText('payments-dev');
  });

  test('H: Search and Live are disabled with a truthful reason until a Project is selected from Search itself, then enabled', async ({
    page,
  }) => {
    await setViewport(page, 1440, 900);
    await mockConnectedOpenShift(page);
    await openSearchAsOpenShift(page);

    await expect(page.getByRole('button', { name: /^search$/i })).toBeDisabled();
    await expect(page.getByText(/select a project to search openshift/i)).toBeVisible();
    await captureScreenshot(page, PHASE, 'H-search-blocked-no-scope');

    // SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - never returns to Settings to change scope.
    await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');

    await expect(page.getByRole('button', { name: /^search$/i })).toBeEnabled();
    await expect(page.getByText(/select a project to search openshift/i)).not.toBeVisible();
    await captureScreenshot(page, PHASE, 'H-search-enabled-with-scope');
  });

  for (const width of [1024, 768, 390]) {
    test(`S: usable at ${width}px - the Search scope controls and ScopeTrail never overflow the page`, async ({
      page,
    }) => {
      await setViewport(page, width, 900);
      await mockConnectedOpenShift(page);
      await openSearchAsOpenShift(page);
      await page.getByRole('combobox', { name: /^project$/i }).selectOption('payments-dev');

      await assertNoHorizontalOverflow(page);
      await captureScreenshot(page, PHASE, `S-responsive-${width}px`);
    });
  }
});
