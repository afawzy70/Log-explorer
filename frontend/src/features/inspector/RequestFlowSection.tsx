import type { JourneyField, LogEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { copyToClipboard } from '../../shared/browser/clipboard';
import { buildRequestFlowIdentifiers } from './sections';
import { EmptySectionNote, InspectorSection } from './InspectorSection';
import styles from './RequestFlowSection.module.css';

export interface RequestFlowSectionProps {
  event: LogEvent;
  onOpenJourney: (field: JourneyField, value: string) => void;
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
 * opens the journey timeline.
 *
 * <p><b>UX-R5 §14 - the "Show surrounding logs" action no longer lives
 * here.</b> It was previously the last control in this section, which
 * measured 1,261px below the top of the inspector panel on a 900px
 * viewport: an event-level action buried inside one of five stacked
 * sections, reachable only by remembering which one it was in. It is now
 * a single inspector-level action in the sticky header, visible from
 * anywhere in the panel. It is deliberately **not** duplicated back into
 * this or any other section (§14: "Do NOT duplicate a separate context
 * button inside every tab").
 */
export function RequestFlowSection({ event, onOpenJourney }: RequestFlowSectionProps) {
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
              {/*
                * UX-R5 §11 - "Copy" is rendered LAST, so it is anchored to
                * the same trailing edge on every row. Before UX-R5 it came
                * first inside a trailing-aligned group, which meant its
                * horizontal position depended on whether that row also had
                * a "Find this …" action: Span ID (the one identifier with
                * no journey action) put its Copy ~330px to the right of
                * every other row's Copy. Same control, same job, different
                * place on each line. Anchoring the invariant action last
                * fixes it without guessing at a fixed column width, since
                * the variable-width "Find this <label>" button now grows
                * leftwards instead.
                */}
              <span className={styles.rowActions}>
                {JOURNEY_CLICKABLE_FIELDS.has(id.field) ? (
                  <Button variant="ghost" onClick={() => onOpenJourney(id.field as JourneyField, id.value)}>
                    Find this {id.label}
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => void copyToClipboard(id.value)}>
                  Copy
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </InspectorSection>
  );
}
