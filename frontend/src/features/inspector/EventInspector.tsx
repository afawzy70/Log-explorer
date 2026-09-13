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
import { buildActorClientFields, buildBusinessErrorFields, buildRequestFlowIdentifiers } from './sections';
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
   * Pre-closure functional recovery (§4): tabs are computed per event,
   * hiding a tab entirely when its section has no data to show ("Do NOT
   * display empty meaningless tabs" - mission §4/§8). Overview and
   * All Fields are never meaningfully empty (buildOverviewFields always
   * returns Message/Time/Source/Service/Level/Logger; canonical fields
   * always exist), so they are always present. "Trace / Correlation" is
   * deliberately unified into "Request Flow" rather than duplicated as a
   * separate tab - this product's data model has no fields distinguishing
   * the two (both are exactly journeyId/correlationId/traceId/spanId/
   * eventId), and showing the identical five rows twice under two tab
   * labels would itself be the kind of confusing, non-data-driven
   * grouping this recovery mission exists to fix.
   */
  const tabs: InspectorTab[] = useMemo(() => {
    if (!event) return [];
    const list: InspectorTab[] = [
      { id: 'overview', label: 'Overview', content: <OverviewSection event={event} sources={state.sources} /> },
    ];
    if (buildActorClientFields(event).length > 0) {
      list.push({ id: 'actor', label: 'Actor & client', content: <ActorClientSection event={event} /> });
    }
    if (buildRequestFlowIdentifiers(event).length > 0) {
      list.push({
        id: 'requestFlow',
        label: 'Request flow',
        content: <RequestFlowSection event={event} onOpenJourney={state.openJourney} />,
      });
    }
    if (buildBusinessErrorFields(event).length > 0 || event.exception) {
      list.push({ id: 'businessError', label: 'Business / error', content: <BusinessErrorSection event={event} /> });
    }
    list.push({
      id: 'allFields',
      label: 'Technical / all fields',
      content: <AllFieldsSection event={event} sources={state.sources} />,
    });
    return list;
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
        />
        <InspectorTabs tabs={tabs} activeTabId={activeTabId} onActiveTabChange={setActiveTabId} />
      </div>
    </>
  );
}
