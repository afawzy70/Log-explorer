import { Shell } from './Shell';
import { Toolbar } from './Toolbar';
import { ResultsPlaceholder } from './ResultsPlaceholder';
import { useSearchState } from './useSearchState';

/** The historical search investigation shell (IMPLEMENTATION_PLAN.md "Phase F"). */
export default function App() {
  const state = useSearchState();

  return (
    <div>
      <Shell state={state} />
      <Toolbar state={state} />
      <ResultsPlaceholder state={state} />
    </div>
  );
}
