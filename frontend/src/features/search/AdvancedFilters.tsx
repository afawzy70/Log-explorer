import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import { ADVANCED_FILTER_GROUPS, countActiveAdvancedFilters, emptyAdvancedFilterValues } from './advancedFilterFields';
import type { AdvancedFilterValues } from './advancedFilterFields';
import styles from './AdvancedFilters.module.css';

export interface AdvancedFiltersProps {
  values: AdvancedFilterValues;
  onApply: (next: AdvancedFilterValues) => void;
}

/**
 * "More filters" (IMPLEMENTATION_PLAN.md "Phase F" scope item 2), grouped
 * by user question (scope item 6). UI Gap Closure Pass: upgraded from a
 * compact anchored popover to a genuine right-side drawer (`docs/
 * verification/UI_GAP_CLOSURE_REPORT.md`) - full viewport height, so the
 * four field groups no longer need the popover's own internal
 * `overflow-y: auto` scroll to reach Apply/Cancel/Reset on a typical
 * screen. `position: fixed`, not part of the toolbar's own layout flow, so
 * it can never inherit the exact left-edge-reachability bug a popover here
 * once had (see `AdvancedFilters.module.css`'s own comment on `.actions`).
 * Deliberately no dimming backdrop - results stay visible beside it,
 * exactly as before, just now via a real docked panel rather than a
 * floating one. Draft/apply/cancel is unchanged: edits only ever exist in
 * this component's own local draft state until Apply - opening, typing,
 * and even closing via Cancel/Escape/outside click never fires a search
 * (`onApply` is the only path that reaches the parent, and applying still
 * only updates filter state - the toolbar's own Search button is what
 * actually runs a query).
 */
export function AdvancedFilters({ values, onApply }: AdvancedFiltersProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const popover = usePopoverTrigger();
  const [draft, setDraft] = useState<AdvancedFilterValues>(values);
  const headingId = useId();

  useDismissableLayer(wrapperRef, popover.isOpen, closeWithoutApplying);

  // Focus moves into the drawer's own heading when it opens (a real,
  // now-prominent full-height panel, unlike the compact popover this
  // replaces) - `usePopoverTrigger#close` already returns focus to the
  // trigger on the way out, so this completes the round trip.
  useEffect(() => {
    if (popover.isOpen) {
      headingRef.current?.focus();
    }
  }, [popover.isOpen]);

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

  /**
   * "Reset" (UI Parity Acceleration Pass §4 - the More Filters workflow's
   * mandatory Apply/Cancel/Reset trio, alongside the pre-existing
   * Apply/Cancel): clears every field in the *draft* only - exactly like
   * typing over each field by hand - never applies on its own. The
   * committed filters (and any already-running search) stay untouched
   * until the investigator explicitly clicks Apply afterward, same as any
   * other draft edit.
   */
  function handleReset() {
    setDraft(emptyAdvancedFilterValues());
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
          <h2 id={headingId} className={styles.heading} ref={headingRef} tabIndex={-1}>
            More filters
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
            <Button variant="ghost" onClick={handleReset}>
              Reset
            </Button>
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
