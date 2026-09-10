import { Fragment } from 'react';
import type { KeyboardEvent } from 'react';
import type { JourneyField, LogEvent } from '../../shared/api/types';
import { COLUMN_REGISTRY_BY_ID, DEFAULT_COLUMN_ORDER, DEFAULT_HIDDEN_COLUMN_IDS, ACTIONS_COLUMN_WIDTH } from './columnRegistry';
import type { ColumnId } from './columnRegistry';
import { ActionsCell } from './ActionsCell';
import type { TableDensity } from './tablePreferences';
import { eventIdentity } from '../../app/useSearchState';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { formatGapDuration } from './gapDetection';
import type { GapMarker } from './gapDetection';
import { formatUtcTimestamp } from '../inspector/timestampFormat';
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
 * reorder it; it is always rendered last.
 *
 * <p><b>UX-R4 §6/§17 - row click is now the primary inspection path, and
 * Actions is no longer the only one.</b> Before UX-R4 this table had no
 * row-click or row-level keyboard affordance at all: reaching the
 * inspector meant travelling to a 56px-wide "…" trigger pinned to the far
 * right of the row, away from the message the investigator was actually
 * reading. Clicking anywhere on a row now selects and opens that event,
 * and the row itself is keyboard-operable (Enter/Space). Actions is
 * deliberately *kept* rather than replaced (§17): row click is the fast
 * path, the menu is the discoverable, explicitly-labelled one - "View
 * details" is the same single semantic action as row click (§18), not a
 * competing second implementation.
 *
 * `selectedIndex`/`onInspect` are the event inspector's row-selection
 * contract (IMPLEMENTATION_PLAN.md "Phase H"). `onOpenJourney` makes the
 * Correlation/Trace cell's own ID a click action too (HANDOVER.md §17).
 * Both are optional so this component still works standalone in
 * tests/stories that don't need them wired up. `density` only ever
 * changes CSS (row height/padding) - never re-fetches or re-shapes data.
 *
 * <p><b>Arrow-key row navigation</b> (UI Parity Acceleration Pass §6/§10 -
 * TABLE-06 in the pre-pass capability matrix, `NEW_PARTIAL`: OLD supported
 * row-to-row Arrow key traversal, NEW previously only had Tab): `<tbody>`'s
 * own `onKeyDown` moves focus to the next/previous row's Actions trigger
 * on ArrowDown/ArrowUp - a pure focus move, never a selection or inspector
 * side effect on its own. Actions remains the only inspection entry
 * point; this only makes reaching a given row's Actions button faster.
 */
export interface ResultsTableProps {
  events: LogEvent[];
  selectedIndex?: number | null;
  onInspect?: (index: number) => void;
  /**
   * UX-R4 §17/§19 - "Show surrounding logs" from the row's own Actions
   * menu. Uses the existing bounded ±30s context mechanism
   * (`useSearchState`'s `showContext`) - this table never computes a
   * window of its own. Optional so the component still renders standalone
   * in tests/stories that don't wire it up; the menu item is simply absent
   * when it isn't provided, never a dead control.
   */
  onShowContext?: (event: LogEvent) => void;
  onOpenJourney?: (field: JourneyField, value: string) => void;
  /** Every non-"actions" column id, in display order (visible or hidden) - defaults to the registry's own default order. */
  columnOrder?: ColumnId[];
  /** Subset of `columnOrder` currently hidden - defaults to every optional column (i.e. exactly the seven-column default). */
  hiddenColumnIds?: ColumnId[];
  density?: TableDensity;
  /**
   * UI Gap Closure Pass - "Context ordering": when set (only ever true in
   * a "Show ±30 seconds" context view), marks the row whose
   * {@link eventIdentity} matches as the original event the investigator
   * was looking at, independent of `selectedIndex`/the inspector's own
   * open state - conveyed via both a visible marker and `aria-current`
   * (never color alone).
   */
  contextRootIdentity?: string | null;
  /**
   * Legacy Remediation Slice 6 - investigation-gap markers (only ever
   * passed in a context view; `gapDetection.ts` computes these once in
   * `ResultsPanel.tsx`, shared with `ContextSummary`'s own count/list, so
   * both never disagree). Rendered as extra `<tr>`s interleaved between
   * the real event rows they fall between (`afterIndex`) - deliberately
   * NOT a merged/`colSpan` cell: every gap row still renders exactly one
   * `<td>` per visible column (message in the first, "—" in the rest,
   * matching this table's own "never omit a cell" convention), so the
   * table's own `table-layout: fixed`/per-column geometry invariant
   * (CLAUDE.md §4) holds for a gap row exactly the same way it holds for
   * an event row - `assertTableGeometry` would pass against this table
   * even with gap rows present, not just without them.
   */
  gaps?: GapMarker[];
}

/**
 * UX-R4 §6 - a click anywhere on a row selects/opens that event, *except*
 * when it originated inside a control with its own click semantics: the
 * Actions trigger and its menu items, and the Correlation/Trace cell's own
 * journey buttons (`columnRegistry`'s `idLinkCell`). Without this guard,
 * opening the Actions menu or following a trace ID would also open the
 * inspector underneath it - two different things happening from one click.
 */
/**
 * UX-R4 §15 - row-level severity emphasis, deliberately restrained: only
 * ERROR and WARN get any row treatment at all, so an ordinary INFO-heavy
 * result set stays a calm, scannable list rather than a rainbow. ERROR
 * additionally gets a faint background tint (it is the level an
 * investigator must never scroll past); WARN gets only the edge rail.
 * Neither is ever the sole carrier of meaning - the Level cell itself
 * still spells out "ERROR"/"WARN" in text next to its own dot (CLAUDE.md
 * §7 "never color alone").
 */
function severityRowClass(severity: string | null | undefined): string | null {
  switch (severity?.toUpperCase()) {
    case 'ERROR':
    case 'FATAL':
      return styles.errorRow;
    case 'WARN':
    case 'WARNING':
      return styles.warnRow;
    default:
      return null;
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, input, select, textarea, [role="menu"], [role="menuitem"], [role="dialog"]') != null
  );
}

/**
 * ArrowDown/ArrowUp within the table body move focus row-to-row (UI Parity
 * Acceleration Pass §6/§10 - TABLE-06: OLD supported row-to-row Arrow key
 * traversal, NEW previously only had Tab).
 *
 * <p>UX-R4 §6/§35 extends this: rows themselves are now focusable, so
 * traversal moves between *rows* when focus is on a row, and continues to
 * move between Actions triggers when focus is on one - whichever the
 * investigator is currently using, Arrow keys keep doing the same thing
 * within it. It stays a pure focus move, never a selection or inspector
 * side effect of its own. (Enter/Space is handled on the row element
 * itself, where `onInspect` is in scope - see the row's own `onKeyDown`.)
 *
 * <p>Rows use a **roving tabindex** (see `ResultsTable` below), so the
 * whole table is a single Tab stop rather than one stop per row - a
 * 200-row result set must never put 200 tab stops between the table and
 * the "Load more" button.
 */
function handleRowKeyDown(event: KeyboardEvent<HTMLTableSectionElement>) {
  const target = event.target as HTMLElement;
  const row = target.closest('tr');
  const tbody = row?.parentElement;
  if (!row || !tbody) {
    return;
  }

  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return;
  }
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const currentIndex = rows.indexOf(row);
  if (currentIndex === -1) {
    return;
  }
  const onRow = target === row;
  // A gap-marker row (Legacy Remediation Slice 6) is not an event: it has
  // no Actions button and is not focusable - step past any number of them
  // in the given direction to reach the next real event row, rather than
  // silently doing nothing when the adjacent row happens to be a gap.
  const step = event.key === 'ArrowDown' ? 1 : -1;
  let i = currentIndex + step;
  let next: HTMLElement | null = null;
  while (i >= 0 && i < rows.length) {
    next = onRow
      ? (rows[i].matches('[data-row-index]') ? (rows[i] as HTMLElement) : null)
      : rows[i].querySelector<HTMLButtonElement>('button[aria-label="Actions for this event"]');
    if (next) {
      break;
    }
    i += step;
  }
  if (!next) {
    return;
  }
  event.preventDefault();
  next.focus();
}

export function ResultsTable({
  events,
  selectedIndex = null,
  onInspect,
  onShowContext,
  onOpenJourney,
  columnOrder = DEFAULT_COLUMN_ORDER,
  hiddenColumnIds = DEFAULT_HIDDEN_COLUMN_IDS,
  density = 'comfortable',
  contextRootIdentity = null,
  gaps = [],
}: ResultsTableProps) {
  const hiddenSet = new Set(hiddenColumnIds);
  const visibleColumns = columnOrder
    .filter((id) => !hiddenSet.has(id))
    .map((id) => COLUMN_REGISTRY_BY_ID.get(id))
    .filter((col): col is NonNullable<typeof col> => col != null);

  const gapsByAfterIndex = new Map<number, GapMarker>();
  gaps.forEach((gap) => gapsByAfterIndex.set(gap.afterIndex, gap));

  const tableClassName = density === 'compact' ? `${styles.table} ${styles.compact}` : styles.table;

  // Roving tabindex (§6/§35): exactly one row is in the tab order at a
  // time - the selected one if there is a selection, otherwise the first
  // row - so Tab reaches the table in one stop and Arrow keys move within
  // it, instead of every row becoming its own tab stop.
  const focusableRowIndex = selectedIndex != null && selectedIndex < events.length ? selectedIndex : 0;

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
        <tbody onKeyDown={handleRowKeyDown}>
          {events.map((event, index) => {
            const isContextRoot = contextRootIdentity != null && eventIdentity(event) === contextRootIdentity;
            const rowClassName = [
              severityRowClass(event.severity),
              index === selectedIndex ? styles.selectedRow : null,
              isContextRoot ? styles.contextRootRow : null,
            ]
              .filter(Boolean)
              .join(' ') || undefined;
            const gap = gapsByAfterIndex.get(index);
            return (
              // Index is stable for the lifetime of one rendered result set
              // (events are never reordered/added mid-render - a fresh
              // search always replaces the whole list) and the backend
              // gives no other stable per-event id to key on.
              // eslint-disable-next-line react/no-array-index-key
              <Fragment key={index}>
                <tr
                  className={rowClassName}
                  data-row-index={index}
                  aria-current={isContextRoot ? 'location' : undefined}
                  aria-selected={index === selectedIndex}
                  tabIndex={index === focusableRowIndex ? 0 : -1}
                  onClick={(e) => {
                    if (isInteractiveTarget(e.target)) {
                      return;
                    }
                    onInspect?.(index);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) {
                      return; // a real control inside the row owns its own keys
                    }
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onInspect?.(index);
                    }
                  }}
                >
                  {visibleColumns.map((col) => (
                    <td key={col.id} className={col.cellClassName}>
                      {col.render(event, { onOpenJourney })}
                    </td>
                  ))}
                  <td className={styles.actionsCell}>
                    {isContextRoot ? <VisuallyHidden>Original event you were investigating</VisuallyHidden> : null}
                    <ActionsCell
                      event={event}
                      onInspect={() => onInspect?.(index)}
                      onShowContext={onShowContext ? () => onShowContext(event) : undefined}
                    />
                  </td>
                </tr>
                {gap ? (
                  <tr className={styles.gapRow} data-testid="gap-row">
                    {visibleColumns.map((col, colIndex) => (
                      <td key={col.id} className={col.cellClassName}>
                        {colIndex === 0
                          ? `Gap detected — ${formatGapDuration(gap.durationMs)} with no observed events (${formatUtcTimestamp(gap.fromTimestamp)} → ${formatUtcTimestamp(gap.toTimestamp)})`
                          : '—'}
                      </td>
                    ))}
                    <td className={styles.actionsCell}>—</td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
