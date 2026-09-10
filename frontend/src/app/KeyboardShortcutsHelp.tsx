import { useId, useMemo, useRef } from 'react';
import { Button } from '../shared/ui/Button';
import { useDismissableLayer } from '../shared/ui/useDismissableLayer';
import { usePopoverTrigger } from '../shared/ui/usePopoverTrigger';
import { useShortcut, useRegisteredShortcuts } from '../shared/keyboard/ShortcutRegistry';
import styles from './KeyboardShortcutsHelp.module.css';

interface ShortcutEntry {
  keys: string;
  description: string;
}

/**
 * A small, deliberately static supplement (Legacy Remediation Slice 8) for
 * the two interactions that are genuinely element-scoped `onKeyDown`
 * handlers (`ResultsTable`'s row-to-row ArrowUp/ArrowDown, the Actions
 * menu's own Enter/Space activation) rather than a `document`-level
 * shortcut - structurally outside what the shared registry's single
 * global listener model covers (see `ShortcutRegistry.tsx`'s own doc
 * comment for the full reasoning), so they cannot be derived from it.
 * Everything else below is live, not hardcoded.
 */
const SCOPED_SHORTCUTS: ShortcutEntry[] = [
  { keys: '↑ / ↓', description: 'Move between result rows (when a row has focus)' },
  { keys: 'Enter / Space', description: 'Open the focused row’s Actions menu' },
];

const GROUP_ORDER = ['Search & filters', 'Results & inspector', 'Live', 'Help'];

/**
 * Keyboard-shortcuts help (UI Parity Acceleration Pass §1 "global header"
 * + §10 "keyboard productivity" - SEARCH-19 in the pre-pass capability
 * matrix, `NEW_MISSING`: OLD's own header exposed a shortcuts popover,
 * NEW had none). Self-contained, exactly like `TableSettingsControl`/
 * `DockerSettingsPanel`: owns its own open/close state.
 *
 * <p><b>Legacy Remediation Slice 8</b> - the shortcut list itself is no
 * longer a hardcoded array duplicating what every shortcut-owning hook
 * already knows about itself; it is read live from {@link
 * useRegisteredShortcuts}, grouped and ordered by {@link GROUP_ORDER}, so
 * it can never drift out of sync with the real registered set (this
 * mission's own §5 "not become stale through duplicated manual
 * definitions if avoidable"). `?` itself is now one more registered
 * shortcut (`help.open`), dogfooding the same registry every other
 * binding uses, rather than its own separate `document` listener.
 */
export function KeyboardShortcutsHelp() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popover = usePopoverTrigger();
  const headingId = useId();

  useDismissableLayer(wrapperRef, popover.isOpen, popover.close);

  useShortcut({
    id: 'help.open',
    keys: '?',
    description: 'Open this shortcuts help',
    group: 'Help',
    test: (e) => e.key === '?',
    onTrigger: () => popover.open(),
  });

  const registered = useRegisteredShortcuts();
  const grouped = useMemo(() => {
    const byGroup = new Map<string, ShortcutEntry[]>();
    for (const def of registered) {
      const entries = byGroup.get(def.group) ?? [];
      entries.push({ keys: def.keys, description: def.description });
      byGroup.set(def.group, entries);
    }
    const groups = [...byGroup.keys()].sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a);
      const bi = GROUP_ORDER.indexOf(b);
      return (ai === -1 ? GROUP_ORDER.length : ai) - (bi === -1 ? GROUP_ORDER.length : bi);
    });
    return groups.map((group) => ({
      group,
      entries: group === 'Results & inspector' ? [...SCOPED_SHORTCUTS, ...byGroup.get(group)!] : byGroup.get(group)!,
    }));
  }, [registered]);

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
          {grouped.map(({ group, entries }) => (
            <div key={group} className={styles.group}>
              <p className={styles.groupTitle}>{group}</p>
              <dl className={styles.list}>
                {entries.map((s) => (
                  <div key={s.keys} className={styles.row}>
                    <dt className={styles.keys}>{s.keys}</dt>
                    <dd className={styles.description}>{s.description}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
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
