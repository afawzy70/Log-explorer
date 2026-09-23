import { describe, expect, it } from 'vitest';
import { clampPopoverLeft, clampPopoverTop } from './popoverPosition';

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

/*
 * PR #65 CI regression fix - `phase-f-search-ux.spec.ts`'s "no horizontal
 * overflow with the custom time range popover open at 400% zoom" failed
 * in CI (`assertNoOverlap` between the dialog and Severity), reproduced
 * live against the exact CI Chromium build: at 400% zoom the toolbar's
 * own `flex-wrap` row runs out of room and wraps Severity underneath the
 * Time Range trigger's own row - the popover's old CSS-only anchor
 * (`top: calc(100% + gap)`, clear only of the TRIGGER's row) then opened
 * directly on top of it. `clampPopoverTop` is the fix: never anchor
 * higher than the enclosing toolbar's own rendered bottom edge, not just
 * the trigger's.
 */
describe('clampPopoverTop', () => {
  it('opens directly below the trigger (the CSS default) when the toolbar has not wrapped past it', () => {
    // clearBottom === wrapperBottom - nothing else sits below the trigger's own row.
    const offset = clampPopoverTop({ wrapperTop: 100, wrapperBottom: 136, clearBottom: 136, gapPx: 8 });
    expect(offset).toBe(136 + 8 - 100); // same as the CSS `calc(100% + 8px)` default
  });

  it('pushes further down to clear a control the toolbar has wrapped underneath the trigger', () => {
    // The toolbar's own bottom (210) extends well past the trigger's own
    // row (136) - e.g. Severity wrapped onto the next row.
    const offset = clampPopoverTop({ wrapperTop: 100, wrapperBottom: 136, clearBottom: 210, gapPx: 8 });
    const resultingTop = 100 + offset; // viewport-relative top the popover will render at
    expect(resultingTop).toBe(210 + 8);
    expect(resultingTop).toBeGreaterThan(136); // clear of the trigger's own row too
  });

  it('uses whichever edge is lower, regardless of whether the trigger or the toolbar extends further down', () => {
    // Here the trigger's OWN row is the taller one (its bottom, 250,
    // already exceeds the toolbar's reported bottom, 210 - e.g. a
    // momentarily stale toolbar measurement) - must not clamp to a top
    // that leaves the popover overlapping the trigger's own row.
    const offset = clampPopoverTop({ wrapperTop: 100, wrapperBottom: 250, clearBottom: 210, gapPx: 8 });
    const resultingTop = 100 + offset;
    expect(resultingTop).toBe(250 + 8);
  });
});
