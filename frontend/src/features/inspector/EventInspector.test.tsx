import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { EventInspector } from './EventInspector';
import { fullEvent } from './testEventFixture';
import type { SearchState } from '../../app/useSearchState';
import { emptyAdvancedFilterValues } from '../search/advancedFilterFields';
import { DEFAULT_SEVERITY_LEVELS } from '../search/severityLevels';
import { DEFAULT_PRESET_ID } from '../../shared/time/presets';

function baseState(overrides: Partial<SearchState> = {}): SearchState {
  const caps = {
    historicalSearch: true,
    liveTail: false,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: true,
  };
  return {
    sources: [{ id: 'local-docker', displayName: 'Local Docker', capabilities: caps }],
    sourcesLoading: false,
    selectedSource: { id: 'local-docker', displayName: 'Local Docker', capabilities: caps },
    selectedSourceId: 'local-docker',
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

describe('EventInspector', () => {
  it('renders nothing when there is no selection', () => {
    const { container } = render(<EventInspector state={baseState()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every section for a selected event', () => {
    render(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);
    expect(screen.getByRole('heading', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /actor & client/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /request flow/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /business \/ error/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /all fields/i })).toBeInTheDocument();
  });

  it('focus moves into the panel (the close button) when it opens', async () => {
    render(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /close event inspector/i })).toHaveFocus());
  });

  it('Previous/Next are disabled at the bounds and call the right handler otherwise', async () => {
    const user = userEvent.setup();
    const selectPreviousEvent = vi.fn();
    const selectNextEvent = vi.fn();
    render(
      <EventInspector
        state={baseState({
          selectedEvent: fullEvent(),
          selectedIndex: 0,
          hasPreviousEvent: false,
          hasNextEvent: true,
          selectPreviousEvent,
          selectNextEvent,
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /previous event/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /next event/i }));
    expect(selectNextEvent).toHaveBeenCalledTimes(1);
    expect(selectPreviousEvent).not.toHaveBeenCalled();
  });

  it('Escape closes the inspector', async () => {
    const user = userEvent.setup();
    const closeInspector = vi.fn();
    render(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0, closeInspector })} />);

    await user.keyboard('{Escape}');
    expect(closeInspector).toHaveBeenCalledTimes(1);
  });

  it('the close button and backdrop both call closeInspector', async () => {
    const user = userEvent.setup();
    const closeInspector = vi.fn();
    const { container } = render(
      <EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0, closeInspector })} />,
    );

    await user.click(screen.getByRole('button', { name: /close event inspector/i }));
    expect(closeInspector).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(closeInspector).toHaveBeenCalledTimes(2);
  });

  it('the resize handle widens the panel on ArrowLeft and narrows it on ArrowRight, staying within bounds', async () => {
    const user = userEvent.setup();
    render(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);

    const handle = screen.getByRole('separator', { name: /resize event details panel/i });
    handle.focus();
    const panel = screen.getByRole('dialog', { name: /event details/i }) as HTMLElement;
    const initialWidth = panel.style.width;

    await user.keyboard('{ArrowLeft}');
    expect(panel.style.width).not.toBe(initialWidth);
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
