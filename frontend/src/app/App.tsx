import { Shell } from './Shell';
import { Toolbar } from './Toolbar';
import { ResultsPanel } from '../features/results/ResultsPanel';
import { useSearchState } from './useSearchState';

/** The historical search investigation shell (IMPLEMENTATION_PLAN.md "Phase F" + "Phase G"). */
export default function App() {
  const state = useSearchState();

  return (
    <div>
      <Shell state={state} />
      <Toolbar state={state} />
      <ResultsPanel state={state} />
    </div>
  );
}
