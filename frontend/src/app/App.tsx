import { Shell } from './Shell';
import { Toolbar } from './Toolbar';
import { ResultsPanel } from '../features/results/ResultsPanel';
import { EventInspector } from '../features/inspector/EventInspector';
import { JourneyView } from '../features/journey/JourneyView';
import { useSearchState } from './useSearchState';
import styles from './App.module.css';

/**
 * The historical search investigation shell (IMPLEMENTATION_PLAN.md
 * "Phase F" + "Phase G" + "Phase H" + "Phase I"). `.mainRow` is what makes
 * the inspector "right-side panel beside results on wide screens"
 * (HANDOVER.md §16) - a normal flex row, so `ResultsPanel`'s own
 * horizontal-scroll container and `EventInspector`'s width both
 * participate in ordinary layout flow rather than any absolute
 * positioning. `JourneyView` replaces `ResultsPanel` (not the inspector)
 * whenever a "Find this X" journey lookup is active - opening one closes
 * the inspector first (`useSearchState.ts#openJourney`), so the two never
 * render at once.
 */
export default function App() {
  const state = useSearchState();

  return (
    <div>
      <Shell state={state} />
      <Toolbar state={state} />
      <div className={styles.mainRow}>
        <div className={styles.resultsColumn}>
          {state.journeyQuery ? <JourneyView state={state} /> : <ResultsPanel state={state} />}
        </div>
        <EventInspector state={state} />
      </div>
    </div>
  );
}
