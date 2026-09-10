import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Every layer currently registered as open, oldest first - lets a nested
 * layer (Advanced Query rendered inside the More Filters drawer, UX-R1)
 * tell whether it is the topmost one. Module-level by design: layers are
 * a global stack regardless of which component tree they live in.
 */
const openLayers: symbol[] = [];

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
  // Always the latest `onDismiss`, read from inside the listeners below -
  // deliberately *not* a dependency of the effect that (re)registers those
  // listeners. None of this hook's callers memoize `onDismiss` (it's a
  // plain function recreated every render), so making it a dependency
  // would re-run the effect - and with the layer stack below, re-push this
  // layer to the *end* of the stack - on every unrelated keystroke while
  // the panel is open, not just on real open/close transitions. That would
  // let an outer layer that merely re-rendered (e.g. a field edit) steal
  // "topmost" from a genuinely more-recently-opened nested layer.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // UX-R1: Advanced Query now renders inside the More Filters drawer, so
    // two independent dismissable layers can be open at once. Without this,
    // a single Escape keypress closed both (this hook's own `keydown`
    // listener never called `stopPropagation`/`stopImmediatePropagation`,
    // so every open layer's handler ran for the same keypress) - only the
    // topmost (most-recently-opened) layer should react to Escape.
    const layerId = Symbol('dismissable-layer');
    openLayers.push(layerId);

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onDismissRef.current();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && openLayers[openLayers.length - 1] === layerId) {
        onDismissRef.current();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      const index = openLayers.indexOf(layerId);
      if (index !== -1) {
        openLayers.splice(index, 1);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDismiss is read via onDismissRef, deliberately excluded (see comment above)
  }, [isOpen, containerRef]);
}
