import { Button } from '../../shared/ui/Button';
import { formatInterval } from '../../shared/time/interval';
import { DEFAULT_PRESET_ID, TIME_RANGE_PRESETS } from '../../shared/time/presets';
import type { SearchState } from '../../app/useSearchState';
import { buildCountsSummary } from './counts';
import { ResultsTable } from './ResultsTable';
import styles from './ResultsPanel.module.css';

const DAY_MS = TIME_RANGE_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.durationMs;

/**
 * "Breadcrumb back to the original search" (HANDOVER.md §16.7/§16.4) -
 * shown above the results in every state (loading/error/empty/results),
 * since a "find related logs" or "show context" detour can legitimately
 * land on any of them (e.g. a context search with zero results is still a
 * detour the investigator needs to back out of).
 */
function Breadcrumb({ state }: { state: SearchState }) {
  if (!state.breadcrumbLabel) {
    return null;
  }
  return (
    <div className={styles.breadcrumb}>
      <span>{state.breadcrumbLabel}</span>
      <Button variant="ghost" onClick={state.restoreOriginalSearch}>
        ← Back to original search
      </Button>
    </div>
  );
}

/**
 * The results area (IMPLEMENTATION_PLAN.md "Phase G" scope item 11):
 * loading, error, empty (with the one-click "Search last 1 day"
 * affordance), and the real seven-column table with its counts summary
 * and single "Load more" pagination control. "Cancelled" is handled as
 * request-supersession protection in `useSearchState`, not a separate
 * visible state here (see its own comment) - there is no Cancel button
 * in this UI to trigger a user-facing cancelled state from.
 */
export function ResultsPanel({ state }: { state: SearchState }) {
  if (state.searchError) {
    return (
      <div className={styles.wrapper}>
        <Breadcrumb state={state} />
        <div className={styles.error} role="alert">
          {state.searchError}
        </div>
      </div>
    );
  }

  if (state.searchLoading) {
    return (
      <div className={styles.wrapper}>
        <Breadcrumb state={state} />
        <p className={styles.loading} role="status">
          Searching…
        </p>
      </div>
    );
  }

  if (!state.searchResult) {
    return (
      <div className={styles.wrapper}>
        <Breadcrumb state={state} />
        <p className={styles.empty}>Run a search to see results.</p>
      </div>
    );
  }

  const { events, counts, nextCursor } = state.searchResult;

  if (events.length === 0) {
    const oneDayAgo = new Date(Date.now() - DAY_MS);
    return (
      <div className={styles.wrapper}>
        <Breadcrumb state={state} />
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
      <Breadcrumb state={state} />
      <div className={styles.summaryRow}>
        <p className={styles.summary}>
          {buildCountsSummary(counts)}
          {state.lastSearchedRange
            ? ` — showing results for ${formatInterval(state.lastSearchedRange.start, state.lastSearchedRange.end)}`
            : ''}
        </p>
      </div>
      <ResultsTable
        events={events}
        selectedIndex={state.selectedIndex}
        onInspect={state.openInspector}
        onOpenJourney={state.openJourney}
      />
      {nextCursor ? (
        <div className={styles.loadMoreRow}>
          <Button variant="secondary" onClick={state.loadMore} disabled={state.loadingMore}>
            {state.loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
