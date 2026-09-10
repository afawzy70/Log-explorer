import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { EventInspector } from './EventInspector';
import { fullEvent } from './testEventFixture';
import type { SearchState } from '../../app/useSearchState';
import { emptyAdvancedFilterValues } from '../search/advancedFilterFields';
import { emptyQueryAuthoringState } from '../search/QueryBuilder';
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
    queryState: emptyQueryAuthoringState(),
    applyQuery: vi.fn(),
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

  it('"]" and "[" navigate next/previous, bounded (UI Parity Acceleration Pass keyboard productivity)', () => {
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

    // Dispatched directly (rather than through user-event's keyboard()
    // DSL, which treats bare "[" / "]" as special-key syntax) so this
    // test exercises exactly the `e.key` values the real handler checks.
    fireEvent.keyDown(document, { key: '[' });
    expect(selectPreviousEvent).not.toHaveBeenCalled(); // bounded - no previous event

    fireEvent.keyDown(document, { key: ']' });
    expect(selectNextEvent).toHaveBeenCalledTimes(1);
  });

  it('"[" / "]" are ignored while focus is inside a text field (never hijacks typing)', async () => {
    const user = userEvent.setup();
    const selectNextEvent = vi.fn();
    render(
      <div>
        <input aria-label="scratch input" />
        <EventInspector
          state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0, hasNextEvent: true, selectNextEvent })}
        />
      </div>,
    );

    const input = screen.getByLabelText('scratch input');
    await user.click(input);
    fireEvent.keyDown(input, { key: ']' });
    expect(selectNextEvent).not.toHaveBeenCalled();
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

  describe('free-text redaction display (Legacy Remediation Slice 7)', () => {
    // The frontend never redacts anything itself - these fixtures use
    // already-redacted text, exactly what the real backend would send
    // (TextRedactor's own marker vocabulary), and verify the existing
    // display-only components render it safely, with no reveal action
    // and no re-exposure via the raw-JSON dump.
    const redactedEvent = fullEvent({
      message: 'Login failed for customerId=[REDACTED] card [REDACTED_CARD] declined',
      exception: 'java.lang.RuntimeException: Authorization: Bearer [REDACTED]\n\tat com.example.Foo.bar(Foo.java:1)',
    });

    it('the Business/error section renders the redacted exception as plain text, never the original', () => {
      render(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      const section = screen.getByRole('heading', { name: /business \/ error/i }).closest('section')!;
      expect(within(section).getByText(/Authorization: Bearer \[REDACTED\]/)).toBeInTheDocument();
      expect(section.textContent).not.toMatch(/Bearer ey[A-Za-z0-9]/); // no raw-looking token survives
    });

    it('the overview/title area renders the redacted message', () => {
      render(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      const dialog = screen.getByRole('dialog', { name: /event details/i });
      expect(dialog.textContent).toContain('[REDACTED]');
      expect(dialog.textContent).toContain('[REDACTED_CARD]');
    });

    it('the raw JSON dump only ever shows what the event already carries - already-redacted text, never anything extra', async () => {
      const user = userEvent.setup();
      render(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      await user.click(screen.getByText('Raw JSON'));
      const rawJson = screen.getByText(/"message"/).closest('pre')!;
      expect(rawJson.textContent).toContain('[REDACTED]');
      expect(rawJson.textContent).toContain('[REDACTED_CARD]');
      expect(rawJson.textContent).not.toMatch(/customerId=\d/); // the original digits are gone, never reconstructed client-side
    });

    it('there is no reveal action anywhere for a redacted message/exception - the marker text is all there is', () => {
      render(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/click to reveal|show original|unmask/i)).not.toBeInTheDocument();
    });

    it('has no detectable accessibility violations with redacted content', async () => {
      const { container } = render(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
