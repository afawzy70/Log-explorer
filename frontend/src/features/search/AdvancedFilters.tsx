import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { VisuallyHidden } from '../../shared/ui/VisuallyHidden';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import { ADVANCED_FILTER_GROUPS, countActiveAdvancedFilters, emptyAdvancedFilterValues } from './advancedFilterFields';
import type { AdvancedFilterValues } from './advancedFilterFields';
import { QueryBuilder } from './QueryBuilder';
import type { QueryAuthoringState } from './QueryBuilder';
import styles from './AdvancedFilters.module.css';

export interface AdvancedFiltersProps {
  values: AdvancedFilterValues;
  onApply: (next: AdvancedFilterValues) => void;
  /**
   * Advanced Query, hosted here (UX-R1 §2 - owner decision): "Restore the
   * OLD interaction hierarchy. Advanced Query should be treated as part of
   * investigation refinement under: More Filters -> Advanced Query rather
   * than a primary peer of Search in the main toolbar." `QueryBuilder`
   * itself is unchanged - still its own self-contained draft/apply/cancel
   * popover, just rendered from here instead of the toolbar
   * (`useDismissableLayer`'s own layer stack, above, is what keeps a single
   * Escape from closing both this drawer and QueryBuilder's own popover at
   * once now that one is nested inside the other).
   */
  queryState: QueryAuthoringState;
  onApplyQuery: (next: QueryAuthoringState) => void;
  rawLogQlSupported: boolean;
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
export function AdvancedFilters({ values, onApply, queryState, onApplyQuery, rawLogQlSupported }: AdvancedFiltersProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const popover = usePopoverTrigger();
  const [draft, setDraft] = useState<AdvancedFilterValues>(values);
  const headingId = useId();
  // UX-R1 regression fix: this drawer is `position: fixed; top: 0`, so
  // without an offset it physically overlaps (and intercepts clicks for)
  // the header/toolbar/active-filters rows' own controls - real end-to-end
  // proof in `phase-legacy-slice2-query-transparency.spec.ts` test 6, once
  // Advanced Query's relocation here (§2) made "leave this drawer open,
  // then click the toolbar's Search button" a real flow for the first
  // time. A z-index fix does not work: this drawer's own `.panel` is a
  // descendant of the toolbar it needs to out-stack, so raising the
  // toolbar's z-index only traps `.panel` inside a new local stacking
  // context and elevates the whole toolbar (drawer included) as one unit
  // instead. Measuring `[data-app-chrome]` (`App.tsx`) and offsetting
  // `top` below it sidesteps stacking entirely - the two simply never
  // occupy the same screen region. `ResizeObserver` is unavailable under
  // jsdom (see `MessageCell.tsx`'s own comment) - guarded, and harmless to
  // skip in tests, which don't assert real pixel layout.
  const [panelTop, setPanelTop] = useState<number | null>(null);

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

  useEffect(() => {
    if (!popover.isOpen) {
      return;
    }
    const chrome = document.querySelector('[data-app-chrome]');
    if (!chrome || typeof ResizeObserver === 'undefined') {
      return;
    }
    const updateTop = () => setPanelTop(chrome.getBoundingClientRect().bottom);
    updateTop();
    const observer = new ResizeObserver(updateTop);
    observer.observe(chrome);
    window.addEventListener('resize', updateTop);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateTop);
    };
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
        data-shortcut="more-filters-trigger"
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
        <div
          className={styles.panel}
          style={panelTop != null ? { top: panelTop } : undefined}
          role="dialog"
          aria-labelledby={headingId}
        >
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
                      {/*
                       * UX-R1 §6 - restores OLD's EXACT MATCH/SUBSTRING hint,
                       * reflecting `EventFilters.java`'s real per-field
                       * semantics, never guessed. Deliberately a *sibling* of
                       * `<label>`, not nested inside it - nesting it would
                       * fold "Exact match"/"Contains" into the field's own
                       * accessible name (`<label for>` text content), silently
                       * renaming every field for screen-reader/`getByLabelText`
                       * purposes.
                       */}
                      <div className={styles.fieldLabelRow}>
                        <label htmlFor={fieldId}>{field.label}</label>
                        <span className={styles.matchHint}>
                          {field.matchType === 'exact' ? 'Exact match' : 'Contains'}
                        </span>
                      </div>
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

            <fieldset className={styles.group}>
              <legend className={styles.groupTitle}>Advanced query</legend>
              <QueryBuilder value={queryState} onApply={onApplyQuery} rawLogQlSupported={rawLogQlSupported} />
            </fieldset>
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
