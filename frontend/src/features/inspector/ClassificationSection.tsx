import type { ExtractedFieldValue, LogEvent } from '../../shared/api/types';
import { TagChip, tagColorsOf } from '../../shared/ui/TagChip';
import { FieldList } from '../../shared/ui/FieldList';
import type { FieldItem } from '../../shared/ui/FieldList';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { EMPTY_VALUE } from '../../shared/ui/table/emptyValue';
import { EmptySectionNote, InspectorSection } from './InspectorSection';
import styles from './ClassificationSection.module.css';

/**
 * One extracted value as a `FieldItem`. Never fabricated: only a `PRESENT`
 * value with real text is shown; everything else renders `—` with a
 * secondary line saying why. The value arrives already masked/redacted
 * from the server and renders as text.
 */
export function extractedFieldItem(extracted: ExtractedFieldValue): FieldItem {
  const notes: string[] = [];
  if (extracted.status === 'ABSENT') {
    notes.push('Not found in this event');
  } else if (extracted.status === 'INVALID') {
    notes.push('Could not be read');
  }
  if (extracted.redacted) {
    notes.push('Redacted');
  }
  if (extracted.truncated) {
    notes.push('Truncated');
  }
  const hasValue = extracted.status === 'PRESENT' && extracted.value != null && extracted.value !== '';
  return {
    label: extracted.label || extracted.name,
    value: hasValue ? (extracted.value as string) : EMPTY_VALUE,
    secondary: notes.length > 0 ? notes.join(' · ') : undefined,
  };
}

/**
 * Event Classification & Extraction Rules - a generic, rule-agnostic view
 * of what the server's saved rules concluded about this event: every tag,
 * then one sub-section per matching rule listing its extracted fields in
 * definition order. Rendered inside the Overview tab only when at least
 * one rule matched (it never adds a tab).
 */
export function ClassificationSection({ event }: { event: LogEvent }) {
  const classifications = event.classifications ?? [];
  if (classifications.length === 0) {
    return null;
  }
  const tags = (event.tags ?? []).length > 0
    ? event.tags
    : Array.from(new Set(classifications.flatMap((c) => c.tags)));
  // The same identity the results table draws, from the same source: the rule that applied the tag.
  const colors = tagColorsOf(classifications);

  return (
    <InspectorSection title="Classification">
      {tags.length > 0 ? (
        <ul className={styles.tagList} aria-label="Tags">
          {tags.map((tag) => (
            <li key={tag}>
              <VisuallyHidden>Tag </VisuallyHidden>
              <TagChip tag={tag.toUpperCase()} color={colors[tag]} title={tag} />
            </li>
          ))}
        </ul>
      ) : null}
      {classifications.map((classification, index) => (
        <div key={`${classification.ruleId}-${index}`} className={styles.rule}>
          {/* The chips sit beside the heading, never inside it: the heading names the rule, nothing else. */}
          <div className={styles.ruleHeader}>
            <h3 className={styles.ruleName}>{classification.ruleName}</h3>
            <span className={styles.ruleTags}>
              {classification.tags.map((tag) => (
                <TagChip key={tag} tag={tag} color={classification.displayColor} />
              ))}
            </span>
          </div>
          {classification.extracted.length > 0 ? (
            <FieldList items={classification.extracted.map(extractedFieldItem)} />
          ) : (
            <EmptySectionNote>This rule extracts no fields.</EmptySectionNote>
          )}
        </div>
      ))}
    </InspectorSection>
  );
}
