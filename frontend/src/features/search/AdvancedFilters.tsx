import { useId, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import { ADVANCED_FILTER_GROUPS, countActiveAdvancedFilters } from './advancedFilterFields';
import type { AdvancedFilterValues } from './advancedFilterFields';
import styles from './AdvancedFilters.module.css';

export interface AdvancedFiltersProps {
  values: AdvancedFilterValues;
  onApply: (next: AdvancedFilterValues) => void;
}

/**
 * "More filters + active count" (IMPLEMENTATION_PLAN.md "Phase F" scope
 * item 2), grouped by user question (scope item 6). Draft/apply/cancel:
 * edits only ever exist in this component's own local draft state until
 * Apply - opening, typing, and even closing via Cancel/Escape/outside
 * click never fires a search (`onApply` is the only path that reaches the
 * parent, and applying still only updates filter state - the toolbar's
 * own Search button is what actually runs a query).
 */
export function AdvancedFilters({ values, onApply }: AdvancedFiltersProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const [draft, setDraft] = useState<AdvancedFilterValues>(values);
  const headingId = useId();

  useDismissableLayer(wrapperRef, popover.isOpen, closeWithoutApplying);

  const activeCount = countActiveAdvancedFilters(values);

  function openPanel() {
    setDraft(values);
    popover.open();
  }

  function closeWithoutApplying() {
    popover.close();
  }

  function handleApply() {
    onApply(draft);
    popover.close();
  }

  function setField(key: keyof AdvancedFilterValues, fieldValue: string) {
    setDraft((prev) => ({ ...prev, [key]: fieldValue }));
  }

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={popover.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={popover.isOpen}
        onClick={() => (popover.isOpen ? closeWithoutApplying() : openPanel())}
      >
        <span>More filters</span>
        {activeCount > 0 ? (
          <span className={styles.badge}>
            <VisuallyHidden>, </VisuallyHidden>
            {activeCount}
            <VisuallyHidden> active</VisuallyHidden>
          </span>
        ) : null}
      </button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId}>
            <VisuallyHidden>More filters</VisuallyHidden>
          </h2>
          <div className={styles.groups}>
            {ADVANCED_FILTER_GROUPS.map((group) => (
              <fieldset key={group.id} className={styles.group}>
                <legend className={styles.groupTitle}>{group.title}</legend>
                {group.fields.map((field) => {
                  const fieldId = `${headingId}-${field.key}`;
                  return (
                    <div key={field.key} className={styles.field}>
                      <label htmlFor={fieldId}>{field.label}</label>
                      <input
                        id={fieldId}
                        type="text"
                        value={draft[field.key]}
                        onChange={(event) => setField(field.key, event.target.value)}
                        autoComplete="off"
                      />
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </div>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={closeWithoutApplying}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
