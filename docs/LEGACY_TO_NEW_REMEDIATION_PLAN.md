# Legacy-to-New Remediation Plan

Source: `docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md`. This groups every `NEW_MISSING` /
`NEW_CHANGED_WORSE` / `REIMPLEMENT_BETTER` / `MERGE_WITH_NEW` row into coherent implementation
slices by architecture and investigation workflow — never one phase per feature. Each slice
targets NEW's own architecture (feature-folder frontend, WebFlux reactive backend, source-adapter
abstraction, single masking boundary); none of them propose porting OLD's implementation.

**Status: PLAN ONLY. No code in this document has been written. Per the mission scope, this plan
requires owner and reviewer approval before any slice is implemented.**

Decision precedence used throughout (per the mission's own ordering): security/privacy →
latest owner decisions → `HANDOVER.md`/`CLAUDE.md` approved requirements → valuable OLD product
intent → current NEW implementation → implementation convenience.

---

## Owner decisions required before two slices can be scoped

These are not implementation questions — they are product-policy questions the plan cannot
resolve on its own. Everything else in this document can proceed independently.

**OD-1 — Results table configurability (blocks Slice 4).**
`CLAUDE.md` §4 currently mandates "exactly seven columns, in order" with no reorder/density/
show-hide. OLD offered a 13-column model (7 required + 6 optional) with drag/keyboard reorder,
density, and persisted table prefs, and power users relied on it (`AUDIT-05`). Two honest paths:
  - (a) Keep the fixed-7 rule exactly as written — in which case TABLE-02/03/04/10 in the matrix
    are `SUPERSEDED_BY_OWNER_DECISION`, not gaps, and Slice 4 is dropped entirely.
  - (b) Amend the rule to "seven columns visible by default, in this order, with an optional
    show/hide/reorder/density control that never changes the default view" — which preserves the
    owner's original intent (a predictable base view) while restoring the optional-column power
    OLD had. Slice 4 below is scoped for this path.
  This plan does **not** pick a side; Slice 4 is written assuming (b) is approved, and should be
  deleted from the backlog if (a) is reaffirmed instead.

**OD-2 — Live-tail pre-start confirmation (affects Slice 5, low stakes).**
OLD required a confirmation dialog before starting live tail (source/services/severity +
disclosure). NEW starts immediately on click. This may be a deliberate, acceptable simplification
(one fewer click, the disclaimer is still shown persistently once live). Slice 5 includes it as an
optional item; confirm whether it should be built or the matrix row (LIVE-01) reclassified as
`SUPERSEDED_BY_OWNER_DECISION`.

Everything below is independent of OD-1/OD-2 except where explicitly noted.

---

## Slice 1 — Result-set completeness (pagination, statistics, refresh)

**GOAL:** A user must be able to see every event a search actually matched, know honestly how
many exist, and re-run the same search without re-entering filters. Today a search silently caps
at `limit` (default 200) with no way to see more — this is the single highest-priority regression
in the whole reconciliation (matrix row `TABLE-08`, P0).

**OLD CAPABILITIES INCLUDED:** TABLE-08 (load more/pagination), SEARCH-11 (search
statistics/estimate), SEARCH-16 (refresh).

**CURRENT NEW STATE:**
- `SearchResult`/`SearchResponseDto` carry a `nextCursor` field and `ResultsPanel.tsx` already
  renders a "Load more" button conditioned on it — but no source adapter (`DockerLogSource`,
  `LokiLogSource`, `FixtureLogSource`) ever populates `nextCursor` with a non-null value, so the
  button never appears. A user cannot see more than the first page of any result set today.
- `ResultCounts{estimatedTotal, returned, visible, limit, truncated}` exists and is rendered
  (`counts.ts#buildCountsSummary`), but `estimatedTotal` is never populated distinctly from
  `returned` by any adapter — so "how many matched in total" is never actually shown, only "how
  many came back".
- No Refresh control exists; re-running requires manually re-clicking Search with identical state
  already in the form (the state itself is preserved correctly, so this is a missing single
  button, not a missing capability).

**TARGET BEHAVIOR:**
- Docker and Fixture sources (which read a bounded, already-materialized set of lines) return a
  real cursor (event id + timestamp tuple, or an offset token) whenever more matching events exist
  beyond `limit`; clicking "Load more" fetches the next page and appends it to the visible table
  without losing scroll position or selection.
  Loki, which streams from a LogQL range query, computes `nextCursor` from the oldest returned
  timestamp when the page was truncated by `limit` (standard Loki backward-pagination pattern:
  next page's `end` = this page's oldest event timestamp).
- `estimatedTotal` is populated where it can be known cheaply and honestly:
  - Docker/Fixture: exact count of matching events within the scanned window (already computed
    to decide truncation — expose it instead of discarding it).
  - Loki: Loki does not report a total-match count for range queries without a second query; do
    **not** fake a total. Leave `estimatedTotal` null for Loki and have the UI render "200+ shown,
    exact total unknown for this source" rather than a false number — this is more honest than
    OLD's own Loki behavior, not merely equal to it.
- A Refresh button re-issues the exact last request (reusing the existing `AbortController`
  supersession path already built for Cancel-on-rerun), positioned next to Run Search.

**BACKEND CHANGES:**
- Extend `LogSource#search` contract (or add a paging companion method) so each adapter can return
  a cursor token alongside `SearchResult`. Keep the token opaque to the frontend (encode
  source-specific fields, e.g. base64 of `{lastTimestamp, lastEventId}`), never a raw Loki/Docker
  query fragment, so nothing implementation-specific leaks across the API boundary.
  New backend package: keep this inside `core/search/` (where `EventFilters` already lives), not
  inside individual adapters — a shared `PageCursor` codec used by all three sources.
- Docker/Fixture: compute the true in-window count while filtering (a single pass already
  happens); return it as `estimatedTotal` alongside the existing `truncated` flag.
- Loki: derive `nextCursor` from `LogQlDslPlanner`'s already-resolved time window; explicitly leave
  `estimatedTotal` null with a `estimatedTotalKnown=false` flag (add this boolean to
  `SearchResponseDto` — do not overload null to mean two different things: "not computed" vs
  "computed as zero").
- `SearchController#search` accepts an optional `cursor` request param, validated and decoded
  through the same `PageCursor` codec (reject a malformed/foreign cursor with a 400 `ProblemDetail`
  — never trust an opaque token blindly, since a hostile cursor is attacker-controlled input).

**FRONTEND CHANGES:**
- `useSearchState.ts#loadMore`: already has an early-return guard; once cursor is real, wire it to
  append the new page's events to `searchResult.events` (dedupe by event id — a defensive measure
  against Loki's boundary overlap) rather than replacing the array, matching the mission's
  low-click/never-lose-context target.
  Amounts to some 40-Class of frontend work – not simple ext point.
- `counts.ts#buildCountsSummary`: render "Total unknown for this source" instead of a number when
  `estimatedTotalKnown=false`, rather than silently showing `returned` as if it were the total
  (this is the honesty fix — OLD's own Loki path had the same limitation and didn't fake a number
  either, per `AUDIT-04` §7).
- New `RefreshButton` in `Toolbar.tsx`, calling the existing `runSearch` action with the current
  committed filter state (no new state needed — the filters are already the single source of
  truth).

**SECURITY CONSTRAINTS:** Cursor tokens must never encode raw sensitive-field values (they encode
timestamp/event-id/source-scoped position only — verified by extending `SerializationLeakTest` to
assert a decoded cursor contains no sensitive-field key). Malformed cursors must fail closed (400,
never a silent full-table scan).

**TESTS:** `PageCursorTest` (encode/decode round-trip, tamper rejection), per-adapter
`*LogSourceTest#loadMoreReturnsNextPage` (Docker, Fixture, Loki), `SearchApiIntegrationTest#loadMoreAppendsWithoutDuplicates`,
`useSearchState.test.ts#loadMoreAppendsAndDedupes`, `counts.test.ts#unknownTotalRendersHonestly`.

**BROWSER/UX VERIFICATION:** Real Docker/Fixture/mock-Loki search that legitimately exceeds 200
events, confirm "Load more" appears, clicking it grows the table, scroll position and any open
inspector selection survive, and repeat until the source is exhausted (button disappears). Confirm
Refresh preserves scroll-to-top-of-new-results behavior consistent with a fresh Run Search.

**REGRESSION GATES:** Existing `ResultsTable` geometry test (`phase-g-results-table.spec.ts`) must
still pass after page-append (no double-`<tr>`, no duplicated keys). Existing abort/supersession
tests (`useSearchState.test.ts`) must still pass — Refresh must go through the same abort path as
Run Search, not a parallel one.

**PASS CRITERIA:** A search that matches >200 events can be fully paged through in the browser
against real Docker data; `estimatedTotal` is either a real number or honestly "unknown"; Refresh
re-runs the exact same query with one click.

**FAIL CRITERIA:** Any duplicate or dropped row across a page boundary; any fabricated total shown
for Loki; a cursor that can be tampered with to widen the query.

**RECOVERY PLAN:** If Loki cursor derivation proves unreliable under real label cardinality (e.g.
duplicate timestamps at page boundary causing skipped events), fall back to Loki's native
`start`/`end` narrowing with a documented small overlap + client-side dedupe, and note the
approximation honestly in the UI rather than silently accepting drops.

**DEPENDENCIES:** None — this slice can start immediately and does not block or depend on any
other slice.

---

## Slice 2 — Query transparency & advanced query authoring

**GOAL:** Give investigators the same query power OLD had — a no-code guided builder, a raw
LogQL path that actually works end-to-end (unlike OLD's own dead one), and visibility into what
query NEW actually ran — without adding a second, competing query language to maintain.

**OLD CAPABILITIES INCLUDED:** SEARCH-06 (guided query builder), SEARCH-07 (text/simple-query
editor), SEARCH-10 (raw LogQL UI — note: NEW's *backend* gating for this is already
`NEW_CHANGED_BETTER` than OLD's dead path; only the UI is missing), SEARCH-12 (generated LogQL
display), SEARCH-13 (push-down vs post-filter reporting).

**CURRENT NEW STATE:**
- `core/query/QueryParser.java` implements a full AND/OR/parens DSL grammar, tested
  (`QueryParserTest`, 30 tests) and already wired into `SearchService` capability gating
  (`source.capabilities().rawLogQL()`), but **no frontend control of any kind** ever sends a DSL
  string or LogQL string to the backend. `AdvancedFilters.tsx` only ever produces structured
  field=value filters (`EventFilters`), never free-form query text.
  `QueryPlanExplainer.java` exists (renders redacted, human-readable plan strings) but is never
  attached to any response DTO.
  `LogQlSelectorBuilder`/`LogQlDslPlanner` compute push-down/post-filter separation internally but
  never expose it.

**TARGET BEHAVIOR:**
- A single "Query" affordance in the search toolbar with two explicit, source-capability-gated
  modes (never a mode shown for a source that can't support it, per `CLAUDE.md` §4 "Sources and
  capabilities"):
  1. **Guided mode** (all sources): a tree of AND/OR groups over the same field set
     `AdvancedFilters.tsx` already exposes, serializing to the existing backend DSL string (not a
     new grammar — reuse `QueryParser.java`'s grammar verbatim, since it already matches OLD's
     simple-query semantics per the matrix's SEARCH-07 finding).
  2. **Raw LogQL mode** (Loki only, capability-gated, off by default per config — matching
     `CLAUDE.md` §4's own explicit rule almost verbatim): a plain textarea, never a large
     always-visible control.
- Every search response includes (behind a `queryPlan` object, never inline in the main result
  shape so it stays optional/lightweight): the resolved query string, and — where computed — which
  conditions pushed down to the source vs. were applied as a post-filter. Rendered as a collapsed
  `<details>` disclosure exactly like OLD's own pattern (`AUDIT-04` §7), not surfaced by default.

**BACKEND CHANGES:**
- Add a `query` (free-text DSL string) field to `SearchRequestDto`, parsed via the existing
  `QueryParser`, translated to the same `EventFilters`/predicate model structured filters already
  use — one unified filter representation internally, never two parallel filter-evaluation paths.
- Wire `QueryPlanExplainer`'s output into `SearchResponseDto` as an optional `queryPlan` field
  (`resolvedQuery`, `pushDownConditions`, `postFilterConditions` — all pre-redacted strings, sensitive
  values already excluded by `QueryPlanExplainer`'s existing redaction, verified by
  `QueryLeakTest`).
- Raw LogQL: accept a `rawLogQl` string field, validated for source capability
  (`rawLogQL()==true`) before use; reject with 400 `ProblemDetail` for any other source (never
  silently ignore it — a rejected raw-LogQL request against Docker must fail loudly, matching
  `CLAUDE.md`'s "never show raw LogQL... for a source that cannot support it").

**FRONTEND CHANGES:**
- New `frontend/src/features/search/QueryBuilder.tsx` (guided tree editor: AND/OR groups, add/
  remove condition, serializes to the DSL string) and `RawQueryInput.tsx` (Loki-only, capability-
  gated via the existing `SourceCapabilities` model — same gating pattern `LiveTailPanel` already
  uses for `liveTail()`).
- `QueryPlanDisclosure.tsx`: renders `queryPlan` as a `<details>` under the results header, styled
  consistently with the existing design tokens, monospace for the query string per `CLAUDE.md` §7.
- Both new controls compose with, not replace, the existing `AdvancedFilters` structured filters —
  a user can combine a guided/raw query with the who/request/what/client filters, matching OLD's
  own "advanced filters alongside query mode" layout (`AUDIT-01` §3).

**SECURITY CONSTRAINTS:** Free-text query values on sensitive fields must still go through the
existing exact-match-only restriction (`EventFilters#fieldMatches` — no `contains` on sensitive
fields, matching OLD's HMAC-token restriction's actual guarantee per matrix row MASK-06). The
parser must reject (not silently ignore) a `contains` operator on a sensitive field. `queryPlan`
strings must never include a raw sensitive value — enforced by extending `QueryLeakTest` to cover
the new DTO field explicitly.

**TESTS:** `QueryBuilder.test.tsx` (tree→DSL string serialization, AND/OR nesting, remove/reset),
`RawQueryInput.test.tsx` (capability gating, hidden entirely for non-Loki sources),
`SearchService#queryPlanNeverLeaksSensitiveValue` (extends `QueryLeakTest`),
`QueryParserIntegrationTest#sensitiveFieldRejectsContains`, real HTTP round-trip in
`QueryApiIntegrationTest`.

**BROWSER/UX VERIFICATION:** Build a guided AND/OR query in the browser against Fixture data,
confirm results match a hand-written equivalent DSL string typed directly; confirm raw LogQL mode
is entirely absent for the Docker source and present-but-off-by-default for Loki; confirm the
query-plan disclosure shows real push-down/post-filter text after a mixed query (e.g.
`service=web AND message contains "timeout"` — service pushes down, message text doesn't).

**REGRESSION GATES:** Existing `AdvancedFilters.test.tsx`/`ActiveFilters.test.tsx` must keep
passing unchanged — the new query modes are additive, not a replacement of structured filters.

**PASS CRITERIA:** A guided AND/OR query and a raw LogQL query (Loki) both execute end-to-end and
return correct results; the query plan disclosure never shows a raw sensitive value.

**FAIL CRITERIA:** Raw LogQL reachable against a source whose capability says `false`; any
sensitive raw value appearing in `queryPlan`.

**RECOVERY PLAN:** If tree-to-DSL serialization proves error-prone for deeply nested groups, ship
guided mode with a bounded nesting depth (e.g. 3 levels) rather than an unbounded recursive editor
— matching the project's general "no unbounded" bias (`CLAUDE.md` §4 "Bounds").

**DEPENDENCIES:** None functionally, but should land after Slice 1 (pagination) since a richer
query surface increases the odds of >200-row result sets that Slice 1's pagination is needed to
browse.

---

## Slice 3 — Connection & settings workspace (Docker connection, exclusion label, SSRF hardening)

**GOAL:** Restore the operational flexibility OLD had for configuring and testing a Docker
connection without an app restart, while closing a real security-depth gap (SSRF/DNS-rebinding
protection) that OLD had and NEW currently lacks.

**OLD CAPABILITIES INCLUDED:** SRC-04 (per-session Docker connection), SRC-05 (connection test
action), SRC-09 (exclusion label), SRC-10/MASK-08 (SSRF + DNS-rebinding protection), SET-01/03
(a settings surface to host these controls).

**CURRENT NEW STATE:** Docker connection (mode/host/port/TLS/project-filter) is 100% static,
sourced once at boot from `application.yml`/env vars via `DockerProperties`. There is no runtime
connection UI, no test-before-save action, no per-session override, and no re-resolution/allowlist
defense against SSRF or DNS rebinding when a remote host is configured. There is no exclusion
mechanism to hide Log Explorer's own container from Docker discovery (confirmed live in Phase K —
NEW's own `app` container appeared in its own discovery results).

**TARGET BEHAVIOR:**
- A single new frontend surface (`frontend/src/features/settings/`) reachable from the app header,
  matching OLD's Search↔Settings navigation pattern but adapted to NEW's architecture (a route/
  panel, not a full page swap, keeping NEW's existing single-view investigation focus intact for
  the default view).
- Docker connection becomes **process-scoped-but-runtime-changeable**, not per-browser-session like
  OLD (OLD's per-session model existed partly to support multiple concurrent investigators with
  different Docker hosts on one server — re-examine whether that's still a real requirement here;
  absent an explicit owner ask for multi-tenant session isolation, a single admin-changeable
  runtime connection is a smaller, safer surface than reintroducing OLD's anonymous
  `X-LogExplorer-Session` header mechanism, which itself has no auth). Test/Save/Reset actions
  hit the real adapter before committing.
- `DockerLogSource` discovery excludes any container/service carrying a configurable label
  (default `logexplorer.excluded=true`, matching OLD's own key so existing Compose files that
  already set it keep working) — config-only, no UI needed for this one (matching OLD's own
  config-only posture per `AUDIT-15` §6).
- Remote Docker connections re-resolve the configured hostname immediately before connecting and
  reject a resolved address inside a private/link-local/metadata range (169.254.0.0/16,
  127.0.0.0/8, etc.) unless that exact address was already allowlisted at boot — closing the
  SSRF/DNS-rebinding gap.

**BACKEND CHANGES:**
- New `SettingsController` (or extend `DockerConnectionController`-equivalent) exposing
  `GET/PUT /api/v1/settings/docker-connection` and `POST /api/v1/settings/docker-connection/test`,
  backed by a `DockerConnectionRuntimeStore` (in-memory, single current connection — not
  per-session) that `DockerClientFactory` reads instead of only `DockerProperties`
  at boot. Config-file values remain the default/fallback.
- `DockerProperties#exclusionLabelKey` (default `logexplorer.excluded`) threaded into
  `DockerLogSource`'s discovery filter, alongside the existing `composeProjectFilter`.
- New `RemoteHostGuard` in `source/docker/` (or a shared `core/guard/` module, since
  `core/guard/` already exists for other request-guard logic) performing DNS resolution +
  private/link-local/metadata-range rejection before every remote-Docker connection attempt (not
  just at settings-save time — DNS rebinding specifically requires re-checking at connect time,
  since a benign hostname can change its resolved address between test and use).

**FRONTEND CHANGES:**
- `frontend/src/features/settings/SettingsPanel.tsx`, `DockerConnectionForm.tsx` (mode/host/port/
  TLS cert fields, Test/Save/Reset, matching `CLAUDE.md` §4's "certificate fields appear only when
  TLS is on" rule) — reuses the existing design tokens, not a new visual language.
- App header gains a Settings entry point; opening it does not lose or reset the current search
  state (the mission's "never require more navigation" UX target — settings is a peer view, not a
  destructive navigation).

**SECURITY CONSTRAINTS:** This slice is explicitly a security-hardening slice, not just a
feature-parity one: `RemoteHostGuard` must fail closed (reject-by-default on any resolution
failure or ambiguous result); TLS fields must never allow trust-all (already enforced by
`DockerClientFactoryTest` — extend it to cover the new runtime-store path); the settings API must
never accept or echo a raw credential/token in a response body.

**TESTS:** `RemoteHostGuardTest` (private-range rejection, DNS-rebinding-simulated-resolution
test using a mock resolver), `DockerConnectionRuntimeStoreTest`, `SettingsApiIntegrationTest`
(test/save/reset round-trip against a real or mock Docker daemon), `DockerLogSourceTest#exclusionLabelHidesContainer`
(extends the existing discovery test suite), `SettingsPanel.test.tsx`/`DockerConnectionForm.test.tsx`
(incl. jest-axe).

**BROWSER/UX VERIFICATION:** Real end-to-end against a local Docker daemon: change host/port via
the UI, Test shows real success/failure, Save takes effect without an app restart, Log Explorer's
own container is excluded from discovery once the label is present. Attempt a remote connection to
a private/link-local address and confirm it's rejected with a clear error, not a silent hang.

**REGRESSION GATES:** All existing `DockerLogSourceTest`/`DockerClientFactoryTest` cases must keep
passing with the new runtime-store layered on top of `DockerProperties` (config remains the
default when no runtime override is set).

**PASS CRITERIA:** Docker connection is changeable at runtime through the UI with a working Test
action; SSRF/DNS-rebinding protection demonstrably blocks a crafted private-range target;
self-exclusion works against a real Compose deployment.

**FAIL CRITERIA:** Any path where a remote-Docker connection reaches a private/link-local address
without an explicit allowlist entry; TLS trust-all reachable through any new code path.

**RECOVERY PLAN:** If full per-session isolation turns out to be a real requirement after owner
review (multiple concurrent investigators genuinely needing different Docker hosts), extend
`DockerConnectionRuntimeStore` to be keyed by an authenticated session concept — but do not
resurrect OLD's anonymous, unauthenticated session header, since that pattern itself has no real
access control and would be a security regression, not a restoration.

**DEPENDENCIES:** None. Can run in parallel with Slices 1/2.

---

## Slice 4 — Results table configurability (columns, density, reorder)

**BLOCKED ON OD-1.** Only scope and build this slice if the owner approves path (b) in OD-1 above.

**GOAL:** Restore optional-column, density, and reorder power for investigators who need more
than the fixed seven columns, without weakening the predictable default view `CLAUDE.md` §4
mandates.

**OLD CAPABILITIES INCLUDED:** TABLE-02 (optional columns), TABLE-03 (reorder + reset), TABLE-04
(density), TABLE-06 (row-level keyboard nav / roving tabindex), TABLE-10 (preference persistence).

**CURRENT NEW STATE:** `columns.ts#RESULT_COLUMNS` is a hardcoded 7-entry array; no reorder,
density, show/hide, or persistence exists; `ResultsTable.tsx` supports Tab-based keyboard access
to the action menu but no ArrowUp/Down row traversal.

**TARGET BEHAVIOR:** The seven default columns remain the default, in the default order, on first
load and after "Reset columns" — satisfying `CLAUDE.md` §4 literally. A "Columns" control (button
+ popover, not a permanently expanded panel, matching the Custom-range-popover pattern already
established) lets a user show any of the six optional columns (Date-only, Source, Container, Error
code, Business step, Journey ID, Logger — same set as OLD's `AUDIT-05` §2) and reorder via drag or
keyboard (arrow keys while a column header has focus, mirroring OLD's accessible reorder pattern).
Density (comfortable/compact) is a two-state toggle affecting row height/padding only, never
column content. All of this persists to `localStorage` under a single namespaced key (e.g.
`logexplorer.table-prefs`) — **explicitly allowed** by `CLAUDE.md` §2 rule 4 ("localStorage holds
only safe non-sensitive UI preferences"), since column choice/density/order contain no search
values or log content.
Row keyboard navigation gains ArrowUp/Down to move a "current row" focus ring (visually distinct
from selection), Enter opens the inspector for the focused row, matching OLD's model.

**BACKEND CHANGES:** None — this is a pure frontend rendering concern; the backend already returns
every field needed for the optional columns inside each event (no new API surface required).

**FRONTEND CHANGES:** `columns.ts` becomes `ALL_RESULT_COLUMNS` (13 entries) +
`DEFAULT_VISIBLE_COLUMN_IDS` (7, same set/order as today); new `TablePrefsProvider`
(`frontend/src/features/results/tablePrefs.ts`) managing `{visibleColumnIds, order, density}` with
`localStorage` persistence; `ColumnsMenu.tsx` (popover, checkboxes + reorder list); density toggle
in the same toolbar area as the existing table controls; `ResultsTable.tsx` reads column list from
`TablePrefsProvider` instead of the constant directly, plus new `onKeyDown` roving-tabindex logic
for row focus.

**SECURITY CONSTRAINTS:** `TablePrefsProvider` must only ever persist column ids/order/density —
add an explicit unit test asserting the persisted JSON shape has no other keys, so a future change
can't accidentally widen what's written to `localStorage`.

**TESTS:** `tablePrefs.test.ts` (persistence round-trip, invalid-stored-value fallback to
defaults), `ColumnsMenu.test.tsx` (incl. jest-axe, keyboard reorder), `ResultsTable.test.tsx`
extended for row ArrowUp/Down navigation, `phase-g-results-table.spec.ts` extended to assert the
≤2px geometry invariant still holds with 13 possible columns and both density states (this is the
single most important regression gate for this slice, since `CLAUDE.md` §4's geometry rule came
from a real bug).

**BROWSER/UX VERIFICATION:** Toggle every optional column on, reorder via drag then via keyboard,
switch density, reload the page and confirm the exact same configuration restores, click "Reset
columns" and confirm it returns to exactly the original seven in the original order.

**REGRESSION GATES:** The default (no stored prefs) view must render byte-identical to today's
fixed-seven table — extend `phase-g-results-table.spec.ts`'s existing snapshot/geometry assertions
to run once with cleared `localStorage` as the primary case.

**PASS CRITERIA:** Default view unchanged; full optional-column/reorder/density/persistence cycle
works and survives reload; geometry invariant holds at every combination tested.

**FAIL CRITERIA:** Any default-view visual/geometry change; any persisted value beyond
column/order/density.

**RECOVERY PLAN:** If drag-based reorder proves flaky across browsers, ship keyboard-only reorder
first (arrow keys while a header is focused) and treat drag as a P3 follow-up — keyboard reorder
alone still satisfies the accessibility-first bar this project holds itself to.

**DEPENDENCIES:** OD-1 approval. Otherwise independent of all other slices.

---

## Slice 5 — Live-tail resilience and control

**GOAL:** Bring live tail's resilience and control surface back toward OLD's, without
reintroducing the "silent, invisible auto-reconnect loop" NEW's own Phase J code comments
explicitly rejected — the fix is to make reconnection visible and boundable, not to remove the
principle.

**OLD CAPABILITIES INCLUDED:** LIVE-02 (reconnecting state), LIVE-05 (follow-newest toggle),
LIVE-06 (bounded, visible, cancellable reconnect), LIVE-07 (Clear displayed), LIVE-09 (tail-side
severity/text filters), LIVE-01 (pre-start confirmation — only if OD-2 approves it).

**CURRENT NEW STATE:** `useLiveTail.ts` state machine is `idle|connecting|live|paused|stopped|
error` — on any transport error it closes and requires a manual restart. `FollowRequest` filters
by `services` only. There is no follow-newest/frozen-view mode and no Clear-without-stopping
action.

**TARGET BEHAVIOR:**
- Add a `reconnecting` state: on a transport error (not a user-initiated Stop), attempt
  reconnection with the same bounded exponential backoff OLD used (base 1s, cap 15s, ±20% jitter,
  max 5 attempts — these are reasonable, already-proven bounds, not arbitrary), **visibly** shown
  in the UI (a persistent "Reconnecting… attempt 2 of 5" indicator) with an explicit Cancel button
  that returns to `stopped`. This satisfies both OLD's resilience and NEW's own stated objection
  (visibility + user control, never silent).
- Follow-newest toggle: when off, new events still buffer (up to the existing `VISIBLE_CAP`) but
  the visible scroll position doesn't jump; an "N new events" indicator with a "Jump to newest"
  action appears instead — connection and buffering behavior unchanged, this is a display-mode
  toggle, not a new state in the connection state machine.
- Clear: empties the currently displayed/buffered events without touching the connection (adds a
  transition that doesn't exist today: `live→live` / `paused→paused` with an emptied buffer).
- `FollowRequest` gains optional `severity`/`text` fields threaded through to the same filter
  predicate `EventFilters` already applies to historical search — one shared filter-evaluation
  path for both historical and live, not a second implementation.

**BACKEND CHANGES:** `LiveTailService.java`/`FollowRequest` DTO gain `severity`/`text` fields,
applied via the existing `EventFilters` predicate before emitting to the SSE sink (no new
filtering logic — reuse). No backend change needed for reconnect (reconnection is a client-side
concern — the backend already tears down and re-accepts a new SSE connection correctly per-request,
verified by `LiveTailGuard`'s existing concurrency-cap tests).

**FRONTEND CHANGES:** `useLiveTail.ts` gains `reconnecting` state + backoff scheduler (a small,
independently testable `reconnectBackoff.ts` pure function: attempt number → delay-with-jitter,
so the timing logic can be unit-tested deterministically rather than relying on real timers).
`LiveTailPanel.tsx` gains the reconnecting indicator + Cancel, the follow-newest toggle + "Jump to
newest" affordance, and a Clear button. `FollowControls.tsx` (or wherever the live filter controls
live today) gains severity/text inputs matching the historical search's own controls for
consistency.

**SECURITY CONSTRAINTS:** None beyond what already applies to `EventFilters` (severity/text on the
live path must respect the same sensitive-field exact-match-only restriction already enforced for
historical search — extend `LiveTailService` tests to confirm a `contains`-style live filter on a
sensitive field is rejected identically to the historical path).

**TESTS:** `reconnectBackoff.test.ts` (deterministic delay sequence, jitter bounds, attempt cap),
`useLiveTail.test.ts` extended for reconnecting→live and reconnecting→stopped(cancelled)
transitions, `LiveTailPanel.test.tsx` for the new indicators/buttons (incl. jest-axe for the live
"Reconnecting" announcement via `aria-live`), `LiveTailService` backend tests for severity/text
filtering.

**BROWSER/UX VERIFICATION:** Real Docker live tail, kill and restart the Docker daemon connection
mid-stream (or simulate via a network-level interruption) and confirm the visible reconnect
indicator appears, counts attempts, and either recovers or reaches `stopped` after 5 attempts with
a clear message; confirm Cancel during reconnect stops cleanly; confirm follow-newest-off keeps
scroll position while new events accumulate.

**REGRESSION GATES:** Existing `useLiveTail.test.ts` Pause/Resume/Stop tests must keep passing
unchanged (reconnect is additive to the state machine, not a replacement of existing transitions).

**PASS CRITERIA:** A real, visible, boundable reconnect cycle recovers from a transient
disconnection without user action beyond watching it happen; follow-newest and Clear both work
without closing the connection.

**FAIL CRITERIA:** Any reconnect behavior that retries silently/invisibly (this would directly
violate the project's own stated design principle, not just miss a feature); any unbounded retry.

**RECOVERY PLAN:** If real Docker daemon disconnection proves hard to simulate reliably for
automated tests, use a mock `EventSource` with a scripted error injection (the existing
`MockEventSource` test double already supports this pattern per `useLiveTail.test.ts`) — the
manual real-Docker pass in BROWSER/UX VERIFICATION remains required regardless, since a mock alone
is not sufficient real-world evidence per `CLAUDE.md` §3.

**DEPENDENCIES:** None. Independent of all other slices. OD-2 only gates the optional
pre-start-confirmation item within this slice — the rest of the slice proceeds regardless.

---

## Slice 6 — Investigation depth (gap markers, richer source-health diagnostics)

**GOAL:** Close two smaller but real investigation-quality gaps: the timeline doesn't call out
time gaps between events, and source-health messages are flatter than OLD's Docker-specific
diagnostic breakdown.

**OLD CAPABILITIES INCLUDED:** INV-05 (gap markers between timeline entries), ERR-04
(suggested-action / connectivity-state breakdown in source health).

**CURRENT NEW STATE:** `JourneyEntryRow.tsx` shows severity per row but no inter-event time-delta
annotation. `SourceHealth{status,message,checkedAt}` carries one message string; OLD distinguished
"daemon unreachable" vs "permission denied" vs "library missing" etc. as distinct states with
different suggested actions.

**TARGET BEHAVIOR:** When consecutive journey entries are separated by more than a configurable
threshold (default 60s — chosen because it's OLD's own `MVP_SPEC.md`-stated (if internally
inconsistent, see the capability matrix's note on INSP-07) threshold for "a notable gap", not
copied from OLD's implementation, just a reasonable, documented default), render a lightweight
inline gap marker ("→ 4m 12s gap") between the two rows — text-only, matching the project's
existing "severity conveyed by text+icon+colour, never colour alone" rule.
Source health responses distinguish at least: `unavailable-config` (not configured),
`unavailable-connection` (unreachable), `unavailable-permission` (denied), `degraded`,
`available` — each with a short human `suggestedAction` string — while keeping the existing tri-
state visual badge (`SourceHealthBadge.tsx`) as-is, just with richer copy in its tooltip/detail.

**BACKEND CHANGES:** `SourceHealth` gains a `reason` enum (as above) and `suggestedAction` string;
each adapter's `health()` implementation classifies its own failure mode instead of collapsing
everything into one generic message (Docker adapter already catches distinct exception types
internally — this surfaces that existing distinction instead of discarding it).

**FRONTEND CHANGES:** `JourneyEntryRow.tsx`/`JourneyView.tsx` computes and renders the gap marker
between adjacent entries (pure function `computeGaps(entries, thresholdMs)` in
`journeyFields.ts`, unit-testable independent of rendering). `SourceHealthBadge.tsx` renders
`reason`/`suggestedAction` in its existing detail/tooltip surface.

**SECURITY CONSTRAINTS:** None — no sensitive data involved in either change.

**TESTS:** `journeyFields.test.ts#computeGaps` (threshold boundary, no-gap case, multiple gaps),
`JourneyEntryRow.test.tsx` (gap marker renders/doesn't render), backend `health()` classification
tests per adapter (`DockerLogSourceTest`, `LokiLogSourceTest`).

**BROWSER/UX VERIFICATION:** Real journey view against fixture data seeded with a deliberate time
gap between two events in the same trace; confirm the marker renders correctly and doesn't
interfere with the existing causality disclaimer. Stop a real Docker daemon and confirm the health
badge shows a specific, correct reason rather than a generic failure string.

**REGRESSION GATES:** Existing `JourneyView.test.tsx`/`SourceHealthBadge.test.tsx` suites must
keep passing unchanged for the non-gap, non-error cases.

**PASS CRITERIA:** Gap markers appear only where a real threshold-exceeding gap exists; health
reasons are accurate and distinct per real failure mode tested.

**FAIL CRITERIA:** A gap marker implying causality (must stay purely time-delta, no "possible
missing event" language — that would overstate what NEW can actually know, contradicting the
existing, deliberately worded causality disclaimer).

**RECOVERY PLAN:** If per-adapter failure classification proves unreliable across Docker library
versions, fall back to a coarser two-state reason (`config`/`connection`) rather than guessing at
a specific cause that might be wrong.

**DEPENDENCIES:** None.

---

## Slice 7 — Message-level sensitive-data redaction

**GOAL:** Close a real defense-in-depth gap: NEW currently only masks the five named structured
sensitive fields, never scanning free-text `message`/`exception` content for embedded secrets or
PII the way OLD's `MaskingPolicy.redactText` did.

**OLD CAPABILITIES INCLUDED:** MASK-07.

**CURRENT NEW STATE:** `MaskingService.java` operates only on the five named fields
(`cif`/`UserName`/`CustomerId`/`deviceId`/`deviceIp`); `message`/`exception` text passes through
unscanned.

**TARGET BEHAVIOR:** A small, bounded set of high-confidence, low-false-positive patterns
(bearer/API tokens matching common prefixes, email addresses, and credit-card-like digit runs) are
redacted from `message`/`exception` text at the same masking boundary the five structured fields
already go through — never a second, separate masking pass elsewhere in the codebase. Deliberately
narrower than an open-ended PII-scanning engine (out of scope, would be a false-positive-prone
over-build) — this is defense-in-depth against accidental secret logging, not a general DLP
system.

**BACKEND CHANGES:** `core/mask/TextRedactor.java` (new, small, pure-function pattern matcher) called
from the same single masking boundary in `EventMapper.java` that already applies
`MaskingService` to the five fields — one masking boundary, extended, not a second one. Patterns
config-driven (`MaskingProperties#textPatterns`, sensible defaults, no yml required for the
common case) so new patterns can be added without a code change if a real log format is found to
leak something.

**FRONTEND CHANGES:** None — this is entirely server-side, transparent to the frontend (the
already-masked text just contains fewer secrets than before).

**SECURITY CONSTRAINTS:** This is itself a security-hardening slice. `TextRedactor` must run
before serialization, at the same single boundary as `MaskingService` (verified by extending
`SerializationLeakTest`). False negatives are a real risk (a token format not in the pattern list
passes through) — document this limitation honestly in `SECURITY_NOTES.md`-equivalent, never claim
complete coverage.

**TESTS:** `TextRedactorTest` (each pattern, false-positive checks on ordinary log text like
"contact support at ext 5551234" not being mis-redacted as a card number), `EventMapperTest`
extended to confirm redaction happens before serialization, `SerializationLeakTest` extended.

**BROWSER/UX VERIFICATION:** Feed a fixture event with a message containing a fake bearer token
and an email address through a real search, confirm both are redacted in the rendered inspector
text.

**REGRESSION GATES:** Existing `MaskingServiceTest` (field-level masking) must keep passing
unchanged — this slice adds a second, independent function, not a modification of the existing
one.

**PASS CRITERIA:** Known-pattern secrets embedded in message/exception text never reach the
browser; ordinary log text is not mangled by false-positive redaction.

**FAIL CRITERIA:** Any false-positive rate high enough to make normal log messages unreadable;
any redaction bypass at the API boundary (verified via the extended leak test).

**RECOVERY PLAN:** If real fixture/demo data produces too many false positives with the initial
pattern set, narrow the patterns (e.g. require a labeled prefix like `Bearer ` before the token
pattern) rather than disabling redaction outright.

**DEPENDENCIES:** None.

---

## Slice 8 — Productivity: shortcuts, safe preference persistence, code-splitting

**GOAL:** Restore the productivity conveniences that don't touch security or query semantics: a
global run shortcut, a shortcuts-help popover, safe non-sensitive UI-preference persistence
(explicitly allowed by `CLAUDE.md` §2 rule 4), and lazy-loading of the heavier views.

**OLD CAPABILITIES INCLUDED:** SEARCH-18 (Ctrl/Cmd+Enter), SEARCH-19 (shortcuts help), PROD-01
(non-sensitive preference persistence: source id, time-preset id, severity levels — explicitly
**not** query text, matching CLAUDE.md's stricter-than-OLD stance already reflected in the matrix's
PROD-02 decision), PROD-03 (lazy-loading/code-splitting for Journey/Live views).

**CURRENT NEW STATE:** No global keydown handler; no shortcuts popover; zero persistence of any
kind (verified by `persistence.test.tsx`); no `React.lazy`/dynamic imports anywhere in
`frontend/src/app`.

**TARGET BEHAVIOR:** Ctrl/Cmd+Enter runs the current search from anywhere in the app except while
a text input that itself needs Enter for another purpose has focus (matching OLD's own scoping
care). A `?`-triggered or header-button shortcuts popover lists every keyboard interaction the app
supports (reusing the audit trail already built for this reconciliation as the content source).
Source id, time-preset id, and severity-level selection persist to `localStorage` under one
namespaced key and restore on load — explicitly never the query text or any filter *value*.
`JourneyView` and `LiveTailPanel` (the two heaviest, not-always-used views) load via
`React.lazy`/`Suspense`, reducing the initial bundle.

**BACKEND CHANGES:** None.

**FRONTEND CHANGES:** `useGlobalShortcuts.ts` (new shared hook in `frontend/src/shared/`),
`ShortcutsHelp.tsx` popover, `preferences.ts` (get/set with the explicit allow-listed key set —
enforced by TypeScript typing the persisted shape narrowly, not a generic key-value store, so a
future change can't accidentally widen what's persisted), `App.tsx` updated to
`React.lazy(() => import('../features/journey/JourneyView'))` and equivalent for live tail.

**SECURITY CONSTRAINTS:** `preferences.ts`'s persisted shape must be a closed TypeScript type with
exactly the three allowed fields — add a unit test asserting `JSON.stringify` of the persisted
object never has extra keys, mirroring the same discipline applied in Slice 4's table-prefs test.

**TESTS:** `useGlobalShortcuts.test.ts` (fires on Ctrl/Cmd+Enter, doesn't fire inside a
text field where Enter has its own meaning), `ShortcutsHelp.test.tsx` (incl. jest-axe),
`preferences.test.ts` (persistence round-trip + closed-shape assertion), a bundle-size check
confirming `JourneyView`/`LiveTailPanel` chunks are separate output files after `npm run build`.

**BROWSER/UX VERIFICATION:** Confirm Ctrl+Enter runs search from the filter panel but not while
typing in a text field with its own Enter behavior (e.g. the free-text search box, where Enter
already submits); confirm the shortcuts popover opens/closes correctly with focus trap; confirm a
reload preserves source/preset/severity but not any query text; confirm dev-tools network tab
shows the journey/live chunks fetched lazily only when those views are first opened.

**REGRESSION GATES:** Existing `persistence.test.tsx` (Phase F's "writes nothing" test) must be
updated deliberately, not silently broken — its new form should assert "writes only the three
allow-listed keys, never anything else", preserving the spirit of the original test.

**PASS CRITERIA:** Shortcut works without interfering with existing input behavior; persistence
covers exactly three safe fields; initial bundle size decreases measurably.

**FAIL CRITERIA:** Any query/filter value found in `localStorage`; global shortcut swallowing
Enter inside a text field that needs it.

**RECOVERY PLAN:** If code-splitting introduces a visible loading flash for `JourneyView`/
`LiveTailPanel`, add a lightweight, on-brand skeleton (reusing existing loading-state patterns
already built for search) rather than a blank flash.

**DEPENDENCIES:** None.

---

## Slice 9 — Packaging polish (offline export/import, performance budget automation)

**GOAL:** Two low-priority, low-risk parity items that round out NEW's already-stronger packaging
story (`PKG-01`/`PKG-02`/`PKG-04`/`PKG-05` are already `NEW_CHANGED_BETTER` per the matrix).

**OLD CAPABILITIES INCLUDED:** PKG-03 (offline image export/import), PERF-02 (performance budget
tracked automatically, not just inspected ad hoc).

**CURRENT NEW STATE:** `scripts/` has `smoke.sh` and `validate-openshift-manifests.sh` only; no
export/import wrapper. No automated JS/CSS gzip-size assertion anywhere in CI or scripts.

**TARGET BEHAVIOR:** `scripts/export-image.sh`/`scripts/import-image.sh` thin wrappers around
`docker save`/`docker load` with the same air-gapped-deployment intent as OLD's runbook section,
documented in a short addition to the existing deployment docs (not a new runbook — extend what's
already there). A `scripts/check-bundle-budget.sh` (or a small Vite plugin) fails the build if
gzip JS exceeds a documented threshold (reuse `UX_SPEC.md`'s own re-based Phase 8 numbers — JS
≤280kB raw/≤75kB gzip, CSS ≤70kB raw/≤12kB gzip — as the starting budget, since they're already
the numbers this project's own UX spec committed to).

**BACKEND CHANGES:** None.

**FRONTEND CHANGES:** None beyond the build-time budget check.

**SECURITY CONSTRAINTS:** None.

**TESTS:** N/A (these are scripts/build-process changes, verified by running them, not unit
tested).

**BROWSER/UX VERIFICATION:** N/A.

**REGRESSION GATES:** N/A.

**PASS CRITERIA:** `export-image.sh` output can be `import`ed and run on a separate, offline
machine reproducing the same behavior as `docs/verification/PHASE_K_REPORT.md`'s existing manual
verification; the budget script fails a deliberately bloated test build and passes the current
real build.

**FAIL CRITERIA:** Budget script false-failing the current, already-accepted build size.

**RECOVERY PLAN:** If the current real bundle already exceeds the OLD-derived budget numbers once
Slices 2/4/5/8 land (all of which add UI), revisit the threshold explicitly with the owner rather
than silently loosening it in code.

**DEPENDENCIES:** Should run last, after Slices 2/4/5/8 (which add frontend surface) so the
budget reflects the final bundle shape rather than being set prematurely.

---

## Suggested sequencing

1. **Slice 1** (P0, no dependencies) — fixes the single most serious regression first.
2. **Slice 3** and **Slice 7** (P1 security-adjacent, independent) — in parallel with Slice 1.
3. **Slice 2** (P1, depends conceptually on Slice 1 for large result sets).
4. **Slice 5** (P1, independent).
5. **OD-1/OD-2 decisions**, then **Slice 4** if approved.
6. **Slice 6**, **Slice 8** (P2, independent, can interleave anywhere).
7. **Slice 9** last (depends on the final bundle shape from 2/4/5/8).

Each slice remains a normal one-branch-one-PR-per-phase unit per `CLAUDE.md` §5 once approved —
this document does not itself authorize starting any of them.
