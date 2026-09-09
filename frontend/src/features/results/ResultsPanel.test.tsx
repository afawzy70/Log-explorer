import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ResultsPanel } from './ResultsPanel';
import { EMPTY_QUERY_PLAN } from '../../shared/api/testFixtures';
import type { SearchState } from '../../app/useSearchState';
import { emptyAdvancedFilterValues } from '../search/advancedFilterFields';
import { DEFAULT_SEVERITY_LEVELS } from '../search/severityLevels';
import { DEFAULT_PRESET_ID } from '../../shared/time/presets';

function baseEvent() {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    timestampRaw: null,
    schemaVersion: null,
    service: 'gateway',
    serviceSourceHint: null,
    severity: 'INFO',
    severityNumber: null,
    message: 'hello',
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

function baseState(overrides: Partial<SearchState> = {}): SearchState {
  const caps = {
    historicalSearch: true,
    liveTail: false,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: false,
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
    selectedLevels: DEFAULT_SEVERITY_LEVELS,
    setSelectedLevels: vi.fn(),
    searchText: '',
    setSearchText: vi.fn(),
    timeRange: { presetId: DEFAULT_PRESET_ID, start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
    setTimeRange: vi.fn(),
    advancedFilters: emptyAdvancedFilterValues(),
    applyAdvancedFilters: vi.fn(),
    applyDetectedField: vi.fn(),
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

describe('ResultsPanel', () => {
  it('shows a prompt before any search has run', () => {
    render(<ResultsPanel state={baseState()} />);
    expect(screen.getByText(/run a search to see results/i)).toBeInTheDocument();
  });

  it('shows a loading state while searching', () => {
    render(<ResultsPanel state={baseState({ searchLoading: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/searching/i);
  });

  it('shows an error state, never both an error and results', () => {
    render(
      <ResultsPanel
        state={baseState({
          searchError: 'Search failed',
          searchResult: { events: [baseEvent()], counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
        })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Search failed');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an empty state with a one-click "Search last 1 day" affordance', async () => {
    const user = userEvent.setup();
    const setTimeRange = vi.fn();
    render(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [], counts: { estimatedTotal: 0, returned: 0, visible: 0, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
          setTimeRange,
        })}
      />,
    );

    expect(screen.getByText(/no results for this range/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /search last 1 day/i }));
    expect(setTimeRange).toHaveBeenCalledWith(expect.objectContaining({ presetId: DEFAULT_PRESET_ID }));
  });

  it('shows the counts summary and the real table when results exist', () => {
    render(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [baseEvent()], counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
          lastSearchedRange: { presetId: DEFAULT_PRESET_ID, start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
        })}
      />,
    );
    expect(screen.getByText(/showing 1 of 1/i)).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('shows exactly one pagination control (Load more) only when a real cursor is present', () => {
    const { rerender } = render(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [baseEvent()], counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true }, nextCursor: 'cursor-1', queryPlan: EMPTY_QUERY_PLAN },
        })}
      />,
    );
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();

    rerender(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [baseEvent()], counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('clicking Load more calls loadMore, never a competing Prev/Next control', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    render(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [baseEvent()], counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true }, nextCursor: 'cursor-1', queryPlan: EMPTY_QUERY_PLAN },
          loadMore,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /load more/i }));
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^prev/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^next/i })).not.toBeInTheDocument();
  });

  it('a loadMoreError renders inline next to Load more, with a Retry action, without replacing the already-shown table', async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    render(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [baseEvent()], counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true }, nextCursor: 'cursor-1', queryPlan: EMPTY_QUERY_PLAN },
          loadMore,
          loadMoreError: 'Loading more results failed',
        })}
      />,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Loading more results failed');

    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('clicking Refresh calls refresh, never runSearch directly', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    const runSearch = vi.fn();
    render(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [baseEvent()], counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
          refresh,
          runSearch,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(runSearch).not.toHaveBeenCalled();
  });

  it('Refresh is also offered from the empty-results state', () => {
    render(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [], counts: { estimatedTotal: 0, returned: 0, visible: 0, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
        })}
      />,
    );
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('the counts summary reflects the cumulative event count after Load More, not just the latest page', () => {
    render(
      <ResultsPanel
        state={baseState({
          searchResult: {
            events: [baseEvent(), baseEvent(), baseEvent()],
            counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true },
            nextCursor: 'cursor-2', queryPlan: EMPTY_QUERY_PLAN,
          },
        })}
      />,
    );
    // Cumulative (3, the real events.length) must be shown, never the
    // latest page's own returned=1.
    expect(screen.getByText(/showing 3 events loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/of 1/i)).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations in the loading, empty, and results states', async () => {
    const { container, rerender } = render(<ResultsPanel state={baseState({ searchLoading: true })} />);
    expect(await axe(container)).toHaveNoViolations();

    rerender(
      <ResultsPanel
        state={baseState({ searchResult: { events: [], counts: { estimatedTotal: 0, returned: 0, visible: 0, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN } })}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [baseEvent()], counts: { estimatedTotal: 1, returned: 1, visible: 1, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
        })}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(
      <ResultsPanel
        state={baseState({
          searchResult: { events: [baseEvent()], counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 1, truncated: true }, nextCursor: 'cursor-1', queryPlan: EMPTY_QUERY_PLAN },
          loadMoreError: 'Loading more results failed',
        })}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
