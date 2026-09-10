import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { EMPTY_QUERY_PLAN } from '../shared/api/testFixtures';

const SENTINEL_TEXT = 'RAW-SEARCH-TEXT-SENTINEL';
const SENTINEL_CIF = 'RAW-CIF-SENTINEL';
const SENTINEL_QUERY_VALUE = 'RAW-QUERY-VALUE-SENTINEL';

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
  let capturedSearchBody: string | null;

  beforeEach(() => {
    capturedSearchBody = null;
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
          // Whichever sentinel(s) this particular test actually typed must
          // genuinely be in the outgoing request body, or the test proves
          // nothing - each test below drives its own sentinel(s) through
          // and asserts on `capturedSearchBody` itself.
          capturedSearchBody = String(init.body);
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

    // Time range: open, pick a preset (immediate commit). Exact name, not a
    // substring match - the new "remove time range" chip button (UX-R1 §3)
    // also mentions "Last 1 day" in its own accessible name.
    await user.click(screen.getByRole('button', { name: 'Last 1 day' }));
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

    // The sentinels must genuinely have reached the outgoing request body -
    // otherwise this test would trivially pass by testing nothing.
    expect(capturedSearchBody).toContain(SENTINEL_TEXT);
    expect(capturedSearchBody).toContain(SENTINEL_CIF);

    expect(localStorageSetItem).not.toHaveBeenCalled();
    expect(sessionStorageSetItem).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  /**
   * Legacy Remediation Slice 2 final self-audit (risk area 11): the guided
   * query builder and its generated DSL text are exactly the same class of
   * "search value" as `text`/the advanced sensitive filters above - this
   * proves the new Query authoring surface is held to the identical
   * never-persisted standard, not just asserted by code review.
   */
  it('a guided query built through the new Query control is never written to localStorage/sessionStorage/the URL either', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('fixture'));

    // Advanced Query now lives under More filters (UX-R1 §2) - both the
    // drawer and Query's own nested popover are open at once and each has
    // its own "Apply" button, so scope to Query's own dialog.
    await user.click(screen.getByRole('button', { name: /^more filters/i }));
    await user.click(screen.getByRole('button', { name: /^query/i }));
    const queryDialog = screen.getByRole('heading', { name: 'Query' }).closest('[role="dialog"]') as HTMLElement;
    await user.click(within(queryDialog).getByRole('button', { name: /\+ condition/i }));
    await user.selectOptions(within(queryDialog).getByLabelText('Field'), 'message');
    await user.type(within(queryDialog).getByLabelText('Value'), SENTINEL_QUERY_VALUE);
    await user.click(within(queryDialog).getByRole('button', { name: /^apply$/i }));

    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText(/run a search to see results|no results/i)).toBeInTheDocument());

    expect(capturedSearchBody).toContain(SENTINEL_QUERY_VALUE);

    expect(localStorageSetItem).not.toHaveBeenCalled();
    expect(sessionStorageSetItem).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  /**
   * Legacy Remediation Slice 7 - the frontend never redacts anything
   * itself; it only ever displays whatever the (already-redacted) backend
   * response contains. Proves opening the inspector on such an event -
   * the one place message/exception text is shown at length - still
   * never writes anything to storage/the URL, and that the already-
   * redacted marker is what actually reaches the DOM (never a raw value
   * the frontend somehow reconstructed).
   */
  it('viewing an already-redacted event in the inspector still never writes to localStorage/sessionStorage/the URL', async () => {
    const REDACTED_MESSAGE = 'Login failed for customerId=[REDACTED] card [REDACTED_CARD] declined';
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
                historicalSearch: true, liveTail: false, rawLogQL: false,
                serviceDiscovery: true, queryStatistics: false, contextView: false,
              },
            },
          ]);
        }
        if (url.includes('/health')) {
          return jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z', warnings: [] });
        }
        if (url.includes('/services')) {
          return jsonResponse([{ name: 'gateway', runningCount: 1, totalCount: 1 }]);
        }
        if (url.endsWith('/api/v1/logs/search') && init?.method === 'POST') {
          return jsonResponse({
            events: [{
              timestamp: '2026-01-01T00:00:00Z', timestampRaw: null, schemaVersion: null, service: 'gateway',
              serviceSourceHint: null, severity: 'ERROR', severityNumber: null, message: REDACTED_MESSAGE,
              logger: null, thread: null, exception: null, traceId: 'trace-1', spanId: null, journeyId: null,
              eventId: null, businessStep: null, uiIdentifier: null, errorCode: null, correlationId: null,
              protectedFields: { cif: null, userName: null, customerId: null, deviceId: null, deviceIp: null },
              devicePlatformType: null, language: null, serverIp: null, serverHost: null, unknownTopLevelFields: {},
              unknownMdcFields: {}, malformed: false, rawLine: null, sourceId: null, composeProject: null,
              composeService: null, containerId: null, containerName: null, stream: null, namespace: null, pod: null,
            }],
            counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false },
            nextCursor: null,
            queryPlan: EMPTY_QUERY_PLAN,
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('fixture'));

    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByText(/customerId=\[REDACTED\]/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /actions for this event/i }));
    await user.click(screen.getByRole('menuitem', { name: /view details/i }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: /event details/i })).toBeInTheDocument());
    expect(screen.getAllByText(/customerId=\[REDACTED\]/).length).toBeGreaterThan(0);

    expect(localStorageSetItem).not.toHaveBeenCalled();
    expect(sessionStorageSetItem).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });
});
