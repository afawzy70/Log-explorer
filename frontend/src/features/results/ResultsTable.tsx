import type { JourneyField, LogEvent } from '../../shared/api/types';
import { SEVERITY_LEVELS } from '../search/severityLevels';
import { EMPTY_VALUE, formatTimestampCell, resolveCorrelationOrTrace, resolveService, resolveUserOrCustomer } from './columnMapping';
import { RESULT_COLUMNS } from './columns';
import { MessageCell } from './MessageCell';
import { ActionsCell } from './ActionsCell';
import styles from './ResultsTable.module.css';

function levelColor(severity: string | null): string | undefined {
  return SEVERITY_LEVELS.find((l) => l.id === severity?.toUpperCase())?.colorVar;
}

/**
 * The seven-column semantic contract (IMPLEMENTATION_PLAN.md "Phase G").
 * One `<table>`, one `<colgroup>`, `table-layout: fixed` - header and body
 * share the same geometry system because they are literally the same
 * table, not independently-styled grid/flex layouts (HANDOVER.md §15.2:
 * "do not apply independent grid/flex layouts to header and body").
 *
 * `selectedIndex`/`onInspect` are the event inspector's row-selection
 * contract (IMPLEMENTATION_PLAN.md "Phase H": "selected row stays
 * identifiable"). `onOpenJourney` makes the Correlation/Trace cell's own
 * ID a click action too (HANDOVER.md §17: "supported click actions on
 * non-sensitive IDs" - not scoped only to the inspector's Request Flow
 * section). Both are optional so this component still works standalone in
 * tests/stories that don't need them wired up.
 */
export interface ResultsTableProps {
  events: LogEvent[];
  selectedIndex?: number | null;
  onInspect?: (index: number) => void;
  onOpenJourney?: (field: JourneyField, value: string) => void;
}

export function ResultsTable({ events, selectedIndex = null, onInspect, onOpenJourney }: ResultsTableProps) {
  return (
    <div className={styles.scrollWrapper} data-testid="results-scroll-wrapper">
      <table className={styles.table}>
        <colgroup>
          {RESULT_COLUMNS.map((col) => (
            <col key={col.id} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {RESULT_COLUMNS.map((col) => (
              <th key={col.id} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => {
            const userOrCustomer = resolveUserOrCustomer(event);
            const correlationOrTrace = resolveCorrelationOrTrace(event);
            const color = levelColor(event.severity);
            return (
              // Index is stable for the lifetime of one rendered result
              // set (events are never reordered/added mid-render - a
              // fresh search always replaces the whole list) and the
              // backend gives no other stable per-event id to key on.
              // eslint-disable-next-line react/no-array-index-key
              <tr key={index} className={index === selectedIndex ? styles.selectedRow : undefined}>
                <td className={styles.timeCell}>{formatTimestampCell(event.timestamp)}</td>
                <td>
                  <span className={styles.levelCell}>
                    {color ? <span className={styles.levelDot} style={{ background: color }} aria-hidden="true" /> : null}
                    {event.severity ?? EMPTY_VALUE}
                  </span>
                </td>
                <td className={styles.serviceCell}>{resolveService(event)}</td>
                <td>
                  <MessageCell event={event} />
                </td>
                <td className={styles.idCell}>
                  {userOrCustomer ? (
                    <>
                      <span className={styles.idLabel}>{userOrCustomer.label}:</span>
                      <span className={styles.protectedValue}>{userOrCustomer.value}</span>
                    </>
                  ) : (
                    EMPTY_VALUE
                  )}
                </td>
                <td className={styles.idCell}>
                  {correlationOrTrace ? (
                    onOpenJourney ? (
                      // The whole cell is one button (not just the value)
                      // deliberately: a real, previously-caught bug (Phase
                      // H's ActionsCell menu, and this same class of bug
                      // found again here - see ResultsTable.module.css's
                      // own comment) showed that a clickable element whose
                      // own bounding box exceeds an ancestor's `overflow:
                      // hidden` clip can be visually correct yet
                      // unclickable in the clipped region. Giving the
                      // button its own `width: 100%` + `overflow: hidden`
                      // (`.idLinkCell`) makes its clickable box exactly
                      // match its visible, ellipsis-truncated box.
                      <button
                        type="button"
                        className={styles.idLinkCell}
                        onClick={() => onOpenJourney(correlationOrTrace.field, correlationOrTrace.value)}
                        title={`Find this ${correlationOrTrace.label}`}
                      >
                        <span className={styles.idLabel}>{correlationOrTrace.label}:</span>
                        {correlationOrTrace.value}
                      </button>
                    ) : (
                      <>
                        <span className={styles.idLabel}>{correlationOrTrace.label}:</span>
                        {correlationOrTrace.value}
                      </>
                    )
                  ) : (
                    EMPTY_VALUE
                  )}
                </td>
                <td className={styles.actionsCell}>
                  <ActionsCell event={event} onInspect={() => onInspect?.(index)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
