import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Shared close-on-outside-click / close-on-Escape behavior for every
 * popover-shaped control (custom time range, service multi-select,
 * advanced filters) - CLAUDE.md §4: "Cancel / Escape / outside click
 * closes without mutating the committed range" (and the equivalent for
 * every other draft/apply/cancel surface).
 */
export function useDismissableLayer(
  containerRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onDismiss();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onDismiss();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, containerRef, onDismiss]);
}
