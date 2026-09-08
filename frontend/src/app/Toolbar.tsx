import { Button } from '../shared/ui/Button';
import { SourceSelect } from '../features/search/SourceSelect';
import { ServiceMultiSelect } from '../features/search/ServiceMultiSelect';
import { TimeRangeControl } from '../features/timerange/TimeRangeControl';
import { getTimeRangeDisplayLabel } from '../features/timerange/label';
import { SeverityFilter } from '../features/search/SeverityFilter';
import { UniversalSearch } from '../features/search/UniversalSearch';
import { AdvancedFilters } from '../features/search/AdvancedFilters';
import { ActiveFilters } from '../features/search/ActiveFilters';
import type { SearchState } from './useSearchState';
import styles from './Toolbar.module.css';

export interface ToolbarProps {
  state: SearchState;
}

/**
 * Default toolbar order (IMPLEMENTATION_PLAN.md "Phase F" scope item 2):
 * source -> service multi-select -> time range -> severity -> universal
 * search -> Search -> Live (only when capability true) -> More filters +
 * active count.
 */
export function Toolbar({ state }: ToolbarProps) {
  const liveTailSupported = state.selectedSource?.capabilities.liveTail ?? false;

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
        <Button variant="primary" onClick={state.runSearch} disabled={state.searchLoading}>
          {state.searchLoading ? 'Searching…' : 'Search'}
        </Button>
        {liveTailSupported ? (
          // Live tail itself is Phase J's job - this button is only ever
          // rendered when the active source's own capabilities say it
          // supports it (never assumed, never shown for a source that
          // can't - CLAUDE.md §4 "Sources and capabilities").
          <Button variant="secondary" disabled title="Live tail is not yet available">
            Live
          </Button>
        ) : null}
        <AdvancedFilters
          values={{ ...state.advancedFilters, text: state.searchText }}
          onApply={state.applyAdvancedFilters}
        />
      </div>
      <div className={styles.activeFiltersRow}>
        <ActiveFilters
          timeRangeLabel={getTimeRangeDisplayLabel(state.timeRange)}
          advancedValues={{ ...state.advancedFilters, text: state.searchText }}
        />
      </div>
    </div>
  );
}
