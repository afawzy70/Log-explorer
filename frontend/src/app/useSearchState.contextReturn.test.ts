import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSearchState } from './useSearchState';
import { EMPTY_QUERY_PLAN } from '../shared/api/testFixtures';

/**
 * UX-R5 §16/§24/§25/§26 - the context detour's state contract.
 *
 * **The §25 decision, and why.** The mission asks whether returning from a
 * context view should (A) reopen the inspector on the original event, or
 * (B) restore the results with the row selected but the inspector closed.
 * Taken as a global rule, either answer is wrong half the time, because
 * since UX-R4 there are two ways into a context view:
 *
 *   - from the **inspector** ("Show surrounding logs" in the header), where
 *     the investigator was reading an event when they left; and
 *   - from a **results row's Actions menu**, where they never opened the
 *     inspector at all.
 *
 * Rule (A) would conjure an inspector the row-menu user never opened; rule
 * (B) would close one the inspector user was mid-way through reading. So
 * the committed behaviour is neither: **return restores the inspector
 * state the investigator actually left.** That is continuity in both
 * paths, and it is what these tests pin - both directions, deterministically,
 * rather than one of them by luck.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function event(message: string, timestamp: string) {
  return {
    timestamp,
    timestampRaw: null,
    schemaVersion: null,
    service: 'gateway',
    serviceSourceHint: null,
    severity: 'INFO',
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
    sourceId: 'fixture',
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
      contextView: true,
    },
  },
];

describe('UX-R5 - context detour state', () => {
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
            (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
            searchCalls.push({ body: String(init?.body), resolve });
          });
        }
        if (url.endsWith('/api/v1/logs/context')) {
          return new Promise<Response>((resolve, reject) => {
            (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
            contextCalls.push({ body: String(init?.body), resolve });
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  async function searchedState() {
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.selectedSourceId).toBe('fixture'));
    await act(async () => result.current.runSearch());
    await act(async () => {
      searchCalls[searchCalls.length - 1].resolve(
        jsonResponse({
          events: [
            event('first', '2026-01-01T00:00:03Z'),
            event('second', '2026-01-01T00:00:02Z'),
            event('third', '2026-01-01T00:00:01Z'),
          ],
          counts: { returned: 3, total: null, estimated: false, truncated: false },
          nextCursor: null,
          queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
    });
    return result;
  }

  async function settleContext(result: Awaited<ReturnType<typeof searchedState>>) {
    await act(async () => {
      contextCalls[contextCalls.length - 1].resolve(
        jsonResponse({
          events: [event('ctx-earlier', '2026-01-01T00:00:01Z'), event('ctx-root', '2026-01-01T00:00:02Z')],
          counts: { returned: 2, total: null, estimated: false, truncated: false },
          nextCursor: null,
          queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
    });
    expect(result.current.breadcrumbLabel).not.toBeNull();
  }

  it('§25 - entering context FROM THE INSPECTOR returns with the inspector reopened on the same event', async () => {
    const result = await searchedState();
    await act(async () => result.current.openInspector(1));
    expect(result.current.selectedEvent!.message).toBe('second');

    await act(async () => result.current.showContext(result.current.searchResult!.events[1]));
    await settleContext(result);
    // The context fetch itself closes the inspector so the two panels never overlap.
    expect(result.current.selectedIndex).toBeNull();

    await act(async () => result.current.restoreOriginalSearch());

    expect(result.current.selectedIndex).toBe(1);
    expect(result.current.selectedEvent!.message).toBe('second');
  });

  it('§25 - entering context FROM A RESULTS ROW returns with the inspector still closed', async () => {
    const result = await searchedState();
    expect(result.current.selectedIndex).toBeNull(); // never opened

    await act(async () => result.current.showContext(result.current.searchResult!.events[1]));
    await settleContext(result);
    await act(async () => result.current.restoreOriginalSearch());

    // No inspector is conjured that the investigator never opened.
    expect(result.current.selectedIndex).toBeNull();
    expect(result.current.selectedEvent).toBeNull();
  });

  it('§24 - the original result set comes back intact, and is not re-run', async () => {
    const result = await searchedState();
    const searchesBefore = searchCalls.length;

    await act(async () => result.current.openInspector(0));
    await act(async () => result.current.showContext(result.current.searchResult!.events[0]));
    await settleContext(result);
    await act(async () => result.current.restoreOriginalSearch());

    expect(result.current.searchResult!.events.map((e) => e.message)).toEqual(['first', 'second', 'third']);
    expect(result.current.breadcrumbLabel).toBeNull();
    // Returning restores a snapshot; it must never issue a fresh search.
    expect(searchCalls).toHaveLength(searchesBefore);
  });

  it('§19 - the context root stays identified for the whole detour, and is cleared on return', async () => {
    const result = await searchedState();
    await act(async () => result.current.openInspector(1));
    await act(async () => result.current.showContext(result.current.searchResult!.events[1]));
    await settleContext(result);

    expect(result.current.contextRootIdentity).not.toBeNull();

    await act(async () => result.current.restoreOriginalSearch());
    expect(result.current.contextRootIdentity).toBeNull();
  });

  it('§20 - the context view is ordered ascending: earlier events, then the root, then later', async () => {
    const result = await searchedState();
    await act(async () => result.current.showContext(result.current.searchResult!.events[1]));
    await settleContext(result);

    const times = result.current.searchResult!.events.map((e) => new Date(e.timestamp!).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('§26 - a superseded context response can never overwrite a newer one', async () => {
    const result = await searchedState();

    // Two context requests in flight; the first must lose.
    await act(async () => result.current.showContext(result.current.searchResult!.events[0]));
    await act(async () => result.current.showContext(result.current.searchResult!.events[2]));
    expect(contextCalls.length).toBeGreaterThanOrEqual(2);

    // Resolve the NEWEST first, then the stale one.
    await act(async () => {
      contextCalls[contextCalls.length - 1].resolve(
        jsonResponse({
          events: [event('newest-context', '2026-01-01T00:00:01Z')],
          counts: { returned: 1, total: null, estimated: false, truncated: false },
          nextCursor: null,
          queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
    });
    await act(async () => {
      contextCalls[0].resolve(
        jsonResponse({
          events: [event('STALE-context', '2026-01-01T00:00:09Z')],
          counts: { returned: 1, total: null, estimated: false, truncated: false },
          nextCursor: null,
          queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
    });

    const messages = result.current.searchResult!.events.map((e) => e.message);
    expect(messages).toContain('newest-context');
    expect(messages).not.toContain('STALE-context');
  });

  it('§16 - the detour is one level deep: a second context does not overwrite the true original', async () => {
    const result = await searchedState();
    await act(async () => result.current.showContext(result.current.searchResult!.events[0]));
    await settleContext(result);

    // A second context, launched from inside the first.
    await act(async () => result.current.showContext(result.current.searchResult!.events[0]));
    await settleContext(result);

    await act(async () => result.current.restoreOriginalSearch());
    expect(result.current.searchResult!.events.map((e) => e.message)).toEqual(['first', 'second', 'third']);
  });
});
