import { useRef } from 'react';
import { useShortcut } from '../../shared/keyboard/ShortcutRegistry';
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
 * <p><b>Legacy Remediation Slice 8</b> - migrated onto the shared {@link
 * useShortcut} registry (one `document` listener for the whole app, not a
 * second one here). `isActive` (the exact same window `App.tsx` already
 * uses to decide whether to render `LiveTailPanel` at all) is now a
 * runtime guard inside each shortcut's own `test`, not a
 * register/unregister toggle - these four bindings stay registered (and
 * therefore always listed in the shortcuts-help popover, even while
 * viewing historical search) but only ever *match* a keydown while Live is
 * actually the active view. Single letters, never a modifier combination,
 * guarded against typing targets by the registry's own default.
 */
/** True for an un-modified press of the given single letter (case-insensitive), never a browser/system chord. */
function isBareLetter(e: KeyboardEvent, letter: string): boolean {
  return e.key.toLowerCase() === letter && !e.ctrlKey && !e.metaKey && !e.altKey;
}

export function useLiveKeyboardShortcuts(live: LiveTailHandle, isActive: boolean): void {
  // Always holds the latest `live`/`isActive` - test()/onTrigger() close
  // over this ref rather than the arguments directly, so useShortcut's own
  // internal effect (keyed only on a stable `id`) never needs to
  // re-register when either value changes on a later render.
  const stateRef = useRef({ live, isActive });
  stateRef.current = { live, isActive };

  useShortcut({
    id: 'live.pauseResume',
    keys: 'P',
    description: 'Pause / resume Live (while Live is the active view)',
    group: 'Live',
    test: (e) => {
      if (!isBareLetter(e, 'p')) {
        return false;
      }
      const { live: current, isActive: active } = stateRef.current;
      return active && (current.connectionState === 'live' || current.connectionState === 'paused');
    },
    onTrigger: () => {
      const current = stateRef.current.live;
      if (current.connectionState === 'live') {
        current.pause();
      } else if (current.connectionState === 'paused') {
        current.resume();
      }
    },
  });

  useShortcut({
    id: 'live.stop',
    keys: 'S',
    description: 'Stop Live (while Live is the active view)',
    group: 'Live',
    test: (e) => {
      if (!isBareLetter(e, 's')) {
        return false;
      }
      const { live: current, isActive: active } = stateRef.current;
      return (
        active &&
        (current.connectionState === 'live' ||
          current.connectionState === 'paused' ||
          current.connectionState === 'connecting' ||
          current.connectionState === 'reconnecting')
      );
    },
    onTrigger: () => stateRef.current.live.stop(),
  });

  useShortcut({
    id: 'live.clear',
    keys: 'C',
    description: 'Clear Live events (while Live is the active view)',
    group: 'Live',
    test: (e) => {
      if (!isBareLetter(e, 'c')) {
        return false;
      }
      const { live: current, isActive: active } = stateRef.current;
      return active && current.visibleEvents.length > 0;
    },
    onTrigger: () => stateRef.current.live.clear(),
  });

  useShortcut({
    id: 'live.toggleFollowNewest',
    keys: 'F',
    description: 'Toggle Follow newest (while Live is the active view)',
    group: 'Live',
    test: (e) => isBareLetter(e, 'f') && stateRef.current.isActive,
    onTrigger: () => {
      const current = stateRef.current.live;
      current.setFollowNewest(!current.followNewest);
    },
  });
}
