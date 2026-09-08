import { ALL_SEVERITY_LEVEL_IDS, ERRORS_ONLY_LEVELS, SEVERITY_LEVELS } from './severityLevels';
import styles from './SeverityFilter.module.css';

export interface SeverityFilterProps {
  selected: string[];
  onChange: (next: string[]) => void;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

/**
 * Severity (IMPLEMENTATION_PLAN.md "Phase F" scope item 4): All / Errors
 * only / individual levels; never color alone (CLAUDE.md §7) - every chip
 * always shows the level's text label alongside its color dot, and the
 * active state is also conveyed via `aria-pressed`/a border, not color
 * alone.
 */
export function SeverityFilter({ selected, onChange }: SeverityFilterProps) {
  function toggleLevel(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((l) => l !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <div className={styles.group} role="group" aria-label="Severity">
      <button
        type="button"
        className={styles.quickAction}
        aria-pressed={sameSet(selected, ALL_SEVERITY_LEVEL_IDS)}
        onClick={() => onChange(ALL_SEVERITY_LEVEL_IDS)}
      >
        All
      </button>
      <button
        type="button"
        className={styles.quickAction}
        aria-pressed={sameSet(selected, ERRORS_ONLY_LEVELS)}
        onClick={() => onChange(ERRORS_ONLY_LEVELS)}
      >
        Errors only
      </button>
      {SEVERITY_LEVELS.map((level) => {
        const isActive = selected.includes(level.id);
        return (
          <button
            key={level.id}
            type="button"
            className={styles.chip}
            aria-pressed={isActive}
            style={{ color: isActive ? level.colorVar : undefined, background: isActive ? level.bgVar : undefined }}
            onClick={() => toggleLevel(level.id)}
          >
            <span className={styles.dot} style={{ background: level.colorVar }} aria-hidden="true" />
            {level.label}
          </button>
        );
      })}
    </div>
  );
}
