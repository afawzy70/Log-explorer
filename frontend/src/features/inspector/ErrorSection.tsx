import type { LogEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { FieldList } from '../../shared/ui/FieldList';
import { copyToClipboard } from '../../shared/browser/clipboard';
import { buildErrorFields, deriveExceptionSummary } from './sections';
import { EmptySectionNote, InspectorSection } from './InspectorSection';
import styles from './ErrorSection.module.css';

/**
 * The dedicated "Error" tab (LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY) - only ever rendered by
 * `EventInspector.tsx` when `eventHasErrorInfo(event)` is true, so this component itself never has to
 * decide whether it should exist, only how to present what's there. Error code, exception type/class
 * (derived, never fabricated - see `deriveExceptionSummary`), exception message, and the full raw
 * exception/stack trace as one preserved-whitespace text node (never `dangerouslySetInnerHTML` -
 * CLAUDE.md §2 rule 3), reusing the exact bounded-scroll monospace treatment the former combined
 * Business/error tab already had for it.
 */
export function ErrorSection({ event }: { event: LogEvent }) {
  const fields = buildErrorFields(event);
  const summary = event.exception ? deriveExceptionSummary(event.exception) : null;

  if (fields.length === 0 && !event.exception) {
    // Severity alone (ERROR/FATAL, no exception payload) is exactly why this tab exists at all - a
    // truthful explanation, never an invented stack trace.
    return (
      <InspectorSection title="Error">
        <EmptySectionNote>
          This event's severity ({event.severity}) indicates an error, but it carries no exception or
          error code payload.
        </EmptySectionNote>
      </InspectorSection>
    );
  }

  return (
    <InspectorSection title="Error">
      <FieldList items={fields} />
      {summary?.exceptionType ? (
        <FieldList items={[{ label: 'Exception type', value: summary.exceptionType, monospace: true }]} />
      ) : null}
      {event.exception ? (
        <>
          <div className={styles.exceptionHeader}>
            <h3 className={styles.exceptionHeading}>Exception</h3>
            <Button variant="ghost" onClick={() => void copyToClipboard(event.exception!)}>
              Copy
            </Button>
          </div>
          <pre className={styles.exception}>{event.exception}</pre>
        </>
      ) : null}
    </InspectorSection>
  );
}
