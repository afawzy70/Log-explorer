import { useEffect } from 'react';
import { isTypingTarget } from '../shared/keyboard/isTypingTarget';

/**
 * Global, UI-level keyboard productivity (UI Parity Acceleration Pass
 * §10 "keyboard productivity" - the OLD application's own "search
 * shortcut" and "run search" bindings, both real, verified gaps in the
 * pre-pass capability matrix: SEARCH-18 `NEW_MISSING`).
 *
 * Deliberately narrow, and deliberately never touches a binding a browser
 * or OS already owns:
 * - `Ctrl/Cmd+Enter` runs the current committed search from anywhere on
 *   the page, including while typing in a text field (a submit gesture,
 *   not a single-key one - safe everywhere, same convention as Slack/
 *   Linear/GitHub comment boxes).
 * - `/` focuses Universal Search - only when focus is not *already* in a
 *   text-entry control (`isTypingTarget`), so typing a literal `/` into
 *   Advanced Filters, the Query text/Raw LogQL editor, or the inspector's
 *   All Fields search box is never intercepted.
 *
 * `?` (open the keyboard-shortcuts help) is registered by
 * `KeyboardShortcutsHelp.tsx` itself, not here - it owns its own open/
 * close state, matching every other self-contained popover in this
 * codebase (`TableSettingsControl`, `DockerSettingsPanel`, ...).
 */
export function useGlobalShortcuts(runSearch: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        runSearch();
        return;
      }
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[data-shortcut="universal-search"]')?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [runSearch]);
}
