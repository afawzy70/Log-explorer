import type { Ref } from 'react';
import type { LogEvent } from '../../shared/api/types';
import { EMPTY_VALUE, formatTimestampCell, resolveService } from '../results/columnMapping';
import { SEVERITY_LEVELS } from '../search/severityLevels';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { ContextAction } from '../inspector/ContextAction';
import { colorForService } from './serviceColor';
import styles from './JourneyEntryRow.module.css';

function levelColor(severity: string | null): string | undefined {
  return SEVERITY_LEVELS.find((l) => l.id === severity?.toUpperCase())?.colorVar;
}

export interface JourneyEntryRowProps {
  event: LogEvent;
  /**
   * Owner mission "Mapping Verification and Investigation Workspace" -
   * "Root event anchoring": true for the one entry (if any) matching
   * `state.journeyRootEvent`'s {@link eventIdentity}, mirroring
   * `ResultsTable`'s own `contextRootIdentity`/`.contextRootRow` pattern
   * exactly, never a second, differently-behaved highlight mechanism.
   */
  isRoot?: boolean;
  /** Only set on the root entry, so the ref/scroll-into-view target is unambiguous - see `JourneyView`'s own effect. */
  rootRef?: Ref<HTMLLIElement>;
  /**
   * "Show Surroundings" launched from within this Trace/Span/Correlation/
   * Journey view (owner mission "Mapping Verification and Investigation
   * Workspace" - required navigation flow "... -> select another event
   * inside Trace -> Show Surroundings -> Back to Trace"). Rendered via the
   * shared {@link ContextAction} component (never a second, differently-
   * behaved implementation of the same confirm-before-run action) -
   * `ContextAction` itself already omits when the event has no timestamp
   * to centre a window on, matching `ActionsCell`'s identical rule.
   */
  onShowContext?: (event: LogEvent) => void;
}

/**
 * One timeline entry (HANDOVER.md §17 "display: timestamp, service,
 * level, business step, message, trace/span, and event/protocol metadata
 * (incl. JMS event correlation) when available"). The service color bar
 * is a visual aid only - the service name is always printed as text too
 * (never color alone, CLAUDE.md §7).
 */
export function JourneyEntryRow({ event, isRoot, rootRef, onShowContext }: JourneyEntryRowProps) {
  const color = colorForService(event.service);
  const levelColorVar = levelColor(event.severity);
  const message = event.malformed ? (event.rawLine ?? EMPTY_VALUE) : (event.message ?? EMPTY_VALUE);

  return (
    <li
      ref={isRoot ? rootRef : undefined}
      className={[styles.entry, isRoot ? styles.rootEntry : null].filter(Boolean).join(' ')}
      style={{ borderLeftColor: color }}
      aria-current={isRoot ? 'location' : undefined}
    >
      <div className={styles.headerRow}>
        <span className={styles.timestamp}>{formatTimestampCell(event.timestamp)}</span>
        <span className={styles.service} style={{ color }}>
          {resolveService(event)}
        </span>
        <span className={styles.level}>
          {levelColorVar ? <span className={styles.levelDot} style={{ background: levelColorVar }} aria-hidden="true" /> : null}
          {event.severity ?? EMPTY_VALUE}
        </span>
        {event.businessStep ? <span className={styles.businessStep}>{event.businessStep}</span> : null}
        {isRoot ? <span className={styles.rootBadge}>Selected event</span> : null}
      </div>
      <p className={styles.message}>{message}</p>
      <div className={styles.metaRow}>
        {event.traceId ? <span className={styles.metaItem}>Trace: {event.traceId}</span> : null}
        {event.spanId ? <span className={styles.metaItem}>Span: {event.spanId}</span> : null}
        {event.correlationId ? <span className={styles.metaItem}>Correlation: {event.correlationId}</span> : null}
        {event.eventId ? <span className={styles.metaItem}>Event: {event.eventId}</span> : null}
        {onShowContext ? <ContextAction event={event} onConfirm={() => onShowContext(event)} /> : null}
      </div>
      {isRoot ? <VisuallyHidden>Original event you were investigating</VisuallyHidden> : null}
    </li>
  );
}
