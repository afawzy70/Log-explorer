import type { ReactNode } from 'react';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import type { QueryPlan, SearchDirection } from '../../shared/api/types';
import { SortControl } from './SortControl';
import { TableSettingsControl } from './TableSettingsControl';
import { QueryPlanDisclosure } from './QueryPlanDisclosure';
import type { TablePreferencesHandle } from './tablePreferences';
import styles from './ScopeStrip.module.css';

export interface ScopeStripProps {
  /** Always rendered - the `<ActiveFilters .../>` element itself (this component never rebuilds its props). */
  activeFilters: ReactNode;
  /** The counts/interval summary sentence. Omitted whenever `ResultsPanel` has none to show yet (matches the pre-recompose behaviour exactly - see its own callers). */
  readout?: string;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  queryPlan?: QueryPlan;
  sort?: { value: SearchDirection; onChange: (next: SearchDirection) => void; disabled?: boolean };
  table?: TablePreferencesHandle;
}

/**
 * B2 (Session 4) - "scope strip" (`COMPONENT_INVENTORY.md`'s ActiveFilters.tsx/
 * ResultsPanel.tsx/SortControl.tsx/QueryPlanDisclosure.tsx RECOMPOSE rows):
 * the active-filter chips, the results readout, Sort, Columns, Query
 * details and Refresh consolidated into one persistent row, replacing
 * Toolbar's own separate `.activeFiltersRow` and ResultsPanel's own
 * separate `.summaryRow`.
 *
 * <p>Deliberately a purely presentational wrapper: `ResultsPanel` (the
 * only caller) still decides exactly which of `readout`/`onRefresh`/
 * `queryPlan`/`sort`/`table` apply to its current state branch (error,
 * loading, pre-search, zero-result, populated, context) - this component
 * only renders whichever of those five are actually passed, so every one
 * of the pre-recompose per-state visibility rules (Sort and Columns only
 * once real results exist; Sort never in a context view; Refresh and
 * Query details from the moment a search has run at all) carries over
 * unchanged, now expressed as an omitted prop instead of a separate JSX
 * branch.
 *
 * <p>`activeFilters` chips (and "Clear all") always render regardless of
 * search state, matching the exact pre-recompose behaviour of
 * `Toolbar`'s own always-mounted `ActiveFilters` - the only actual
 * visibility change from the recompose is that the strip (chips
 * included) is no longer shown while Live/Settings/Field mapping/
 * Classification rules/Journey are the active view, since it is now
 * owned by `ResultsPanel`, which itself only mounts for the plain search
 * view - `COMPONENT_INVENTORY.md`'s own prototype states agree with this
 * (`compactScope`, not the full `scopeStrip`, is what those other views
 * show).
 */
export function ScopeStrip({ activeFilters, readout, onRefresh, refreshDisabled, queryPlan, sort, table }: ScopeStripProps) {
  const hasRightSide = readout != null || onRefresh != null || queryPlan != null || sort != null || table != null;
  return (
    <div className={styles.strip}>
      <div className={styles.chips}>{activeFilters}</div>
      {hasRightSide ? (
        <div className={styles.right}>
          {readout != null ? (
            <span className={styles.readout} aria-live="polite">
              {readout}
            </span>
          ) : null}
          {sort ? <SortControl value={sort.value} onChange={sort.onChange} disabled={sort.disabled} /> : null}
          {table ? <TableSettingsControl table={table} /> : null}
          {queryPlan ? <QueryPlanDisclosure queryPlan={queryPlan} /> : null}
          {onRefresh ? (
            <Button variant="ghost" onClick={onRefresh} disabled={refreshDisabled}>
              <Icon name="rotate-cw" size="sm" />
              Refresh
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
