import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { JourneyView } from './JourneyView';
import type { SearchState } from '../../app/useSearchState';
import { emptyAdvancedFilterValues } from '../search/advancedFilterFields';
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
          journeyResult: { events: [], counts: { estimatedTotal: null, returned: 0, visible: 0, limit: 200, truncated: false }, nextCursor: null },
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
          journeyResult: { events, counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 200, truncated: false }, nextCursor: null },
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
          journeyResult: { events, counts: { estimatedTotal: null, returned: 2, visible: 2, limit: 200, truncated: false }, nextCursor: null },
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
          journeyResult: { events, counts: { estimatedTotal: null, returned: 1, visible: 1, limit: 200, truncated: false }, nextCursor: null },
        })}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
