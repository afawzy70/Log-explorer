import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { installMockEventSource, latestMockEventSource } from '../features/live/mockEventSource';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const COMPOSE_LIVE_SOURCE = {
  id: 'local-docker',
  displayName: 'Local Docker',
  capabilities: {
    historicalSearch: true,
    liveTail: true,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: false,
    composeProjectScoping: true,
  },
};

/**
 * UX-R3 §19 - "Live + project switch must not continue streaming Project A
 * under Project B scope": a real `<App />` integration test (not just the
 * `useLiveTail`/`useSearchState` unit tests in isolation), because this
 * specific guarantee only exists at the point where `App.tsx` wires the two
 * hooks together.
 */
describe('App - switching the Compose project while Live is active (UX-R3 §19)', () => {
  beforeEach(() => {
    installMockEventSource();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/v1/sources')) {
          return jsonResponse([COMPOSE_LIVE_SOURCE]);
        }
        if (url.includes('/health')) {
          return jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z', warnings: [] });
        }
        if (url.includes('/compose-projects')) {
          return jsonResponse(['project-a', 'project-b']);
        }
        if (url.includes('/services')) {
          return jsonResponse([]);
        }
        if (url.endsWith('/actuator/info')) {
          return jsonResponse({});
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exits Live (closing the real EventSource) the instant the selected Compose project changes, and returns to the Search workspace', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByRole('combobox', { name: /source/i })).toHaveValue('local-docker'));
    await waitFor(() => expect(screen.getByLabelText(/compose project/i)).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText(/compose project/i), 'project-a');

    await user.click(screen.getByRole('button', { name: /^live$/i }));
    await waitFor(() => expect(screen.getByTestId('live-tail-panel')).toBeInTheDocument());

    const source = latestMockEventSource();
    expect(source.url).toContain('composeProject=project-a');
    expect(source.closed).toBe(false);

    // Switching the Compose project mid-Live - the mission's own exact
    // scenario: the app must never keep streaming project-a events under a
    // project-b scope header.
    await user.selectOptions(screen.getByLabelText(/compose project/i), 'project-b');

    expect(source.closed).toBe(true); // the real EventSource connection was actually torn down
    await waitFor(() => expect(screen.queryByTestId('live-tail-panel')).not.toBeInTheDocument());
    // Back to the ordinary Search workspace - Live was exited, not merely paused.
    expect(screen.getByRole('button', { name: /^search$/i })).toBeInTheDocument();
  });

  it('a plain source-with-no-project-change click on Live does not exit Live (sanity: only a real scope change triggers exit)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /source/i })).toHaveValue('local-docker'));

    await user.click(screen.getByRole('button', { name: /^live$/i }));
    await waitFor(() => expect(screen.getByTestId('live-tail-panel')).toBeInTheDocument());
    const source = latestMockEventSource();
    expect(source.closed).toBe(false);

    // No project switch happened - Live must remain untouched.
    expect(screen.getByTestId('live-tail-panel')).toBeInTheDocument();
    expect(source.closed).toBe(false);
  });
});
