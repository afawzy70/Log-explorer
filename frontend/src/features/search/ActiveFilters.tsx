import { ALL_ADVANCED_FILTER_FIELDS } from './advancedFilterFields';
import type { AdvancedFilterValues } from './advancedFilterFields';
import { DEFAULT_SEVERITY_LEVELS, SEVERITY_LEVELS } from './severityLevels';
import styles from './ActiveFilters.module.css';

export interface ActiveFiltersProps {
  timeRangeLabel: string;
  onRemoveTimeRange: () => void;
  selectedLevels: string[];
  onRemoveSeverity: () => void;
  selectedServices: string[];
  onRemoveService: (service: string) => void;
  advancedValues: AdvancedFilterValues;
  onRemoveAdvancedField: (key: keyof AdvancedFilterValues) => void;
  onClearAll: () => void;
}

function sameLevelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const setB = new Set(b);
  return a.every((level) => setB.has(level));
}

/** "Info, Warn, Error" - severity order, never selection order (matches `SeverityFilter`'s own display convention). */
function severityChipLabel(selectedLevels: string[]): string {
  const selected = new Set(selectedLevels);
  return SEVERITY_LEVELS.filter((l) => selected.has(l.id))
    .map((l) => l.label)
    .join(', ');
}

/**
 * Mirrors every committed investigation criterion as an individually
 * removable chip, plus one "Clear all" (UX-R1 §3/§4 - restores OLD's
 * `old-01.jpg` interaction: "✕ + Clear all"). Each chip's remove action
 * updates the exact same committed state `Toolbar` already owns via
 * `useSearchState` - never a separate/parallel copy - so there is no way
 * for the chip shown here to drift from what the next Search request will
 * actually submit (UX-R1 §9/§10's "no ghost filter" invariant). Sensitive
 * fields still only ever render "Protected", with no raw value anywhere in
 * the DOM/accessibility tree, remove button included (CLAUDE.md §2 rule 1).
 */
export function ActiveFilters({
  timeRangeLabel,
  onRemoveTimeRange,
  selectedLevels,
  onRemoveSeverity,
  selectedServices,
  onRemoveService,
  advancedValues,
  onRemoveAdvancedField,
  onClearAll,
}: ActiveFiltersProps) {
  const activeFields = ALL_ADVANCED_FILTER_FIELDS.filter(
    (f) => f.key !== 'text' && advancedValues[f.key].trim() !== '',
  );
  const severityIsDefault = sameLevelSet(selectedLevels, DEFAULT_SEVERITY_LEVELS);

  return (
    <div className={styles.row} aria-label="Active filters">
      <span className={styles.chip}>
        <span className={styles.chipLabel}>Time range:</span> {timeRangeLabel}
        <button
          type="button"
          className={styles.chipRemove}
          aria-label={`Remove time range filter, reset to default (${timeRangeLabel})`}
          onClick={onRemoveTimeRange}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </span>

      {!severityIsDefault ? (
        <span className={styles.chip}>
          <span className={styles.chipLabel}>Severity:</span> {severityChipLabel(selectedLevels)}
          <button
            type="button"
            className={styles.chipRemove}
            aria-label={`Remove severity filter ${severityChipLabel(selectedLevels)}`}
            onClick={onRemoveSeverity}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </span>
      ) : null}

      {selectedServices.map((service) => (
        <span key={service} className={styles.chip}>
          <span className={styles.chipLabel}>Service:</span> {service}
          <button
            type="button"
            className={styles.chipRemove}
            aria-label={`Remove service filter ${service}`}
            onClick={() => onRemoveService(service)}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </span>
      ))}

      {activeFields.map((field) => (
        <span key={field.key} className={styles.chip}>
          <span className={styles.chipLabel}>{field.label}:</span>{' '}
          {field.sensitive ? <span className={styles.protected}>Protected</span> : advancedValues[field.key]}
          <button
            type="button"
            className={styles.chipRemove}
            aria-label={
              field.sensitive
                ? `Remove ${field.label} filter (protected value)`
                : `Remove ${field.label} filter ${advancedValues[field.key]}`
            }
            onClick={() => onRemoveAdvancedField(field.key)}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </span>
      ))}

      <button type="button" className={styles.clearAll} onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}
