import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { EventInspector } from './EventInspector';
import { fullEvent, sparseEvent } from './testEventFixture';
import type { SearchState } from '../../app/useSearchState';
import { emptyAdvancedFilterValues } from '../search/advancedFilterFields';
import { emptyQueryAuthoringState } from '../search/QueryBuilder';
import { DEFAULT_SEVERITY_LEVELS } from '../search/severityLevels';
import { DEFAULT_PRESET_ID } from '../../shared/time/presets';
import { ShortcutRegistryProvider } from '../../shared/keyboard/ShortcutRegistry';

/**
 * EventInspector registers its Escape/"["/"]" bindings through the shared
 * shortcut registry (Legacy Remediation Slice 8) - without an ancestor
 * `ShortcutRegistryProvider`, `useShortcut` silently no-ops, which would
 * make every keyboard test in this file pass vacuously regardless of
 * whether the real guard logic is correct. Every render in this file goes
 * through this helper so the keyboard assertions stay meaningful.
 */
function renderWithRegistry(ui: ReactElement) {
  return render(<ShortcutRegistryProvider>{ui}</ShortcutRegistryProvider>);
}

function baseState(overrides: Partial<SearchState> = {}): SearchState {
  const caps = {
    historicalSearch: true,
    liveTail: false,
    rawLogQL: false,
    serviceDiscovery: true,
    queryStatistics: false,
    contextView: true,
    composeProjectScoping: false,
    originalSchemaSampling: true,
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

describe('EventInspector', () => {
  it('renders nothing when there is no selection', () => {
    const { container } = renderWithRegistry(<EventInspector state={baseState()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every tab for a selected event with data in every group, and switching tabs shows that tab\'s section', async () => {
    // Pre-closure functional recovery (§4): the flat "renders every
    // section" assertion no longer applies - sections are now grouped
    // into tabs, and only the active tab's section is in the DOM at a
    // time (standard tab-panel behavior). This test now walks every tab
    // and confirms each one's own heading appears once selected.
    const user = userEvent.setup();
    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);
    const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
    const expected: Array<[tabName: RegExp, headingName: RegExp]> = [
      // DRIFT-008 remediation: Overview no longer shows its own redundant "Overview" heading (the
      // tabpanel is already named "Overview" via aria-labelledby to the tab itself) - it shows the
      // "When & where" sub-heading over its grouped fields instead.
      [/^overview$/i, /when & where/i],
      [/actor & client/i, /actor & client/i],
      [/request flow/i, /request flow/i],
      [/^business$/i, /^business$/i],
      [/technical \/ all fields/i, /all fields/i],
      // LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - fullEvent() has ERROR severity + a real
      // exception, so the conditional Error tab is present too.
      [/^error$/i, /^error$/i],
    ];
    for (const [tabName, headingName] of expected) {
      await user.click(within(tablist).getByRole('tab', { name: tabName }));
      expect(screen.getByRole('heading', { name: headingName })).toBeInTheDocument();
    }
  });

  /*
   * Pre-closure functional recovery 2 (§A1-§A5, named conflict per
   * CLAUDE.md §5): the owner explicitly rejected the prior "hide the tab
   * when the section has no data" behavior (see EventInspector.tsx's own
   * doc comment on `tabs`) - absence of data is itself diagnostically
   * meaningful and must never look identical to "the UI hid something."
   * These tests replace the old "does not show a tab for a section with
   * no data" test, which asserted the now-rejected behavior.
   */
  describe('primary tabs are structurally fixed - always present regardless of event content (§A1-§A5)', () => {
    it('all five primary tabs are present for a minimal/sparse event, each with an honest empty state', async () => {
      const user = userEvent.setup();
      const minimal = sparseEvent();
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: minimal, selectedIndex: 0 })} />);
      const tablist = screen.getByRole('tablist', { name: /event detail sections/i });

      // INSPECTOR_FIXED_PRIMARY_TABS / OVERVIEW_TAB_ALWAYS_PRESENT / etc. - and NO Error tab, since a
      // sparse event (null severity, no exception, no error code) genuinely has no error information.
      for (const name of [/^overview$/i, /actor & client/i, /request flow/i, /^business$/i, /technical \/ all fields/i]) {
        expect(within(tablist).getByRole('tab', { name })).toBeInTheDocument();
      }
      expect(within(tablist).queryByRole('tab', { name: /^error$/i })).not.toBeInTheDocument();

      // EMPTY_ACTOR_STATE_VISIBLE
      await user.click(within(tablist).getByRole('tab', { name: /actor & client/i }));
      expect(screen.getByText(/no actor or client data on this event/i)).toBeInTheDocument();

      // EMPTY_REQUEST_FLOW_STATE_VISIBLE
      await user.click(within(tablist).getByRole('tab', { name: /request flow/i }));
      expect(screen.getByText(/no journey, correlation, trace, span, or event id on this event/i)).toBeInTheDocument();

      // EMPTY_BUSINESS_STATE_VISIBLE - Business is business-only now, no mention of error/exception.
      await user.click(within(tablist).getByRole('tab', { name: /^business$/i }));
      expect(screen.getByText(/no business step or ui identifier on this event/i)).toBeInTheDocument();

      // NO_DATA_FABRICATED - the empty states say only that data is absent, never a guess at why
      expect(screen.queryByText(/failed to log/i)).not.toBeInTheDocument();
    });

    it('a malformed/raw-fallback event still shows all five fixed tabs (no Error tab - a malformed line has no severity), with the raw line surfaced in Technical / all fields', async () => {
      const user = userEvent.setup();
      const malformed = sparseEvent({ malformed: true, rawLine: 'not valid json {{{' });
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: malformed, selectedIndex: 0 })} />);
      const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
      for (const name of [/^overview$/i, /actor & client/i, /request flow/i, /^business$/i, /technical \/ all fields/i]) {
        expect(within(tablist).getByRole('tab', { name })).toBeInTheDocument();
      }
      expect(within(tablist).queryByRole('tab', { name: /^error$/i })).not.toBeInTheDocument();
      await user.click(within(tablist).getByRole('tab', { name: /technical \/ all fields/i }));
      // Appears at least in the raw JSON dump, and typically also as the
      // canonical "Message" field's own displayed fallback value.
      expect(screen.getAllByText(/not valid json/i).length).toBeGreaterThan(0);
    });

    it('switching between a fully-populated event and a sparse event never changes the five FIXED tabs offered - only which are empty (the conditional Error tab is covered separately below)', () => {
      const tabNames = [/^overview$/i, /actor & client/i, /request flow/i, /^business$/i, /technical \/ all fields/i];
      const { rerender } = renderWithRegistry(
        <EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />,
      );
      const tablistFull = screen.getByRole('tablist', { name: /event detail sections/i });
      for (const name of tabNames) {
        expect(within(tablistFull).getByRole('tab', { name })).toBeInTheDocument();
      }

      rerender(
        <ShortcutRegistryProvider>
          <EventInspector state={baseState({ selectedEvent: sparseEvent(), selectedIndex: 1 })} />
        </ShortcutRegistryProvider>,
      );
      const tablistSparse = screen.getByRole('tablist', { name: /event detail sections/i });
      // EVENT_CHANGE_DOES_NOT_CHANGE_THE_FIXED_TAB_SET
      for (const name of tabNames) {
        expect(within(tablistSparse).getByRole('tab', { name })).toBeInTheDocument();
      }
    });

    // LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - the one deliberate exception to the fixed-tab-set
    // rule above: the Error tab genuinely appears/disappears based on event content (see
    // EventInspector.tsx's own doc comment naming this conflict explicitly).
    it('the Error tab appears for an event with error information and disappears for one without, safely (falls back to Overview, never crashes)', async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithRegistry(
        <EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />,
      );
      const tablistError = screen.getByRole('tablist', { name: /event detail sections/i });
      expect(within(tablistError).getByRole('tab', { name: /^error$/i })).toBeInTheDocument();
      await user.click(within(tablistError).getByRole('tab', { name: /^error$/i }));
      expect(screen.getByRole('tab', { name: /^error$/i })).toHaveAttribute('aria-selected', 'true');

      rerender(
        <ShortcutRegistryProvider>
          <EventInspector state={baseState({ selectedEvent: sparseEvent(), selectedIndex: 1 })} />
        </ShortcutRegistryProvider>,
      );
      const tablistNoError = screen.getByRole('tablist', { name: /event detail sections/i });
      expect(within(tablistNoError).queryByRole('tab', { name: /^error$/i })).not.toBeInTheDocument();
      // Falls back to Overview - the reset-on-navigation effect, or InspectorTabs' own
      // activeTabId-not-found fallback, either way never leaves the panel on a nonexistent tab.
      expect(screen.getByRole('tab', { name: /^overview$/i })).toHaveAttribute('aria-selected', 'true');
    });

    it('an event missing only actor/client data still shows every other tab with its real content', async () => {
      const user = userEvent.setup();
      const noActor = fullEvent({
        protectedFields: { userName: null, customerId: null, cif: null, deviceId: null, deviceIp: null },
        devicePlatformType: null,
        language: null,
      });
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: noActor, selectedIndex: 0 })} />);
      const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
      expect(within(tablist).getByRole('tab', { name: /actor & client/i })).toBeInTheDocument();
      await user.click(within(tablist).getByRole('tab', { name: /actor & client/i }));
      expect(screen.getByText(/no actor or client data on this event/i)).toBeInTheDocument();
      // Request flow (unaffected by the actor-data removal) still shows real data.
      await user.click(within(tablist).getByRole('tab', { name: /request flow/i }));
      expect(screen.getByText(/trace-000100/i)).toBeInTheDocument();
    });

    it('an event missing only request-flow identifiers still shows the Request flow tab with an honest empty state', async () => {
      const user = userEvent.setup();
      const noFlow = fullEvent({
        journeyId: null,
        correlationId: null,
        traceId: null,
        spanId: null,
        eventId: null,
      });
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: noFlow, selectedIndex: 0 })} />);
      const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
      await user.click(within(tablist).getByRole('tab', { name: /request flow/i }));
      expect(screen.getByText(/no journey, correlation, trace, span, or event id on this event/i)).toBeInTheDocument();
    });

    it('an event missing business/error field data still shows an honest empty state on Business; ERROR severity alone still shows the Error tab with its own honest empty state', async () => {
      const user = userEvent.setup();
      const noBusinessError = fullEvent({
        businessStep: null,
        uiIdentifier: null,
        errorCode: null,
        exception: null,
      });
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: noBusinessError, selectedIndex: 0 })} />);
      const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
      await user.click(within(tablist).getByRole('tab', { name: /^business$/i }));
      expect(screen.getByText(/no business step or ui identifier on this event/i)).toBeInTheDocument();

      // fullEvent()'s own severity is still ERROR, so the Error tab is still present - with its own
      // truthful "severity indicates an error, but no exception/error code payload" empty state.
      await user.click(within(tablist).getByRole('tab', { name: /^error$/i }));
      expect(screen.getByText(/carries no exception or error code payload/i)).toBeInTheDocument();
    });

    it('unknown/custom fields are preserved and reachable from Technical / all fields regardless of primary-section content', async () => {
      const user = userEvent.setup();
      const withUnknown = sparseEvent({ unknownTopLevelFields: { veryCustomField: 'unusual-value' } });
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: withUnknown, selectedIndex: 0 })} />);
      const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
      await user.click(within(tablist).getByRole('tab', { name: /technical \/ all fields/i }));
      // Appears twice (the structured "Unknown fields" list, and the raw
      // JSON dump beneath it) - both are real, so at-least-one is correct.
      expect(screen.getAllByText(/veryCustomField/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/unusual-value/i).length).toBeGreaterThan(0);
    });
  });

  it('keyboard: ArrowRight/ArrowLeft move between tabs, Home/End jump to the first/last tab', async () => {
    const user = userEvent.setup();
    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);
    const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
    const overviewTab = within(tablist).getByRole('tab', { name: /^overview$/i });
    overviewTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(tablist).getByRole('tab', { name: /actor & client/i })).toHaveFocus();
    expect(within(tablist).getByRole('tab', { name: /actor & client/i })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(within(tablist).getByRole('tab', { name: /^overview$/i })).toHaveFocus();
    await user.keyboard('{End}');
    // fullEvent() has ERROR severity + a real exception, so the conditional Error tab is the true last
    // tab now (6th), not Technical / all fields (5th).
    expect(within(tablist).getByRole('tab', { name: /^error$/i })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(within(tablist).getByRole('tab', { name: /^overview$/i })).toHaveFocus();
  });

  it('selecting a new event (Previous/Next) resets the active tab back to Overview', async () => {
    const user = userEvent.setup();
    const events = [fullEvent({ eventId: 'evt-1' }), fullEvent({ eventId: 'evt-2' })];
    const { rerender } = renderWithRegistry(
      <EventInspector
        state={baseState({
          selectedEvent: events[0],
          selectedIndex: 0,
          searchResult: { events, total: 2, truncated: false, capabilitiesUsed: [] } as never,
        })}
      />,
    );
    const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
    await user.click(within(tablist).getByRole('tab', { name: /technical \/ all fields/i }));
    expect(within(tablist).getByRole('tab', { name: /technical \/ all fields/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    rerender(
      <ShortcutRegistryProvider>
        <EventInspector
          state={baseState({
            selectedEvent: events[1],
            selectedIndex: 1,
            searchResult: { events, total: 2, truncated: false, capabilitiesUsed: [] } as never,
          })}
        />
      </ShortcutRegistryProvider>,
    );
    expect(within(tablist).getByRole('tab', { name: /^overview$/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('focus moves into the panel (the close button) when it opens', async () => {
    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /close event inspector/i })).toHaveFocus());
  });

  it('Previous/Next are disabled at the bounds and call the right handler otherwise', async () => {
    const user = userEvent.setup();
    const selectPreviousEvent = vi.fn();
    const selectNextEvent = vi.fn();
    renderWithRegistry(
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
    renderWithRegistry(
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
    renderWithRegistry(
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
    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0, closeInspector })} />);

    await user.keyboard('{Escape}');
    expect(closeInspector).toHaveBeenCalledTimes(1);
  });

  it('the close button and backdrop both call closeInspector', async () => {
    const user = userEvent.setup();
    const closeInspector = vi.fn();
    const { container } = renderWithRegistry(
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
    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);

    const handle = screen.getByRole('separator', { name: /resize event details panel/i });
    handle.focus();
    const panel = screen.getByRole('dialog', { name: /event details/i }) as HTMLElement;
    const initialWidth = panel.style.width;

    await user.keyboard('{ArrowLeft}');
    expect(panel.style.width).not.toBe(initialWidth);
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderWithRegistry(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);
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

    it('the Error section renders the redacted exception as plain text, never the original', async () => {
      const user = userEvent.setup();
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      // LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - the exception now lives in the conditional
      // Error tab (redactedEvent has ERROR severity + a real exception), not the old combined tab.
      await user.click(screen.getByRole('tab', { name: /^error$/i }));
      const section = screen.getByRole('heading', { name: /^error$/i }).closest('section')!;
      expect(within(section).getByText(/Authorization: Bearer \[REDACTED\]/)).toBeInTheDocument();
      expect(section.textContent).not.toMatch(/Bearer ey[A-Za-z0-9]/); // no raw-looking token survives
    });

    it('the overview/title area renders the redacted message', () => {
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      const dialog = screen.getByRole('dialog', { name: /event details/i });
      expect(dialog.textContent).toContain('[REDACTED]');
      expect(dialog.textContent).toContain('[REDACTED_CARD]');
    });

    it('the raw JSON dump only ever shows what the event already carries - already-redacted text, never anything extra', async () => {
      const user = userEvent.setup();
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      // Pre-closure functional recovery (§4): "All fields" (which owns the
      // raw JSON disclosure) is now its own tab - switch to it first.
      await user.click(screen.getByRole('tab', { name: /technical \/ all fields/i }));
      await user.click(screen.getByText('Canonical Event JSON'));
      const rawJson = screen.getByText(/"message"/).closest('pre')!;
      expect(rawJson.textContent).toContain('[REDACTED]');
      expect(rawJson.textContent).toContain('[REDACTED_CARD]');
      expect(rawJson.textContent).not.toMatch(/customerId=\d/); // the original digits are gone, never reconstructed client-side
    });

    it('there is no reveal action anywhere for a redacted message/exception - the marker text is all there is', () => {
      renderWithRegistry(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/click to reveal|show original|unmask/i)).not.toBeInTheDocument();
    });

    it('has no detectable accessibility violations with redacted content', async () => {
      const { container } = renderWithRegistry(<EventInspector state={baseState({ selectedEvent: redactedEvent, selectedIndex: 0 })} />);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('EventInspector - event classification', () => {
  const classified = fullEvent({
    tags: ['middleware'],
    classifications: [
      {
        ruleId: 'mw-call',
        ruleName: 'Middleware call',
        tags: ['middleware'],
        extracted: [
          { name: 'endpoint', label: 'Endpoint', value: '/accounts', status: 'PRESENT', redacted: false, truncated: false },
        ],
      },
    ],
  });

  it('renders "Create tag rule from this event" in the header and hands the selected event to the workspace', async () => {
    const user = userEvent.setup();
    const openClassificationRuleFromEvent = vi.fn();
    const event = fullEvent();
    renderWithRegistry(
      <EventInspector state={baseState({ selectedEvent: event, selectedIndex: 0, openClassificationRuleFromEvent })} />,
    );
    await user.click(screen.getByRole('button', { name: 'Create tag rule from this event' }));
    expect(openClassificationRuleFromEvent).toHaveBeenCalledWith(event);
  });

  it('shows the Classification section inside Overview for a classified event while keeping exactly six tabs (five fixed + the conditional Error tab, since classified is a fullEvent() with ERROR severity)', () => {
    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: classified, selectedIndex: 0 })} />);
    const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByRole('heading', { name: 'Classification' })).toBeInTheDocument();
    expect(screen.getByText('MIDDLEWARE')).toBeInTheDocument();
    expect(screen.getByText('/accounts')).toBeInTheDocument();
  });

  it('shows no Classification section when the event has no classifications', () => {
    renderWithRegistry(<EventInspector state={baseState({ selectedEvent: fullEvent(), selectedIndex: 0 })} />);
    const tablist = screen.getByRole('tablist', { name: /event detail sections/i });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(6);
    expect(screen.queryByRole('heading', { name: 'Classification' })).not.toBeInTheDocument();
  });
});
