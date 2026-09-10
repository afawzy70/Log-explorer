import { Button } from '../../shared/ui/Button';
import { formatInterval } from '../../shared/time/interval';
import { DEFAULT_PRESET_ID, TIME_RANGE_PRESETS } from '../../shared/time/presets';
import type { SearchState } from '../../app/useSearchState';
import { buildCountsSummary } from './counts';
import { ResultsTable } from './ResultsTable';
import { QueryPlanDisclosure } from './QueryPlanDisclosure';
import { TableSettingsControl } from './TableSettingsControl';
import { ContextSummary } from './ContextSummary';
import { detectGaps } from './gapDetection';
import type { GapMarker } from './gapDetection';
import { useTablePreferences } from './tablePreferences';
import styles from './ResultsPanel.module.css';

const NO_GAPS: GapMarker[] = [];

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
  // Called unconditionally, before any early return (Rules of Hooks) -
  // entirely independent of `state`/`SearchState` (Legacy Remediation
  // Slice 4's own explicit "presentation-only, not part of search state"
  // requirement): nothing in `useTablePreferences` ever reads or writes
  // anything search-related.
  const table = useTablePreferences();

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

  const { events, counts, nextCursor, queryPlan } = state.searchResult;
  // Legacy Remediation Slice 6 - computed once per render, shared by
  // ContextSummary's own count/list and ResultsTable's inline markers, so
  // the two can never disagree with each other (§9 "memoized/derived once
  // where appropriate"). Only ever computed for a context view - gap
  // detection is out of scope for an ordinary historical search.
  const gaps = state.breadcrumbLabel ? detectGaps(events) : NO_GAPS;

  if (events.length === 0) {
    const oneDayAgo = new Date(Date.now() - DAY_MS);
    return (
      <div className={styles.wrapper}>
        <Breadcrumb state={state} />
        {state.breadcrumbLabel ? (
          <ContextSummary
            events={events}
            range={state.lastSearchedRange}
            source={state.selectedSource?.displayName ?? null}
            counts={counts}
            gaps={gaps}
          />
        ) : null}
        <RefreshRow state={state} />
        <QueryPlanDisclosure queryPlan={queryPlan} />
        <p className={styles.empty}>
          No results for this range.{' '}
          <Button
            variant="ghost"
            onClick={() => {
              // Bug fix: `setTimeRange` alone (the previous behavior) only
              // ever adjusted the committed range - it never actually
              // re-ran the search, so this "one-click" affordance
              // (CLAUDE.md §4) silently left the stale, still-empty
              // result set on screen. Passing the same range straight
              // into `runSearch` avoids relying on `setTimeRange`'s state
              // update having landed yet (`runSearch`'s own doc comment
              // explains why that ordering can't be trusted).
              const nextRange = {
                presetId: DEFAULT_PRESET_ID,
                start: oneDayAgo.toISOString(),
                end: new Date().toISOString(),
              };
              state.setTimeRange(nextRange);
              state.runSearch(nextRange);
            }}
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
      {state.breadcrumbLabel ? (
        <ContextSummary
          events={events}
          range={state.lastSearchedRange}
          source={state.selectedSource?.displayName ?? null}
          counts={counts}
          gaps={gaps}
        />
      ) : null}
      <div className={styles.summaryRow}>
        <p className={styles.summary}>
          {buildCountsSummary(counts, events.length)}
          {state.lastSearchedRange
            ? ` — showing results for ${formatInterval(state.lastSearchedRange.start, state.lastSearchedRange.end)}`
            : ''}
        </p>
        <TableSettingsControl table={table} />
        <RefreshRow state={state} />
      </div>
      <QueryPlanDisclosure queryPlan={queryPlan} />
      <ResultsTable
        events={events}
        selectedIndex={state.selectedIndex}
        onInspect={state.openInspector}
        onOpenJourney={state.openJourney}
        columnOrder={table.preferences.columnOrder}
        hiddenColumnIds={table.preferences.hiddenColumnIds}
        density={table.preferences.density}
        contextRootIdentity={state.breadcrumbLabel ? state.contextRootIdentity : null}
        gaps={gaps}
      />
      {nextCursor ? (
        <div className={styles.loadMoreRow}>
          <Button variant="secondary" onClick={state.loadMore} disabled={state.loadingMore}>
            {state.loadingMore ? 'Loading…' : 'Load more'}
          </Button>
          {state.loadMoreError ? (
            <span className={styles.loadMoreError} role="alert">
              {state.loadMoreError}{' '}
              <Button variant="ghost" onClick={state.loadMore}>
                Retry
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Refresh" (Legacy Remediation Slice 1) - a compact workspace action, not
 * a new card/control: re-runs the exact current committed search from page
 * 1 (`state.refresh` is `runSearch` itself - see that state's own
 * comment). Rendered whenever a search has actually run, including an
 * empty-result view (re-running is exactly how a user notices new data
 * has since appeared).
 */
function RefreshRow({ state }: { state: SearchState }) {
  return (
    <Button variant="ghost" onClick={() => state.refresh()} disabled={state.searchLoading}>
      ↻ Refresh
    </Button>
  );
}
