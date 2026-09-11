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
 * Keydown events that a dismissable layer has already consumed.
 *
 * <p>UX-R6 §13 ("Escape closes the top-most transient layer only").
 * Layers registered through this hook already cooperate with each other -
 * only the topmost reacts to Escape - but surfaces that handle Escape
 * *outside* this hook had no way to know a layer had just used it, so one
 * Escape closed a popover **and** the panel underneath it. Measured in
 * the real app: with the Event Inspector open, opening a results row's
 * Actions menu and pressing Escape dismissed both, dropping the
 * investigator back to the results list when they meant to close a menu.
 *
 * <p>This deliberately marks **the event**, not "is a layer open". The
 * two listeners run in different phases - layers listen in the capture
 * phase, `ShortcutRegistry` in the bubble phase - and React flushes the
 * layer's close (and so its cleanup, and so its removal from
 * `openLayers`) in between. A stack-emptiness check therefore reported
 * "no layers open" by the time the outer handler ran, which is exactly
 * the bug it was meant to prevent. Event identity is immune to that
 * ordering: it is the same `KeyboardEvent` object in both phases.
 *
 * <p>A `WeakSet` so nothing is retained after the event is discarded.
 */
const consumedEscapes = new WeakSet<KeyboardEvent>();

/** True when a dismissable layer has already acted on this exact keydown. */
export function wasConsumedByDismissableLayer(event: KeyboardEvent): boolean {
  return consumedEscapes.has(event);
}

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
        // Mark before dismissing: `onDismiss` can trigger a synchronous
        // React flush, and any outer Escape handler for this same event
        // must see the mark regardless of when it runs.
        consumedEscapes.add(event);
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
