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

  beforeEach(() => {
    searchCalls = [];
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
});
