# Phase E — Query engine — Verification Report

Branch: `phase/e-query-engine`
Date: 2026-09-08

## Prerequisite

Phase D (OpenShift Loki source) is merged (PR #6) — confirmed via `gh pr view 6` (`MERGED`) and a fresh `main` checkout with the full backend suite green (222/222) before branching.

## Architecture

A small deterministic, source-independent query DSL (HANDOVER.md §9): `field <op> "value"` comparisons combined with `and`/`or`/parentheses, `and` binding tighter than `or`. New package `core/query/**`: `QueryLexer` → `QueryParser` (recursive descent, bounded recursion depth) → a closed, sealed `QueryExpr` AST (`Comparison`/`And`/`Or` in `core/query/ast/`) → `QueryEvaluator` (direct field comparisons only — no `eval`, SpEL, reflection, or any expression-language mechanism anywhere, grep-verified) → `QueryPlanExplainer` (redacted rendering).

**Unification, not duplication.** Rather than building two independent "Docker predicate" and "Loki planner" engines that could silently diverge, the parsed DSL is wired into the *existing* shared `core.search.EventFilters.matches()` call every adapter (fixture, Docker, Loki) already makes per event. This makes predicate/planner result **equivalence structural, not incidental** — the exact same `QueryEvaluator` runs regardless of source. `source/loki/plan/LogQlDslPlanner` is still a genuine, distinct "Loki path": it detects one narrow, provably-safe optimization — a bare top-level `service = "..."` equality — and pushes it into the LogQL selector (same exact-match-only safety rule Phase D already established for `SearchRequest#services()`). This is an optimization only; `EventFilters` always still re-applies the full predicate afterward, so a missed pushdown can never produce a wrong result, only a less-narrow fetch.

Raw LogQL (scope item 8): a new `SearchRequest#rawLogQl` field, gated centrally in `SearchService` via the target source's `capabilities().rawLogQL()` — one honest check that covers both "Loki-only" and "config-enabled" simultaneously, consistent with the "capabilities reflect reality" pattern established in Phase D. Still passes through the existing time/limit/timeout/concurrency guardrails unmodified, since those already run before dispatch regardless of raw-LogQL presence.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase E":

1. **Tokenizer, recursive-descent parser, typed AST** (`core/query/QueryLexer.java`, `QueryParser.java`, `core/query/ast/*.java`). Operators `=`, `!=`, `contains`, `and`, `or`, parentheses, quoted strings with `\"`/`\\` escaping.
2. **Aliases** (`core/query/QueryFields.java`): all 17 aliases from HANDOVER.md §9 — `service`, `level`, `message`, `logger`, `traceId`, `spanId`, `correlationId`, `journeyId`, `eventId`, `errorCode`, `businessStep`, `uiIdentifier`, `device.platform`, `language`, `userName`, `customerId`, `cif`. `deviceId`/`deviceIp` are deliberately **not** DSL aliases — the handover's own list omits them; they remain structured-filter-only fields, a documented boundary, not an oversight.
3. **Semantic validation** (`QueryParser`/`QuerySyntaxException`): precise position + structural-vocabulary error messages (field/token type names) — the literal content of a `STRING` token is never echoed in any error message, verified by a dedicated test asserting the sentinel text never appears.
4. **Predicate compiler + LogQL planner**: `QueryEvaluator.evaluate()` (in-memory, used via `EventFilters` for every source) and `LogQlDslPlanner.extractServiceEquality()` (Loki-only pushdown optimization).
5. **Query-plan explanation with redaction** (`QueryPlanExplainer.java`): every literal value replaced by a fixed `***` placeholder, unconditionally — not just for the three DSL-flagged sensitive aliases, matching the same blanket "never log search values" rule `SearchRequest#text` already follows.
6. **Structured filters ANDed with the parsed expression**: `EventFilters.matches()` now additionally evaluates `request.query()` alongside every existing structured check.
7. **No forbidden evaluation mechanism**: grep-verified zero matches for SpEL/`ScriptEngine`/reflection/`ProcessBuilder`/etc. anywhere in `core/query/**` or `source/loki/plan/**`.
8. **Raw LogQL**: Loki-only, disabled by default, config-enabled, gated centrally in `SearchService`, still subject to every existing guardrail, never advertised for Docker/fixture (their `capabilities().rawLogQL()` is always `false`).

## A real, previously-shipped bug found and fixed while touching `EventFilters`

`SearchRequest#loggerContains` has existed since Phase B (present on the domain model, the DTO, and `RequestMapper`) but `EventFilters.matches()` never actually checked it — a silent no-op filter that would have returned every event regardless of what a caller set it to. Found while reading this file to wire in the DSL evaluator; fixed with the same case-insensitive-contains convention `text`/`message` already use, and covered by two new tests (`loggerContainsFiltersAgainstTheLoggerFieldCaseInsensitively`, `loggerContainsIsExemptWhenTheEventHasNoLogger`).

## Automated tests

All commands below were actually run this session.

| Check | Command | Result | Notes |
|---|---|---|---|
| Full backend suite | `./mvnw -q test` | **PASS** | 303/303 tests, 0 failures, 0 errors, exit 0. |
| Tokenizer/parser tables | `QueryParserTest` | PASS | 30 tests: every valid construct (all 17 aliases, `=`/`!=`/`contains`, `and`/`or` precedence, parentheses, escaping, empty-string literal); malformed input (unknown field, missing operator/value, unterminated string with no literal leak, unbalanced parens both directions, trailing garbage, keyword-as-field, unexpected character, over-length query); adversarial input (500-deep nested parens → bounded-depth error, not a `StackOverflowError`; SQL-injection-looking and SpEL-looking payloads parse as inert plain string literals; 100 chained `and` clauses parse without error). |
| Predicate compiler | `QueryEvaluatorTest` | PASS | 11 tests: `null` expression matches everything; `=`/`!=`/`contains` semantics incl. case-insensitivity and missing-field null-safety; every alias reads the correct field, including the three sensitive aliases reading from `RawSensitiveFields`, not a plain accessor; `and`/`or`/nested composition. |
| Redaction (explanation) | `QueryPlanExplainerTest` | PASS | 5 tests: a sentinel literal never appears in the rendered explanation for any operator, alias (sensitive or not), or nested `and`/`or` structure. |
| Redaction (defense in depth) | `QueryRedactionTest` | PASS | 6 tests: a raw `Token`, a `Comparison` AST node, and `SearchRequest#toString()` (for both `query` and `rawLogQl`) never reveal a literal value even via direct `toString()` — the same architectural pattern as `RawSensitiveFields`/`RawToken`; the `SearchRequest.Builder#query(String)` eager-parse-and-throw behavior. |
| Loki-path planner | `LogQlDslPlannerTest` | PASS | 7 tests: a bare `service = "..."` equality is the only case ever extracted; `!=`/`contains`/any other field/`and`/`or` all correctly return empty (never guessed at). |
| Shared structured-filter + DSL integration | `EventFiltersTest` | PASS | 17 tests (8 new/changed this phase): the `loggerContains` fix; DSL ANDed with every structured filter (matching, mismatched-DSL, mismatched-structural); DSL alone with no structured filters; DSL `and`/`or` combinations; and the equivalence test — the identical DSL query evaluates identically regardless of which adapter's enrichment fields (`sourceId`/`containerName`/`namespace`/`pod`/...) are set on the event. |
| Loki adapter (planner path + raw LogQL) | `LokiLogSourceTest` | PASS | 18 tests (5 new this phase): a bare DSL `service = "..."` equality is pushed into the selector when no explicit services list is set; an explicit services list takes precedence over the DSL pushdown hint; raw LogQL is used verbatim as the selector when enabled, and still passes through the same `EventFilters` post-filter afterward; raw LogQL throws defensively (not silently) when not enabled, even though `SearchService` should already have blocked it. |
| Raw-LogQL capability gating | `SearchServiceTest` | PASS | 11 tests (3 new this phase): rejected with `GuardrailViolationException(RAW_LOGQL_NOT_SUPPORTED)` for a source whose capabilities don't allow it; allowed end-to-end for a source that does; a blank `rawLogQl` is never mistaken for a real request. |
| Real HTTP-level wiring | `QueryApiIntegrationTest` | PASS | 5 tests: a valid DSL query parses and succeeds through the real controller; an invalid one returns 400 with a `position` property and never leaks the literal; an unterminated string literal returns 400; raw LogQL is rejected (400, `reason=RAW_LOGQL_NOT_SUPPORTED`) for an unsupporting source and accepted for a supporting one. |
| Query/raw-LogQL never logged | `QueryLeakTest` | PASS | 3 tests, same technique as `LogLeakTest`/`LokiTokenLeakTest` (root Logback appender raised to DEBUG): a sentinel DSL literal never appears in captured logs for a successful search; a DSL syntax error never logs or returns the literal (including the `ProblemDetail` body); a rejected raw-LogQL request never logs or returns the raw LogQL text. |
| Secret/unsafe-pattern scan | `grep` across `core/query/`, `source/loki/plan/` | PASS | Zero hits for SpEL/`ScriptEngine`/reflection/`ProcessBuilder`/credential patterns. |

## Manual check — DSL queries against the demo stack, predicate vs. planner path

Per the plan: *"Run several DSL queries against the demo stack and confirm result equivalence between Docker (predicate) and mock-Loki (planner) paths for the same logical query."*

1. Booted the real packaged backend (`dev` profile — enables `FixtureLogSource`, the predicate-path reference used throughout this project's manual checks since Phase A2b) alongside `tools/mock-loki` (Phase A2a's standalone mock gateway, wired as `openshift-loki`'s real upstream) — no code changes, pure env-var configuration, exactly as a real deployment would.
2. Ran three DSL queries verbatim against **both** `sourceId=fixture` and `sourceId=openshift-loki`, over each source's own real data window:
   - `service = "gateway"` → fixture: 25/25 returned events had `service="gateway"`. Loki: 5/5 returned events had `service="gateway"`.
   - `level = "ERROR"` → fixture: 3/3 returned events had `severity="ERROR"`. Loki: 4/4 returned events had `severity="ERROR"`.
   - `(service = "gateway" or service = "notification-worker") and level = "INFO"` (adjusted per source to a service pair present in that source's own fixture data) → fixture: 52/52 events were `(gateway|accounts-api, INFO)` only. Loki: 8/8 events were `(gateway|notification-worker, INFO)` only.
3. **Result**: identical DSL query text produced correctly, consistently filtered results on both independently-implemented adapters — same semantics hold across the predicate path and the planner path, which is the manual check's intent. (The two adapters' underlying datasets are independently generated fixtures — Docker/fixture's deterministic corpus vs. mock-Loki's own — so this demonstrates semantic equivalence of DSL enforcement, not literal identical event sets between two different data sources, which was never the claim.)
4. Also manually confirmed at this live boot: a malformed DSL query (`bogus = "x"`) returns `400` with `Unknown field 'bogus' (position 0)`; raw LogQL is rejected (`400`, `RAW_LOGQL_NOT_SUPPORTED`) for both `fixture` and `openshift-loki` in this boot's default (disabled) configuration.
5. Cleaned up: killed the backend and `mock-loki` processes, confirmed via `ps aux` that nothing was left running, removed scratch response files.

## Results

- **PASS:** all 8 Phase E scope items; 303/303 backend tests (was 222 at Phase D's completion — 88 new/changed tests this phase); grammar complete; predicate/planner equivalence demonstrated both structurally (same evaluator) and by live manual verification; redaction verified at three independent layers (parser errors, plan explanation, `toString()` defense-in-depth); raw-LogQL gating verified at the unit, adapter, and real-HTTP levels.
- **FAIL:** none.
- **BLOCKED:** none.
- **DEFERRED:** none — this phase has no live-external-system dependency (the DSL is pure in-process logic; the Loki planner's HTTP behavior was already fully verified against a mock in Phase D and re-exercised here).

## Regression

Full suite: 303/303 (was 222 at Phase D). Zero pre-existing tests weakened or deleted. `EventFiltersTest`, `SearchServiceTest`, and `LokiLogSourceTest` were extended, not altered in their existing assertions.

## Security check for this phase

- Sensitive values in responses: unaffected — the DSL only ever reads through the same masking-boundary-respecting `CanonicalLogEvent`/`RawSensitiveFields` accessors every other filter already uses; nothing here bypasses `core.mask.MaskingService`.
- Sensitive values in logs or errors: verified at three layers — `QuerySyntaxException` messages (grep + dedicated test), `QueryPlanExplainer` output (dedicated test), and real captured Logback output for both a successful search and a rejected one (`QueryLeakTest`). `Token`/`Comparison` also self-redact in `toString()` as defense in depth, matching `RawSensitiveFields`/`RawToken`'s established architectural pattern.
- No forbidden evaluation mechanism: grep-verified zero matches for SpEL/`ScriptEngine`/reflection/process-execution patterns anywhere in the new code; the AST is a closed algebra with exactly three node types, each compiled to one fixed `switch` branch.
- Raw LogQL: off by default, config-gated, Loki-only (enforced by capability check, not a source-id string comparison), still bounded by every existing guardrail — verified at the unit, adapter, and real-HTTP levels.
- Bounded input: DSL query text capped at 4000 characters; parser recursion capped at depth 60 — both verified by dedicated tests (over-length input, 500-deep nesting).

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 29, 30 → **Done**. The "Raw LogQL is off by default and not a dominant disabled control" superseded-decision row → **Partial** (backend half done; the UI half has no UI to apply it to yet — Phase F).

## Known gaps carried forward

- The DSL is not yet wired into any UI — Phase F's job (universal search / advanced filters).
- `LogQlDslPlanner` only ever pushes down a single bare top-level `service = "..."` equality; it deliberately never attempts to translate `level`/`message`/`traceId`/etc. into LogQL line/label-extraction stages (those fields live inside the JSON log body, not as Loki stream labels — pushing them down would mean generating LogQL from arbitrary user input, a materially larger and riskier feature this phase does not build). Documented as a deliberate scope boundary, not an oversight; correctness is unaffected since `EventFilters` always still applies the full predicate regardless.
