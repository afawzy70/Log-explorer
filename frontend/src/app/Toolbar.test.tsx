import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { Toolbar } from './Toolbar';
import type { SearchState } from './useSearchState';
import { emptyAdvancedFilterValues } from '../features/search/advancedFilterFields';
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
    lastSearchedRange: null,
    runSearch: vi.fn(),
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

describe('Toolbar', () => {
  it('renders controls in the exact required order: source, service, time range, severity, universal search, Search, More filters', () => {
    const { container } = render(<Toolbar state={baseState()} />);

    const source = screen.getByRole('combobox');
    const service = screen.getByRole('button', { name: /all services/i });
    const timeRange = screen.getByRole('button', { name: /last 1 day/i });
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

  it('shows a Live button, positioned before More filters, only when the active source advertises liveTail', () => {
    const caps = {
      historicalSearch: true,
      liveTail: true,
      rawLogQL: false,
      serviceDiscovery: false,
      queryStatistics: false,
      contextView: false,
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
