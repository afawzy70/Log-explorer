import type { LogEvent } from '../../shared/api/types';
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
 */
export function ResultsTable({ events }: { events: LogEvent[] }) {
  return (
    <div className={styles.scrollWrapper}>
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
              <tr key={index}>
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
                    <>
                      <span className={styles.idLabel}>{correlationOrTrace.label}:</span>
                      {correlationOrTrace.value}
                    </>
                  ) : (
                    EMPTY_VALUE
                  )}
                </td>
                <td>
                  <ActionsCell event={event} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
