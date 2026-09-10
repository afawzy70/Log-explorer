import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { JourneyView } from './JourneyView';
import { EMPTY_QUERY_PLAN } from '../../shared/api/testFixtures';
import type { SearchState } from '../../app/useSearchState';
import { emptyAdvancedFilterValues } from '../search/advancedFilterFields';
import { emptyQueryAuthoringState } from '../search/QueryBuilder';
import { DEFAULT_SEVERITY_LEVELS } from '../search/severityLevels';
import { DEFAULT_PRESET_ID } from '../../shared/time/presets';
import { fullEvent } from '../inspector/testEventFixture';

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

describe('JourneyView', () => {
  it('renders nothing when there is no active journey query', () => {
    const { container } = render(<JourneyView state={baseState()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading state while fetching', () => {
    render(
      <JourneyView state={baseState({ journeyQuery: { field: 'traceId', value: 'trace-1' }, journeyLoading: true })} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/loading timeline/i);
  });

  it('shows an error state', () => {
    render(
      <JourneyView
        state={baseState({ journeyQuery: { field: 'traceId', value: 'trace-1' }, journeyError: 'boom' })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('"handles missing identifier and no-results cleanly" (HANDOVER.md §17) - an honest empty state, never a blank panel', () => {
    render(
      <JourneyView
        state={baseState({
          journeyQuery: { field: 'traceId', value: 'trace-x' },
          journeyResult: { events: [], counts: { estimatedTotal: null, returned: 0, visible: 0, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
        })}
      />,
    );
    expect(screen.getByText(/no events found/i)).toBeInTheDocument();
  });

  it('shows the causality disclaimer whenever there are results - never omitted or downplayed', () => {
    const events = [fullEvent({ traceId: 'trace-1' }), fullEvent({ traceId: 'trace-2' })];
    render(
      <JourneyView
        state={baseState({
          journeyQuery: { field: 'journeyId', value: 'journey-1' },
          journeyResult: { events, counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
        })}
      />,
    );
    expect(screen.getByText(/does not indicate causality/i)).toBeInTheDocument();
  });

  it('summarizes multi-trace assembly explicitly ("Supports multiple traces within one journey")', () => {
    const events = [
      fullEvent({ traceId: 'trace-1', service: 'a' }),
      fullEvent({ traceId: 'trace-2', service: 'b' }),
    ];
    render(
      <JourneyView
        state={baseState({
          journeyQuery: { field: 'journeyId', value: 'journey-1' },
          journeyResult: { events, counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
        })}
      />,
    );
    expect(screen.getByText(/2 events across 2 services and 2 traces/i)).toBeInTheDocument();
  });

  it('the Back button calls closeJourney', async () => {
    const user = userEvent.setup();
    const closeJourney = vi.fn();
    render(
      <JourneyView state={baseState({ journeyQuery: { field: 'traceId', value: 'trace-1' }, closeJourney })} />,
    );
    await user.click(screen.getByRole('button', { name: /back to search results/i }));
    expect(closeJourney).toHaveBeenCalledTimes(1);
  });

  describe('enrichment (Legacy Remediation Slice 6)', () => {
    it('shows Errors/Warnings/First->Last/Gaps stats', () => {
      const events = [
        fullEvent({ severity: 'ERROR', timestamp: '2026-01-01T12:00:00Z' }),
        fullEvent({ severity: 'WARN', timestamp: '2026-01-01T12:00:05Z' }),
        fullEvent({ severity: 'INFO', timestamp: '2026-01-01T12:00:10Z' }),
      ];
      render(
        <JourneyView
          state={baseState({
            journeyQuery: { field: 'journeyId', value: 'journey-1' },
            journeyResult: { events, counts: { estimatedTotal: null, returned: 3, visible: 3, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
          })}
        />,
      );
      expect(screen.getByText('Errors').nextElementSibling).toHaveTextContent('1');
      expect(screen.getByText('Warnings').nextElementSibling).toHaveTextContent('1');
      expect(screen.getByText('Gaps').nextElementSibling).toHaveTextContent('0');
      expect(screen.getByText('First → Last')).toBeInTheDocument();
    });

    it('renders a gap marker between two entries whose observed interval exceeds the threshold, never a fake event', () => {
      const events = [
        fullEvent({ message: 'first', timestamp: '2026-01-01T12:00:00Z' }),
        fullEvent({ message: 'second', timestamp: '2026-01-01T12:00:30Z' }), // 30s gap
      ];
      render(
        <JourneyView
          state={baseState({
            journeyQuery: { field: 'journeyId', value: 'journey-1' },
            journeyResult: { events, counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
          })}
        />,
      );
      expect(screen.getByText('Gaps').nextElementSibling).toHaveTextContent('1');
      const marker = screen.getByTestId('journey-gap-marker');
      expect(marker.textContent).toMatch(/gap detected/i);
      expect(marker.textContent).toMatch(/30s/);
      expect(marker.textContent).not.toMatch(/missing|broken|failed/i);

      // The marker is a real, standalone list item - not nested inside a JourneyEntryRow's own <li>.
      const list = screen.getByRole('list');
      const items = within(list).getAllByRole('listitem');
      expect(items).toHaveLength(3); // first entry, gap marker, second entry
    });

    it('shows no gap marker for a sequence with no detectable gap', () => {
      const events = [
        fullEvent({ timestamp: '2026-01-01T12:00:00Z' }),
        fullEvent({ timestamp: '2026-01-01T12:00:01Z' }),
      ];
      render(
        <JourneyView
          state={baseState({
            journeyQuery: { field: 'journeyId', value: 'journey-1' },
            journeyResult: { events, counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
          })}
        />,
      );
      expect(screen.queryByTestId('journey-gap-marker')).not.toBeInTheDocument();
    });

    it('shows a truthful incomplete-results notice when the journey result is truncated', () => {
      const events = [fullEvent()];
      render(
        <JourneyView
          state={baseState({
            journeyQuery: { field: 'journeyId', value: 'journey-1' },
            journeyResult: { events, counts: { estimatedTotal: null, returned: 200, visible: 200, limit: 200, truncated: true }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
          })}
        />,
      );
      expect(screen.getByText(/results may be incomplete/i)).toBeInTheDocument();
    });

    it('never claims a gap is evidence of failure', () => {
      const events = [fullEvent({ timestamp: '2026-01-01T12:00:00Z' }), fullEvent({ timestamp: '2026-01-01T12:00:30Z' })];
      render(
        <JourneyView
          state={baseState({
            journeyQuery: { field: 'journeyId', value: 'journey-1' },
            journeyResult: { events, counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
          })}
        />,
      );
      expect(screen.getByText(/not evidence that anything failed/i)).toBeInTheDocument();
    });

    it('has no detectable accessibility violations with a gap marker and a truncation notice present', async () => {
      const events = [fullEvent({ timestamp: '2026-01-01T12:00:00Z' }), fullEvent({ timestamp: '2026-01-01T12:00:30Z' })];
      const { container } = render(
        <JourneyView
          state={baseState({
            journeyQuery: { field: 'journeyId', value: 'journey-1' },
            journeyResult: { events, counts: { estimatedTotal: null, returned: 200, visible: 200, limit: 200, truncated: true }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
          })}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it('has no detectable accessibility violations across states', async () => {
    const events = [fullEvent()];
    const { container, rerender } = render(
      <JourneyView state={baseState({ journeyQuery: { field: 'traceId', value: 'trace-1' }, journeyLoading: true })} />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(
      <JourneyView
        state={baseState({
          journeyQuery: { field: 'traceId', value: 'trace-1' },
          journeyResult: { events, counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false }, nextCursor: null, queryPlan: EMPTY_QUERY_PLAN },
        })}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
