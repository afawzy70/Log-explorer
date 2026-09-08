import type { LogEvent, SourceInfo } from '../../shared/api/types';
import { FieldList } from '../../shared/ui/FieldList';
import { buildOverviewFields } from './sections';
import { InspectorSection } from './InspectorSection';

/** "What/when/where" (HANDOVER.md §16.2). */
export function OverviewSection({ event, sources }: { event: LogEvent; sources: SourceInfo[] }) {
  return (
    <InspectorSection title="Overview">
      <FieldList items={buildOverviewFields(event, sources)} />
    </InspectorSection>
  );
}
