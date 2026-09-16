import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchState } from '../../app/useSearchState';
import { useShortcut } from '../../shared/keyboard/ShortcutRegistry';
import { InspectorHeader } from './InspectorHeader';
import { OverviewSection } from './OverviewSection';
import { ActorClientSection } from './ActorClientSection';
import { RequestFlowSection } from './RequestFlowSection';
import { BusinessErrorSection } from './BusinessErrorSection';
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
   * Current, applied decision: all five primary tabs (Overview, Actor &
   * client, Request flow, Business / error, Technical / all fields) are
   * ALWAYS present, for every event, with no conditional inclusion logic
   * at all. Each section component already renders its own honest
   * `EmptySectionNote` when its own field-builder returns nothing
   * (`ActorClientSection`/`RequestFlowSection`/`BusinessErrorSection`,
   * unchanged by this fix) - so this list is now a fixed, five-entry
   * structural constant, and the "is this section empty" decision lives
   * entirely inside each section itself, never here. "Trace /
   * Correlation" remains unified into "Request Flow" (unchanged from the
   * first recovery): this product's data model has no fields
   * distinguishing the two.
   */
  const tabs: InspectorTab[] = useMemo(() => {
    if (!event) return [];
    return [
      { id: 'overview', label: 'Overview', content: <OverviewSection event={event} sources={state.sources} /> },
      { id: 'actor', label: 'Actor & client', content: <ActorClientSection event={event} /> },
      {
        id: 'requestFlow',
        label: 'Request flow',
        content: <RequestFlowSection event={event} onOpenJourney={state.openJourney} />,
      },
      { id: 'businessError', label: 'Business / error', content: <BusinessErrorSection event={event} /> },
      {
        id: 'allFields',
        label: 'Technical / all fields',
        content: <AllFieldsSection event={event} sources={state.sources} />,
      },
    ];
  }, [event, state.sources, state.openJourney]);

  const [activeTabId, setActiveTabId] = useState('overview');
  // A newly-selected event (Previous/Next, or opening a different row)
  // always starts back on Overview - staying on e.g. "Business / error"
  // while stepping onto an event with no error would either show a stale
  // tab that no longer exists for this event, or a misleadingly-empty one.
  useEffect(() => {
    setActiveTabId('overview');
  }, [state.selectedIndex]);

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
        />
        <InspectorTabs tabs={tabs} activeTabId={activeTabId} onActiveTabChange={setActiveTabId} />
      </div>
    </>
  );
}
