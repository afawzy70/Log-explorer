import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSearchState } from './useSearchState';

/**
 * UX-R6 §21 - stale-response protection for **source-scoped discovery**.
 *
 * This is the regression test for the long-unexplained "environment-
 * specific" Phase-M Task 1 failure. It was never environmental: selecting
 * a source fires `/services` (and `/compose-projects`, and `/health`) for
 * the new source while the *previous* source's request may still be in
 * flight, and none of those three chains had any ordering guarantee. If
 * the older response landed last it simply overwrote the newer one, so the
 * service filter listed one source's services while a different source was
 * selected.
 *
 * It only reproduced where the default `local-docker` source could
 * actually answer - a machine with a running Docker daemon that has
 * containers - which is exactly why CI, which has neither, never saw it.
 *
 * Each test below resolves the responses **out of order on purpose**: the
 * newly-selected source answers first, the previously-selected source
 * answers second. The second answer must lose.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function caps(overrides: Record<string, boolean> = {}) {
  return {
    historicalSearch: true,
    liveTail: false,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: true,
    composeProjectScoping: false,
    ...overrides,
  };
}

const SOURCES = [
  { id: 'local-docker', displayName: 'Local Docker', capabilities: caps({ composeProjectScoping: true }) },
  { id: 'fixture', displayName: 'Fixture', capabilities: caps() },
];

describe('UX-R6 §21 - a stale source-scoped response can never overwrite a newer one', () => {
  let serviceCalls: Array<{ sourceId: string; resolve: (r: Response) => void }>;
  let healthCalls: Array<{ sourceId: string; resolve: (r: Response) => void }>;

  beforeEach(() => {
    serviceCalls = [];
    healthCalls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/v1/sources')) return Promise.resolve(jsonResponse(SOURCES));
        const sourceId = url.match(/\/sources\/([^/?]+)\//)?.[1] ?? '';
        if (url.includes('/services')) {
          return new Promise<Response>((resolve) => serviceCalls.push({ sourceId, resolve }));
        }
        if (url.includes('/health')) {
          return new Promise<Response>((resolve) => healthCalls.push({ sourceId, resolve }));
        }
        if (url.includes('/compose-projects')) {
          return new Promise<Response>(() => {}); // never settles; irrelevant here
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  function serviceCallFor(sourceId: string) {
    const call = serviceCalls.find((c) => c.sourceId === sourceId);
    expect(call, `expected a /services request for ${sourceId}`).toBeDefined();
    return call!;
  }

  it('keeps the newly-selected source\'s services when the previous source answers last', async () => {
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.selectedSourceId).toBe('local-docker'));
    await waitFor(() => expect(serviceCalls.some((c) => c.sourceId === 'local-docker')).toBe(true));

    // The investigator switches to Fixture while Docker is still answering.
    await act(async () => result.current.setSelectedSourceId('fixture'));
    await waitFor(() => expect(serviceCalls.some((c) => c.sourceId === 'fixture')).toBe(true));

    // Fixture answers first...
    await act(async () => {
      serviceCallFor('fixture').resolve(
        jsonResponse([
          { name: 'payments-api', runningCount: 65, totalCount: 65 },
          { name: 'gateway', runningCount: 56, totalCount: 56 },
        ]),
      );
    });
    // ...then the stale Docker response arrives.
    await act(async () => {
      serviceCallFor('local-docker').resolve(
        jsonResponse([
          { name: 'caddy', runningCount: 1, totalCount: 1 },
          { name: 'db', runningCount: 1, totalCount: 1 },
          { name: 'web', runningCount: 1, totalCount: 1 },
        ]),
      );
    });

    // The service filter must describe the source that is actually selected.
    expect(result.current.selectedSourceId).toBe('fixture');
    expect(result.current.services.map((s) => s.name)).toEqual(['payments-api', 'gateway']);
  });

  it('a stale FAILURE cannot blank out the newly-selected source\'s services either', async () => {
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.selectedSourceId).toBe('local-docker'));
    await waitFor(() => expect(serviceCalls.some((c) => c.sourceId === 'local-docker')).toBe(true));

    await act(async () => result.current.setSelectedSourceId('fixture'));
    await waitFor(() => expect(serviceCalls.some((c) => c.sourceId === 'fixture')).toBe(true));

    await act(async () => {
      serviceCallFor('fixture').resolve(jsonResponse([{ name: 'payments-api', runningCount: 65, totalCount: 65 }]));
    });
    // Docker's request fails *after* Fixture already succeeded. The
    // previous `.catch(() => setServices([]))` would have cleared the list.
    await act(async () => {
      serviceCallFor('local-docker').resolve(new Response('boom', { status: 500 }));
    });

    expect(result.current.services.map((s) => s.name)).toEqual(['payments-api']);
  });

  it('a stale health response cannot be painted under the newly-selected source', async () => {
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.selectedSourceId).toBe('local-docker'));
    await waitFor(() => expect(healthCalls.some((c) => c.sourceId === 'local-docker')).toBe(true));

    await act(async () => result.current.setSelectedSourceId('fixture'));
    await waitFor(() => expect(healthCalls.some((c) => c.sourceId === 'fixture')).toBe(true));

    await act(async () => {
      healthCalls
        .find((c) => c.sourceId === 'fixture')!
        .resolve(
          jsonResponse({
            status: 'UP',
            message: 'fixture is healthy',
            checkedAt: '2026-01-01T00:00:00Z',
            warnings: [],
            latencyMs: 1,
            capabilities: null,
          }),
        );
    });
    await act(async () => {
      healthCalls
        .find((c) => c.sourceId === 'local-docker')!
        .resolve(
          jsonResponse({
            status: 'DOWN',
            message: 'docker daemon unreachable',
            checkedAt: '2026-01-01T00:00:00Z',
            warnings: [],
            latencyMs: 9,
            capabilities: null,
          }),
        );
    });

    // Health (and the capabilities it carries) must belong to the selected source.
    expect(result.current.health?.message).toBe('fixture is healthy');
    expect(result.current.health?.status).toBe('UP');
  });
});
