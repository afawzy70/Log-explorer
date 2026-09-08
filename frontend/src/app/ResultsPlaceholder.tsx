import { Button } from '../shared/ui/Button';
import { formatInterval } from '../shared/time/interval';
import { DEFAULT_PRESET_ID, TIME_RANGE_PRESETS } from '../shared/time/presets';
import type { SearchState } from './useSearchState';
import styles from './ResultsPlaceholder.module.css';

const DAY_MS = TIME_RANGE_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.durationMs;

/**
 * A deliberately minimal results area - message text only, one row per
 * event. The real seven-column semantic table with fixed geometry, exact
 * cell contract, and truthful counts is Phase G's job
 * (IMPLEMENTATION_PLAN.md), not this phase's. This exists only so the
 * toolbar/time-range/search flow built in this phase is demonstrable
 * end-to-end against the real backend.
 */
export function ResultsPlaceholder({ state }: { state: SearchState }) {
  if (state.searchError) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.error} role="alert">
          {state.searchError}
        </div>
      </div>
    );
  }

  if (!state.searchResult) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.empty}>Run a search to see results.</p>
      </div>
    );
  }

  const { events, counts } = state.searchResult;

  if (events.length === 0) {
    const oneDayAgo = new Date(Date.now() - DAY_MS);
    return (
      <div className={styles.wrapper}>
        <p className={styles.empty}>
          No results for this range.{' '}
          <Button
            variant="ghost"
            onClick={() =>
              state.setTimeRange({
                presetId: DEFAULT_PRESET_ID,
                start: oneDayAgo.toISOString(),
                end: new Date().toISOString(),
              })
            }
          >
            Search last 1 day
          </Button>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.summary}>
        {counts.returned} of {counts.estimatedTotal ?? '?'} events
        {counts.truncated ? ' (truncated)' : ''}
        {state.lastSearchedRange
          ? ` — showing results for ${formatInterval(state.lastSearchedRange.start, state.lastSearchedRange.end)}`
          : ''}
      </p>
      {events.map((event, index) => (
        <div key={index} className={styles.row}>
          <span className={styles.time}>{event.timestamp ?? '—'}</span>
          <span>{event.message ?? (event.malformed ? event.rawLine : '(empty message)')}</span>
        </div>
      ))}
    </div>
  );
}
