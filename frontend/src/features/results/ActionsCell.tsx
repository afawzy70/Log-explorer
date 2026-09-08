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
 * when an event has none. "Inspect event" (IMPLEMENTATION_PLAN.md "Phase
 * H") is always present regardless of identifiers, so this trigger is
 * never disabled the way it was in Phase G.
 */
export function ActionsCell({ event, onInspect }: { event: LogEvent; onInspect: () => void }) {
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
            Inspect event
          </button>
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
