import type { LogEvent } from '../../shared/api/types';
import type { CommittedTimeRange } from '../timerange/types';
import { formatInterval } from '../../shared/time/interval';
import { localZoneLabel } from '../inspector/timestampFormat';
import { countDistinctServices } from '../journey/journeyFields';
import styles from './ContextSummary.module.css';

/**
 * "Show ±30 seconds" context summary (UI Parity Acceleration Pass §8 -
 * OLD's own context workflow showed event/service/error counts, the
 * bounded duration/window with timezone, and an explicit non-causality
 * note; the pre-Slice-4-parity-pass implementation only showed a one-line
 * breadcrumb label, none of these). Rendered only while
 * `state.breadcrumbLabel` is set - the exact, sole signal
 * `useSearchState.ts#showContext` sets and every other flow leaves `null`
 * (see that hook's own comment) - so this never appears above an ordinary
 * historical search result.
 *
 * <p><b>Chronological ascending</b> (UI Gap Closure Pass - what happened
 * before the event, the event itself, what happened after): unlike the
 * main results table's own fixed newest-first invariant (CLAUDE.md §4),
 * which is unchanged. `useSearchState.ts#showContext`/`#loadMore` do the
 * actual sorting (re-sorting the whole bounded context set again after
 * every "Load more", never trusting append order alone) - this component
 * only ever renders whatever order it's given.
 */
export function ContextSummary({ events, range }: { events: LogEvent[]; range: CommittedTimeRange | null }) {
  const errorCount = events.filter((e) => e.severity?.toUpperCase() === 'ERROR').length;
  const serviceCount = countDistinctServices(events);

  return (
    <div className={styles.wrapper} role="note" aria-label="Surrounding-context summary">
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>Events</dt>
          <dd>{events.length}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Services</dt>
          <dd>{serviceCount}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Errors</dt>
          <dd>{errorCount}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Window</dt>
          <dd>60 seconds (±30s)</dd>
        </div>
        {range ? (
          <div className={styles.stat}>
            <dt>Range</dt>
            <dd>
              {formatInterval(range.start, range.end)} ({localZoneLabel(range.start)})
            </dd>
          </div>
        ) : null}
      </dl>
      <p className={styles.disclaimer}>
        Sorted chronologically, oldest first — this order does not indicate causality between events. The highlighted
        row below is the original event you were investigating.
      </p>
    </div>
  );
}
