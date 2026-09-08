import type { SearchState } from '../../app/useSearchState';
import { Button } from '../../shared/ui/Button';
import { JourneyEntryRow } from './JourneyEntryRow';
import { JOURNEY_FIELD_LABELS, countDistinctServices, countDistinctTraces } from './journeyFields';
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
            by timestamp.
          </p>
          <p className={styles.disclaimer} role="note">
            Ordered by timestamp — this does not indicate causality between events.
          </p>
          <ol className={styles.list}>
            {events.map((event, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <JourneyEntryRow key={index} event={event} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
