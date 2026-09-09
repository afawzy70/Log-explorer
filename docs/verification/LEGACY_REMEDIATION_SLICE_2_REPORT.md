# Legacy Remediation Slice 2 — Query Transparency & Advanced Query Authoring

Verification report for `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 2". Base
SHA `4653121` / `465312182da97d509b2350603ccbde778aa5db90` (`main`, PR #18 merged —
Legacy Remediation Slice 1). Branch `phase/legacy-slice-2-query-transparency`.

This slice restores and improves OLD's advanced-query workflow (guided AND/OR
authoring, a text DSL editor, and a real raw-LogQL expert mode) on top of NEW's
existing backend query engine, adds server-side query-plan transparency, and closes
a real sensitive-field security gap the DSL had never enforced. It does **not**
constitute completion of the full legacy remediation effort — Slices 3+ remain.

---

## 1. Architecture — ONE QUERY MODEL, no second parser

`core/query/QueryParser`/`QueryEvaluator`/the typed `QueryExpr` AST remain the
sole, authoritative query engine — unchanged in shape from before this slice.
Nothing new duplicates its grammar:

- **Frontend guided builder** (`frontend/src/features/search/queryAuthoring.ts` +
  `QueryBuilder.tsx`): a bounded-depth AND/OR condition tree that
  *deterministically serializes* into the existing DSL text
  (`serializeQueryTree`). There is **no reverse (text → tree) parser** — building
  one would duplicate `QueryParser`'s own grammar, which the mission explicitly
  forbids. Switching from Text mode back to Guided mode is therefore either a
  no-op (the typed text still matches what the tree would generate) or an
  explicitly-confirmed, non-fabricated reset — never a guessed conversion. See
  the module's own doc comment for the full reasoning.
- **Text mode**: edits the existing DSL string directly; the backend
  (`QueryParser`/`GlobalExceptionHandler`) is the *only* validator. No
  client-side grammar re-implementation.
- **Raw LogQL mode**: unchanged backend capability (`SearchRequest#rawLogQl`,
  `SearchService#rejectRawLogQlIfUnsupported`, `LokiLogSource#buildSelector`);
  the frontend only gates *visibility* of the control via
  `SourceCapabilities.rawLogQL`.
- **Query-plan transparency** (`core/query/QueryPlan`/`QueryPlanBuilder`): reads
  the same `SearchRequest`/`QueryExpr` every other component already uses and
  renders it as text (`QueryPlanExplainer`) — it evaluates nothing, executes
  nothing, adds no new semantics.

No eval, no reflection, no SpEL, no SQL-like execution, no frontend-only
filtering engine — grep for evidence: `grep -rn "eval(\|new Function(\|SpEL"
frontend/src backend/src/main` → 0 matches outside test/library code.

---

## 2. Backend changes

| File | Change |
|---|---|
| `core/query/QueryFields.java` | `isSensitive(alias)` — exposes the existing `SENSITIVE_ALIASES` set (`userName`/`customerId`/`cif`) to the parser. |
| `core/query/QueryParser.java` | `parseComparison()` now rejects the `contains` operator against a sensitive alias with a `QuerySyntaxException` naming the field (safe, fixed grammar vocabulary) — never the attempted literal. `!=` remains allowed (still exact-match semantics, just negated). |
| `core/query/QueryPlan.java` (new) | Domain record: `resolvedQuery`, `rawLogQlMode`, `pushedDownConditions`, `postFilterConditions`, `notes`. |
| `core/query/QueryPlanBuilder.java` (new) | Builds a `QueryPlan` from a `SearchRequest` + a source's reported push-down. `postFilterConditions` is always the **complete** condition set `EventFilters` evaluates (push-down is documented as optimization-only, never a partition) — mirrors `SearchRequest#toString()`'s exact redaction boundary (five protected fields + `text` + every DSL/raw-LogQL literal redacted; every other structured field shown by name, matching `advancedFilterFields.ts`'s own `sensitive: false` set). |
| `source/LogSource.java` | New default method `describePushDown(SearchRequest)` → `List.of()` — the honest default for every source that doesn't override it (Fixture, Docker, test doubles). Never fabricates push-down. |
| `source/loki/LokiLogSource.java` | Overrides `describePushDown`, sharing `resolvePushedDownServices()` with `buildSelector()` so the disclosure can never drift from what was actually queried (namespace always; single-service exact match only, same boundary `LogQlSelectorBuilder` already documents). |
| `core/model/SearchResult.java` | Gains `queryPlan` field. |
| `api/SearchService.java` | Computes the `QueryPlan` from the same `source`/`scoped` request the real fetch uses, before dispatch. |
| `api/dto/QueryPlanDto.java` (new) | Stable outbound DTO — a type boundary, no further transformation (contents are already safe per `QueryPlan`'s own contract). |
| `api/dto/SearchResponseDto.java` | Gains `queryPlan: QueryPlanDto`, populated on `/search`, `/context`, and `/journey`. |

### Sensitive-field DSL semantics (the security gap this slice closes)

Before this slice, `cif contains "x"` / `userName contains "x"` / `customerId
contains "x"` parsed and evaluated successfully — a real gap against CLAUDE.md §2
rule 1 ("sensitive fields are exact-match lookup only"), inconsistent with
`core.search.EventFilters`' own structured sensitive filters (`fieldMatches`,
exact-equals only). The parser now rejects the DSL shape outright:

```
cif = "FAKE-CIF-1000"        -> accepted (exact match)
cif != "FAKE-CIF-1000"       -> accepted (still exact-match semantics)
cif contains "FAKE-CIF-1000" -> QuerySyntaxException, HTTP 400, "not allowed"
```

### Push-down vs post-filter — the honest example from the plan

`service = "payments" AND message contains "timeout"` against Loki:

- **Pushed to source**: `namespace = "<configured>"` always; `service =
  "payments"` only because it resolved to exactly one exact-match service (via
  `LogQlDslPlanner.extractServiceEquality` when no `services` list was set, or
  the `services` list itself when it names exactly one).
- **Applied after retrieval** (always, regardless of what was pushed):
  `service in [payments]`, and the full DSL expression `(service = *** AND
  message contains ***)` — proving `EventFilters` never trusts push-down as the
  source of truth. `LokiLogSourceTest#multiServiceRequestsCannotPushDownButAreStillCorrectlyPostFilteredEventByEvent`
  (pre-existing, Phase E) already proves optimized vs. non-optimized result-set
  equivalence at the adapter level for the DSL pushdown path; this slice's own
  `describePushDown*` tests prove the *disclosure* never diverges from that
  same behavior.

---

## 3. Frontend changes

| File | Change |
|---|---|
| `shared/api/types.ts` | `QueryPlan` interface, `SearchResponse.queryPlan` (always present), `SearchRequestBody.query`/`rawLogQl` (never persisted — same class of value as `text`, CLAUDE.md §2 rule 4). |
| `features/search/queryAuthoring.ts` (new) | The guided tree model, `MAX_GUIDED_DEPTH = 1` (documented bound — root + one nested level, enough for `service = X AND (level = ERROR OR level = WARN)`), `serializeQueryTree` (deterministic, one-way), tree-mutation helpers, `operatorsFor` (never offers `contains` for a sensitive field). |
| `features/search/QueryBuilder.tsx` (new) | The "Query" toolbar affordance — same draft/apply/cancel shape as `AdvancedFilters`. Guided/Text/Raw-LogQL mode tabs (Raw LogQL only rendered when `rawLogQlSupported`), a live read-only generated-DSL preview in Guided mode, the warned text→guided reset. |
| `features/results/QueryPlanDisclosure.tsx` (new) | Collapsed-by-default `<details>` ("Query details") — executed query, pushed-to-source, applied-after-retrieval, notes. Renders the backend's already-redacted strings verbatim; performs no masking of its own. |
| `app/useSearchState.ts` | `queryState`/`applyQuery`, composed into `buildRequestBody` alongside every other filter; included in `SearchSnapshot` (so "show context"/"back to original search" preserves it); defensively resets an active raw-LogQL mode to guided (keeping the typed text) if the selected source changes to one without the capability. |
| `app/Toolbar.tsx` | Renders `<QueryBuilder>` next to Search, gated the same way `LiveTailPanel` gates on `capabilities.liveTail`. |
| `features/results/ResultsPanel.tsx` | Renders `<QueryPlanDisclosure>` for both the results and empty-results states. |

### Investigation-workflow invariants (all real-browser-verified)

- Opening Query never hides results or navigates away.
- Editing the draft never fires a request.
- Cancel/Escape/outside-click discard the draft; the committed query is untouched.
- Apply commits state only — the toolbar's own Search button is what runs a query.
- Clear resets the draft explicitly (still requires Apply to commit).
- "Show context"/"back to original search" preserve the committed query.

---

## 4. Security verification

- **`QueryPlanLeakTest`** (backend, 2 tests): a `queryPlan` built from a request
  carrying sentinel values in `text`, the DSL `query`, and all five protected
  structured filters (`cif`/`userName`/`customerId`/`deviceId`/`deviceIp`) —
  proven absent from the HTTP response body **and** from every captured
  application log line (root Logback appender raised to DEBUG, same technique
  as `LogLeakTest`/`QueryLeakTest`). A rejected sensitive-`contains` request is
  proven not to leak its attempted literal either.
- **`QueryParserTest#sensitiveFieldOperatorRejectionNeverEchoesTheAttemptedLiteral`**:
  the syntax-exception message never contains the rejected literal.
- **Real-browser proof**: `phase-legacy-slice2-query-transparency.spec.ts` test 9
  plants a sentinel in an unsafe `cif contains "..."` query and asserts it is
  absent from the entire rendered page (`page.locator('body').innerText()`),
  not just a specific element.
- **Redaction boundary**: `QueryPlanBuilder` deliberately mirrors
  `SearchRequest#toString()`'s existing boundary — the same five fields plus
  `text`/DSL/raw-LogQL literals, never more, never less, avoiding a second,
  independently-drifting redaction policy.

---

## 5. Tests

### Backend — `./mvnw --batch-mode verify` (real command run — see §6)

```
[INFO] Tests run: 440, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

21 new tests this slice: `QueryParserTest` (+4: exact-match allowed, `contains`
rejected for every sensitive alias, `contains` still allowed for non-sensitive
fields, no-literal-echo), `QueryPlanBuilderTest` (7, new file),
`QueryPlanApiIntegrationTest` (5, new file), `QueryPlanLeakTest` (2, new file),
`LokiLogSourceTest` (+3: `describePushDown*`). Baseline (Slice 1 merge) was 419.

Full explicit-requirement checklist: textual-DSL HTTP round-trip
(`QueryApiIntegrationTest`, pre-existing + still green), nested AND/OR/grouping
(`QueryParserTest`), invalid syntax → sanitized 400 (`QueryApiIntegrationTest`,
`QueryLeakTest`), sensitive exact-match allowed / `contains` rejected
(`QueryParserTest`), structured filters + DSL composition
(`EventFiltersTest#dslQueryIsAndedWithEveryStructuredFilter`, pre-existing),
query-plan DTO (`QueryPlanApiIntegrationTest`), query-plan redaction
(`QueryPlanLeakTest`), push-down/post-filter classification
(`QueryPlanBuilderTest`, `LokiLogSourceTest`), optimized-vs-canonical semantics
(`LokiLogSourceTest#multiServiceRequestsCannotPushDownButAreStillCorrectlyPostFilteredEventByEvent`,
pre-existing), raw LogQL accepted/rejected by capability
(`QueryApiIntegrationTest`, pre-existing), Docker cannot use raw LogQL
(`DockerLogSourceTest#capabilitiesReportLiveTailTrueNowThatPhaseJWiresTheEndpoint`,
pre-existing — `caps.rawLogQL()).isFalse()`), query errors/plan never leak raw
sensitive values (`QueryLeakTest`, `QueryPlanLeakTest`).

### Frontend — `npm run typecheck && npm run test && npm run build`

```
tsc -b --noEmit             -> clean
Test Files  44 passed (44)
Tests       361 passed (361)
vite build                  -> ✓ built in 346ms
```

60 new tests this slice: `queryAuthoring.test.ts` (20, new file —
serialization, escaping, operator restriction, tree mutation helpers),
`QueryBuilder.test.tsx` (26, new file — guided add/remove/AND-OR/nesting,
sensitive-operator restriction, draft/apply/cancel/clear, text-mode typing,
the guided↔text conversion boundary incl. the warned destructive reset,
raw-LogQL capability gating, jest-axe), `QueryPlanDisclosure.test.tsx` (9, new
file — collapsed by default, honest push-down/post-filter/notes rendering,
jest-axe), `useSearchState.test.ts` (+5 — request-body composition, mutual
exclusivity of `query`/`rawLogQl`, context/restore preservation, defensive
raw-LogQL-mode reset on source change). Baseline (Slice 1 merge) was 301.

### E2E — `npx playwright test`

```
90 passed (3.1m)
```

New file `frontend/e2e/phase-legacy-slice2-query-transparency.spec.ts` (10
tests, all 12 mission items — items 8 and 11 combined into one test; item 12
is the full-suite green run itself). Baseline (Slice 1 merge) was 80.

Item-by-item:

1. Guided `service = "payments-api" AND level = "ERROR"` executes; every
   returned row verified to satisfy both conditions (not just non-empty).
2. Nested guided `service = "payments-api" AND (level = "ERROR" OR level =
   "WARN")`; every row verified against the OR-group.
3. Guided query composed with the existing service multi-select structured
   filter; every row satisfies both.
4. Opening Query after results exist: table and first row stay visible, URL
   unchanged.
5. Draft edit + Cancel: a subsequent Search returns the exact same row count
   as before the cancelled edit.
6. Apply alone never renders a table; Search is what executes it.
7. Invalid text-mode query (`bogusField = "x"`): a sanitized `role="alert"`
   error, no table rendered.
8. + 11. A network-mocked capability-enabled ("Mock Loki") source: the Raw
   LogQL tab appears (absent for Fixture, see item 10), is unselected by
   default, carries the "Advanced... off by default" label, and applying +
   Searching sends `rawLogQl` (not `query`) through the app's real
   fetch/client code path — verified from the actual captured POST body.
   Query-plan disclosure then shows the genuine mocked push-down line and the
   honest "no structured filters" post-filter state.
9. `cif = "FAKE-CIF-1000"` (deterministic fixture value) accepted; the
   guided builder is shown to never even offer `contains` for `cif`; a
   text-mode `cif contains "<sentinel>"` is rejected with an alert containing
   "not allowed", and the sentinel is asserted absent from the entire page's
   text content.
10. Fixture (`rawLogQL: false`, same real capability value Docker reports —
    Docker itself is not reachable in this dev-profile environment, matching
    the CI E2E job's own Fixture-only posture) never renders a Raw LogQL tab.
12. The full pre-existing 80-test suite (geometry, Phase F–J, M, smoke, Slice
    1 pagination) verified green in the same run — see the `90 passed`
    result above.

Screenshots: `docs/verification/legacy-slice2/guided-query-and-before-apply.png`,
`guided-query-and-results.png`, `raw-logql-query-plan-disclosure.png`.

---

## 6. Commands run

```
cd backend && ./mvnw --batch-mode verify      # 440 passed, BUILD SUCCESS
cd frontend && npm run typecheck              # clean
cd frontend && npm run test -- --run          # 361 passed
cd frontend && npm run build                  # succeeded
SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run   # real backend for E2E
cd frontend && npx playwright test            # 90 passed
```

---

## 7. GitHub-hosted CI

PR [#20](https://github.com/afawzy70/Log-explorer/pull/20), run
[34344470905](https://github.com/afawzy70/Log-explorer/actions/runs/34344470905)
on commit `0f04a61` — all three jobs green:

```
Backend    pass   1m21s
E2E        pass   3m21s
Frontend   pass   1m32s
```

## 8. Known limitations / blockers

- **Docker's raw-LogQL absence** (item 10) was verified via Fixture, not a
  live Docker container — Docker is not reachable in this dev-profile
  environment. Docker's own `rawLogQL: false` capability is independently
  unit-tested (`DockerLogSourceTest`) and is a fixed literal in
  `DockerLogSource#capabilities()`, not conditional on anything this slice
  touched. **BLOCKED** on live Docker access; not required to unblock this
  slice per the mission's own "deterministic Fixture/mock sources" framing.
- **A genuinely live Loki instance** was not used for item 11 — a real
  capability-gated Loki endpoint is `DEFERRED` (no cluster access in this
  environment, consistent with every prior phase's own OpenShift/Loki
  deferrals). Item 11 was instead satisfied via Playwright network mocking,
  which the mission's own wording ("Mock/capability-enabled Loki") explicitly
  allows. `LokiLogSourceTest`/`LogQlSelectorBuilderTest`/`LogQlDslPlannerTest`
  already prove the real Loki adapter's push-down/raw-LogQL behavior against a
  mock HTTP server at the backend level.
- The pre-existing, deliberately-deferred `useSearchState.ts` services-fetch
  request-supersession race (Issue #19) was **not** touched, per this slice's
  explicit scope boundary.

---

## 9. Scope discipline

Not touched: Issue #19, Slice 3 (Docker settings), Slice 4 (table
configuration), Slice 5 (live tail changes), any unrelated refactoring. Only
files genuinely required for query authoring/transparency were changed.
