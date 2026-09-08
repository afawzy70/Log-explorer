import { useCallback, useEffect, useRef, useState } from 'react';

export const MIN_PANEL_WIDTH = 320;
export const MAX_PANEL_WIDTH = 720;
const DEFAULT_PANEL_WIDTH = 420;

/**
 * "Safe min/max resizing" (IMPLEMENTATION_PLAN.md "Phase H") - width is
 * clamped to [MIN_PANEL_WIDTH, MAX_PANEL_WIDTH] on every drag frame, so
 * the panel can never be dragged to zero/negative width or wide enough to
 * push the results table off-screen. Kept in memory only, never persisted
 * (CLAUDE.md §2 rule 4 governs what may go in `localStorage`; this phase
 * does not add a persistence carve-out for it).
 */
export function useResizablePanel() {
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [resizing, setResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_PANEL_WIDTH);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      startXRef.current = event.clientX;
      startWidthRef.current = width;
      setResizing(true);
    },
    [width],
  );

  useEffect(() => {
    if (!resizing) {
      return;
    }
    function onMove(event: PointerEvent) {
      // Dragging the handle left (toward the results table) widens the
      // panel, since the panel sits on the right edge of the page.
      const delta = startXRef.current - event.clientX;
      const next = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidthRef.current + delta));
      setWidth(next);
    }
    function onUp() {
      setResizing(false);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [resizing]);

  const nudge = useCallback((deltaPx: number) => {
    setWidth((prev) => Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, prev + deltaPx)));
  }, []);

  return { width, onPointerDown, nudge };
}
