import type { LogEvent } from '../../shared/api/types';
import { FieldList } from '../../shared/ui/FieldList';
import { buildBusinessErrorFields } from './sections';
import { EmptySectionNote, InspectorSection } from './InspectorSection';
import styles from './BusinessErrorSection.module.css';

/**
 * "Business/error" (HANDOVER.md §16.5). The exception is rendered inside
 * a `<pre>` as a single text node (`{event.exception}`, never
 * `dangerouslySetInnerHTML` - CLAUDE.md §2 rule 3) so a multiline/escaped
 * stack trace still reads as one legible block (CLAUDE.md §4: "Multiline/
 * escaped-newline exceptions stay one logical event").
 */
export function BusinessErrorSection({ event }: { event: LogEvent }) {
  const fields = buildBusinessErrorFields(event);
  const hasException = Boolean(event.exception);
  if (fields.length === 0 && !hasException) {
    return (
      <InspectorSection title="Business / error">
        <EmptySectionNote>No business step, UI identifier, error code, or exception on this event.</EmptySectionNote>
      </InspectorSection>
    );
  }
  return (
    <InspectorSection title="Business / error">
      <FieldList items={fields} />
      {hasException ? (
        <pre className={styles.exception}>{event.exception}</pre>
      ) : null}
    </InspectorSection>
  );
}
