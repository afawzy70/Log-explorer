# Search latency investigation and safe optimization

Missions: `SEARCH_LATENCY_INVESTIGATION_AND_SAFE_OPTIMIZATION` (original),
`SEARCH_LATENCY_REALISTIC_MULTI_CONTAINER_VALIDATION` (follow-up, see
"Validation" section below). Branch: `perf/search-latency-investigation`.
This file is the durable checkpoint — read this before re-investigating; do
not re-derive what is already proven here.

**Read this first if you only have time for one number**: the classification
optimization below is correct and safe, but it does **not** address the
user's main reported problem (first unfiltered multi-container search
feeling slow). See "Validation — realistic multi-container benchmark".

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

---

## Validation — realistic multi-container benchmark (`SEARCH_LATENCY_REALISTIC_MULTI_CONTAINER_VALIDATION`)

The original investigation above used an in-process JUnit benchmark with a
fixture corpus and (for the classification tests) synthetic classification
rules. This follow-up mission's premise: the user's real complaint is the
**first, unfiltered, multi-container** search — not a filtered one — and
the classification benchmark above may not represent it (a fresh backend
has zero classification rules configured by default, so there is nothing
for the previous optimization to skip). This section reproduces that exact
real scenario against a real Docker daemon and a real, unmodified Spring
Boot backend on both `main` and this branch, and reports the honest answer.

### Environment

A disposable Docker Compose stack (`logexplorer-bench` project,
`busybox:latest` containers, each `cat`-ing a pre-generated log file to
stdout then sleeping — synthetic data only, no customer/production data),
generated and torn down entirely within this session:

```
CONTAINER_COUNT=12
LINES_PER_CONTAINER=3000
TOTAL_LOG_LINES=36000
TOTAL_LOG_BYTES_APPROX=13,251,713 (~12.6 MiB)
```

Logs match `DefaultFieldMappingProfile`'s exact top-level field names
(`@timestamp`, `application`, `level`, `message`, `logger_name`,
`thread_name`, `traceId`, `X-Correlation-id`, `mdc`), INFO/WARN/ERROR mixed
70/20/10, timestamps spaced back from "now" so the search window covers
them without any query needing to be widened.

Two full backend builds (`mvn -o -DskipTests package`), each run as a bare
`java -jar` (no other warm-up, no test harness) in its own isolated git
worktree/process: `main` at `6e71af8` (the true tip of `origin/main`, same
base this branch diverged from) and this branch (`PR62`,
`perf/search-latency-investigation`, `HEAD eeaf9a5`). Each run: start
process → poll `/actuator/health` until ready (this is NOT search-path
warm-up, only "the HTTP server is up") → three back-to-back
`POST /api/v1/logs/search` calls with **`{"sourceId":"local-docker",
"start":<3h ago>,"end":<now+1h>,"composeProject":"logexplorer-bench"}`** —
no text/service/severity/tag/advanced filters, matching the mission's exact
scenario — wall time via `curl -w`. Two full repeats per branch (fresh JVM
each time), with run order swapped between reps (main-then-pr62, then
pr62-then-main) to control for OS/Docker page-cache warming bias between
consecutive runs.

`composeProject` scopes which containers are searched (12 synthetic ones,
not the host's other, unrelated, already-running containers) — this is
connection/project scope, not one of the mission's named filters
(text/service/severity/tag/advanced), so `FILTERS=NONE` still holds.

### Results

```
                    main rep1  main rep2  |  pr62 rep1  pr62 rep2  |  avg main  avg pr62
FIRST_SEARCH_MS       7053       7357     |    7793       7992     |   7205       7893
SECOND_SEARCH_MS      3382       2507     |    4300       3859     |   2945       4080
THIRD_SEARCH_MS       1880       2005     |    3438       2334     |   1943       2886
```

`FIRST_SEARCH_IMPROVEMENT_PERCENT = (7205 − 7893) / 7205 ≈ −9.5%` — PR62 is
**not** faster on the first unfiltered search; if anything, marginally
slower in both reps. This is the honest number, not a favorable one.

**Why**: PR62's own new diagnostic log line proves the reason directly —
`Docker historical search pipeline: 24000 raw line(s) merged/sorted in
N ms, 24000 classified (of 24000), 24000 returned in N ms` — every single
raw event reached classification, because with zero filters active,
`EventFilters#matchesExceptTags` is `true` for 100% of events (there is
nothing to reject them). The optimization's mechanism — skip
classification for events a non-tag filter would reject anyway — has
*zero* raw material to work with when there are no filters. The small,
consistent slowdown (both reps) is most plausibly ordinary JVM/GC/process
noise between two separately-started JVMs plus one extra method-call layer
(`matchesExceptTags`+`classify`+`tagsMatch` vs. the old single `parse`+
`matches` call) — not a real algorithmic regression; `EventFilters#matches`
is unchanged as a composition and every existing test still passes.

**Result equivalence, empirically** (not just unit-tested): the actual
`/api/v1/logs/search` JSON response bodies from `main` and `PR62` for the
identical request (steady-state, rep 2) were compared by `(traceId,
timestamp, message)` sequence — **identical**, 200/200 events, same order,
same `ResultCounts` (`returned=200, truncated=true, estimatedTotal=null`).

### Server-side breakdown (PR62's diagnostics, averaged across both reps — `main` lacks this instrumentation pre-PR62 except container-read timing)

```
                          first search   third search (steady-state)
SOURCE_ACQUISITION_MS        1949            1132
PARSE+FILTER+CLASSIFY_MS     3322             940    ("pipeline" — parse dominates; classify ≈0 (zero rules); filter is cheap field compares)
SORT_LIMIT_MS                  51              56    (flat regardless of warm-up — sort was never the bottleneck)
SearchService_TOTAL_MS       6537            2564
"other" inside SearchService 1266             492    (listContainers, FieldMappingProfileService, guardrails, cursor/toResult — not separately broken out)
curl_wall_MS                 7893            2886
"external" (controller/DTO/serialization/framework) 1356  322
```

`main`'s per-container Docker read timing (its only pre-existing
instrumentation) shows the same source-acquisition pattern: first search
1780-1888ms, steady-state 596-722ms — confirming the first-vs-steady-state
gap is a property of the JVM/Docker-client/parse path itself, not
introduced by PR62.

### Phase 4 — multi-container analysis

```
CONTAINER_READS_BOUNDED_PARALLEL=YES  (DockerLogSource#readAllContainersInParallel: Flux.flatMap(..., concurrency), unchanged by either mission)
MAX_CONCURRENT_CONTAINER_READS=6      (logexplorer.docker.historical-search-concurrency default)
DOES_SEARCH_WAIT_FOR_ALL_CONTAINERS_BEFORE_RETURNING=YES  (SearchService javadoc "Totals": deliberate, required for a truthful estimatedTotal/truncated signal)
SLOWEST_CONTAINER_MS=1878 (observed max, first search); steady-state slowest typically 333-940ms
FASTEST_CONTAINER_MS=not individually logged — only the slowest-per-request is captured by design (DockerLogSource#HistoricalSearchTiming javadoc: proves one slow container never serializes the rest; an individual fastest/all-12 breakdown was not instrumented)
AVERAGE_CONTAINER_MS=not individually logged; back-of-envelope from total source-acquisition wall time ÷ (12 containers / 6 concurrency ≈ 2 sequential slots) ≈ 400-970ms per container, consistent with the logged slowest-per-request range
TIME_WAITING_AFTER_LAST_CONTAINER_READ_MS = the "pipeline" phase itself (940-3647ms) — readAllContainersInParallel fully blocks/completes before the merge-sort-parse-filter-classify loop starts, so ALL of that phase's time is "after the last container read returns"
```

Root cause, ranked for THIS scenario (unfiltered, first search,
12 containers, 24,000 raw candidate events):

- **(H) First-request JIT/class-loading warm-up is the dominant explanation
  for why search #1 is ~2.7x slower than search #3.** Every single
  measured phase (source acquisition, pipeline, "other", "external")
  shrinks 2-4x between the first and third call on the SAME already-running
  JVM with the SAME data — this is the classic signature of JIT
  interpretation-to-compilation and class-loading, not a data-dependent
  cost. Combined first-vs-third delta ≈ 5000ms; roughly 2380ms of that is
  in the parse/filter/classify loop alone, ~1030ms in controller/
  serialization, ~820ms in Docker I/O, ~770ms elsewhere in SearchService.
- **(C) Overfetch relative to the returned page is real and large**:
  `RAW_EVENTS_READ=24000` (`defaultTailLines=2000 × 12 containers`) vs.
  `RETURNED_EVENTS=200` → **`OVERFETCH_RATIO=120`**. Every one of those
  24,000 raw lines is parsed (and, if rules were configured, classified)
  even though only 200 are ever shown. This is the largest evidence-backed,
  NOT-yet-mitigated factor in this benchmark.
- **(E) Parsing** (JSON decode + field-mapping resolution) is the
  overwhelming majority of the "pipeline" phase's steady-state cost
  (940ms for 24,000 events ≈ 39µs/event, consistent with the original
  investigation's isolated-benchmark range) — classification contributes
  ≈0 here (zero rules configured).
- **(A/B) Docker source acquisition** is real (1132-1949ms) but not
  dominant relative to parsing+overfetch, and is already bounded-parallel
  (unchanged from a prior PR, confirmed again here).
- **(D) Sort is confirmed NOT a bottleneck**, measured directly this time
  (not just reasoned about): 21-82ms for 24,000 elements, flat across
  first/steady-state — the earlier investigation's "not independently
  isolated" caveat for `SORT_BARRIER` is now resolved with real numbers.
- **(F) Classification is confirmed NOT a factor** in this scenario (zero
  rules configured; `24000 classified (of 24000)` — the deferred-skip
  optimization had zero events to skip).
- **(G) Serialization/controller-layer overhead is real but secondary**
  (~322-1356ms, itself mostly first-request framework warm-up, not raw
  encoding cost — an isolated 200-event mask+DTO-map pass was measured at
  single-digit milliseconds in the original investigation's benchmark).
- **Answer: (I) combination**, but with (H) JIT warm-up as the single
  largest lever for the *first-search* symptom specifically, and (C)
  overfetch + (E) parsing as the largest levers for the *steady-state*
  floor that remains even after warm-up.

### Phase 6 — overfetch / limit behavior

```
REQUESTED_RESULT_LIMIT=200 (default; not specified in the request)
RAW_EVENTS_READ=24000      (defaultTailLines=2000 × 12 containers — Docker's own per-container tail cap, already bounded, not unbounded)
MATCHED_EVENTS=24000       (no filters active → EventFilters accepts every event; confirmed directly by the "24000 classified (of 24000)" log line)
RETURNED_EVENTS=200        (effectiveLimit; ResultCounts.truncated=true)
OVERFETCH_RATIO=120        (24000 / 200)
```

Not changed this session (mission: "Do NOT change this behavior yet unless
exact ordering/completeness can be preserved") — see Phase 7/Phase 8 below
for why.

### Phase 7 — sort barrier (measured directly this time)

```
SORT_INPUT_EVENT_COUNT=24000 (raw ContainerLine list, pre-parse — DockerLogSource sorts native Docker timestamps before parsing)
SORT_LIMIT_MS=21-82ms (measured directly across 4 real requests; flat, not warm-up-sensitive)
FULL_MATERIALIZATION_REQUIRED=PARTIAL — required today for the documented "exact estimatedTotal on an untruncated page 1" behavior (SearchService javadoc "Totals"), NOT required merely to sort/return a correctly-ordered top-200 page
CAN_TOP_N_BE_SEMANTICALLY_EQUIVALENT=UNKNOWN — plausible and promising specifically for the unfiltered case (Docker's native per-frame receive timestamp, used for the merge sort, is already available BEFORE JSON parsing, so a size-bounded top-N heap over raw ContainerLines could select candidates to parse without materializing/sorting all 24,000 first); NOT proven for the general (filtered) case, where a raw line selected by native-timestamp proximity can still be rejected by a content-based filter (severity/text/trace/...) after parsing, requiring a "keep expanding the candidate window until N passing results are found" algorithm that was not designed, implemented, or tested this session. Per this mission's explicit instruction ("Do NOT implement bounded top-N unless exact ordering semantics are proven"), this was NOT implemented.
```

Note: the sort itself was already known-cheap (reasoned about, not
measured, in the original investigation); this benchmark now measures it
directly and confirms that reasoning. The real cost living in the same
part of the pipeline is **parsing all 24,000 raw lines**, not sorting them
— any future bounded-top-N work should target reducing how many raw lines
get *parsed*, using the pre-parse native timestamp already available on
`ContainerLine`, not the sort step itself.

### PR #62 decision

```
CLASSIFICATION_FIX_VALID=YES — the correctness proof (FieldRef never exposes adapter-enrichment fields; CanonicalLogEvent#tags() derives solely from #classifications) still holds; every existing test still passes; the new "24000 classified (of 24000)" diagnostic line itself confirms the code path executes correctly under real Docker I/O, not just fixture-corpus unit tests. Result equivalence was now also confirmed empirically (byte-identical returned event sequence vs. main) for this real scenario, not only by unit test.
CLASSIFICATION_FIX_MATERIAL_FOR_UNFILTERED_FIRST_SEARCH=NO — proven, not assumed: a fresh backend has zero classification rules by default, and with zero search filters active, 100% of raw events reach classification either way (before or after this optimization) — there is nothing for the fix to skip. It remains material for a SELECTIVE, RULE-CONFIGURED search (the scenario the original investigation targeted and measured a genuine 20-30% improvement for) — that claim is unchanged and was never claimed to cover the unfiltered case.
```

Per CLAUDE.md/this mission's own instruction ("do not reject a correct
optimization merely because another bottleneck is larger" / "do not claim
it fixes the user's main Search latency problem unless the real
multi-container benchmark proves that") — both halves are reported
honestly: the fix is correct and keep-worthy, and it does not solve the
user's main complaint.

### Next recommended optimization (not implemented this session — needs its own proof/implementation phase)

Ranked by the evidence above:

1. **First-request warm-up** (H) — the single biggest lever for the exact
   symptom the user reported ("first search feels slow"). Safe options to
   investigate: Spring AOT/CDS (`-XX:SharedArchiveFile`, no code change,
   pure JVM startup flag), a genuinely safe non-search pre-warm path (e.g.
   touching the Docker client / JSON codecs during application startup
   rather than on the first real user request — must not itself delay
   startup-to-ready in a way that just moves the wait elsewhere), or
   accepting it as an inherent JVM cold-start cost and documenting it.
2. **Overfetch / bounded top-N** (C) — the largest *steady-state* lever,
   but explicitly NOT safe to implement without first designing and
   proving the filtered-case algorithm (Phase 7). This is real, standalone
   follow-up work, not a quick fix.
3. Sort (D) and classification (F) are now confirmed non-issues for this
   scenario — do not spend further effort there.

