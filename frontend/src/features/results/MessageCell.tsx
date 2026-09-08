import { useId, useState } from 'react';
import { resolveWhatHappened } from './columnMapping';
import type { LogEvent } from '../../shared/api/types';
import styles from './MessageCell.module.css';

/**
 * A heuristic proxy for "this will actually be truncated by the column's
 * ellipsis at a typical width" - real overflow detection needs a DOM
 * measurement (ResizeObserver/scrollWidth), which doesn't behave
 * meaningfully under jsdom and adds real complexity for a cosmetic
 * decision (showing an unnecessary "More" toggle on short text is
 * harmless; the accessible-expansion requirement itself is still met
 * either way).
 */
const LIKELY_TRUNCATED_THRESHOLD = 80;

export function MessageCell({ event }: { event: LogEvent }) {
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const cell = resolveWhatHappened(event);
  const likelyTruncated = cell.text.length > LIKELY_TRUNCATED_THRESHOLD;

  return (
    <div className={styles.wrapper}>
      <span
        id={textId}
        className={[styles.text, expanded ? styles.expanded : '', cell.malformed ? styles.malformed : '']
          .filter(Boolean)
          .join(' ')}
      >
        {cell.text}
      </span>
      {cell.malformed ? <span className={styles.badge}>malformed</span> : null}
      {likelyTruncated ? (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Less' : 'More'}
        </button>
      ) : null}
    </div>
  );
}
