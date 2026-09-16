import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { Toolbar } from './Toolbar';
import type { SearchState } from './useSearchState';
import { emptyAdvancedFilterValues } from '../features/search/advancedFilterFields';
import { emptyQueryAuthoringState } from '../features/search/QueryBuilder';
import { DEFAULT_SEVERITY_LEVELS } from '../features/search/severityLevels';
import { DEFAULT_PRESET_ID } from '../shared/time/presets';

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
    openMappingWorkspace: vi.fn(),
    closeMappingWorkspace: vi.fn(),
    selectedTags: [],
    setSelectedTags: vi.fn(),
    classificationTags: null,
    classificationTagsError: null,
    refreshClassificationTags: vi.fn(),
    buildClassificationSampleScope: vi.fn(() => null),
    classificationWorkspaceOpen: false,
    classificationWorkspaceEvent: null,
    classificationWorkspaceKey: 0,
    openClassificationWorkspace: vi.fn(),
    openClassificationRuleFromEvent: vi.fn(),
    closeClassificationWorkspace: vi.fn(),
    ...overrides,
  };
}

describe('Toolbar', () => {
  it('renders controls in the exact required order: source, service, time range, severity, universal search, Search, More filters', () => {
    const { container } = render(<Toolbar state={baseState()} />);

    const source = screen.getByRole('combobox');
    const service = screen.getByRole('button', { name: /all services/i });
    // Exact name, not a substring match: the new ActiveFilters "remove time
    // range" chip button (UX-R1 §3) also mentions "Last 1 day" in its own
    // accessible name, so a loose regex would now match two buttons.
    const timeRange = screen.getByRole('button', { name: 'Last 1 day' });
    const severityGroup = screen.getByRole('group', { name: /severity/i });
    const search = screen.getByRole('textbox', { name: /search messages/i });
    const searchButton = screen.getByRole('button', { name: /^search$/i });
    const moreFilters = screen.getByRole('button', { name: /^more filters/i });

    const position = (el: Element) => {
      const all = Array.from(container.querySelectorAll('*'));
      return all.indexOf(el);
    };

    expect(position(source)).toBeLessThan(position(service));
    expect(position(service)).toBeLessThan(position(timeRange));
    expect(position(timeRange)).toBeLessThan(position(severityGroup));
    expect(position(severityGroup)).toBeLessThan(position(search));
    expect(position(search)).toBeLessThan(position(searchButton));
    expect(position(searchButton)).toBeLessThan(position(moreFilters));
  });

  it('never shows a Live button when the active source does not advertise the liveTail capability', () => {
    render(<Toolbar state={baseState()} />);
    expect(screen.queryByRole('button', { name: /live/i })).not.toBeInTheDocument();
  });

  it('UX-R3 §5/§9: never shows the Compose project selector when the active source does not advertise composeProjectScoping', () => {
    render(<Toolbar state={baseState()} />);
    expect(screen.queryByLabelText(/compose project/i)).not.toBeInTheDocument();
  });

  it('UX-R3 §5/§9/§12: shows the Compose project selector, positioned after source and before service, only when the active source advertises composeProjectScoping', () => {
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
    const { container } = render(
      <Toolbar
        state={baseState({
          selectedSource: { id: 'local-docker', displayName: 'Local Docker', capabilities: caps },
          composeProjects: ['project-a', 'project-b'],
        })}
      />,
    );

    const source = screen.getByRole('combobox', { name: /^source$/i });
    const project = screen.getByLabelText(/compose project/i);
    const service = screen.getByRole('button', { name: /all services/i });
    const all = Array.from(container.querySelectorAll('*'));

    expect(all.indexOf(source)).toBeLessThan(all.indexOf(project));
    expect(all.indexOf(project)).toBeLessThan(all.indexOf(service));
  });

  it('shows a Live button, positioned before More filters, only when the active source advertises liveTail', () => {
    const caps = {
      historicalSearch: true,
      liveTail: true,
      rawLogQL: false,
      serviceDiscovery: false,
      queryStatistics: false,
      contextView: false,
      composeProjectScoping: false,
      originalSchemaSampling: true,
    };
    const { container } = render(
      <Toolbar
        state={baseState({
          selectedSource: { id: 'live-source', displayName: 'Live Source', capabilities: caps },
        })}
      />,
    );

    const liveButton = screen.getByRole('button', { name: /^live$/i });
    const moreFilters = screen.getByRole('button', { name: /^more filters/i });
    const all = Array.from(container.querySelectorAll('*'));
    expect(all.indexOf(liveButton)).toBeLessThan(all.indexOf(moreFilters));
  });

  it('clicking Live calls onStartLive (IMPLEMENTATION_PLAN.md "Phase J")', async () => {
    const user = userEvent.setup();
    const caps = {
      historicalSearch: true,
      liveTail: true,
      rawLogQL: false,
      serviceDiscovery: false,
      queryStatistics: false,
      contextView: false,
      composeProjectScoping: false,
      originalSchemaSampling: true,
    };
    const onStartLive = vi.fn();
    render(
      <Toolbar
        state={baseState({ selectedSource: { id: 'live-source', displayName: 'Live Source', capabilities: caps } })}
        onStartLive={onStartLive}
      />,
    );

    const liveButton = screen.getByRole('button', { name: /^live$/i });
    expect(liveButton).toBeEnabled();
    await user.click(liveButton);
    expect(onStartLive).toHaveBeenCalledTimes(1);
  });

  it('clicking Search calls runSearch', () => {
    const runSearch = vi.fn();
    render(<Toolbar state={baseState({ runSearch })} />);
    screen.getByRole('button', { name: /^search$/i }).click();
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<Toolbar state={baseState()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Toolbar - OpenShift Project/Namespace required for Search/Live (OS-1F §8)', () => {
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

  function openShiftState(overrides: Partial<SearchState> = {}) {
    return baseState({
      selectedSource: { id: 'openshift', displayName: 'OpenShift', capabilities: openShiftCaps },
      selectedSourceId: 'openshift',
      ...overrides,
    });
  }

  it('disables Search and Live, with a visible reason, when connected but no Project/Namespace is selected', () => {
    render(
      <Toolbar
        state={openShiftState()}
        onStartLive={vi.fn()}
        openShiftScope={{
          selectedProject: null,
          discoveryApi: 'PROJECTS',
          selectedWorkloadKind: null,
          selectedWorkloadName: null,
          selectedPod: null,
          selectedContainer: null,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^live$/i })).toBeDisabled();
    expect(screen.getByText(/select a project to search openshift/i)).toBeInTheDocument();
  });

  it('says "Namespace" instead of "Project" in the hint for a Kubernetes-fallback cluster', () => {
    render(
      <Toolbar
        state={openShiftState()}
        onStartLive={vi.fn()}
        openShiftScope={{
          selectedProject: null,
          discoveryApi: 'NAMESPACES',
          selectedWorkloadKind: null,
          selectedWorkloadName: null,
          selectedPod: null,
          selectedContainer: null,
        }}
      />,
    );
    expect(screen.getByText(/select a namespace to search openshift/i)).toBeInTheDocument();
  });

  it('enables Search and Live once a Project/Namespace is selected', () => {
    render(
      <Toolbar
        state={openShiftState()}
        onStartLive={vi.fn()}
        openShiftScope={{
          selectedProject: 'payments-dev',
          discoveryApi: 'PROJECTS',
          selectedWorkloadKind: null,
          selectedWorkloadName: null,
          selectedPod: null,
          selectedContainer: null,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^live$/i })).toBeEnabled();
    expect(screen.queryByText(/select a project to search openshift/i)).not.toBeInTheDocument();
  });

  it('never gates Search for a non-OpenShift source, even when openShiftScope happens to be non-null (stale from a prior source)', () => {
    render(
      <Toolbar
        state={baseState()}
        openShiftScope={{
          selectedProject: null,
          discoveryApi: 'PROJECTS',
          selectedWorkloadKind: null,
          selectedWorkloadName: null,
          selectedPod: null,
          selectedContainer: null,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();
  });

  it('never gates Search before the scope has resolved (openShiftScope still null on first render)', () => {
    render(<Toolbar state={openShiftState()} onStartLive={vi.fn()} openShiftScope={null} />);
    expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();
  });

  describe('Configurable Log Field Mapping mission §15 - search readiness gate', () => {
    it('disables Search when the field-mapping profile is not search-ready, and shows the exact reason', () => {
      render(<Toolbar state={baseState({ fieldMappingSearchReady: false })} />);
      const searchButton = screen.getByRole('button', { name: /^search$/i });
      expect(searchButton).toBeDisabled();
      expect(screen.getByText(/configure and validate log field mapping before searching this source/i)).toBeInTheDocument();
    });

    it('enables Search when the field-mapping profile is search-ready', () => {
      render(<Toolbar state={baseState({ fieldMappingSearchReady: true })} />);
      expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();
      expect(screen.queryByText(/configure and validate log field mapping/i)).not.toBeInTheDocument();
    });

    it('never silently permits Search before the readiness state has loaded (undefined stays blocked)', () => {
      render(<Toolbar state={baseState({ fieldMappingSearchReady: undefined })} />);
      expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled();
    });

    it('re-enables Search reactively once fieldMappingSearchReady flips true (e.g. after a successful save elsewhere)', () => {
      const { rerender } = render(<Toolbar state={baseState({ fieldMappingSearchReady: false })} />);
      expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled();

      rerender(<Toolbar state={baseState({ fieldMappingSearchReady: true })} />);
      expect(screen.getByRole('button', { name: /^search$/i })).toBeEnabled();
    });

    it('the mapping-not-ready gate takes precedence in its own hint text over an OpenShift missing-scope hint', () => {
      render(
        <Toolbar
          state={openShiftState({ fieldMappingSearchReady: false })}
          openShiftScope={{
            selectedProject: null,
            discoveryApi: 'PROJECTS',
            selectedWorkloadKind: null,
            selectedWorkloadName: null,
            selectedPod: null,
            selectedContainer: null,
          }}
        />,
      );
      expect(screen.getByText(/configure and validate log field mapping/i)).toBeInTheDocument();
      expect(screen.queryByText(/select a project to search openshift/i)).not.toBeInTheDocument();
    });
  });
});
