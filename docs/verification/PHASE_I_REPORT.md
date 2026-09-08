# Phase I — Trace / correlation / journey investigation — Verification Report

Branch: `phase/i-journey-investigation`
Date: 2026-09-08

## Prerequisite

Phase H (event inspector) is merged (PR #10) — confirmed via `gh pr view 10` (`MERGED`) and a fresh `main` checkout with the full backend suite (314/314) and frontend suite (230/230) green before branching.

## Architecture

**Backend — `POST /api/v1/logs/journey`, a new, distinct endpoint:**

- **`api/dto/JourneyRequestDto.java`**: `sourceId`, `start`, `end`, `field`, `value`. `start`/`end` are always the caller's own currently-committed search window — this endpoint never invents or widens a "bounded time window" of its own.
- **`api/RequestMapper#toJourneyDomain`**: validates `field` against a closed set (`journeyId`/`correlationId`/`traceId`/`eventId` — never `spanId`, never a sensitive field) and maps it to exactly one `SearchRequest` filter. A `field` outside that set throws `GuardrailViolationException(INVALID_JOURNEY_FIELD)` → HTTP 400. This is the same "never a raw customer-identifier click-search" guarantee CLAUDE.md §2 rule 1 states in words, enforced architecturally: there is no legal value of `field` that could reach a sensitive filter.
- **`api/SearchController#journey`**: reuses `SearchService`'s exact guardrail/masking pipeline, then explicitly sorts the result **ascending by timestamp** (`Comparator.nullsLast(Comparator.naturalOrder())`, malformed/no-timestamp events last, never dropped) before mapping to `EventDto`. This sort is necessary and new: **no `LogSource` this project has honors ascending order today** — `FixtureLogSource`/`DockerLogSource` both always sort newest-first regardless of `SearchRequest#direction()` (confirmed by reading their `search()` implementations directly, not assumed), and only `LokiLogSource` honors `direction` at all. Enforcing ascending order once, centrally, in this endpoint is the only way to make "ascending order for flow" (HANDOVER.md §17) actually true for every source.

**Frontend — `features/journey/**`:**

- **`JourneyView.tsx`**: the timeline, rendered in place of `ResultsPanel` (see `App.tsx`) whenever `state.journeyQuery` is set. Header ("← Back to search results" + "{Field}: {value}"), a real-count summary line ("N events across M services[, K traces]"), a persistent causality disclaimer, and the ascending entry list.
- **`JourneyEntryRow.tsx`**: one entry — timestamp, service (color-coded via **`serviceColor.ts`**'s deterministic name→color hash, plus the service name always printed as text — never color alone), level, business step, message, and trace/span/correlation/event metadata "when available."
- **`journeyFields.ts`**: `JOURNEY_FIELD_LABELS` (the closed four-field set, mirrored from the backend's own), `countDistinctTraces`/`countDistinctServices`.
- **`app/useSearchState.ts`** (extended): `journeyQuery`/`journeyResult`/`journeyLoading`/`journeyError`, `openJourney(field, value)`, `closeJourney()`. Deliberately **not** built on Phase H's snapshot/restore machinery — journey mode never mutates `searchResult` or any toolbar filter at all, so "preserves and restores the original search state" (HANDOVER.md §17.5) holds by construction, not by remembering-and-undoing.
- **`ResultsTable.tsx`**: the Correlation/Trace cell's own ID is now a click action too (`onOpenJourney` prop) — HANDOVER.md §17 calls these "supported click actions on non-sensitive IDs" without scoping them to the inspector only.
- **`RequestFlowSection.tsx`** (Phase H file, revised): "Find related logs" → "Find this {Journey/Correlation/Trace/Event} ID" for exactly those four fields (never spanId, which has no such action in the plan's own scope) — see "A scope decision" below.

## A scope decision named explicitly: replacing Phase H's "Find related logs"

`IMPLEMENTATION_PLAN.md`'s Phase H text listed "find-related-logs" as one of Request Flow's actions, built there as a lightweight re-filter of the flat results table. Phase I's own scope item 1 is more specific — "Click actions on non-sensitive IDs: Find this trace / correlation / journey / event" — naming exactly four fields (never span) and describing the richer, dedicated journey timeline this phase builds. Per CLAUDE.md §5 ("when an older requirement conflicts with a later decision, name the conflict explicitly and apply the later decision"): this phase **replaces** Phase H's "Find related logs" button with the four "Find this X" actions, which open the journey timeline instead of re-filtering the table. This is a strict upgrade (the timeline is a superset of what the flat re-filtered table showed — ascending order, service distinction, business step, causality disclaimer), not a regression, and having both a generic "Find related logs" and four specific "Find this X" buttons side by side would have been redundant, cluttered UI contrary to CLAUDE.md §7's "calm, precise" design direction.

Concretely: `useSearchState.ts#findRelated` was deleted (superseded by `openJourney`); `RequestFlowSection.tsx`'s "Find related logs" button was replaced with "Find this X" for the four fields Phase I's scope names (spanId keeps Copy only, per the plan's own click-action list). Every Phase H test that referenced the old behavior was updated to match (`useSearchState.test.ts`, `RequestFlowSection.test.tsx`, `EventInspector.test.tsx`'s fixtures) — not weakened or deleted to hide the change, per CLAUDE.md §3. `phase-h-event-inspector.spec.ts`'s own "Find related logs" browser test was replaced with a comment pointing to this report and to `phase-i-journey-investigation.spec.ts`'s equivalent, real coverage.

## A real bug found and fixed via this phase's own real-data verification

The exact same **class** of bug Phase H found (see its own report), a new **instance** of it, found the same way: real-browser clicking, not assumed from code review.

**Symptom.** Every Playwright test that clicked the Correlation/Trace cell's new ID button timed out identically to Phase H's original bug: `<td class="_idCell...">` intercepted the click, even though the button was reported "visible, enabled and stable."

**Diagnosis.** `ResultsTable.module.css`'s `.idCell` legitimately needs `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` for its own truncation (real backend IDs are unbounded-length text). The new clickable `<button>` was placed as a *sibling* to the label `<span>` inside that cell — an inline atomic box whose own natural width could exceed the space left after the label, and whose `getBoundingClientRect()` (used for Playwright's own click-target-center computation, and identical to how a real assistive-technology or automation tool would compute a click point) reflects its *unclipped* size, not the space the ancestor `.idCell` actually lets it paint into. A click at that computed center could land past the ellipsis-visible boundary, hitting the `<td>` underneath instead.

**Fix.** Restructured so the *entire* cell content (label + value) is one `<button>` when `onOpenJourney` is provided, and gave that button its **own** `width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` (`.idLinkCell` in `ResultsTable.module.css`) — its clickable bounding box now exactly equals its own visibly-clipped box, since the element clips itself rather than relying on an ancestor to do it invisibly. Confirmed directly (not assumed) via a temporary Playwright debug script comparing `document.elementFromPoint()` at the button's own center before and after the fix.

**Regression test.** Every browser test in `phase-i-journey-investigation.spec.ts` that clicks a Correlation/Trace ID (5 of 13) now exercises this path on every run — a regression here fails the whole suite immediately, exactly as it did before the fix. `ResultsTable.test.tsx` also gained two focused unit tests (button absent without `onOpenJourney`; click fires with the right field/value) — jsdom doesn't reproduce the clipping bug itself (it has no real layout engine), so these are necessary but not sufficient on their own; the Playwright coverage is what actually proves the fix.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase I":

1. **Click actions on non-sensitive IDs**: "Find this trace/correlation/journey/event" from both the inspector's Request Flow section and the results table's own Correlation/Trace column. Never a raw customer-identifier click-search — architecturally impossible on the backend (`toJourneyDomain`'s closed field set) and structurally impossible on the frontend (`JourneyField`/`JOURNEY_CLICKABLE_FIELDS` are typed to exactly those four; `buildRequestFlowIdentifiers` never surfaces a sensitive field in the first place).
2. **Timeline**: same active source only (the request always carries the currently-selected `sourceId`); bounded time window (the caller's own currently-committed range, never invented or widened); ascending order (enforced server-side, proven against real out-of-order fixture data); services visually distinguished (deterministic per-service color, always paired with the printed name); each entry shows timestamp, service, level, business step, message, trace/span, and correlation/event metadata when available.
3. **Multiple traces within one journey**: never filtered to one trace — a real fixture journey (`fixture-journey-0001` in this session's corpus) legitimately spans 6 traces across 3 services; the summary line states the real count.
4. **Causality disclaimer**: a persistent `role="note"` banner, present whenever the timeline has any entries, never omitted.
5. **Preserves and restores original search state; handles missing identifier and no-results cleanly**: by construction (journey mode never mutates the underlying search state — see "Architecture" above); a zero-result lookup renders an honest, specific empty-state message, never a blank panel or a fabricated error.

## Automated tests

All commands below were actually run this session.

| Check | Command | Result | Notes |
|---|---|---|---|
| Backend suite | `./mvnw -q test` | **PASS** | 326/326 (was 314 at Phase H's completion — 12 new tests: `RequestMapperTest` (+6), `JourneyApiIntegrationTest` (6)). |
| Frontend suite | `npx vitest run` | **PASS** | 256/256 tests, 39 test files (was 234 immediately after the refactor, 230 at Phase H's completion). |
| Typecheck | `npm run typecheck` | PASS | Clean. |
| Production build | `npm run build` | PASS | 239 KB JS / 23.9 KB CSS (gzipped 73.6 KB / 4.4 KB). |
| Backend: journey field mapping | `RequestMapperTest` (+6) | PASS | Each of the 4 fields maps to exactly one filter (never leaking into another); sourceId/time-range pass through unchanged; every sensitive field name (plus a bogus one) is rejected with `INVALID_JOURNEY_FIELD`. |
| Backend: real HTTP `/journey` | `JourneyApiIntegrationTest` (6) | PASS | Real out-of-order + malformed stub data comes back **ascending, malformed last, never dropped**; all 4 fields route correctly; a sensitive/unknown field → 400; missing required fields → 400; unknown source → 404; a genuinely empty source → `events: []`, not an error. |
| Frontend: journey state | `useSearchState.test.ts` (+4 net) | PASS | `openJourney` hits `/journey` (never `/search`) with only the given field/value over the *current* time range; never touches `searchResult`/`timeRange`; closes the inspector first; a fresh `runSearch` closes journey mode; empty value is a no-op. |
| Frontend: service color | `serviceColor.test.ts` | PASS | Deterministic; distinguishes real service names; never throws on `null`; returns a real CSS color. |
| Frontend: journey field helpers | `journeyFields.test.ts` | PASS | Multi-trace counting; the four-field closed set contains no sensitive field. |
| Frontend: entry rendering | `JourneyEntryRow.test.tsx` | PASS | Full/sparse/malformed events; every documented field renders; never a sensitive field anywhere in the entry. |
| Frontend: timeline view | `JourneyView.test.tsx` (incl. jest-axe) | PASS | Loading/error/empty states; causality disclaimer always present with results; multi-trace summary; Back button; 0 a11y violations. |
| Frontend: click wiring (regression + new) | `ResultsTable.test.tsx`, `RequestFlowSection.test.tsx`, `columnMapping.test.ts` | PASS | Correlation/Trace cell click → `onOpenJourney(field, value)`; "Find this X" buttons present for exactly the 4 non-span fields; never a sensitive-field action anywhere. |
| Row wiring (regression) | `EventInspector.test.tsx`, `ResultsPanel.test.tsx`, `Toolbar.test.tsx` | PASS | `SearchState` fixtures extended for the new journey fields; `findRelated` references removed. |

## Browser checks (the gate)

Per the plan: *"Against the demo stack: paste a journey ID, confirm cross-service sequence, gaps, business steps, and errors are legible."* (No demo/OpenShift stack is reachable in this environment — see "Deferred" below; the real `fixture` source's real, deterministic, cross-service, multi-trace corpus is this session's honest equivalent, exactly as every prior phase's browser verification has used it.)

1. Booted the real packaged backend (`dev` profile) and the real frontend dev server, both real processes.
2. Wrote `e2e/phase-i-journey-investigation.spec.ts` (13 tests, real backend required): clicking a real Trace ID opens the timeline with real, cross-service entries; "Find this Journey ID" from the inspector opens a real multi-trace (6 traces, 3 services, verified against a journey the live corpus was first queried to confirm has ≥2 events, since real journey sizes vary and are not fixed) ascending timeline; "Back to search results" restores the exact original table; a genuinely non-existent ID gets a real empty response from the live backend (not a UI-reachable scenario — there is no free-text "paste any ID" control in this project, so this is checked at the same real HTTP layer the app itself uses); no page overflow at all six required widths plus 125%/200% zoom; never a raw sensitive value anywhere in the rendered timeline.
3. First run: 1/16 tests in the *combined* suite passed — the `.idCell` click-clipping bug above blocked every test that clicked an ID. Fixed; re-run surfaced two test-authoring bugs of my own (a singular/plural regex mismatch against real "1 event" vs "N events" copy; an out-of-range journey-ID-guessing loop that never found a real multi-event journey) — both fixed, not the product. Final run: **13/13 pass**.
4. Re-ran the **full** Playwright suite (all specs) for cross-phase regression: **56/56 pass** (Phase F: 11, Phase G: 9, Phase H: 15 — one test replaced by a comment, see "A scope decision" above, not silently dropped — Phase I: 13, geometry meta-tests: 5, smoke: 3).
5. Screenshots committed: `docs/verification/i/journey-trace-view-1280px.png`, `journey-view-open-1280px.png`, `journey-view-{1920,1440,1280,1024,768,390}px.png`, `journey-view-zoom-{125,200}pct.png`. Visually confirmed: a real 6-event, 3-service, 6-trace journey (`fixture-journey-0001` in this session's corpus) rendered ascending, with distinct per-service colors, the causality disclaimer, business-step badges, and full trace/span/correlation/event metadata per entry — legible cross-service sequencing exactly as the plan's manual-check language describes.
6. Cleaned up: killed the backend and frontend dev-server processes, confirmed nothing left running, removed scratch diagnostic scripts (never committed).

## Results

- **PASS**: all 5 Phase I scope items; every plan bullet demonstrably satisfied with real browser evidence at every required viewport and zoom level, screenshots committed; 256/256 frontend tests + 326/326 backend tests + 56/56 Playwright tests (all specs), all green.
- **FAIL**: none remaining — one real, previously-latent bug (the `.idCell` click-clipping bug, same class as Phase H's, a new instance) and two test-authoring bugs (regex, ID-guessing range) were found and fixed during this phase's own verification, not shipped.
- **BLOCKED**: none for this phase's own scope.
- **DEFERRED**: the plan's "Manual checks... Against the demo stack" (a live OpenShift/Loki demo environment) — no such environment is reachable in this session, consistent with every prior phase's own documented boundary (e.g. Phase D's Loki TLS tests ran against a local self-signed cert, never a live cluster). The real `fixture` source's deterministic, genuinely cross-service/multi-trace corpus is used throughout instead, and is real backend + real frontend + real HTTP, not a static mimic.

## Regression

Backend: 326/326 (was 314 at Phase H's completion — 12 new tests this phase, zero pre-existing tests weakened). Frontend: 256/256 (was 230 — 26 net new tests this phase: several new files, minus 2 Phase H tests deliberately replaced per the scope decision above, all changes explained, none silently weakened). Playwright: 56/56 across every spec (was 44 at Phase H's completion — 13 new this phase, 1 test replaced with a documented comment, zero unexplained regressions in Phases F/G/H despite touching two of their files, `ResultsTable.tsx`/`.module.css` and `RequestFlowSection.tsx`).

## Security check for this phase

- **Never a raw customer-identifier click-search — enforced architecturally, twice.** Backend: `JourneyRequestDto#field` is checked against a closed 4-value set in `RequestMapper#toJourneyDomain`; anything else, including all five sensitive field names, is rejected with HTTP 400 before it can reach a `LogSource` (`RequestMapperTest` proves this for every sensitive field name plus a bogus one). Frontend: `JourneyField`/`JOURNEY_CLICKABLE_FIELDS` are typed to exactly those four values; `buildRequestFlowIdentifiers` (the only source of "Find this X" targets in the inspector) never includes a sensitive field to begin with, and `resolveCorrelationOrTrace` (the results-table click source) only ever returns `traceId`/`correlationId`.
- **Masked values stay masked, everywhere in the new UI.** `JourneyEntryRow` renders only `service`/`severity`/`businessStep`/`message`/`traceId`/`spanId`/`correlationId`/`eventId` — none of `LogEvent`'s sensitive-field carrier (`protectedFields`). Verified by a real-browser check scanning the entire rendered timeline for the five sensitive field names, and a component-level equivalent.
- **`dangerouslySetInnerHTML`**: this phase's new `noDangerousHtml.test.ts` (Phase H) scan still passes over every new file — no new occurrence introduced.
- **Nothing new written to `localStorage`/`sessionStorage`/the URL**: journey state lives in `useSearchState` React state only; this phase adds no new persistence surface.
- **Bounded, never client-widened**: the journey endpoint's time window is always the caller's own already-guardrail-validated committed range — this phase introduces no new unbounded query surface.

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 69–74 → **Done**.

## Known gaps carried forward

- The plan's own "Manual checks... against the demo stack" is deferred — no live OpenShift/Loki demo environment is reachable in this session (see "Deferred" above).
- Journey entries do not themselves offer further click-to-investigate actions (e.g., clicking a trace ID *within* the timeline to start a new, narrower lookup) — not required by the plan's literal scope, and left as a deliberate boundary rather than speculative scope creep.
- The results table's User/Customer column remains non-interactive (only Correlation/Trace gained a click action) — correct per HANDOVER.md §17, which explicitly limits click actions to non-sensitive IDs only; User/Customer is always a masked sensitive value.
