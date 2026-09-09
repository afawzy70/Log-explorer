# UX Manual QA checklist

Automated gates (vitest + axe) cannot judge visual quality, motion feel, or screen-reader noise.
Run this checklist after any visual/UX change. Mark each item pass/fail and note the browser.

Tooling: `npm test` (frontend), `npm run typecheck`, `npm run build`, `npm run dev` then open
`http://localhost:5173` (or the served build).

## Setup

- [ ] Run one search with enough real data to fill a page, then a coherent correlation/trace search.
- [ ] Have a source that supports LIVE_TAIL available for the live checks.
- [ ] Test in at least Chrome + Firefox; repeat key checks in Safari if available.

## Accessibility (manual complement to the axe gates)

- [ ] Tab order is logical: header controls → search box → run button → filter chips → table → inspector.
- [ ] Focus is always visible (clear focus ring) on every interactive element; not suppressed.
- [ ] Search can be run entirely by keyboard: type query, press Enter / Ctrl+Enter.
- [ ] Filters (services, levels, query mode) are operable by keyboard; chips and checkboxes show checked state.
- [ ] In the results table, arrow keys move focus between rows and Enter opens the inspector; Escape / close returns focus to the originating row.
- [ ] Timing/results table is announced as a table/grid with meaningful headers.
- [ ] Inspector is a labelled region/dialog; Esc closes it and restores focus.
- [ ] Correlation timeline rows can be activated with Enter/Space, not only click.
- [ ] Live mode: start via confirmation dialog; pause/resume/stop reachable by keyboard.
- [ ] Screen reader on: during live tail, the status region does not announce every row. It announces state transitions (connected/paused/reconnecting) and a batched count, with periodic totals — not a per-event ping.
- [ ] Severity and connection state are conveyed by text/labels, not colour alone.

## Responsiveness / zoom

- [ ] >=1440px: full table + inspector side by side.
- [ ] 1024-1439px: compact toolbar/table and overlay or narrower inspector.
- [ ] 768-1023px: toolbar wraps to rows; optional columns hidden by responsive priority.
- [ ] <768px: deliberate stacked search and event cards/list, inspector as bottom sheet; the desktop grid is not squeezed.
- [ ] No horizontal page overflow at any width; any contained table scroller is only inside the results area and is keyboard scrollable + labelled.
- [ ] Browser zoom at 125% and 200%: no clipped controls, no overlapping layout, no overflow.
- [ ] `prefers-reduced-motion: reduce` disables animation/spinners; nothing essential is hidden.

## Performance / loading

- [ ] First load: no jarring layout shift while initial data loads; reserved space or stable placeholder.
- [ ] Search with 100, 1,000, and configured maximum results: table stays responsive; selecting rows re-renders only the needed subtree.
- [ ] Starting a second search while the first is in flight: the stale request is aborted and its response is not shown.
- [ ] Advanced query editor and correlation timeline lazy-load only when opened (they should not block first paint).
- [ ] Live tail: display buffer (1000) / pause buffer (100) hold size, dropped warning appears once.

## Visual refinement

- [ ] Empty, loading, error, truncated, and protected states share one visual language (same token palette, spacing, iconography, messaging).
- [ ] Messages / investigation content dominate; redundant borders, cards and labels removed.
- [ ] Controls and table columns align on a consistent grid; spacing/typography follow tokens.
- [ ] Icons are restrained and have accessible labels; none is the sole signalling channel.
- [ ] Text and control contrast meet WCAG 2.2 AA (4.5:1 body/UI, 3:1 large text/UI components).

## Confirmed sizes (re-run if assets changed)

| Metric | Latest build | Phase 1 budget |
|--------|--------------|----------------|
| Initial JS (gzip) | ~70.82 kB | <=75 kB gzip |
| Initial JS (raw) | ~232.49 kB (main) + ~22 kB deferred | <=220 kB raw |
| CSS (gzip) | ~9.77 kB | <=8 kB gzip |
| CSS (raw) | ~56.21 kB | <=30 kB raw |

Update `docs/UX_SPEC.md` "UX Phase 8 verification" with any changed build numbers when assets change.
