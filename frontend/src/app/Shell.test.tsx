import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    serviceFilterMode: 'INCLUDE',
    setServiceFilterMode: vi.fn(),
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
    invalidateSearchForScopeChange: vi.fn(),
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
    restoreOriginalSearchLabel: 'Back to original search',
    showContext: vi.fn(),
    journeyQuery: null,
    journeyResult: null,
    journeyLoading: false,
    journeyError: null,
    journeyRootEvent: null,
    openJourney: vi.fn(),
    closeJourney: vi.fn(),
    fieldMappingProfile: null,
    fieldMappingProfileError: null,
    fieldMappingSearchReady: true,
    refreshFieldMappingProfile: vi.fn(),
    mappingWorkspaceOpen: false,
    mappingWorkspaceOrigin: 'search',
    openMappingWorkspace: vi.fn(),
    closeMappingWorkspace: vi.fn(),
    settingsWorkspaceOpen: false,
    settingsTargetSection: 'sources',
    openSettingsWorkspace: vi.fn(),
    closeSettingsWorkspace: vi.fn(),
    selectedTags: [],
    setSelectedTags: vi.fn(),
    classificationTags: null,
    classificationTagsError: null,
    refreshClassificationTags: vi.fn(),
    buildClassificationSampleScope: vi.fn(() => null),
    classificationWorkspaceOpen: false,
    classificationWorkspaceEvent: null,
    classificationWorkspaceIntent: null,
    classificationWorkspaceOrigin: 'settings',
    openClassificationExtractionFromEvent: vi.fn(),
    classificationWorkspaceKey: 0,
    openClassificationWorkspace: vi.fn(),
    openClassificationRuleFromEvent: vi.fn(),
    closeClassificationWorkspace: vi.fn(),
    ...overrides,
  };
}

describe('Shell - Mapping Verification workspace entry point (owner mission "Mapping Verification and Investigation Workspace")', () => {
  /*
   * B2 (Session 4) - the top-level Shell trigger's own label shortened from "Log schema & field mapping" to
   * "Field mapping", matching the design's own `shell()` button (`prototype/scripts/app.js`); the fuller
   * descriptive text stays inside `SettingsWorkspace`'s own Field mapping section button, see that
   * component's own test coverage.
   */
  it('offers a trigger that opens the real dedicated workspace, never a popover of its own', async () => {
    const user = userEvent.setup();
    const openMappingWorkspace = vi.fn();
    render(
      <Shell state={baseState({ openMappingWorkspace })} openShiftScope={null} liveModeActive={false} />,
    );
    const trigger = screen.getByRole('button', { name: /^field mapping$/i });
    await user.click(trigger);
    expect(openMappingWorkspace).toHaveBeenCalledTimes(1);
    // Unlike the old popover implementation, clicking it renders no dialog/panel here at all.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers a single consolidated Settings entry point that opens the settings workspace', async () => {
    const user = userEvent.setup();
    const openSettingsWorkspace = vi.fn();
    render(<Shell state={baseState({ openSettingsWorkspace })} openShiftScope={null} liveModeActive={false} />);
    await user.click(screen.getByRole('button', { name: /^settings$/i }));
    expect(openSettingsWorkspace).toHaveBeenCalledTimes(1);
    // Privacy & masking / Docker settings / OpenShift / Classification rules no longer have their own
    // top-level Shell buttons - they only exist once inside the Settings workspace.
    expect(screen.queryByRole('button', { name: /privacy & masking/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /docker settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^classification rules$/i })).not.toBeInTheDocument();
  });

  it('shows the current workspace trail, defaulting to "Search"', () => {
    render(<Shell state={baseState()} openShiftScope={null} liveModeActive={false} />);
    const trail = screen.getByRole('navigation', { name: /current workspace/i });
    expect(trail).toHaveTextContent('Search');
  });

  it('the workspace trail reads "Settings" (not "Search › Settings") while the settings workspace is open', () => {
    render(
      <Shell state={baseState({ settingsWorkspaceOpen: true })} openShiftScope={null} liveModeActive={false} />,
    );
    const trail = screen.getByRole('navigation', { name: /current workspace/i });
    expect(trail).toHaveTextContent('Settings');
    expect(trail).not.toHaveTextContent(/search.*settings/i);
  });

  it('the workspace trail reads "Search › Trace" while a Trace journey lookup is open', () => {
    render(
      <Shell
        state={baseState({ journeyQuery: { field: 'traceId', value: 't-1' } })}
        openShiftScope={null}
        liveModeActive={false}
      />,
    );
    const trail = screen.getByRole('navigation', { name: /current workspace/i });
    expect(trail).toHaveTextContent('Search');
    expect(trail).toHaveTextContent('Trace');
  });

  it('the workspace trail reads "Live" (not "Search › Live") while live tail is active', () => {
    render(<Shell state={baseState()} openShiftScope={null} liveModeActive={true} />);
    const trail = screen.getByRole('navigation', { name: /current workspace/i });
    expect(trail).toHaveTextContent('Live');
    expect(trail).not.toHaveTextContent(/search.*live/i);
  });
});

describe('Shell - active Compose scope visibility (UX-R3 §12)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows only the source name when the active source has no real Compose-project concept', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}))));
    render(<Shell state={baseState()} openShiftScope={null} liveModeActive={false} />);
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
        liveModeActive={false}
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
        liveModeActive={false}
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
        liveModeActive={false}
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
