# Search latency investigation and safe optimization

Mission: `SEARCH_LATENCY_INVESTIGATION_AND_SAFE_OPTIMIZATION`. Branch:
`perf/search-latency-investigation`. This file is the durable checkpoint —
read this before re-investigating; do not re-derive what is already proven
here.

## Method

Backend-only investigation (frontend request/response code was read but
not independently profiled — see Known limitations). No production database,
no caching added, no semantics changed. Evidence sources:

1. Code trace of the real search path (Phase 1, below).
2. A bounded JUnit benchmark, `backend/src/test/java/com/logexplorer/perf/SearchPipelinePerformanceTest.java`,
   isolating the CPU-bound per-event pipeline (JSON parse + field mapping,
   classification, `EventFilters`, masking) using the same
   `FixtureCorpusGenerator` shape a real adapter feeds through
   `LogLineParser`. Not JMH (this repo has none); follows the same
   deliberately-generous-ceiling technique as the pre-existing
   `TextRedactorPerformanceTest`.
3. A direct, real-Docker-daemon timing check (`docker logs --tail 2000
   <container>`, 3 containers × 3 reps) against whatever Compose stack was
   already running locally in this environment (an unrelated `sofra-*`
   stack, not Log Explorer's own containers — real daemon I/O either way).
4. Safe diagnostic debug-log timing added to `SearchService.search()` and
   `DockerLogSource.searchBlocking()` for future real-deployment
   observability (Phase 2 deliverable, commit `80eaa8a`).

## Phase 1 — call-path map

| File | Method | Responsibility |
|---|---|---|
| `SearchController.java` | `search` | HTTP boundary, maps DTO → domain, calls `SearchService` |
| `SearchService.java` | `search` | Resolves source, guardrails/limits, decodes pagination cursor, applies concurrency guard + timeout, builds `SearchResult` |
| `LogSource` (Docker/Loki/OpenShift/Fixture) | `search`/`searchWithOutcome` | Source-specific acquisition + per-event parse/classify/filter |
| `DockerLogSource.java` | `searchBlocking` → `readAllContainersInParallel` | Bounded-parallel per-container Docker log read (`flatMap(..., concurrency)`), then merge/sort/parse/filter/classify |
| `DirectPodLogProvider.java` (OpenShift) | `fetchTarget` fan-out | Bounded-parallel per-pod/container read (`flatMap(..., maxConcurrency)`), then parse/filter/classify |
| `LokiLogSource.java` | `toEvents` | One `query_range` call, then per-line parse/filter/classify |
| `LogLineParser.java` | `parse`/`parseUnclassified`/`classify` | JSON parse, field-mapping resolution, (now separable) classification |
| `core.classify.ClassificationEngine` | `classify` | Regex/literal rule evaluation, tag + extraction assignment |
| `core.search.EventFilters` | `matches` = `matchesExceptTags` && `tagsMatch` | Every structured/DSL filter |
| `SearchService.java` | `toResult` | Pagination/cursor/dedup, `ResultCounts`, truncation |
| `EventMapper.java` (api) | `toDto` | Masking boundary (`MaskingService`), `TextRedactor`, classification → `ClassificationDto` |
| Frontend `useSearchState.ts` | `runSearch` | Single `fetch('/api/v1/logs/search')`, no pre-search round-trips |
| Frontend `client.ts` | `runSearch` | Plain `fetch` + JSON parse |

## Baseline (Phase 3 bounded benchmark)

Ran with: `./mvnw -q -o test -Dtest=SearchPipelinePerformanceTest` (3+ warm
iterations per scenario per JUnit method, plus a JIT warm-up pass — see the
test file). Numbers vary with build-machine contention (observed directly:
same test, same JVM logic, produced 305–579ms for "PARSE only" across
different runs depending on what else was running) — ranges below are
across multiple real runs on this machine, not a single cherry-picked run.

```
RAW_EVENTS = 20,000 (representative of defaultTailLines=2000 × 10 containers)

SEARCH_TOTAL_MS        = not measured end-to-end over a live network call (BLOCKED — see Known limitations);
                          backend CPU pipeline alone (parse+classify+filter for 20,000 raw events) = 700-1900ms
                          under full-suite contention, 800-1550ms in isolation
SOURCE_ACQUISITION_MS  = 39-95ms per container (real Docker daemon, tail=2000, this machine) — see Phase 1 table,
                          already bounded-parallel (historicalSearchConcurrency=6 / OpenShift maxConcurrency)
PARSE_MS               = 15,250-28,950 ns/event  (305-579ms / 20,000 events, no classification rules active)
FILTER_MS               = not separately isolated; included in the "full pipeline" delta over parse+classify,
                          which was small (EventFilters conditions are cheap field/Instant comparisons)
MASKING_MS              = 13,600-59,600 ns/event (136-596ms / 10,000 mask+redact calls = a 200-event page rendered 50x)
CLASSIFICATION_MS       = +40% over parse-only with a realistic 10-rule set (19,300-42,150 ns/event parse+classify
                          vs 15,250-28,950 ns/event parse-only); ~0 when zero rules are configured
                          (ClassificationEngine#classify fast-paths on `ruleSet.rules().isEmpty()`)
SORT_LIMIT_MS           = not independently isolated — code-reviewed only (see Hypotheses: SORT_BARRIER)
DTO_SERIALIZATION_MS    = not measured (BLOCKED — no live HTTP call profiled)
FRONTEND_RENDER_MS      = not measured (BLOCKED — no live browser session profiled; code-reviewed only)

CONTAINERS_OR_STREAMS  = benchmark assumed 10 (bounded-parallel, concurrency=6); real local environment had 3
                          running containers (unrelated stack), each 39-95ms for a tail=2000 read
RAW_EVENTS_READ        = up to defaultTailLines(2000) x containers x maxContainers(200) — 20,000 used as the
                          representative benchmark size
EVENTS_MATCHED         = scenario-dependent; the severity=ERROR benchmark scenario kept a nonzero minority of
                          the 20,000-line fixture corpus (assertion only checks >0, not an exact count)
EVENTS_RETURNED        = bounded by effectiveLimit (SearchGuardrailsProperties.defaultLimit=200, maxLimit=5000)

TOP_3_LATENCY_CONTRIBUTORS =
  1. Classification, WHEN rules are configured (now mitigated — see Optimizations)
  2. JSON parse + field-mapping resolution — fixed per-raw-event cost, required to know if an event even
     matches (cannot be pushed to Docker/Loki/OpenShift APIs), not safely reducible without result-completeness risk
  3. Per-container/pod Docker/OpenShift I/O — already bounded-parallel (fixed in a prior PR, #57, for Docker;
     DirectPodLogProvider was already bounded-parallel for OpenShift); sub-100ms/unit in this environment
```

## Hypotheses accepted/rejected

| Hypothesis | Verdict | Evidence |
|---|---|---|
| `FULL_SEARCH_BARRIER` | YES (by design) | `SearchService` javadoc "Totals": every adapter fully materializes its bounded result before the `Mono` emits, which is what makes a truthful, non-guessed `estimatedTotal`/`truncated` possible. Changing this would change count semantics — forbidden by CLAUDE.md §4 "counts stay distinct" / mission's "never change ... pagination semantics." Not touched. |
| `OVERFETCH` | PARTIAL | `defaultTailLines=2000` per container is a fixed cap independent of the requested time range or filter selectivity (Docker since/until narrows the window server-side, but not by content). A selective search still reads up to 2000 raw lines/container. This is a deliberate, already-bounded (not unbounded) design; reducing it further risks missing real matches within the tail window — CLAUDE.md §4 "no unbounded scans" is already satisfied, and further narrowing would trade correctness for speed, which the mission forbids. Not touched — flagged as a known, accepted limitation. |
| `SEQUENTIAL_SOURCE_READ` | NO | Both `DockerLogSource.readAllContainersInParallel` (`flatMap(..., historicalSearchConcurrency)`, added in PR #57 before this mission) and `DirectPodLogProvider` (`flatMap(target -> fetchTarget(...), properties.getMaxConcurrency())`) are already bounded-parallel. Verified by direct code read, not re-implemented. |
| `LATE_FILTERING` | PARTIAL → fixed for the expensive part | Classification (the single most expensive per-event step, ~40% over parse-only) ran unconditionally before every filter, including ones independent of classification (time range, severity, text, trace/correlation IDs, service). Fixed this mission (see Optimizations). The remaining post-parse filters (severity/text/trace/etc.) are cheap field/Instant comparisons — not worth deferring further. |
| `SORT_BARRIER` | PARTIAL / not independently isolated | `DockerLogSource.searchBlocking` sorts the full raw merged line list (up to `maxContainers × defaultTailLines`) before parsing/filtering, not just the survivors. The comparator is a cheap `Instant` compare + container-id tiebreak, so this is judged non-dominant relative to parse/classify (O(n) work with expensive per-item cost) rather than confirmed by a microbenchmark. Flagged as `NEXT_STEP`, not implemented — reordering sort-after-filter is riskier to prove correct (pagination boundary/tie-key logic depends on merged order) and the previous, better-evidenced optimization already achieved a meaningful reduction. |
| `CLASSIFICATION_DOMINANT` | PARTIAL | Dominant only when classification rules are actively configured (a real, owner-prioritized feature — PRs #59/#60). Zero rules ≈ zero added cost (`ClassificationEngine#classify` fast-paths on an empty rule set). Mitigated this mission for the "rules configured but this event doesn't match anyway" case. |
| `FRONTEND_DOMINANT` | NO (code-reviewed only) | `useSearchState.ts#runSearch` issues exactly one `fetch`, no sequential pre-search round-trips, and the default page size (200 rows) is small. Not independently profiled in a live browser — see Known limitations. |
| `SOURCE_API_DOMINANT` | NO | Real Docker daemon `tail=2000` reads measured at 39-95ms per container in this environment (3 containers, 3 reps each), already bounded-parallel. Not the dominant cost relative to the CPU pipeline for realistic container counts. |

## Root cause

**`ROOT_CAUSE`**: Every raw candidate line read from a source (Docker,
Loki, OpenShift) was fully classified (`core.classify.ClassificationEngine`,
regex/literal rule evaluation) *before* `EventFilters` got a chance to
reject it on any other condition — even though classification output
(`CanonicalLogEvent#tags()`) is the *only* thing any `EventFilters`
condition besides the tags filter itself depends on. A search that (for
example) narrows by severity or free text still paid full classification
cost for every raw line, most of which would be discarded regardless of
their tags.

**`EVIDENCE`**: `SearchPipelinePerformanceTest` — classification added
~40% over parse-only cost with a realistic 10-rule set; the "no-result"
scenario (a text filter matching nothing) still cost nearly as much as
parsing+classifying everything, because rejection happened only after both
already ran.

**`EXPECTED_GAIN`**: Proportional to (1 − selectivity) × classification's
share of per-event cost. Measured 20–30% wall-clock reduction for a
moderately selective severity-only filter over 20,000 raw events in this
benchmark; real gain scales with how many classification rules are active
and how selective the search's non-tag filters are. Zero rules configured
→ zero measurable gain (there was nothing to defer).

**`CORRECTNESS_RISK`**: None, by construction — see Optimizations for the
proof. `FieldRef` (what a classification rule can reference) never exposes
adapter-enrichment fields, so classification's output cannot depend on
*when* it runs relative to enrichment; `CanonicalLogEvent#tags()` derives
solely from `#classifications`, so no other `EventFilters` condition can be
affected by deferring it.

**`IMPLEMENTATION_COMPLEXITY`**: Low-medium — 4 call sites (Docker, Loki,
OpenShift `DirectPodLogProvider`; Fixture deliberately excluded, see
Optimizations), a 3-way split of one existing predicate, two new public
methods on an existing parser.

## Optimizations

### #1 — Defer classification until after non-tag filters pass (commit `5ee3f1e`)

- `LogLineParser` now exposes `parseUnclassified` (field-mapping only) and
  `classify` (the deferred second half) as public methods, alongside the
  unchanged `parse` (still classifies eagerly — used by `follow()`/live
  tail, untouched by this mission).
- `EventFilters#matches` is now defined as `matchesExceptTags && tagsMatch`
  — both are now public, `matches` itself is byte-for-byte the same
  composition it always was.
- `DockerLogSource`, `LokiLogSource`, `DirectPodLogProvider` (OpenShift):
  parse unclassified → `matchesExceptTags` → only if true, `classify` →
  `tagsMatch` → keep. A raw line rejected by any non-tag condition never
  touches the classifier.
- `FixtureLogSource` deliberately **not** changed: its entire corpus is
  parsed+classified once and memoized (`corpus()`); deferring per-search
  would add redundant re-classification work on every search instead of
  removing it.

**Why this is provably result-equivalent** (not just "tested and it
passed"): `core.classify.FieldRef` — the only way a classification rule can
address an event's fields — exposes exactly `message, service, severity,
logger, thread, exception, businessStep, errorCode, uiIdentifier,
journeyName, traceId, spanId, correlationId, journeyId, eventId,
devicePlatformType, language, serverHost, serverIp, rawLine, extra.*,
mdc.*` — every one of these is fully resolved by `parseUnclassified`
itself; none of them come from adapter enrichment (`sourceId`,
`containerId`, `pod`, `composeProject`, ...) either. So classification's
result cannot differ based on when it runs. `CanonicalLogEvent#tags()`
derives solely from `#classifications` and touches nothing else. Therefore
`matches(classify(parseUnclassified(...)), request)` (old order) and the
new order (`matchesExceptTags` on the unclassified event, `classify` only
on survivors, then `tagsMatch`) return identical booleans and identical
`tags()`/`classifications()` for every event that is ultimately kept.

### #2 — Safe diagnostic timing (commit `80eaa8a`)

`SearchService.search()` now debug-logs request total duration + source id
+ page index + returned count + effective limit + truncation flag.
`DockerLogSource.searchBlocking()` now debug-logs merge/sort duration,
how many merged lines actually reached classification (vs. were rejected
first), and total parse+filter+classify phase duration. No sensitive
data — durations, counts, source id, booleans only (CLAUDE.md §2). Not a
functional change; kept as permanent (not stripped) diagnostic logging
since it is cheap, safe, and directly useful for a real deployment to
confirm the optimization's effect without re-running this mission's
benchmark.

## Before/after

Optimization #1, same-JVM head-to-head (avoids cross-run JIT variance),
severity-only filter, 20,000 raw events, 10 realistic classification
rules active:

| Run | Eager (old order) | Deferred (new order) | Delta |
|---|---|---|---|
| 1 | 722ms | 508ms | 30% faster |
| 2 | 449ms | 321ms | 29% faster |
| 3 | 687ms | 707ms | 3% *slower* (noise — see below) |
| 4 | 411ms | 327ms | 20% faster |

Run 3 happened while the full ~1400-test suite was also running (heavy CPU
contention) — the wall-clock comparison is noisy under load, which is
exactly why the CI-safe regression test for this optimization does **not**
assert timing (see Tests, below).

## Result equivalence

`RESULT_EQUIVALENCE=PASS`. Evidence:

- `DockerLogSourceTest`'s pre-existing classification/tag-filter test
  (`dockerEventsAreClassifiedByTheSharedEngineAndTagFilteredAfterRetrieval`)
  passes unchanged — same events, same tags, same tag-filtered subset.
- New algorithmic-property regression test (not timing-based, per CLAUDE.md
  "do not add brittle CI tests asserting exact milliseconds"):
  `DockerLogSourceTest#classificationIsSkippedForEventsRejectedByANonTagFilterButResultsStayIdentical`
  — 5 raw lines, 1 passes an INFO-only severity filter; asserts the
  classifier was invoked exactly once (not 5 times) AND the returned event
  set is exactly `{"kept"}` — proves both the optimization's mechanism and
  its correctness in one test.
- Full backend suite: **1429/1429 passing**, 0 failures/errors, run twice
  (`./mvnw -q -o test`) after the optimization landed.

## Tests

- `SearchPipelinePerformanceTest` (new): bounded benchmark, generous
  ceilings only (no tight production-throughput claim, matching
  `TextRedactorPerformanceTest`'s established convention); one comparison
  test with a 2x-generous non-strict bound specifically to avoid CI
  flakiness (an earlier strict `deferred < eager` version was observed to
  flap under build-machine contention — fixed before landing).
- `DockerLogSourceTest#classificationIsSkippedForEventsRejectedByANonTagFilterButResultsStayIdentical`
  (new): the real, non-flaky, CI-safe proof — classifier invocation count,
  not wall-clock.
- Existing `DockerLogSourceTest`, `LokiLogSourceTest`,
  `DirectPodLogProviderTest`, `FixtureLogSourceTest`, `EventFiltersTest`,
  `LogLineParserTest`, `ClassificationEngineTest`, `SearchServiceTest`: all
  pass unchanged (255 tests across the directly-touched surface; 1429
  across the full backend suite).
- One unrelated flaky failure was observed exactly once, only under the
  full ~1400-test suite's CPU contention:
  `DirectPodLogProviderTest#oneSlowPodExceedingItsPerTargetTimeoutIsExcludedButOthersStillReturn`
  (a timeout-window race, pre-existing, unrelated to this mission's
  changes — confirmed by re-running that class alone: 74/74 passing both
  before and after this mission's changes).

## Known limitations

- No live end-to-end measurement was taken: this investigation did not
  start the application's own Docker Compose stack, a browser, or an
  OpenShift cluster. `SEARCH_TOTAL_MS`, `DTO_SERIALIZATION_MS`, and
  `FRONTEND_RENDER_MS` are therefore `BLOCKED`, not `PASS` — the CPU-pipeline
  benchmark and the real (but unrelated-stack) Docker daemon I/O
  measurement were judged sufficient to locate and fix the dominant,
  application-controlled bottleneck without that heavier setup
  (`TOKEN_COST_PRIORITY=HIGH`).
- `SORT_BARRIER` was reasoned about from code, not independently
  benchmarked — see `NEXT_STEP`.
- The Docker daemon I/O measurement used whatever containers were already
  running locally (an unrelated `sofra-*` stack), not Log Explorer's own
  services — real daemon I/O latency either way, but not representative of
  this application's own log volume/format.
- OpenShift historical search latency (`OpenShiftLiveTailProvider`/
  `DirectPodLogProvider` against a real cluster) was not measured at all —
  `DEFERRED`, consistent with CLAUDE.md §3 (live OpenShift verification is
  explicitly out of scope by default).

## Next step

If further latency reduction is wanted and evidence-justified:

1. Benchmark `DockerLogSource`'s pre-filter sort (`merged.sort(...)`) in
   isolation for a large raw-line count with a highly selective filter, to
   confirm or reject `SORT_BARRIER` with real numbers before touching it —
   reordering sort-after-filter is not obviously safe (pagination
   boundary/tie-key derivation in `SearchService` depends on `merged`'s
   sorted order) and needs its own equivalence proof, matching this
   mission's "one optimization at a time" discipline.
2. If a real deployment's own logs are available, run the same
   `SearchPipelinePerformanceTest` shape against a sample of them (real
   message/exception sizes, real classification rule count) rather than
   the fixture corpus, to get a production-representative `ns/event`
   figure instead of this investigation's representative-but-synthetic one.
3. Consider a live, browser-driven measurement (this repo's `run` skill)
   the next time frontend rendering is suspected — this investigation found
   no code-level evidence of a frontend bottleneck but did not rule it out
   empirically.
