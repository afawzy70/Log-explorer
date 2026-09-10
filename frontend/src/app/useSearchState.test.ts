import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { eventIdentity, useSearchState } from './useSearchState';
import { EMPTY_QUERY_PLAN } from '../shared/api/testFixtures';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function eventWithMessageAndTimestamp(message: string, timestamp: string) {
  return { ...eventWithMessage(message), timestamp };
}

function eventWithMessage(message: string) {
  return {
    timestamp: '2026-01-01T00:00:00Z',
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

describe('useSearchState', () => {
  let searchCalls: Array<{ body: string; resolve: (r: Response) => void; reject: (e: unknown) => void }>;
  let contextCalls: Array<{ body: string; resolve: (r: Response) => void; reject: (e: unknown) => void }>;
  let journeyCalls: Array<{ body: string; resolve: (r: Response) => void; reject: (e: unknown) => void }>;

  beforeEach(() => {
    searchCalls = [];
    contextCalls = [];
    journeyCalls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/v1/sources')) {
          return Promise.resolve(jsonResponse(SOURCES_RESPONSE));
        }
        if (url.includes('/health')) {
          return Promise.resolve(jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z' }));
        }
        if (url.includes('/services')) {
          return Promise.resolve(jsonResponse([]));
        }
        if (url.endsWith('/api/v1/logs/search')) {
          return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            searchCalls.push({ body: String(init?.body), resolve, reject });
          });
        }
        if (url.endsWith('/api/v1/logs/context')) {
          return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            contextCalls.push({ body: String(init?.body), resolve, reject });
          });
        }
        if (url.endsWith('/api/v1/logs/journey')) {
          return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            journeyCalls.push({ body: String(init?.body), resolve, reject });
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderReady() {
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.selectedSourceId).toBe('fixture'));
    return result;
  }

  it('a fresh search replaces the result set', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('first')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );

    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(1));
    expect(result.current.searchResult?.events[0].message).toBe('first');
  });

  it('starting a new search aborts a still-in-flight older one, so the stale response never overwrites the fresh one', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    const staleCall = searchCalls[0];

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(2));
    const freshCall = searchCalls[1];

    // Resolve the fresh one first, then let the stale one resolve late -
    // its abort signal should already have fired, so it must never win.
    freshCall.resolve(
      jsonResponse({
        events: [eventWithMessage('fresh')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events[0].message).toBe('fresh'));

    staleCall.resolve(
      jsonResponse({
        events: [eventWithMessage('stale')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    // Give any (incorrect) stale update a chance to land, then assert it didn't.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.searchResult?.events[0].message).toBe('fresh');
    expect(result.current.searchError).toBeNull();
  });

  it('loadMore appends the next page to the existing results using the real nextCursor, not a fresh replace', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('page-1')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true },
        nextCursor: 'cursor-abc', queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(1));

    act(() => result.current.loadMore());
    await waitFor(() => expect(searchCalls).toHaveLength(2));
    expect(searchCalls[1].body).toContain('cursor-abc');
    searchCalls[1].resolve(
      jsonResponse({
        events: [eventWithMessage('page-2')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );

    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(2));
    expect(result.current.searchResult?.events.map((e) => e.message)).toEqual(['page-1', 'page-2']);
  });

  it('loadMore dedupes defensively when the server response overlaps an already-shown event', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('page-1')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true },
        nextCursor: 'cursor-abc', queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(1));

    act(() => result.current.loadMore());
    await waitFor(() => expect(searchCalls).toHaveLength(2));
    searchCalls[1].resolve(
      jsonResponse({
        // "page-1" reappears (a defensive belt-and-suspenders case even
        // though the backend's own boundary-safe cursor should prevent
        // this) alongside one genuinely new event.
        events: [eventWithMessage('page-1'), eventWithMessage('page-2')],
        counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 2, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );

    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(2));
    expect(result.current.searchResult?.events.map((e) => e.message)).toEqual(['page-1', 'page-2']);
  });

  it('a loadMore failure sets loadMoreError (not searchError) and keeps the already-loaded results visible; retry via loadMore again succeeds', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('page-1')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true },
        nextCursor: 'cursor-abc', queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(1));

    act(() => result.current.loadMore());
    await waitFor(() => expect(searchCalls).toHaveLength(2));
    searchCalls[1].resolve(new Response('{"status":500,"detail":"page load boom"}', { status: 500 }));

    await waitFor(() => expect(result.current.loadMoreError).not.toBeNull());
    expect(result.current.searchError).toBeNull();
    // Already-loaded results are untouched by the failed page load.
    expect(result.current.searchResult?.events).toHaveLength(1);
    expect(result.current.searchResult?.events[0].message).toBe('page-1');
    expect(result.current.searchResult?.nextCursor).toBe('cursor-abc');

    act(() => result.current.loadMore());
    await waitFor(() => expect(searchCalls).toHaveLength(3));
    expect(searchCalls[2].body).toContain('cursor-abc');
    searchCalls[2].resolve(
      jsonResponse({
        events: [eventWithMessage('page-2')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );

    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(2));
    expect(result.current.loadMoreError).toBeNull();
  });

  it('opening the inspector before loadMore preserves the selection after the next page is appended', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('page-1')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true },
        nextCursor: 'cursor-abc', queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(1));

    act(() => result.current.openInspector(0));
    expect(result.current.selectedEvent?.message).toBe('page-1');

    act(() => result.current.loadMore());
    await waitFor(() => expect(searchCalls).toHaveLength(2));
    searchCalls[1].resolve(
      jsonResponse({
        events: [eventWithMessage('page-2')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );

    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(2));
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.selectedEvent?.message).toBe('page-1');
  });

  it('refresh re-runs the exact committed search from page 1, using committed filters rather than any un-applied draft', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('page-1')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true },
        nextCursor: 'cursor-abc', queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(1));

    act(() => result.current.loadMore());
    await waitFor(() => expect(searchCalls).toHaveLength(2));
    searchCalls[1].resolve(
      jsonResponse({
        events: [eventWithMessage('page-2')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(2));

    act(() => result.current.refresh());
    await waitFor(() => expect(searchCalls).toHaveLength(3));
    // Refresh's own request never carries a cursor forward - it's a page-1 request.
    expect(searchCalls[2].body).not.toContain('cursor-abc');
    searchCalls[2].resolve(
      jsonResponse({
        events: [eventWithMessage('page-1')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true },
        nextCursor: 'cursor-def', queryPlan: EMPTY_QUERY_PLAN,
      }),
    );

    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(1));
    expect(result.current.searchResult?.events[0].message).toBe('page-1');
    expect(result.current.searchResult?.nextCursor).toBe('cursor-def');
  });

  it('loadMore does nothing when there is no nextCursor', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('only-page')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(1));

    act(() => result.current.loadMore());
    await new Promise((r) => setTimeout(r, 20));
    expect(searchCalls).toHaveLength(1);
  });

  it('a genuine search failure (not a supersession) sets searchError', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(new Response('{"status":500,"detail":"boom"}', { status: 500 }));

    await waitFor(() => expect(result.current.searchError).not.toBeNull());
  });

  async function searchedWithThreeEvents() {
    const result = await renderReady();
    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('one'), eventWithMessage('two'), eventWithMessage('three')],
        counts: { estimatedTotal: null, returned: 3, visible: 3, limit: 200, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(3));
    return result;
  }

  it('openInspector selects an event by index; Previous/Next move within loaded events and stop at the bounds', async () => {
    const result = await searchedWithThreeEvents();

    act(() => result.current.openInspector(1));
    expect(result.current.selectedEvent?.message).toBe('two');
    expect(result.current.hasPreviousEvent).toBe(true);
    expect(result.current.hasNextEvent).toBe(true);

    act(() => result.current.selectPreviousEvent());
    expect(result.current.selectedEvent?.message).toBe('one');
    expect(result.current.hasPreviousEvent).toBe(false);

    act(() => result.current.selectPreviousEvent());
    expect(result.current.selectedEvent?.message).toBe('one'); // already at the start - stays put

    act(() => result.current.selectNextEvent());
    act(() => result.current.selectNextEvent());
    expect(result.current.selectedEvent?.message).toBe('three');
    expect(result.current.hasNextEvent).toBe(false);

    act(() => result.current.selectNextEvent());
    expect(result.current.selectedEvent?.message).toBe('three'); // already at the end - stays put
  });

  it('closeInspector clears the selection', async () => {
    const result = await searchedWithThreeEvents();
    act(() => result.current.openInspector(0));
    expect(result.current.selectedEvent).not.toBeNull();

    act(() => result.current.closeInspector());
    expect(result.current.selectedEvent).toBeNull();
  });

  it('a fresh runSearch clears the inspector selection and closes journey mode', async () => {
    const result = await searchedWithThreeEvents();
    act(() => result.current.openInspector(0));
    act(() => result.current.openJourney('traceId', 'trace-x'));
    await waitFor(() => expect(journeyCalls).toHaveLength(1));
    expect(result.current.journeyQuery).not.toBeNull();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(2));
    expect(result.current.selectedEvent).toBeNull();
    expect(result.current.journeyQuery).toBeNull();
  });

  it('openJourney calls the dedicated /journey endpoint (never /search) with only the given ID over the current time range, and never touches searchResult', async () => {
    const result = await searchedWithThreeEvents();
    const originalEvents = result.current.searchResult?.events;
    const originalTimeRange = result.current.timeRange;

    act(() => result.current.openJourney('correlationId', 'corr-123'));
    await waitFor(() => expect(journeyCalls).toHaveLength(1));
    expect(searchCalls).toHaveLength(1); // unchanged - journey lookups never go through /search
    expect(journeyCalls[0].body).toContain('"field":"correlationId"');
    expect(journeyCalls[0].body).toContain('"value":"corr-123"');
    expect(journeyCalls[0].body).toContain(`"start":"${originalTimeRange.start}"`);
    expect(journeyCalls[0].body).toContain(`"end":"${originalTimeRange.end}"`);
    expect(result.current.journeyQuery).toEqual({ field: 'correlationId', value: 'corr-123' });
    expect(result.current.journeyLoading).toBe(true);

    journeyCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('related')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.journeyResult?.events[0].message).toBe('related'));
    expect(result.current.journeyLoading).toBe(false);
    // The underlying search/toolbar state is completely untouched.
    expect(result.current.searchResult?.events).toEqual(originalEvents);
    expect(result.current.timeRange).toEqual(originalTimeRange);

    act(() => result.current.closeJourney());
    expect(result.current.journeyQuery).toBeNull();
    expect(result.current.journeyResult).toBeNull();
    expect(result.current.searchResult?.events).toEqual(originalEvents);
  });

  it('openJourney closes the inspector first, so the two never render at once', async () => {
    const result = await searchedWithThreeEvents();
    act(() => result.current.openInspector(0));
    expect(result.current.selectedEvent).not.toBeNull();

    act(() => result.current.openJourney('journeyId', 'journey-1'));
    expect(result.current.selectedEvent).toBeNull();
  });

  it('openJourney does nothing for an empty value', async () => {
    const result = await searchedWithThreeEvents();
    act(() => result.current.openJourney('traceId', ''));
    await new Promise((r) => setTimeout(r, 20));
    expect(journeyCalls).toHaveLength(0);
    expect(result.current.journeyQuery).toBeNull();
  });

  it('showContext calls the dedicated /context endpoint (never /search) and narrows the time range', async () => {
    const result = await searchedWithThreeEvents();
    const event = result.current.searchResult!.events[0];

    act(() => result.current.showContext(event));
    await waitFor(() => expect(contextCalls).toHaveLength(1));
    expect(searchCalls).toHaveLength(1); // unchanged - context never goes through /search
    expect(contextCalls[0].body).toContain(`"timestamp":"${event.timestamp}"`);

    contextCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('surrounding')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events[0].message).toBe('surrounding'));
    expect(result.current.breadcrumbLabel).toMatch(/context/i);
    expect(new Date(result.current.timeRange.end).getTime() - new Date(result.current.timeRange.start).getTime()).toBe(60_000);
  });

  it('showContext does nothing for an event with no timestamp', async () => {
    const result = await searchedWithThreeEvents();
    act(() => result.current.showContext({ ...result.current.searchResult!.events[0], timestamp: null }));
    await new Promise((r) => setTimeout(r, 20));
    expect(contextCalls).toHaveLength(0);
  });

  describe('Context ordering (UI Gap Closure Pass)', () => {
    it('sorts the resulting context events chronologically ascending (oldest first), regardless of the order the server returned them in', async () => {
      const result = await searchedWithThreeEvents();
      const rootEvent = result.current.searchResult!.events[0];

      act(() => result.current.showContext(rootEvent));
      await waitFor(() => expect(contextCalls).toHaveLength(1));
      contextCalls[0].resolve(
        jsonResponse({
          events: [
            eventWithMessageAndTimestamp('third', '2026-01-01T12:00:20Z'),
            eventWithMessageAndTimestamp('first', '2026-01-01T12:00:00Z'),
            eventWithMessageAndTimestamp('second', '2026-01-01T12:00:10Z'),
          ],
          counts: { estimatedTotal: null, returned: 3, visible: 3, limit: 200, truncated: false },
          nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
        }),
      );

      await waitFor(() => expect(result.current.searchResult?.events[0]?.message).toBe('first'));
      expect(result.current.searchResult?.events.map((e) => e.message)).toEqual(['first', 'second', 'third']);
    });

    it('puts events with a missing/unparseable timestamp last, stably, rather than crashing or producing NaN order', async () => {
      const result = await searchedWithThreeEvents();
      const rootEvent = result.current.searchResult!.events[0];

      act(() => result.current.showContext(rootEvent));
      await waitFor(() => expect(contextCalls).toHaveLength(1));
      contextCalls[0].resolve(
        jsonResponse({
          events: [
            { ...eventWithMessageAndTimestamp('no-timestamp', '2026-01-01T12:00:05Z'), timestamp: null },
            eventWithMessageAndTimestamp('later', '2026-01-01T12:00:10Z'),
            eventWithMessageAndTimestamp('earlier', '2026-01-01T12:00:00Z'),
          ],
          counts: { estimatedTotal: null, returned: 3, visible: 3, limit: 200, truncated: false },
          nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
        }),
      );

      await waitFor(() => expect(result.current.searchResult?.events[0]?.message).toBe('earlier'));
      expect(result.current.searchResult?.events.map((e) => e.message)).toEqual(['earlier', 'later', 'no-timestamp']);
    });

    it('captures the clicked event\'s identity as contextRootIdentity, for the table to mark it - independent of selectedIndex/inspector state', async () => {
      const result = await searchedWithThreeEvents();
      const rootEvent = result.current.searchResult!.events[0];
      expect(result.current.contextRootIdentity).toBeNull();

      act(() => result.current.showContext(rootEvent));
      expect(result.current.contextRootIdentity).toBe(eventIdentity(rootEvent));
      expect(result.current.selectedEvent).toBeNull(); // the inspector is closed, not auto-opened on the root event

      await waitFor(() => expect(contextCalls).toHaveLength(1));
      contextCalls[0].resolve(
        jsonResponse({
          events: [eventWithMessage('surrounding')],
          counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
          nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
      await waitFor(() => expect(result.current.searchResult?.events[0].message).toBe('surrounding'));
      // The root identity survives the fetch resolving - it's independent of the result contents.
      expect(result.current.contextRootIdentity).toBe(eventIdentity(rootEvent));
    });

    it('a fresh runSearch clears contextRootIdentity', async () => {
      const result = await searchedWithThreeEvents();
      const rootEvent = result.current.searchResult!.events[0];
      act(() => result.current.showContext(rootEvent));
      expect(result.current.contextRootIdentity).not.toBeNull();

      act(() => result.current.runSearch());
      expect(result.current.contextRootIdentity).toBeNull();
    });

    it('restoreOriginalSearch clears contextRootIdentity and restores the pristine, never-sorted original result', async () => {
      const result = await searchedWithThreeEvents();
      const originalOrder = result.current.searchResult!.events.map((e) => e.message);
      const rootEvent = result.current.searchResult!.events[0];

      act(() => result.current.showContext(rootEvent));
      await waitFor(() => expect(contextCalls).toHaveLength(1));
      contextCalls[0].resolve(
        jsonResponse({
          events: [eventWithMessageAndTimestamp('b', '2026-01-01T12:00:10Z'), eventWithMessageAndTimestamp('a', '2026-01-01T12:00:00Z')],
          counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 200, truncated: false },
          nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
      await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(2));

      act(() => result.current.restoreOriginalSearch());
      expect(result.current.contextRootIdentity).toBeNull();
      expect(result.current.searchResult?.events.map((e) => e.message)).toEqual(originalOrder);
    });

    it('loadMore on a context view re-sorts the whole accumulated (still-bounded) set ascending again, never trusting append order alone', async () => {
      const result = await searchedWithThreeEvents();
      const rootEvent = result.current.searchResult!.events[0];

      act(() => result.current.showContext(rootEvent));
      await waitFor(() => expect(contextCalls).toHaveLength(1));
      contextCalls[0].resolve(
        jsonResponse({
          events: [eventWithMessageAndTimestamp('b', '2026-01-01T12:00:10Z'), eventWithMessageAndTimestamp('a', '2026-01-01T12:00:00Z')],
          counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 1, truncated: true },
          nextCursor: 'context-cursor-1', queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
      await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(2));
      expect(result.current.searchResult?.events.map((e) => e.message)).toEqual(['a', 'b']);

      // "Load more" on a context view goes through the general /search
      // endpoint (buildRequestBody, scoped to the now-committed context
      // window/service - see showContext's own comment), appending a page
      // whose own order must not be trusted.
      act(() => result.current.loadMore());
      // searchCalls[0] was already consumed by searchedWithThreeEvents() above -
      // "load more" on a context view goes through /search, so this is its 2nd call.
      await waitFor(() => expect(searchCalls).toHaveLength(2));
      searchCalls[1].resolve(
        jsonResponse({
          events: [eventWithMessageAndTimestamp('d', '2026-01-01T12:00:25Z'), eventWithMessageAndTimestamp('c', '2026-01-01T12:00:20Z')],
          counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 1, truncated: false },
          nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
        }),
      );

      await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(4));
      expect(result.current.searchResult?.events.map((e) => e.message)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('loadMore on an ordinary (non-context) search still preserves exact append order - never reordered', async () => {
      const result = await renderReady();
      act(() => result.current.runSearch());
      await waitFor(() => expect(searchCalls).toHaveLength(1));
      searchCalls[0].resolve(
        jsonResponse({
          events: [eventWithMessageAndTimestamp('newer', '2026-01-01T12:00:10Z')],
          counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true },
          nextCursor: 'cursor-1', queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
      await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(1));
      expect(result.current.breadcrumbLabel).toBeNull(); // an ordinary search, not a context view

      act(() => result.current.loadMore());
      await waitFor(() => expect(searchCalls).toHaveLength(2));
      searchCalls[1].resolve(
        jsonResponse({
          events: [eventWithMessageAndTimestamp('older', '2026-01-01T12:00:00Z')],
          counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: false },
          nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
        }),
      );

      await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(2));
      // Append order preserved exactly (newer page-1, then older page-2) -
      // never re-sorted to chronological ascending, unlike a context view.
      expect(result.current.searchResult?.events.map((e) => e.message)).toEqual(['newer', 'older']);
    });
  });

  describe('query authoring (Legacy Remediation Slice 2)', () => {
    it('applyQuery composes the committed query into the next search request, alongside every other filter', async () => {
      const result = await renderReady();

      act(() =>
        result.current.applyQuery({
          mode: 'text',
          text: 'service = "gateway"',
          tree: { kind: 'group', id: 'root', combinator: 'AND', children: [] },
          rawLogQl: '',
        }),
      );
      act(() => result.current.runSearch());

      await waitFor(() => expect(searchCalls).toHaveLength(1));
      expect(searchCalls[0].body).toContain('"query":"service = \\"gateway\\""');
      expect(searchCalls[0].body).not.toContain('"rawLogQl"');
    });

    it('a raw-LogQL query sends rawLogQl, never query, in the request body', async () => {
      const result = await renderReady();

      act(() =>
        result.current.applyQuery({
          mode: 'rawLogQl',
          rawLogQl: '{namespace="prod"}',
          text: '',
          tree: { kind: 'group', id: 'root', combinator: 'AND', children: [] },
        }),
      );
      act(() => result.current.runSearch());

      await waitFor(() => expect(searchCalls).toHaveLength(1));
      expect(searchCalls[0].body).toContain('"rawLogQl":"{namespace=\\"prod\\"}"');
      expect(searchCalls[0].body).not.toContain('"query"');
    });

    it('an empty (never-applied) query state sends neither query nor rawLogQl', async () => {
      const result = await renderReady();
      act(() => result.current.runSearch());
      await waitFor(() => expect(searchCalls).toHaveLength(1));
      expect(searchCalls[0].body).not.toContain('"query"');
      expect(searchCalls[0].body).not.toContain('"rawLogQl"');
    });

    it('"show context" (a detour) preserves the committed query, and "back to original search" restores it', async () => {
      const result = await searchedWithThreeEvents();
      const applied = {
        mode: 'text' as const,
        text: 'level = "ERROR"',
        tree: { kind: 'group' as const, id: 'root', combinator: 'AND' as const, children: [] },
        rawLogQl: '',
      };
      act(() => result.current.applyQuery(applied));

      const event = result.current.searchResult!.events[0];
      act(() => result.current.showContext(event));
      await waitFor(() => expect(contextCalls).toHaveLength(1));
      contextCalls[0].resolve(
        jsonResponse({
          events: [eventWithMessage('surrounding')],
          counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
          nextCursor: null, queryPlan: EMPTY_QUERY_PLAN,
        }),
      );
      await waitFor(() => expect(result.current.searchResult?.events[0].message).toBe('surrounding'));
      // The query text itself is not sent to /context (it has no such
      // field) - but the committed queryState must still be intact.
      expect(result.current.queryState).toEqual(applied);

      act(() => result.current.restoreOriginalSearch());
      expect(result.current.queryState).toEqual(applied);
    });

    it('selecting a source without rawLogQL capability defensively switches an active raw-LogQL mode back to guided, without discarding the typed text', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.endsWith('/api/v1/sources')) {
            return Promise.resolve(
              jsonResponse([
                SOURCES_RESPONSE[0],
                { id: 'no-raw-logql', displayName: 'No Raw LogQL', capabilities: { ...SOURCES_RESPONSE[0].capabilities, rawLogQL: false } },
              ]),
            );
          }
          if (url.includes('/health')) {
            return Promise.resolve(jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z' }));
          }
          if (url.includes('/services')) {
            return Promise.resolve(jsonResponse([]));
          }
          throw new Error(`Unexpected fetch in this test: ${url}`);
        }),
      );
      const result = await renderReady();
      act(() =>
        result.current.applyQuery({
          mode: 'rawLogQl',
          rawLogQl: '{namespace="prod"}',
          text: '',
          tree: { kind: 'group', id: 'root', combinator: 'AND', children: [] },
        }),
      );
      expect(result.current.queryState.mode).toBe('rawLogQl');

      act(() => result.current.setSelectedSourceId('no-raw-logql'));
      await waitFor(() => expect(result.current.selectedSourceId).toBe('no-raw-logql'));

      expect(result.current.queryState.mode).toBe('guided');
      expect(result.current.queryState.rawLogQl).toBe('{namespace="prod"}');
    });
  });

  describe('clearAllFilters (UX-R1 §4 - "Clear all")', () => {
    it('clears search text, services, severity, advanced filters and the query, but leaves the selected source untouched', async () => {
      const result = await renderReady();
      const originalSourceId = result.current.selectedSourceId;

      act(() => result.current.setSearchText('timeout'));
      act(() => result.current.setSelectedServices(['payments']));
      act(() => result.current.setSelectedLevels(['ERROR']));
      act(() => result.current.applyAdvancedFilters({ text: 'timeout', traceId: 'trace-1', userName: '', customerId: '', cif: '', deviceId: '', deviceIp: '', spanId: '', correlationId: '', journeyId: '', eventId: '', errorCode: '', businessStep: '', uiIdentifier: '', loggerContains: '', devicePlatform: '', language: '' }));
      act(() =>
        result.current.applyQuery({
          mode: 'text',
          text: 'service = "gateway"',
          tree: { kind: 'group', id: 'root', combinator: 'AND', children: [] },
          rawLogQl: '',
        }),
      );

      act(() => result.current.clearAllFilters());

      expect(result.current.searchText).toBe('');
      expect(result.current.selectedServices).toEqual([]);
      expect(result.current.selectedLevels).toEqual(['INFO', 'WARN', 'ERROR']);
      expect(result.current.advancedFilters.traceId).toBe('');
      expect(result.current.queryState.mode).toBe('guided');
      expect(result.current.queryState.text).toBe('');
      // Source/environment scope, per the mission's explicit distinction,
      // is never touched by Clear all - only investigation criteria is.
      expect(result.current.selectedSourceId).toBe(originalSourceId);
    });

    it('resets the time range to a fresh default rather than leaving a stale committed range', async () => {
      const result = await renderReady();
      const staleRange = { presetId: 'custom', start: '2020-01-01T00:00:00Z', end: '2020-01-01T01:00:00Z' };
      act(() => result.current.setTimeRange(staleRange));
      expect(result.current.timeRange).toEqual(staleRange);

      act(() => result.current.clearAllFilters());
      expect(result.current.timeRange).not.toEqual(staleRange);
    });
  });

  describe('runSearch(timeRangeOverride) - "Search last 1 day" bug fix', () => {
    it('a search fired with an override range uses that range on the wire immediately, not the still-stale committed one', async () => {
      const result = await renderReady();
      const overrideRange = {
        presetId: 'last-1-day',
        start: '2026-03-01T00:00:00.000Z',
        end: '2026-03-02T00:00:00.000Z',
      };

      // `setTimeRange` and `runSearch(overrideRange)` fire back-to-back, in
      // the same tick, exactly like `ResultsPanel`'s "Search last 1 day"
      // button - the committed-state update from `setTimeRange` has not
      // necessarily been applied yet when `runSearch` builds its request,
      // so the request must come from the explicit override, never from
      // whatever `timeRange` closure `runSearch` still has.
      act(() => {
        result.current.setTimeRange(overrideRange);
        result.current.runSearch(overrideRange);
      });

      await waitFor(() => expect(searchCalls).toHaveLength(1));
      expect(searchCalls[0].body).toContain('"start":"2026-03-01T00:00:00.000Z"');
      expect(searchCalls[0].body).toContain('"end":"2026-03-02T00:00:00.000Z"');
    });

    it('runSearch() with no override still uses the current committed timeRange, unchanged from before', async () => {
      const result = await renderReady();
      act(() => result.current.runSearch());
      await waitFor(() => expect(searchCalls).toHaveLength(1));
      expect(searchCalls[0].body).toContain(`"start":"${result.current.timeRange.start}"`);
      expect(searchCalls[0].body).toContain(`"end":"${result.current.timeRange.end}"`);
    });
  });
});
