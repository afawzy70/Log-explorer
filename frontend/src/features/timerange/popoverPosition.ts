/**
 * Pure viewport-containment math for `CustomRangePopover`'s anchored
 * position (CLAUDE.md §4: the editor "must not overlap severity" and must
 * stay inside the viewport). Kept separate from the component so the
 * clamping logic itself is unit-testable without a real DOM/layout.
 *
 * The popover is `position: absolute` inside `.wrapper` (its trigger's own
 * container, already `position: relative` - mirrors how the preset `.menu`
 * anchors itself). Its CSS default is `left: 0` (flush with the trigger),
 * which is correct wherever the trigger sits UNLESS that would push the
 * popover's fixed-width box past either edge of the viewport - this
 * function computes the `left` CSS value (relative to the wrapper) that
 * keeps it clear of both edges by `marginPx`, preferring the CSS default
 * (an offset of 0) whenever it already fits.
 */
export interface ClampPopoverLeftInput {
  /** The trigger/wrapper's own left edge, in viewport coordinates. */
  wrapperLeft: number;
  /** The popover's own rendered width in CSS px (after any max-width clamp). */
  popoverWidth: number;
  /** The viewport's width in CSS px (`window.innerWidth`). */
  viewportWidth: number;
  /** Minimum clearance to keep between the popover and either viewport edge. */
  marginPx: number;
}

/**
 * Returns the `left` CSS px value (relative to the wrapper's own left
 * edge) that keeps the popover inside `[marginPx, viewportWidth - marginPx]`
 * whenever the popover is narrow enough to fit with that clearance, and
 * otherwise keeps it as close to centered-in-bounds as the width allows.
 */
export function clampPopoverLeft({
  wrapperLeft,
  popoverWidth,
  viewportWidth,
  marginPx,
}: ClampPopoverLeftInput): number {
  // The highest viewport-relative left the popover's right edge can sit at
  // without crossing the right margin - if the popover is wider than the
  // viewport minus both margins, this floors at marginPx (the popover
  // then rests flush with the left margin, extending under the right
  // margin, which is the least-bad option once it can never fit).
  const maxViewportLeft = Math.max(marginPx, viewportWidth - marginPx - popoverWidth);
  const desiredViewportLeft = Math.min(Math.max(wrapperLeft, marginPx), maxViewportLeft);
  return desiredViewportLeft - wrapperLeft;
}

/**
 * PR #65 CI regression fix - the horizontal clamp above keeps the popover
 * clear of the left/right viewport edges, but says nothing about what
 * sits BELOW the trigger. The CSS default (`top: calc(100% + gap)`,
 * `CustomRangePopover.module.css`) opens the popover directly under the
 * trigger's own row - correct as long as nothing else in the toolbar's
 * `flex-wrap` row sits directly beneath that row. At extreme zoom (400%
 * reproduced the CI failure; verified live against a real backend/frontend
 * with the exact CI Chromium build), the toolbar's own flex-wrap row runs
 * out of horizontal room and wraps - `SeverityFilter` (or whichever
 * control follows Time Range) can land on the very next row, directly
 * under the Time Range trigger. The popover, anchored only to its own
 * trigger's row, then opens right on top of that wrapped control -
 * `assertNoOverlap(dialog, severity)` failed with both rects sharing the
 * exact same `top` (measured: -155.7px at 400% zoom/1280px), because the
 * wrapped Severity row started exactly where the popover's own anchor
 * calculation put it.
 *
 * The fix: never anchor below less than the toolbar's own full rendered
 * bottom edge, not just the trigger's row. In the common case (no wrap)
 * the toolbar's bottom IS the trigger row's bottom, so this changes
 * nothing visible; only when the toolbar has actually wrapped past the
 * trigger's row does this push the popover further down to clear it -
 * which is exactly the CLAUDE.md §4 invariant ("the editor must not
 * overlap severity") stated in the most general form that survives
 * flex-wrap reflow at any zoom or width.
 */
export interface ClampPopoverTopInput {
  /** The trigger/wrapper's own top edge, in the same coordinate space as the other fields below. */
  wrapperTop: number;
  /** The trigger/wrapper's own bottom edge. */
  wrapperBottom: number;
  /**
   * The bottom-most edge of whatever the popover must stay clear of below
   * the trigger - the enclosing toolbar's own rendered bottom edge, which
   * only exceeds `wrapperBottom` once the toolbar's `flex-wrap` has put
   * another row (e.g. Severity) underneath the trigger's row. Pass
   * `wrapperBottom` itself when no such element can be found (falls back
   * to the original "just below the trigger" behavior).
   */
  clearBottom: number;
  /** Clearance to keep below whichever edge (trigger or toolbar) is lower. */
  gapPx: number;
}

/**
 * Returns the `top` CSS px value (relative to the wrapper's own top edge,
 * matching how `left` above is relative to the wrapper's own left edge)
 * that opens the popover directly below the trigger whenever that is
 * already clear of the rest of the toolbar, and otherwise pushes it down
 * just far enough to clear the toolbar's own lowest wrapped row.
 */
export function clampPopoverTop({ wrapperTop, wrapperBottom, clearBottom, gapPx }: ClampPopoverTopInput): number {
  const anchorBottom = Math.max(wrapperBottom, clearBottom);
  return anchorBottom + gapPx - wrapperTop;
}
