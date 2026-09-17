import type { ReactNode } from 'react';
import styles from './InvestigationStatRow.module.css';

export interface StatEntry {
  key: string;
  label: string;
  value: ReactNode;
  variant?: 'danger' | 'warn';
  mono?: boolean;
}

export interface InvestigationStatRowProps {
  stats: StatEntry[];
  /**
   * Sets `role="note"` + this label on the row itself - omit when the caller already provides its own
   * `role="note"`/`aria-label` landmark around this row (e.g. `ContextSummary.tsx`'s own wrapper), so the two
   * never nest as duplicate same-named landmarks (which would make `getByLabelText` ambiguous).
   */
  ariaLabel?: string;
  children?: ReactNode;
}

/**
 * B5 Investigation - the shared stat-row primitive (`COMPONENT_INVENTORY.md`'s own required "stat row: Events,
 * Services, Errors, Warnings, First -> last, Observed span, Gaps, Selected event i/N"), used by both the capture
 * view (`JourneyView.tsx`) and the Surroundings context view (`ContextSummary.tsx`) - the design's own
 * `cap-summary` grammar is identical between `capture()` and `contextView()`, differing only in which stats are
 * present and each view's own claim/disclaimer copy that follows it.
 *
 * <p>Deliberately renders ONLY the stat list itself, not the claim/disclaimer/notices that follow - those differ
 * meaningfully in exact wording between the two callers (and `ContextSummary.tsx` already has its own, separately
 * tested, root-not-found/incomplete-results notices and gap list) - `children` is passed a caller-supplied claim/
 * note block instead of hardcoding one, so this stays a pure "given these stats, render this row" primitive.
 * Each label/value pair is adjacent DOM siblings (`<span>Label</span><span>Value</span>`), matching the existing
 * `getByText('Label').nextElementSibling` query pattern `ContextSummary.test.tsx` already relies on.
 */
export function InvestigationStatRow({ stats, ariaLabel, children }: InvestigationStatRowProps) {
  return (
    <div className={styles.wrapper} role={ariaLabel ? 'note' : undefined} aria-label={ariaLabel}>
      {stats.map((stat) => (
        <span key={stat.key} className={styles.stat}>
          <span className={styles.label}>{stat.label}</span>
          <span
            className={[
              styles.value,
              stat.variant === 'danger' ? styles.danger : '',
              stat.variant === 'warn' ? styles.warn : '',
              stat.mono ? styles.mono : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {stat.value}
          </span>
        </span>
      ))}
      {children}
    </div>
  );
}
