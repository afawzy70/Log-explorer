import type { LogEvent } from '../../shared/api/types';
import { COLUMN_REGISTRY_BY_ID } from './columnRegistry';
import type { ColumnId } from './columnRegistry';

export type SortDirectionAscDesc = 'asc' | 'desc';

/**
 * Pre-closure functional recovery (§17/§22): the currently active
 * per-column display sort, or `null` when display order simply follows
 * whatever order `events` was given in (i.e. the backend's own Newest/
 * Oldest fetch order - `ResultsTable`'s dedicated Time-sort handling,
 * never this state). Exactly ONE authoritative active sort at a time
 * (§17: "keep one authoritative active sort") - this state and the
 * existing `sortDirection`/Newest-Oldest state are mutually exclusive in
 * what they visually indicate, even though `sortDirection` always
 * continues to govern what gets fetched from the backend regardless.
 */
export interface ColumnSortState {
  columnId: ColumnId;
  direction: SortDirectionAscDesc;
}

/**
 * Deterministic ordering for a sort accessor's raw value: `null`/`undefined`
 * always sorts last, regardless of direction (a missing value is neither
 * "smallest" nor "largest" - it is absent, and burying it at the bottom in
 * both directions is the least surprising, most consistent behavior).
 * Numbers compare numerically; everything else compares as a
 * locale-aware string (works correctly for the numeric-looking IDs in
 * this table too, e.g. "event-000400", since they are compared as
 * whole strings, not parsed).
 */
export function compareSortValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const aMissing = a == null || a === '';
  const bMissing = b == null || b === '';
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** One event paired with its TRUE position in the original (fetch-order) array - see `sortIndexedEventsByColumn`'s own doc comment for why this, and not `eventIdentity`, is the correct way to track "original index" through a sort. */
export interface IndexedEvent {
  event: LogEvent;
  originalIndex: number;
}

/**
 * A pure, bounded, client-side transform over the ALREADY-LOADED events
 * array - never a second pagination model (CLAUDE.md §4: "One pagination
 * model only"). This never fetches more data, never changes what is
 * loaded, and is re-applied on every render from the same source array -
 * `events` itself is never mutated (a fresh sorted copy every time).
 *
 * <p>Operates on {@link IndexedEvent} pairs, not bare {@link LogEvent}s,
 * pairing every event with its real array position BEFORE sorting -
 * deliberately not re-derived afterward via `eventIdentity`, which is
 * only a *content*-based identity (timestamp + source + stream +
 * message/rawLine + trace/correlation/journey/event ids, etc. -
 * deliberately NOT including e.g. `service`/`severity`). Two distinct
 * events that happen to be equal on every field `eventIdentity` compares
 * (a real, unremarkable case - e.g. two background heartbeat events from
 * different services at the same synthetic timestamp) would collide if
 * "original index" were looked up by identity after reordering; pairing
 * first makes that collision structurally impossible.
 */
export function sortIndexedEventsByColumn(indexed: IndexedEvent[], sort: ColumnSortState | null): IndexedEvent[] {
  if (!sort) {
    return indexed;
  }
  const column = COLUMN_REGISTRY_BY_ID.get(sort.columnId);
  if (!column?.sortAccessor) {
    // A column with no accessor is truthfully not sortable - defensively
    // never silently reorder if one somehow reaches here anyway.
    return indexed;
  }
  const accessor = column.sortAccessor;
  const withValues = indexed.map((item) => ({ ...item, value: accessor(item.event) }));
  withValues.sort((a, b) => {
    const aMissing = a.value == null || a.value === '';
    const bMissing = b.value == null || b.value === '';
    // Missing-value placement is direction-INDEPENDENT (always last) -
    // deliberately checked before the direction flip below, not inside
    // it: naively negating a comparator that also encodes "missing sorts
    // last" would flip missing values to sort FIRST on a descending
    // click, the opposite of this column's own stated contract.
    if (aMissing && bMissing) {
      return a.originalIndex - b.originalIndex;
    }
    if (aMissing) return 1;
    if (bMissing) return -1;
    const cmp = compareSortValues(a.value, b.value);
    if (cmp !== 0) {
      return sort.direction === 'asc' ? cmp : -cmp;
    }
    // Stable tie-break: preserve the original (fetch) order for equal values.
    return a.originalIndex - b.originalIndex;
  });
  return withValues.map(({ event, originalIndex }) => ({ event, originalIndex }));
}

/** Toggle semantics for clicking a column header: inactive→asc, asc→desc, desc→asc. */
export function nextColumnSort(current: ColumnSortState | null, columnId: ColumnId): ColumnSortState {
  if (current?.columnId !== columnId) {
    return { columnId, direction: 'asc' };
  }
  return { columnId, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}
