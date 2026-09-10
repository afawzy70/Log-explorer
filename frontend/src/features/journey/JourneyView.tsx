import { Fragment } from 'react';
import type { SearchState } from '../../app/useSearchState';
import { Button } from '../../shared/ui/Button';
import { JourneyEntryRow } from './JourneyEntryRow';
import { JOURNEY_FIELD_LABELS, countDistinctServices, countDistinctTraces } from './journeyFields';
import { detectGaps, formatGapDuration } from '../results/gapDetection';
import { formatUtcTimestamp } from '../inspector/timestampFormat';
import styles from './JourneyView.module.css';

/**
 * The journey/trace/correlation/event timeline (IMPLEMENTATION_PLAN.md
 * "Phase I", HANDOVER.md §17) - "the core value proposition: follow a
 * request or journey across services." Renders in place of `ResultsPanel`
 * (see `App.tsx`) whenever `state.journeyQuery` is set; "preserves and
 * restores the original search state" holds by construction here, since
 * opening/closing this view never touches `searchResult` or any toolbar
 * filter at all (see `useSearchState.ts#openJourney`'s own comment).
 */
export function JourneyView({ state }: { state: SearchState }) {
  const query = state.journeyQuery;
  if (!query) {
    return null;
  }

  const events = state.journeyResult?.events ?? [];
  // Legacy Remediation Slice 6 - the backend already returns journey
  // events ascending by timestamp (SearchController#journey), so this is
  // safe to compute directly on `events` with no re-sort of its own.
  const gaps = detectGaps(events);
  const gapsByAfterIndex = new Map(gaps.map((g) => [g.afterIndex, g]));
  const errorCount = events.filter((e) => e.severity?.toUpperCase() === 'ERROR').length;
  const warnCount = events.filter((e) => e.severity?.toUpperCase() === 'WARN').length;
  const timestamped = events.filter((e): e is typeof e & { timestamp: string } => e.timestamp != null);
  const firstTimestamp = timestamped[0]?.timestamp ?? null;
  const lastTimestamp = timestamped[timestamped.length - 1]?.timestamp ?? null;
  const truncated = state.journeyResult?.counts.truncated ?? false;

  return (
    <div className={styles.wrapper} data-testid="journey-view">
      <div className={styles.header}>
        <Button variant="ghost" onClick={state.closeJourney}>
          ← Back to search results
        </Button>
        <h1 className={styles.title}>
          {JOURNEY_FIELD_LABELS[query.field]}: <span className={styles.value}>{query.value}</span>
        </h1>
      </div>

      {state.journeyError ? (
        <div className={styles.error} role="alert">
          {state.journeyError}
        </div>
      ) : state.journeyLoading ? (
        <p className={styles.status} role="status">
          Loading timeline…
        </p>
      ) : events.length === 0 ? (
        <p className={styles.empty}>
          No events found for this {JOURNEY_FIELD_LABELS[query.field].toLowerCase()} ID in the current source and time
          range.
        </p>
      ) : (
        <>
          <p className={styles.summary}>
            {events.length} event{events.length === 1 ? '' : 's'} across {countDistinctServices(events)} service
            {countDistinctServices(events) === 1 ? '' : 's'}
            {countDistinctTraces(events) > 1 ? ` and ${countDistinctTraces(events)} traces` : ''}, same source, ascending
            by timestamp. Using {JOURNEY_FIELD_LABELS[query.field].toLowerCase()} correlation.
          </p>
          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt>Errors</dt>
              <dd>{errorCount}</dd>
            </div>
            <div className={styles.stat}>
              <dt>Warnings</dt>
              <dd>{warnCount}</dd>
            </div>
            {firstTimestamp && lastTimestamp ? (
              <div className={styles.stat}>
                <dt>First → Last</dt>
                <dd>
                  {formatUtcTimestamp(firstTimestamp)} → {formatUtcTimestamp(lastTimestamp)}
                </dd>
              </div>
            ) : null}
            <div className={styles.stat}>
              <dt>Gaps</dt>
              <dd>{gaps.length}</dd>
            </div>
          </dl>
          {truncated ? (
            <p className={styles.incompleteNotice} role="status">
              ⚠ Results may be incomplete — this source returned a bounded subset (limit reached).
            </p>
          ) : null}
          <p className={styles.disclaimer} role="note">
            Ordered by timestamp — this does not indicate causality between events. A detected gap means no event was
            observed in that interval, not evidence that anything failed.
          </p>
          <ol className={styles.list}>
            {events.map((event, index) => {
              const gap = gapsByAfterIndex.get(index);
              return (
                // eslint-disable-next-line react/no-array-index-key
                <Fragment key={index}>
                  <JourneyEntryRow event={event} />
                  {gap ? (
                    <li className={styles.gapMarker} data-testid="journey-gap-marker">
                      Gap detected — {formatGapDuration(gap.durationMs)} with no observed events ({formatUtcTimestamp(gap.fromTimestamp)} →{' '}
                      {formatUtcTimestamp(gap.toTimestamp)})
                    </li>
                  ) : null}
                </Fragment>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
