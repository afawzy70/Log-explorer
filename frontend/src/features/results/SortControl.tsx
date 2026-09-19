import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
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
 * different truth.
 *
 * <p><b>B2 (Session 4) RECOMPOSE - `<select>` becomes a toggle button</b>
 * (`COMPONENT_INVENTORY.md`'s own SortControl.tsx entry), moved into the
 * scope strip. There are only ever two orderings, so a single click
 * always reaches the other one - a dropdown never added a reachable state
 * a toggle can't, it only cost an extra click. The committed direction is
 * still always named in words on the button face itself ("Newest first" /
 * "Oldest first"), never encoded only in an arrow glyph's direction -
 * exactly the same "sorting must be semantically truthful" requirement
 * the original `<select>` satisfied, now expressed as a toggle instead.
 *
 * <p>Historical rationale (Slice 4) for why a plain labelled `<select>`,
 * not a sortable Time header, was originally chosen: "A clickable column
 * header implies *column* sorting - that any column could be sorted, and
 * that what is being sorted is the rows currently on screen. Neither is
 * true here: this control commits a whole-result-set, source-side
 * ordering that is re-queried from the source and re-paginated from page
 * 1" (see `useSearchState`'s own `setSortDirection`) - this technical
 * description of what Newest/Oldest actually does remains fully accurate.
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
  const isNewestFirst = value === 'BACKWARD';
  const label = isNewestFirst ? 'Newest first' : 'Oldest first';
  const nextValue: SearchDirection = isNewestFirst ? 'FORWARD' : 'BACKWARD';
  return (
    <Button
      variant="ghost"
      className={styles.toggle}
      disabled={disabled}
      onClick={() => onChange(nextValue)}
      aria-label={`Sort order: ${label}`}
    >
      <Icon name={isNewestFirst ? 'arrow-down-wide-narrow' : 'arrow-up-narrow-wide'} size="sm" />
      {label}
    </Button>
  );
}
