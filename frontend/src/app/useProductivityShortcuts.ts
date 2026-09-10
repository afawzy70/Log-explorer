import { useShortcut } from '../shared/keyboard/ShortcutRegistry';
import type { SearchState } from './useSearchState';

/**
 * Legacy Remediation Slice 8 — global investigation-productivity shortcuts
 * (`docs/verification/LEGACY_REMEDIATION_SLICE_8_REPORT.md`), registered
 * through the shared {@link useShortcut}/{@link ShortcutRegistryProvider}
 * registry (one `document` listener for the whole app, never a second one
 * added here). Replaces the UI Parity Acceleration Pass's own
 * `useGlobalShortcuts.ts` (Ctrl/Cmd+Enter, `/`) - both are preserved here,
 * unchanged in behavior, alongside four genuinely-missing bindings this
 * slice's own audit found (`docs/verification/LEGACY_REMEDIATION_SLICE_8_REPORT.md`
 * §4): open/close More Filters, show surrounding context, return to the
 * original search/journey, and refresh.
 *
 * Every single-letter binding here requires no modifier (guarded the same
 * way `useLiveKeyboardShortcuts.ts`'s P/S/C/F already are) and is guarded
 * against typing targets by default (`allowWhileTyping` left unset) - never
 * overriding a browser/system shortcut, never hijacking a keystroke meant
 * for a text field. `Ctrl/Cmd+Enter` is the one deliberate exception
 * (`allowWhileTyping: true`) - a submit gesture, safe everywhere, matching
 * Slack/Linear/GitHub's own comment-box convention (unchanged from the
 * pre-Slice-8 behavior).
 */
export function useProductivityShortcuts(state: SearchState): void {
  useShortcut({
    id: 'global.runSearch',
    keys: 'Ctrl/Cmd + Enter',
    description: 'Run the current search from anywhere on the page',
    group: 'Search & filters',
    allowWhileTyping: true,
    test: (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey),
    onTrigger: () => state.runSearch(),
  });

  useShortcut({
    id: 'global.focusSearch',
    keys: '/',
    description: 'Focus the search box',
    group: 'Search & filters',
    test: (e) => e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey,
    onTrigger: () => document.querySelector<HTMLInputElement>('[data-shortcut="universal-search"]')?.focus(),
  });

  useShortcut({
    id: 'global.toggleMoreFilters',
    keys: 'M',
    description: 'Open/close More Filters',
    group: 'Search & filters',
    test: (e) => (e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey,
    onTrigger: () => document.querySelector<HTMLButtonElement>('[data-shortcut="more-filters-trigger"]')?.click(),
  });

  useShortcut({
    id: 'global.refresh',
    keys: 'R',
    description: 'Refresh the current search (while results are shown)',
    group: 'Search & filters',
    test: (e) => (e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && state.searchResult != null,
    onTrigger: () => state.refresh(),
  });

  useShortcut({
    id: 'inspector.showContext',
    keys: 'X',
    description: 'Show ±30 seconds of surrounding context (while an event is selected)',
    group: 'Results & inspector',
    test: (e) =>
      (e.key === 'x' || e.key === 'X') &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      state.selectedEvent != null &&
      state.selectedEvent.timestamp != null,
    onTrigger: () => state.selectedEvent && state.showContext(state.selectedEvent),
  });

  useShortcut({
    id: 'results.back',
    keys: 'B',
    description: 'Back to the original search (from a context view or a journey timeline)',
    group: 'Results & inspector',
    test: (e) =>
      (e.key === 'b' || e.key === 'B') &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (state.breadcrumbLabel != null || state.journeyQuery != null),
    onTrigger: () => {
      if (state.breadcrumbLabel) {
        state.restoreOriginalSearch();
      } else if (state.journeyQuery) {
        state.closeJourney();
      }
    },
  });
}
