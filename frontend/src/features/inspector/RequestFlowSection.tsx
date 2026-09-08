import type { LogEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { copyToClipboard } from '../../shared/browser/clipboard';
import { buildRequestFlowIdentifiers } from './sections';
import type { RequestFlowIdentifier } from './sections';
import { EmptySectionNote, InspectorSection } from './InspectorSection';
import { ContextAction } from './ContextAction';
import styles from './RequestFlowSection.module.css';

export interface RequestFlowSectionProps {
  event: LogEvent;
  onFindRelated: (field: RequestFlowIdentifier['field'], value: string) => void;
  onShowContext: () => void;
}

/**
 * "Request flow" (HANDOVER.md §16.4): journeyId/correlationId/traceId/
 * spanId/eventId, each with copy (non-sensitive IDs only - every field
 * here already is one) and a "find related logs" action, plus the
 * event-level "surrounding context" action.
 */
export function RequestFlowSection({ event, onFindRelated, onShowContext }: RequestFlowSectionProps) {
  const identifiers = buildRequestFlowIdentifiers(event);

  return (
    <InspectorSection title="Request flow">
      {identifiers.length === 0 ? (
        <EmptySectionNote>No journey, correlation, trace, span, or event ID on this event.</EmptySectionNote>
      ) : (
        <ul className={styles.list}>
          {identifiers.map((id) => (
            <li key={id.field} className={styles.row}>
              <span className={styles.label}>{id.label}</span>
              <span className={styles.value}>{id.value}</span>
              <span className={styles.rowActions}>
                <Button variant="ghost" onClick={() => void copyToClipboard(id.value)}>
                  Copy
                </Button>
                <Button variant="ghost" onClick={() => onFindRelated(id.field, id.value)}>
                  Find related logs
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.contextRow}>
        <ContextAction event={event} onConfirm={onShowContext} />
      </div>
    </InspectorSection>
  );
}
