import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { LogEvent } from '../../shared/api/types';
import { eventIdentity } from '../../app/useSearchState';
import { SeverityMark } from '../../shared/ui/SeverityMark';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { MessageCell } from '../results/MessageCell';
import { EMPTY_VALUE, formatTimestampCell, resolveService } from '../results/columnMapping';
import { ContextAction } from '../inspector/ContextAction';
import { colorForService } from './serviceColor';
import { formatOffsetLabel } from './timelineTicks';
import type { GapMarker } from '../results/gapDetection';
import { formatGapDuration } from '../results/gapDetection';
import { formatUtcTimestamp } from '../inspector/timestampFormat';
import styles from './SequenceTable.module.css';

export interface SequenceTableProps {
  events: LogEvent[];
  /** The offset column measures from this timestamp (ms since epoch) - the first event's own timestamp. */
  startMs: number;
  rootIdentity: string | null;
  gaps: GapMarker[];
  onShowContext: (event: LogEvent) => void;
  /** The last identifying column before Actions - what it shows depends on the relation type (Trace/Span ID text, or a Journey's own trace-index tag), decided by the caller. */
  identifierColumn: {
    header: string;
    render: (event: LogEvent) => ReactNode;
  };
  ariaLabel: string;
}

/**
 * B5 Investigation - the sequence table (`COMPONENT_INVENTORY.md`'s `JourneyEntryRow.tsx` REPLACE_VISUALLY
 * entry: "Card row becomes a table row (time, offset, service swatch, level, step, message, trace/span,
 * action)"). Reuses `MessageCell`/`ContextAction`/`SeverityMark` directly rather than re-implementing malformed-
 * row handling, the Show Surroundings confirm flow, or the severity shape language a second time.
 *
 * <p>This is a distinct primitive from `ResultsTable` (the main search-results table), matching the design's own
 * `table.seq` (Offset + Business step columns, no per-row selection) vs `table.results` (the design's own
 * Context/Surroundings view instead reuses `ResultsTable` unchanged - see `JourneyView.tsx`'s own comment for
 * why the split follows the design's own two distinct table markups, not an arbitrary choice).
 */
export function SequenceTable({ events, startMs, rootIdentity, gaps, onShowContext, identifierColumn, ariaLabel }: SequenceTableProps) {
  const gapsByAfterIndex = new Map(gaps.map((g) => [g.afterIndex, g]));

  return (
    <div className={styles.scrollWrapper}>
      <table className={styles.table} aria-label={ariaLabel}>
        <colgroup>
          <col className={styles.colTime} />
          <col className={styles.colOffset} />
          <col className={styles.colService} />
          <col className={styles.colLevel} />
          <col className={styles.colStep} />
          <col />
          <col className={styles.colIdentifier} />
          <col className={styles.colActions} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" aria-sort="ascending">
              Time
            </th>
            <th scope="col" className={styles.numeric}>
              Offset
            </th>
            <th scope="col">Service</th>
            <th scope="col">Level</th>
            <th scope="col">Business step</th>
            <th scope="col">What happened</th>
            <th scope="col">{identifierColumn.header}</th>
            <th scope="col">
              <VisuallyHidden>Actions</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => {
            const identity = eventIdentity(event);
            const isRoot = identity === rootIdentity;
            const isError = event.severity?.toUpperCase() === 'ERROR';
            const ms = event.timestamp ? Date.parse(event.timestamp) : null;
            const gap = gapsByAfterIndex.get(index);
            return (
              <Fragment key={identity}>
                <tr
                  className={[styles.row, isError ? styles.rowError : '', isRoot ? styles.rowRoot : ''].filter(Boolean).join(' ')}
                  aria-current={isRoot ? 'location' : undefined}
                >
                  <td className={styles.timeCell}>
                    <SeverityMark severity={event.severity} />
                    {isRoot ? (
                      <>
                        <span className={styles.triggerRing} aria-hidden="true" />
                        <VisuallyHidden>Selected event, </VisuallyHidden>
                      </>
                    ) : null}
                    <span className={styles.mono}>{formatTimestampCell(event.timestamp)}</span>
                  </td>
                  <td className={`${styles.numeric} ${styles.mono}`}>
                    {ms != null && !Number.isNaN(ms) ? formatOffsetLabel(ms - startMs) : EMPTY_VALUE}
                  </td>
                  <td>
                    <span className={styles.serviceCell}>
                      <span className={styles.swatch} style={{ background: colorForService(event.service) }} aria-hidden="true" />
                      {resolveService(event)}
                    </span>
                  </td>
                  <td>
                    <span className={styles.level}>{event.severity ?? EMPTY_VALUE}</span>
                  </td>
                  <td className={styles.mono}>{event.businessStep ?? EMPTY_VALUE}</td>
                  <td>
                    <MessageCell event={event} />
                  </td>
                  <td>{identifierColumn.render(event)}</td>
                  <td className={styles.actionsCell}>
                    <ContextAction event={event} onConfirm={() => onShowContext(event)} />
                  </td>
                </tr>
                {gap ? (
                  <tr className={styles.gapRow} data-testid="journey-gap-marker">
                    <td colSpan={8}>
                      Gap detected — {formatGapDuration(gap.durationMs)} with no observed events ({formatUtcTimestamp(gap.fromTimestamp)} →{' '}
                      {formatUtcTimestamp(gap.toTimestamp)})
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
