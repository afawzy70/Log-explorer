import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { SourceHealthBadge } from '../../app/SourceHealthBadge';
import { getTimeRangeDisplayLabel } from '../timerange/label';
import type { SearchState } from '../../app/useSearchState';
import styles from './InvestigationScopeBar.module.css';

export interface InvestigationScopeBarProps {
  state: SearchState;
  /** e.g. "Search filters are kept — return with Back" / "Trace is kept — return with Back". */
  keptNote: string;
  onEditSearch: () => void;
}

/**
 * B5 Investigation - the "compact scope bar" (mission's own required item), replacing the full `Toolbar` while
 * a Trace/Span/Correlation/Journey/Event capture or a Surroundings context view is the active view
 * (`COMPONENT_INVENTORY.md`'s `compactScope()` prototype function). A read-only summary of what's still in
 * effect (source, project, time) plus one "Edit search" action - clicking it reveals the full `Toolbar`
 * unchanged (see `App.tsx`'s own `editingInvestigationScope` state), so every existing filter control stays
 * reachable and behaves identically; this component only ever narrates the current committed state, it never
 * owns or duplicates it.
 */
export function InvestigationScopeBar({ state, keptNote, onEditSearch }: InvestigationScopeBarProps) {
  const composeProjectScopingSupported = state.selectedSource?.capabilities.composeProjectScoping ?? false;

  return (
    <div className={styles.bar}>
      <span className={styles.field}>
        <span className={styles.k}>Source</span>
        <span className={styles.v}>{state.selectedSource?.displayName ?? state.selectedSourceId ?? '—'}</span>
        <SourceHealthBadge health={state.health} loading={state.healthLoading} onRetry={state.retryHealth} />
      </span>
      {composeProjectScopingSupported && state.selectedComposeProject ? (
        <span className={styles.field}>
          <span className={styles.k}>Project</span>
          <span className={styles.v}>{state.selectedComposeProject}</span>
        </span>
      ) : null}
      <span className={styles.field}>
        <Icon name="clock" size="sm" />
        <span className={styles.v}>{getTimeRangeDisplayLabel(state.timeRange)}</span>
      </span>
      <span className={styles.kept}>
        <Icon name="filter" size="sm" />
        {keptNote}
      </span>
      <Button variant="ghost" onClick={onEditSearch}>
        <Icon name="sliders-horizontal" size="sm" />
        Edit search
      </Button>
    </div>
  );
}
