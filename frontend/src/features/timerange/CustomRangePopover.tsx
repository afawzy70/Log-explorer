import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useDismissableLayer } from '../../shared/ui/useDismissableLayer';
import {
  localDateTimeInputValue,
  utcIsoFromLocalDateTimeInput,
  validateRange,
} from '../../shared/time/interval';
import { clampPopoverLeft, clampPopoverTop } from './popoverPosition';
import styles from './CustomRangePopover.module.css';

/** Keeps the popover's edges at least this many CSS px clear of the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

/** Vertical clearance below the trigger (or whatever it must clear) - matches `--space-2`, the same gap the CSS default (`calc(100% + var(--space-2))`) already uses. */
const POPOVER_GAP_PX = 8;

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
  // Same idea, vertically (PR #65 CI regression fix - `popoverPosition.ts`'s
  // `clampPopoverTop` doc comment has the full root cause: at extreme zoom
  // the toolbar's own `flex-wrap` can put another control directly under
  // the trigger's row, and the CSS default (`top: calc(100% + gap)`, only
  // ever clear of the trigger's OWN row) then opens the popover on top of
  // it.
  const [topOverridePx, setTopOverridePx] = useState<number | null>(null);
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
      const popoverRect = el.getBoundingClientRect();

      // PR #65 CI regression fix - `getBoundingClientRect()`/`window.innerWidth`
      // report VISUAL (post-`zoom`) px, but a `left`/`top` value written to
      // this element's inline `style` is interpreted as a LAYOUT (pre-`zoom`)
      // length and gets scaled by the zoom factor again when rendered
      // (verified live: writing `top: 50px` under 400% zoom rendered at
      // visual y=200, not 50). Computing the clamp directly from the
      // visual-space rects above and writing the raw result back as a style
      // value double-applies that scaling - measured live, it threw the
      // popover ~4x further off to the left than intended at 400% zoom
      // (rendered left: -780px against an 1120px-wide box on a 1280px
      // viewport). Dividing every measurement below by the same zoom
      // factor first converts them all into the LAYOUT space that `style.left`/
      // `style.top` are actually interpreted in, so the clamp lands where it
      // visually measured, at any zoom level including 100%
      // (`popoverRect.width / layoutWidth` is 1 there and this is a no-op).
      const layoutWidth = parseFloat(getComputedStyle(el).width) || popoverRect.width || 1;
      const zoomFactor = popoverRect.width / layoutWidth || 1;

      const nextLeftOffset = clampPopoverLeft({
        wrapperLeft: wrapperRect.left / zoomFactor,
        popoverWidth: popoverRect.width / zoomFactor,
        viewportWidth: window.innerWidth / zoomFactor,
        marginPx: VIEWPORT_MARGIN_PX,
      });
      setLeftOverridePx((prev) => (prev !== null && Math.abs(prev - nextLeftOffset) < 0.5 ? prev : nextLeftOffset));

      // Whatever the popover must stay clear of below the trigger's own
      // row - the enclosing toolbar's own rendered bottom edge, which is
      // only ever lower than the trigger row's own bottom once the
      // toolbar's `flex-wrap` has put another control (e.g. Severity)
      // directly underneath it (see `clampPopoverTop`'s doc comment).
      // Falls back to the trigger's own bottom (the original "just below
      // the trigger" behavior) when no such ancestor is found - e.g. a
      // story/test that renders this popover outside a real toolbar.
      const toolbar = wrapper.closest('[class*="toolbar"]');
      const clearBottom = toolbar ? toolbar.getBoundingClientRect().bottom / zoomFactor : wrapperRect.bottom / zoomFactor;

      const nextTopOffset = clampPopoverTop({
        wrapperTop: wrapperRect.top / zoomFactor,
        wrapperBottom: wrapperRect.bottom / zoomFactor,
        clearBottom,
        gapPx: POPOVER_GAP_PX,
      });
      setTopOverridePx((prev) => (prev !== null && Math.abs(prev - nextTopOffset) < 0.5 ? prev : nextTopOffset));
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
      style={
        leftOverridePx !== null || topOverridePx !== null
          ? {
              ...(leftOverridePx !== null ? { left: `${leftOverridePx}px` } : null),
              ...(topOverridePx !== null ? { top: `${topOverridePx}px` } : null),
            }
          : undefined
      }
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
