# Phase H — Event inspector — Verification Report

Branch: `phase/h-event-inspector`
Date: 2026-09-08

## Prerequisite

Phase G (results table correctness and truthful states) is merged (PR #9) — confirmed via `gh pr view 9` (`MERGED`) and a fresh `main` checkout with the full backend suite (303/303) and frontend suite (162/162) green before branching.

## Architecture

**Backend — `POST /api/v1/logs/context`, a new, distinct endpoint from `/logs/search`:**

- **`api/dto/ContextRequestDto.java`**: `sourceId`, `timestamp`, optional `service`/`containerId`/`pod`. No window-size field at all — the ±30s window is never client-supplied.
- **`api/RequestMapper#toContextDomain`**: builds the domain `SearchRequest` with `start = timestamp − 30s`, `end = timestamp + 30s` (a `static final Duration CONTEXT_WINDOW`), scoped by `services`/`containerId`/`pod` when present. Reuses the exact same `SearchService`/guardrail/masking pipeline as `/search` — same response shape (`SearchResponseDto`), same truncation/limit honesty.
- **`core/model/SearchRequest`**: extended with `containerId`/`pod` fields (domain-only — never exposed on the public `SearchRequestDto`, since no UI control in this phase's scope, or any prior phase's, produces them). **`core/search/EventFilters`**: extended to match on both.
- **`api/SearchController#context`**: the new endpoint, mirroring `#search`'s exact shape.

**Frontend — `features/inspector/**`:**

- **`EventInspector.tsx`**: the panel shell — right-side panel beside results ≥1024px width, a dismissable full-height sheet with backdrop ≤1024px (`EventInspector.module.css`'s one media query — a genuine viewport-width breakpoint switch, not the kind of zoom-vs-flex distinction Phase F/G's own bugs were about, so a plain `@media` query is the correct tool here). Renders nothing when nothing is selected.
- **`useResizablePanel.ts`**: width state clamped to `[320, 720]`px, both pointer-drag and keyboard (Arrow keys on the `role="separator"` resize handle, with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`) — kept in memory only, never persisted (this phase adds no `localStorage` carve-out).
- **`InspectorHeader.tsx`**: severity, service, a title derived from message/error code (`title.ts` — never a fabricated diagnosis), Previous/Next/Close.
- **`OverviewSection.tsx`**, **`ActorClientSection.tsx`**, **`RequestFlowSection.tsx`**, **`BusinessErrorSection.tsx`**, **`AllFieldsSection.tsx`**: the five HANDOVER.md §16.2–16.6 sections, each a thin renderer over pure field-builder functions in **`sections.ts`**/**`allFields.ts`** (independently unit-tested with full and sparse events).
- **`ContextAction.tsx`**: "Show ±30 seconds" — computes and displays the exact bounded window (and scope) *before* running anything, with an explicit Run/Cancel confirm step, matching HANDOVER §16.7's "display the bounded query/time range before execution."
- **`timestampFormat.ts`**: local (with ms + named zone) and UTC timestamp formatting, reused by Overview and the Context preview.
- **`shared/ui/FieldList.tsx`**: the one label/value rendering primitive every section shares.
- **`app/useSearchState.ts`** (extended): `selectedIndex`/`selectedEvent`/`hasPreviousEvent`/`hasNextEvent`, `openInspector`/`closeInspector`/`selectPreviousEvent`/`selectNextEvent` (with real DOM focus-restoration bookkeeping), and the two "detour" actions — `findRelated` (re-runs the current source's search via the existing `/search` endpoint, filtered to just one ID) and `showContext` (calls the new `/context` endpoint) — both snapshot the prior search state once and expose a `breadcrumbLabel` + `restoreOriginalSearch()` so the investigator can always get back.
- **`features/results/ActionsCell.tsx`**: "Inspect event" added as the menu's first item, always available (no longer disabled when an event has no copyable identifiers). **`ResultsTable.tsx`**: `selectedIndex`/`onInspect` props, a `.selectedRow` highlight (background + a non-color left-border cue) for "the selected row stays identifiable." **`ResultsPanel.tsx`**: a `Breadcrumb` bar shown above the results in every state when a detour is active.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase H":

1. **Right-side panel beside results on wide screens, sheet/overlay on narrow**: `EventInspector.module.css` media query at 1024px (see "A real bug found" below for why 1024, not 1023, is the correct boundary).
2. **Safe min/max resizing**: `useResizablePanel.ts`, `[320, 720]`px, both pointer and keyboard.
3. **Result list stays present**: the inspector is a sibling of `ResultsPanel` in a flex row (`App.tsx`/`App.module.css`), never a full-page replacement.
4. **Selected row stays identifiable**: `.selectedRow` background + left-border accent (never color alone).
5. **Previous/Next/Close**: `InspectorHeader.tsx`, bounded to the currently-loaded `events` array, disabled at the ends.
6. **Accessible focus handling**: focus moves to Close on open; Escape, the Close button, and (at narrow widths) the backdrop all close and restore focus to whatever opened the inspector; the resize handle is a real `role="separator"` with correct ARIA value attributes.
7. **Header**: severity, service, a message/error-code-derived title, never an invented diagnosis.
8. **Overview**: full message, local timestamp with ms + named zone, UTC, source, service, Compose project/container/namespace/pod/stream (when present), level, logger, thread, schema version.
9. **Actor & client**: masked username/customer ID/CIF/device ID/device IP/platform/language, labelled "Protected / masked", no reveal action anywhere, "when present" — an honest empty note when an event has none.
10. **Request flow**: journeyId/correlationId/traceId/spanId/eventId, each with Copy (non-sensitive only) and "Find related logs", plus the event-level "Show ±30 seconds" context action.
11. **Business/error**: business step, UI identifier, error code, a formatted (readable, multiline) exception.
12. **All fields**: a searchable key/value view, canonical fields first (raw-presence filtered — never a wall of `—` rows), unknown fields after (never discarded), raw JSON behind a `<details>` disclosure, text rendering only.
13. **Context**: exactly ±30 seconds (never client-adjustable), scoped to service/container/pod where possible, the bounded window displayed *before* execution, with a breadcrumb back to the original search.

## A scope boundary named explicitly: "Find related logs" vs. Phase I

`IMPLEMENTATION_PLAN.md`'s Phase H text lists "find-related-logs" as one of Request flow's three actions, but Phase I ("Trace / correlation / journey investigation") separately and explicitly owns "Click actions on non-sensitive IDs: Find this trace/correlation/journey/event" plus a full multi-trace timeline view (its own scope item 1). This phase's "Find related logs" is deliberately the honest, minimal reading: it re-runs the *existing* search engine (the same `/search` endpoint every other search in this app already uses) filtered to just the clicked ID, over the currently-committed time range, with a breadcrumb back — not a preview of Phase I's dedicated journey timeline, multi-trace assembly, or causality-ordering UI, none of which this phase implements. Named here per CLAUDE.md §5's instruction to name a conflict/overlap explicitly rather than silently pick a scope.

## A real bug found and fixed via this phase's own real-data verification

Exactly the CLAUDE.md §6 debugging sequence (reproduce → screenshot → network → DOM/computed layout → invariant → smallest fix → regression test → re-verify), found only because this phase's Playwright suite was the **first** spec in this project to actually click *into* `ActionsCell`'s popover menu in a real browser — Phase G's own E2E coverage only ever checked table geometry, never per-row interaction.

**Symptom.** Every test that opened the inspector via the row's "…" → "Inspect event" menu item timed out: Playwright reported `<td class="_idCell...">` intercepting the click, even though the menu item was "visible, enabled and stable" per its own bounding box.

**Diagnosis.** A small standalone script (`chromium.launch()` + `page.evaluate`) confirmed via `document.elementFromPoint()` at the menu item's own center coordinate that the pixel actually belonged to the sibling Correlation/Trace `<td>`, not the menu. Root cause: `ResultsTable.module.css`'s generic `.table th, .table td { overflow: hidden }` rule (needed elsewhere for the Service/User-Customer/Correlation-Trace columns' ellipsis truncation) also applies to the Actions `<td>` — and `ActionsCell`'s popover menu is `position: absolute` with its containing block *inside* that same `<td>`. The menu still visually *looked* correct (browsers render clipped content up to the clip edge without any visual seam), but every pixel of the menu beyond the 56px-wide Actions column belonged to the clipped-away part — a real click there hits whatever renders underneath instead. This is a latent bug that has existed since Phase G shipped the "…" menu; it was never exercised because Phase G's own component tests run against jsdom (which does not implement real CSS layout/clipping at all) and its own E2E suite never clicked into the menu.

**Fix.** Added `.table td.actionsCell { overflow: visible; }` (only the Actions column) and applied the class to that one `<td>`. A first attempt using a bare `.actionsCell { overflow: visible }` (no `.table td` prefix) silently lost the cascade to the more-specific generic rule — confirmed directly via `getComputedStyle` before and after, not assumed — so the final selector matches the generic rule's specificity exactly and wins on source order.

**Regression test.** Every test in `phase-h-event-inspector.spec.ts` that opens the inspector (13 of 16) now exercises this path on every run; a dedicated meta-check isn't separately needed since a regression here would immediately time out the whole suite again, exactly as it did before the fix.

## A design correction made during browser verification: the wide/narrow breakpoint

The overlay-vs-side-panel breakpoint was first written as `@media (max-width: 1023px)`, deliberately leaving 1024px in "side panel" mode. Real-browser verification at 1024px showed the side panel (capped `[320,720]`px, default 420px) and the results table (`min-width: 900px`) do not comfortably coexist at exactly 1024px — the table's visible/scrollable width drops to roughly 570px, well below its own minimum, forcing heavy horizontal scrolling. Since CLAUDE.md §7 explicitly requires the app to "remain usable at 1024", the breakpoint was corrected to `max-width: 1024px` (inclusive), putting 1024px into overlay mode instead, where the full 900px-plus table width is available and the sheet doesn't compete for the same horizontal space. Verified via the real-browser suite at all three narrow widths (1024/768/390) and all three wide widths (1920/1440/1280).

## A test-correctness fix (not a product bug): the results area's own horizontal scroll

The Phase G results table is deliberately wider than its scroll container (`min-width: 900px` inside a `.scrollWrapper` with `overflow-x: auto`) so it scrolls horizontally rather than pushing the page wider — this is correct, existing Phase G behavior. An early version of this phase's `assertNoOverlap(page, 'table', ...)` check compared the raw `<table>` element's *unclipped* bounding box (which legitimately extends past its scrollable container by design) against the inspector panel, and reported a false "overlap" at 1280px purely from that unclipped geometry, even though nothing actually paints in the overlapping region. Fixed by adding a `data-testid="results-scroll-wrapper"` to the actual clipped/visible container and comparing against that instead — the real, painted results area never overlaps the panel at any of the three wide widths tested.

## Automated tests

All commands below were actually run this session.

| Check | Command | Result | Notes |
|---|---|---|---|
| Backend suite | `./mvnw -q test` | **PASS** | 314/314 (was 303 at Phase G's completion — 11 new tests this phase: `RequestMapperTest` (5), `EventFiltersTest` containerId/pod (1), `ContextApiIntegrationTest` (5)). |
| Frontend suite | `npx vitest run` | **PASS** | 230/230 tests, 35 test files (was 162 at Phase G's completion). |
| Typecheck | `npm run typecheck` | PASS | Clean. |
| Production build | `npm run build` | PASS | 235 KB JS / 21.3 KB CSS (gzipped 72.5 KB / 4.0 KB). |
| `useSearchState` (inspector selection, breadcrumb, detours) | `useSearchState.test.ts` (+9 new) | PASS | Previous/Next bounds; a fresh `runSearch` clears selection + breadcrumb; `findRelated` clears other filters, hits `/search` with only the one ID, breadcrumb text, `restoreOriginalSearch` brings back the exact prior result set; `showContext` hits the dedicated `/context` endpoint (never `/search`), narrows `timeRange` to exactly 60s, no-ops for an event with no timestamp. |
| Focus restoration | `useSearchState.focusRestoration.test.tsx` | PASS | A real DOM harness proves `closeInspector` restores focus to whatever had it when `openInspector` was called (WCAG 2.2 AA). |
| Section field builders | `sections.test.ts`, `allFields.test.ts`, `timestampFormat.test.ts`, `title.test.ts` | PASS | Full-event and sparse-event cases for every section; masked-value assertions (Actor & client always shows `*`-masked values, never raw); "never a sensitive field as a request-flow identifier"; canonical-field presence uses the raw underlying value, not the display placeholder (a real bug caught mid-implementation — see below); search/filter logic. |
| Section components | `OverviewSection`/`ActorClientSection.test.tsx`/`RequestFlowSection.test.tsx`/`BusinessErrorSection`/`AllFieldsSection.test.tsx`/`ContextAction.test.tsx`/`EventInspector.test.tsx` (incl. jest-axe throughout) | PASS | Copy-action tests assert only journey/correlation/trace/span/event ever render (never cif/userName/customerId/deviceId/deviceIp); "no reveal action" assertion; raw JSON rendered as a single `<pre>` text node (`pre.children.length === 0`); Context preview shows the exact bounded window before `onConfirm` fires; keyboard open/close/Previous/Next/focus-into-panel; resize-handle keyboard nudge; 0 a11y violations throughout. |
| Row wiring (regression) | `ActionsCell.test.tsx`, `ResultsPanel.test.tsx`, `Toolbar.test.tsx` | PASS | `ActionsCell` updated for the always-available "Inspect event" item (no longer disabled with zero identifiers); `SearchState` fixtures extended for the new fields across all three files. |
| No `dangerouslySetInnerHTML` anywhere | `noDangerousHtml.test.ts` | PASS | A repo-wide scan via `import.meta.glob` (no Node `fs` — `src/` is deliberately browser-only, excluded from Node types by `tsconfig.app.json`) for real `dangerouslySetInnerHTML=` usage across every `.ts`/`.tsx` file, substituting for "lint rule" since this project has no ESLint configured at all (`package.json` has no `eslint` dependency, no config file — a Phase A-audited baseline, not something to introduce as a side effect of this phase). Zero real usages found (an earlier, too-naive substring match falsely flagged files that merely *mention* the rule by name in comments — fixed to match actual JSX attribute usage). |
| Backend: context bounds | `RequestMapperTest` (5) | PASS | Exactly ±30s regardless of input; service→single-element list, blank/missing service→no filter; containerId/pod pass through; sourceId passes through. |
| Backend: containerId/pod filtering | `EventFiltersTest` (+1) | PASS | Matches/rejects on both fields. |
| Backend: real HTTP `/context` | `ContextApiIntegrationTest` (5) | PASS | Through the real controller/`RequestMapper`/`SearchService` (a `StubLogSource` with a captured `lastRequest`, mirroring `QueryApiIntegrationTest`'s own pattern): exact ±30s window + service scoping reach the domain request; containerId/pod reach it; missing `sourceId`/`timestamp` → 400; unknown source → 404. |

## Browser checks (the gate)

Per the plan: *"Inspector at 1920/1280/768/390; resize bounds; no page overflow; focus visible."*

1. Booted the real packaged backend (`dev` profile) and the real frontend dev server, both real processes.
2. Wrote `e2e/phase-h-event-inspector.spec.ts` (16 tests, real backend required — every test drives an actual search against the `fixture` source's real deterministic corpus, then opens the real inspector on a real, fully-populated fixture event): every section renders with real data; masked fields visibly `*`-masked; the selected row is visually distinguishable (`getComputedStyle` background comparison); Previous/Next move and disable at the bounds, Escape closes and restores focus to the row's own "…" trigger; "Show ±30 seconds" previews the exact bounds then replaces results with a working breadcrumb back; "Find related logs" narrows to one ID with a working breadcrumb back; "Inspect event" is never disabled; side-panel-vs-overlay + no page overflow at all six required widths (1920/1440/1280/1024/768/390, beyond the plan's stated four); no page overflow at 125%/200% zoom; the resize handle stays within its documented `[320,720]`px bounds via keyboard.
3. First run: 1/16 passed — the Actions-menu clipping bug above blocked every test that opened the inspector. Fixed; re-run: 15/16. Second failure round (3 tests): the 1280px "overlap" false-positive and the pre-correction 1024px/390px breakdrop-dismissal expectations, both explained and fixed above. Final run: **16/16 pass**.
4. Re-ran the **full** Playwright suite (all specs, not just this phase's own) for cross-phase regression: **44/44 pass** (Phase F: 11, Phase G: 9, Phase H: 16, geometry meta-tests: 5, smoke: 3).
5. Screenshots committed: `docs/verification/h/inspector-{1920,1440,1280,1024,768,390}px.png`, `inspector-open-1280px.png`, `inspector-zoom-{125,200}pct.png`. Visually confirmed: all five sections render with real, fully-populated fixture data (every fixture event has every ID and every protected field set); masked values show the real `xx***xx`/`****`/IP-partial patterns `MaskingService` actually produces; the selected row is highlighted; the panel sits cleanly beside the table at every wide width with no overlap.
6. Cleaned up: killed the backend and frontend dev-server processes, removed scratch diagnostic scripts (`debug-menu.mjs`, `debug-layout.mjs`, `debug-backdrop.mjs` — used only to pinpoint the clipping/breakpoint bugs above, never committed).

## Results

- **PASS**: all 13 Phase H scope items; every plan bullet demonstrably satisfied with real browser evidence at every required viewport and zoom level, screenshots committed; 230/230 frontend tests + 314/314 backend tests + 44/44 Playwright tests (all specs), all green.
- **FAIL**: none remaining — one real, previously-latent cross-phase bug (the Actions-menu clipping bug, dormant since Phase G) and two design/test corrections (the 1024px breakpoint; the `assertNoOverlap` selector) were found and fixed during this phase's own verification, not shipped.
- **BLOCKED**: none.
- **DEFERRED**: none — no live-external-system dependency; Phase I's click-to-investigate/timeline UI is explicitly named as a separate phase's scope above, not a deferral of this phase's own work.

## Regression

Backend: 314/314 (was 303 at Phase G's completion — 11 new tests this phase, zero pre-existing tests weakened). Frontend: 230/230 (was 162 — 68 new tests this phase). Playwright: 44/44 across every spec (was 28 at Phase G's completion — 16 new this phase, zero regressions in Phases F/G despite touching a shared file, `ResultsTable.tsx`/`.module.css`, and `ActionsCell.tsx`, both from Phase G).

## Security check for this phase

- **Masked values only, everywhere.** The inspector's Actor & client section, and the "All fields"/raw-JSON views, are built entirely from the already-masked `LogEvent`/`EventDto` the backend returns — `protectedFields` is the only sensitive-field carrier this type has, so there is no raw value anywhere in the frontend for any inspector surface (including `JSON.stringify(event)`) to leak.
- **No reveal action anywhere** — confirmed by an explicit test (`ActorClientSection.test.tsx`) asserting no reveal/unmask/show-raw-shaped control exists, in addition to there being no such affordance in the component at all.
- **No `dangerouslySetInnerHTML`** — the exception block and the raw-JSON disclosure both use `{...}` text interpolation into a `<pre>`, proven by a dedicated repo-wide test plus a component-level assertion that the `<pre>`'s only children are text nodes.
- **The `/context` endpoint's window is server-enforced, never client-widened** — `ContextRequestDto` has no start/end/window field at all; `RequestMapper#toContextDomain` always computes exactly ±30s from the event's own timestamp, proven by `RequestMapperTest`/`ContextApiIntegrationTest` inspecting the actual domain `SearchRequest` that reaches the source.
- **Nothing new written to `localStorage`/`sessionStorage`/the URL** — the resizable panel's width is kept in React state only (`useResizablePanel.ts`), not persisted; this phase adds no new persistence surface. (No dedicated new persistence test was added this phase — Phase F's `persistence.test.tsx` already proves the app-wide invariant and this phase introduces no new storage API call anywhere to regress it.)
- **"Find related logs"/"Show ±30 seconds" never construct a click-search action from a sensitive field** — `buildRequestFlowIdentifiers` (the only source of "Find related logs" targets) is structurally limited to journeyId/correlationId/traceId/spanId/eventId; there is no code path from `protectedFields` into either action.

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 62–68 → **Done**. Row 21 → **Done** (was `Partial`; this phase's own share — the inspector's text-only rendering — is now covered by the repo-wide scan test).

## Known gaps carried forward

- "Find related logs" is deliberately the minimal, existing-search-engine version described above — Phase I owns the full click-to-investigate timeline, multi-trace assembly, and causality-ordering UI.
- The resizable panel's width is not persisted across page loads (kept in memory only) — consistent with this project's "nothing in `localStorage` yet" posture; CLAUDE.md §2 rule 4 would *allow* a non-sensitive UI preference like this in `localStorage`, but adding it wasn't necessary for any stated Phase H scope item and would have required extending Phase F's zero-persistence proof, so it was left as an explicit, deliberate boundary rather than silently added.
- Backend `containerId`/`pod` filtering exists only for the `/context` endpoint's own internal use — there is still no general-search UI filter for either, matching every prior phase's scope (no plan item has ever asked for one).
