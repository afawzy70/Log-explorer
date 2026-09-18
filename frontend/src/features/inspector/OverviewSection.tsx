import type { LogEvent, SourceInfo } from '../../shared/api/types';
import { FieldList } from '../../shared/ui/FieldList';
import { buildOverviewFields } from './sections';
import { ClassificationSection } from './ClassificationSection';
import styles from './OverviewSection.module.css';

/**
 * DRIFT-008 remediation - restores the approved hierarchy: the message is the prominent, boxed lead
 * element (no redundant "Message" label - it is visibly the message, the same way a title is visibly a
 * title), and the remaining structurally-always-present fields (Time/Source/Service/...) are grouped
 * under a "When & where" sub-heading. The tab strip's own `aria-labelledby` already names this panel
 * "Overview" for assistive tech (InspectorTabs.tsx's `role="tabpanel"`) - the previous generic "OVERVIEW"
 * heading duplicated that name visibly on every single event, which is the redundant hierarchy the audit
 * (DRIFT-008) found. `buildOverviewFields` itself is untouched (same data, same tests) - only how this
 * component presents that data changed.
 */
export function OverviewSection({ event, sources }: { event: LogEvent; sources: SourceInfo[] }) {
  const fields = buildOverviewFields(event, sources);
  const messageField = fields.find((f) => f.label === 'Message');
  const whenWhereFields = fields.filter((f) => f.label !== 'Message');

  return (
    <>
      <section className={styles.section} aria-label="Overview">
        {messageField ? <p className={styles.message}>{messageField.value}</p> : null}
        <h2 className={styles.subheading}>When &amp; where</h2>
        <FieldList items={whenWhereFields} />
      </section>
      <ClassificationSection event={event} />
    </>
  );
}
