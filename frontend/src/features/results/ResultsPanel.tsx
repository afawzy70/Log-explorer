import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { formatInterval } from '../../shared/time/interval';
import { DEFAULT_PRESET_ID, TIME_RANGE_PRESETS } from '../../shared/time/presets';
import { ActiveFilters } from '../search/ActiveFilters';
import { DEFAULT_SEVERITY_LEVELS } from '../search/severityLevels';
import { getTimeRangeDisplayLabel } from '../timerange/label';
import { defaultTimeRange } from '../../app/useSearchState';
import type { SearchState } from '../../app/useSearchState';
import type { AdvancedFilterValues } from '../search/advancedFilterFields';
import { buildCountsSummary } from './counts';
import { ResultsTable } from './ResultsTable';
import { ScopeStrip } from './ScopeStrip';
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
 * detour the investigator needs to back out of). The button's label is
 * dynamic (owner mission "Mapping Verification and Investigation
 * Workspace" - "Investigation navigation/continuity"): Surroundings
 * launched from within a Trace/Span/Correlation/Journey view says "Back to
 * Trace"/etc, never the generic "Back to original search" it would
 * otherwise falsely claim.
 */
function Breadcrumb({ state }: { state: SearchState }) {
  if (!state.breadcrumbLabel) {
    return null;
  }
  return (
    <div className={styles.breadcrumb}>
      <span>{state.breadcrumbLabel}</span>
      <Button variant="ghost" onClick={state.restoreOriginalSearch}>
        ← {state.restoreOriginalSearchLabel}
      </Button>
    </div>
  );
}

/**
 * B2 (Session 4) - `ActiveFilters` itself is unchanged (`COMPONENT_INVENTORY.md`'s
 * own ActiveFilters.tsx row: "Chips move into the scope strip ... EXCLUDE
 * chip keeps the word Excluding ... Clear all never touches source/scope");
 * only its mount point and prop-wiring moved here from `Toolbar.tsx`
 * (which previously rendered it, always, in its own `.activeFiltersRow`).
 * Built once per render and passed into `ScopeStrip` from every branch
 * below, so "always visible regardless of search state" is preserved
 * exactly - the one real visibility change is that the strip (chips
 * included) no longer renders while Live/Settings/Field mapping/
 * Classification rules/Journey are the active view, since `ResultsPanel`
 * itself does not mount then either (see `ScopeStrip`'s own doc comment).
 */
function buildActiveFilters(state: SearchState) {
  function removeAdvancedField(key: keyof AdvancedFilterValues) {
    state.applyAdvancedFilters({ ...state.advancedFilters, text: state.searchText, [key]: '' });
  }

  function removeTag(tag: string) {
    state.setSelectedTags(state.selectedTags.filter((t) => t !== tag));
  }

  function removeService(service: string) {
    state.setSelectedServices(state.selectedServices.filter((s) => s !== service));
  }

  return (
    <ActiveFilters
      timeRangeLabel={getTimeRangeDisplayLabel(state.timeRange)}
      onRemoveTimeRange={() => state.setTimeRange(defaultTimeRange())}
      selectedLevels={state.selectedLevels}
      onRemoveSeverity={() => state.setSelectedLevels(DEFAULT_SEVERITY_LEVELS)}
      selectedServices={state.selectedServices}
      onRemoveService={removeService}
      serviceFilterMode={state.serviceFilterMode}
      onClearServices={() => state.setSelectedServices([])}
      advancedValues={{ ...state.advancedFilters, text: state.searchText }}
      onRemoveAdvancedField={removeAdvancedField}
      selectedTags={state.selectedTags}
      onRemoveTag={removeTag}
      onClearAll={state.clearAllFilters}
    />
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
  const activeFilters = buildActiveFilters(state);

  if (state.searchError) {
    /*
     * UX-R6 §11 - a search failure is a state with a way forward, not a
     * dead end.
     *
     * Measured before UX-R6: this rendered as a bare pink strip carrying
     * only the backend's own sanitized detail ("source unreachable"),
     * with no statement of *what* had failed, no action of any kind, and
     * the rest of the workspace left blank beneath it. The "Load more"
     * failure path already had exactly the affordance this one lacked
     * (an inline Retry), so the pattern existed and simply had not been
     * applied to the primary error.
     *
     * The backend's detail is still shown verbatim and is still the only
     * detail shown - `GlobalExceptionHandler` is what guarantees it never
     * carries a search value, identifier or secret, and this component
     * deliberately adds no context of its own that could.
     */
    return (
      <div className={styles.wrapper}>
        <Breadcrumb state={state} />
        <ScopeStrip activeFilters={activeFilters} />
        <div className={`${styles.statePanel} ${styles.statePanelDanger}`} role="alert">
          <Icon name="circle-alert" size="lg" className={styles.statePanelIcon} />
          <div className={styles.statePanelBody}>
            <p className={styles.statePanelTitle}>Search failed</p>
            <p className={styles.statePanelDetail}>{state.searchError}</p>
            <div className={styles.statePanelActions}>
              <Button variant="secondary" onClick={() => state.runSearch()} disabled={state.searchLoading}>
                Retry search
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /*
   * First-ever search (no previous result to keep showing) - a skeleton, not a blank "Searching..." wait.
   * A RE-search (searchLoading with an existing searchResult) instead falls through to the normal render
   * path below with `.staleResults` applied - see that branch's own comment.
   */
  if (state.searchLoading && !state.searchResult) {
    return (
      <div className={styles.wrapper}>
        <Breadcrumb state={state} />
        <ScopeStrip activeFilters={activeFilters} />
        <div className={styles.skeleton} role="status">
          Searching…
          <div className={styles.skeletonRows} aria-hidden="true">
            {[92, 78, 96, 64, 88, 72].map((width, i) => (
              <div key={i} className={styles.skeletonRow}>
                <span className={styles.skeletonBar} style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!state.searchResult) {
    return (
      <div className={styles.wrapper}>
        <Breadcrumb state={state} />
        <ScopeStrip activeFilters={activeFilters} />
        <div className={styles.statePanel}>
          <Icon name="search" size="lg" className={styles.statePanelIcon} />
          <div className={styles.statePanelBody}>
            <p className={styles.statePanelTitle}>Run a search to see results</p>
          </div>
        </div>
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

  // Re-search stale treatment - see `.staleResults`'s own comment in ResultsPanel.module.css for why
  // `state.searchResult` is still populated (and thus renders normally, just visually muted) while
  // `state.searchLoading` is also true.
  const isStale = state.searchLoading;

  if (events.length === 0) {
    const oneDayAgo = new Date(Date.now() - DAY_MS);
    return (
      <div className={styles.wrapper}>
        <Breadcrumb state={state} />
        <ScopeStrip
          activeFilters={activeFilters}
          onRefresh={() => state.refresh()}
          refreshDisabled={state.searchLoading}
          queryPlan={queryPlan}
        />
        {isStale ? (
          <p className={styles.staleNotice} role="status">
            Searching…
          </p>
        ) : null}
        <div className={isStale ? styles.staleResults : undefined}>
          {state.breadcrumbLabel ? (
            <ContextSummary
              events={events}
              range={state.lastSearchedRange}
              source={state.selectedSource?.displayName ?? null}
              counts={counts}
              gaps={gaps}
              rootIdentity={state.contextRootIdentity}
            />
          ) : null}
          <div className={styles.statePanel}>
            <Icon name="search" size="lg" className={styles.statePanelIcon} />
            <div className={styles.statePanelBody}>
              <p className={styles.statePanelTitle}>No results for this range</p>
              <div className={styles.statePanelActions}>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const summaryText = `${buildCountsSummary(counts, events.length)}${
    state.lastSearchedRange
      ? ` — showing results for ${formatInterval(state.lastSearchedRange.start, state.lastSearchedRange.end)}`
      : ''
  }`;

  return (
    <div className={styles.wrapper}>
      <Breadcrumb state={state} />
      <ScopeStrip
        activeFilters={activeFilters}
        readout={summaryText}
        onRefresh={() => state.refresh()}
        refreshDisabled={state.searchLoading}
        queryPlan={queryPlan}
        sort={
          state.breadcrumbLabel
            ? undefined
            : { value: state.sortDirection, onChange: state.setSortDirection, disabled: state.searchLoading }
        }
        table={table}
      />
      {isStale ? (
        <p className={styles.staleNotice} role="status">
          Searching…
        </p>
      ) : null}
      <div className={isStale ? styles.staleResults : undefined}>
      {state.breadcrumbLabel ? (
        <ContextSummary
          events={events}
          range={state.lastSearchedRange}
          source={state.selectedSource?.displayName ?? null}
          counts={counts}
          gaps={gaps}
          rootIdentity={state.contextRootIdentity}
        />
      ) : null}
      <ResultsTable
        events={events}
        selectedIndex={state.selectedIndex}
        onInspect={state.openInspector}
        onShowContext={state.showContext}
        onOpenJourney={state.openJourney}
        columnOrder={table.preferences.columnOrder}
        hiddenColumnIds={table.preferences.hiddenColumnIds}
        density={table.preferences.density}
        contextRootIdentity={state.breadcrumbLabel ? state.contextRootIdentity : null}
        gaps={gaps}
        // Pre-closure functional recovery (§17/§37/§38): column sorting
        // (including the Time header's own alias of Newest/Oldest) is
        // disabled in a context ("Show surrounding logs") view for the
        // exact same reason SortControl itself is already hidden there -
        // that view's own chronological-around-the-root order IS the
        // view, never a reorderable list.
        sortable={!state.breadcrumbLabel}
        timeSortDirection={state.breadcrumbLabel ? undefined : state.sortDirection}
        onTimeSortChange={state.breadcrumbLabel ? undefined : state.setSortDirection}
        inspectorOpen={state.selectedEvent != null}
      />
      {nextCursor ? (
        <div className={styles.loadMoreRow}>
          <Button variant="secondary" onClick={state.loadMore} disabled={state.loadingMore}>
            {state.loadingMore ? 'Loading…' : 'Load more'}
          </Button>
          {state.loadMoreError ? (
            <span className={styles.loadMoreError} role="alert">
              <Icon name="circle-alert" size="sm" />
              {state.loadMoreError}{' '}
              <Button variant="ghost" onClick={state.loadMore}>
                Retry
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
      </div>
    </div>
  );
}
