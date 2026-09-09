import type { JourneyField, LogEvent } from '../../shared/api/types';
import { COLUMN_REGISTRY_BY_ID, DEFAULT_COLUMN_ORDER, DEFAULT_HIDDEN_COLUMN_IDS, ACTIONS_COLUMN_WIDTH } from './columnRegistry';
import type { ColumnId } from './columnRegistry';
import { ActionsCell } from './ActionsCell';
import type { TableDensity } from './tablePreferences';
import styles from './ResultsTable.module.css';

/**
 * The results table (IMPLEMENTATION_PLAN.md "Phase G", column-configurable
 * since Legacy Remediation Slice 4, `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md`
 * §"Slice 4"). One `<table>`, one `<colgroup>`, `table-layout: fixed` -
 * header and body share the same geometry system because they are
 * literally the same table, not independently-styled grid/flex layouts
 * (HANDOVER.md §15.2). Every visible column, in order, comes from
 * {@link COLUMN_REGISTRY_BY_ID} via `columnOrder`/`hiddenColumnIds` - the
 * owner-mandated default (`columnOrder`/`hiddenColumnIds` both omitted)
 * renders exactly the original seven columns, in the original order, with
 * byte-for-byte the same markup shape as before this slice - every
 * pre-Slice-4 test in this file's own test suite still passes unchanged
 * against that default, which is deliberate: it is this table's own
 * regression proof of the "default seven-column invariant."
 *
 * <p><b>Actions is mandatory and position-pinned</b> (Legacy Remediation
 * Slice 4 owner decision): it is not a member of {@link COLUMN_REGISTRY_BY_ID}
 * at all, so no preference - saved, malformed, or otherwise - can hide or
 * reorder it; it is always rendered last. This table has no row-click or
 * row-level keyboard shortcut to open the inspector independent of
 * `ActionsCell`'s own "Inspect event" menu item - Actions is structurally
 * the only inspection entry point, so per this slice's own explicit
 * fallback rule ("If that cannot be guaranteed, keep Actions mandatory"),
 * it is kept mandatory rather than risking an unreachable inspector.
 *
 * `selectedIndex`/`onInspect` are the event inspector's row-selection
 * contract (IMPLEMENTATION_PLAN.md "Phase H"). `onOpenJourney` makes the
 * Correlation/Trace cell's own ID a click action too (HANDOVER.md §17).
 * Both are optional so this component still works standalone in
 * tests/stories that don't need them wired up. `density` only ever
 * changes CSS (row height/padding) - never re-fetches or re-shapes data.
 */
export interface ResultsTableProps {
  events: LogEvent[];
  selectedIndex?: number | null;
  onInspect?: (index: number) => void;
  onOpenJourney?: (field: JourneyField, value: string) => void;
  /** Every non-"actions" column id, in display order (visible or hidden) - defaults to the registry's own default order. */
  columnOrder?: ColumnId[];
  /** Subset of `columnOrder` currently hidden - defaults to every optional column (i.e. exactly the seven-column default). */
  hiddenColumnIds?: ColumnId[];
  density?: TableDensity;
}

export function ResultsTable({
  events,
  selectedIndex = null,
  onInspect,
  onOpenJourney,
  columnOrder = DEFAULT_COLUMN_ORDER,
  hiddenColumnIds = DEFAULT_HIDDEN_COLUMN_IDS,
  density = 'comfortable',
}: ResultsTableProps) {
  const hiddenSet = new Set(hiddenColumnIds);
  const visibleColumns = columnOrder
    .filter((id) => !hiddenSet.has(id))
    .map((id) => COLUMN_REGISTRY_BY_ID.get(id))
    .filter((col): col is NonNullable<typeof col> => col != null);

  const tableClassName = density === 'compact' ? `${styles.table} ${styles.compact}` : styles.table;

  return (
    <div className={styles.scrollWrapper} data-testid="results-scroll-wrapper">
      <table className={tableClassName}>
        <colgroup>
          {visibleColumns.map((col) => (
            <col key={col.id} style={col.width ? { width: col.width } : undefined} />
          ))}
          <col style={{ width: ACTIONS_COLUMN_WIDTH }} />
        </colgroup>
        <thead>
          <tr>
            {visibleColumns.map((col) => (
              <th key={col.id} scope="col">
                {col.label}
              </th>
            ))}
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            // Index is stable for the lifetime of one rendered result set
            // (events are never reordered/added mid-render - a fresh
            // search always replaces the whole list) and the backend
            // gives no other stable per-event id to key on.
            // eslint-disable-next-line react/no-array-index-key
            <tr key={index} className={index === selectedIndex ? styles.selectedRow : undefined}>
              {visibleColumns.map((col) => (
                <td key={col.id} className={col.cellClassName}>
                  {col.render(event, { onOpenJourney })}
                </td>
              ))}
              <td className={styles.actionsCell}>
                <ActionsCell event={event} onInspect={() => onInspect?.(index)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
