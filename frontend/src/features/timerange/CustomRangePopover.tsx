import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import {
  localDateTimeInputValue,
  utcIsoFromLocalDateTimeInput,
  validateRange,
} from '../../shared/time/interval';
import { clampPopoverLeft } from './popoverPosition';
import styles from './CustomRangePopover.module.css';

/** Keeps the popover's edges at least this many CSS px clear of the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

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
  // Viewport-containment clamp (CLAUDE.md §4: the editor "must not overlap
  // severity" and must stay inside the viewport). The CSS default anchors
  // this popover's left edge to its trigger's left edge
  // (`CustomRangePopover.module.css`'s `.popover { left: 0 }`), which is
  // correct wherever the trigger happens to sit in the toolbar - except
  // when the trigger sits far enough right (or the viewport is narrow
  // enough) that the popover's fixed 280px width would then overflow the
  // right edge. `null` means "use the CSS default, no clamp needed yet".
  const [leftOverridePx, setLeftOverridePx] = useState<number | null>(null);
  const startId = useId();
  const endId = useId();
  const errorId = useId();

  useDismissableLayer(containerRef, true, onCancel);

  useLayoutEffect(() => {
    function reposition() {
      const el = containerRef.current;
      const wrapper = el?.offsetParent as HTMLElement | null;
      if (!el || !wrapper) {
        return;
      }
      const wrapperRect = wrapper.getBoundingClientRect();
      const popoverWidth = el.getBoundingClientRect().width;
      const nextOffset = clampPopoverLeft({
        wrapperLeft: wrapperRect.left,
        popoverWidth,
        viewportWidth: window.innerWidth,
        marginPx: VIEWPORT_MARGIN_PX,
      });
      setLeftOverridePx((prev) => (prev !== null && Math.abs(prev - nextOffset) < 0.5 ? prev : nextOffset));
    }

    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, []);

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
    <div
      ref={containerRef}
      className={styles.popover}
      role="dialog"
      aria-label="Custom time range"
      style={leftOverridePx !== null ? { left: `${leftOverridePx}px` } : undefined}
    >
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
