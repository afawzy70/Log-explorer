import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSearchState } from './useSearchState';

/**
 * Owner decision (PR #59 pre-merge, `features/search/sourcePolicy.ts`):
 * the active source is chosen by an explicit policy (Docker, then OpenShift,
 * then any other selectable source) - never API order - and OpenShift Loki
 * can never become the active source, so no health/service/search request is
 * ever made for it as the active source.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const CAPS = {
  historicalSearch: true,
  liveTail: false,
  rawLogQL: false,
  serviceDiscovery: true,
  queryStatistics: false,
  contextView: true,
  composeProjectScoping: false,
  originalSchemaSampling: true,
};

const LOKI = { id: 'openshift-loki', displayName: 'OpenShift Loki', capabilities: { ...CAPS, serviceDiscovery: false } };
const OPENSHIFT = { id: 'openshift', displayName: 'OpenShift', capabilities: { ...CAPS, serviceDiscovery: false } };
const FIXTURE = { id: 'fixture', displayName: 'Fixture (dev/test only)', capabilities: CAPS };
const DOCKER = { id: 'local-docker', displayName: 'Local Docker', capabilities: CAPS };

describe('useSearchState - source selector policy', () => {
  let sources: unknown[];
  let requestedUrls: string[];

  beforeEach(() => {
    requestedUrls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        requestedUrls.push(url);
        if (url.endsWith('/api/v1/sources')) return Promise.resolve(jsonResponse(sources));
        if (url.includes('/health')) {
          return Promise.resolve(jsonResponse({ status: 'UP', message: null, checkedAt: new Date().toISOString(), warnings: [], latencyMs: 1, capabilities: CAPS }));
        }
        if (url.includes('/services') || url.includes('/compose-projects')) return Promise.resolve(jsonResponse([]));
        return new Promise<Response>(() => {});
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  function lokiRequests() {
    return requestedUrls.filter((url) => url.includes('/sources/openshift-loki'));
  }

  it('selects Docker by default even when the API lists Loki first (fallback picks Docker)', async () => {
    sources = [LOKI, OPENSHIFT, FIXTURE, DOCKER];
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.sourcesLoading).toBe(false));
    expect(result.current.selectedSourceId).toBe('local-docker');
    await waitFor(() => expect(requestedUrls.some((url) => url.includes('/sources/local-docker/health'))).toBe(true));
    expect(lokiRequests()).toEqual([]);
  });

  it('falls back to OpenShift when Docker is not available, never Loki', async () => {
    sources = [LOKI, FIXTURE, OPENSHIFT];
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.sourcesLoading).toBe(false));
    expect(result.current.selectedSourceId).toBe('openshift');
    expect(lokiRequests()).toEqual([]);
  });

  it('falls back to the dev/test Fixture source when it is the only selectable source', async () => {
    sources = [LOKI, FIXTURE];
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.sourcesLoading).toBe(false));
    expect(result.current.selectedSourceId).toBe('fixture');
  });

  it('keeps a truthful no-source state (no crash, no Loki request) when only Loki is listed', async () => {
    sources = [LOKI];
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.sourcesLoading).toBe(false));
    expect(result.current.selectedSourceId).toBeNull();
    expect(result.current.sources.map((s) => s.id)).toEqual(['openshift-loki']);
    expect(lokiRequests()).toEqual([]);
  });

  it('ignores a stale or malformed attempt to make Loki the active source, and never contacts Loki', async () => {
    sources = [LOKI, OPENSHIFT, DOCKER, FIXTURE];
    const { result } = renderHook(() => useSearchState());
    await waitFor(() => expect(result.current.selectedSourceId).toBe('local-docker'));

    await act(async () => result.current.setSelectedSourceId('openshift-loki'));
    expect(result.current.selectedSourceId).toBe('local-docker');

    // A regular source switch still works (no source-switch regression)...
    await act(async () => result.current.setSelectedSourceId('fixture'));
    expect(result.current.selectedSourceId).toBe('fixture');
    await waitFor(() => expect(requestedUrls.some((url) => url.includes('/sources/fixture/health'))).toBe(true));
    await act(async () => result.current.setSelectedSourceId('openshift'));
    expect(result.current.selectedSourceId).toBe('openshift');

    // ...and a later stale Loki selection is still refused.
    await act(async () => result.current.setSelectedSourceId('openshift-loki'));
    expect(result.current.selectedSourceId).toBe('openshift');
    expect(lokiRequests()).toEqual([]);
  });
});
