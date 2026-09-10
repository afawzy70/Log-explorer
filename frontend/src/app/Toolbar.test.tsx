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
