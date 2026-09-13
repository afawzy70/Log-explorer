import { useId } from 'react';
import type { SearchDirection } from '../../shared/api/types';
import styles from './SortControl.module.css';

/**
 * UX-R4 §9/§12 - the results sort direction.
 *
 * <p><b>SUPERSEDED, pre-closure functional recovery (§17/§18) - Time IS
 * now also a clickable, sortable column header.</b> The paragraph below
 * is preserved as the historical Slice-4 rationale (CLAUDE.md §5: "name
 * the conflict explicitly, apply the later decision" - not silently
 * deleted), but the owner's later, explicit instruction is that per-
 * column sorting must exist, INCLUDING Time, and must stay truthfully
 * compatible with this exact control rather than a second competing
 * state. `ResultsTable`'s own Time header click handler aliases the
 * IDENTICAL `state.sortDirection`/`onChange` this component uses - there
 * is still only ONE sort-direction state in the whole application; the
 * header is simply a second, equally-truthful way to change it, not a
 * different truth. This `<select>` itself is unchanged and remains the
 * primary, most-discoverable control.
 *
 * <p><b>Historical rationale (Slice 4) for why a plain labelled
 * `<select>`, not a sortable Time header, was originally chosen:</b> "A
 * clickable column header implies *column* sorting - that any column
 * could be sorted, and that what is being sorted is the rows currently on
 * screen. Neither is true here: this control commits a
 * whole-result-set, source-side ordering that is re-queried from the
 * source and re-paginated from page 1" (see `useSearchState`'s own
 * `setSortDirection`) - this technical description of what Newest/Oldest
 * actually does remains fully accurate; only the "so Time must never also
 * be a header button" conclusion is superseded. Naming the two orderings
 * in words ("Newest first" / "Oldest first") states exactly what the
 * backend will actually do, and the committed direction is always
 * readable at a glance rather than encoded in an arrow glyph's direction -
 * which is precisely the "sorting must be semantically truthful"
 * requirement, expressed in the affordance itself rather than only in the
 * implementation behind it.
 *
 * <p>It is deliberately not rendered at all in a context ("Show
 * surrounding logs") view: that view is always chronological-ascending by
 * design, independent of this setting, so offering a direction control
 * there would advertise a choice the view does not honor (CLAUDE.md §4
 * "never show ... for a source that cannot support them", applied to a
 * view rather than a source). The committed direction is preserved
 * across the detour and restored on return (§20), it is simply not
 * *editable* while the ascending context view is on screen.
 */
export function SortControl({
  value,
  onChange,
  disabled = false,
}: {
  value: SearchDirection;
  onChange: (next: SearchDirection) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor={id}>
        Sort
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as SearchDirection)}
      >
        <option value="BACKWARD">Newest first</option>
        <option value="FORWARD">Oldest first</option>
      </select>
    </div>
  );
}
