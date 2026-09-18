import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { OpenShiftScopeSelect } from './OpenShiftScopeSelect';
import type { OpenShiftScopeSummary } from '../../../shared/api/types';

/**
 * SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - the Search toolbar's OpenShift scope control. This ports the
 * Project/Workload/Pod/Container coverage `OpenShiftSettingsPanel.test.tsx` used to carry (OS-1B/OS-1F),
 * since that selection now lives here, plus new coverage for states unique to this location (not connected,
 * no projects, source-switch reset via `active` toggling off).
 */

const CONNECTED = {
  state: 'CONNECTED',
  connectionName: 'Production',
  server: 'api.example.com:6443',
  username: 'developer',
  projectCount: 2,
  projects: ['accounts', 'payments'],
  selectedProject: null,
  tlsVerified: true,
  usingPrivateCa: false,
  proxy: null,
  projectApi: 'PROJECTS',
};

const CONNECTED_WITH_PROJECT = { ...CONNECTED, selectedProject: 'payments' };

const WORKLOAD_DISCOVERY = {
  status: 'SUCCESS',
  workloads: [{ kind: 'DEPLOYMENT', name: 'payment-api', desiredReplicas: 2, readyReplicas: 2 }],
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
      name: 'payment-api-abc',
      phase: 'Running',
      readySummary: '1/1',
      restartCount: 0,
      containerNames: ['application'],
      workloadKind: null,
      workloadName: null,
    },
  ],
};

const EMPTY_PODS = { status: 'COMPLETE', pods: [] };

const NO_SCOPE: OpenShiftScopeSummary = {
  selectedProject: null,
  discoveryApi: null,
  selectedWorkloadKind: null,
  selectedWorkloadName: null,
  selectedPod: null,
  selectedContainer: null,
};

const PROJECT_SCOPE: OpenShiftScopeSummary = { ...NO_SCOPE, selectedProject: 'payments', discoveryApi: 'PROJECTS' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(handler(typeof input === 'string' ? input : input.toString(), init)),
    ),
  );
}

describe('OpenShiftScopeSelect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a not-connected hint and no Project control when OpenShift is not connected', async () => {
    stubFetch(() => jsonResponse({ ...CONNECTED, state: 'DISCONNECTED', projects: [], projectCount: 0 }));
    render(<OpenShiftScopeSelect scope={NO_SCOPE} onScopeChanged={vi.fn()} />);

    expect(await screen.findByText(/not connected — connect it in settings/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^project$/i })).not.toBeInTheDocument();
  });

  it('says so plainly when a connected account genuinely has no projects', async () => {
    stubFetch(() => jsonResponse({ ...CONNECTED, projects: [], projectCount: 0 }));
    render(<OpenShiftScopeSelect scope={NO_SCOPE} onScopeChanged={vi.fn()} />);

    expect(await screen.findByText(/has no projects/i)).toBeInTheDocument();
  });

  it('offers Project selection once connected, and calls onScopeChanged after selecting one', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/project') && init?.method === 'PUT') {
        return jsonResponse({ ...CONNECTED, selectedProject: 'payments' });
      }
      if (url.endsWith('/workloads')) return jsonResponse({ status: 'SUCCESS', workloads: [], kindOutcomes: [] });
      if (url.endsWith('/pods')) return jsonResponse(EMPTY_PODS);
      return jsonResponse(CONNECTED);
    });
    const onScopeChanged = vi.fn();
    const user = userEvent.setup();
    render(<OpenShiftScopeSelect scope={NO_SCOPE} onScopeChanged={onScopeChanged} />);

    const select = await screen.findByRole('combobox', { name: /^project$/i });
    expect(screen.getByRole('option', { name: 'payments' })).toBeInTheDocument();
    await user.selectOptions(select, 'payments');

    await waitFor(() => expect(onScopeChanged).toHaveBeenCalled());
  });

  it('discovers and lists workloads for the selected project, and does not spam the UI about an absent DeploymentConfig API', async () => {
    stubFetch((url) => {
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse(PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });
    render(<OpenShiftScopeSelect scope={PROJECT_SCOPE} onScopeChanged={vi.fn()} />);

    expect(await screen.findByRole('option', { name: 'payment-api (Deployment)' })).toBeInTheDocument();
    expect(screen.queryByText(/DeploymentConfig/i)).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /payment-api-abc/i })).toBeInTheDocument();
  });

  it('says "No workloads in this project" rather than a blank control when discovery is genuinely empty', async () => {
    stubFetch((url) => {
      if (url.endsWith('/workloads')) return jsonResponse({ status: 'SUCCESS', workloads: [], kindOutcomes: [] });
      if (url.endsWith('/pods')) return jsonResponse(EMPTY_PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });
    render(<OpenShiftScopeSelect scope={PROJECT_SCOPE} onScopeChanged={vi.fn()} />);

    expect(await screen.findByText(/no workloads in this project/i)).toBeInTheDocument();
  });

  it('reports a forbidden workload listing distinctly, never as "no workloads"', async () => {
    stubFetch((url) => {
      if (url.endsWith('/workloads')) return jsonResponse({ status: 'FORBIDDEN', workloads: [], kindOutcomes: [] });
      if (url.endsWith('/pods')) return jsonResponse(EMPTY_PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });
    render(<OpenShiftScopeSelect scope={PROJECT_SCOPE} onScopeChanged={vi.fn()} />);

    expect(await screen.findByText(/not permitted to list workloads/i)).toBeInTheDocument();
    expect(screen.queryByText(/no workloads in this project/i)).not.toBeInTheDocument();
  });

  it('selecting a workload re-resolves pods scoped to it, and clears any stale pod/container selection', async () => {
    const scopedPods = [
      {
        name: 'payment-api-def',
        phase: 'Running',
        readySummary: '1/1',
        restartCount: 0,
        containerNames: ['application'],
        workloadKind: 'DEPLOYMENT',
        workloadName: 'payment-api',
      },
    ];
    let podsCall = 0;
    stubFetch((url, init) => {
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/workload') && init?.method === 'PUT') {
        return jsonResponse({
          selectedProject: 'payments',
          discoveryApi: 'PROJECTS',
          selectedWorkloadKind: 'DEPLOYMENT',
          selectedWorkloadName: 'payment-api',
          selectedPod: null,
          selectedContainer: null,
        });
      }
      if (url.endsWith('/pods')) {
        podsCall += 1;
        return jsonResponse(podsCall === 1 ? PODS : { status: 'COMPLETE', pods: scopedPods });
      }
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });

    const user = userEvent.setup();
    render(<OpenShiftScopeSelect scope={PROJECT_SCOPE} onScopeChanged={vi.fn()} />);
    await screen.findByRole('option', { name: 'payment-api (Deployment)' });
    await screen.findByRole('option', { name: /payment-api-abc/i });

    await user.selectOptions(screen.getByRole('combobox', { name: /^workload$/i }), 'DEPLOYMENT::payment-api');

    expect(await screen.findByRole('option', { name: /payment-api-def/i })).toBeInTheDocument();
    // The old pod is gone from the list (a fresh, workload-scoped pod list replaced it), not just superseded.
    expect(screen.queryByRole('option', { name: 'payment-api-abc (Running, 1/1)' })).not.toBeInTheDocument();
  });

  it('selecting a pod discovers its containers', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse(PODS);
      if (url.endsWith('/pod') && init?.method === 'PUT') {
        return jsonResponse({
          selectedProject: 'payments',
          discoveryApi: 'PROJECTS',
          selectedWorkloadKind: null,
          selectedWorkloadName: null,
          selectedPod: 'payment-api-abc',
          selectedContainer: null,
        });
      }
      if (url.endsWith('/containers')) return jsonResponse(['application']);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });

    const user = userEvent.setup();
    render(<OpenShiftScopeSelect scope={PROJECT_SCOPE} onScopeChanged={vi.fn()} />);
    await screen.findByRole('option', { name: /payment-api-abc/i });
    expect(screen.getByText(/select a pod first/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: /^pod$/i }), 'payment-api-abc');

    expect(await screen.findByRole('option', { name: 'application' })).toBeInTheDocument();
  });

  it('shows a truthful incompleteness note when the pod list is PARTIAL, and never implies full coverage', async () => {
    stubFetch((url) => {
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse({ status: 'PARTIAL', pods: PODS.pods });
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });
    render(<OpenShiftScopeSelect scope={PROJECT_SCOPE} onScopeChanged={vi.fn()} />);

    expect(await screen.findByText(/pod list may be incomplete/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /payment-api-abc/i })).toBeInTheDocument();
  });

  it('shows no incompleteness note for an ordinary COMPLETE pod result', async () => {
    stubFetch((url) => {
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse(PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });
    render(<OpenShiftScopeSelect scope={PROJECT_SCOPE} onScopeChanged={vi.fn()} />);
    await screen.findByRole('option', { name: /payment-api-abc/i });

    expect(screen.queryByText(/pod list may be incomplete/i)).not.toBeInTheDocument();
  });

  it('restores the current Workload/Pod/Container selection from the authoritative scope on mount (not lost on remount)', async () => {
    stubFetch((url) => {
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse(PODS);
      if (url.endsWith('/containers')) return jsonResponse(['application']);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });
    render(
      <OpenShiftScopeSelect
        scope={{
          selectedProject: 'payments',
          discoveryApi: 'PROJECTS',
          selectedWorkloadKind: 'DEPLOYMENT',
          selectedWorkloadName: 'payment-api',
          selectedPod: 'payment-api-abc',
          selectedContainer: 'application',
        }}
        onScopeChanged={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /^workload$/i })).toHaveValue('DEPLOYMENT::payment-api'),
    );
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^pod$/i })).toHaveValue('payment-api-abc'));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /^container$/i })).toHaveValue('application'),
    );
  });

  it('has no detectable accessibility violations with the full Project/Workload/Pod/Container hierarchy shown', async () => {
    stubFetch((url) => {
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse(PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });
    const { container } = render(<OpenShiftScopeSelect scope={PROJECT_SCOPE} onScopeChanged={vi.fn()} />);
    await screen.findByRole('option', { name: 'payment-api (Deployment)' });
    await screen.findByRole('option', { name: /payment-api-abc/i });

    expect(await axe(container)).toHaveNoViolations();
  });

  it('every control has a real accessible label, not a placeholder alone', async () => {
    stubFetch((url) => {
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse(PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });
    render(<OpenShiftScopeSelect scope={PROJECT_SCOPE} onScopeChanged={vi.fn()} />);

    expect(await screen.findByRole('combobox', { name: /^project$/i })).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: /^workload$/i })).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: /^pod$/i })).toBeInTheDocument();
  });
});
