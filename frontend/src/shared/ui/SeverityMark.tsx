import styles from './SeverityMark.module.css';

const SEVERITY_MARK_CLASS: Record<string, string> = {
  ERROR: 'sevMarkError',
  WARN: 'sevMarkWarn',
  INFO: 'sevMarkInfo',
  DEBUG: 'sevMarkDebug',
  TRACE: 'sevMarkTrace',
};

export interface SeverityMarkProps {
  severity: string | null;
  /** Rare: makes the mark itself the accessible name (e.g. a legend entry). Decorative (`aria-hidden`) by default - matches `Icon.tsx`'s own convention. */
  label?: string;
}

/**
 * B2/B3 - the shape-differentiated severity mark (a diamond, triangle, filled dot, ring, or flat bar) shared
 * between the Results table's Time-cell gutter (`columnRegistry.tsx`) and the new Severity field's trigger
 * summary (`SeverityFilter.tsx`). Deliberately NOT the same component `columnRegistry.tsx` already uses
 * internally - that one is absolutely positioned for its own 22px gutter (`ResultsTable.module.css`'s
 * `.sevMark`), a layout assumption this component must NOT carry (it needs to flow inline in a button). The
 * shape/colour rules themselves are intentionally mirrored, not refactored to share literally, so this
 * extraction touches zero already-verified B3 code.
 */
export function SeverityMark({ severity, label }: SeverityMarkProps) {
  const shapeClass = SEVERITY_MARK_CLASS[severity?.toUpperCase() ?? ''];
  if (!shapeClass) {
    return null;
  }
  return (
    <span
      className={`${styles.sevMark} ${styles[shapeClass]}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}
