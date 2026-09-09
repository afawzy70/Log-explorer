import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { EMPTY_QUERY_PLAN } from '../shared/api/testFixtures';

const SENTINEL_TEXT = 'RAW-SEARCH-TEXT-SENTINEL';
const SENTINEL_CIF = 'RAW-CIF-SENTINEL';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Persistence test (IMPLEMENTATION_PLAN.md "Phase F" required automated
 * test: "persistence test asserting no sensitive key ever written to
 * localStorage or URL") - drives a realistic full interaction sequence
 * (source select, time range, severity, universal search with a
 * sensitive-looking value, advanced filters with a real sensitive field,
 * and Search) and asserts nothing ever reaches `localStorage`,
 * `sessionStorage`, or the URL (CLAUDE.md §2 rule 4).
 */
describe('persistence: nothing ever written to localStorage/sessionStorage/the URL', () => {
  let localStorageSetItem: ReturnType<typeof vi.spyOn>;
  let sessionStorageSetItem: ReturnType<typeof vi.spyOn>;
  let pushState: ReturnType<typeof vi.spyOn>;
  let replaceState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorageSetItem = vi.spyOn(Storage.prototype, 'setItem');
    sessionStorageSetItem = vi.spyOn(window.sessionStorage, 'setItem');
    pushState = vi.spyOn(window.history, 'pushState');
    replaceState = vi.spyOn(window.history, 'replaceState');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/v1/sources')) {
          return jsonResponse([
            {
              id: 'fixture',
              displayName: 'Fixture',
              capabilities: {
                historicalSearch: true,
                liveTail: false,
                rawLogQL: false,
                serviceDiscovery: true,
                queryStatistics: false,
                contextView: false,
              },
            },
          ]);
        }
        if (url.includes('/health')) {
          return jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z' });
        }
        if (url.includes('/services')) {
          return jsonResponse([{ name: 'gateway', runningCount: 1, totalCount: 1 }]);
        }
        if (url.endsWith('/api/v1/logs/search') && init?.method === 'POST') {
          // The raw sentinel values must genuinely be in the outgoing
          // request body for this test to mean anything - assert that
          // separately from the persistence assertions below.
          expect(String(init.body)).toContain(SENTINEL_TEXT);
          expect(String(init.body)).toContain(SENTINEL_CIF);
          return jsonResponse({ events: [], counts: { estimatedTotal: 0, returned: 0, visible: 0, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorageSetItem.mockRestore();
    sessionStorageSetItem.mockRestore();
    pushState.mockRestore();
    replaceState.mockRestore();
  });

  it('never writes to localStorage/sessionStorage/the URL across a full search interaction', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('fixture'));

    // Time range: open, pick a preset (immediate commit).
    await user.click(screen.getByRole('button', { name: /last 1 day/i }));
    await user.click(screen.getByRole('menuitemradio', { name: /last 1 hour/i }));

    // Severity: toggle a level.
    await user.click(screen.getByRole('button', { name: 'Warn' }));

    // Universal search: type a sensitive-looking free-text value.
    await user.type(screen.getByRole('textbox', { name: /search messages/i }), SENTINEL_TEXT);

    // Advanced filters: apply a real sensitive field.
    await user.click(screen.getByRole('button', { name: /^more filters/i }));
    await user.type(screen.getByLabelText('CIF'), SENTINEL_CIF);
    await user.click(screen.getByRole('button', { name: /apply/i }));

    // Run the actual search.
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText(/run a search to see results|no results/i)).toBeInTheDocument());

    expect(localStorageSetItem).not.toHaveBeenCalled();
    expect(sessionStorageSetItem).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });
});
