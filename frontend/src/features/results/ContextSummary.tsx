import type { LogEvent, ResultCounts } from '../../shared/api/types';
import type { CommittedTimeRange } from '../timerange/types';
import { formatInterval } from '../../shared/time/interval';
import { localZoneLabel, formatUtcTimestamp } from '../inspector/timestampFormat';
import { countDistinctServices } from '../journey/journeyFields';
import { detectGaps, formatGapDuration } from './gapDetection';
import type { GapMarker } from './gapDetection';
import { eventIdentity } from '../../app/useSearchState';
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
 *
 * <p><b>Legacy Remediation Slice 6</b> adds: Warnings (WARN severity
 * count), the observed span between the first and last event (distinct
 * from "Window", which is the fixed ±30s request bound - the observed span
 * can be smaller when data is sparse, itself a completeness signal),
 * Source, a gap count + list ("gap detected", never "missing"/"broken" -
 * see `gapDetection.ts`'s own doc comment on why), and an honest
 * incomplete-results notice when `counts.truncated` is true. `gaps` is
 * passed in (computed once by the caller, `ResultsPanel.tsx`) rather than
 * recomputed here, so it is derived exactly once and shared with
 * `ResultsTable`'s own inline gap markers - never two different gap counts
 * disagreeing with each other.
 *
 * <p><b>OS-1D</b> adds a truthful "root not found" notice: `rootIdentity`
 * (the same {@link eventIdentity} value `ResultsTable` marks its own
 * highlighted row with) is checked against the returned `events` here too,
 * so a root event that has aged out of the source's own retained window -
 * always possible for OpenShift's rolling pod logs, and never previously
 * surfaced as anything other than "no row happens to be highlighted" - now
 * says so explicitly (mission §9 "return ROOT_NOT_FOUND ... Context can
 * still show nearby evidence" / §36 "Root unavailable" must be its own
 * distinct state, never collapsed into "No results").
 */
export function ContextSummary({
  events,
  range,
  source = null,
  counts = null,
  gaps,
  rootIdentity = null,
}: {
  events: LogEvent[];
  range: CommittedTimeRange | null;
  source?: string | null;
  counts?: ResultCounts | null;
  gaps?: GapMarker[];
  rootIdentity?: string | null;
}) {
  const errorCount = events.filter((e) => e.severity?.toUpperCase() === 'ERROR').length;
  const warnCount = events.filter((e) => e.severity?.toUpperCase() === 'WARN').length;
  const serviceCount = countDistinctServices(events);
  const resolvedGaps = gaps ?? detectGaps(events);
  const rootFound = rootIdentity == null || events.some((e) => eventIdentity(e) === rootIdentity);

  const timestamped = events.filter((e): e is LogEvent & { timestamp: string } => e.timestamp != null);
  const observedSpanMs =
    timestamped.length >= 2
      ? Date.parse(timestamped[timestamped.length - 1].timestamp) - Date.parse(timestamped[0].timestamp)
      : null;

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
          <dt>Warnings</dt>
          <dd>{warnCount}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Window</dt>
          <dd>60 seconds (±30s)</dd>
        </div>
        {observedSpanMs != null ? (
          <div className={styles.stat}>
            <dt>Observed span</dt>
            <dd>{observedSpanMs === 0 ? '0s' : formatGapDuration(observedSpanMs)}</dd>
          </div>
        ) : null}
        {range ? (
          <div className={styles.stat}>
            <dt>Range</dt>
            <dd>
              {formatInterval(range.start, range.end)} ({localZoneLabel(range.start)})
            </dd>
          </div>
        ) : null}
        {source ? (
          <div className={styles.stat}>
            <dt>Source</dt>
            <dd>{source}</dd>
          </div>
        ) : null}
        <div className={styles.stat}>
          <dt>Gaps</dt>
          <dd>{resolvedGaps.length}</dd>
        </div>
      </dl>

      {counts?.truncated ? (
        <p className={styles.incompleteNotice} role="status">
          ⚠ Results may be incomplete — this source returned a bounded subset (limit reached).
        </p>
      ) : null}

      {!rootFound ? (
        <p className={styles.incompleteNotice} role="status">
          ⚠ The original event is no longer available from this source — showing nearby evidence only. It may have
          aged out of the retained log window since your original search.
        </p>
      ) : null}

      {resolvedGaps.length > 0 ? (
        <div className={styles.gapsList}>
          <p className={styles.gapsListTitle}>
            {resolvedGaps.length} sequence gap{resolvedGaps.length === 1 ? '' : 's'} detected:
          </p>
          <ul>
            {resolvedGaps.map((gap) => (
              <li key={`${gap.fromTimestamp}-${gap.toTimestamp}`}>
                {formatGapDuration(gap.durationMs)} with no observed events between {formatUtcTimestamp(gap.fromTimestamp)} and{' '}
                {formatUtcTimestamp(gap.toTimestamp)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className={styles.disclaimer}>
        Sorted chronologically, oldest first — this order does not indicate causality between events.{' '}
        {rootFound
          ? 'The highlighted row below is the original event you were investigating.'
          : 'The original event itself could not be re-identified below - these are correlated/nearby events only.'}{' '}
        A detected gap means no event was observed in that interval - it is not evidence that anything failed.
      </p>
    </div>
  );
}
