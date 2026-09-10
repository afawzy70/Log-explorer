# Filter Functional Audit — LERUX-1

Companion to `OLD_UX_RESTORATION_AUDIT.md`. Traces the five layers (UI
control → client request model → wire payload → backend handling →
rendered result) for a representative sample of filters, per the
`log-explorer-professional-ux-reviewer` [LERUX-1] skill's own protocol.
Real evidence only — every row below was either driven through the real
running app + real dev-profile backend (Fixture source), or traced in the
current source code and cross-referenced against that real evidence.

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

- The remaining ~10 advanced filter fields (`userName`, `cif`, `deviceId`,
  `deviceIp`, `spanId`, `correlationId`, `journeyId`, `eventId`,
  `uiIdentifier`, `loggerContains`, `devicePlatform`, `language`) were
  **not** individually empirically tested this pass — each was confirmed
  present in `SearchRequestDto` and confirmed to have a real predicate in
  the shared `EventFilters.matches()` (read directly, quoted in the
  method body above), giving reasonable confidence given the demonstrated
  correctness of the general mechanism, but this is source-code
  confirmation, not the same empirical bar as the fields tested live.
- Raw LogQL mode (Loki-only, capability-gated) was not exercised — this
  session has no real OpenShift/Loki gateway available; the Fixture and
  Docker sources never enable it.
- Docker/Loki-specific **push-down** behavior (what each adapter's own
  query-plan optimizer sends to the underlying source's own query
  language vs. what falls back to post-filtering) was not independently
  re-verified this pass — `EventFilters` itself is shared, but each
  adapter's own push-down logic is a separate code path per source; this
  is exactly the class of thing slice UX-R2's proposed full matrix should
  cover per-source, not just per-field.
- Filter *combinations* beyond the one two-field AND case tested were not
  exhaustively covered.
- Time range and severity-level filtering were not separately re-verified
  this pass (both are older, heavily-tested paths from earlier phases,
  lower risk, and not named in the owner's "filters appear not to work"
  concern).

## Conclusion

`FILTER_FUNCTIONAL_AUDIT=PASS` for every filter actually tested, on real
evidence. The owner's perception that filters don't work has no
functional root cause found by this audit — plausible explanations worth
investigating in the next slice rather than assumed here: (a) confusion
between the draft/Apply two-step interaction (a filter typed but not yet
"Applied" naturally produces unfiltered results, which could read as "the
filter didn't do anything"); (b) a specific untested field or source
(Docker/Loki rather than Fixture) genuinely does have a gap this sample
didn't happen to hit; (c) a UX clarity issue (no visible confirmation
that a filter narrowed the result set, especially when a filter matches
nearly everything or nothing). Recommend the exhaustive matrix in UX-R2
partly *to settle this open question with full coverage*, not only to
guard against future regressions.
