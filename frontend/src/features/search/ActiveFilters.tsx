import { ALL_ADVANCED_FILTER_FIELDS } from './advancedFilterFields';
import type { AdvancedFilterValues } from './advancedFilterFields';
import styles from './ActiveFilters.module.css';

export interface ActiveFiltersProps {
  timeRangeLabel: string;
  advancedValues: AdvancedFilterValues;
}

/**
 * Mirrors the committed time range and every applied advanced filter as
 * chips (IMPLEMENTATION_PLAN.md "Phase F" scope item 7: "mirror it in
 * active filters"). Sensitive fields show "Protected", never the raw
 * value (CLAUDE.md §2 rule 1 / §4 "applied chips show protected").
 */
export function ActiveFilters({ timeRangeLabel, advancedValues }: ActiveFiltersProps) {
  const activeFields = ALL_ADVANCED_FILTER_FIELDS.filter(
    (f) => f.key !== 'text' && advancedValues[f.key].trim() !== '',
  );

  return (
    <div className={styles.row} aria-label="Active filters">
      <span className={styles.chip}>
        <span className={styles.chipLabel}>Time range:</span> {timeRangeLabel}
      </span>
      {activeFields.map((field) => (
        <span key={field.key} className={styles.chip}>
          <span className={styles.chipLabel}>{field.label}:</span>{' '}
          {field.sensitive ? <span className={styles.protected}>Protected</span> : advancedValues[field.key]}
        </span>
      ))}
    </div>
  );
}
