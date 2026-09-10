import { useRef } from 'react';
import { listCopyableIdentifiers } from './columnMapping';
import type { LogEvent } from '../../shared/api/types';
import { copyToClipboard } from '../../shared/browser/clipboard';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import styles from './ActionsCell.module.css';

/**
 * The seventh column, in the same `<tr>` as every other cell for this
 * event (IMPLEMENTATION_PLAN.md "Phase G" scope item 5: "no second action
 * row"). Copies whichever non-sensitive identifiers this event actually
 * has (HANDOVER.md §5: "Non-sensitive trace/correlation/journey/event IDs
 * may be copied") - never a raw sensitive value, and never fabricated
 * when an event has none. "View details" is always present regardless of
 * identifiers, so this trigger is never disabled the way it was in Phase G.
 *
 * <p><b>UX-R4 §17/§18/§19.</b> The menu now leads with the two
 * investigation actions the owner requires every row to expose, in
 * workflow order, separated from the copy utilities so the primary
 * actions are not lost among five near-identical "Copy …" entries:
 *
 * <ul>
 *   <li><b>View details</b> - renamed from "Inspect event". It calls the
 *   exact same `onInspect` the row click calls (§18: "single semantic
 *   action, multiple entry paths"), never a second details
 *   implementation.</li>
 *   <li><b>Show surrounding logs</b> - the existing bounded ±30s context
 *   mechanism, previously reachable *only* from the inspector's Request
 *   Flow section, i.e. only after already opening an event. Surfacing it
 *   on the row removes a whole detour from the investigation loop. It is
 *   rendered only when a caller actually wired `onShowContext` **and**
 *   the event has a timestamp to centre a window on - an event with no
 *   parsed timestamp (a malformed line) has no ±30s window to show, and
 *   a disabled-looking dead entry would be worse than its absence.</li>
 * </ul>
 *
 * <p>The action deliberately means "show me the nearby chronological
 * evidence around this event", never "explain the cause" - the context
 * view's own summary says so in as many words (§19, `ContextSummary`).
 */
export function ActionsCell({
  event,
  onInspect,
  onShowContext,
}: {
  event: LogEvent;
  onInspect: () => void;
  onShowContext?: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const identifiers = listCopyableIdentifiers(event);

  useDismissableLayer(wrapperRef, popover.isOpen, popover.close);

  async function copy(value: string) {
    try {
      await copyToClipboard(value);
    } catch {
      // Clipboard access can legitimately be denied (permissions,
      // non-secure context) - nothing sensitive here, so failing silently
      // (no raw value logged) is acceptable; the menu simply closes.
    }
    popover.close();
  }

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={popover.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={popover.isOpen}
        aria-label="Actions for this event"
        onClick={() => (popover.isOpen ? popover.close() : popover.open())}
      >
        …
      </button>
      {popover.isOpen ? (
        <div className={styles.menu} role="menu" aria-label="Event actions">
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              popover.close();
              onInspect();
            }}
          >
            View details
          </button>
          {onShowContext && event.timestamp ? (
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                popover.close();
                onShowContext();
              }}
            >
              Show surrounding logs
            </button>
          ) : null}
          {identifiers.length > 0 ? <div className={styles.separator} role="separator" /> : null}
          {identifiers.map((id) => (
            <button
              key={id.label}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => void copy(id.value)}
            >
              Copy {id.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
