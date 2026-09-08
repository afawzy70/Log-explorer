import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSearchState } from './useSearchState';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
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

  beforeEach(() => {
    searchCalls = [];
    contextCalls = [];
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
        nextCursor: null,
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
        nextCursor: null,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events[0].message).toBe('fresh'));

    staleCall.resolve(
      jsonResponse({
        events: [eventWithMessage('stale')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null,
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
        nextCursor: 'cursor-abc',
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
        nextCursor: null,
      }),
    );

    await waitFor(() => expect(result.current.searchResult?.events).toHaveLength(2));
    expect(result.current.searchResult?.events.map((e) => e.message)).toEqual(['page-1', 'page-2']);
  });

  it('loadMore does nothing when there is no nextCursor', async () => {
    const result = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    searchCalls[0].resolve(
      jsonResponse({
        events: [eventWithMessage('only-page')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null,
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
        nextCursor: null,
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

  it('a fresh runSearch clears the inspector selection and any breadcrumb', async () => {
    const result = await searchedWithThreeEvents();
    act(() => result.current.openInspector(0));
    act(() => result.current.findRelated('traceId', 'trace-x'));
    await waitFor(() => expect(searchCalls).toHaveLength(2));
    searchCalls[1].resolve(
      jsonResponse({ events: [], counts: { estimatedTotal: null, returned: 0, visible: 0, limit: 200, truncated: false }, nextCursor: null }),
    );
    await waitFor(() => expect(result.current.breadcrumbLabel).not.toBeNull());

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchCalls).toHaveLength(3));
    expect(result.current.selectedEvent).toBeNull();
    expect(result.current.breadcrumbLabel).toBeNull();
  });

  it('findRelated searches by only the given ID, clears other filters, sets a breadcrumb, and restoreOriginalSearch brings back the prior results', async () => {
    const result = await searchedWithThreeEvents();
    const originalEvents = result.current.searchResult?.events;

    act(() => result.current.findRelated('correlationId', 'corr-123'));
    await waitFor(() => expect(searchCalls).toHaveLength(2));
    expect(searchCalls[1].body).toContain('"correlationId":"corr-123"');
    expect(searchCalls[1].body).toContain('"services":[]');
    expect(searchCalls[1].body).toContain('"levels":[]');

    searchCalls[1].resolve(
      jsonResponse({
        events: [eventWithMessage('related')],
        counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false },
        nextCursor: null,
      }),
    );
    await waitFor(() => expect(result.current.searchResult?.events[0].message).toBe('related'));
    expect(result.current.breadcrumbLabel).toMatch(/correlation id/i);
    expect(result.current.selectedEvent).toBeNull(); // inspector closes on navigating away

    act(() => result.current.restoreOriginalSearch());
    expect(result.current.searchResult?.events).toEqual(originalEvents);
    expect(result.current.breadcrumbLabel).toBeNull();
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
        nextCursor: null,
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
});
