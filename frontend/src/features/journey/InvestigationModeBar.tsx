import type { ReactNode } from 'react';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { copyToClipboard } from '../../shared/browser/clipboard';
import styles from './InvestigationModeBar.module.css';

export interface InvestigationModeBarProps {
  backLabel: string;
  onBack: () => void;
  title: string;
  /** The identifier value shown beside the title (e.g. a trace ID) - `null` for a view with no single ID (Surroundings). */
  idValue?: string | null;
  /** Renders "Copy {copyLabel} ID" in the right-hand slot - only when there's a real ID to copy. */
  copyLabel?: string;
  children?: ReactNode;
}

/**
 * B5 Investigation - the "mode bar" (`COMPONENT_INVENTORY.md`'s `JourneyView.tsx` REPLACE_VISUALLY entry: "mode
 * bar, stat row, timeline plot ... and a sequence table"), shared between the capture view (Trace/Span/
 * Correlation/Journey/Event) and the Surroundings context view. Back always carries the same `results.back` ("B")
 * shortcut already registered globally in `useProductivityShortcuts.ts` - this component only renders the visible
 * `<kbd>B</kbd>` hint next to it, it does not register a second binding.
 */
export function InvestigationModeBar({ backLabel, onBack, title, idValue, copyLabel, children }: InvestigationModeBarProps) {
  return (
    <div className={styles.bar}>
      <Button variant="secondary" onClick={onBack}>
        <Icon name="arrow-left" size="sm" />
        {backLabel}
        <kbd className={styles.kbd}>B</kbd>
      </Button>
      <h1 className={styles.title}>
        {/* The colon is real text, not decoration - "Trace: t-1" is the tested, established heading shape (predates B5); the design's own markup omits it (relying on layout spacing alone), but dropping it here would silently change the page's accessible name. */}
        {idValue != null ? `${title}: ` : title}
        {idValue != null ? <span className={styles.value}>{idValue}</span> : null}
      </h1>
      <div className={styles.right}>
        {idValue != null && copyLabel ? (
          <Button variant="ghost" onClick={() => void copyToClipboard(idValue)}>
            <Icon name="copy" size="sm" />
            Copy {copyLabel} ID
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
