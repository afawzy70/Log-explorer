import { useEffect, useRef } from 'react';
import type { SearchState } from '../../app/useSearchState';
import { useShortcut } from '../../shared/keyboard/ShortcutRegistry';
import { InspectorHeader } from './InspectorHeader';
import { OverviewSection } from './OverviewSection';
import { ActorClientSection } from './ActorClientSection';
import { RequestFlowSection } from './RequestFlowSection';
import { BusinessErrorSection } from './BusinessErrorSection';
import { AllFieldsSection } from './AllFieldsSection';
import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, useResizablePanel } from './useResizablePanel';
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
    test: (e) => e.key === 'Escape' && stateRef.current.selectedEvent != null,
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
        <div className={styles.body}>
          <OverviewSection event={event} sources={state.sources} />
          <ActorClientSection event={event} />
          <RequestFlowSection event={event} onOpenJourney={state.openJourney} />
          <BusinessErrorSection event={event} />
          <AllFieldsSection event={event} sources={state.sources} />
        </div>
      </div>
    </>
  );
}
