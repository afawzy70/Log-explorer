import { useEffect, useRef } from 'react';
import type { SearchState } from '../../app/useSearchState';
import { isTypingTarget } from '../../shared/keyboard/isTypingTarget';
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

  useEffect(() => {
    if (event) {
      closeButtonRef.current?.focus();
    }
  }, [event]);

  useEffect(() => {
    if (!event) {
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        state.closeInspector();
        return;
      }
      // "[" / "]" previous/next (UI Parity Acceleration Pass §10 -
      // deliberately not ArrowLeft/ArrowRight, which the resize handle
      // already binds locally to widen/narrow the panel; a global
      // listener here would otherwise double-fire alongside it whenever
      // the handle has focus. Guarded against typing targets so it never
      // hijacks a literal "[" typed into All Fields' own search box.
      if (isTypingTarget(e.target)) {
        return;
      }
      if (e.key === '[' && state.hasPreviousEvent) {
        state.selectPreviousEvent();
      } else if (e.key === ']' && state.hasNextEvent) {
        state.selectNextEvent();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

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
        />
        <div className={styles.body}>
          <OverviewSection event={event} sources={state.sources} />
          <ActorClientSection event={event} />
          <RequestFlowSection
            event={event}
            onOpenJourney={state.openJourney}
            onShowContext={() => state.showContext(event)}
          />
          <BusinessErrorSection event={event} />
          <AllFieldsSection event={event} sources={state.sources} />
        </div>
      </div>
    </>
  );
}
