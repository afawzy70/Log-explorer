import type { LogEvent, SourceInfo } from '../../shared/api/types';
import { FieldList } from '../../shared/ui/FieldList';
import { buildOverviewFields } from './sections';
import { InspectorSection } from './InspectorSection';
import { ClassificationSection } from './ClassificationSection';

/** "What/when/where" (HANDOVER.md §16.2), followed by the generic Classification section when any saved rule matched this event. */
export function OverviewSection({ event, sources }: { event: LogEvent; sources: SourceInfo[] }) {
  return (
    <>
      <InspectorSection title="Overview">
        <FieldList items={buildOverviewFields(event, sources)} />
      </InspectorSection>
      <ClassificationSection event={event} />
    </>
  );
}
