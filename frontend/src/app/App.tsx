import { Shell } from './Shell';
import { Toolbar } from './Toolbar';
import { ResultsPanel } from '../features/results/ResultsPanel';
import { EventInspector } from '../features/inspector/EventInspector';
import { useSearchState } from './useSearchState';
import styles from './App.module.css';

/**
 * The historical search investigation shell (IMPLEMENTATION_PLAN.md
 * "Phase F" + "Phase G" + "Phase H"). `.mainRow` is what makes the
 * inspector "right-side panel beside results on wide screens" (HANDOVER.md
 * §16) - a normal flex row, so `ResultsPanel`'s own horizontal-scroll
 * container and `EventInspector`'s width both participate in ordinary
 * layout flow rather than any absolute positioning.
 */
export default function App() {
  const state = useSearchState();

  return (
    <div>
      <Shell state={state} />
      <Toolbar state={state} />
      <div className={styles.mainRow}>
        <div className={styles.resultsColumn}>
          <ResultsPanel state={state} />
        </div>
        <EventInspector state={state} />
      </div>
    </div>
  );
}
