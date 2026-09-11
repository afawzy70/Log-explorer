import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { OpenShiftSettingsPanel, describeFailure } from './OpenShiftSettingsPanel';
import { ApiError } from '../../shared/api/client';

/**
 * OS-1A §18/§27/§28 - the OpenShift connection panel.
 *
 * The tests that matter most here are not the happy path: they are that
 * the pasted token never survives in client state or storage, and that the
 * three failure truths OS-1A §15 separates stay separated in the copy the
 * user actually reads.
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

const DISCONNECTED = {
  state: 'DISCONNECTED',
  connectionName: null,
  server: null,
  username: null,
  projectCount: 0,
  projects: [],
  selectedProject: null,
  tlsVerified: false,
  usingPrivateCa: false,
  proxy: null,
  projectApi: null,
};

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

describe('OpenShiftSettingsPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  async function openPanel() {
    const user = userEvent.setup();
    render(<OpenShiftSettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'OpenShift' }));
    await screen.findByRole('dialog', { name: /openshift connection/i });
    return user;
  }

  it('starts disconnected and offers a Connect form', async () => {
    stubFetch((url) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      return jsonResponse(DISCONNECTED);
    });

    await openPanel();

    expect(await screen.findByText(/not connected/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/paste your oc login command/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeInTheDocument();
  });

  // ------------------------------------------------ §9 the token never lingers

  it('clears the pasted command immediately after submitting it, and never stores it', async () => {
    let sentBody: string | undefined;
    stubFetch((url, init) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/connect') && init?.method === 'POST') {
        sentBody = String(init.body);
        return jsonResponse(CONNECTED);
      }
      return jsonResponse(DISCONNECTED);
    });

    const user = await openPanel();
    const command = 'oc login --token=sha256~secret-value-123456 --server=https://api.example.com:6443';
    const field = screen.getByLabelText(/paste your oc login command/i);
    await user.type(field, command);
    await user.click(screen.getByRole('button', { name: /^connect$/i }));

    await screen.findByText(/^connected$/i);

    // It was genuinely sent...
    expect(sentBody).toContain('sha256~secret-value-123456');
    // ...and is gone from the client afterwards.
    expect(window.localStorage.getItem('logexplorer.openshift')).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain('sha256~secret-value-123456');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('sha256~secret-value-123456');
    expect(window.location.href).not.toContain('sha256~secret-value-123456');
    expect(document.body.innerHTML).not.toContain('sha256~secret-value-123456');
  });

  it('clears the pasted command even when the attempt fails', async () => {
    stubFetch((url) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/connect')) {
        return jsonResponse({ status: 401, detail: 'rejected', reason: 'UNAUTHORIZED' }, 401);
      }
      return jsonResponse(DISCONNECTED);
    });

    const user = await openPanel();
    const field = screen.getByLabelText(/paste your oc login command/i) as HTMLTextAreaElement;
    await user.type(field, 'oc login --token=sha256~another-secret-9876 --server=https://api.example.com:6443');
    await user.click(screen.getByRole('button', { name: /^connect$/i }));

    await screen.findByRole('alert');
    expect(field.value).toBe('');
    expect(document.body.innerHTML).not.toContain('sha256~another-secret-9876');
  });

  it('treats the command field as a secret: no autofill, no spellcheck', async () => {
    stubFetch((url) => (url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse(DISCONNECTED)));
    await openPanel();

    const field = screen.getByLabelText(/paste your oc login command/i);
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('spellcheck', 'false');
  });

  // --------------------------------------------------- §10 loopback guard

  it('explains why sign-in is unavailable when intake is refused', async () => {
    stubFetch((url) => {
      if (url.includes('intake-allowed')) return jsonResponse(false);
      return jsonResponse(DISCONNECTED);
    });

    await openPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent(/reachable from the network/i);
    expect(screen.getByLabelText(/paste your oc login command/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /^connect$/i })).toBeDisabled();
  });

  // ------------------------------------------------- §17 connected summary

  it('shows identity, server and TLS state - and never a token field', async () => {
    stubFetch((url) => (url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse(CONNECTED)));
    await openPanel();

    expect(await screen.findByText('api.example.com:6443')).toBeInTheDocument();
    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    // There is no read-back of the credential anywhere in the connected view.
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reveal|show token/i })).not.toBeInTheDocument();
  });

  it('offers project selection once connected', async () => {
    stubFetch((url) => (url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse(CONNECTED)));
    await openPanel();

    const select = await screen.findByLabelText(/^project$/i);
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'payments' })).toBeInTheDocument();
  });

  it('says so plainly when the account genuinely has no projects', async () => {
    stubFetch((url) =>
      url.includes('intake-allowed')
        ? jsonResponse(true)
        : jsonResponse({ ...CONNECTED, projectCount: 0, projects: [] }),
    );
    await openPanel();

    expect(await screen.findByText(/has no projects/i)).toBeInTheDocument();
  });

  it('labels the list truthfully when the namespaces fallback answered', async () => {
    stubFetch((url) =>
      url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse({ ...CONNECTED, projectApi: 'NAMESPACES' }),
    );
    await openPanel();

    // Must not silently call namespaces "Projects" (OS-1A §16).
    expect(await screen.findByText('Namespaces')).toBeInTheDocument();
    // OS-1A review recovery #2 §5 - the selection control itself must
    // agree with the summary, not just the summary row.
    expect(screen.getByLabelText(/^namespace$/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /all namespaces \(none selected\)/i })).toBeInTheDocument();
  });

  it('labels the selection control as "Project" when discovery used the native Projects API', async () => {
    stubFetch((url) => (url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse(CONNECTED)));
    await openPanel();

    expect(screen.getByLabelText(/^project$/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /all projects \(none selected\)/i })).toBeInTheDocument();
  });

  it('says "no namespaces" rather than "no projects" when the account has zero namespaces via the fallback', async () => {
    stubFetch((url) =>
      url.includes('intake-allowed')
        ? jsonResponse(true)
        : jsonResponse({ ...CONNECTED, projectApi: 'NAMESPACES', projectCount: 0, projects: [] }),
    );
    await openPanel();

    expect(await screen.findByText(/has no namespaces/i)).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    stubFetch((url) => (url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse(CONNECTED)));
    const user = userEvent.setup();
    const { container } = render(<OpenShiftSettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'OpenShift' }));
    await screen.findByRole('dialog', { name: /openshift connection/i });
    await waitFor(() => expect(screen.getByText('api.example.com:6443')).toBeInTheDocument());

    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * OS-1B §4/§21/§24 - the workload/pod/container hierarchy beneath a
 * selected project, and its distinct loading/empty/forbidden states.
 */
describe('OpenShiftSettingsPanel - OS-1B scope controls', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

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

  async function openPanelConnectedToAProject() {
    const user = userEvent.setup();
    render(<OpenShiftSettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'OpenShift' }));
    await screen.findByRole('dialog', { name: /openshift connection/i });
    return user;
  }

  it('discovers and lists workloads for the selected project, and does not spam the UI about an absent DeploymentConfig API', async () => {
    stubFetch((url) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse(PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });

    await openPanelConnectedToAProject();

    expect(await screen.findByRole('option', { name: 'payment-api (Deployment)' })).toBeInTheDocument();
    // The absent DeploymentConfig API is UNAVAILABLE_RESOURCE_TYPE, not
    // FORBIDDEN/ERROR - the common, expected case must not be surfaced as
    // technical noise (OS-1B §8).
    expect(screen.queryByText(/DeploymentConfig/i)).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /payment-api-abc/i })).toBeInTheDocument();
  });

  it('says "No workloads in this project" rather than a blank control when discovery is genuinely empty', async () => {
    stubFetch((url) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/workloads')) return jsonResponse({ status: 'SUCCESS', workloads: [], kindOutcomes: [] });
      if (url.endsWith('/pods')) return jsonResponse(EMPTY_PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });

    await openPanelConnectedToAProject();

    expect(await screen.findByText(/no workloads in this project/i)).toBeInTheDocument();
  });

  it('reports a forbidden workload listing distinctly, never as "no workloads"', async () => {
    stubFetch((url) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/workloads')) return jsonResponse({ status: 'FORBIDDEN', workloads: [], kindOutcomes: [] });
      // Pod listing is a separate RBAC permission from workload listing -
      // discovery still attempts it independently (OS-1B §17).
      if (url.endsWith('/pods')) return jsonResponse(EMPTY_PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });

    await openPanelConnectedToAProject();

    expect(await screen.findByText(/not permitted to list workloads/i)).toBeInTheDocument();
    expect(screen.queryByText(/no workloads in this project/i)).not.toBeInTheDocument();
  });

  it('selecting a workload re-resolves pods scoped to it', async () => {
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
      if (url.includes('intake-allowed')) return jsonResponse(true);
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

    const user = await openPanelConnectedToAProject();
    await screen.findByRole('option', { name: 'payment-api (Deployment)' });
    await screen.findByRole('option', { name: /payment-api-abc/i });

    await user.selectOptions(screen.getByLabelText(/^workload$/i), 'DEPLOYMENT::payment-api');

    expect(await screen.findByRole('option', { name: /payment-api-def/i })).toBeInTheDocument();
  });

  it('selecting a pod discovers its containers', async () => {
    stubFetch((url, init) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
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

    const user = await openPanelConnectedToAProject();
    await screen.findByRole('option', { name: /payment-api-abc/i });
    expect(screen.getByText(/select a specific pod/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^pod$/i), 'payment-api-abc');

    expect(await screen.findByRole('option', { name: 'application' })).toBeInTheDocument();
  });

  it('shows a truthful incompleteness note when the pod list is PARTIAL, and never implies full coverage', async () => {
    stubFetch((url) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse({ status: 'PARTIAL', pods: PODS.pods });
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });

    await openPanelConnectedToAProject();

    expect(await screen.findByText(/this list may be incomplete/i)).toBeInTheDocument();
    // The pods that WERE proven still render normally - PARTIAL is an honest caveat, not a reason to hide the list.
    expect(screen.getByRole('option', { name: /payment-api-abc/i })).toBeInTheDocument();
  });

  it('shows no incompleteness note for an ordinary COMPLETE pod result', async () => {
    stubFetch((url) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/workloads')) return jsonResponse(WORKLOAD_DISCOVERY);
      if (url.endsWith('/pods')) return jsonResponse(PODS);
      return jsonResponse(CONNECTED_WITH_PROJECT);
    });

    await openPanelConnectedToAProject();
    await screen.findByRole('option', { name: /payment-api-abc/i });

    expect(screen.queryByText(/this list may be incomplete/i)).not.toBeInTheDocument();
  });
});

/**
 * OS-1A §15/§18 - the failure taxonomy. These three must never collapse
 * into one another, and none may be shown as a generic "connection
 * failed".
 */
describe('describeFailure', () => {
  function apiError(status: number, reason: string) {
    return new ApiError(status, { status, detail: 'backend detail', reason } as never);
  }

  it('reports an expired/invalid token as an authentication problem', () => {
    const described = describeFailure(apiError(401, 'UNAUTHORIZED'));
    expect(described.reason).toBe('UNAUTHORIZED');
    expect(described.message).toMatch(/rejected this token|expired/i);
  });

  it('never reports a forbidden project listing as "no projects"', () => {
    const described = describeFailure(apiError(403, 'FORBIDDEN'));
    expect(described.reason).toBe('FORBIDDEN');
    expect(described.message).toMatch(/not permitted to list projects/i);
    expect(described.message).not.toMatch(/no accessible projects|has no projects/i);
  });

  it('distinguishes TLS, network and proxy failures from each other', () => {
    expect(describeFailure(apiError(502, 'TLS')).message).toMatch(/TLS/i);
    expect(describeFailure(apiError(502, 'NETWORK')).message).toMatch(/VPN|DNS|reach/i);
    expect(describeFailure(apiError(502, 'PROXY')).message).toMatch(/proxy/i);
  });

  it('reports a genuine "API not found" distinctly, never as forbidden or a busy cluster', () => {
    // OS-1A review recovery: NOT_FOUND is its own backend reason, reached
    // only when both the Projects API AND the namespaces fallback failed.
    // It must read as its own truth, not as "forbidden" and not as a
    // generic upstream failure.
    const described = describeFailure(apiError(502, 'NOT_FOUND'));
    expect(described.reason).toBe('NOT_FOUND');
    expect(described.message).toMatch(/project or namespace/i);
    expect(described.message).not.toMatch(/not permitted|forbidden/i);
  });

  it('explains each parser refusal specifically', () => {
    expect(describeFailure(apiError(400, 'SHELL_SYNTAX_PRESENT')).message).toMatch(/shell syntax/i);
    expect(describeFailure(apiError(400, 'UNKNOWN_FLAG')).message).toMatch(/does not support/i);
    expect(describeFailure(apiError(400, 'SERVER_NOT_HTTPS')).message).toMatch(/https/i);
    expect(describeFailure(apiError(400, 'INSECURE_TLS_REFUSED')).message).toMatch(/will not disable TLS/i);
    expect(describeFailure(apiError(400, 'MISSING_TOKEN')).message).toMatch(/--token/);
  });

  it('falls back to the raw message only when there is no reason at all', () => {
    const described = describeFailure(new Error('something went wrong'));
    expect(described.reason).toBeNull();
    expect(described.message).toBe('something went wrong');
  });
});
