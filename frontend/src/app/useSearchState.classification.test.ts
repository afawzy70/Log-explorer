import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSearchState } from './useSearchState';
import { EMPTY_QUERY_PLAN } from '../shared/api/testFixtures';
import { sparseEvent } from '../features/inspector/testEventFixture';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
      composeProjectScoping: false,
      originalSchemaSampling: false,
    },
  },
];

describe('useSearchState - classification tag filter and workspace', () => {
  let searchBodies: Array<Record<string, unknown>>;
  let classificationFetches: number;

  beforeEach(() => {
    searchBodies = [];
    classificationFetches = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/v1/sources')) {
          return jsonResponse(SOURCES_RESPONSE);
        }
        if (url.includes('/health')) {
          return jsonResponse({ status: 'UP', message: 'ok', checkedAt: '2026-01-01T00:00:00Z', warnings: [] });
        }
        if (url.includes('/api/v1/settings/field-mapping')) {
          return jsonResponse({ sourceId: 'fixture', scopeLabel: null, fields: [], modifiedFromDefault: false, searchReady: true });
        }
        if (url.endsWith('/api/v1/settings/classification-rules')) {
          classificationFetches += 1;
          return jsonResponse({ tags: ['middleware', 'payments'] });
        }
        if (url.endsWith('/api/v1/logs/search')) {
          searchBodies.push(JSON.parse(String(init?.body)));
          return jsonResponse({
            events: [],
            counts: { estimatedTotal: 0, returned: 0, visible: 0, limit: 100, truncated: false },
            nextCursor: null,
            queryPlan: EMPTY_QUERY_PLAN,
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
    const hook = renderHook(() => useSearchState());
    await waitFor(() => expect(hook.result.current.selectedSourceId).toBe('fixture'));
    return hook;
  }

  it('does not fetch classification rules on startup - only when asked', async () => {
    const { result } = await renderReady();
    expect(classificationFetches).toBe(0);
    expect(result.current.classificationTags).toBeNull();
    act(() => result.current.refreshClassificationTags());
    await waitFor(() => expect(result.current.classificationTags).toEqual(['middleware', 'payments']));
  });

  it('omits tags from the search body when none are selected, and sends selected tags when present', async () => {
    const { result } = await renderReady();

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchBodies).toHaveLength(1));
    expect(searchBodies[0]).not.toHaveProperty('tags');

    act(() => result.current.setSelectedTags(['middleware', 'payments']));
    act(() => result.current.runSearch());
    await waitFor(() => expect(searchBodies).toHaveLength(2));
    expect(searchBodies[1].tags).toEqual(['middleware', 'payments']);
  });

  it('Clear all resets the tag filter, and the tags are never written to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = await renderReady();
    act(() => result.current.setSelectedTags(['middleware']));
    expect(result.current.selectedTags).toEqual(['middleware']);

    act(() => result.current.clearAllFilters());
    expect(result.current.selectedTags).toEqual([]);

    act(() => result.current.runSearch());
    await waitFor(() => expect(searchBodies).toHaveLength(1));
    expect(searchBodies[0]).not.toHaveProperty('tags');
    for (const call of setItem.mock.calls) {
      expect(String(call[1])).not.toContain('middleware');
    }
  });

  it('opening the classification workspace closes the mapping workspace and vice versa; the source event is held in state', async () => {
    const { result } = await renderReady();
    const event = sparseEvent({ message: 'MW call /accounts' });

    act(() => result.current.openMappingWorkspace());
    expect(result.current.mappingWorkspaceOpen).toBe(true);

    act(() => result.current.openClassificationRuleFromEvent(event));
    expect(result.current.classificationWorkspaceOpen).toBe(true);
    expect(result.current.classificationWorkspaceEvent).toBe(event);
    expect(result.current.mappingWorkspaceOpen).toBe(false);
    expect(window.location.href).not.toContain('accounts');

    act(() => result.current.openMappingWorkspace());
    expect(result.current.mappingWorkspaceOpen).toBe(true);
    expect(result.current.classificationWorkspaceOpen).toBe(false);
    expect(result.current.classificationWorkspaceEvent).toBeNull();

    act(() => result.current.openClassificationWorkspace());
    expect(result.current.classificationWorkspaceOpen).toBe(true);
    expect(result.current.classificationWorkspaceEvent).toBeNull();
    act(() => result.current.closeClassificationWorkspace());
    expect(result.current.classificationWorkspaceOpen).toBe(false);
  });

  it('builds the detect/test sample scope from the selected source, services, levels and the committed time range', async () => {
    const { result } = await renderReady();
    act(() => result.current.setSelectedServices(['gateway']));
    act(() => result.current.setServiceFilterMode('EXCLUDE'));
    act(() => result.current.setSelectedLevels(['ERROR']));
    act(() =>
      result.current.setTimeRange({ presetId: 'custom', start: '2026-01-01T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' }),
    );
    expect(result.current.buildClassificationSampleScope()).toEqual({
      sourceId: 'fixture',
      composeProject: null,
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-02T00:00:00.000Z',
      services: ['gateway'],
      serviceFilterMode: 'EXCLUDE',
      levels: ['ERROR'],
    });
  });
});
