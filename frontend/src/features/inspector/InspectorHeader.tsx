import type { RefObject } from 'react';
import type { LogEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
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
}: InspectorHeaderProps) {
  const color = levelColor(event.severity);
  return (
    <div className={styles.header}>
      <div className={styles.badgeRow}>
        <span className={styles.levelBadge}>
          {color ? <span className={styles.levelDot} style={{ background: color }} aria-hidden="true" /> : null}
          {event.severity ?? 'UNKNOWN'}
        </span>
        <span className={styles.service}>{resolveService(event)}</span>
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
      </div>
      <h1 className={styles.title}>{deriveInspectorTitle(event)}</h1>
      <div className={styles.nav}>
        <div className={styles.navGroup}>
          <Button variant="ghost" onClick={onPrevious} disabled={!hasPrevious} aria-label="Previous event">
            ← Previous
          </Button>
          <Button variant="ghost" onClick={onNext} disabled={!hasNext} aria-label="Next event">
            Next →
          </Button>
          <ContextAction event={event} onConfirm={onShowContext} />
        </div>
        <Button ref={closeButtonRef} variant="ghost" onClick={onClose}>
          <VisuallyHidden>Close event inspector</VisuallyHidden>
          <span aria-hidden="true">✕</span>
        </Button>
      </div>
    </div>
  );
}
