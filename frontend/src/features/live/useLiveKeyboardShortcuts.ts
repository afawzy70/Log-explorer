import { useEffect, useRef } from 'react';
import { isTypingTarget } from '../../shared/keyboard/isTypingTarget';
import type { LiveTailHandle } from './useLiveTail';

/**
 * UI Gap Closure Pass - high-value Live keyboard shortcuts
 * (`docs/verification/UI_GAP_CLOSURE_REPORT.md`), restoring what Slice 5's
 * own report named as deferred ("dedicated Live control keyboard
 * shortcuts... lower value than the rest of that slice's list"). Every
 * control these shortcuts drive remains fully reachable by click alone -
 * "keyboard shortcut availability must not be required for using the
 * feature" (the mission's own wording) - this hook is purely additive.
 *
 * Single letters, never a modifier combination, and deliberately scoped to
 * only fire while the Live panel is actually the active view (`isActive`) -
 * the exact same window `App.tsx` already uses to decide whether to render
 * `LiveTailPanel` at all, so these bindings can never fire from the
 * historical search screen. Guarded by {@link isTypingTarget} so typing
 * "p"/"s"/"c"/"f" into the Live-local text filter (or anywhere else) is
 * never hijacked. Registers and tears down exactly one document listener,
 * whose effect dependency array (`isActive`) ensures it is removed the
 * moment Live mode ends - no duplicate/leaked global listener across
 * repeated Start/Stop/exit cycles.
 */
export function useLiveKeyboardShortcuts(live: LiveTailHandle, isActive: boolean): void {
  // Always holds the latest `live` without needing it in the effect's own
  // dependency array below - `live` is a fresh object every render (its
  // individual functions are memoized, the object itself is not), so
  // depending on it directly would tear down and re-add the document
  // listener far more often than necessary; a ref keeps exactly one
  // listener registered for the entire time `isActive` stays true, while
  // still always reading current state when a key is actually pressed.
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    if (!isActive) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      const current = liveRef.current;
      switch (event.key) {
        case 'p':
        case 'P':
          if (current.connectionState === 'live') {
            event.preventDefault();
            current.pause();
          } else if (current.connectionState === 'paused') {
            event.preventDefault();
            current.resume();
          }
          break;
        case 's':
        case 'S':
          if (
            current.connectionState === 'live' ||
            current.connectionState === 'paused' ||
            current.connectionState === 'connecting' ||
            current.connectionState === 'reconnecting'
          ) {
            event.preventDefault();
            current.stop();
          }
          break;
        case 'c':
        case 'C':
          if (current.visibleEvents.length > 0) {
            event.preventDefault();
            current.clear();
          }
          break;
        case 'f':
        case 'F':
          event.preventDefault();
          current.setFollowNewest(!current.followNewest);
          break;
        default:
          break;
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isActive]);
}
