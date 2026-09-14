import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    originalSchemaSampling: true,
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
    fieldMappingProfile: null,
    fieldMappingProfileError: null,
    fieldMappingSearchReady: true,
    refreshFieldMappingProfile: vi.fn(),
    ...overrides,
  };
}

describe('Shell - active Compose scope visibility (UX-R3 §12)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows only the source name when the active source has no real Compose-project concept', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}))));
    render(<Shell state={baseState()} openShiftScope={null} onOpenShiftScopeChanged={vi.fn()} />);
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
      originalSchemaSampling: true,
    };
    render(
      <Shell
        state={baseState({
          selectedSource: { id: 'local-docker', displayName: 'Local Docker', capabilities: caps },
          selectedComposeProject: null,
        })}
        openShiftScope={null}
        onOpenShiftScopeChanged={vi.fn()}
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
      originalSchemaSampling: true,
    };
    render(
      <Shell
        state={baseState({
          selectedSource: { id: 'local-docker', displayName: 'Local Docker', capabilities: caps },
          selectedComposeProject: 'project-a',
        })}
        openShiftScope={null}
        onOpenShiftScopeChanged={vi.fn()}
      />,
    );
    expect(screen.getByText('Local Docker')).toBeInTheDocument();
    expect(screen.getByText('project-a')).toBeInTheDocument();
  });
});

describe('Shell - OpenShift ScopeTrail (OS-1F §6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const openShiftCaps = {
    historicalSearch: true,
    liveTail: true,
    rawLogQL: false,
    serviceDiscovery: false,
    queryStatistics: false,
    contextView: true,
    composeProjectScoping: false,
    originalSchemaSampling: true,
  };

  function renderWithOpenShiftScope(scope: Parameters<typeof Shell>[0]['openShiftScope']) {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}))));
    render(
      <Shell
        state={baseState({
          selectedSource: { id: 'openshift', displayName: 'OpenShift', capabilities: openShiftCaps },
          selectedSourceId: 'openshift',
        })}
        openShiftScope={scope}
        onOpenShiftScopeChanged={vi.fn()}
      />,
    );
  }

  it('shows only the source name when no project/namespace is selected yet - no redundant "All" segments', () => {
    renderWithOpenShiftScope({
      selectedProject: null,
      discoveryApi: null,
      selectedWorkloadKind: null,
      selectedWorkloadName: null,
      selectedPod: null,
      selectedContainer: null,
    });
    const trail = within(screen.getByTestId('scope-trail'));
    expect(trail.getByText('OpenShift')).toBeInTheDocument();
    expect(trail.queryByText('›')).not.toBeInTheDocument();
  });

  it('shows the bare project name (no "Project:" prefix) for native OpenShift Projects discovery', () => {
    renderWithOpenShiftScope({
      selectedProject: 'payments-dev',
      discoveryApi: 'PROJECTS',
      selectedWorkloadKind: null,
      selectedWorkloadName: null,
      selectedPod: null,
      selectedContainer: null,
    });
    expect(screen.getByText('payments-dev')).toBeInTheDocument();
    expect(screen.queryByText(/Namespace:/)).not.toBeInTheDocument();
  });

  it('labels the first level "Namespace:" (never a bare value) for a Kubernetes-fallback cluster - the discoveryApi truth', () => {
    renderWithOpenShiftScope({
      selectedProject: 'payments-dev',
      discoveryApi: 'NAMESPACES',
      selectedWorkloadKind: null,
      selectedWorkloadName: null,
      selectedPod: null,
      selectedContainer: null,
    });
    expect(screen.getByText('Namespace: payments-dev')).toBeInTheDocument();
  });

  it('renders the full effective hierarchy - project, workload, pod, container - in order', () => {
    renderWithOpenShiftScope({
      selectedProject: 'payments-dev',
      discoveryApi: 'PROJECTS',
      selectedWorkloadKind: 'DEPLOYMENT',
      selectedWorkloadName: 'payment-api',
      selectedPod: 'payment-api-abc123',
      selectedContainer: 'app',
    });
    expect(screen.getByText('payments-dev')).toBeInTheDocument();
    expect(screen.getByText('Deployment: payment-api')).toBeInTheDocument();
    expect(screen.getByText('payment-api-abc123')).toBeInTheDocument();
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('never shows a workload segment when no workload is selected ("All workloads" is not a redundant level)', () => {
    renderWithOpenShiftScope({
      selectedProject: 'payments-dev',
      discoveryApi: 'PROJECTS',
      selectedWorkloadKind: null,
      selectedWorkloadName: null,
      selectedPod: null,
      selectedContainer: null,
    });
    expect(screen.getByText('payments-dev')).toBeInTheDocument();
    expect(screen.queryByText(/Deployment:/)).not.toBeInTheDocument();
  });
});
