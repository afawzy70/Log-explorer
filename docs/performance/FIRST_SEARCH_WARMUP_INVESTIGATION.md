# First-search warmup investigation

Mission: `FIRST_SEARCH_WARMUP_ROOT_CAUSE_AND_OPTIMIZATION`. Branch:
`perf/first-search-warmup` (based on `origin/main` `6e71af8`, independent of
PR #62 — see "PR strategy" below). Builds on the prior investigation at
`docs/performance/SEARCH_LATENCY_INVESTIGATION.md`'s "Validation" section,
which proved the first-search spike is real (~7-8s vs ~2-3s steady state on
a 12-container/24,000-raw-event benchmark) and dominated by JIT/class-
loading/first-call warm-up, not by PR #62's classification optimization.

## Baseline (Phase 1 — reconfirmed, 3 clean app starts, unmodified code)

Same 12-container synthetic Docker benchmark reused unchanged (see the
prior doc for how it was built): `busybox` containers, 36,000 total
synthetic JSON lines, `composeProject=logexplorer-bench`, no filters,
default limit 200.

```
                 run1   run2   run3   median
FIRST_SEARCH_MS  7882   8352   7971   7971
SECOND_SEARCH_MS 5471   3391   4321   4321
THIRD_SEARCH_MS  2242   2408   1915   2242
```

Confirms the spike still exists and is consistent (first search 7.9-8.4s
across 3 fresh JVMs).

## Phase 2 — first-use cost breakdown

Using PR #62's existing debug-log instrumentation (`SearchService`,
`DockerLogSource`) plus curl-wall-time-minus-internal-time to isolate the
controller/serialization layer, averaged across the 3 baseline runs:

```
                                first search   third search (steady-state)   avoidable delta
SOURCE_ACQUISITION_MS              2237            771                         1466
PARSE+FILTER+CLASSIFY ("pipeline") 3553            930                         2623
"other" inside SearchService       1291            325                          966   (listContainers, FieldMappingProfileService, guardrails, cursor/toResult)
"external" (controller/DTO/Jackson) 987            162                          825
TOTAL                              8068           2188                         5880   (matches curl-measured first-vs-third gap)
```

Every phase independently shrinks 2-4x from the first request to the
third, on byte-identical data, on the same already-running JVM — the
textbook JIT-interpretation-to-compilation / class-loading signature, not
a data-dependent cost.

```
FIRST_USE_COMPONENT=JSON parse + field-mapping resolution (LogLineParser) — inside "pipeline"
FIRST_USE_COST_MS=~3553 (first)
REPEAT_USE_COST_MS=~930 (third)
AVOIDABLE=PARTIAL (JIT/class-loading portion is avoidable via warm-up; the steady-state ~930ms floor is real per-event parse cost, not avoidable without changing what's parsed — out of scope, see overfetch)

FIRST_USE_COMPONENT=Docker client first real I/O call (per-container log read)
FIRST_USE_COST_MS=~2237
REPEAT_USE_COST_MS=~771
AVOIDABLE=PARTIAL (connection/TLS-transport/JSON-decode warm-up is avoidable; the steady-state ~771ms floor is real network I/O for 12 containers)

FIRST_USE_COMPONENT=Docker listContainers() + FieldMappingProfileService + SearchGuardrails + QueryPlanBuilder ("other" inside SearchService)
FIRST_USE_COST_MS=~1291
REPEAT_USE_COST_MS=~325
AVOIDABLE=PARTIAL

FIRST_USE_COMPONENT=Controller/Jackson serialization/EventMapper DTO mapping ("external")
FIRST_USE_COST_MS=~987
REPEAT_USE_COST_MS=~162
AVOIDABLE=PARTIAL

FIRST_USE_COMPONENT=Classification engine (ClassificationEngine#classify)
FIRST_USE_COST_MS=~0 (zero rules configured by default in this benchmark; ClassificationEngine#classify fast-paths on an empty rule set)
REPEAT_USE_COST_MS=~0
AVOIDABLE=N/A (nothing to warm when no rules are configured; PR #62 already addresses this dimension for rule-configured deployments)
```

Not separately isolated (grouped above; individually small relative to the
four buckets that account for ~5880ms of the ~5880ms total gap, so further
decomposition was not pursued — `TOKEN_COST_PRIORITY=HIGH`): JVM class
loading vs. JIT compilation as distinct sub-costs, regex/pattern
compilation (the classification engine's own rule compiler was not
exercised — no rules configured), ObjectMapper construction (a Spring
singleton, already built once at context-refresh time regardless).

## Phase 3 — candidate strategies tested

### Candidate A + C (combined): CPU-pipeline warm-up on synthetic data

Implemented as `com.logexplorer.config.StartupWarmup`, a `@PostConstruct`
method (not an `ApplicationRunner` — see its own javadoc for why: Spring's
embedded Netty server starts as a `SmartLifecycle` during
`finishRefresh()`, strictly AFTER every singleton's `@PostConstruct` but
BEFORE any `ApplicationRunner`; only `@PostConstruct` guarantees nothing
can reach the process — not even `/actuator/health` — until this method
returns). Drives `logexplorer.startup.iterations` (default 3000) synthetic,
fixed, fake JSON lines (`warmup-svc`, 2020-dated timestamps, obviously
synthetic) through the exact same production singleton beans a real search
uses: `LogLineParser#parse` → `EventFilters#matches` → `EventMapper#toDto`
(masking + redaction + classification DTO mapping) → `ObjectMapper#writeValueAsString`
on the resulting page (bounded to 200, the real default page size). Never
reads a real source; every object is a local variable, discarded when the
method returns.

**A real bug found and fixed while building this**: the first version's
synthetic lines carried fixed 2020 timestamps but the warm-up's own
`SearchRequest` used a `±60s` window around "now" — every synthetic event
failed the time-range check before ever reaching `EventMapper`/Jackson, so
the DTO-mapping/serialization half of the warm-up silently did nothing
(`pipeline events=0` in the diagnostic log caught this immediately). Fixed
by widening the warm-up's own request window (`2000-01-01` to `now+60s`) —
the synthetic content's exact instant is arbitrary and never compared
against anything real, so a generously wide static window is simplest.

### Candidate B: Docker discovery warm-up

The exact same read-only call `DockerLogSource#health()` already makes for
every ordinary Sources health check (`ping()` + `listContainers(true)`,
never log content, never throws — `onErrorResume` already makes it safe),
called once, bounded by `logexplorer.startup.docker-warmup-timeout`
(default 3s) so an unreachable/misconfigured Docker daemon can never
meaningfully delay startup.

### Candidate C

Folded into Candidate A above (the same synthetic-data pass IS the JVM
warm-up — there was no separate "just JIT, no real code path" version worth
building separately).

### Candidate D: CDS/AppCDS — assessed, not implemented

Code-reviewed, not benchmarked (`TOKEN_COST_PRIORITY=HIGH` + the mission's
own gate: "do not adopt unless packaging works... complexity justified...
gain material"). This app ships three ways — a Docker image
(`docker-entrypoint.sh` execs `java` directly), a macOS desktop launcher
(`desktop/launcher-macos` spawns the JVM via `ProcessBuilder` in
`BackendProcessManager.java`), and a Windows desktop launcher (separate
build pipeline, `.github/workflows/windows-desktop.yml`). CDS archives are
JVM-version- and typically platform/architecture-specific, so a real
adoption would need at least 2-3 separately generated and maintained
archives (Linux/Docker, macOS, Windows), regenerated whenever the
dependency set changes (or CDS silently falls back to no-CDS — a real
foot-gun if unnoticed), across three separate build pipelines. Given
Candidate A+B already delivered a measured, material improvement with
*zero* packaging changes, CDS was not pursued this session. Worth
revisiting later if further first-start latency reduction is wanted -
`NEXT_STEP`.

## Phase 4 — per-candidate results

Individual isolation of A+C vs. B alone was attempted but was **not**
reliably conclusive: early runs (taken late in this session, in immediate
succession) showed both individually plausible-looking, but a later check
found this Ubuntu/GCP VM shared with another concurrent Claude session
(`ux/v2-modern-developer-console`, running its own frontend `vitest` suite
at the time — confirmed via `ps`/`uptime`, load average 8-10 on 4 cores)
introduces enough CPU contention noise to make fine-grained single-run A-
vs-B splits unreliable. Rather than spend further `TOKEN_COST_PRIORITY=HIGH`
budget chasing sub-second isolation under a noisy shared machine, this
investigation committed to validating the **combined** A+B strategy with a
properly controlled methodology (interleaved pairs — see Phase 6), which
gave a clean, consistent, well-evidenced signal. Individually:

```
CANDIDATE=A+C (pipeline warm-up alone, Docker warm-up disabled)
pipelineMs measured directly: 1230-2070ms (scales with `iterations`)
Indicative-only (not drift-controlled) first search: as low as 2525ms in one run — consistent with A+C being real and substantial, but not independently confirmed to mission-grade rigor given the noise found afterward

CANDIDATE=B (Docker discovery warm-up alone, pipeline iterations=0)
dockerDiscoveryMs measured directly: 689-1449ms
Indicative-only first search: mixed (2542ms in one clean-looking run, inconclusive/noisy in a later interleaved attempt)

CANDIDATE=Combined A+B (chosen)
See Phase 6 — this is the only candidate validated with a controlled (interleaved) methodology.
```

## Phase 5 — chosen optimization

**Combined A+B**, implemented in `com.logexplorer.config.StartupWarmup` /
`StartupWarmupProperties`. Both target real, independently-measured
first-use costs identified in Phase 2 (CPU pipeline JIT warm-up and Docker
client first-I/O warm-up); both are read-only/side-effect-free/synthetic-
data-only; combining them was judged reasonable given Phase 4's inconclusive
isolation (rather than picking one arbitrarily), and Phase 6 confirms the
combination gives a real, material, consistent improvement.

`logexplorer.startup.enabled=true` by default; `iterations=3000`;
`docker-warmup-enabled=true`; `docker-warmup-timeout=3s`. All four are
plain `@ConfigurationProperties`, overridable via env var
(`LOGEXPLORER_STARTUP_*`) without a rebuild — an operational safety valve
if a future deployment wants to disable or tune this.

**Disabled for the `test` profile** (`@Profile("!test")`) so it never adds
latency or Docker-dependent nondeterminism to the backend's many
`@SpringBootTest` contexts. Verified directly: full backend suite run with
this component present, `1423/1423` passing (the `test`-profile contexts
never construct the bean); a non-`test`-profile integration test
(`SourcesApiIntegrationTest`) was run in isolation and confirmed the
warm-up DOES fire and complete successfully before that test's requests
are served.

### Startup tradeoff

Median startup-time increase across 3 interleaved pairs (excluding one
run that hit 19.7s under confirmed heavy concurrent system load from
another session — see Phase 4's noise discussion; included pairs: +1235ms,
+1727ms): **approximately +1.3 to +1.7 seconds** to reach
`/actuator/health` UP. In exchange, median first-search wall time dropped
from 3371ms to 2400ms in the same interleaved comparison — roughly
**~1000ms saved per first search**. This is a genuine, disclosed tradeoff,
not a free lunch: the startup cost and the first-search saving are of
comparable absolute magnitude. It is a reasonable trade because, in every
real deployment shape this app ships as (Docker container boot, desktop
app launch), the extra ~1.3-1.7s is paid once, before any human is
watching the search screen — not on the critical path the user actually
experiences and complained about.

Memory: RSS measured after one search each, `nowarm≈379MB` vs.
`warm≈374MB` — no material difference (the 3000 synthetic events/DTOs are
short-lived locals, already collected by the time of measurement).

## Phase 6 — realistic validation (interleaved, drift-controlled)

**Why interleaved, not simple before/after**: repeated benchmark runs
against the same 12 containers over the course of this session caused a
real, measurable environmental drift — OS page cache warming for the
bind-mounted log files and Docker daemon internal state warming from
dozens of prior `docker logs` reads in this session. A naive comparison
of "Phase 1's cold baseline" against "a much-later warm-environment
optimized run" would overstate the improvement by conflating two different
effects. Controlled for by alternating no-warmup/warmup app starts in
immediate succession (3 pairs), so both arms of each pair experience
approximately the same environmental state.

```
pair    nowarm_first_ms   warm_first_ms   relative_improvement
1       3371              2400            28.8%
2       2914              2200            24.5%
3       6506              4753            26.9%

BASELINE_FIRST_P50_MS=3371   (median of nowarm arm, interleaved/drift-controlled)
OPTIMIZED_FIRST_P50_MS=2400  (median of warm arm, interleaved/drift-controlled)
BASELINE_FIRST_P95_MS=6506   (max of 3 - n=3, a P95 proxy only, not statistically robust)
OPTIMIZED_FIRST_P95_MS=4753  (max of 3, same caveat)
FIRST_SEARCH_IMPROVEMENT_PERCENT=28.8% (at median); consistently 24.5-28.8% across all 3 pairs - never worse

SECOND_SEARCH_CHANGE_PERCENT=-7.3%  (nowarm median 1706ms -> warm median 1581ms - a small, real but much smaller effect, as expected: the JVM's own dynamic JIT has mostly caught up by the second request regardless of this warm-up)
THIRD_SEARCH_CHANGE_PERCENT=-11.8% (nowarm median 1264ms -> warm median 1115ms)

STARTUP_TIME_CHANGE_MS=+1235 to +1727 (median pairs 1-2; pair 3's startup timing was corrupted by a confirmed concurrent-session CPU spike and is excluded from this figure - the search-latency numbers for pair 3 above are still valid since both arms of that pair experienced the same contention)
```

**Context vs. the Phase 1 "cold" baseline** (7971ms median, measured
before any repeated-run cache warming in this session): the interleaved
`BASELINE_FIRST_P50` above (3371ms) is already far below Phase 1's figure
purely from environmental drift, independent of this optimization. Applying
the interleaved comparison's ~28.8% relative improvement to the genuinely
cold Phase 1 baseline gives an **estimated** cold-optimized first search of
≈5675ms (7971ms × (1 − 0.288)) — an extrapolation, not a directly measured
number, stated honestly as such.

## Result equivalence

`RESULT_EQUIVALENCE=PASS`. The warm-up path shares the exact same
production singleton beans and code paths a real search uses
(`LogLineParser`, `EventFilters`, `EventMapper`, `DockerLogSource#health`)
— it does not introduce a parallel/alternate implementation that could
drift from the real one. It never touches `SearchService`, pagination,
ordering, masking policy, or classification rule evaluation logic itself —
only pre-exercises them once, before the server accepts traffic, on
throwaway synthetic data that is never returned to any caller. Full
backend suite: 1423/1423 passing.

## Tests

- Full backend suite (`./mvnw -q -o test`): 1423/1423 passing, 0
  failures/errors (this branch's baseline is `main`'s 1423, not PR #62's
  1429 — the 6 extra tests in `SearchPipelinePerformanceTest`/
  `DockerLogSourceTest` belong to PR #62, a separate, independent PR).
- `com.logexplorer.arch.ArchitectureTest`: passes unchanged (the new
  `config.StartupWarmup` is not in the `..api..` package, so the
  "api layer must not bypass the parser" rule does not apply to it, and it
  was verified this rule still passes with the new class present).
- Manual verification: `SourcesApiIntegrationTest` (a real, non-`test`-
  profile `@SpringBootTest`) run in isolation, confirmed the warm-up fires
  and completes (`Startup warmup complete: pipelineMs=... dockerDiscoveryMs=...`)
  before that test's own requests are served, and all 7 of its own tests
  still pass.
- No Docker Compose startup/smoke, Windows desktop, or macOS desktop
  build/test was run this session (`TOKEN_COST_PRIORITY=HIGH`; no JVM
  launch flags or packaging files were changed — only a new Spring bean —
  so packaging compatibility risk is judged low, but this is reasoning,
  not verification; see Known limitations).

## Known limitations

- Fine-grained, drift-controlled isolation of Candidate A's own individual
  contribution vs. Candidate B's own individual contribution was not
  achieved (Phase 4) — only the combined A+B strategy was validated to
  mission-grade rigor (interleaved, Phase 6). It is possible one candidate
  alone would capture most of the benefit at lower startup cost, but this
  was not proven either way under the noise encountered.
- All measurements in this investigation (this mission and the prior one)
  were taken on a single shared development VM, sometimes with other
  processes/sessions active. The interleaved methodology controls for this
  reasonably well for the *relative* comparison, but no number here should
  be read as a precise absolute production SLA figure.
- `STARTUP_TIME_CHANGE_MS` and the memory figures are from a small number
  of samples (2-3), not a statistically rigorous distribution.
- Desktop (Windows/macOS) and Docker Compose packaging were not smoke-
  tested with this change; only the backend jar was built and run
  directly.

## Next step

- If further first-search reduction is wanted: revisit Candidate D
  (CDS/AppCDS) with an actual measurement, now that Candidate A+B's
  ceiling is known (~1000ms saved at median in this benchmark) — CDS could
  plausibly stack with the current warm-up rather than replace it, since it
  targets class-loading specifically while A+B targets JIT/first-I/O.
- Consider re-running Phase 4's isolation (A alone vs. B alone) on an idle,
  uncontended machine to determine whether one candidate alone is
  sufficient — could lower the startup-time cost of this change if so.
- The overfetch finding from the prior investigation (120x raw-vs-returned)
  remains the largest *steady-state* lever and is unaffected by this
  mission's work — still out of scope here, per this mission's own
  instruction.
