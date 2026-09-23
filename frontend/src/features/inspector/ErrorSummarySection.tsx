import type { LogEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { FieldList } from '../../shared/ui/FieldList';
import type { FieldItem } from '../../shared/ui/FieldList';
import { deriveExceptionSummary, eventHasErrorInfo, hasMeaningfulText } from './sections';
import styles from './ErrorSummarySection.module.css';

/**
 * Overview's "Error Summary" (LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY) - shown near the top of
 * Overview, immediately for an event that "contains error information" (see `eventHasErrorInfo`: ERROR/
 * FATAL severity, a real exception, or a real error code), with only the values that actually exist -
 * never a fabricated field. Renders nothing at all for a non-error event, the same "absent means null"
 * pattern `ClassificationSection` already establishes for Overview's other conditional block, so this
 * never claims an event succeeded when the data doesn't establish that (it just says nothing either way).
 */
export function ErrorSummarySection({ event, onViewErrorDetails }: { event: LogEvent; onViewErrorDetails: () => void }) {
  if (!eventHasErrorInfo(event)) {
    return null;
  }

  const fields: FieldItem[] = [];
  if (event.severity) {
    fields.push({ label: 'Severity', value: event.severity });
  }
  if (hasMeaningfulText(event.errorCode)) {
    fields.push({ label: 'Error code', value: event.errorCode, monospace: true });
  }
  const summary = hasMeaningfulText(event.exception) ? deriveExceptionSummary(event.exception) : null;
  if (summary?.exceptionType) {
    fields.push({ label: 'Exception type', value: summary.exceptionType, monospace: true });
  }

  return (
    <section className={styles.section} aria-label="Error summary">
      <h2 className={styles.heading}>Error summary</h2>
      <FieldList items={fields} />
      {summary ? (
        <pre className={styles.preview}>{summary.preview}</pre>
      ) : null}
      <Button variant="secondary" onClick={onViewErrorDetails}>
        View full error details
      </Button>
    </section>
  );
}
