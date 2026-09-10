# Filter Functional Audit — LERUX-1

Companion to `OLD_UX_RESTORATION_AUDIT.md`. Traces the five layers (UI
control → client request model → wire payload → backend handling →
rendered result) for a representative sample of filters, per the
`log-explorer-professional-ux-reviewer` [LERUX-1] skill's own protocol.
Real evidence only — every row below was either driven through the real
running app + real dev-profile backend (Fixture source), or traced in the
current source code and cross-referenced against that real evidence.

**Status: CLOSED as of UX-R2** for the Fixture source (all 17 advanced
filter fields + `text` + the guided Query builder, each with real
included-and-excluded evidence) and for the specific real-Docker scenario
UX-R2's own mission required (the search-freshness defect, using a real
service-scoped filter against a real container). See
`docs/verification/UX_R2_FILTER_AND_SEARCH_FUNCTIONAL_REPORT.md` for the
11 fields this document originally left untested (userName, cif, deviceId,
deviceIp, spanId, correlationId, journeyId, eventId, uiIdentifier,
loggerContains, devicePlatform, language), the loggerContains
substring-match proof, and a two-field AND-combination proof. **Not
closed**: Docker/Loki-specific per-adapter push-down/optimization behavior
(as opposed to the shared `EventFilters` matching logic itself, which
generalizes across sources) was not independently re-verified field-by-
field this pass; Loki/OpenShift remains `BLOCKED` — no reachable cluster
in this environment. The representative sample below (this document's
original content, unmodified) remains valid, real evidence — UX-R2 only
*adds* to it, nothing here was found incorrect.

## Headline finding

**No broken filter was found.** The owner's report that filters "appear
not to work" is not reproduced by this audit. Every filter tested was
verified end-to-end, for real: the value typed in the UI reached the
actual network request body unchanged, the backend applied it correctly
(right events included, right events excluded, zero results for a value
that shouldn't match anything), and — for the one sensitive field tested
— the raw value never leaked back into the response even when used as a
filter.

This is a **representative sample, not exhaustive coverage** of all 17+
advanced filter fields, Live's own client-side filters, and every
combination. Full matrix coverage is proposed for implementation slice
UX-R2 (see `OLD_UX_RESTORATION_AUDIT.md`).

## Method

Real dev-profile backend (`SPRING_PROFILES_ACTIVE=dev`, port 3434,
Fixture source — deterministic, synthetic, documented corpus generation
in `FixtureCorpusGenerator.java`). Two verification paths, both used:

1. **Direct API calls** (`curl` against `POST /api/v1/logs/search`) with
   known-deterministic Fixture values, checking the actual returned event
   set against the expected included/excluded set.
2. **Real browser, real network capture** (a throwaway Playwright script
   against the real dev server on port 3435, deleted after use — not
   committed) — typed a value into the real rendered More Filters
   drawer/Query builder, clicked Apply then Search, and captured the
   actual `POST /api/v1/logs/search` request body via Playwright's own
   `page.on('request')`, closing the loop between "what the user typed"
   and "what left the browser."

## Shared filter mechanism (source-code finding, confirms why coverage generalizes)

`backend/src/main/java/com/logexplorer/core/search/EventFilters.java` is
the **one shared predicate** every `LogSource` implementation's `search()`
routes through (fixture, Docker, Loki) — not three separate, potentially-
diverging implementations. Its own doc comment records two real bugs an
earlier phase found and fixed here specifically: Docker's search
originally never applied any of these structured filters at the
individual-event level at all (only container/service-level), and
`loggerContains` arrived on the DTO but was never actually checked
anywhere. Both are already fixed, with regression tests, before this
session began. This is why a representative sample generalizes reasonably
well across sources for the *filtering logic* itself (though not across
each adapter's own separate *push-down* optimization — see "Not covered"
below).

## Filter functional trace

| Filter | UI control | Request field | Backend field | Adapter handling | Expected dataset | Actual dataset | Status | Root cause | Test evidence |
|---|---|---|---|---|---|---|---|---|---|
| Trace ID | More Filters → Request flow → Trace ID | `traceId` | `SearchRequestDto.traceId` → `EventFilters.matches` exact-match | Shared `EventFilters`, applied uniformly post-retrieval | `fixture-trace-000340` → exactly the events sharing that trace; a bogus value → 0 | Confirmed: 2/2 events returned all matched; bogus value → 0 returned | `PASS` | — | Direct API: real curl against `/api/v1/logs/search`, this session |
| Error code | More Filters → What happened → Error code | `errorCode` | `SearchRequestDto.errorCode` → `EventFilters.matches` exact-match | Shared `EventFilters` | `ERR_TIMEOUT` → only matching events | 66/66 returned events matched `ERR_TIMEOUT` | `PASS` | — | Direct API, this session |
| Business step + Error code (combined AND) | More Filters → What happened → Business step, Error code | `businessStep`, `errorCode` | Both applied as separate `EventFilters` predicates, implicitly ANDed | Shared `EventFilters` | `credit-account` AND `ERR_VALIDATION` → only events matching both | 9/9 returned events matched both conditions | `PASS` | — | Direct API, this session |
| Message text | Universal search box | `text` | `SearchRequestDto.text` → case-insensitive `contains` on `message` | Shared `EventFilters` | Only events whose message contains the term | Confirmed correct semantics (searches `message` only, not other fields — a 0-result case for a term present in `businessStep` but not `message` is correct exclusion, not a bug) | `PASS` | — | Direct API, this session |
| Customer ID (sensitive/protected) | More Filters → Who/customer → Customer ID | `customerId` | `SearchRequestDto.customerId` → `RawSensitiveFields` exact-match against the adapter's own raw (never-serialized) value | Shared `EventFilters`; masking applied independently for the *response* | `DEMO-CUST-200000` → exactly 1 known event | 1/1 returned, and a full-response `grep` for the raw filter string found zero occurrences (never echoed back, even as the filter that produced the match) | `PASS` | — | Direct API, this session — this is the highest-value check: confirms filtering-by-raw-value and never-serializing-the-raw-value are both true simultaneously |
| Guided Query builder (`businessStep = "credit-account"`) | Query → guided condition builder → Apply | `query` (generated DSL text) | `SearchRequestDto.query` → `QueryParser`/`QueryEvaluator` | Shared `EventFilters` (query ANDed with every structured filter) | 49 events, all matching `businessStep = credit-account` | Confirmed: real browser → real network capture showed `"query":"businessStep = \"credit-account\""` reached the wire exactly as built; direct API replay of that exact string returned 49/49 matching events | `PASS` | — | Real Playwright network capture + direct API replay, this session |
| Full UI→wire pipeline (3 fields at once: Trace ID, Error code, Customer ID) | More Filters, three fields filled, Apply, Search | `traceId`, `errorCode`, `customerId` | Same DTO fields as above | Shared `EventFilters` | The exact typed values reach the request body unchanged | Confirmed: real network capture showed all three values present, unmodified, in the actual `POST /api/v1/logs/search` body | `PASS` | — | Real Playwright network capture, this session |
| Live tail severity/text filters | Live workspace's own severity toggle + text box | N/A — client-side only, over the already-retained bounded buffer | N/A (server request, `FollowRequest`, only ever carries `sourceId`/`services` — no structured filters by design) | `LiveTailPanel.tsx`'s own `useMemo` filter over `live.visibleEvents` | Filters only what's already buffered, since Live has no time range to re-query | Confirmed by source reading (`LiveTailPanel.tsx`'s own doc comment: "Severity/text filtering here is purely local/client-side...") — this is the same scope OLD's own Live filters had (client-side over the retained buffer, not a server re-query) | `PASS` (working as intended) | N/A | Source reading, cross-checked against the OLD-app documentation's own description of Live's scope |
| Query plan value display | Any query/filter → response `queryPlan.resolvedQuery` | N/A (display only) | `QueryPlanBuilder`/`QueryPlanExplainer` | N/A | A resolved query string a user could sanity-check | Observed: even a **non-sensitive** value (`businessStep = credit-account`) is masked to `***` in the displayed `resolvedQuery` (`'businessstep = ***'`) | `UX_MISLEADING` (minor) | Likely an intentionally conservative "never echo a filter value in the plan" blanket policy rather than a bug — see note below | Direct API, this session (`queryPlan` field in the response) |

### Note on the one `UX_MISLEADING` finding

The query plan's `resolvedQuery` masks **every** filter value with `***`,
including non-sensitive ones like `businessStep`. This is very likely
deliberate (the same conservative policy that keeps a sensitive value out
of the plan, applied uniformly rather than per-field), and
`QueryPlanLeakTest` (backend) exists specifically to guarantee a raw
sensitive value never leaks via this path — so this is almost certainly
intentional and should not be casually "fixed" without checking that
test's own intent first. Flagged here only because a user watching the
query plan to sanity-check a *non-sensitive* filter (e.g. "did my
businessStep filter apply?") gets less transparency than they could
safely have. Recommend: `DEFER` — worth a narrow, deliberate follow-up
(mask only genuinely sensitive fields' values in the plan) rather than a
change bundled into this UX mission.

## Not covered in this pass (be honest about the gap)

**Update (UX-R2): the item below about the ~10 remaining advanced filter
fields is now closed** — see
`docs/verification/UX_R2_FILTER_AND_SEARCH_FUNCTIONAL_REPORT.md` for the
full empirical evidence (real inclusion/exclusion counts, sensitive-value-
never-echoed proof, loggerContains substring proof, a two-field AND
combination). The remaining items below are still genuinely open.

- ~~The remaining ~10 advanced filter fields...~~ **CLOSED, see above.**
- Raw LogQL mode (Loki-only, capability-gated) was not exercised — this
  session has no real OpenShift/Loki gateway available; the Fixture and
  Docker sources never enable it. **Still BLOCKED as of UX-R2**, same reason.
- Docker/Loki-specific **push-down** behavior (what each adapter's own
  query-plan optimizer sends to the underlying source's own query
  language vs. what falls back to post-filtering) was not independently
  re-verified this pass — `EventFilters` itself is shared, but each
  adapter's own push-down logic is a separate code path per source. **Still
  not independently re-verified as of UX-R2** — the freshness-defect test
  exercised a real Docker service filter, but not this specific dimension.
- Filter *combinations* beyond the two two-field AND cases now tested
  (`businessStep`+`errorCode` here, `journeyId`+`services` in UX-R2) were
  not exhaustively covered — an intentional scope limit, not a gap.
- Time range and severity-level filtering were not separately re-verified
  as *filters* this pass — but UX-R2 found and fixed a real, related
  defect in the time-range *mechanism itself* (a relative preset's window
  going stale across repeated Search clicks) — see explanation (b) below,
  which this predicted almost exactly.

## Conclusion

`FILTER_FUNCTIONAL_AUDIT=PASS` for every filter actually tested, on real
evidence, and now exhaustive for the Fixture source as of UX-R2. The
owner's perception that filters don't work has no *filter-matching*
functional root cause found by either audit — but UX-R2 did find and fix a
real, adjacent defect this audit's own explanation (b) predicted almost
exactly: not a specific untested *field*, but the *time-range mechanism*
itself going stale across repeated Search clicks (a relative preset's
window was computed once at selection and never advanced) — real enough
that new logs created after a preset was picked could never appear no
matter how many times Search was clicked, which plausibly reads exactly
like "filters don't work" to an investigator repeating a search during a
live incident. Fixed in UX-R2 (`docs/verification/
UX_R2_FILTER_AND_SEARCH_FUNCTIONAL_REPORT.md`). The other two original
explanations remain worth keeping in mind for UX-R3+: (a) confusion
between the draft/Apply two-step interaction, and (c) a UX clarity issue
(no visible confirmation that a filter narrowed the result set). Recommend the exhaustive matrix in UX-R2
partly *to settle this open question with full coverage*, not only to
guard against future regressions.
