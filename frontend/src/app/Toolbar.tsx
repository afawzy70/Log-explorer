import { Button } from '../shared/ui/Button';
import { SourceSelect } from '../features/search/SourceSelect';
import { ComposeProjectSelect } from '../features/search/ComposeProjectSelect';
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
import type { OpenShiftScopeSummary } from '../shared/api/types';
import styles from './Toolbar.module.css';

export interface ToolbarProps {
  state: SearchState;
  /** Starts live mode for the currently-selected source/services (IMPLEMENTATION_PLAN.md "Phase J") - undefined only in tests/stories that don't wire live tail up. */
  onStartLive?: () => void;
  /**
   * OS-1F §8 - `null` whenever OpenShift isn't the active source (the
   * gate below is then always a no-op). When OpenShift IS active but no
   * Project/Namespace has been selected yet, Search/Live must not appear
   * available: a request without a selected scope reaches the backend
   * only as an opaque failure today (`DirectPodLogProvider` throws
   * `IllegalStateException("No project/namespace selected.")`, uncaught
   * by any specific `GlobalExceptionHandler` mapping) - genuinely
   * unusable, not merely unclear, so this is prevented here rather than
   * only explained after the fact.
   */
  openShiftScope?: OpenShiftScopeSummary | null;
}

/**
 * Default toolbar order (IMPLEMENTATION_PLAN.md "Phase F" scope item 2):
 * source -> Compose project (only when capability true, UX-R3 §5/§9) ->
 * service multi-select -> time range -> severity -> universal search ->
 * Search -> Live (only when capability true) -> More filters + active
 * count. Compose project sits directly after source, mirroring the
 * mission's own CONNECTION -> DOCKER ENGINE -> COMPOSE PROJECT -> SEARCH
 * mental model (§6) - it narrows which services/results a source can ever
 * show, so it belongs before the service filter that further narrows
 * within it. Advanced Query no longer has its own top-level trigger here
 * (UX-R1 §2, owner decision) - it now renders from inside
 * `AdvancedFilters`' own drawer, under More filters, so Search stays the
 * single strongest primary action in this row.
 */
export function Toolbar({ state, onStartLive, openShiftScope }: ToolbarProps) {
  const liveTailSupported = state.selectedSource?.capabilities.liveTail ?? false;
  const rawLogQlSupported = state.selectedSource?.capabilities.rawLogQL ?? false;
  const composeProjectScopingSupported = state.selectedSource?.capabilities.composeProjectScoping ?? false;
  // OS-1F §8 - only a genuinely CONNECTED OpenShift session with no
  // Project/Namespace yet selected blocks Search/Live; `openShiftScope`
  // is `null` both when OpenShift isn't selected and before the first
  // scope read resolves, so this never blocks Search on some OTHER
  // source, and never blocks it hard on a not-yet-loaded scope check.
  const openShiftMissingRequiredScope =
    state.selectedSourceId === 'openshift' && openShiftScope != null && openShiftScope.selectedProject == null;
  const openShiftScopeHint = openShiftScope?.discoveryApi === 'NAMESPACES' ? 'a Namespace' : 'a Project';
  // Configurable Log Field Mapping mission §15 - proactively disabled, not
  // just an error shown after a failed click (mission: "Do NOT fail
  // silently with zero results"). `undefined` (the field-mapping profile
  // hasn't loaded yet on first mount) never silently permits Search - only
  // an explicit `true` does.
  const mappingNotReady = state.fieldMappingSearchReady !== true;
  const MAPPING_NOT_READY_MESSAGE = 'Configure and validate log field mapping before searching this source.';

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
        {composeProjectScopingSupported ? (
          <ComposeProjectSelect
            projects={state.composeProjects}
            selected={state.selectedComposeProject}
            loading={state.composeProjectsLoading}
            error={state.composeProjectsError}
            onChange={state.setSelectedComposeProject}
          />
        ) : null}
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
        <Button
          variant="primary"
          onClick={() => state.runSearch()}
          disabled={state.searchLoading || openShiftMissingRequiredScope || mappingNotReady}
          title={
            mappingNotReady
              ? MAPPING_NOT_READY_MESSAGE
              : openShiftMissingRequiredScope
                ? `Select ${openShiftScopeHint} to search OpenShift`
                : undefined
          }
        >
          {state.searchLoading ? 'Searching…' : 'Search'}
        </Button>
        {liveTailSupported ? (
          // Only ever rendered when the active source's own capabilities
          // say it supports live tail (never assumed, never shown for a
          // source that can't - CLAUDE.md §4 "Sources and capabilities").
          <Button
            variant="secondary"
            onClick={onStartLive}
            disabled={!onStartLive || !state.selectedSourceId || openShiftMissingRequiredScope}
            title={openShiftMissingRequiredScope ? `Select ${openShiftScopeHint} to start Live` : undefined}
          >
            Live
          </Button>
        ) : null}
        {mappingNotReady ? (
          <span className={styles.scopeRequiredHint} role="status">
            {MAPPING_NOT_READY_MESSAGE}
          </span>
        ) : openShiftMissingRequiredScope ? (
          <span className={styles.scopeRequiredHint} role="status">
            Select {openShiftScopeHint} to search OpenShift
          </span>
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
