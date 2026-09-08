import type { RefObject } from 'react';
import type { LogEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { SEVERITY_LEVELS } from '../search/severityLevels';
import { resolveService } from '../results/columnMapping';
import { deriveInspectorTitle } from './title';
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
      </div>
      <h1 className={styles.title}>{deriveInspectorTitle(event)}</h1>
      <div className={styles.nav}>
        <Button variant="ghost" onClick={onPrevious} disabled={!hasPrevious} aria-label="Previous event">
          ← Previous
        </Button>
        <Button variant="ghost" onClick={onNext} disabled={!hasNext} aria-label="Next event">
          Next →
        </Button>
        <Button ref={closeButtonRef} variant="ghost" onClick={onClose}>
          <VisuallyHidden>Close event inspector</VisuallyHidden>
          <span aria-hidden="true">✕</span>
        </Button>
      </div>
    </div>
  );
}
