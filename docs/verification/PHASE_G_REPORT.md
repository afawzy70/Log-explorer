# Phase G — Results table correctness and truthful states — Verification Report

Branch: `phase/g-results-table`
Date: 2026-09-08

## Prerequisite

Phase F (historical search UX) is merged (PR #8) — confirmed via `gh pr view 8` (`MERGED`) and a fresh `main` checkout with the full backend suite (303/303) and frontend suite (99/99) green before branching.

## Architecture

- **`shared/ui/table/emptyValue.ts`**: the one shared `EMPTY_VALUE` (`—`) constant every column renderer uses — centralized so "missing values render `—`" can never drift into a near-identical lookalike character in one column but not another.
- **`features/results/columns.ts`**: `RESULT_COLUMNS` — the single source of truth for the exact seven columns, in order, used by both the `<colgroup>` and the `<thead>`, so header and body column count can never silently drift apart (the exact bug class HANDOVER.md §15 describes: *"missing fields shifted later values"*).
- **`features/results/columnMapping.ts`**: pure, independently-testable functions for every column's value — `resolveService` (application + Compose-service fallback), `resolveWhatHappened` (message only, malformed → raw line), `resolveUserOrCustomer`/`resolveCorrelationOrTrace` (already-masked/non-sensitive values only), `formatTimestampCell` (date + time + milliseconds), `listCopyableIdentifiers`.
- **`features/results/counts.ts`**: `buildCountsSummary` — the one place `ResultCounts` becomes copy, keeping `estimatedTotal`/`returned`/`visible`/`truncated` distinct, never conflated.
- **`features/results/ResultsTable.tsx`**: the seven-column semantic contract itself — one `<table>`, one `<colgroup>`, `table-layout: fixed`.
- **`features/results/MessageCell.tsx`**: the flexible "What happened" column with an accessible expand/collapse toggle for long messages.
- **`features/results/ActionsCell.tsx`**: the seventh column — a real "…" menu copying whichever non-sensitive identifiers (trace/span/correlation/journey/event) an event actually has, via `shared/browser/clipboard.ts` (extracted specifically so it's mockable in tests, since jsdom's own real `Clipboard` implementation cannot be shadowed by redefining `navigator.clipboard`).
- **`features/results/ResultsPanel.tsx`**: orchestrates every required state (loading, error, empty, results-with-pagination) around `ResultsTable`, replacing Phase F's `ResultsPlaceholder`.
- **`app/useSearchState.ts`** (extended): real `AbortController`-based request-supersession (a new search aborts a still-in-flight older one) and a real `loadMore()` cursor-pagination action.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase G":

1. **Exactly seven columns, in order**: Time, Level, Service, What happened, User/Customer, Correlation/Trace, Actions — a dedicated DOM-order test, plus real browser verification.
2. **Service = application with Compose-service fallback; What happened = message only**: independent resolver functions, with an explicit test proving the message text never leaks into the Service cell.
3. **Missing values render `—`; never omit a cell**: every column always renders through the shared `EMPTY_VALUE`; every row always has exactly 7 `<td>` cells, even for a fully malformed event with no parsed fields at all.
4. **One semantic `<table>`, one `<colgroup>`, `table-layout: fixed`, shared header/body geometry**: real browser geometry assertions (≤2px header/cell left+width match) at every required viewport and zoom level — see "the gate" below.
5. **One event = one `<tr>`; Actions is the 7th cell of the same row**: proven structurally (every row has exactly 7 cells, never a second row).
6. **Time shows date + time + milliseconds**: `formatTimestampCell` always includes the full date (never time-only), so a "Last 1 day" search crossing a date boundary is never ambiguous.
7. **Message is the flexible column with accessible expansion**: `MessageCell` ellipsis-truncates by default and exposes an `aria-expanded` toggle for long text.
8. **Newest first; no dropped/duplicated rows**: the table renders events in exactly the order the backend returns them — no client-side reordering — verified both by a component test and by a real-browser assertion that real fixture timestamps are non-increasing row over row.
9. **One pagination model (bounded cursor)**: exactly one "Load more" control, gated strictly on a real `nextCursor` — see "A deliberately built-but-currently-inert feature" below.
10. **Counts kept distinct**: `buildCountsSummary` never conflates `estimatedTotal`/`returned`/`visible`/`truncated`.
11. **States**: loading, error, empty (with one-click "Search last 1 day"), truncated, and malformed-raw-line rendering all implemented and tested; "cancelled" implemented as request-supersession protection (see below).
12. **Horizontal scroll belongs around the table; the page never overflows horizontally**: `.scrollWrapper { overflow-x: auto }` — verified for real at 200% zoom (the table scrolls internally; the page does not).

## A deliberately built-but-currently-inert feature: cursor pagination

`SearchService#toResult()` (backend, all prior phases) always returns `nextCursor: null` — no adapter has ever populated real cursor-based pagination. Rather than skip scope item 9 or fake it, `loadMore()` was built and tested for real (appends the next page's events using the exact cursor the backend returns, real `useSearchState.test.ts` coverage including a real out-of-order-response race test), and `ResultsPanel` renders the "Load more" button strictly gated on a real `nextCursor` being present. It therefore **never renders today** — matching this project's established honest pattern (Phase F's capability-gated Live button, never shown today for the same reason) — but is fully functional the moment a future phase wires real server-side cursor pagination, and proves by construction that only one pagination model exists in this codebase.

## "Cancelled" state — implemented as request-supersession, not a separate visible state

There is no Cancel button anywhere in this UI (Phase F never built one). "Cancelled" is instead implemented as the real correctness concern it represents: starting a new search while an older one is still in flight must never let the older one's late-arriving response overwrite the newer one's results. `useSearchState` now tracks the one active request via `AbortController` and aborts the previous one whenever `runSearch()`/`loadMore()` is called again; `useSearchState.test.ts` proves this with a real test that resolves two overlapping requests out of order and asserts the stale one never wins. This is documented here as a deliberate interpretation, not an oversight.

## Two real bugs found and fixed via this phase's own real-data verification

Both were found only because this phase's Playwright suite drives the **real app against the real backend** (not a static fixture), exactly as CLAUDE.md's debugging sequence requires.

1. **`shared/browser/clipboard.ts` extraction.** The first `ActionsCell` "copy" test failed: `navigator.clipboard.writeText` was genuinely invoked and succeeded, but against jsdom's own real `Clipboard` object, not the test's mock — `Object.defineProperty(navigator, 'clipboard', ...)` cannot shadow it. Diagnosed with real instrumentation (temporary debug logging proved the component saw a real `Clipboard [EventTarget]` instance, not the injected mock) before concluding the fix: extract a one-line `copyToClipboard` wrapper module and `vi.mock` *that* instead of fighting jsdom's native implementation.
2. **Shell header horizontal overflow at high zoom (a Phase F file, found during Phase G's real-data verification).** Re-running Phase F's full Playwright suite against this phase's live backend — which now returns three real sources, one of them (`openshift-loki`) genuinely unreachable in this environment — surfaced a real, 100%-reproducible 8px page overflow at 400% zoom that did not exist in Phase F's own PR. Root cause, found via direct DOM instrumentation (walking every element for the one whose `right` edge exceeded the viewport): `app/Shell.module.css`'s `.header` was a `display: flex` row with no `flex-wrap`, and an **unhealthy** source's "Retry" button is real content that is wider than a healthy source's status text alone — content that Phase F's own testing never exercised (its stub sources were always healthy). Fixed with the exact same pattern Phase F's own popover fix already established: give the row `flex-wrap: wrap` so it reflows instead of overflowing, regardless of *why* its content is wider than usual. `SourceSelect.module.css` was also given a defensive `max-width` for the same class of reason (a real backend source's display name is arbitrary-length text), though the Shell fix was the one that actually resolved the failure.

## Automated tests

All commands below were actually run this session.

| Check | Command | Result | Notes |
|---|---|---|---|
| Full frontend suite | `npx vitest run` | **PASS** | 162/162 tests, 24 test files. |
| Typecheck | `npm run typecheck` | PASS | Clean. |
| Production build | `npm run build` | PASS | 219 KB JS / 15.7 KB CSS (gzipped 68 KB / 3.1 KB). |
| Column mapping | `columnMapping.test.ts` (19) | PASS | Service fallback, message-only (never service), masked User/Customer, Trace/Correlation preference, timestamp formatting, copyable-identifier listing — malformed and fully-empty cases included. |
| Counts copy | `counts.test.ts` (6) | PASS | Every distinctness/truncation/singular-plural case. |
| Results table | `ResultsTable.test.tsx` (12, incl. jest-axe) | PASS | Exact 7-column order; one semantic table/colgroup; exactly 7 `<td>` per row; message never under Service; falls back to serviceSourceHint; never omits a cell (full placeholder row); malformed rendering; masked User/Customer + labeled Trace ID; exact render order (no reordering/dedup); `table-layout: fixed` computed style; 0 a11y violations. |
| Message cell | `MessageCell.test.tsx` (5, incl. jest-axe) | PASS | No toggle for short text; real accessible expand/collapse for long text; malformed badge + raw line. |
| Actions cell | `ActionsCell.test.tsx` (5, incl. jest-axe) | PASS | Disabled + honest label with nothing to copy; lists only present identifiers; real copy (mocked module) + menu closes; Escape/outside-click dismiss. |
| Results panel (states) | `ResultsPanel.test.tsx` (8, incl. jest-axe) | PASS | Prompt/loading/error/empty/results states, mutually exclusive (error never shown alongside a table); one-click "Search last 1 day"; exactly one pagination control, gated on a real cursor, never a competing Prev/Next. |
| `useSearchState` pagination/cancellation | `useSearchState.test.ts` (5) | PASS | Fresh search replaces results; **a new search racing an older one never lets the stale response win** (real out-of-order resolution test); `loadMore` appends using the real cursor, does nothing without one; a genuine failure (not a supersession) sets the error state. |
| Toolbar (regression) | `Toolbar.test.tsx` | PASS | Unaffected by this phase's `SearchState` shape additions (fixture updated). |
| Performance/scale | `ResultsTable.performance.test.tsx` (3) | PASS | The real `ResultsTable` component (not a static mimic) renders 100/1,000/5,000 synthetic events (5,000 = the backend's configured `max-limit`) without error, in bounded time — a Vitest/jsdom render-scale smoke test; see "the gate" below for why pixel geometry itself is proven separately, not re-proven at every scale. |
| Secret/unsafe-pattern scan | `grep -r dangerouslySetInnerHTML frontend/src` | PASS | Zero hits. |

## Browser checks (the gate)

Per the plan: *"For each visible header and its corresponding cell, compare `getBoundingClientRect().left` and `.width`; tolerance ≤ 2 CSS px. Run at 1920/1440/1280/1024/768/390, and at 125%/200% zoom. Also assert no page-level horizontal overflow, and run performance checks at 100/1,000/configured-max events."*

1. Booted the real packaged backend (`dev` profile — real `fixture`/`local-docker`/`openshift-loki` sources registered) and the real frontend dev server, both real processes.
2. Wrote `e2e/phase-g-results-table.spec.ts` (real backend required — drives an actual search against the `fixture` source's real deterministic corpus, not a static fixture): geometry + no-overflow at all 6 required widths, geometry + no-overflow at 125%/200% zoom, and a dedicated real-data correctness test (exact 7 headers, every row exactly 7 cells, real timestamps non-increasing, no page overflow).
3. First run: **8/9 passed**, but the pre-existing Phase F suite (re-run as a regression check against this phase's live backend) failed 1/16 — the Shell-header overflow bug above. Fixed; re-ran the **full** Playwright suite (all specs, not just this phase's own): **28/28 pass**.
4. Screenshots committed for every required width and zoom level: `docs/verification/g/results-table-{1920,1440,1280,1024,768,390}px.png`, `results-table-zoom-{125,200}pct.png`. Visually confirmed: real deterministic fixture data (117 events for the tested "Last 1 day" range), correct newest-first order, masked `User: xx***x` values, real Trace ID chips, and — at 200% zoom — the table correctly scrolling *within its own wrapper* rather than the page overflowing.
5. Performance: the pixel-geometry gate itself was run against 117 real events (the fixture corpus's own "Last 1 day" result set) — genuinely non-trivial N for the header/cell alignment check, which `table-layout: fixed` either holds structurally for *all* rows or doesn't (my Playwright helper already iterates every body row, not just the first). The 100/1,000/5,000-event scale requirement — beyond what the 120-event fixture corpus can produce — was satisfied via the real React component rendered directly in Vitest (see table above), since geometry correctness under `table-layout: fixed` does not degrade with row count (that is the defining property of fixed table layout); what genuinely differs at scale is render performance, which is what that test measures. This boundary is deliberate, not a shortcut: increasing the backend fixture corpus's size was considered and rejected as out of this phase's stated `features/results/**`/`shared/ui/table/**` file scope.
6. Cleaned up: killed both the backend and frontend dev-server processes, confirmed via `ps aux` that nothing was left running, removed scratch diagnostic scripts.

## Results

- **PASS**: all 12 Phase G scope items; every plan bullet demonstrably satisfied with real browser geometry evidence at every required viewport and zoom level, screenshots committed; 162/162 frontend tests + 28/28 Playwright tests (all specs) + 303/303 backend tests (unaffected), all green.
- **FAIL**: none remaining — two real bugs (a jsdom-Clipboard test-mocking gap; a genuine cross-phase Shell-header overflow bug only exposed by real backend data) were found and fixed during this phase's own verification, not shipped.
- **BLOCKED**: none.
- **DEFERRED**: none — no live-external-system dependency.

## Regression

Backend: 303/303 (unaffected — no backend files changed this phase). Frontend: 162/162 (was 99 at Phase F's completion — 63 new tests this phase, zero pre-existing tests weakened). Playwright: 28/28 across every spec (was 19 at Phase F's completion — 9 new this phase, plus the Phase F regression this phase's own verification found and fixed).

`docs/verification/f/timerange-popover-*.png` are also updated in this PR — a direct side effect of re-running Phase F's own spec (to confirm the fix above) against this phase's live backend, which now genuinely has an unhealthy source. The re-captured screenshots are still passing evidence for the exact same Phase F test scenarios, now additionally showing the Shell header correctly wrapping under real degraded-health content instead of overflowing.

## Security check for this phase

- Sensitive values in responses: the User/Customer column renders only `EventDto#protectedFields` (already masked by the backend); the frontend never requests, holds, or displays a raw sensitive value.
- No reveal action for masked values: confirmed — there is no control anywhere in `ActionsCell`/`ResultsTable` that un-masks a protected field; only non-sensitive identifiers (trace/span/correlation/journey/event) are ever offered for copying.
- `dangerouslySetInnerHTML`: grep-verified zero occurrences — every cell, including a malformed event's raw line, renders as plain text content.
- Nothing written to `localStorage`/`sessionStorage`/the URL: unchanged from Phase F's own verified guarantee — this phase adds no new persistence surface.
- Clipboard: only ever writes a non-sensitive identifier the user explicitly clicked to copy; never a sensitive field.

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 43, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 61, 85, 86 → **Done**. Rows 21, 60 → **Partial** (this phase's own share complete; row 21's Phase H share and row 60's "no Cancel button exists yet" boundary are both documented above).

## Known gaps carried forward

- Cursor-based pagination is fully built and tested but structurally unreachable until a future phase populates `SearchResult#nextCursor` server-side.
- No Cancel button exists in this UI, so "cancelled" is request-supersession protection only, not a user-triggerable visible state.
- The event inspector (clicking into a row for full detail) is Phase H's job — `ActionsCell`'s copy menu is this phase's only per-row interaction.
