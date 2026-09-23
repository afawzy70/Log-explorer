import { describe, expect, it } from 'vitest';
import { clampPopoverLeft } from './popoverPosition';

/*
 * PR #65 fix - `CustomRangePopover` moved from normal document flow to an
 * anchored `position: absolute` overlay (see `CustomRangePopover.module.css`'s
 * top-of-file comment for why: normal flow grew `.wrapper`'s intrinsic box,
 * which reflowed every sibling in the toolbar's `flex-wrap` row every time
 * Custom opened/closed - CLAUDE.md §4's "must not resize the toolbar"
 * invariant). This pure function is the viewport-containment math that
 * keeps the now out-of-flow popover inside the viewport regardless of
 * where its trigger sits.
 */
describe('clampPopoverLeft', () => {
  it('offsets by 0 (uses the CSS left:0 default) when the popover already fits at the trigger position', () => {
    const offset = clampPopoverLeft({ wrapperLeft: 70, popoverWidth: 280, viewportWidth: 1280, marginPx: 8 });
    expect(offset).toBe(0);
  });

  it('offsets by 0 at a narrow viewport when the trigger sits near the left edge', () => {
    const offset = clampPopoverLeft({ wrapperLeft: 70, popoverWidth: 280, viewportWidth: 390, marginPx: 8 });
    expect(offset).toBe(0);
  });

  it('shifts left (negative offset) when a bare left:0 anchor would overflow the right edge', () => {
    // Trigger at 800px on a 1024px-wide viewport: an unclamped popover
    // (left edge = 800) would extend to 1080, 56px past the viewport.
    const offset = clampPopoverLeft({ wrapperLeft: 800, popoverWidth: 280, viewportWidth: 1024, marginPx: 8 });
    const resultingLeftEdge = 800 + offset;
    const resultingRightEdge = resultingLeftEdge + 280;
    expect(resultingRightEdge).toBeLessThanOrEqual(1024 - 8);
    expect(offset).toBeLessThan(0);
  });

  it('shifts right (positive offset) when the trigger sits left of the margin (e.g. partially scrolled)', () => {
    const offset = clampPopoverLeft({ wrapperLeft: -20, popoverWidth: 280, viewportWidth: 1024, marginPx: 8 });
    const resultingLeftEdge = -20 + offset;
    expect(resultingLeftEdge).toBeGreaterThanOrEqual(8);
  });

  it('never asks for a left edge past the right margin, even when the popover cannot fit at all', () => {
    // A popover wider than the viewport minus both margins can never
    // satisfy both edges; it clamps to `viewportWidth - marginPx -
    // popoverWidth` (as close to the left margin as the width allows)
    // rather than being pushed further right past the right margin.
    const offset = clampPopoverLeft({ wrapperLeft: 300, popoverWidth: 280, viewportWidth: 300, marginPx: 8 });
    const resultingLeftEdge = 300 + offset;
    expect(resultingLeftEdge).toBe(300 - 8 - 280);
    expect(resultingLeftEdge + 280).toBeLessThanOrEqual(300);
  });

  it('is idempotent: reapplying the same clamp to an already-clamped position changes nothing further', () => {
    const first = clampPopoverLeft({ wrapperLeft: 800, popoverWidth: 280, viewportWidth: 1024, marginPx: 8 });
    const clampedWrapperLeft = 800 + first;
    const second = clampPopoverLeft({
      wrapperLeft: clampedWrapperLeft,
      popoverWidth: 280,
      viewportWidth: 1024,
      marginPx: 8,
    });
    expect(second).toBe(0);
  });
});
