import { lazy, Suspense, useEffect, useRef } from 'react';
import { Shell, resolveMappingProject } from './Shell';
import { Toolbar } from './Toolbar';
import { ResultsPanel } from '../features/results/ResultsPanel';
import { EventInspector } from '../features/inspector/EventInspector';
import { useLiveTail } from '../features/live/useLiveTail';
import { useLiveKeyboardShortcuts } from '../features/live/useLiveKeyboardShortcuts';
import { useSearchState } from './useSearchState';
import { useOpenShiftScopeSummary } from '../features/settings/useOpenShiftScopeSummary';
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
  //
  // Modern Developer Console, Wave 1 Foundations: `useTheme` sets
  // `data-theme` on `<html>` from the persisted appearance preference
  // (system by default). Side-effect only tonight - no component reads
  // `[data-theme='dark']` yet except the additive `tokensV2.css` custom
  // properties, so this call changes no rendered pixel until a later
  // slice restyles a surface against the v2 tokens.
  useTheme();
  return (
    <ShortcutRegistryProvider>
      <AppContent />
    </ShortcutRegistryProvider>
  );
}

function AppContent() {
  const state = useSearchState();
  const live = useLiveTail();
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

  const liveModeActive = live.connectionState !== 'idle';
  useLiveKeyboardShortcuts(live, liveModeActive);

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
       * `data-app-chrome` (UX-R1 §2 regression fix): the header + toolbar +
       * active-filters row, as one measurable block. `AdvancedFilters`'
       * own drawer reads this element's rendered height so its `top`
       * offset never physically overlaps these rows' interactive controls
       * (Docker settings, keyboard shortcuts, health, Search/Live/More
       * filters, active-filter chip removal) - see `AdvancedFilters.tsx`'s
       * own comment for why a z-index-only fix does not work here.
       */}
      <div data-app-chrome>
        <Shell state={state} openShiftScope={openShiftScopeState.scope} liveModeActive={liveModeActive} />
        <Toolbar
          state={state}
          openShiftScope={openShiftScopeState.scope}
          onStartLive={
            state.selectedSourceId
              ? () => live.start(state.selectedSourceId!, state.selectedServices, state.selectedComposeProject ?? undefined)
              : undefined
          }
        />
      </div>
      <div className={styles.mainRow}>
        <div className={styles.resultsColumn}>
          {state.settingsWorkspaceOpen ? (
            <Suspense fallback={<SectionLoadingFallback label="Loading settings…" />}>
              <SettingsWorkspace
                state={state}
                onOpenShiftScopeChanged={openShiftScopeState.refresh}
                onClose={state.closeSettingsWorkspace}
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
              />
            </Suspense>
          ) : state.classificationWorkspaceOpen ? (
            <Suspense fallback={<SectionLoadingFallback label="Loading classification rules…" />}>
              <ClassificationRulesWorkspace
                key={state.classificationWorkspaceKey}
                sourceEvent={state.classificationWorkspaceEvent}
                intent={state.classificationWorkspaceIntent}
                buildScope={state.buildClassificationSampleScope}
                onRulesChanged={state.refreshClassificationTags}
                onClose={state.closeClassificationWorkspace}
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
