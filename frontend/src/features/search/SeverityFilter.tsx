import { useId, useRef } from 'react';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { Icon } from '../../shared/ui/Icon';
import { SeverityMark } from '../../shared/ui/SeverityMark';
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
 * B2 (Session 4) - RECOMPOSE per COMPONENT_INVENTORY.md: "Inline chips move into a Severity field whose
 * popover holds All, Errors only and the five level chips; the field shows the active set with severity
 * marks + words." Matches the design's own trigger markup (`prototype/scripts/app.js`'s `queryBar()`:
 * `<button class="field qb-severity" aria-haspopup="dialog" aria-label="Severity: Info, Warn, Error">`)
 * closely, using the same field-trigger + popover mechanism already established by
 * `TableSettingsControl.tsx` (`usePopoverTrigger` + `useDismissableLayer`) rather than inventing a new one.
 *
 * The popover's own content is unchanged from before this recompose - same All/Errors only quick actions,
 * same five level chips, same toggle behaviour - only the CONTAINER moved from "always inline" to "behind a
 * field trigger." `summaryLabel` is genuinely computed from the current selection (never a static string),
 * so the trigger's own visible/aria-label text can never drift from what the popover actually shows.
 */
function summaryLabel(selected: string[]): string {
  if (sameSet(selected, ALL_SEVERITY_LEVEL_IDS)) {
    return 'All';
  }
  if (sameSet(selected, ERRORS_ONLY_LEVELS)) {
    return 'Errors only';
  }
  if (selected.length === 0) {
    return 'None';
  }
  return SEVERITY_LEVELS.filter((l) => selected.includes(l.id))
    .map((l) => l.label)
    .join(', ');
}

export function SeverityFilter({ selected, onChange }: SeverityFilterProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const headingId = useId();
  useDismissableLayer(wrapperRef, popover.isOpen, popover.close);

  function toggleLevel(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((l) => l !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  const label = summaryLabel(selected);
  const activeLevels = SEVERITY_LEVELS.filter((l) => selected.includes(l.id));

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={popover.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={popover.isOpen}
        aria-label={`Severity: ${label}`}
        onClick={() => (popover.isOpen ? popover.close() : popover.open())}
      >
        {/* The marks are decorative (each already aria-hidden via SeverityMark's own default) - the
            trigger's own aria-label above and the visible text span both state the same set in words,
            never colour/shape alone. */}
        <span className={styles.marks} aria-hidden="true">
          {activeLevels.map((l) => (
            <SeverityMark key={l.id} severity={l.id} />
          ))}
        </span>
        <span className={styles.summaryText}>{label}</span>
        <Icon name="chevron-down" size="sm" />
      </button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId} className={styles.heading}>
            Severity
          </h2>
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
                  style={{
                    color: isActive ? level.colorVar : undefined,
                    background: isActive ? level.bgVar : undefined,
                  }}
                  onClick={() => toggleLevel(level.id)}
                >
                  <span className={styles.dot} style={{ background: level.colorVar }} aria-hidden="true" />
                  {level.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
