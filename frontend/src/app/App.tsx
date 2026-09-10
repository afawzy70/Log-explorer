import { lazy, Suspense, useEffect, useRef } from 'react';
import { Shell } from './Shell';
import { Toolbar } from './Toolbar';
import { ResultsPanel } from '../features/results/ResultsPanel';
import { EventInspector } from '../features/inspector/EventInspector';
import { useLiveTail } from '../features/live/useLiveTail';
import { useLiveKeyboardShortcuts } from '../features/live/useLiveKeyboardShortcuts';
import { useSearchState } from './useSearchState';
import { useProductivityShortcuts } from './useProductivityShortcuts';
import { ShortcutRegistryProvider } from '../shared/keyboard/ShortcutRegistry';
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
  useProductivityShortcuts(state);

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

  return (
    <div>
      <Shell state={state} />
      <Toolbar
        state={state}
        onStartLive={
          state.selectedSourceId ? () => live.start(state.selectedSourceId!, state.selectedServices) : undefined
        }
      />
      <div className={styles.mainRow}>
        <div className={styles.resultsColumn}>
          {liveModeActive ? (
            <Suspense fallback={<SectionLoadingFallback label="Loading Live…" />}>
              <LiveTailPanel
                live={live}
                sourceDisplayName={state.selectedSource?.displayName ?? state.selectedSourceId ?? ''}
                onStart={() => state.selectedSourceId && live.start(state.selectedSourceId, state.selectedServices)}
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
