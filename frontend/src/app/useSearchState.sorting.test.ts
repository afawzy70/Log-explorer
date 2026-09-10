import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSearchState } from './useSearchState';
import { EMPTY_QUERY_PLAN } from '../shared/api/testFixtures';

/**
 * UX-R4 §9/§10/§11/§29 - truthful sorting.
 *
 * The single most important property under test here is that the sort
 * direction is a **request parameter the source honors**, never a
 * client-side reordering of rows already on screen. Every assertion
 * therefore inspects the actual serialized request body that left the
 * client, and the direction-change assertions check that the previous
 * direction's cursor is *not* carried across - that is what makes
 * "switch Newest -> Oldest" a fresh result set rather than two
 * interleaved half-lists.
 *
 * (The matching source-side half - that the backend genuinely returns
 * ascending/descending per this flag, paginates truthfully in both, and
 * binds direction into the cursor's own integrity fingerprint - is
 * verified against the real backend and recorded in the UX-R4 report;
 * it is not something a mocked fetch could honestly prove.)
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function event(message: string, timestamp: string) {
  return {
    timestamp,
    timestampRaw: null,
    schemaVersion: null,
    service: null,
    serviceSourceHint: null,
    severity: null,
    severityNumber: null,
    message,
    logger: null,
    thread: null,
    exception: null,
    traceId: null,
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
    namespace: null,
    pod: null,
  };
}

const SOURCES_RESPONSE = [
  {
    id: 'fixture',
    displayName: 'Fixture',
    capabilities: {
      historicalSearch: true,
      liveTail: false,
      rawLogQL: false,
      serviceDiscovery: false,
      queryStatistics: false,
      contextView: false,
    },
  },
];

describe('UX-R4 sorting', () => {
  let searchCalls: Array<{ body: string; resolve: (r: Response) => void }>;
  let contextCalls: Array<{ body: string; resolve: (r: Response) => void }>;

  beforeEach(() => {
    searchCalls = [];
    contextCalls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/v1/sources')) return Promise.resolve(jsonResponse(SOURCES_RESPONSE));
        if (url.includes('/health'))
          return Promise.resolve(jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z' }));
        if (url.includes('/services')) return Promise.resolve(jsonResponse([]));
        if (url.endsWith('/api/v1/logs/search')) {
          return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            searchCalls.push({ body: String(init?.body), resolve });
          });
        }
        if (url.endsWith('/api/v1/logs/context')) {
          return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            contextCalls.push({ body: String(init?.body), resolve });
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  async function renderReady() {
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.selectedSourceId).toBe('fixture'));
    return result;
  }

  function lastBody() {
    return JSON.parse(searchCalls[searchCalls.length - 1].body);
  }

  async function settleLast(events: ReturnType<typeof event>[], nextCursor: string | null = null) {
    const call = searchCalls[searchCalls.length - 1];
    await act(async () => {
      call.resolve(
        jsonResponse({
          events,
          counts: { returned: events.length, total: null, estimated: false, truncated: false },
          nextCursor,
          queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
    });
  }

  it('defaults to newest-first and says so on the wire', async () => {
    const result = await renderReady();
    expect(result.current.sortDirection).toBe('BACKWARD');

    await act(async () => result.current.runSearch());
    expect(lastBody().direction).toBe('BACKWARD');
  });

  it('committing "Oldest first" sends FORWARD to the source - it never re-orders rows locally', async () => {
    const result = await renderReady();
    await act(async () => result.current.runSearch());
    await settleLast([event('a', '2026-01-01T00:00:01Z')]);

    await act(async () => result.current.setSortDirection('FORWARD'));

    expect(lastBody().direction).toBe('FORWARD');
    expect(result.current.sortDirection).toBe('FORWARD');
  });

  it('a direction change starts a FRESH result set: no cursor is carried across (§10)', async () => {
    const result = await renderReady();
    await act(async () => result.current.runSearch());
    await settleLast([event('page1', '2026-01-01T00:00:09Z')], 'CURSOR-FROM-BACKWARD');

    // Sanity: the cursor really is live, so the next assertion is meaningful.
    await act(async () => result.current.loadMore());
    expect(lastBody().cursor).toBe('CURSOR-FROM-BACKWARD');
    await settleLast([event('page2', '2026-01-01T00:00:08Z')], 'CURSOR-2');

    await act(async () => result.current.setSortDirection('FORWARD'));

    const body = lastBody();
    expect(body.direction).toBe('FORWARD');
    expect(body.cursor).toBeUndefined();
  });

  it('a direction change replaces the previous direction\'s events rather than appending to them', async () => {
    const result = await renderReady();
    await act(async () => result.current.runSearch());
    await settleLast([event('newest-first-row', '2026-01-01T00:00:09Z')], 'C1');

    await act(async () => result.current.setSortDirection('FORWARD'));
    await settleLast([event('oldest-first-row', '2026-01-01T00:00:01Z')]);

    const messages = result.current.searchResult!.events.map((e) => e.message);
    expect(messages).toEqual(['oldest-first-row']);
  });

  it('"Load more" keeps the committed direction, so pagination cannot drift between orders', async () => {
    const result = await renderReady();
    await act(async () => result.current.setSortDirection('FORWARD'));
    await settleLast([event('a', '2026-01-01T00:00:01Z')], 'CURSOR-FWD');

    await act(async () => result.current.loadMore());

    const body = lastBody();
    expect(body.direction).toBe('FORWARD');
    expect(body.cursor).toBe('CURSOR-FWD');
  });

  it('Refresh keeps the committed direction', async () => {
    const result = await renderReady();
    await act(async () => result.current.setSortDirection('FORWARD'));
    await settleLast([event('a', '2026-01-01T00:00:01Z')]);

    await act(async () => result.current.refresh());
    expect(lastBody().direction).toBe('FORWARD');
  });

  it('re-selecting the direction already committed is a no-op - it never re-queries or discards results', async () => {
    const result = await renderReady();
    await act(async () => result.current.runSearch());
    await settleLast([event('a', '2026-01-01T00:00:01Z')]);
    const callsBefore = searchCalls.length;

    await act(async () => result.current.setSortDirection('BACKWARD'));

    expect(searchCalls).toHaveLength(callsBefore);
    expect(result.current.searchResult!.events).toHaveLength(1);
  });

  it('a direction change clears the inspector selection, since row indices belong to the replaced list', async () => {
    const result = await renderReady();
    await act(async () => result.current.runSearch());
    await settleLast([event('a', '2026-01-01T00:00:02Z'), event('b', '2026-01-01T00:00:01Z')]);

    await act(async () => result.current.openInspector(1));
    expect(result.current.selectedIndex).toBe(1);

    await act(async () => result.current.setSortDirection('FORWARD'));
    expect(result.current.selectedIndex).toBeNull();
  });
});

describe('UX-R4 §20 - returning from a context detour restores the workstation state', () => {
  let searchCalls: Array<{ body: string; resolve: (r: Response) => void }>;
  let contextCalls: Array<{ body: string; resolve: (r: Response) => void }>;

  beforeEach(() => {
    searchCalls = [];
    contextCalls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/v1/sources')) return Promise.resolve(jsonResponse(SOURCES_RESPONSE));
        if (url.includes('/health'))
          return Promise.resolve(jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z' }));
        if (url.includes('/services')) return Promise.resolve(jsonResponse([]));
        if (url.endsWith('/api/v1/logs/search')) {
          return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            searchCalls.push({ body: String(init?.body), resolve });
          });
        }
        if (url.endsWith('/api/v1/logs/context')) {
          return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            contextCalls.push({ body: String(init?.body), resolve });
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('restores the committed sort direction AND the row being inspected', async () => {
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.selectedSourceId).toBe('fixture'));

    // Investigate oldest-first.
    await act(async () => result.current.setSortDirection('FORWARD'));
    await act(async () => {
      searchCalls[searchCalls.length - 1].resolve(
        jsonResponse({
          events: [event('a', '2026-01-01T00:00:01Z'), event('b', '2026-01-01T00:00:02Z')],
          counts: { returned: 2, total: null, estimated: false, truncated: false },
          nextCursor: null,
          queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
    });
    await act(async () => result.current.openInspector(1));

    // Detour into surrounding logs.
    await act(async () => result.current.showContext(result.current.searchResult!.events[1]));
    await act(async () => {
      contextCalls[contextCalls.length - 1].resolve(
        jsonResponse({
          events: [event('ctx', '2026-01-01T00:00:02Z')],
          counts: { returned: 1, total: null, estimated: false, truncated: false },
          nextCursor: null,
          queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
    });
    expect(result.current.breadcrumbLabel).not.toBeNull();

    // Return.
    await act(async () => result.current.restoreOriginalSearch());

    expect(result.current.sortDirection).toBe('FORWARD');
    expect(result.current.selectedIndex).toBe(1);
    expect(result.current.searchResult!.events.map((e) => e.message)).toEqual(['a', 'b']);
    expect(result.current.breadcrumbLabel).toBeNull();
  });
});
