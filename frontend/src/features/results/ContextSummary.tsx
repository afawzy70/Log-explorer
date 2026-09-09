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
 * note; the pre-pass NEW implementation only showed a one-line breadcrumb
 * label, none of these). Rendered only while `state.breadcrumbLabel` is
 * set - the exact, sole signal `useSearchState.ts#showContext` sets and
 * every other flow leaves `null` (see that hook's own comment) - so this
 * never appears above an ordinary historical search result.
 *
 * <p>Deliberately still newest-first, matching the main results table
 * beneath it and CLAUDE.md §4's own fixed-order invariant, rather than
 * switching to the journey view's ascending order: reordering a page that
 * "Load more" can still append to (via the same cursor-based pagination
 * every other search result uses) risks a silent order/cursor mismatch
 * this pass's own risk budget did not justify - see the UI Parity
 * Acceleration report's own "deferred" section. The note below is honest
 * about this rather than claiming a chronological presentation NEW does
 * not actually have.
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
        Sorted newest first, same as the main results table — this order does not indicate causality between events.
      </p>
    </div>
  );
}
