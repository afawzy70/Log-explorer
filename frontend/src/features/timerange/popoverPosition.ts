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
