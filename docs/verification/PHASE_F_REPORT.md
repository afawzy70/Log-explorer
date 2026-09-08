# Phase F — Historical search UX (shell, toolbar, time range) — Verification Report

Branch: `phase/f-search-ux`
Date: 2026-09-08

## Prerequisite

Phase E (query engine) is merged (PR #7) — confirmed via `gh pr view 7` (`MERGED`) and a fresh `main` checkout with the full backend suite green (303/303) before branching.

## Architecture

This is the first real frontend phase — the repository's frontend was a bare placeholder scaffold from Phase A2b (proving Playwright wiring only). Built from scratch this phase:

- **Testing toolchain**: Vitest + `@testing-library/react`/`user-event` + `jest-axe` (a11y), wired into the existing Vite config. Found and fixed a real TypeScript module-augmentation bug during setup (see "Real bugs found" below) before any component test could even compile.
- **Design tokens** (`shared/tokens.css`): color/typography/spacing/radius/border/shadow/motion as CSS custom properties — one restrained accent, semantic severity colors, `prefers-reduced-motion` respected.
- **`shared/time/**`**: `timezone.ts` (display-zone + UTC-offset labels), `presets.ts` (the five time presets + custom), `interval.ts` (the single UTC-conversion point, range validation with all four+one error classes, interval formatting).
- **`shared/api/**`**: a typed `fetch` client (`shared/api/client.ts`, `types.ts`) mirroring every backend DTO field-for-field. The Vite dev server proxies `/api` and `/actuator` to the backend (default port 8080) so the app never needs CORS, matching Phase K's eventual same-origin deployment shape.
- **`shared/ui/**`**: `Button`, `VisuallyHidden`, `useDismissableLayer` (Escape/outside-click), `usePopoverTrigger` (open/close + focus restoration) — shared by every popover-shaped control (time range, service select, advanced filters).
- **`features/timerange/**`**: `TimeRangeControl`, `CustomRangePopover`, `prefill.ts`, `label.ts` — the full screenshot-driven contract (scope item 7).
- **`features/search/**`**: `SourceSelect`, `ServiceMultiSelect`, `SeverityFilter`, `UniversalSearch` + `idDetection.ts`, `AdvancedFilters` + `advancedFilterFields.ts`, `ActiveFilters`.
- **`app/**`**: `Shell`, `Toolbar` (composes every control in the exact required order), `useSearchState` (the single state/orchestration hook — nothing here is ever written to `localStorage`/`sessionStorage`/the URL), `ResultsPlaceholder` (a deliberately minimal results area — see "Explicitly not delivered" below), `App`.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase F":

1. **Shell**: one "Log Explorer" title (never duplicated with "Multi-Source Log Explorer"), active source name, compact health badge, retry when unhealthy. No fabricated branding.
2. **Default toolbar order**: source → service multi-select → time range → severity → universal search → Search → Live (capability-gated) → More filters + active count — proven by a dedicated DOM-order test (`Toolbar.test.tsx`), not just visual inspection.
3. **Service multi-select**: accessible searchable checkbox list (never a native `<select multiple>`), all services with running/total counts, selected count, Clear, keyboard-operable, bounded/scrollable panel.
4. **Severity**: defaults to INFO/WARN/ERROR; All / Errors only / individual toggles; every chip always shows its text label plus a color dot — never color alone.
5. **Universal search**: the exact required label "Search messages, errors, users or paste an ID"; Enter and Ctrl/Cmd+Enter run; Escape dismisses a detected-ID suggestion without clearing the typed text; ID classification is always a confirmable suggestion, never silent.
6. **Advanced filters**: grouped exactly as specified (Who/customer, Request flow, What happened, Client context); draft/apply/cancel (editing never calls `onApply`, hence never fires a search); applied chips for the five sensitive fields always show "Protected", never the raw value.
7. **Time range**: the full contract — presets including "Last 1 day"; custom is a temporary popover (never permanently expanded); prefill rule (reopen restores committed, else End=now/Start=end−previous-preset-duration/30-min fallback); Apply validates (all five error classes: missing start, missing end, start not before end, future end, max-range-exceeded) and commits; Cancel/Escape/outside-click discard without mutating; focus restored to the trigger; the real formatted interval + display zone shown (never a generic "Custom range" label), mirrored in Active Filters; display-zone→UTC conversion happens at exactly one point in the code.
8. **Persistence**: query contents and every filter value are never written to `localStorage`, `sessionStorage`, or the URL — proven with real spies across a full interaction sequence, not just by inspection.

## Explicitly not delivered (by design, not oversight)

- **The real results table.** `app/ResultsPlaceholder.tsx` is a deliberately minimal message-only list — the seven-column semantic table with fixed geometry, exact cell contract, and truthful counts is Phase G's own job (`IMPLEMENTATION_PLAN.md` "Phase G"). This exists only so the toolbar/time-range/search flow built in this phase is demonstrable end-to-end against the real backend, and is clearly commented as such in the source.
- **Raw LogQL / DSL query text box.** Phase E built the backend capability; no control in Phase F's own stated scope wires a DSL text input to it. Not attempted, to avoid scope creep.
- **Live tail behavior.** The toolbar's Live button is capability-gated (`capabilities.liveTail`) and renders disabled with an explanatory `title` when a source ever does advertise the capability — no source currently does (Docker/fixture/Loki all report `false`), so it never renders in this environment. The actual live-tail transport is Phase J's job.

## A real, previously-unnoticed TypeScript bug found and fixed during setup

While wiring `jest-axe` into the Vitest `expect`, a `declare module 'vitest' { ... }` **augmentation** in a `.d.ts` file with no top-level `import`/`export` of its own was silently treated by TypeScript as a **replacement** ambient module declaration instead of an augmentation — because a file with no import/export is a "global script," and `declare module` inside a global script defines a brand-new ambient module rather than merging with the real one. This made `describe`/`it`/`expect` disappear from `vitest`'s types project-wide (`Module '"vitest"' has no exported member 'describe'`), for every test file, the moment the jest-axe types file was added to the `include` set. Diagnosed by bisecting the exact file combination that broke it (isolated single-file compiles, `-p tsconfig.app.json` narrowed to 1/2/3 files) down to the missing `import 'vitest'` statement; fixed by adding it and splitting the jest-axe declaration into its own file for clarity. Caught before any component test was ever written against it.

## A real layout bug found and fixed via the CLAUDE.md §6 debugging sequence

The Playwright geometry suite (below) genuinely failed on first run:

1. **Reproduce**: `custom time range popover does not overlap severity ... at 768px/390px` and `no horizontal overflow ... at 200%/400% zoom` both failed for real.
2. **Baseline**: Playwright error output gave exact bounding rects for both failures.
3. **Root cause 1 (overlap at narrow widths)**: the popover was `position: absolute`, anchored below the Time Range trigger — at narrow widths the flex-wrap toolbar reflows Severity onto the row directly beneath the trigger, and an absolutely-positioned child never pushes wrapped siblings out of the way, so the two overlapped.
4. **Root cause 2 (overflow under zoom)**: the Chromium-specific `document.documentElement.style.zoom` property (this project's own zoom-emulation technique, from Phase A2a's helpers) scales *rendering* without changing `window.innerWidth`/media-query breakpoints — confirmed by direct instrumentation (`getComputedStyle().width` stayed constant while `getBoundingClientRect()` reported the zoom-multiplied value). A width-based `@media` breakpoint can structurally never detect high zoom, so the existing "stack fields below 420px" media query never activated under `zoom`, and a `width: max-content` popover has no reason for its own internal `flex-wrap` to ever trigger, since `max-content` by definition sizes to fit its unwrapped content.
5. **Invariant**: an open popover's geometry must react to its children's *actual rendered size relative to its container*, never to a guessed viewport-width breakpoint — the former is correct under both narrow viewports and `zoom`; the latter is blind to `zoom` entirely.
6. **Smallest fix**: (a) removed `position: absolute` — the popover is now normal flow, so the flex-wrap toolbar naturally reflows subsequent controls below it, at any width or zoom; (b) gave the popover a real fixed `width` (not `max-content`) and added `flex-wrap: wrap` to its two-field row, so the fields genuinely reflow onto their own rows once they don't fit — reacting to rendered size, not a breakpoint number.
7. **Regression test**: `e2e/phase-f-search-ux.spec.ts`, committed.
8. **Re-verified** at all 6 required widths and 125%/200%/400% zoom — all pass, with screenshots (`docs/verification/f/`).

## Automated tests

All commands below were actually run this session.

| Check | Command | Result | Notes |
|---|---|---|---|
| Full frontend unit/component suite | `npx vitest run` | **PASS** | 99/99 tests, 16 test files, 0 failures. |
| Typecheck | `npm run typecheck` | PASS | `tsc -b --noEmit`, zero errors. |
| Production build | `npm run build` | PASS | 213 KB JS / 13 KB CSS (gzipped 67 KB / 2.7 KB). |
| Time-range utilities | `interval.test.ts` (12), `timezone.test.ts` (4), `presets` (used throughout) | PASS | All 5 validation reason classes incl. the exact-at-max boundary; UTC round-trip with zero drift; the exact `<zone> (UTC±HH:MM)` label shape. |
| Prefill/label logic | `prefill.test.ts` (3), `label.test.ts` (2) | PASS | Reopen-restores-committed vs. transition-from-preset vs. 30-min fallback; preset label vs. computed interval. |
| Time Range component | `TimeRangeControl.test.tsx` (12, incl. jest-axe) | PASS | Preset selection, temporary popover, valid/invalid Apply, Cancel/Escape/outside-click, reopen restores committed values, preset-while-open closes and restores the label, 0 a11y violations open or closed. |
| Service multi-select | `ServiceMultiSelect.test.tsx` (9, incl. jest-axe) | PASS | All-services default label, search filter, toggle/clear, Escape/outside-click, 0 a11y violations. |
| Severity | `SeverityFilter.test.tsx` (7, incl. jest-axe) | PASS | Every level always shows its text label; `aria-pressed` (not color alone) conveys state; All/Errors-only/individual toggles. |
| Universal search + ID detection | `UniversalSearch.test.tsx` (10, incl. jest-axe), `idDetection.test.ts` (7) | PASS | Exact required label; Enter and Ctrl+Enter run; confirmable (never silent) suggestion; Escape dismisses without clearing text; UUID/hex/prefixed-ID detection; ordinary prose never flagged. |
| Advanced filters | `AdvancedFilters.test.tsx` (9, incl. jest-axe), `advancedFilterFields.test.ts` (3) | PASS | Exact 4 groups/fields; editing never calls `onApply`; Apply commits the full draft; Cancel/Escape/outside-click discard; reopening after Cancel shows last-applied values, not the discarded draft. |
| Active filters (protected chips) | `ActiveFilters.test.tsx` (5, incl. jest-axe) | PASS | Time range always mirrored; non-sensitive fields show their raw value; all 5 sensitive fields show "Protected", a sentinel literal never appears; `text` never gets its own chip. |
| Source select + health | `SourceSelect.test.tsx` (4), `SourceHealthBadge.test.tsx` (4, incl. jest-axe) | PASS | Lists every source; retry button only for non-UP status. |
| Toolbar composition | `Toolbar.test.tsx` (5, incl. jest-axe) | PASS | Exact required DOM order (source → service → time range → severity → universal search → Search → More filters); Live button absent unless the active source advertises `liveTail`, and positioned before More filters when it does. |
| Persistence | `persistence.test.tsx` (1) | PASS | A full realistic interaction sequence (source select, time-range preset, severity toggle, sensitive free-text + CIF filter, Search) with real `localStorage`/`sessionStorage`/`history.pushState`/`replaceState` spies — none ever called, `location.search`/`hash` stay empty. The sentinel values are asserted present in the actual outgoing request body first, so the test cannot pass vacuously. |
| Browser checks (Playwright) | `npx playwright test` | PASS | 19/19 tests: `e2e/phase-f-search-ux.spec.ts` (11, new this phase) + pre-existing `geometry.spec.ts` (5) + `smoke.spec.ts` (3, updated). |

## Manual/browser verification

Per the plan: geometry assertions at 1920/1440/1280/1024/768/390 and 125%/200%/high zoom, with screenshots.

1. Booted the real packaged backend (`dev` profile, real fixture/Docker/Loki sources registered) and the real frontend dev server (`npm run dev`, proxying to it) — both real processes, not mocks.
2. Drove the actual running app with Playwright (headed logic, `chromium.launch()`): selected the `fixture` source, confirmed real health check success ("Healthy"), ran a real search and got real deterministic fixture events back with a real "N of ? events — showing results for ..." summary line, opened every popover (time range presets, custom editor, service multi-select, advanced filters), typed a trace-ID-looking value into Universal Search and got the real confirmable suggestion — screenshots visually inspected during this session (not committed as evidence; superseded by the dedicated geometry spec below).
3. Wrote `e2e/phase-f-search-ux.spec.ts` (self-contained — every control it touches renders from local component state, no backend required) covering the exact required matrix: overlap + no-horizontal-overflow at all 6 widths, fields-stack-not-side-by-side at 390px, no-horizontal-overflow at 125%/200%/400% zoom, and a page-level overflow sweep across all 6 widths. **This is where the two real bugs above were found and fixed** (first run: 4/11 failed; after the fixes: 11/11 pass).
4. Screenshots committed for every required width and zoom level: `docs/verification/f/timerange-popover-{1920,1440,1280,1024,768,390}px.png`, `timerange-popover-390px-stacked-fields.png`, `timerange-popover-zoom-{125,200,400}pct.png`.
5. Cleaned up: killed both the backend and frontend dev-server processes, confirmed via `ps aux` nothing was left running, removed scratch screenshot/script files.

## Results

- **PASS**: all 8 Phase F scope items; every §13/§14 bullet demonstrably satisfied per the plan's own PASS bar, with screenshots for the geometry/overlap items; 99/99 frontend unit/component tests + 19/19 Playwright tests + 303/303 backend tests (unaffected), all green.
- **FAIL**: none remaining — two real bugs (TypeScript module-augmentation breaking the whole test toolchain; the popover overlap/zoom-overflow layout bug) were found and fixed during this phase's own verification, not shipped.
- **BLOCKED**: none.
- **DEFERRED**: none — this phase has no live-external-system dependency.

## Regression

Backend: 303/303 (unaffected by this phase — no backend files changed). Frontend: 99/99 new (no pre-existing frontend test suite to regress beyond the 8 Playwright tests inherited from Phase A2b, which still pass unmodified in behavior, one comment updated to reflect the placeholder's replacement).

## Security check for this phase

- Sensitive values in responses: N/A this phase — the frontend only ever displays already-masked `protectedFields` from `EventDto`; nothing here requests or handles raw sensitive values from the backend.
- Sensitive values in logs: N/A — no server-side logging in this phase; the frontend itself never calls `console.log` with request/filter data.
- Sensitive values in URLs or localStorage: verified with real spies (`persistence.test.tsx`) — zero writes across a full interaction sequence including sensitive-field entry.
- No reveal action for masked values: N/A this phase — no masked value is ever displayed by Phase F's own UI (that's Phase G's results table); Advanced Filters' own inputs hold only the user's own typed search terms, never server-returned masked data.
- `dangerouslySetInnerHTML`: grep-verified zero occurrences anywhere in `frontend/src`.
- Capabilities honesty: the Live button is gated strictly by `capabilities.liveTail`, never assumed (`Toolbar.test.tsx`).

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 10, 37, 38, 39, 40, 41, 42, 44, 45, 46, 47, 87 → **Done**. Rows 43, 84 → **Partial** (Phase F's own share complete; Phase G owns the results-table half of row 43, Phases G–J still contribute their own share of row 84's accessibility work).

## Known gaps carried forward

- The real seven-column results table — Phase G's job; `ResultsPlaceholder` is explicitly temporary.
- Raw LogQL / DSL query UI wiring — not in this phase's stated scope; Phase E's backend capability exists unused by the UI.
- Live tail UI behavior beyond capability-gated visibility — Phase J's job.
