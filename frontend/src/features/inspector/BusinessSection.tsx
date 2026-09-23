import type { LogEvent } from '../../shared/api/types';
import { FieldList } from '../../shared/ui/FieldList';
import { buildBusinessFields } from './sections';
import { EmptySectionNote, InspectorSection } from './InspectorSection';

/**
 * "Business" (HANDOVER.md §16.5, split from the former combined "Business / error" tab -
 * LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY, owner decision superseding that earlier combined-tab
 * behavior). Business-domain fields only - error/exception information belongs in the separate,
 * conditional Error tab (`ErrorSection.tsx`) and must never mix into this one.
 */
export function BusinessSection({ event }: { event: LogEvent }) {
  const fields = buildBusinessFields(event);
  if (fields.length === 0) {
    return (
      <InspectorSection title="Business">
        <EmptySectionNote>No business step or UI identifier on this event.</EmptySectionNote>
      </InspectorSection>
    );
  }
  return (
    <InspectorSection title="Business">
      <FieldList items={fields} />
    </InspectorSection>
  );
}
