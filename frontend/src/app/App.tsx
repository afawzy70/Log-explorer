import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Shell, resolveMappingProject } from './Shell';
import { Toolbar } from './Toolbar';
import { Button } from '../shared/ui/Button';
import { ResultsPanel } from '../features/results/ResultsPanel';
import { EventInspector } from '../features/inspector/EventInspector';
import { InvestigationScopeBar } from '../features/journey/InvestigationScopeBar';
import { useLiveTail } from '../features/live/useLiveTail';
import { useLiveKeyboardShortcuts } from '../features/live/useLiveKeyboardShortcuts';
import { useSearchState } from './useSearchState';
import { useOpenShiftScopeSummary } from '../features/settings/useOpenShiftScopeSummary';
import type { OpenShiftScopeChangeLevel } from '../features/search/openshift/useOpenShiftScopeEditor';
import { useProductivityShortcuts } from './useProductivityShortcuts';
import { ShortcutRegistryProvider } from '../shared/keyboard/ShortcutRegistry';
import { useTheme } from '../shared/theme/useTheme';
import styles from './App.module.css';

/**
 * Legacy Remediation Slice 8 §8 code splitting - `JourneyView` and
 * `LiveTailPanel` are genuine secondary views: unlike `DockerSettingsPanel`/
 * `KeyboardShortcutsHelp` (always mounted in `Shell`, each managing its own
 * popover-open state internally - lazy-loading the component itself would
 * not defer anything, since `Suspense` starts the import the instant it is
 * rendered), these two only ever mount after an explicit user action
 * (opening a journey, starting Live) and never both at once (see the
 * `AppContent` doc comment below) - splitting them keeps that code out of
 * the initial bundle without touching the Search -> scan -> inspect path
 * at all (`ResultsPanel`/`EventInspector` stay eager).
 */
const JourneyView = lazy(() => import('../features/journey/JourneyView').then((m) => ({ default: m.JourneyView })));
const LiveTailPanel = lazy(() => import('../features/live/LiveTailPanel').then((m) => ({ default: m.LiveTailPanel })));
/**
 * Owner mission "Mapping Verification and Investigation Workspace" - a
 * real, dedicated page (not a hidden popover), lazy-loaded on the same
 * "only after an explicit user action" basis as the two views above.
 */
const FieldMappingWorkspace = lazy(() =>
  import('../features/settings/fieldMapping/FieldMappingWorkspace').then((m) => ({ default: m.FieldMappingWorkspace })),
);

/** Event Classification & Extraction Rules - lazy-loaded takeover workspace, same basis as `FieldMappingWorkspace`. */
const ClassificationRulesWorkspace = lazy(() =>
  import('../features/settings/classification/ClassificationRulesWorkspace').then((m) => ({
    default: m.ClassificationRulesWorkspace,
  })),
);

/**
 * B2 (Session 4) - the consolidated Settings entry point's takeover workspace, same lazy-loaded/
 * only-after-explicit-action basis as the two above.
 */
const SettingsWorkspace = lazy(() =>
  import('../features/settings/SettingsWorkspace').then((m) => ({ default: m.SettingsWorkspace })),
);

/** Local, non-blocking loading state (§9) - matches `ResultsPanel`'s own `.loading` convention, never a full-screen spinner. */
function SectionLoadingFallback({ label }: { label: string }) {
  return (
    <p className={styles.lazyFallback} role="status">
      {label}
    </p>
  );
}

/**
 * The historical search investigation shell (IMPLEMENTATION_PLAN.md
 * "Phase F" + "Phase G" + "Phase H" + "Phase I" + "Phase J"). `.mainRow`
 * is what makes the inspector "right-side panel beside results on wide
 * screens" (HANDOVER.md §16) - a normal flex row, so `ResultsPanel`'s own
 * horizontal-scroll container and `EventInspector`'s width both
 * participate in ordinary layout flow rather than any absolute
 * positioning. `JourneyView`/`LiveTailPanel` replace `ResultsPanel` (not
 * the inspector) whenever a journey lookup or live tail is active -
 * opening a journey closes the inspector first
 * (`useSearchState.ts#openJourney`), so those two never render at once;
 * live tail and the inspector are independent of each other (the
 * inspector only ever operates on historical search rows).
 */
export default function App() {
  // The registry must be a real ancestor of every hook that calls
  // useShortcut (AppContent's own useProductivityShortcuts, and every
  // descendant that registers its own) - a component cannot see a
  // Context.Provider it renders itself, only one an ancestor renders, so
  // this thin outer component exists purely to put the Provider above
  // AppContent (Legacy Remediation Slice 8).
  return (
    <ShortcutRegistryProvider>
      <AppContent />
    </ShortcutRegistryProvider>
  );
}

function AppContent() {
  const state = useSearchState();
  const live = useLiveTail();
  /**
   * Modern Developer Console, Wave 1 Foundations: `useTheme` sets `data-theme` on `<html>` from the persisted
   * appearance preference (system by default). PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY - dark
   * theme itself is already implemented and complete (56/57 production stylesheets consume `tokensV2.css`'s
   * dark block; `DARK_THEME_AUDIT_COMPLETE=YES`, docs/verification/visual-fidelity-final-closure/) - what was
   * missing was any UI control to actually choose it: this hook's own `setPreference`/`preference` were called
   * and then discarded, so the app only ever followed the OS setting. Now threaded into `SettingsWorkspace`,
   * the one real gap the usability review found here.
   */
  const theme = useTheme();
  // OS-1F §6/§8 - lifted here (not owned by Shell or Toolbar individually)
  // so both share the exact same OpenShift scope truth: Shell's
  // ScopeTrail displays it, Toolbar gates Search/Live on it, and
  // OpenShiftSettingsPanel (rendered inside Shell) triggers the refresh
  // after every scope mutation it commits.
  const openShiftScopeState = useOpenShiftScopeSummary(state.selectedSourceId === 'openshift');
  useProductivityShortcuts(state);

  // Owner mission "Project-Scoped Schema Scan" §8 - `useSearchState`'s own
  // refresh effect already reacts to `selectedSourceId`/`selectedComposeProject`
  // (Docker's own request-scoped selection), but has no knowledge of
  // OpenShift's session-based scope (owned by `useOpenShiftScopeSummary`,
  // lifted here for the same reason as `openShiftScopeState` itself) - so
  // this source's own project/namespace CHANGE must explicitly recalculate
  // the field-mapping readiness gate too, never silently keep showing a
  // previous project's stale readiness.
  useEffect(() => {
    if (state.selectedSourceId === 'openshift') {
      state.refreshFieldMappingProfile(openShiftScopeState.scope?.selectedProject ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedSourceId, openShiftScopeState.scope?.selectedProject]);

  // Owner mission "Mapping Verification and Investigation Workspace" - the
  // exact same scope resolution `Shell`'s own trigger button context uses,
  // reused here (never a second, independently-derived truth) since the
  // workspace itself needs it too now that it is rendered here, not inside
  // `Shell`.
  const mappingProject = resolveMappingProject(state, openShiftScopeState.scope);

  /**
   * SOURCE_EXPERIENCE_PARITY_TARGETED_RECOVERY_1 - the invalidation lifecycle for a scope mutation made from
   * Search's own `OpenShiftScopeSelect` (never for Settings' connect/disconnect, which stays on the plain
   * `openShiftScopeState.refresh` it already used - see `SettingsWorkspace`'s own call site below). A result
   * set may never remain presented as belonging to a newly-selected scope that did not produce it:
   *   1. Invalidate any search/investigation state left over from the old scope (aborts an in-flight request
   *      too - see `invalidateSearchForScopeChange`'s own doc comment) - never automatically re-runs Search.
   *   2. Re-read the one authoritative OpenShift scope (`Shell`'s `ScopeTrail` and this same handler's caller
   *      both then reflect it).
   *   3. Only for a Project change - the one level `OpenShiftLogSource#health()` (backend) actually depends
   *      on - re-check source health, so a `DEGRADED "no project selected"` badge reconciles to the truth as
   *      soon as a valid Project is chosen, without polling.
   */
  function handleOpenShiftScopeChangedFromSearch(level: OpenShiftScopeChangeLevel) {
    state.invalidateSearchForScopeChange();
    openShiftScopeState.refresh();
    if (level === 'project') {
      state.retryHealth();
    }
  }

  const liveModeActive = live.connectionState !== 'idle';
  useLiveKeyboardShortcuts(live, liveModeActive);

  // B5 Investigation - "compact scope bar" (mission's own required item): the full `Toolbar` is replaced by a
  // read-only summary + "Edit search" while a Trace/Span/Correlation/Journey/Event capture or a Surroundings
  // context view is the active view - the exact same precedence the main-column ternary below already uses
  // (Settings/Field mapping/Classification all take priority over it), so the two can never disagree
  // about which view is actually on screen. `editingInvestigationScope` is purely local, ephemeral UI state
  // (never part of `SearchState`) - clicking "Edit search" reveals the real `Toolbar`, unchanged, so every
  // existing filter control stays reachable; it never duplicates or forks that state.
  const noToolbarWorkspace = state.settingsWorkspaceOpen || state.mappingWorkspaceOpen || state.classificationWorkspaceOpen;
  const investigating = !noToolbarWorkspace && !liveModeActive && (state.journeyQuery != null || state.breadcrumbLabel != null);
  /*
   * DRIFT-001 remediation - Live now uses the same compact scope bar Investigation already established,
   * instead of the full always-editable Search toolbar. `InvestigationScopeBar` is genuinely reusable as-is
   * (Source/Project/Time + one "kept" note + Edit search) - no parallel component was built for this.
   */
  const compactScopeActive = !noToolbarWorkspace && (investigating || liveModeActive);
  const [editingInvestigationScope, setEditingInvestigationScope] = useState(false);
  useEffect(() => {
    if (!compactScopeActive && editingInvestigationScope) {
      setEditingInvestigationScope(false);
    }
  }, [compactScopeActive, editingInvestigationScope]);
  const keptNote = liveModeActive
    ? 'Live keeps streaming while you edit search'
    : state.journeyQuery
      ? 'Search filters are kept — return with Back'
      : `${state.restoreOriginalSearchLabel.replace(/^Back to /, '')} is kept — return with Back`;

  // "Source navigation ... closes stream" (HANDOVER.md §18.4) - changing
  // the active source mid-tail means the investigator has moved on from
  // whatever was being followed.
  const previousSourceIdRef = useRef(state.selectedSourceId);
  useEffect(() => {
    if (previousSourceIdRef.current !== state.selectedSourceId) {
      previousSourceIdRef.current = state.selectedSourceId;
      if (liveModeActive) {
        live.exit();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedSourceId]);

  // UX-R3 §19 - "Live + project switch must not continue streaming Project
  // A under Project B scope": switching the selected Compose project always
  // exits Live first, exactly like a source change above - never a silent
  // reuse of the old stream under the new scope header. Deliberately does
  // NOT auto-restart Live under the new project; the investigator explicitly
  // starts it again if they still want a live stream there.
  const previousComposeProjectRef = useRef(state.selectedComposeProject);
  useEffect(() => {
    if (previousComposeProjectRef.current !== state.selectedComposeProject) {
      previousComposeProjectRef.current = state.selectedComposeProject;
      if (liveModeActive) {
        live.exit();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedComposeProject]);

  return (
    <div>
      {/*
       * `data-app-chrome` (UX-R1 §2 regression fix): the header + toolbar,
       * as one measurable block. `AdvancedFilters`' own drawer reads this
       * element's rendered height so its `top` offset never physically
       * overlaps these rows' interactive controls (Docker settings,
       * keyboard shortcuts, health, Search/Live/More filters) - see
       * `AdvancedFilters.tsx`'s own comment for why a z-index-only fix
       * does not work here. B2 (Session 4) - the active-filters row (now
       * the scope strip) moved out of this block into `ResultsPanel`'s
       * own wrapper, below the results column, so it is no longer part
       * of what this measurement needs to clear.
       */}
      <div data-app-chrome>
        <Shell state={state} openShiftScope={openShiftScopeState.scope} liveModeActive={liveModeActive} />
        {noToolbarWorkspace ? null : compactScopeActive && !editingInvestigationScope ? (
          <InvestigationScopeBar state={state} keptNote={keptNote} onEditSearch={() => setEditingInvestigationScope(true)} />
        ) : (
          <>
            <Toolbar
              state={state}
              openShiftScope={openShiftScopeState.scope}
              onOpenShiftScopeChanged={handleOpenShiftScopeChangedFromSearch}
              onStartLive={
                state.selectedSourceId
                  ? () => live.start(state.selectedSourceId!, state.selectedServices, state.selectedComposeProject ?? undefined)
                  : undefined
              }
            />
            {compactScopeActive ? (
              <div className={styles.editSearchDoneRow}>
                <Button variant="ghost" onClick={() => setEditingInvestigationScope(false)}>
                  Done editing search
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className={styles.mainRow}>
        <div className={styles.resultsColumn}>
          {state.settingsWorkspaceOpen ? (
            <Suspense fallback={<SectionLoadingFallback label="Loading settings…" />}>
              <SettingsWorkspace
                state={state}
                openShiftScope={openShiftScopeState.scope}
                onOpenShiftScopeChanged={openShiftScopeState.refresh}
                onClose={state.closeSettingsWorkspace}
                targetSection={state.settingsTargetSection}
                themePreference={theme.preference}
                onThemePreferenceChanged={theme.setPreference}
              />
            </Suspense>
          ) : state.mappingWorkspaceOpen ? (
            <Suspense fallback={<SectionLoadingFallback label="Loading mapping verification…" />}>
              <FieldMappingWorkspace
                sourceId={state.selectedSourceId}
                project={mappingProject}
                sourceSupportsSampling={state.selectedSource?.capabilities.originalSchemaSampling ?? false}
                profile={state.fieldMappingProfile}
                profileError={state.fieldMappingProfileError}
                onProfileChanged={() => state.refreshFieldMappingProfile(mappingProject)}
                onClose={state.closeMappingWorkspace}
                origin={state.mappingWorkspaceOrigin}
                onOpenSettings={state.openSettingsWorkspace}
                onOpenClassificationRules={state.openClassificationWorkspace}
              />
            </Suspense>
          ) : state.classificationWorkspaceOpen ? (
            <Suspense fallback={<SectionLoadingFallback label="Loading classification rules…" />}>
              <ClassificationRulesWorkspace
                key={state.classificationWorkspaceKey}
                sourceEvent={state.classificationWorkspaceEvent}
                intent={state.classificationWorkspaceIntent}
                origin={state.classificationWorkspaceOrigin}
                buildScope={state.buildClassificationSampleScope}
                onRulesChanged={state.refreshClassificationTags}
                onClose={state.closeClassificationWorkspace}
                onOpenMapping={state.openMappingWorkspace}
                onOpenSettings={state.openSettingsWorkspace}
              />
            </Suspense>
          ) : liveModeActive ? (
            <Suspense fallback={<SectionLoadingFallback label="Loading Live…" />}>
              <LiveTailPanel
                live={live}
                sourceDisplayName={state.selectedSource?.displayName ?? state.selectedSourceId ?? ''}
                onStart={() =>
                  state.selectedSourceId &&
                  live.start(state.selectedSourceId, state.selectedServices, state.selectedComposeProject ?? undefined)
                }
              />
            </Suspense>
          ) : state.journeyQuery ? (
            <Suspense fallback={<SectionLoadingFallback label="Loading journey…" />}>
              <JourneyView state={state} />
            </Suspense>
          ) : (
            <ResultsPanel state={state} />
          )}
        </div>
        <EventInspector state={state} />
      </div>
    </div>
  );
}
