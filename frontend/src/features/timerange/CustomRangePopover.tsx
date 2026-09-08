import { useId, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import {
  localDateTimeInputValue,
  utcIsoFromLocalDateTimeInput,
  validateRange,
} from '../../shared/time/interval';
import styles from './CustomRangePopover.module.css';

export interface CustomRangePopoverProps {
  initialStartIso: string;
  initialEndIso: string;
  onApply: (startIso: string, endIso: string) => void;
  onCancel: () => void;
}

/**
 * The temporary custom-range editor (CLAUDE.md §4: "Custom is a temporary
 * popover ... never a permanently expanded form"). Draft/apply/cancel: the
 * committed range is only mutated by a valid Apply - Cancel, Escape, and
 * outside-click all discard the draft untouched.
 */
export function CustomRangePopover({ initialStartIso, initialEndIso, onApply, onCancel }: CustomRangePopoverProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [startValue, setStartValue] = useState(() => localDateTimeInputValue(initialStartIso));
  const [endValue, setEndValue] = useState(() => localDateTimeInputValue(initialEndIso));
  const [error, setError] = useState<string | null>(null);
  const startId = useId();
  const endId = useId();
  const errorId = useId();

  useDismissableLayer(containerRef, true, onCancel);

  function handleApply() {
    const startIso = utcIsoFromLocalDateTimeInput(startValue);
    const endIso = utcIsoFromLocalDateTimeInput(endValue);
    const result = validateRange(startIso, endIso);
    if (!result.ok) {
      setError(result.message ?? 'Invalid range.');
      return;
    }
    // startIso/endIso are non-null once result.ok is true.
    onApply(startIso as string, endIso as string);
  }

  return (
    <div ref={containerRef} className={styles.popover} role="dialog" aria-label="Custom time range">
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor={startId}>Start</label>
          <input
            id={startId}
            type="datetime-local"
            value={startValue}
            onChange={(event) => setStartValue(event.target.value)}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={endId}>End</label>
          <input
            id={endId}
            type="datetime-local"
            value={endValue}
            onChange={(event) => setEndValue(event.target.value)}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>
      </div>
      {error ? (
        <div id={errorId} className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}
