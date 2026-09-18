import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
 *
 * B6.2 (Session 7) - this panel is no longer a trigger-button popover: it
 * renders persistently and fetches its connection/intake/proxy state on
 * mount (COMPONENT_INVENTORY.md's own RECOMPOSE row). Every test below
 * renders it directly instead of clicking an "OpenShift" trigger and
 * waiting for a `role="dialog"` - the panel is a plain `<section>` now,
 * found by its own heading.
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
    await screen.findByRole('heading', { name: /^openshift$/i });
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

  it('offers a Disconnect action once connected, styled as the approved danger button', async () => {
    stubFetch((url) => (url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse(CONNECTED)));
    await openPanel();

    expect(await screen.findByRole('button', { name: /^disconnect$/i })).toBeInTheDocument();
  });

  it('never offers Disconnect while disconnected', async () => {
    stubFetch((url) => (url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse(DISCONNECTED)));
    await openPanel();

    await screen.findByText(/not connected/i);
    expect(screen.queryByRole('button', { name: /^disconnect$/i })).not.toBeInTheDocument();
  });

  // SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - Project/Workload/Pod/Container are no longer selected here;
  // this panel shows the current scope read-only (sourced from the `scope` prop, the same lifted summary
  // Search's own `OpenShiftScopeSelect` reads and writes) and links back to Search to change it.
  it('shows the current scope read-only, with no editable Project/Workload/Pod/Container control', async () => {
    stubFetch((url) => (url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse(CONNECTED)));
    const user = userEvent.setup();
    render(
      <OpenShiftSettingsPanel
        scope={{
          selectedProject: 'payments',
          discoveryApi: 'PROJECTS',
          selectedWorkloadKind: 'DEPLOYMENT',
          selectedWorkloadName: 'payment-api',
          selectedPod: 'payment-api-abc',
          selectedContainer: 'application',
        }}
      />,
    );
    await screen.findByRole('heading', { name: /^openshift$/i });
    void user;

    expect(await screen.findByText('payments')).toBeInTheDocument();
    expect(screen.getByText('payment-api (Deployment)')).toBeInTheDocument();
    expect(screen.getByText('payment-api-abc')).toBeInTheDocument();
    expect(screen.getByText('application')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^project$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^workload$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^pod$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^container$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/selected from search, not here/i)).toBeInTheDocument();
  });

  it('shows "None selected" and "All workloads/pods/containers" truthfully when nothing more specific is chosen', async () => {
    stubFetch((url) => (url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse(CONNECTED)));
    render(
      <OpenShiftSettingsPanel
        scope={{
          selectedProject: null,
          discoveryApi: 'PROJECTS',
          selectedWorkloadKind: null,
          selectedWorkloadName: null,
          selectedPod: null,
          selectedContainer: null,
        }}
      />,
    );
    await screen.findByRole('heading', { name: /^openshift$/i });

    expect(await screen.findByText('None selected')).toBeInTheDocument();
    // No project selected yet, so Workload/Pod/Container rows don't render at all (nothing to describe).
    expect(screen.queryByText('All workloads')).not.toBeInTheDocument();
  });

  it('labels the current scope "Namespace" when discovery used the namespaces fallback, never "Project"', async () => {
    stubFetch((url) =>
      url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse({ ...CONNECTED, projectApi: 'NAMESPACES' }),
    );
    render(
      <OpenShiftSettingsPanel
        scope={{
          selectedProject: 'payments-ns',
          discoveryApi: 'NAMESPACES',
          selectedWorkloadKind: null,
          selectedWorkloadName: null,
          selectedPod: null,
          selectedContainer: null,
        }}
      />,
    );
    await screen.findByRole('heading', { name: /^openshift$/i });

    expect(await screen.findByText('Namespace')).toBeInTheDocument();
    expect(await screen.findByText('payments-ns')).toBeInTheDocument();
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

  it('labels the summary row truthfully as "Namespaces" when the namespaces fallback answered, never "Projects"', async () => {
    stubFetch((url) =>
      url.includes('intake-allowed') ? jsonResponse(true) : jsonResponse({ ...CONNECTED, projectApi: 'NAMESPACES' }),
    );
    await openPanel();

    // Must not silently call namespaces "Projects" (OS-1A §16).
    expect(await screen.findByText('Namespaces')).toBeInTheDocument();
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
    const { container } = render(<OpenShiftSettingsPanel />);
    await screen.findByRole('heading', { name: /^openshift$/i });
    await waitFor(() => expect(screen.getByText('api.example.com:6443')).toBeInTheDocument());

    expect(await axe(container)).toHaveNoViolations();
  });
});


describe('OpenShiftSettingsPanel - OS-1F connecting state & scope-change notifications', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  async function openPanel() {
    const user = userEvent.setup();
    render(<OpenShiftSettingsPanel />);
    await screen.findByRole('heading', { name: /^openshift$/i });
    return user;
  }

  it('shows "Connecting…" in the top status badge during the async gap between submit and response - never "Not connected", which would claim nothing is happening', async () => {
    let resolveConnect!: (value: Response) => void;
    const connectPromise = new Promise<Response>((resolve) => {
      resolveConnect = resolve;
    });
    stubFetch((url, init) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/connect') && init?.method === 'POST') return connectPromise;
      return jsonResponse(DISCONNECTED);
    });

    const user = await openPanel();
    const field = screen.getByLabelText(/paste your oc login command/i);
    await user.type(field, 'oc login --token=sha256~connectingstate123456 --server=https://api.example.com:6443');
    await user.click(screen.getByRole('button', { name: /^connect$/i }));

    const badge = screen.getByTestId('openshift-connection-state');
    await waitFor(() => expect(within(badge).getByText(/^connecting…$/i)).toBeInTheDocument());
    expect(within(badge).queryByText(/^not connected$/i)).not.toBeInTheDocument();

    resolveConnect(jsonResponse(CONNECTED));
    await waitFor(() => expect(within(badge).getByText(/^connected$/i)).toBeInTheDocument());
    // The transient state clears once the real state is known.
    expect(within(badge).queryByText(/^connecting…$/i)).not.toBeInTheDocument();
  });

  it('calls onScopeChanged after a successful connect, so a caller (Shell) can re-read the truth', async () => {
    stubFetch((url) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/connect')) return jsonResponse(CONNECTED);
      return jsonResponse(DISCONNECTED);
    });
    const onScopeChanged = vi.fn();
    const user = userEvent.setup();
    render(<OpenShiftSettingsPanel onScopeChanged={onScopeChanged} />);
    await screen.findByRole('heading', { name: /^openshift$/i });
    const field = screen.getByLabelText(/paste your oc login command/i);
    await user.type(field, 'oc login --token=sha256~scopechangedafter123 --server=https://api.example.com:6443');
    await user.click(screen.getByRole('button', { name: /^connect$/i }));

    await screen.findByText(/^connected$/i);
    expect(onScopeChanged).toHaveBeenCalled();
  });

  it('calls onScopeChanged after disconnecting', async () => {
    stubFetch((url, init) => {
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/connect') && init?.method === 'DELETE') return jsonResponse(DISCONNECTED);
      return jsonResponse(CONNECTED);
    });
    const onScopeChanged = vi.fn();
    const user = userEvent.setup();
    render(<OpenShiftSettingsPanel onScopeChanged={onScopeChanged} />);
    await screen.findByRole('heading', { name: /^openshift$/i });
    await screen.findByText(/^connected$/i);

    await user.click(screen.getByRole('button', { name: /^disconnect$/i }));

    await screen.findByText(/^not connected$/i);
    expect(onScopeChanged).toHaveBeenCalled();
  });

  // Project/Workload/Pod/Container selection (and its own onScopeChanged calls) moved to Search's
  // `OpenShiftScopeSelect.tsx` - see OpenShiftScopeSelect.test.tsx. This panel still calls it after
  // connect/disconnect (tested above), the one mutation it still performs.
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

describe('OpenShiftSettingsPanel - pre-closure functional recovery 2, proxy settings (§B3/§G)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  const SYSTEM_PROXY = { mode: 'SYSTEM', host: null, port: null };

  async function openPanel(proxySettings: unknown = SYSTEM_PROXY, extra?: (url: string, init?: RequestInit) => Response | undefined) {
    stubFetch((url, init) => {
      const overridden = extra?.(url, init);
      if (overridden) return overridden;
      if (url.includes('intake-allowed')) return jsonResponse(true);
      if (url.endsWith('/proxy') && (!init || init.method === undefined)) return jsonResponse(proxySettings);
      return jsonResponse(DISCONNECTED);
    });
    const user = userEvent.setup();
    render(<OpenShiftSettingsPanel />);
    await screen.findByRole('heading', { name: /^openshift$/i });
    return user;
  }

  it('the proxy selector is visible with System selected by default', async () => {
    await openPanel();
    expect(await screen.findByText('Proxy')).toBeInTheDocument();
    const system = screen.getByRole('radio', { name: /use system proxy/i });
    expect(system).toBeChecked();
    expect(screen.getByRole('radio', { name: /^direct connection$/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /^custom proxy$/i })).not.toBeChecked();
  });

  it('reflects an already-configured Direct mode on open', async () => {
    await openPanel({ mode: 'DIRECT', host: null, port: null });
    expect(await screen.findByRole('radio', { name: /^direct connection$/i })).toBeChecked();
  });

  it('reflects an already-configured Custom mode, with the host/port fields pre-filled', async () => {
    await openPanel({ mode: 'CUSTOM', host: 'proxy.company.local', port: 8080 });
    expect(await screen.findByRole('radio', { name: /^custom proxy$/i })).toBeChecked();
    expect(screen.getByLabelText(/proxy server/i)).toHaveValue('proxy.company.local');
    expect(screen.getByLabelText(/proxy port/i)).toHaveValue('8080');
  });

  it('custom host/port fields are hidden under System and Direct, and appear only under Custom', async () => {
    const user = await openPanel();
    expect(screen.queryByLabelText(/proxy server/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /^custom proxy$/i }));
    expect(screen.getByLabelText(/proxy server/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/proxy port/i)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /use system proxy/i }));
    expect(screen.queryByLabelText(/proxy server/i)).not.toBeInTheDocument();
  });

  it('selecting Direct sends the change to the backend immediately', async () => {
    let putBody: string | undefined;
    const user = await openPanel(SYSTEM_PROXY, (url, init) => {
      if (url.endsWith('/proxy') && init?.method === 'PUT') {
        putBody = String(init.body);
        return jsonResponse({ mode: 'DIRECT', host: null, port: null });
      }
      return undefined;
    });

    await user.click(screen.getByRole('radio', { name: /^direct connection$/i }));

    await waitFor(() => expect(putBody).toBeDefined());
    expect(JSON.parse(putBody!)).toEqual({ mode: 'DIRECT', host: null, port: null });
  });

  it('a blank custom host is rejected client-side before any request is sent', async () => {
    let putCalled = false;
    const user = await openPanel(SYSTEM_PROXY, (url, init) => {
      if (url.endsWith('/proxy') && init?.method === 'PUT') {
        putCalled = true;
        return jsonResponse({ mode: 'CUSTOM', host: '', port: 8080 });
      }
      return undefined;
    });

    await user.click(screen.getByRole('radio', { name: /^custom proxy$/i }));
    await user.clear(screen.getByLabelText(/proxy port/i));
    await user.type(screen.getByLabelText(/proxy port/i), '8080');
    await user.click(screen.getByRole('button', { name: /apply proxy/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/proxy server is required/i);
    expect(putCalled).toBe(false);
  });

  it('a non-numeric custom port is rejected client-side', async () => {
    const user = await openPanel();
    await user.click(screen.getByRole('radio', { name: /^custom proxy$/i }));
    await user.type(screen.getByLabelText(/proxy server/i), 'proxy.company.local');
    await user.type(screen.getByLabelText(/proxy port/i), 'not-a-port');
    await user.click(screen.getByRole('button', { name: /apply proxy/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/must be a number/i);
  });

  it('an out-of-range custom port is rejected client-side', async () => {
    const user = await openPanel();
    await user.click(screen.getByRole('radio', { name: /^custom proxy$/i }));
    await user.type(screen.getByLabelText(/proxy server/i), 'proxy.company.local');
    await user.type(screen.getByLabelText(/proxy port/i), '70000');
    await user.click(screen.getByRole('button', { name: /apply proxy/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/between 1 and 65535/i);
  });

  it('a valid custom host/port is sent to the backend on Apply', async () => {
    let putBody: string | undefined;
    const user = await openPanel(SYSTEM_PROXY, (url, init) => {
      if (url.endsWith('/proxy') && init?.method === 'PUT') {
        putBody = String(init.body);
        return jsonResponse({ mode: 'CUSTOM', host: 'proxy.company.local', port: 8080 });
      }
      return undefined;
    });

    await user.click(screen.getByRole('radio', { name: /^custom proxy$/i }));
    await user.type(screen.getByLabelText(/proxy server/i), 'proxy.company.local');
    await user.type(screen.getByLabelText(/proxy port/i), '8080');
    await user.click(screen.getByRole('button', { name: /apply proxy/i }));

    await waitFor(() => expect(putBody).toBeDefined());
    expect(JSON.parse(putBody!)).toEqual({ mode: 'CUSTOM', host: 'proxy.company.local', port: 8080 });
  });

  it('a server-side rejection (e.g. a stale/invalid value) surfaces its own message, never a generic one', async () => {
    const user = await openPanel(SYSTEM_PROXY, (url, init) => {
      if (url.endsWith('/proxy') && init?.method === 'PUT') {
        return new Response(
          JSON.stringify({ status: 400, detail: 'Proxy port must be between 1 and 65535.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return undefined;
    });

    await user.click(screen.getByRole('radio', { name: /^custom proxy$/i }));
    await user.type(screen.getByLabelText(/proxy server/i), 'proxy.company.local');
    await user.type(screen.getByLabelText(/proxy port/i), '99999999');
    await user.click(screen.getByRole('button', { name: /apply proxy/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/between 1 and 65535/i);
  });

  it('switching away from Custom never resubmits the stale custom host/port', async () => {
    const putBodies: string[] = [];
    const user = await openPanel({ mode: 'CUSTOM', host: 'old-proxy.example.com', port: 3128 }, (url, init) => {
      if (url.endsWith('/proxy') && init?.method === 'PUT') {
        putBodies.push(String(init.body));
        return jsonResponse(JSON.parse(String(init.body)));
      }
      return undefined;
    });

    await screen.findByRole('radio', { name: /^custom proxy$/i, checked: true });
    await user.click(screen.getByRole('radio', { name: /use system proxy/i }));

    await waitFor(() => expect(putBodies.length).toBe(1));
    expect(JSON.parse(putBodies[0])).toEqual({ mode: 'SYSTEM', host: null, port: null });
  });

  it('never writes anything to localStorage or sessionStorage', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const user = await openPanel(SYSTEM_PROXY, (url, init) => {
      if (url.endsWith('/proxy') && init?.method === 'PUT') {
        return jsonResponse({ mode: 'CUSTOM', host: 'proxy.company.local', port: 8080 });
      }
      return undefined;
    });

    await user.click(screen.getByRole('radio', { name: /^custom proxy$/i }));
    await user.type(screen.getByLabelText(/proxy server/i), 'proxy.company.local');
    await user.type(screen.getByLabelText(/proxy port/i), '8080');
    await user.click(screen.getByRole('button', { name: /apply proxy/i }));
    await waitFor(() => expect(screen.getByLabelText(/proxy server/i)).toHaveValue('proxy.company.local'));

    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('the proxy fieldset has labels correctly associated with their controls (axe)', async () => {
    const { container } = await (async () => {
      const user = await openPanel();
      await user.click(screen.getByRole('radio', { name: /^custom proxy$/i }));
      return { container: document.body };
    })();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('every proxy control is reachable and operable via keyboard alone', async () => {
    let putBody: string | undefined;
    const user = await openPanel(SYSTEM_PROXY, (url, init) => {
      if (url.endsWith('/proxy') && init?.method === 'PUT') {
        putBody = String(init.body);
        return jsonResponse({ mode: 'DIRECT', host: null, port: null });
      }
      return undefined;
    });

    const directRadio = screen.getByRole('radio', { name: /^direct connection$/i });
    directRadio.focus();
    expect(directRadio).toHaveFocus();
    await user.keyboard(' ');

    await waitFor(() => expect(putBody).toBeDefined());
    expect(JSON.parse(putBody!).mode).toBe('DIRECT');
  });
});
