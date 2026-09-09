import { useEffect, useId, useRef } from 'react';
import { Button } from '../shared/ui/Button';
import { useDismissableLayer } from '../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../shared/ui/usePopoverTrigger';
import { isTypingTarget } from '../shared/keyboard/isTypingTarget';
import styles from './KeyboardShortcutsHelp.module.css';

interface ShortcutEntry {
  keys: string;
  description: string;
}

const SHORTCUTS: ShortcutEntry[] = [
  { keys: 'Ctrl/Cmd + Enter', description: 'Run the current search from anywhere on the page' },
  { keys: '/', description: 'Focus the search box' },
  { keys: '↑ / ↓', description: 'Move between result rows (when a row has focus)' },
  { keys: 'Enter / Space', description: 'Open the focused row’s Actions menu' },
  { keys: '[ / ]', description: 'Previous / next event (when the inspector is open)' },
  { keys: 'Esc', description: 'Close the inspector or an open popover' },
  { keys: '?', description: 'Open this shortcuts help' },
  { keys: 'P', description: 'Pause / resume Live (while Live is the active view)' },
  { keys: 'S', description: 'Stop Live (while Live is the active view)' },
  { keys: 'C', description: 'Clear Live events (while Live is the active view)' },
  { keys: 'F', description: 'Toggle Follow newest (while Live is the active view)' },
];

/**
 * Keyboard-shortcuts help (UI Parity Acceleration Pass §1 "global header"
 * + §10 "keyboard productivity" - SEARCH-19 in the pre-pass capability
 * matrix, `NEW_MISSING`: OLD's own header exposed a shortcuts popover,
 * NEW had none). Self-contained, exactly like `TableSettingsControl`/
 * `DockerSettingsPanel`: owns its own open/close state and registers its
 * own `?` global listener, so nothing elsewhere needs to know it exists.
 *
 * `?` only opens the popover when focus is not already inside a
 * text-entry control (`isTypingTarget`) - typing a literal `?` at the end
 * of a sentence in, say, Advanced Filters' "Message contains" field must
 * never be hijacked.
 */
export function KeyboardShortcutsHelp() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const headingId = useId();

  useDismissableLayer(wrapperRef, popover.isOpen, popover.close);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '?' && !isTypingTarget(event.target)) {
        event.preventDefault();
        popover.open();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={popover.triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={popover.isOpen}
        aria-label="Keyboard shortcuts"
        onClick={() => (popover.isOpen ? popover.close() : popover.open())}
      >
        <span aria-hidden="true">⌨</span>
      </button>

      {popover.isOpen ? (
        <div className={styles.panel} role="dialog" aria-labelledby={headingId}>
          <h2 id={headingId} className={styles.heading}>
            Keyboard shortcuts
          </h2>
          <dl className={styles.list}>
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className={styles.row}>
                <dt className={styles.keys}>{s.keys}</dt>
                <dd className={styles.description}>{s.description}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.actions}>
            <Button variant="primary" onClick={popover.close}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
