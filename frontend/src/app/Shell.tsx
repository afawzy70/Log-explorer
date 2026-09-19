import { SourceHealthBadge } from './SourceHealthBadge';
import { WORKLOAD_KIND_LABELS } from '../features/search/openshift/workloadKindLabels';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';
import { EnvironmentBadge } from './EnvironmentBadge';
import { Icon } from '../shared/ui/Icon';
import { JOURNEY_FIELD_LABELS } from '../features/journey/journeyFields';
import type { SearchState } from './useSearchState';
import type { OpenShiftScopeSummary } from '../shared/api/types';
import styles from './Shell.module.css';

export interface ShellProps {
  state: SearchState;
  /**
   * OS-1F - lifted to `App.tsx` (not owned by `Shell` itself) specifically
   * so `Toolbar`, rendered as `Shell`'s own sibling, can share the exact
   * same scope truth (to gate Search/Live on a required Project/Namespace,
   * §8) rather than each fetching and potentially disagreeing.
   */
  openShiftScope: OpenShiftScopeSummary | null;
  /**
   * B2 (Session 4) - `useLiveTail()`'s own connection state, lifted the same way `openShiftScope` is: Live
   * is owned by a sibling hook in `App.tsx`, not by `Shell` or `useSearchState` itself, so the workspace
   * trail below needs it passed in rather than re-deriving a second truth.
   */
  liveModeActive: boolean;
}

/**
 * B2 (Session 4) - COMPONENT_INVENTORY.md's `app/Shell.tsx` RECOMPOSE entry: "a workspace trail (Search ›
 * Trace) is added." Labels and prefixing rules read directly from the design's own `shell({ trail })` call
 * sites (`prototype/scripts/app.js`): a workspace launched FROM Search (Trace/Journey/Correlation/
 * Surroundings) is prefixed with "Search"; a standalone workspace (Settings, Field mapping, Live) is its own
 * root, never "Search › Settings". Truthful to the same state each of those views itself renders from -
 * never a second, independently-derived label.
 */
function workspaceTrailSegments(state: SearchState, liveModeActive: boolean): string[] {
  if (state.settingsWorkspaceOpen) {
    return ['Settings'];
  }
  if (state.mappingWorkspaceOpen) {
    return ['Field mapping'];
  }
  if (state.classificationWorkspaceOpen) {
    return ['Classification rules'];
  }
  if (liveModeActive) {
    return ['Live'];
  }
  if (state.journeyQuery) {
    return ['Search', JOURNEY_FIELD_LABELS[state.journeyQuery.field]];
  }
  if (state.breadcrumbLabel) {
    return ['Search', 'Surroundings'];
  }
  return ['Search'];
}

function WorkspaceTrail({ state, liveModeActive }: { state: SearchState; liveModeActive: boolean }) {
  const segments = workspaceTrailSegments(state, liveModeActive);
  return (
    <nav className={styles.workspaceTrail} aria-label="Current workspace">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <span key={segment}>
            {index > 0 ? <Icon name="chevron-right" size="sm" className={styles.trailSeparator} /> : null}
            <span aria-current={isLast ? 'page' : undefined}>{segment}</span>
          </span>
        );
      })}
    </nav>
  );
}

/**
 * One product title, active source/environment, compact health + retry
 * (IMPLEMENTATION_PLAN.md "Phase F" scope item 1). "Log Explorer" only -
 * never a duplicated "Multi-Source Log Explorer" + "Log Explorer" pair
 * (CLAUDE.md §7 / scope item 1), and no fabricated branding.
 */
/**
 * UX-R3 §12 - the selected Compose project must stay visible in the main
 * investigation workspace, not only inside Settings, and remain visible
 * across Search results/inspector/context/Live (this header renders above
 * `.mainRow` unconditionally in `App.tsx`, so it never disappears when
 * those views swap). Rendered only when the active source actually has a
 * real Compose-project concept (`composeProjectScoping`) and a project is
 * currently selected - "All projects" (the unscoped default) adds no new
 * chip, since it changes nothing about today's pre-UX-R3 behavior.
 */
/**
 * OS-1F §6/§13 - the effective OpenShift scope hierarchy, as a list of
 * already-labelled breadcrumb segments, truthful to the SAME
 * `OpenShiftScopeSummary` the Settings panel reads and writes (never a
 * second, independently-derived truth). A level is included only when it
 * actually narrows scope - "All workloads"/"All pods"/"All containers"
 * add no segment, exactly like the pre-existing Compose-project chip's
 * own "no chip for the unscoped default" convention, so the trail never
 * implies a false narrowing and never grows noisy for the common case.
 *
 * The Project/Namespace level's own label is the one place this
 * necessarily branches: `discoveryApi === 'NAMESPACES'` is a genuinely
 * different truth from a native OpenShift Project (OS-1A review recovery
 * #2), so a Kubernetes-only cluster's scope reads "Namespace: x", never a
 * bare value that could be misread as a Project.
 */
function openShiftScopeSegments(scope: OpenShiftScopeSummary): string[] {
  const segments: string[] = [];
  if (scope.selectedProject) {
    segments.push(
      scope.discoveryApi === 'NAMESPACES' ? `Namespace: ${scope.selectedProject}` : scope.selectedProject,
    );
  }
  if (scope.selectedWorkloadKind && scope.selectedWorkloadName) {
    const kindLabel = WORKLOAD_KIND_LABELS[scope.selectedWorkloadKind] ?? scope.selectedWorkloadKind;
    segments.push(`${kindLabel}: ${scope.selectedWorkloadName}`);
  }
  if (scope.selectedPod) {
    segments.push(scope.selectedPod);
  }
  if (scope.selectedContainer) {
    segments.push(scope.selectedContainer);
  }
  return segments;
}

function ScopeTrail({ state, openShiftScope }: Pick<ShellProps, 'state' | 'openShiftScope'>) {
  if (!state.selectedSource) {
    return null;
  }
  const isOpenShift = state.selectedSource.id === 'openshift';
  const segments = isOpenShift && openShiftScope
    ? openShiftScopeSegments(openShiftScope)
    : state.selectedSource.capabilities.composeProjectScoping && state.selectedComposeProject
      ? [state.selectedComposeProject]
      : [];
  return (
    <span className={styles.sourceName} data-testid="scope-trail">
      {state.selectedSource.displayName}
      {segments.map((segment, index) => (
        <span key={index}>
          <span className={styles.scopeSeparator} aria-hidden="true">
            ›
          </span>
          <span className={styles.scopeProject}>{segment}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Owner mission "Project-Scoped Schema Scan" §1/§7/§8 — the exact same
 * scope resolution `ScopeTrail` already displays, reused as the real
 * scope value threaded into `FieldMappingWorkspace` (rendered by
 * `App.tsx`, not here — owner mission "Mapping Verification and
 * Investigation Workspace" Part A) so the schema scan, mapping profile,
 * and verification status it edits are always keyed to the SAME
 * project/namespace the header/trail shows the investigator.
 */
export function resolveMappingProject(state: SearchState, openShiftScope: OpenShiftScopeSummary | null): string | null {
  if (!state.selectedSource) {
    return null;
  }
  if (state.selectedSource.id === 'openshift') {
    return openShiftScope?.selectedProject ?? null;
  }
  return state.selectedSource.capabilities.composeProjectScoping ? state.selectedComposeProject : null;
}

export function Shell({ state, openShiftScope, liveModeActive }: ShellProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>Log Explorer</h1>
      <EnvironmentBadge />
      <WorkspaceTrail state={state} liveModeActive={liveModeActive} />
      <ScopeTrail state={state} openShiftScope={openShiftScope} />
      <div className={styles.spacer} />
      {/*
       * Configurable Log Field Mapping mission §14, now project-scoped per
       * owner mission "Project-Scoped Schema Scan" §7/§8, and now a real
       * dedicated page (owner mission "Mapping Verification and
       * Investigation Workspace" - Part A: "not a hidden popover") -
       * `App.tsx` renders the actual workspace as a full-page overlay,
       * exactly like `JourneyView`. Stays a top-level Shell action (not
       * folded into Settings below) - the design's own `shell()` keeps
       * Field mapping and Settings as two separate `shell-actions`
       * buttons, only consolidating the THREE settings popovers
       * (Privacy & masking/Docker/OpenShift) plus Classification rules.
       */}
      <button type="button" className={styles.mappingWorkspaceTrigger} onClick={state.openMappingWorkspace}>
        <Icon name="scan-search" size="sm" />
        Field mapping
      </button>
      {/*
       * B2 (Session 4) - COMPONENT_INVENTORY.md's `app/Shell.tsx` RECOMPOSE entry: "the three settings
       * popover triggers become one Settings entry." Privacy & masking, Docker settings, OpenShift, and
       * Classification rules (deprecated separately, per its own inventory row) all move into
       * `SettingsWorkspace` behind this one button - see that component's own doc comment for exactly how
       * each still-unmodified panel is reached from there.
       */}
      <button type="button" className={styles.mappingWorkspaceTrigger} onClick={state.openSettingsWorkspace}>
        <Icon name="settings" size="sm" />
        Settings
      </button>
      <KeyboardShortcutsHelp />
      <SourceHealthBadge health={state.health} loading={state.healthLoading} onRetry={state.retryHealth} />
    </header>
  );
}
