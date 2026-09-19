import { Button } from '../shared/ui/Button';
import { SourceSelect } from '../features/search/SourceSelect';
import { ComposeProjectSelect } from '../features/search/ComposeProjectSelect';
import { ServiceMultiSelect } from '../features/search/ServiceMultiSelect';
import { OpenShiftScopeSelect } from '../features/search/openshift/OpenShiftScopeSelect';
import type { OpenShiftScopeChangeLevel } from '../features/search/openshift/useOpenShiftScopeEditor';
import { TimeRangeControl } from '../features/timerange/TimeRangeControl';
import { SeverityFilter } from '../features/search/SeverityFilter';
import { UniversalSearch } from '../features/search/UniversalSearch';
import { AdvancedFilters } from '../features/search/AdvancedFilters';
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
  /**
   * SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT / TARGETED_RECOVERY_1 - fires after a successful
   * Project/Workload/Pod/Container selection made from THIS toolbar's own `OpenShiftScopeSelect`.
   * `App.tsx`'s handler re-reads the authoritative OpenShift scope, invalidates any stale search/
   * investigation results left over from the old scope, and reconciles source health for a Project change.
   * Undefined only in tests/stories that render `Toolbar` without ever selecting OpenShift as the source.
   */
  onOpenShiftScopeChanged?: (level: OpenShiftScopeChangeLevel) => void;
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
export function Toolbar({ state, onStartLive, openShiftScope, onOpenShiftScopeChanged }: ToolbarProps) {
  const liveTailSupported = state.selectedSource?.capabilities.liveTail ?? false;
  const rawLogQlSupported = state.selectedSource?.capabilities.rawLogQL ?? false;
  const composeProjectScopingSupported = state.selectedSource?.capabilities.composeProjectScoping ?? false;
  // SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - capability-driven, not a source-id check: OpenShift already
  // declares `serviceDiscovery=false` (`OpenShiftLogSource.java`), so Docker's Service selector - which implies
  // a capability OpenShift genuinely doesn't have - is gated the same way `ComposeProjectSelect` already is.
  const serviceDiscoverySupported = state.selectedSource?.capabilities.serviceDiscovery ?? false;
  // SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - OpenShift Workload is the UX-equivalent of Docker Service
  // (owner requirements register §28); this toolbar renders one scope-selection family or the other for a
  // given source, never both, and never Docker's Service selector as if it were OpenShift's scope control
  // (there is no `serviceDiscovery`-style capability flag for "has OpenShift-shaped scope" today, so this
  // mirrors the existing `sourceId === 'openshift'` routing already used to pick between
  // `DockerSettingsPanel`/`OpenShiftSettingsPanel` in Settings, rather than inventing a new one).
  const isOpenShift = state.selectedSourceId === 'openshift';
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

  return (
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
      {isOpenShift ? (
        <OpenShiftScopeSelect scope={openShiftScope ?? null} onScopeChanged={onOpenShiftScopeChanged ?? (() => {})} />
      ) : serviceDiscoverySupported ? (
        <ServiceMultiSelect
          services={state.services}
          selected={state.selectedServices}
          onChange={state.setSelectedServices}
          mode={state.serviceFilterMode}
          onModeChange={state.setServiceFilterMode}
        />
      ) : null}
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
        availableTags={state.classificationTags}
        availableTagsError={state.classificationTagsError}
        selectedTags={state.selectedTags}
        onApplyTags={state.setSelectedTags}
        onOpen={state.refreshClassificationTags}
      />
    </div>
  );
}
