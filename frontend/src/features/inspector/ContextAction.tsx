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
        Show ±30 seconds
      </Button>
      {popover.isOpen ? (
        <div className={styles.preview} role="dialog" aria-label="Confirm surrounding-context search">
          <p className={styles.previewText}>
            {scopeParts.length > 0 ? `Scoped to ${scopeParts.join(', ')}. ` : ''}
            {formatUtcTimestamp(previewStart)} – {formatUtcTimestamp(previewEnd)}
          </p>
          <p className={styles.previewHint}>
            Replaces the current results with this bounded window. You can return to the original search afterward.
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
