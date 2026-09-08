import type { LogEvent } from '../../shared/api/types';
import { FieldList } from '../../shared/ui/FieldList';
import { buildActorClientFields } from './sections';
import { EmptySectionNote, InspectorSection } from './InspectorSection';
import styles from './ActorClientSection.module.css';

/**
 * "Actor & client" (HANDOVER.md §16.3) - "labelled protected/masked, no
 * reveal action" (CLAUDE.md §2 rule 5). Every value here is already
 * server-masked (`event.protectedFields`, `LogEvent`'s only sensitive
 * carrier) - there is no raw value anywhere in this component to reveal.
 */
export function ActorClientSection({ event }: { event: LogEvent }) {
  const fields = buildActorClientFields(event);
  return (
    <InspectorSection title="Actor & client">
      {fields.length > 0 ? (
        <>
          <p className={styles.badge}>Protected / masked - never revealed</p>
          <FieldList items={fields} />
        </>
      ) : (
        <EmptySectionNote>No actor or client data on this event.</EmptySectionNote>
      )}
    </InspectorSection>
  );
}
