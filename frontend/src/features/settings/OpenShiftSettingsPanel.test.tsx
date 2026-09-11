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
