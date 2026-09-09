# Legacy Remediation Slice 1 — Result-Set Completeness — Verification Report

Branch: `phase/legacy-slice-1-result-set-completeness`
Date: 2026-09-09
Authoritative plan: `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 1 — Result-set completeness", as amended by the owner/reviewer's mandatory architecture corrections in the approval message. This report follows that amended scope; where this report and the plan's original prose differ, the corrections in the approval message govern (as instructed).

## Prerequisite

`main` was clean at `55ee9e5` (the legacy-parity-audit commit) before branching — confirmed via `git status --short`.

## Scope delivered

Exactly Slice 1, nothing else:

1. Real, opaque, integrity-protected, search-bound cursor pagination for `POST /api/v1/logs/search` (Docker, Loki, Fixture).
2. Truthful `ResultCounts.estimatedTotal` semantics (exact only when genuinely known; explicit `null`/UNKNOWN otherwise — never `returned`-as-total, never a fabricated or stale-reused number).
3. A compact "Refresh" workspace action.
4. Frontend: real page-append (with defensive dedup), a `loadMoreError` state distinct from `searchError` (a page-load failure never hides already-loaded results), inspector-selection preservation across a page append, and truthful cumulative counts wording.
5. No Slice 2+ work, no unrelated refactors. `REQUIREMENTS_TRACEABILITY.md` untouched — this is a remediation slice, not a new phase of the original plan.

## Architecture (per the mandatory corrections)

**Cursor is opaque, integrity-protected, and search-bound (correction #1).** `core/search/PageCursorCodec.java` (new): a `PageCursorPayload` (version, sourceId, boundary epoch-millis, boundary dedup keys, direction, page index, request fingerprint) is JSON-serialized, HMAC-SHA256-signed with a key generated once via `SecureRandom` at process boot (never configured, never persisted, never logged — a pagination cursor is a short-lived, single-session artifact, so a fresh per-boot key gives real tamper-evidence without a new long-lived secret to operate), and Base64url-encoded as `<payload>.<signature>`. `requestFingerprint` is a SHA-256 digest over every field that defines "what this search means" (source, time range, direction, limit, every structured/text/DSL/raw-LogQL filter, **including the five raw sensitive values, fed into the one-way digest, never stored verbatim** — the plan's own explicit instruction: "prefer a canonical request fingerprint rather than embedding raw filters"). A cursor decoded against a request whose recomputed fingerprint differs, or whose `sourceId` differs, is rejected — a cursor from search A can never widen or change search B. Malformed/tampered/mismatched cursors all map to one `GuardrailViolationException(Reason.INVALID_CURSOR)` → a sanitized 400 `ProblemDetail` whose message is a fixed string, never the cursor value or any decoded field.

**Cursor lives in the POST body (correction #2).** `SearchRequestDto`/`SearchRequest` already had a `cursor` field (built in an earlier phase but never wired) — no new query-param API was added; one coherent `/search` contract.

**Loki/Docker duplicate-timestamp safety (correction #3).** None of the three sources offer a native "resume after this row" cursor — Docker's log API and Loki's `query_range` both only support "the newest N entries within `[start, end]`." A continuation page is obtained by re-issuing the same search with `end` narrowed to the previous page's oldest (boundary) timestamp **+1ns** (so that instant is *included*, not excluded — every source's `end` filter in `core/search/EventFilters.java` is exclusive, and this narrowing needs no change to that shared, heavily-depended-on rule). Events at exactly the boundary timestamp that the previous page already returned are filtered back out using content fingerprints (`PageCursorCodec#eventFingerprint` — never reads `CanonicalLogEvent#sensitive()`) carried in the cursor. Proven directly, not assumed: `SearchServicePaginationTest#identicalTimestampsAtAPageBoundaryAreNeverSkippedOrDuplicated`, `DockerLogSourceTest#searchServicePaginationAcrossTwoContainersWithTiedTimestampsVisitsEveryEventExactlyOnce` (two containers logging at the exact same instant), `LokiLogSourceTest#identicalTimestampsAtALokiPageBoundaryAreNeverSkippedOrDuplicated`.

**Truthful totals (correction #4).** `estimatedTotal` is exact only for page 1 (no cursor) when that single page is *not* truncated — i.e. the whole committed search window was genuinely, completely scanned in one bounded pass. Every other case (page 1 truncated, or any continuation page — including the last one) reports `null`, explicit UNKNOWN, never fabricated and never silently carried forward from an earlier page. Loki never gets a separate count query. See "A real bug found via live-Docker verification" below for a case this rule's naive implementation got wrong, and the fix.

**Bounds preserved (correction #5).** `SearchGuardrails` (max time range, max limit, request timeout), `ConcurrencyGuard` (max concurrent searches), and every adapter's own per-request read bound (Docker `defaultTailLines`/`maxContainers`, Loki `maxResultsPerQuery`, fixture's fixed corpus) are all **unchanged** — `SearchService` now `.collectList()`s the already-adapter-bounded `Flux` instead of an additional `.take(limit+1)` in front of it (that extra take never reduced memory below the adapter's own existing bound anyway — every adapter already fully materializes its bounded result before this Flux emits — but it *was* silently discarding the true page size, which is exactly what made truthful truncation/total detection impossible before this slice). "Load all" was never implemented and is not required — each page request is independently bounded exactly as before; a user keeps paging until the source's own bounded search space is exhausted.

**Refresh semantics (correction #6, "inspect the existing rule before implementing").** Inspected: `TimeRangeControl.tsx` resolves a relative preset ("Last 1 hour", etc.) to an absolute ISO `start`/`end` **only at preset-selection time** — clicking "Search" (or, now, "Refresh") never re-resolves "now." So Refresh reuses the exact committed `timeRange` unchanged, matching the existing rule exactly. Concretely, Refresh **is** `runSearch` (`useSearchState.ts`, exported as `refresh: runSearch`): same filters, same source, same committed time interval, cancels any in-flight request (`supersedeActiveRequest`), never carries a cursor forward (a plain page-1 request), never touches `advancedFilters`' un-applied draft state (that state is owned entirely by `AdvancedFilters.tsx`'s own Apply/Cancel, untouched by `runSearch`), and preserves the overall workflow (same reset-on-fresh-search behavior every other `runSearch` call already had — inspector/breadcrumb/journey mode cleared, exactly as before).

## A real bug found and fixed via live-Docker verification, not code review

Real Docker (this host's own running `sofra` Compose stack — `caddy`/`db`/`web`, unrelated to Log Explorer itself, used here only as a source of real, non-synthetic container log volume) was queried through the real backend:

```
$ curl -s -X POST http://127.0.0.1:8080/api/v1/logs/search -H "Content-Type: application/json" \
    -d '{"sourceId":"local-docker","start":"2026-09-03T00:00:00Z","end":"2026-09-09T23:59:59Z"}'
```

270 real matching events exist (genuinely exceeding the 200-event default page), but **every one of them parsed with `timestamp: null`** (these containers emit plain-text/non-Spring-Boot-JSON logs, so `LogLineParser` correctly falls back to a raw/malformed event for each line — CLAUDE.md §4 "malformed lines become raw fallback events... never silently dropped"). The initial implementation's `buildNextCursor` correctly found no safe boundary among timestamp-less events (by design — offering a cursor there could skip or duplicate) and returned `nextCursor = null`, but the surrounding code then computed `truncated = (nextCursor != null) = false` and, downstream, `estimatedTotal = page.size() = 200` — **silently claiming the 200-event page was the complete, exact result**, hiding the other 70 real events with no indication anything was missing. This is precisely the "malformed lines... never silently dropped" violation this slice exists to close, self-inflicted by an over-tight coupling between "can we offer a cursor" and "is this page actually complete."

**Fix.** `truncated` now reflects `moreWithinThisFetch` (whether more matching events exist beyond the page limit) **independently** of whether a safe cursor could be derived; `estimatedTotal` stays `null` in that case too. The UI now honestly shows "truncated — total unknown for this source" with no Load More button for this rare edge case, instead of falsely claiming completeness. Verified against the same real Docker data after the fix:

```
counts: {'estimatedTotal': None, 'returned': 200, 'visible': 200, 'limit': 200, 'truncated': True}
nextCursor: None
```

**Regression test.** `SearchServicePaginationTest#aPageOfEntirelyTimestamplessEventsReportsTruncatedHonestlyEvenThoughNoCursorCanBeOffered`.

## Automated tests

**Backend** — 394/394 (`./mvnw -o test`, from `main` this branched from: 378 baseline + 16 net new/extended here). New/extended files:
- `core/search/PageCursor.java`, `PageCursorPayload.java`, `PageCursorCodec.java` (new production code).
- `core/model/SearchRequest.java` (`withEnd`), `core/guard/GuardrailViolationException.java` (`INVALID_CURSOR` reason), `api/SearchService.java` (rewritten pagination orchestration).
- `core/search/PageCursorCodecTest.java` — encode/decode round-trip, tamper (payload and signature) rejection, malformed-cursor rejection, source-mismatch rejection, filter-widening rejection, time-window-mismatch rejection, opacity (no raw sensitive value verbatim), error-message sanitization, `eventFingerprint` never touches sensitive fields.
- `api/SearchServicePaginationTest.java` (new, + `api/InMemoryFilteringLogSource.java` test double) — multi-page exhaustive traversal (no skip/no dup), identical-timestamp boundary case, exact-vs-unknown total (page 1, continuation, last page), cursor rejected when replayed against a widened filter set, malformed cursor never falls back to page 1, a fresh (cursor-less) request always returns page 1 regardless of prior pagination ("Refresh" at the orchestration level), and the timestamp-less-page honesty fix above.
- `source/docker/DockerLogSourceTest.java` (+2 tests) — real multi-page traversal through a real `SearchService`+mocked-I/O `DockerLogSource`, including two containers tied at the same instant.
- `source/loki/LokiLogSourceTest.java` (+2 tests) — same, against `MockLokiServer`, including the identical-timestamp boundary case.
- `source/fixture/FixtureLogSourceTest.java` (+1 test) — paging with a small limit visits exactly the same event set as one unpaginated wide-open search.
- `api/CursorLeakTest.java` (new) — HTTP-level: a real cursor never contains a raw sensitive filter value verbatim (Logback-appender + response-body inspection, same technique as `QueryLeakTest`); an invalid cursor's error response never echoes the cursor value or decoded content.
- `source/fixture/FixtureLogSource.java` — `CORPUS_SIZE` 120→250, so a real, un-doctored default-limit (200) browser search against this source genuinely needs "Load more" (documented in that class's own comment) — the only way to demonstrate real end-to-end pagination without depending on an external Docker/Loki deployment happening to have that much history. Confirmed this does not depend on or break any other test's assumption of a specific corpus size (`FixtureCorpusGeneratorTest` uses its own explicit `count` params, not this constant).

**Frontend** — 301/301 (`npx vitest run`, from a 288-baseline this branched from + net new/extended here). New/extended:
- `features/results/counts.ts`/`counts.test.ts` — `buildCountsSummary`'s new optional `cumulativeVisible` param (compared against nothing from the latest page's own `returned`, which is a meaningless cross-page comparison); explicit "total unknown for this source" wording once paging starts.
- `app/useSearchState.ts`/`useSearchState.test.ts` — `loadMoreError` (distinct from `searchError`), defensive client-side dedup on append (`eventIdentity`), `refresh` (alias for `runSearch`), inspector-selection preservation across a page append, retry-via-`loadMore`-again after a failed page load.
- `features/results/ResultsPanel.tsx`/`.test.tsx` — Refresh action (summary row + empty-results state), inline Load-More error + Retry (never replaces the already-shown table), cumulative counts wording, extended the existing full-state a11y sweep (jest-axe) to cover the new `loadMoreError` state.
- `app/Toolbar.test.tsx`, `features/inspector/EventInspector.test.tsx`, `features/journey/JourneyView.test.tsx` — their shared `SearchState` mock helpers updated for the two new state fields (`loadMoreError`, `refresh`); a `tsc --noEmit -p tsconfig.app.json` full-project typecheck (the bare `tsc --noEmit` at the repo root does not actually check anything against a solution-style `tsconfig.json` with `files: []` — a false-negative check corrected mid-slice) is what surfaced these four call sites.

**Browser (Playwright, real backend `SPRING_PROFILES_ACTIVE=dev` + real frontend dev server)** — 80/80 for the full `e2e/` suite (76 pre-existing + 4 new), including two pre-existing specs that needed a small, directly-necessitated fix (below).

New: `e2e/phase-legacy-slice1-pagination.spec.ts` (4 tests):
1. Fixture search exceeds 200 events; paging repeatedly reaches real exhaustion (Load More disappears) with a correctly increasing cumulative count and zero duplicate rows.
2. Opening the inspector before Load More: the dialog stays open on the same event, and the same row stays at the same position, after the page grows (investigation context survives).
3. Table geometry stays within the 2px invariant and there is no horizontal overflow after Load More, at a narrow width (390px) and 200% zoom.
4. Refresh resets paging back to page 1 (row count returns to the original page-1 count, and a fresh "Load more" is offered again — not just a coincidentally-matching count).

**Two pre-existing specs required a small, directly-necessitated fix** (not unrelated cleanup — a direct consequence of the `CORPUS_SIZE` change above, which itself is the only way to get real >200-event Fixture volume for check 1 above): `phase-i-journey-investigation.spec.ts` (a discovered journey's event row could now land past page 1) and `phase-m-ux-acceptance.spec.ts`'s malformed-line task (malformed events sort last, so they can now fall past page 1 once the corpus genuinely exceeds it). Both now click "Load more" (bounded, ≤15 clicks) until the target becomes visible, rather than assuming page-1 visibility — testing the exact real capability this slice built instead of working around it.

## REAL_DOCKER_MULTI_PAGE — BLOCKED (with real evidence)

Real Docker was reachable in this environment (this host's own unrelated `sofra` Compose stack) and genuinely has more than one page of matching log volume (270 events > 200-event default page — see the real bug section above). However, **true cursor-based multi-page traversal could not be demonstrated against it**: every one of those 270 events parses with `timestamp: null` (non-JSON container logs → malformed fallback events), and this slice's cursor mechanism deliberately refuses to offer a boundary when no event on the page has a parsed timestamp (correctness over completeness — the alternative would be a boundary that could skip or duplicate). This is not a lack of volume; it is a real, honestly-reported structural limit of the specific real containers available in this environment (none of them are Log Explorer's own JSON-formatted app logs). Per the mission's own instruction, this is reported as **BLOCKED**, not manufactured as a PASS — the timestamp-less-page honesty fix above (verified against this exact real data) is the correctness guarantee that matters here, and it is real, not simulated. Deterministic Fixture and mocked-Docker/Loki coverage (which does include real multi-container, tied-timestamp scenarios) fully executed regardless, per the mission's own fallback instruction.

## Documentation

- `docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md` — rows `TABLE-08`, `SEARCH-11`, `SEARCH-16` updated in place with this slice's real evidence and reclassified `NEW_FULL`/`PRESERVE_AS_IS`. No other row touched. The matrix's overall summary counts and `READY_FOR_REMEDIATION_PLAN_REVIEW` line in `docs/LEGACY_PARITY_OWNER_SUMMARY.md` are **not** updated by this report — per the mission's explicit instruction, this report does not claim the entire legacy remediation is complete; only Slice 1 is.

## Known, deliberate non-scope (unchanged by this slice)

- Slices 2–9 of `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` (query transparency, Docker connection UI, results-table configurability, live-tail resilience, etc.) — not started.
- `CanonicalLogEvent` gained no new field; `eventIdentity`/`eventFingerprint` are computed, not stored.
- The rare timestamp-less-page-with-more-data case (found above) reports `truncated=true` with no way to page further — an honest limitation, not silently worked around; a future slice could special-case Docker's own receive-timestamp as a fallback boundary key if this proves to matter for real JSON-emitting workloads too, but that was not needed to satisfy this slice's own acceptance criteria and would be new scope.

## Final report

```
SLICE=1
STATUS=PASS
BRANCH=phase/legacy-slice-1-result-set-completeness
BASE_SHA=55ee9e51797b324e384cd8a24e0ae3f39e1aeb30
HEAD_SHA=f37f5ca10c631d63b98e1425e259a215f3cf16c2
PR=https://github.com/afawzy70/Log-explorer/pull/18
FILES_CHANGED=32 files changed, 2119 insertions(+), 49 deletions(-)
BACKEND_TESTS=394/394
FRONTEND_TESTS=301/301
E2E_TESTS=80/80
CURSOR_TAMPER_TEST=PASS
CURSOR_SEARCH_BINDING_TEST=PASS
LOKI_IDENTICAL_TIMESTAMP_TEST=PASS
PAGINATION_NO_SKIP_NO_DUPLICATE=PASS
RESULT_TOTAL_SEMANTICS=PASS
REFRESH=PASS
TABLE_GEOMETRY=PASS
REAL_DOCKER_MULTI_PAGE=BLOCKED
REGRESSIONS=0 (two pre-existing Playwright specs required a small, directly-necessitated fix for the larger fixture corpus — see above; both green)
OWNER_ACTION_REQUIRED=NO
```
