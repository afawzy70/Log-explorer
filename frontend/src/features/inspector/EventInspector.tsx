import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchState } from '../../app/useSearchState';
import { useShortcut } from '../../shared/keyboard/ShortcutRegistry';
import { InspectorHeader } from './InspectorHeader';
import { OverviewSection } from './OverviewSection';
import { ActorClientSection } from './ActorClientSection';
import { RequestFlowSection } from './RequestFlowSection';
import { BusinessSection } from './BusinessSection';
import { ErrorSection } from './ErrorSection';
import { eventHasErrorInfo } from './sections';
import { AllFieldsSection } from './AllFieldsSection';
import { InspectorTabs } from './InspectorTabs';
import type { InspectorTab } from './InspectorTabs';
import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, useResizablePanel } from './useResizablePanel';
import { wasConsumedByDismissableLayer } from '../../shared/ui/useDismissableLayer';
import styles from './EventInspector.module.css';

/**
 * The event inspector (IMPLEMENTATION_PLAN.md "Phase H", HANDOVER.md
 * §16): right-side panel beside results on wide screens, sheet/overlay on
 * narrow (CSS media query in `EventInspector.module.css` - a real
 * viewport-width breakpoint switch, not the kind of zoom-vs-flex distinction
 * Phase F/G's own layout bugs turned on, so a plain media query is the
 * right tool here). Renders nothing when nothing is selected.
 */
export function EventInspector({ state }: { state: SearchState }) {
  const panel = useResizablePanel();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const event = state.selectedEvent;
  /*
   * UX-R5 §5 - the size of the result set actually on screen, which is
   * what the position indicator counts against. `searchResult.events` is
   * the same array the results table renders and the same one
   * Previous/Next walks, so the indicator can never disagree with either;
   * it grows when "Load more" appends, exactly as the denominator should.
   */
  const loadedCount = state.searchResult?.events.length ?? 0;

  useEffect(() => {
    if (event) {
      closeButtonRef.current?.focus();
    }
  }, [event]);

  const [activeTabId, setActiveTabId] = useState('overview');
  // A newly-selected event (Previous/Next, or opening a different row)
  // always starts back on Overview - staying on e.g. "Business / error"
  // while stepping onto an event with no error would either show a stale
  // tab that no longer exists for this event, or a misleadingly-empty one.
  useEffect(() => {
    setActiveTabId('overview');
  }, [state.selectedIndex]);

  /*
   * Pre-closure functional recovery 2 (§A1-§A5) - named conflict per
   * CLAUDE.md §5, superseding the first recovery's own decision below.
   *
   * SUPERSEDED (pre-closure functional recovery 1, §4/§8): "tabs are
   * computed per event, hiding a tab entirely when its section has no
   * data to show ('Do NOT display empty meaningless tabs')". The owner
   * explicitly rejected this once it shipped: the ABSENCE of data is
   * itself diagnostically important (was the field never a feature of
   * this event category, or did this specific event simply fail to
   * record it?) - a tab that silently disappears cannot answer that
   * question, and worse, looks identical to "the UI hid something" from
   * the investigator's seat. A user comparing two events (one complete,
   * one sparse) needs the SAME five tabs in the SAME positions on both,
   * so absence-of-a-tab is never mistaken for absence-of-a-feature.
   *
   * SUPERSEDED IN PART (LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY,
   * CLAUDE.md §5 "name the conflict, apply the later decision"): the
   * "always five fixed tabs, never conditional" rule above still holds
   * for Overview/Actor & client/Request flow/Business/Technical - but the
   * owner's later, explicit instruction is that a sixth "Error" tab must
   * appear ONLY for an event that actually "contains error information"
   * (`eventHasErrorInfo` - ERROR/FATAL severity, a real exception, or a
   * real error code), never for every event regardless of content. This
   * is a deliberate, narrow exception for this one new tab, not a
   * reversion of the fixed-five-tabs decision for the others: a sparse
   * event with no error data would otherwise show an Error tab whose only
   * content is "this event isn't an error," which is a materially
   * different (and less useful) statement than what the fixed five tabs
   * already say for missing data - a genuinely empty AND diagnostically
   * meaningless tab, unlike e.g. Business's honest "no business step" for
   * an event that legitimately never carries one.
   *
   * "Business / error" is also renamed "Business" and no longer shows
   * error/exception data at all (`BusinessSection`, split from the former
   * `BusinessErrorSection`) - error data now lives only in Overview's own
   * Error Summary and this conditional Error tab. "Trace / Correlation"
   * remains unified into "Request Flow" (unchanged from the first
   * recovery): this product's data model has no fields distinguishing the two.
   */
  const tabs: InspectorTab[] = useMemo(() => {
    if (!event) return [];
    const fixedTabs: InspectorTab[] = [
      {
        id: 'overview',
        label: 'Overview',
        content: (
          <OverviewSection
            event={event}
            sources={state.sources}
            onViewErrorDetails={() => setActiveTabId('error')}
          />
        ),
      },
      { id: 'actor', label: 'Actor & client', content: <ActorClientSection event={event} /> },
      {
        id: 'requestFlow',
        label: 'Request flow',
        content: <RequestFlowSection event={event} onOpenJourney={state.openJourney} />,
      },
      { id: 'business', label: 'Business', content: <BusinessSection event={event} /> },
      {
        id: 'allFields',
        label: 'Technical / all fields',
        content: <AllFieldsSection event={event} sources={state.sources} />,
      },
    ];
    if (eventHasErrorInfo(event)) {
      fixedTabs.push({ id: 'error', label: 'Error', content: <ErrorSection event={event} /> });
    }
    return fixedTabs;
  }, [event, state.sources, state.openJourney]);

  // Legacy Remediation Slice 8 - migrated onto the shared shortcut
  // registry (one document listener for the whole app). EventInspector is
  // always mounted (App.tsx renders it unconditionally), so these three
  // register once, for the app's lifetime, and are therefore always
  // listed in the shortcuts-help popover - `state.selectedEvent`/
  // `hasPreviousEvent`/`hasNextEvent` are read fresh via `stateRef` at
  // keypress time and gate each `test`, so a keypress genuinely does
  // nothing while the inspector is closed or already at a bound.
  const stateRef = useRef(state);
  stateRef.current = state;

  useShortcut({
    id: 'inspector.close',
    keys: 'Esc',
    description: 'Close the inspector',
    group: 'Results & inspector',
    // Escape must dismiss even while a text input inside the inspector
    // (e.g. All Fields' own search box) has focus - unchanged from the
    // pre-Slice-8 behavior, which never guarded Escape with isTypingTarget
    // (only "["/"]" were guarded).
    allowWhileTyping: true,
    /*
     * UX-R6 §13 - but it must NOT fire while a more transient layer is
     * open on top of the inspector. Popovers (a row's Actions menu, the
     * surrounding-logs confirm step, a filter popover) register with
     * `useDismissableLayer`, whose own stack already ensures only the
     * topmost of *them* reacts to Escape. This shortcut lives outside
     * that stack, so before UX-R6 one Escape closed the menu **and** the
     * inspector beneath it - measured in the real app, and the reason
     * this guard exists.
     */
    test: (e) =>
      e.key === 'Escape' && stateRef.current.selectedEvent != null && !wasConsumedByDismissableLayer(e),
    onTrigger: () => stateRef.current.closeInspector(),
  });

  useShortcut({
    id: 'inspector.previous',
    keys: '[',
    description: 'Previous event (while the inspector is open)',
    group: 'Results & inspector',
    // Deliberately not ArrowLeft, which the resize handle already binds
    // locally to widen/narrow the panel - a document-level listener here
    // would otherwise double-fire alongside it whenever the handle has focus.
    test: (e) => e.key === '[' && stateRef.current.selectedEvent != null && stateRef.current.hasPreviousEvent,
    onTrigger: () => stateRef.current.selectPreviousEvent(),
  });

  useShortcut({
    id: 'inspector.next',
    keys: ']',
    description: 'Next event (while the inspector is open)',
    group: 'Results & inspector',
    test: (e) => e.key === ']' && stateRef.current.selectedEvent != null && stateRef.current.hasNextEvent,
    onTrigger: () => stateRef.current.selectNextEvent(),
  });

  if (!event) {
    return null;
  }

  return (
    <>
      <div className={styles.backdrop} onClick={state.closeInspector} aria-hidden="true" />
      <div
        ref={containerRef}
        className={styles.panel}
        style={{ width: panel.width }}
        role="dialog"
        aria-modal="false"
        aria-label="Event details"
      >
        <div
          className={styles.resizeHandle}
          onPointerDown={panel.onPointerDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize event details panel"
          aria-valuenow={panel.width}
          aria-valuemin={MIN_PANEL_WIDTH}
          aria-valuemax={MAX_PANEL_WIDTH}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              panel.nudge(16);
            } else if (e.key === 'ArrowRight') {
              panel.nudge(-16);
            }
          }}
        />
        <InspectorHeader
          event={event}
          hasPrevious={state.hasPreviousEvent}
          hasNext={state.hasNextEvent}
          onPrevious={state.selectPreviousEvent}
          onNext={state.selectNextEvent}
          onClose={state.closeInspector}
          closeButtonRef={closeButtonRef}
          position={
            state.selectedIndex != null && loadedCount > 0
              ? { index: state.selectedIndex + 1, total: loadedCount }
              : null
          }
          onShowContext={() => state.showContext(event)}
          onCreateTagRule={() => state.openClassificationRuleFromEvent(event)}
          onAddExtraction={() => state.openClassificationExtractionFromEvent(event)}
          onViewTrace={event.traceId ? () => state.openJourney('traceId', event.traceId!, event) : undefined}
        />
        <InspectorTabs tabs={tabs} activeTabId={activeTabId} onActiveTabChange={setActiveTabId} />
      </div>
    </>
  );
}
