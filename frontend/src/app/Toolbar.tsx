import { Button } from '../shared/ui/Button';
import { SourceSelect } from '../features/search/SourceSelect';
import { ServiceMultiSelect } from '../features/search/ServiceMultiSelect';
import { TimeRangeControl } from '../features/timerange/TimeRangeControl';
import { getTimeRangeDisplayLabel } from '../features/timerange/label';
import { SeverityFilter } from '../features/search/SeverityFilter';
import { UniversalSearch } from '../features/search/UniversalSearch';
import { AdvancedFilters } from '../features/search/AdvancedFilters';
import { ActiveFilters } from '../features/search/ActiveFilters';
import { DEFAULT_SEVERITY_LEVELS } from '../features/search/severityLevels';
import type { AdvancedFilterValues } from '../features/search/advancedFilterFields';
import { defaultTimeRange } from './useSearchState';
import type { SearchState } from './useSearchState';
import styles from './Toolbar.module.css';

export interface ToolbarProps {
  state: SearchState;
  /** Starts live mode for the currently-selected source/services (IMPLEMENTATION_PLAN.md "Phase J") - undefined only in tests/stories that don't wire live tail up. */
  onStartLive?: () => void;
}

/**
 * Default toolbar order (IMPLEMENTATION_PLAN.md "Phase F" scope item 2):
 * source -> service multi-select -> time range -> severity -> universal
 * search -> Search -> Live (only when capability true) -> More filters +
 * active count. Advanced Query no longer has its own top-level trigger
 * here (UX-R1 §2, owner decision) - it now renders from inside
 * `AdvancedFilters`' own drawer, under More filters, so Search stays the
 * single strongest primary action in this row.
 */
export function Toolbar({ state, onStartLive }: ToolbarProps) {
  const liveTailSupported = state.selectedSource?.capabilities.liveTail ?? false;
  const rawLogQlSupported = state.selectedSource?.capabilities.rawLogQL ?? false;

  function removeAdvancedField(key: keyof AdvancedFilterValues) {
    state.applyAdvancedFilters({ ...state.advancedFilters, text: state.searchText, [key]: '' });
  }

  function removeService(service: string) {
    state.setSelectedServices(state.selectedServices.filter((s) => s !== service));
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <SourceSelect sources={state.sources} selectedId={state.selectedSourceId} onChange={state.setSelectedSourceId} />
        <ServiceMultiSelect
          services={state.services}
          selected={state.selectedServices}
          onChange={state.setSelectedServices}
        />
        <TimeRangeControl value={state.timeRange} onChange={state.setTimeRange} />
        <SeverityFilter selected={state.selectedLevels} onChange={state.setSelectedLevels} />
        <UniversalSearch
          value={state.searchText}
          onChange={state.setSearchText}
          onSubmit={state.runSearch}
          onApplyDetectedField={state.applyDetectedField}
        />
        <Button variant="primary" onClick={() => state.runSearch()} disabled={state.searchLoading}>
          {state.searchLoading ? 'Searching…' : 'Search'}
        </Button>
        {liveTailSupported ? (
          // Only ever rendered when the active source's own capabilities
          // say it supports live tail (never assumed, never shown for a
          // source that can't - CLAUDE.md §4 "Sources and capabilities").
          <Button variant="secondary" onClick={onStartLive} disabled={!onStartLive || !state.selectedSourceId}>
            Live
          </Button>
        ) : null}
        <AdvancedFilters
          values={{ ...state.advancedFilters, text: state.searchText }}
          onApply={state.applyAdvancedFilters}
          queryState={state.queryState}
          onApplyQuery={state.applyQuery}
          rawLogQlSupported={rawLogQlSupported}
        />
      </div>
      <div className={styles.activeFiltersRow}>
        <ActiveFilters
          timeRangeLabel={getTimeRangeDisplayLabel(state.timeRange)}
          onRemoveTimeRange={() => state.setTimeRange(defaultTimeRange())}
          selectedLevels={state.selectedLevels}
          onRemoveSeverity={() => state.setSelectedLevels(DEFAULT_SEVERITY_LEVELS)}
          selectedServices={state.selectedServices}
          onRemoveService={removeService}
          advancedValues={{ ...state.advancedFilters, text: state.searchText }}
          onRemoveAdvancedField={removeAdvancedField}
          onClearAll={state.clearAllFilters}
        />
      </div>
    </div>
  );
}
