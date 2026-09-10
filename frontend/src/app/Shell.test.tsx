import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Shell } from './Shell';
import type { SearchState } from './useSearchState';
import { emptyAdvancedFilterValues } from '../features/search/advancedFilterFields';
import { emptyQueryAuthoringState } from '../features/search/QueryBuilder';
import { DEFAULT_SEVERITY_LEVELS } from '../features/search/severityLevels';
import { DEFAULT_PRESET_ID } from '../shared/time/presets';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function baseState(overrides: Partial<SearchState> = {}): SearchState {
  const caps = {
    historicalSearch: true,
    liveTail: false,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: false,
    composeProjectScoping: false,
  };
  return {
    sources: [{ id: 'fixture', displayName: 'Fixture', capabilities: caps }],
    sourcesLoading: false,
    selectedSource: { id: 'fixture', displayName: 'Fixture', capabilities: caps },
    selectedSourceId: 'fixture',
    setSelectedSourceId: vi.fn(),
    services: [],
    selectedServices: [],
    setSelectedServices: vi.fn(),
    selectedComposeProject: null,
    setSelectedComposeProject: vi.fn(),
    composeProjects: [],
    composeProjectsLoading: false,
    composeProjectsError: null,
    selectedLevels: DEFAULT_SEVERITY_LEVELS,
    setSelectedLevels: vi.fn(),
    searchText: '',
    setSearchText: vi.fn(),
    timeRange: { presetId: DEFAULT_PRESET_ID, start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
    setTimeRange: vi.fn(),
    sortDirection: 'BACKWARD' as const,
    setSortDirection: vi.fn(),
    advancedFilters: emptyAdvancedFilterValues(),
    applyAdvancedFilters: vi.fn(),
    queryState: emptyQueryAuthoringState(),
    applyQuery: vi.fn(),
    applyDetectedField: vi.fn(),
    clearAllFilters: vi.fn(),
    health: null,
    healthLoading: false,
    retryHealth: vi.fn(),
    searchResult: null,
    searchLoading: false,
    loadingMore: false,
    searchError: null,
    loadMoreError: null,
    lastSearchedRange: null,
    runSearch: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    selectedIndex: null,
    selectedEvent: null,
    hasPreviousEvent: false,
    hasNextEvent: false,
    openInspector: vi.fn(),
    closeInspector: vi.fn(),
    selectPreviousEvent: vi.fn(),
    selectNextEvent: vi.fn(),
    breadcrumbLabel: null,
    contextRootIdentity: null,
    restoreOriginalSearch: vi.fn(),
    showContext: vi.fn(),
    journeyQuery: null,
    journeyResult: null,
    journeyLoading: false,
    journeyError: null,
    openJourney: vi.fn(),
    closeJourney: vi.fn(),
    ...overrides,
  };
}

describe('Shell - active Compose scope visibility (UX-R3 §12)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows only the source name when the active source has no real Compose-project concept', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}))));
    render(<Shell state={baseState()} />);
    expect(screen.getByText('Fixture')).toBeInTheDocument();
    expect(screen.queryByText('›')).not.toBeInTheDocument();
  });

  it('shows only the source name (no project chip) when the source supports project scoping but none is selected - "All projects" adds nothing new', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}))));
    const caps = {
      historicalSearch: true,
      liveTail: false,
      rawLogQL: false,
      serviceDiscovery: true,
      queryStatistics: false,
      contextView: false,
      composeProjectScoping: true,
    };
    render(
      <Shell
        state={baseState({
          selectedSource: { id: 'local-docker', displayName: 'Local Docker', capabilities: caps },
          selectedComposeProject: null,
        })}
      />,
    );
    expect(screen.getByText('Local Docker')).toBeInTheDocument();
    expect(screen.queryByText('project-a')).not.toBeInTheDocument();
  });

  it('shows the selected Compose project alongside the source name when one is selected', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}))));
    const caps = {
      historicalSearch: true,
      liveTail: false,
      rawLogQL: false,
      serviceDiscovery: true,
      queryStatistics: false,
      contextView: false,
      composeProjectScoping: true,
    };
    render(
      <Shell
        state={baseState({
          selectedSource: { id: 'local-docker', displayName: 'Local Docker', capabilities: caps },
          selectedComposeProject: 'project-a',
        })}
      />,
    );
    expect(screen.getByText('Local Docker')).toBeInTheDocument();
    expect(screen.getByText('project-a')).toBeInTheDocument();
  });
});
