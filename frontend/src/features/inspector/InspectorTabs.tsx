import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import styles from './InspectorTabs.module.css';

export interface InspectorTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Pre-closure functional recovery (§4): restores the grouped/tabbed
 * Inspector presentation the owner confirmed as a regression versus the
 * old application's workflow - a single long scrolling flow forced an
 * investigator to scroll past every section to reach the one they
 * wanted. Each tab now bounds its own content inside the SAME scrollable
 * `.body` container `EventInspector.module.css` already established
 * (UX-R6 §3's bounded-viewport-height panel is unchanged; only what's
 * inside `.body` at any moment is now one tab's content instead of all
 * five sections stacked).
 *
 * <p>Standard WAI-ARIA "Tabs (Automatic Activation)" pattern:
 * `role="tablist"`/`role="tab"`/`role="tabpanel"`, `aria-selected`,
 * `aria-controls`/`id` pairing, roving `tabIndex` (only the active tab is
 * in the normal tab order), and Left/Right/Home/End arrow-key navigation
 * scoped to the tablist itself (never a document-level listener, so it
 * cannot conflict with the panel's own "["/"]"/Escape shortcuts or the
 * resize handle's ArrowLeft/ArrowRight).
 *
 * <p>Callers only ever pass tabs that already have content - hiding an
 * empty/meaningless tab (mission §4: "Do NOT display empty meaningless
 * tabs") is the caller's job (`EventInspector.tsx` filters by each
 * section's own existing field-builder length), not this component's.
 */
export function InspectorTabs({
  tabs,
  activeTabId,
  onActiveTabChange,
}: {
  tabs: InspectorTab[];
  activeTabId: string;
  onActiveTabChange: (id: string) => void;
}) {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeTabId),
  );

  function focusAndActivate(index: number) {
    const clamped = ((index % tabs.length) + tabs.length) % tabs.length;
    const tab = tabs[clamped];
    onActiveTabChange(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusAndActivate(activeIndex + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusAndActivate(activeIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAndActivate(0);
        break;
      case 'End':
        e.preventDefault();
        focusAndActivate(tabs.length - 1);
        break;
      default:
        break;
    }
  }

  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <>
      <div className={styles.tablist} role="tablist" aria-label="Event detail sections" onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === active.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`inspector-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`inspector-tabpanel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? `${styles.tab} ${styles.tabSelected}` : styles.tab}
              onClick={() => onActiveTabChange(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        className={styles.tabpanel}
        role="tabpanel"
        id={`inspector-tabpanel-${active.id}`}
        aria-labelledby={`inspector-tab-${active.id}`}
        tabIndex={0}
      >
        {active.content}
      </div>
    </>
  );
}
