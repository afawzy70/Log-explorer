import type { RefObject } from 'react';
import type { LogEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { SEVERITY_LEVELS } from '../search/severityLevels';
import { resolveService } from '../results/columnMapping';
import { deriveInspectorTitle } from './title';
import { ContextAction } from './ContextAction';
import styles from './InspectorHeader.module.css';

function levelColor(severity: string | null): string | undefined {
  return SEVERITY_LEVELS.find((l) => l.id === severity?.toUpperCase())?.colorVar;
}

export interface InspectorHeaderProps {
  event: LogEvent;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  /**
   * UX-R5 §5 - 1-based position of this event within the **currently
   * loaded** result set, and that set's size. Deliberately not a global
   * position: the backend reports `total` as unknown for several sources
   * and "more available" is normal, so claiming "event 4 of 12,000" would
   * be an invention. The rendered copy says "loaded" for exactly that
   * reason (§5: "If only loaded-set position is known, say so
   * truthfully").
   */
  position: { index: number; total: number } | null;
  /**
   * UX-R5 §14 - the single, inspector-level "Show surrounding logs"
   * action. It lives here, in the sticky header, rather than inside one
   * section, so it is reachable from anywhere in the panel without the
   * investigator having to remember which section it hides in.
   */
  onShowContext: () => void;
  /** Event Classification & Extraction Rules - opens the rules workspace in create-from-event mode for this event. */
  onCreateTagRule?: () => void;
  /** Only meaningful for an event that already has classifications - it extends one of the rules that matched. */
  onAddExtraction?: () => void;
  /**
   * DRIFT-003 remediation - the approved design keeps "View Trace" reachable as a persistent top-level
   * Inspector action (not only inside the Request Flow tab, which still keeps its own copy of every
   * identifier's own action - this is an additional entry point, not a move). Only present when the
   * event actually has a traceId; undefined (not a disabled button) when it doesn't, matching how
   * RequestFlowSection's own identifier list already omits an action row for a field with no value.
   */
  onViewTrace?: () => void;
}

/** "Header: severity, service, title derived from message/error code. No invented diagnosis or root cause." (HANDOVER.md §16.1) */
export function InspectorHeader({
  event,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onClose,
  closeButtonRef,
  position,
  onShowContext,
  onCreateTagRule,
  onAddExtraction,
  onViewTrace,
}: InspectorHeaderProps) {
  const isClassified = event.classifications.length > 0;
  const color = levelColor(event.severity);
  return (
    <div className={styles.header}>
      {/*
       * B4 (Session 4) - restyled to the design's own `.insp-meta`/`.insp-title`/`.insp-actions` grouping
       * (prototype/scripts/app.js's `inspector()` render function): level+service on the meta line with
       * Close at its trailing edge, the title with a decorative "this is the event you're inspecting"
       * crosshair mark, then one actions row with the classification/context buttons on the leading edge
       * and Previous/Next/position grouped at the trailing edge. Presentation only - every prop, aria-label,
       * button behaviour, and visible copy is unchanged from before this restyle; only DOM grouping and
       * visual treatment moved. Deliberately does NOT add the design's own date/time to the meta line -
       * that's new displayed data, not a restyle, and out of this bounded pass's scope.
       */}
      <div className={styles.meta}>
        <span className={styles.levelBadge}>
          {color ? <span className={styles.levelDot} style={{ background: color }} aria-hidden="true" /> : null}
          {event.severity ?? 'UNKNOWN'}
        </span>
        <span className={styles.dotSep} aria-hidden="true" />
        <span className={styles.service}>{resolveService(event)}</span>
        <Button ref={closeButtonRef} variant="ghost" className={styles.closeButton} onClick={onClose}>
          <VisuallyHidden>Close event inspector</VisuallyHidden>
          <Icon name="x" size="sm" />
        </Button>
      </div>
      <h1 className={styles.title}>
        <Icon name="crosshair" size="sm" className={styles.titleIcon} />
        <span>{deriveInspectorTitle(event)}</span>
      </h1>
      <div className={styles.actions}>
        <ContextAction event={event} onConfirm={onShowContext} />
        {onViewTrace ? (
          <Button variant="ghost" onClick={onViewTrace}>
            View Trace
          </Button>
        ) : null}
        {/*
          * Owner mission §"Inspector action semantics": one action never means two things. An unclassified event
          * offers only rule creation; a classified one offers extending a rule that already matched it, and
          * says "another" where it would otherwise read as the same action.
          */}
        {onAddExtraction && isClassified ? (
          <Button variant="ghost" onClick={onAddExtraction}>
            Add extraction from this event
          </Button>
        ) : null}
        {onCreateTagRule ? (
          <Button variant="ghost" onClick={onCreateTagRule}>
            {isClassified ? 'Create another tag rule' : 'Create tag rule from this event'}
          </Button>
        ) : null}
        <div className={styles.nav}>
          {position ? (
            /*
             * Announced politely rather than assertively: it changes on every
             * Previous/Next, and an assertive live region would interrupt a
             * screen-reader user mid-sentence on each step.
             */
            <span className={styles.position} aria-live="polite">
              Event {position.index} of {position.total} loaded
            </span>
          ) : null}
          <Button variant="ghost" onClick={onPrevious} disabled={!hasPrevious} aria-label="Previous event">
            ← Previous
          </Button>
          <Button variant="ghost" onClick={onNext} disabled={!hasNext} aria-label="Next event">
            Next →
          </Button>
        </div>
      </div>
    </div>
  );
}
