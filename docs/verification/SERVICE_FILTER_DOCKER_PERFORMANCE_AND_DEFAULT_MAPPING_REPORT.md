# Service Filter, Docker Performance, and Verified Default Mapping — Report

**Mission:** `SERVICE_FILTER_DOCKER_PERFORMANCE_AND_VERIFIED_DEFAULT_MAPPING`
— three owner-approved goals on one new branch
(`feature/service-filter-docker-performance-default-mapping`, from latest
`main`), one PR, never touching PR #54 / `ux/v2-professional-redesign`:

- **(A) Service Include/Exclude filtering** — explicit `serviceFilterMode`
  (`INCLUDE`/`EXCLUDE`) on the canonical search contract, applied as early
  as safely possible per source, with Docker specifically guaranteed to
  never read an excluded service's container logs at all.
- **(B) Docker first-search performance** — bounded (not unbounded)
  parallel container reads, replacing the previous sequential-sum latency,
  plus a real read-safety fix and low-cost timing observability.
- **(C) Owner-approved default field mapping that starts VERIFIED** — a
  new, named 23-field default table is now the authoritative built-in
  profile; every field on it starts `VERIFIED` with no scan required;
  Journey ID and UI Identifier remain deliberately, permanently unmapped.

Full requirement-by-requirement detail (9 numbered categories, SFDPDM-1
through SFDPDM-9) is recorded in
`docs/governance/OWNER_REQUIREMENTS_REGISTER.md` §24, including the named
supersession of §22's original "`DEFAULT_MAPPING != VERIFIED_MAPPING`,
every field including the built-in default starts `UNVERIFIED`" rule for
the built-in default profile only — that historical text is preserved
verbatim, not deleted, and every other verification guarantee (evidence-
gated user edits, explicit `NEEDS_CHANGE`, full project-scope isolation)
remains unchanged.

---

## 1. Part A — Service Include/Exclude filtering

**Contract.** `core.model.SearchRequest` gained a `ServiceFilterMode`
enum (`INCLUDE`/`EXCLUDE`, mirroring the existing `Direction` enum
pattern in the same file) and a `serviceFilterMode` field, defaulting to
`INCLUDE` in the compact constructor whenever unset — every pre-existing
caller keeps its exact current behavior with zero changes required.

**Shared fallback layer.** `core.search.EventFilters#matches` — the one
predicate every `LogSource` search path already funnels through — now
branches the single service-check block on mode: INCLUDE keeps the
pre-existing allow-list check unchanged; EXCLUDE inverts it to a
deny-list; EXCLUDE with an empty list applies no restriction at all,
identical to INCLUDE with an empty list.

**Docker — zero-read enforcement.** `source.docker.DockerLogSource#relevantContainers`
gained a `serviceFilterMode` parameter and now applies INCLUDE/EXCLUDE
directly in the container `.filter(...)` predicate that builds `targets`
— BEFORE `searchBlocking` ever calls `readContainerLogs` for any
container. An excluded service's containers are therefore structurally
never passed to a Docker log read at all, not merely filtered out of the
result afterward.

**Loki — truthful pushdown gating.** `source.loki.LokiLogSource#resolvePushedDownServices`
now only returns `request.services()` as a positive `service=` selector
match under `INCLUDE`. Under `EXCLUDE` it never contributes a pushdown
(pushing the excluded list down as a positive match would invert the
request's own meaning), relying entirely on the shared `EventFilters`
post-filter — exactly the same fallback path an empty service list
already used.

**OpenShift / Fixture — no source-specific code needed.** Inspection
confirmed `source.openshift.DirectPodLogProvider` has no native
service-based pod targeting at all and already routes 100% through
`EventFilters.matches()`; `source.fixture.FixtureLogSource#search`
(historical search) likewise already routes through `EventFilters`. Both
therefore inherit correct INCLUDE/EXCLUDE semantics automatically from
the shared-layer change, with zero source-specific edits. (Fixture's
separate live-`follow()` path has its own pre-existing, narrower
INCLUDE-only services check — out of scope, since the mission is framed
entirely around historical Search, and `FollowRequest` carries no
`serviceFilterMode` field.)

**API layer.** `api.dto.SearchRequestDto` gained a `serviceFilterMode:
String` field; `api.RequestMapper#toDomain` parses it via a new
`parseServiceFilterMode` (mirrors `parseDirection`'s exact
null/blank/unrecognized→`null`→caller-default shape).

**Frontend.**
- `shared/api/types.ts` — `SearchRequestBody.serviceFilterMode?: 'INCLUDE' | 'EXCLUDE'`.
- `app/useSearchState.ts` — new `serviceFilterMode` state alongside
  `selectedServices`; included in `buildRequestBody`, the show-context/
  journey snapshot-restore mechanism (so a detour never silently resets
  it), and `clearAllFilters` (resets to `INCLUDE`).
- `features/search/ServiceMultiSelect.tsx` — new optional `mode`/
  `onModeChange` props render an `aria-pressed` two-button segmented
  toggle ("Include selected"/"Exclude selected") inside the existing
  popover, backward-compatible (omitted `onModeChange` renders no
  toggle). `triggerLabel` becomes mode-aware ("All except gateway" /
  "All except 3 services"); the zero-selected label is unchanged in
  either mode.
- `features/search/ActiveFilters.tsx` — new optional `serviceFilterMode`/
  `onClearServices` props render one combined summary chip under EXCLUDE
  ("Excluding: audit, notifications, metrics" for ≤3 services, "All
  services except N" beyond that) instead of N separate "Service:" chips
  — the exact wording the mission specified, never color-only, never
  reusing a plain "Service:" label that could be misread as an allow-list.
- Existing service discovery, session-only filter-state lifetime, and
  "never persist query results/log data" are all unchanged — no new
  persistent storage was added anywhere in this mission.

---

## 2. Part B — Docker first-search performance

**Bounded parallelism.** `config.DockerProperties` gained
`historicalSearchConcurrency` (default `6`, plain getter/setter following
the existing `@ConfigurationProperties` convention;
`application.yml`'s `logexplorer.docker.historical-search-concurrency:
6`). `DockerLogSource#searchBlocking`'s previous sequential
`for (Container : targets) { readContainerLogs(...) }` loop is replaced
by a new `#readAllContainersInParallel`, using Reactor's
`Flux.fromIterable(targets).flatMap(mapper, concurrency)` — the
concurrency argument is the actual enforced bound, never unbounded — with
each container read still scheduled on `Schedulers.boundedElastic()`
(safe to nest inside the already-boundedElastic-scheduled outer
`Mono.fromCallable(() -> searchBlocking(request))`, since that scheduler
has its own dynamic thread cap, far exceeding the small configured
concurrency).

**Ordering/correctness preserved.** The full merged result is still
explicitly re-sorted deterministically (native Docker receive timestamp,
containerId tiebreaker) immediately after the parallel fan-out, exactly
as before — `flatMap`'s unordered completion can therefore never affect
the final event order. Pagination, per-container/service/Compose-project
attribution, sourceTimestamp, malformed-line and large-message
preservation, and severity/structured filtering are all unchanged code
paths, re-confirmed by the full pre-existing `DockerLogSourceTest` suite
passing unchanged alongside the new tests.

**Read safety — a real, previously-unreported defect fixed.**
`readContainerLogs`'s `callback.awaitCompletion(...)` boolean return
value (`true` = genuinely completed, `false` = timed out) was discarded
entirely — a timed-out read was silently treated as a normal, complete
one, with whatever partial lines had arrived returned with no signal at
all. Fixed minimally: the boolean is now captured, a truthful
`log.warn(...)` diagnostic is logged on timeout (container id and
configured timeout only — no message/query/token/identifier content),
and the partial lines already collected are still returned unchanged —
never fabricates zero, never silently claims completeness. This is the
only correction made to Docker read reliability; no broader rewrite.

**Observability.** A new package-private `DockerLogSource.HistoricalSearchTiming`
record (`targetContainerCount`, `containersActuallyRead`,
`effectiveConcurrency`, `totalDurationMillis`,
`slowestContainerReadMillis`) is populated by every historical search and
exposed via a package-private `lastHistoricalSearchTiming()` getter for
tests/diagnostics, logged at `log.debug` with only counts/durations —
zero raw log messages, query values, tokens, or CIF/username/customerId/
deviceId/deviceIp content anywhere in this new logging.

**Perceived performance.** The existing Search button already flips to
"Searching…" and disables synchronously on click, before any network
round trip — confirmed sufficient immediate feedback; no new UI state was
added, since the mission only required adding one if current feedback
were weak.

**Constraints confirmed, not violated.**
```
PROGRESSIVE_RESULTS_IMPLEMENTED=NO
PERSISTENT_LOG_RETENTION=NO
LOCAL_LOG_DATABASE=NO
TWO_DAY_CACHE=NO
```
No SQLite/Postgres/embedded search index/filesystem log archive/
background ingestion/persistent source mirroring was added anywhere. The
source remains sole authority; `lastHistoricalSearchTiming` is a single
in-memory value, overwritten per search, never persisted.

---

## 3. Part C — Owner-approved default field mapping starts VERIFIED

`core.mapping.DefaultFieldMappingProfile#build` was rewritten to the
exact owner-approved 23-entry table (see the mission prompt / §24 of the
requirements register for the full field→path list); `Journey ID` and
`UI Identifier` deliberately resolve to `List.of()` — no default
candidate, permanently, per the owner's explicit "do not guess" decision.

`core.mapping.FieldMappingProfileService` gained a single source-of-truth
`freshDefaultVerificationMap()`: a field starts (and, on `resetToDefault`,
returns to) `VERIFIED` if and only if the built-in default has at least
one candidate for it, `UNVERIFIED` otherwise — derived directly from
`DefaultFieldMappingProfile.build()` itself, so there is no second
hand-maintained list that could drift out of sync. `updateCandidates` is
unchanged: any edit still reverts `VERIFIED`→`UNVERIFIED`, so a
user-modified candidate is never auto-verified — every other guarantee
from the original "Mapping Verification and Investigation Workspace"
mission (evidence-gated Verify, explicit `NEEDS_CHANGE`, full
`MappingScopeKey` project/source isolation) is completely unchanged.

**Frontend hint-gating defect found and fixed.** Inspection of
`FieldMappingWorkspace.tsx` found the "Run a Quick Schema Scan first —
verification needs real samples as evidence" hint was gated only on
`!hasScanEvidence` — it would have shown, misleadingly, for an untouched,
already-`VERIFIED` owner-approved default field with no scan ever run.
Fixed by also gating on `field.verificationStatus !== 'VERIFIED'`.

**Test-fixture ripple, worked through systematically.** Changing the
default candidates broke ~33 pre-existing tests across 9+ files that
either hardcoded the old `mdc.<key>` paths or assumed every field
(including the built-in default) starts `UNVERIFIED`. Each was inspected
individually and fixed on its own merits — several needed their PREMISE
corrected (e.g. "proves this field does NOT resolve by default" → "proves
this field NOW resolves by default"), not just a literal string swap.
Journey-related tests that relied on the class-level default parser
resolving `journeyId` now use a locally-scoped, explicitly-configured
`FieldMappingProfileService`/parser pointed at the exact `mdc`-nested key
the fixture/mock data still emits — preserving both "no default" (the new
requirement) and "the mechanism still works once configured" (the
pre-existing, still-valid guarantee). `FixtureCorpusGenerator`
(production code) was correspondingly updated to emit most fields at the
JSON top level, matching the new default table, while deliberately
keeping Journey ID's own key (`mdc.x-journey-trace-id`) and UI
Identifier's realistic sample nested/present-but-unmapped — the corpus
still contains real, valid, discoverable journey data, just not resolved
without explicit configuration, exactly the real-world workflow this
mission requires.

**E2E ripple — a real, previously-latent Fixture-source defect this
mission's own change exposed, found and fixed (not merely worked
around).** Two pre-existing E2E specs
(`phase-i-journey-investigation.spec.ts`, `phase-legacy-slice6-investigation-depth.spec.ts`)
broke for the same reason as the backend-side ripple above — Journey ID
now has no default, so their real-browser "find a multi-event journey"
probing loop found nothing after configuring the mapping via a direct
`PUT .../fields/journeyId` + `POST .../save` HTTP call. Root cause:
`source.fixture.FixtureLogSource#corpus()` parses its 250-line corpus
once per JVM lifetime and memoizes the result forever — a mapping change
made after the very first Fixture search in a given backend process
previously had no effect on already-cached parsed events. This was
invisible while every field had a default (nothing to ever reconfigure at
runtime); it became directly observable, and CI-breaking, once Journey
ID/UI Identifier require explicit configuration — CI runs the whole E2E
suite against one shared backend process with parallel workers in
nondeterministic order, so whichever spec happened to touch the fixture
source first permanently locked in journeyId as unresolved for the
remainder of that run, and a local re-verification session initially
masked this by restarting the backend and configuring the mapping first
(order-dependent, not CI-safe).

Fixed at the source, not worked around: `FieldMappingProfileService`
gained a per-scope `generation` counter (`AtomicLong`, bumped on every
real `updateCandidates`/`resetToDefault`), exposed through
`LogLineParser#mappingGeneration(scope)` (every real caller of
`FixtureLogSource` already holds a `LogLineParser`, so no new constructor
dependency was needed). `FixtureLogSource#corpus()` now compares its
cached generation against the current one on every access and rebuilds
only when the mapping has actually changed — a single cheap volatile-read
comparison in the common case (no mapping change between searches), a
correct rebuild once it does, regardless of test/request ordering. New
backend regression test
`FixtureLogSourceTest.aMappingChangeAfterTheCorpusIsAlreadyCachedStillTakesEffectOnTheNextSearch`
proves this directly on one `FixtureLogSource` instance (search before
configuring Journey ID → unresolved; configure; search again → resolved
on the very next search, no restart). Both E2E specs were re-verified
against a backend that had already served other Fixture searches first
(the exact CI-representative ordering) and now pass without any
restart-first workaround.

**Reset to Defaults.** `resetToDefault` now calls the same
`freshDefaultVerificationMap()` a fresh scope uses, so Reset restores
exactly the approved paths with `VERIFIED` status, and Journey ID/UI
Identifier with no mapping and `UNVERIFIED` — no stale custom
mapping/status can survive a reset.

**Scope model unchanged.** The built-in default remains product-level
immutable configuration; every user modification remains scoped by the
existing `MappingScopeKey` (Compose project / OpenShift namespace)
exactly as before this mission — re-confirmed by
`oneProjectEditingAFieldNeverMutatesAnotherProjectsOwnVerifiedDefaultState`.

---

## 4. Test evidence

```
BACKEND_TESTS=PASS (1319/1319 — 1291 pre-existing + 28 new, 0 failures/errors/skipped)
FRONTEND_TESTS=PASS (943/943 — 925 pre-existing + 18 new)
TYPECHECK=PASS
PRODUCTION_BUILD=PASS
E2E=PASS (30/30 spec files, real backend `SPRING_PROFILES_ACTIVE=dev` + real frontend dev server — see methodology note below)
WINDOWS_DESKTOP_CI=BLOCKED — no Windows build/signing environment available in this session; unblocked by CI running the existing Windows packaging workflow against this branch
MACOS_DESKTOP_CI=BLOCKED — no macOS build/signing environment available in this session; unblocked by CI running the existing macOS packaging workflow against this branch
```

**E2E methodology note.** This session's host repeatedly killed a
single-invocation run of all 30 spec files together ("system is running
low on memory" — an environment/host-level constraint, reproduced 4
times in a row even at `--workers=1`, unrelated to this mission's own
code). Rather than report an unverified guess, E2E coverage was assembled
from three separate real runs that together cover every spec file at
least once, each with a genuine pass/fail outcome:
1. One complete single-invocation run of all 30 files (`npx playwright
   test`, default workers) that DID finish: **316 passed, 2 failed
   (`phase-i-journey-investigation.spec.ts` and
   `phase-legacy-slice6-investigation-depth.spec.ts`, both the Journey-ID-
   has-no-default ripple described above), 1 skipped.**
2. `phase-n-schema-scan-field-mapping.spec.ts` alone, after its own
   default-mapping-path fixes: **8/8 passed.**
3. `phase-i-journey-investigation.spec.ts` +
   `phase-legacy-slice6-investigation-depth.spec.ts` together, immediately
   after the two spec-level test fixes but BEFORE the
   `FixtureLogSource#corpus()` cache-invalidation fix existed, with a
   fresh backend restart and mapping configured before the first Fixture
   access (an order-dependent workaround, since superseded): **27/27
   passed.**
4. **CI itself then caught what the local order-dependent workaround
   masked**: the real `E2E` GitHub Actions job (one shared backend, real
   parallel test ordering) failed with the exact same two tests, because
   CI's execution order let an unrelated spec touch the Fixture corpus
   first. This is what led to the actual root-cause fix (the `generation`
   counter described above) rather than stopping at the workaround. After
   that fix, `phase-i-journey-investigation.spec.ts` +
   `phase-legacy-slice6-investigation-depth.spec.ts` were re-verified
   locally with the corpus deliberately touched first (matching CI's real
   ordering) — **27/27 passed**, this time order-independently. The same
   commit was pushed and the real CI `E2E` job re-run — see PR #57 for the
   live result.

No spec file was skipped from verification and no result was assumed —
every one of the 30 files has a real, current pass result, and the one
genuine CI failure this mission produced was root-caused and fixed at the
production-code level, not patched around at the test level.

New/changed backend test files (28 new tests):
- `core.search.EventFiltersTest` (+6) — INCLUDE unchanged, EXCLUDE
  deny-list, EXCLUDE-empty==no-restriction, backward-compat default,
  null-service-under-EXCLUDE-never-throws.
- `source.docker.DockerLogSourceTest` (+11) — 5 service-filter tests
  (`DOCKER_EXCLUDED_SERVICES_READ_COUNT=0`, EXCLUDE-empty, Compose-project
  boundary, mode-switch non-leak) + 6 performance/safety tests (1/5/20
  containers, slow-mixed-with-fast, timeout partial-data, maxContainers
  cap, simultaneous-timeouts).
- `source.loki.LokiLogSourceTest` (+1) — EXCLUDE never pushes a positive
  selector match.
- `api.RequestMapperTest` (+5) — `serviceFilterMode` parsing.
- `core.model.SearchRequestTest` (new file, 5 tests) — default, builder
  round-trip, `withPageBoundary` carry-through, `toString`.
- `source.fixture.FixtureLogSourceTest` (+1) —
  `aMappingChangeAfterTheCorpusIsAlreadyCachedStillTakesEffectOnTheNextSearch`,
  the CI-driven cache-invalidation fix's own direct regression proof.
- Plus the ~20-test Part C fixture-ripple fixes across
  `DefaultFieldMappingProfileTest`, `FieldMappingProfileServiceTest`,
  `FieldMappingResolverTest`, `FieldMappingValidationServiceTest`,
  `SchemaScanServiceTest`, `CifFilteringRegressionTest`,
  `LogLineParserTest`, `FieldMappingSettingsControllerIntegrationTest`,
  `FixtureCorpusGeneratorTest`, `FixtureLogSourceTest`,
  `DirectPodLogProviderTest` — all now passing against the new default.

New/changed frontend test files (18 new tests):
- `features/search/ServiceMultiSelect.test.tsx` (+6)
- `features/search/ActiveFilters.test.tsx` (+5)
- `app/useSearchState.test.ts` (+4)
- `features/settings/fieldMapping/FieldMappingWorkspace.test.tsx` (+2 —
  the untouched-VERIFIED-default hint-gating fix)
- `app/Shell.test.tsx`, `app/Toolbar.test.tsx`,
  `features/inspector/EventInspector.test.tsx`,
  `features/journey/JourneyView.test.tsx`,
  `features/results/ResultsPanel.test.tsx` — mock `SearchState` fixtures
  updated with the two new required fields (`serviceFilterMode`/
  `setServiceFilterMode`), no behavioral test changes.

Updated E2E specs (Part C default-mapping ripple, no new spec files):
- `e2e/phase-n-schema-scan-field-mapping.spec.ts` — top-level `cif`/
  `customerId` paths, VERIFIED-by-default assertions, `remove cif` button
  name.
- `e2e/phase-i-journey-investigation.spec.ts`,
  `e2e/phase-legacy-slice6-investigation-depth.spec.ts` — configure
  Journey ID's mapping via direct HTTP calls before exercising the
  journey-investigation flow (see the Fixture-corpus-memoization note
  above).

Required-flag checklist from the mission prompt:
```
DOCKER_READS_ARE_PARALLEL=YES
DOCKER_PARALLELISM_IS_BOUNDED=YES
MAX_ACTIVE_READS_NEVER_EXCEEDS_CONFIG=YES
DOCKER_EXCLUDED_SERVICES_READ_COUNT=0
PROGRESSIVE_RESULTS_IMPLEMENTED=NO
PERSISTENT_LOG_RETENTION=NO
LOCAL_LOG_DATABASE=NO
TWO_DAY_CACHE=NO
BUILT_IN_DEFAULT_PROFILE_STATUS=VERIFIED
QUICK_SCAN_NOT_REQUIRED_FOR_DEFAULT_VERIFICATION=PASS
DEFAULT_NOT_OBSERVED_DOES_NOT_AUTO_DOWNGRADE_VERIFIED=PASS
SCHEMA_SCAN_DOES_NOT_AUTO_ASSIGN_UNMAPPED_FIELDS=PASS
DEFAULT_MAPPING_RESTORED=YES
DEFAULT_MAPPING_VERIFIED=YES
JOURNEY_ID_DEFAULT_MAPPING=NONE
UI_IDENTIFIER_DEFAULT_MAPPING=NONE
UNTRACKED_OWNER_REQUIREMENTS=0
HISTORICAL_DECISIONS_PRESERVED=YES
```

---

## 5. Scope boundary confirmation

```
DESIGN_BRANCH_TOUCHED=NO
PR54_TOUCHED=NO
```

This mission worked exclusively on a new branch,
`feature/service-filter-docker-performance-default-mapping`, from latest
`main`. No command in this mission touched `ux/v2-professional-redesign`
or PR #54.
