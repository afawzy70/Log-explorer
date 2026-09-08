import type { JourneyField, LogEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { copyToClipboard } from '../../shared/browser/clipboard';
import { buildRequestFlowIdentifiers } from './sections';
import { EmptySectionNote, InspectorSection } from './InspectorSection';
import { ContextAction } from './ContextAction';
import styles from './RequestFlowSection.module.css';

export interface RequestFlowSectionProps {
  event: LogEvent;
  onOpenJourney: (field: JourneyField, value: string) => void;
  onShowContext: () => void;
}

/**
 * "Journey" click actions on non-sensitive IDs (IMPLEMENTATION_PLAN.md
 * "Phase I" scope item 1) are exactly these four - never spanId, which
 * has no "Find this Span" action in the plan's own scope; it still gets
 * Copy like every other identifier here.
 */
const JOURNEY_CLICKABLE_FIELDS: ReadonlySet<string> = new Set<JourneyField>([
  'journeyId',
  'correlationId',
  'traceId',
  'eventId',
]);

/**
 * "Request flow" (HANDOVER.md §16.4): journeyId/correlationId/traceId/
 * spanId/eventId, each with copy (non-sensitive IDs only - every field
 * here already is one) and, for the four Phase I owns ("Find this trace /
 * correlation / journey / event" - HANDOVER.md §17), a click action that
 * opens the journey timeline - plus the event-level "surrounding context"
 * action.
 */
export function RequestFlowSection({ event, onOpenJourney, onShowContext }: RequestFlowSectionProps) {
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
                {JOURNEY_CLICKABLE_FIELDS.has(id.field) ? (
                  <Button variant="ghost" onClick={() => onOpenJourney(id.field as JourneyField, id.value)}>
                    Find this {id.label}
                  </Button>
                ) : null}
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
