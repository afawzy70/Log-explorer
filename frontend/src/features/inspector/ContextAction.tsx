import { useRef } from 'react';
import type { LogEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { usePopoverTrigger } from '../../shared/ui/usePopoverTrigger';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import { formatUtcTimestamp } from './timestampFormat';
import styles from './ContextAction.module.css';

const WINDOW_MS = 30_000;

/**
 * "Show ±30 seconds ... Display bounded query/time range before
 * execution" (HANDOVER.md §16.7) - a confirm step, not an instant
 * action: the exact same ±30s window the backend will enforce is
 * computed here first and shown, then the caller only runs it once the
 * investigator explicitly confirms.
 *
 * <p><b>UX-R5 §15 - labelled "Show surrounding logs", not "Show ±30
 * seconds".</b> UX-R4 put that exact wording on the row Actions menu, and
 * one product must not name the same single action two different ways
 * depending on where you invoke it. The ±30s window has not been hidden -
 * it is stated exactly, with both bounds, in the confirm popover below,
 * which is where a bounded query belongs. The label says what the action
 * is *for*; the popover says what it will *do*.
 */
export function ContextAction({ event, onConfirm }: { event: LogEvent; onConfirm: () => void }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  useDismissableLayer(wrapperRef, popover.isOpen, popover.close);

  if (!event.timestamp) {
    return null;
  }
  const timestampMs = new Date(event.timestamp).getTime();
  const previewStart = new Date(timestampMs - WINDOW_MS).toISOString();
  const previewEnd = new Date(timestampMs + WINDOW_MS).toISOString();
  const scopeParts = [event.service ? `service ${event.service}` : null].filter((p): p is string => p != null);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <Button
        ref={popover.triggerRef}
        variant="secondary"
        aria-haspopup="true"
        aria-expanded={popover.isOpen}
        onClick={() => (popover.isOpen ? popover.close() : popover.open())}
      >
        Show surrounding logs
      </Button>
      {popover.isOpen ? (
        <div className={styles.preview} role="dialog" aria-label="Confirm surrounding-context search">
          <p className={styles.previewText}>
            {scopeParts.length > 0 ? `Scoped to ${scopeParts.join(', ')}. ` : ''}
            {formatUtcTimestamp(previewStart)} – {formatUtcTimestamp(previewEnd)}
          </p>
          <p className={styles.previewHint}>
            Nearby chronological evidence around this event - not a cause. Replaces the current results with this
            bounded window; you can return to the original search afterward.
          </p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => {
                popover.close();
                onConfirm();
              }}
            >
              Run
            </Button>
            <Button variant="ghost" onClick={popover.close}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
