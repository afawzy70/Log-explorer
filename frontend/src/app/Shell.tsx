import { SourceHealthBadge } from './SourceHealthBadge';
import { DockerSettingsPanel } from '../features/settings/DockerSettingsPanel';
import { FieldMappingSettingsPanel } from '../features/settings/fieldMapping/FieldMappingSettingsPanel';
import { OpenShiftSettingsPanel, WORKLOAD_KIND_LABELS } from '../features/settings/OpenShiftSettingsPanel';
import { PrivacyMaskingSettingsPanel } from '../features/settings/PrivacyMaskingSettingsPanel';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';
import { EnvironmentBadge } from './EnvironmentBadge';
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
  onOpenShiftScopeChanged: () => void;
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

export function Shell({ state, openShiftScope, onOpenShiftScopeChanged }: ShellProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>Log Explorer</h1>
      <EnvironmentBadge />
      <ScopeTrail state={state} openShiftScope={openShiftScope} />
      <div className={styles.spacer} />
      {/*
       * Pre-closure functional recovery (§11): Privacy & Masking is a
       * GLOBAL, source-independent concern (unlike Docker/OpenShift
       * settings below, which are per-source connection concerns) - it
       * sits first, distinct from the two source-connection popovers, so
       * "where do I control masking?" is never confused with "where do I
       * connect a source?".
       */}
      <PrivacyMaskingSettingsPanel />
      {/*
       * Configurable Log Field Mapping mission §14 - also a GLOBAL,
       * source-independent concern in this mission's minimum-viable scope
       * (one active profile, mission §13) - sits beside Privacy & Masking
       * rather than nested under a per-source panel, for the same reason.
       * Operates on whichever source is currently selected for its sample
       * fetch (`sourceSupportsSampling` is that source's own declared
       * capability, never inferred).
       */}
      <FieldMappingSettingsPanel
        sourceId={state.selectedSourceId}
        sourceSupportsSampling={state.selectedSource?.capabilities.originalSchemaSampling ?? false}
        profile={state.fieldMappingProfile}
        profileError={state.fieldMappingProfileError}
        onProfileChanged={state.refreshFieldMappingProfile}
      />
      <DockerSettingsPanel />
      {/* OS-1A - the OpenShift connection lives beside Docker settings: both
          are source-connection concerns, and keeping them together is what
          makes "where do I set up a source?" answerable in one place. */}
      <OpenShiftSettingsPanel onScopeChanged={onOpenShiftScopeChanged} />
      <KeyboardShortcutsHelp />
      <SourceHealthBadge health={state.health} loading={state.healthLoading} onRetry={state.retryHealth} />
    </header>
  );
}
