import type { LogEvent } from '../../shared/api/types';
import { EMPTY_VALUE, formatTimestampCell, resolveService } from '../results/columnMapping';
import { SEVERITY_LEVELS } from '../search/severityLevels';
import { colorForService } from './serviceColor';
import styles from './JourneyEntryRow.module.css';

function levelColor(severity: string | null): string | undefined {
  return SEVERITY_LEVELS.find((l) => l.id === severity?.toUpperCase())?.colorVar;
}

/**
 * One timeline entry (HANDOVER.md §17 "display: timestamp, service,
 * level, business step, message, trace/span, and event/protocol metadata
 * (incl. JMS event correlation) when available"). The service color bar
 * is a visual aid only - the service name is always printed as text too
 * (never color alone, CLAUDE.md §7).
 */
export function JourneyEntryRow({ event }: { event: LogEvent }) {
  const color = colorForService(event.service);
  const levelColorVar = levelColor(event.severity);
  const message = event.malformed ? (event.rawLine ?? EMPTY_VALUE) : (event.message ?? EMPTY_VALUE);

  return (
    <li className={styles.entry} style={{ borderLeftColor: color }}>
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
      </div>
      <p className={styles.message}>{message}</p>
      <div className={styles.metaRow}>
        {event.traceId ? <span className={styles.metaItem}>Trace: {event.traceId}</span> : null}
        {event.spanId ? <span className={styles.metaItem}>Span: {event.spanId}</span> : null}
        {event.correlationId ? <span className={styles.metaItem}>Correlation: {event.correlationId}</span> : null}
        {event.eventId ? <span className={styles.metaItem}>Event: {event.eventId}</span> : null}
      </div>
    </li>
  );
}
