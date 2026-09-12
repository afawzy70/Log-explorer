# OS-1C — Direct OpenShift Log Search, Bounded Multi-Pod Merge, Truthful Sorting/Truncation & Partial-Scope Handling

Mission: `OS_1C_OPENSHIFT_DIRECT_SEARCH`.
Base: `4fc57bafbd9162de2fb630170be92e124d0a0ced` (post-PR #40 `main`, the
OS-1B review-recovery squash merge).
Branch: `os/1c-openshift-direct-search`.

OS-1C implements **bounded direct log search over the Kubernetes/OpenShift
Pod Logs API**, consuming OS-1B's already-resolved scope exactly as
resolved. There is no live tail, no context view, no correlation fan-out,
no raw LogQL, and no pagination — the source's declared capabilities
change in exactly one place (`historicalSearch: false → true`) and say so
truthfully.

---

## 0. PR #40 merge gate

PR #40 was merged and `main` verified green **before this branch was
cut** — confirmed directly against GitHub, not assumed:

| Gate | Result |
|---|---|
| PR #40 state | `MERGED` |
| Squash-merge commit | `4fc57bafbd9162de2fb630170be92e124d0a0ced` |
| Post-main CI (`main`, run `34648957206`) | `success` |
| Post-main Windows Desktop (`main`, run `34648957179`) | `success` |
| `os/1c-openshift-direct-search` cut from a commit containing `4fc57ba` | PASS — `git merge-base --is-ancestor 4fc57ba HEAD` confirms |

---

## 1. Architecture

```
OpenShiftLogSource
   -> DirectPodLogProvider              (new, OS-1C)
   -> OpenShiftApiClient#fetchPodLog    (new method, OS-1C)
   -> LogLineParser                      (reused, unmodified)
   -> EventFilters                       (reused, unmodified)
   -> deterministic merge (new, OS-1C)
   -> bounded SearchResult
```

`OpenShiftLogSource` is unchanged in shape: still one `@Component`, still
implementing `LogSource` directly, still delegating everything below
`search()`/`describeScopeWarnings()` to a small collaborator
(`DirectPodLogProvider`), exactly the same "adapter is thin, the real work
lives in a dedicated class" shape `DockerLogSource`/`LokiLogSource`
already use. No parallel search stack was created; no new DTOs were
added; no new masking path was added.

`openshift-loki` (the future Loki-backed OS-1G path) is untouched — no
file under `source/openshift` that predates this slice's own new files
was renamed, and the aggregated-provider architecture assessment's own
"primary: DirectPodLogProvider, later: AggregatedLogProvider→Loki" split
is exactly what this slice delivers the first half of.

---

## 2. OS-1B contract: scope is consumed, never rediscovered (§4)

`DirectPodLogProvider` reads `OpenShiftSession#scope()` — the exact
`OpenShiftScope` OS-1B's `OpenShiftScopeService` last resolved and cached
— and never calls any `OpenShiftScopeService` discovery method itself.
"Workload = All" and "Pod = All" mean exactly what OS-1B already resolved;
this class only decides **which of those already-resolved pods/containers
a specific search targets** (§10), never re-derives the set.

Evidence:

- `DirectPodLogProvider#resolveTargets` — the `PodSummary` list it iterates
  is always `scope.pods()`, sourced from `OpenShiftSession`, never from a
  fresh API call.
- `deselectingWorkloadStillOnlyQueriesWhatOs1bResolvedNeverEveryNamespacePod`
  (`DirectPodLogProviderTest`) — seeds exactly one pod via OS-1B's own
  `updatePods` contract and proves the provider queries only that pod,
  never issuing a second, broader request.
- If `PodDiscovery.status = PARTIAL` (carried forward as
  `OpenShiftScope#podScopeComplete() == false`), the search operates over
  that partial scope and `describeScopeWarnings` names the incompleteness
  — it never widens scope to compensate. Proved by
  `describesAPartialPodScopeWarningWhenOs1bCouldNotResolveEveryPod`.

---

## 3. The Kubernetes Pod Logs endpoint (§5)

`OpenShiftApiClient#fetchPodLog` issues exactly one call per (pod,
container) target:

```
GET /api/v1/namespaces/{namespace}/pods/{pod}/log
    ?container={container}&timestamps=true&follow=false&tailLines={N}[&sinceTime={instant}]
```

- `follow` is **always** `false` — a single bounded read, never a live
  stream. Live tail is OS-1E's job, explicitly out of scope here.
- `timestamps=true` is **always** requested, so every line arrives
  prefixed with Kubernetes' own RFC3339Nano receive timestamp — this
  becomes the event's `sourceTimestamp` (the same "adapter's own native
  clock, always known even for a malformed line" role Docker's frame-
  receive time and Loki's stream-entry timestamp already play).
- `tailLines` is an additional hard bound, independent of `sinceTime`.
- No `oc logs` execution, no shell, no runtime `oc` CLI dependency — only
  `WebClient#get()`, the same HTTP client every other OpenShift call in
  this codebase already uses.

The response body is **plain text**, not JSON, unlike every other
OpenShift call this client makes — `fetchPodLog` has its own raw-text read
path rather than the shared `get()` helper, which always expects a JSON
body.

### Time-range truth (§6)

`sinceTime` is pushed down as an optimization only — it narrows what the
cluster sends, nothing more. The exact `request.start()`/`request.end()`
bound is always re-applied after parsing, by the same shared
`EventFilters.matches` call site every other source uses (§15 below). This
mirrors Docker's own `since`/`until` push-down precedent exactly:
approximate server-side narrowing, exact client-side truth. Consistent
with that precedent, `OpenShiftLogSource` does not override
`describePushDown` (Docker doesn't either) — `QueryPlan`'s generic "no
source-side push-down" note applies the same way it already does for
Docker, and is not a gap introduced by this slice.

---

## 4. The bounded fetch model (§7/§8) — every limit is real

**Correction (OS-1C review recovery — see §21).** This section originally
claimed `maxBytesPerTarget` was enforced by "client-side truncation of the
response body in `fetchPodLog`." That was **not accurate**: the original
implementation called `bodyToMono(String.class)` (materializing the
*entire* upstream response into memory first) and only then truncated the
resulting `String` by `.length()` — a UTF-16 character count, not a byte
count, and no memory bound at all (the full body was already buffered
before truncation ever ran). §21 documents the real fix: true streaming
byte-counted consumption that never materializes more than `maxBytes` of
the response, regardless of upstream size. The table below is corrected
to describe the *current*, real implementation.

`config.DirectPodLogProperties` (`logexplorer.openshift.direct-search.*`):

| Property | Default | Enforced by |
|---|---|---|
| `maxPods` | 20 | `resolveTargets` — caps distinct pods **before** per-pod container expansion |
| `maxTargets` | 40 | `resolveTargetPlan` — caps the resulting (pod, container) fan-out, after dedup |
| `maxLinesPerTarget` | 2000 | `tailLines` on the pod-log request itself, plus a conservative `LINE_CAP_REACHED_OR_POSSIBLE` runtime warning when exactly that many lines come back (§21 — the API gives no separate "there were more" signal) |
| `maxBytesPerTarget` | 2,000,000 | **true streaming byte-bounded consumption** in `OpenShiftApiClient#readBounded` (§21) — real encoded bytes counted as `DataBuffer`s arrive off the wire, upstream subscription cancelled the instant the cap is reached, never a full-body read followed by a `String.length()` truncation |
| `maxEventsOverall` | 2000 | `trimToInternalCap`, applied to the final merged/sorted list, and disclosed as `OVERALL_EVENT_CAP` (§21) when this internal safety cap — never the caller's own smaller requested limit — is what actually trimmed the result |
| `maxConcurrency` | 6 | `Flux#flatMap(fn, maxConcurrency)` in `fetchAndMerge` |
| `perTargetTimeout` | 10s | per-target `.timeout(...)` in `fetchPodLog`, classified as its own `Kind.TIMEOUT` (§21) distinct from a generic network/upstream failure |
| `overallTimeout` | 20s | whole-search `.timeout(...)` in `search()`, deliberately shorter than the 30s app-wide default so an OpenShift search fails predictably on its own bound |

**`maxPods` vs `maxTargets` — two independently enforced dimensions.**
During implementation, `maxPods` was defined but not yet wired into any
enforcement path — a real, self-caught gap (only `maxTargets` capped
anything). Fixed before this slice's tests were finalized:
`resolveTargets`'s "Pod=All" branch now caps `scope.pods()` to `maxPods`
**before** expanding each surviving pod's own containers, so a namespace
with many single-container pods and one with few many-container pods are
each bounded on the dimension that actually threatens them. Covered by
`neverConsidersMoreDistinctPodsThanTheConfiguredPodCap`.

**Truncation is never silent (§8).** When resolved targets/pods exceed a
cap, the gap is named through `describeScopeWarnings`:

- `"Only {maxPods} of {N} resolved pods were included in this search
  (TARGET_CAP_REACHED) - some pods were skipped."`
- `"Only {queried} of {resolved} resolved pod/container targets were
  queried (TARGET_CAP_REACHED) - some pods were skipped."`

Covered by `neverQueriesMoreThanTheConfiguredTargetCapAndSkippedTargetsAreNamedNotSilentlyDropped`
and `neverConsidersMoreDistinctPodsThanTheConfiguredPodCap`.

**Bounded concurrency (§9).** `fetchAndMerge` uses
`Flux.fromIterable(targets).flatMap(fn, properties.getMaxConcurrency())` —
never one unbounded request per target. Proved against a genuinely
multi-threaded fake server by `fanOutNeverExceedsTheConfiguredMaxConcurrency`
(asserts the server's own observed peak in-flight request count).

---

## 5. Pod/container target semantics (§10) — exactly as specified

| Selection | Targets |
|---|---|
| Selected Pod + Selected Container | exactly one target |
| Selected Pod + Container = All | every runtime container in that pod |
| Pod = All + a selected Workload | every OS-1B-resolved pod for that workload, each pod's own containers |
| Pod = All + Workload = All | OS-1B's already-resolved supported-workload pod union — never re-derived, never namespace-wide |
| Container = All across multiple pods | each pod's own discovered containers — never assumed identical across replicas |
| Init containers | remain DEFERRED — `resolveTargets` only ever reads `PodSummary#containerNames()`, which OS-1B already excludes init containers from |

Tests: `selectedPodAndSelectedContainerIsExactlyOneTarget`,
`selectedPodWithContainerAllFetchesEveryRuntimeContainerInThatPod`,
`podAllWithSelectedWorkloadFetchesEveryResolvedPodItsOwnContainers`.

Targets are deduplicated by `(pod, container)` identity
(`targetKey()`) before any cap or fetch — guards against duplicate
resolution from overlapping selectors without ever dropping a
legitimately-repeated log line (dedup happens at the target-resolution
level, never at the event level).

---

## 6. Canonical parsing pipeline reused exactly (§12/§13)

No second parser, no second filter engine. `DirectPodLogProvider` calls
the exact same `core.parse.LogLineParser#parse(content, serviceHint)` and
`core.search.EventFilters#matches(event, request)` every other source
uses:

- A non-JSON / malformed pod-log line becomes a raw-fallback event,
  never dropped — `plainTextNonJsonLineBecomesARawFallbackEventNeverDropped`.
- A Java stack trace embedded inside one JSON object's `exception` field
  stays one logical event, exactly like every other JSON-logging source —
  `multilineExceptionEmbeddedInOneJsonObjectStaysOneLogicalEvent`. There is
  no client-side line-stitching across raw pod-log lines anywhere in this
  codebase (confirmed: multiline reconstruction has never existed here —
  see OS-1C mission §13's own framing), and this slice does not add one;
  each upstream pod-log line is parsed independently, and a multiline
  exception only stays intact because the *application* already emitted
  it as one JSON value, not because OS-1C stitched raw lines together.
- Sensitive fields (`cif`/`UserName`/`CustomerId`/`deviceId`/`deviceIp`)
  are carried raw on the parsed event for source-side filter matching only
  — masking still happens at the one existing boundary
  (`core.mask.MaskingService`), never touched by this slice. Proved by
  `sensitiveFieldsAreCarriedRawForSourceSideMatchingNeverDroppedByParsing`.
- Structured filters are applied post-fetch, identically to every other
  source — `structuredFilterIsAppliedAfterParsingExactlyLikeEveryOtherSource`.
  No OpenShift-specific query language exists; `capabilities().rawLogQL()`
  stays `false`.

---

## 7. Deterministic multi-stream merge (§17) and truthful sorting (§18)

Primary sort key: `CanonicalLogEvent#sourceTimestamp()` (Kubernetes'
`timestamps=true` receive time), direction-of-travel ordered
(`Comparator.naturalOrder()` for FORWARD/oldest-first,
`Comparator.reverseOrder()` for BACKWARD/newest-first — the default).
Explicit, stable tie-breakers, in order: namespace, pod, container, then
each event's own per-stream sequence number. Nothing is ever left to Flux
arrival timing or which HTTP response completes first.

Proved two ways:

- `mergesMultiplePodsDeterministicallyByTimestampThenNamespacePodContainer`
  — two pods emit events at the exact same instant; the merged order is
  the deterministic tie-break, not whichever pod's HTTP response happened
  to arrive first (the two responses are deliberately given different
  artificial delays).
- `resultOrderDoesNotDependOnWhichUpstreamRequestCompletesFirst` — a
  chronologically **earlier** event is deliberately made to arrive
  **later** over HTTP (200ms artificial delay vs 0ms for the
  chronologically later event); the merged result is still in the correct
  chronological order.

NEWEST/OLDEST (`newestFirstAndOldestFirstBothOperateOnTheSameBoundedCandidateSet`)
both operate on the same fetched set — truthful only within the bounded
window this search actually retrieved, never a claim of global historical
ordering. Oldest-first is never implemented by reversing an
already-truncated newest-first page; both directions run the same
fetch-then-sort pipeline with only the comparator direction and the
trim-cap's meaning changed.

---

## 8. No fake pagination (§24)

`DirectPodLogProvider#trimToInternalCap` self-trims the returned event
list to `min(request.limit() ?? maxEventsOverall, maxEventsOverall)`
**before** `search()` returns anything to `SearchService`. Because
`SearchService.toResult()` only ever builds a `nextCursor` when a source
returns *more* events than the guardrail-computed effective limit, and
this source never does, `SearchService` can never manufacture a cursor for
an OpenShift search — `pagination` (derived frontend-side purely from
whether a response actually carries a `nextCursor`) stays honestly `false`
without this source needing to say so itself, and without any invented
cursor semantics. Proved by
`neverReturnsMoreThanMaxEventsOverallSoNoFakePaginationCursorCanEverBeBuilt`.

---

## 9. Pod/container churn and RBAC (§21/§22)

| Scenario | Behavior | Test |
|---|---|---|
| One pod 404s (disappeared) | excluded; others still return; **now also named as a `TARGET_NOT_FOUND` runtime warning (§21)** | `oneDisappearedPodDoesNotFailTheWholeSearch`, `oneOkPlusOneNotFoundIsPartialWithATargetNotFoundReason` |
| One target 403s, others readable | excluded; result is partial, not an error; **now also named as a `PERMISSION_DENIED` runtime warning (§21)** | `oneForbiddenTargetIsPartialWhenOthersAreReadable`, `oneOkPlusOneForbiddenIsPartialWithAPermissionDeniedReason` |
| **Every** target 403s | explicit `OpenShiftApiException(Kind.FORBIDDEN)` — never a silent empty result | `everyTargetForbiddenIsAnExplicitForbiddenResultNeverASilentEmptySearch` |
| **Every** target 404s, times out, or errors (no 403 involved) | **OS-1C review recovery (§21):** explicit `OpenShiftApiException(Kind.UPSTREAM_UNAVAILABLE)` — previously a silent, complete-looking empty result | `everyTargetNotFoundIsAnExplicitFailureNeverASilentCompleteEmptyResult`, `everyTargetTimedOutOrErroredIsAnExplicitFailureNeverASilentCompleteEmptyResult` |
| Any target 401s | the whole search aborts, session is marked `EXPIRED` | `unauthorizedAbortsTheSearchAndExpiresTheSession` |
| One target exceeds `perTargetTimeout` | excluded; others still return; **now also named as a `TARGET_TIMEOUT` runtime warning, distinct from a generic upstream error (§21)** | `oneSlowPodExceedingItsPerTargetTimeoutIsExcludedButOthersStillReturn`, `oneOkPlusOneTimeoutIsPartialWithATargetTimeoutReason` |
| One target's response exceeds `maxBytesPerTarget` | truncated to exactly the cap, never dropped; **now named as a `BYTE_CAP_REACHED` runtime warning (§21)** | `oneOkPlusOneByteCappedTargetIsPartialWithABytesCapReachedReason`, `aByteCappedTargetIsCancelledWhileOtherTargetsContinueNormally` |
| A specific container 404s (missing) | excluded like any other 404 | `aMissingContainerIsExcludedLikeAnyOtherFourOhFour` |

A workload rolling mid-search never attaches new pods — the scope
snapshot below is fixed at search start, and attaching newly-appeared pods
mid-search is explicitly Live's job (OS-1E), not this slice's.

---

## 10. Immutable scope snapshot (§23)

`DirectPodLogProvider#search` reads `session.generation()`, `session.server()`,
`session.token()`, `session.certificateAuthorityPath()` and the whole
`session.scope()` **exactly once**, synchronously, inside one
`Mono.defer(...)`, before any upstream call is issued. Every target
fetched by one search call belongs to that one snapshot; a project or
workload switch that happens after a search has started cannot retroactively
change which pods/containers that search queries. Protecting the
*frontend's* active search state from a late-arriving stale response reuses
the existing generic search request/abort machinery (established since
UX-R3) — this slice adds no new mechanism for that, per the mission's own
"reuse existing protections" instruction.

---

## 11. Security (§30/§40)

- Every OpenShift call OS-1C makes is a read-only `GET` — no exec, no
  attach, no port-forward, no mutation, no Secrets/ConfigMaps API, no
  environment dump. The only new cluster operation introduced by this
  slice is read-only pod-log retrieval.
- `OpenShiftApiClient#classify` (pre-existing OS-1A mechanism, unmodified)
  never surfaces a raw response body, the Authorization header, or the
  underlying exception's message — `DirectPodLogProvider` logs nothing and
  never renders a raw Kubernetes API response body. Safe scope identity
  (pod/container/namespace name) may appear in `describeScopeWarnings`
  text, consistent with the existing disclosure policy.
- No new masking path: sensitive fields are masked at the one existing
  boundary, exactly as every other source already relies on.

---

## 12. Capability and health truthfulness (§25/§26)

`OpenShiftLogSource#capabilities()`: `historicalSearch` flips
`false → true`. Every other capability (`liveTail`, `rawLogQL`,
`contextView`, `serviceDiscovery`, `queryStatistics`,
`composeProjectScoping`) remains `false`, unchanged. This is option (A)
from the mission's own §25 choice: the *existing* `historicalSearch`
capability's real product meaning — "this source can be asked to search
and will return a real, bounded set of matching events" — is exactly true
for OS-1C's bounded direct search, so no new capability field was
invented. `historicalSearch=true` does **not** mean "indexed history";
Docker's own `historicalSearch=true` never meant that either (Docker's
search is also a bounded, per-request read over live container logs, not
an index) — OS-1C's flag is truthful by the same standard this codebase
already applies to Docker.

`OpenShiftLogSource#health()` now distinguishes three states within
`CONNECTED` region, never conflating them:

- Connected + project selected → `UP`, "Connected to `<server>` (`<project>`)"
- Connected + **no** project selected → `DEGRADED`, with an explicit
  warning ("Select a project/namespace in Settings to search") — genuinely
  not search-ready, but nothing is broken
- `EXPIRED`/`FAILED` → `DOWN`, unchanged from OS-1A

Never reports "healthy, search-capable" while the session is expired.
Proved by `healthReflectsConnectionStateWithoutAlarmingAboutTheNormalStartingState`
(backend) — connect without selecting a project stays `DEGRADED`, only
selecting a project reaches `UP`.

---

## 13. Query-plan transparency reused, not reinvented (§20 truncation vocabulary)

Rather than inventing a parallel "OpenShift scope warnings" DTO field, this
slice extends the existing, already-frontend-wired `QueryPlan.notes`
channel:

- `LogSource#describeScopeWarnings(SearchRequest)` — new default method
  (mirrors the existing `describePushDown` extensibility pattern exactly),
  returning `List.of()` for every source that doesn't override it
  (Fixture, Docker, Loki — no behavior change for them).
- `QueryPlanBuilder#build(request, sourcePushDown, sourceWarnings)` — new
  three-arg overload; the existing two-arg overload delegates to it with
  an empty warnings list, so every existing call site is unaffected.
  Covered by `QueryPlanBuilderTest#sourceWarningsAreAppendedToNotesVerbatimAfterTheGenericOnes`
  and `#theTwoArgOverloadAddsNoSourceWarnings`.
- `SearchService` passes `source.describeScopeWarnings(scoped)` through to
  the three-arg overload — one line changed.
- `DirectPodLogProvider#describeScopeWarnings` reports exactly two
  proactively-knowable conditions, using OS-1C's own truncation vocabulary
  reused from the mission's own suggested set: workload-kind scope
  incompleteness (`SCOPE_PARTIAL`, from OS-1B's `workloadScopeComplete()`),
  pod-scope incompleteness (`SCOPE_PARTIAL`, from OS-1B's
  `podScopeComplete()`), and target/pod-cap truncation
  (`TARGET_CAP_REACHED`).

**Known, disclosed gap — RESOLVED (OS-1C review recovery, §21).** This
paragraph originally read: *"A specific target's own runtime failure (one
pod 403s, one 404s, one times out) is only known during `search()`, and
`LogSource#search` has no return channel back into the query-plan notes
`SearchService` builds before the search runs... not yet individually
named as their own user-visible note in this slice... documented as a
follow-up, not silently dropped."* That gap is now closed:
`LogSource#searchWithOutcome` (a new default method, §21) gives every
source — not only OpenShift — a return channel for exactly this kind of
runtime metadata, and `DirectPodLogProvider#searchWithOutcome` populates
it with per-condition-kind runtime warnings (`TARGET_NOT_FOUND`,
`PERMISSION_DENIED`, `TARGET_TIMEOUT`, `UPSTREAM_ERROR`,
`BYTE_CAP_REACHED`, `LINE_CAP_REACHED_OR_POSSIBLE`, `OVERALL_EVENT_CAP`),
which `SearchService` appends into the same `QueryPlan.notes` channel this
section already established for scope-level warnings — pre-search and
runtime reasons now coexist in one place, never two. This history is kept
here rather than deleted so the gap this slice originally, honestly
disclosed remains visible alongside its later fix — see §21 for the full
before/after account.

---

## 14. Frontend (§31/§32) — LERUX-1 diagnosis, no implementation needed

**LERUX-1 finding.** A rendered-app-behavior investigation (five-layer
trace of the Search UI's use of source capabilities, `SourceHealth`, and
`QueryPlan`) found **zero frontend gating on `historicalSearch`
anywhere**:

- `useSearchState.ts#runSearch` only checks that *a* source is selected;
  it never inspects `capabilities.historicalSearch`. `SourceSelect.tsx`
  lists every registered source unconditionally. `Toolbar.tsx` gates only
  `liveTail`, `rawLogQL` and `composeProjectScoping` — `historicalSearch`
  is read in exactly one place (`SourceHealthBadge.tsx`'s capability list,
  purely for display) and gates nothing.
- `QueryPlan.notes` is **already** rendered generically —
  `QueryPlanDisclosure.tsx` maps every note into a bullet list under a
  collapsed-by-default "Query details" disclosure, shown above the results
  table on every search. Any note `DirectPodLogProvider#describeScopeWarnings`
  adds appears there automatically, with zero source-specific frontend code.
- `SourceHealth.warnings` is **already** rendered generically —
  `SourceHealthBadge.tsx` shows a titled warnings list inside the health
  popover whenever the array is non-empty. The new "no project selected"
  warning this slice adds to `OpenShiftLogSource#health()` renders through
  this existing path with zero frontend changes.
- "Load more" (`ResultsPanel.tsx`) keys purely on `nextCursor` being
  present, not on any capability flag — combined with §8 above
  (`pagination` never becomes true for this source), no fake "Load more"
  control can ever appear for an OpenShift search.
- The `counts.truncated` pattern (`buildCountsSummary`,
  `ContextSummary.tsx`, `JourneyView.tsx`) already renders "Results may be
  incomplete — this source returned a bounded subset (limit reached)" for
  any source whose result is truncated — this applies to OpenShift without
  modification the moment `ResultCounts#truncated()` is true for it.
  `OpenShiftSettingsPanel.tsx` already has its own OS-1B-era PARTIAL-scope
  banner precedent for pod discovery, confirming this project's established
  tone/wording convention for "may be incomplete" messaging.
- No frontend code anywhere branches on `source.id === 'openshift'` to
  disable, hide, or special-case Search — nothing needed removal.

**Conclusion: the existing Search UI genuinely "just works" for the
OpenShift source once `historicalSearch=true` is flipped server-side.** No
LERDESIGN-1 proposal was needed because no defect or gap was found — per
that skill's own operating rule, "a surface with no measured friction is
left alone" is the correct, valid output here, not a redesign in search of
a problem.

**LERUX-1 verification performed:**

- One existing OS-1A E2E assertion (`os-1a-openshift-connection.spec.ts`,
  "OpenShift appears as a source but advertises no search capability yet")
  asserted the now-stale `historicalSearch === false`. **Corrected**, not
  silently deleted: renamed to "...advertises exactly the search
  capability it can deliver", updated to assert `true`, with an explicit
  in-file comment explaining why (`historicalSearch`'s real meaning is
  "bounded direct search," which is now genuinely true for this source),
  plus two additional assertions (`rawLogQL`/`composeProjectScoping` stay
  `false`) that were implicit before. Re-run and green (see §16).
- Full frontend unit suite (751 tests) and full Playwright suite (287
  tests) re-run and green — confirming no regression to Docker/Fixture/
  Loki UI behavior and that the one corrected assertion above is now
  truthful against the real running app.

**What was NOT done, and why that is honest rather than a shortcut.** No
new Playwright spec drives a real, successful "connect → select project →
search → see OpenShift-sourced results" flow end-to-end. OS-1A's own E2E
spec explicitly established the precedent that these specs "deliberately
do NOT need a real cluster" and test only the client-side security/failure
surface; OS-1B — a strictly more complex discovery UI — added zero
Playwright specs at all, relying entirely on backend integration tests
(`OpenShiftScopeControllerIntegrationTest`) and frontend component tests
(`OpenShiftSettingsPanel.test.tsx`). OS-1C follows that same, already-
accepted precedent: backend behavior is proven at Layer 1/2
(`DirectPodLogProviderTest`, 28 tests against a deterministic fake pod-log
server), and frontend reuse is proven by source-level trace plus the
full existing regression suite staying green. A rendered screenshot of
real OpenShift-sourced events in the Results table would additionally
require a fake server implementing enough of the OpenShift Projects/
workload/pod-list APIs to complete a full connect-and-scope flow through
the real Settings UI — a materially larger, separate piece of test
infrastructure than this slice's own scope, and not something OS-1A/1B
built either. This is recorded as a real, bounded limitation, not
elided: see `REAL_OPENSHIFT_1C` below for the credential-gated real-cluster
equivalent, which remains the authoritative "does this actually render
real OpenShift log lines" evidence this project's testing strategy relies
on once credentials are available.

---

## 15. No scope creep (§46)

Confirmed absent from this slice, by design and by diff review: Context,
correlation-wide fan-out beyond normal structured filters, surrounding-
logs changes, Live/follow, Kubernetes Watch, auto-attach to new pods, Loki
integration/migration, pagination simulation, Jobs/CronJobs, initContainer
logs, REL-1, macOS packaging, GitHub Releases, Phase M.

---

## 16. Validation

| Check | Result |
|---|---|
| `./mvnw -o test -Dtest='com.logexplorer.source.openshift.**'` | PASS — 232 tests, 0 failures, 0 errors, 5 skipped (`OpenShiftRealSandboxIT`, credential-gated) |
| `./mvnw -o test` (full backend suite) | PASS — 850 tests, 0 failures, 0 errors |
| `npm run test` (full frontend unit suite) | PASS — 751 tests |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npx playwright test e2e/os-1a-openshift-connection.spec.ts` | PASS — 17/17, including the corrected capability assertion |
| `npx playwright test` (full suite) | PASS — 287/287 |

**Superseded by the OS-1C review recovery — see §21's own "Validation" subsection for the current, post-recovery numbers** (new byte-bound and runtime-partial test files added, one pre-existing test updated for an intentionally-changed behavior). The row above is kept, not deleted, as the record of what this slice's original PR validated before recovery.

**Precision note, carried forward from the OS-1B recovery's own finding:**
`OpenShiftRealSandboxIT`'s `*IT` suffix means it is excluded from Maven
Surefire's default discovery pattern (no Failsafe plugin is configured in
this repository) — `./mvnw test` never runs or reports it at all (it does
not appear as 0 skipped in that run's totals; it is simply not selected).
It only runs, and only then shows its 5 credential-gated skips, when
targeted explicitly via `-Dtest=OpenShiftRealSandboxIT` or a pattern that
matches it, exactly as documented in the OS-1B report. This report states
exactly which command was run for each number above, per that same
precision discipline.

---

## 17. Documentation-consistency audit (§45)

| Cross-check | Result |
|---|---|
| Implementation vs this report | Consistent — every behavior described above traces to a named class/method and a named test |
| `OWNER_REQUIREMENTS_REGISTER.md` §12d vs implementation | Consistent — OS-1C-1 through OS-1C-21 map 1:1 to the sections above |
| OS-1B's own §20 "OS-1C contract" vs this slice's actual consumption of `PodDiscovery`/scope | Consistent — no re-discovery, no widening, confirmed in §2 above |
| Capability flags (`historicalSearch=true`, everything else `false`) vs frontend gating (none exists) vs this report's §12/§14 | Consistent |
| Frontend semantics (`QueryPlan.notes`, `SourceHealth.warnings`, `counts.truncated`, "Load more") vs backend's actual outputs | Consistent — traced generically, no source-specific frontend branch exists to drift from the backend |
| Real-test status (`REAL_OPENSHIFT_1C=BLOCKED_CREDENTIALS`) vs no fabricated PASS anywhere in this report or the register | Consistent |
| Known gap (§13, per-target runtime-failure notes) — **RESOLVED, §21** | Now consistent the other way: the register's `OS-1C-4` row (and the new runtime-truthfulness rows §21 adds) claim this is solved *with evidence*, matching the actual `searchWithOutcome`/`SourceSearchOutcome` implementation |

No disagreement found between code and documentation. The one genuinely
new limitation surfaced by this slice — `maxPods` initially unused — was
fixed during implementation, before any test was written against the
buggy state, so no test ever needed weakening or deletion to reach green
(§16).

---

## 18. What OS-1C deliberately does not do

Live tail/follow, context view, correlation-wide fan-out, raw LogQL for
this source, real pagination, Jobs/CronJob logs, init-container logs,
Kubernetes Watch, multi-cluster, REL-1 desktop packaging (remains
`APPROVED_PENDING`, untouched, not implemented this slice). Per-target
runtime-failure names were a documented follow-up as of this slice's
original PR (§13) — **now implemented, see §21**.

---

## 19. OS-1D/1E/REL-1 prerequisites this slice leaves in place

- `LogSource#describeScopeWarnings` is a general extension point any
  future source can use the same way — not OpenShift-specific plumbing.
- `PodLogTarget` and `DirectPodLogProvider`'s target-resolution logic are
  the natural place OS-1E's live-tail slice would add a `follow=true`
  variant, without touching OS-1C's own bounded-search path.
- The scope-snapshot discipline (§10) is exactly the boundary OS-1E's Live
  slice will need to extend deliberately (attaching newly-appeared pods is
  explicitly Live's job, never silently folded into a bounded search).

---

## 20. Real-environment status

```
REAL_OPENSHIFT_1A=BLOCKED_CREDENTIALS
REAL_OPENSHIFT_1B=BLOCKED_CREDENTIALS
REAL_OPENSHIFT_1C=BLOCKED_CREDENTIALS
```

No `OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN` were supplied this mission.
No OS-1C-specific real-sandbox integration test was written — consistent
with OS-1A/1B's own precedent of writing that test only once credentials
exist to verify anything against. No skipped test was converted to `PASS`.

---

## 21. OS-1C REVIEW RECOVERY — true byte-bounded fetch & runtime partial-result truthfulness

Reviewed HEAD at the start of this recovery: `37f39f9826cd00095672228ba617b54f1f6b9fbd`
(PR #41, CI and Windows Desktop green). Two evidence-backed defects were
found and fixed. This section documents both — the real defect, the real
fix, and the real evidence — without deleting §4/§9/§13's own original
(now-corrected) claims above; those stay visible as the honest record of
what this slice originally shipped and disclosed.

### Defect A — `maxBytes` was not a real fetch bound

**Before.** `OpenShiftApiClient#fetchPodLog` called
`.retrieve().bodyToMono(String.class)` — materializing the *entire*
upstream response body into memory — then
`.map(body -> body.length() > maxBytes ? body.substring(0, (int) maxBytes) : body)`.
Two independent problems: (1) the full body was already buffered before
any truncation happened, so `maxBytes` bounded nothing about memory use;
(2) `String#length()` counts UTF-16 chars, not encoded bytes, so even the
*truncation point itself* was wrong for any non-ASCII content. The
report's own §4 (above) claimed this was "client-side truncation of the
response body" — true only in the most literal sense (a `String` was
truncated), not in the sense the mission's own contract promised (a real
client-side *byte* bound enforced *during* consumption).

**After.** `OpenShiftApiClient#readBounded` consumes the response as a
raw `Flux<DataBuffer>` (`.retrieve().bodyToFlux(DataBuffer.class)`, never
`bodyToMono`) through a hand-rolled `BaseSubscriber`:

- Counts real encoded bytes via `DataBuffer#readableByteCount()`/`#read(byte[])`
  as buffers arrive, never `String.length()`.
- Never accumulates more than `maxBytes` — the buffer that straddles the
  cap is copied only up to the remaining budget; nothing beyond that is
  ever written to the accumulator.
- Calls `cancel()` on the upstream subscription the instant the cap is
  reached — Reactor Netty propagates this to the real connection, so nothing
  beyond a small, Reactive-Streams-permitted number of already-in-flight
  buffers is ever read off the wire for an oversized response.
- Releases every consumed `DataBuffer` in a `finally` block (success, cap,
  or error path alike) — proven with real pooled Netty buffers and
  `ByteBuf#refCnt()` reaching exactly `0`, not merely "release() was
  called."
- Never touches Spring's default in-memory codec limit
  (`spring.codec.max-in-memory-size`, 256 KB) — that limit only applies to
  strategies that themselves aggregate a whole body (`bodyToMono`, an
  unbounded `DataBufferUtils.join`); raw `Flux<DataBuffer>` consumption has
  no such limit, so `maxBytes` (this call's own parameter) is the only
  bound in effect regardless of whether it is smaller or larger than that
  default.
- Decodes UTF-8 exactly once, after the bounded byte array is complete.
  `OpenShiftApiClient#trimIncompleteUtf8Suffix` walks backward from the cut
  point (at most 3 bytes, using UTF-8's own self-describing lead/
  continuation-byte structure) and drops a genuinely incomplete trailing
  multi-byte sequence, so a truncated response never ends in a garbled
  U+FFFD replacement character — every byte before the cut is untouched.

`fetchPodLog` now returns `Mono<PodLogFetchResult>`
(`record PodLogFetchResult(String body, boolean byteCapReached)`) instead
of `Mono<String>` — the byte cap having actually fired is a first-class,
never-hidden part of the return value, not something a caller has to
infer.

**A second, related bug this recovery self-caught and fixed.** With true
byte-bounded reading in place, a `DirectPodLogProviderTest` run first
surfaced that a byte-capped response's own trailing (necessarily
incomplete) line was being parsed into a real, visible "malformed" event —
an artifact of exactly where the client's own cap happened to stop
reading, never a real line the upstream actually sent. Fixed in
`DirectPodLogProvider#fetchTarget`: when `byteCapReached` is true and the
truncated body does not end in `\n`, the trailing split line is dropped
before parsing.

### Line cap truthfulness

`tailLines` remains a real, server-side hard bound (unchanged from §5).
What changed: when a target's response comes back with *exactly*
`maxLinesPerTarget` lines, `DirectPodLogProvider#fetchTarget` now flags
that target's own `linesPossiblyCapped`. The Kubernetes pod-log API gives
no separate "there were more, this was truncated" signal, so this is
deliberately conservative — surfaced as `LINE_CAP_REACHED_OR_POSSIBLE`,
never a claimed certainty (`LINE_CAP_REACHED` alone was deliberately never
used). A response with fewer lines than the limit is never flagged.

### Defect B — runtime target failures are now user-visible

**Before.** `DirectPodLogProvider#search` returned `Flux<CanonicalLogEvent>`
only. A target that 403'd/404'd/timed out was correctly skipped (§9's
resilience behavior, unchanged), but nothing about *why* the result might
be incomplete reached the caller — `SearchService` builds the query plan
(and its `notes`) *before* `source.search()` even runs, so there was
structurally no channel for a runtime discovery to reach it. Worse: when
**every** resolved target failed for a reason other than 403 (all 404,
all timeout, all generic error), the result was a plain, successful,
*empty* `SearchResult` — indistinguishable from "this project genuinely
has zero matching events right now."

**After — the request-scoped outcome channel.** A new record,
`core.model.SourceSearchOutcome(events, runtimeWarnings)`, and a new
default `LogSource` method:

```java
default Mono<SourceSearchOutcome> searchWithOutcome(SearchRequest request) {
  return search(request).collectList().map(SourceSearchOutcome::of);
}
```

Every existing source (Fixture, Docker, Loki) gets this for free, with an
always-empty `runtimeWarnings` list and zero code changes — exactly
correct, since none of them has a partial-target-failure concept today.
Only `OpenShiftLogSource` overrides it, delegating to a new
`DirectPodLogProvider#searchWithOutcome`, which is now the *one* real
implementation — the pre-existing `Flux<CanonicalLogEvent> search(...)`
(still used by `OpenShiftLogSource#search` for the two SPI methods that
still need a plain `Flux`, and by every pre-recovery test) is a thin
wrapper: `searchWithOutcome(request).flatMapMany(o -> Flux.fromIterable(o.events()))`.

**Never a shared/mutable side channel (mission §4).** `SourceSearchOutcome`
is carried entirely by each call's own return value — no field was added
to `DirectPodLogProvider`, `OpenShiftLogSource`, or `OpenShiftSession` to
hold "the last search's warnings." Proven executable, not just
architectural: `concurrentSearchesOnTheSameProviderInstanceNeverCrossContaminateOutcomes`
(provider level) and
`overlappingConcurrentSearchesOnDifferentSourcesNeverLeakOneSourcesRuntimeWarningsIntoTheOthers`
(`SearchService` level) each run two *genuinely concurrent* searches
(`Mono.zip`, subscribing to both before either necessarily completes) with
deliberately different failure profiles, and assert neither result's
warnings ever mention the other's target/source.

**Aggregated, never per-target-noisy.** `DirectPodLogProvider#buildRuntimeWarnings`
emits at most one note per distinct condition actually observed across a
search's targets ("2 of 5 pod/container targets could not be found..."),
never one note per pod — a namespace with dozens of pods must not flood
the query-plan disclosure. Vocabulary used, matching the mission's own
required set: `TARGET_NOT_FOUND`, `PERMISSION_DENIED`, `TARGET_TIMEOUT`,
`UPSTREAM_ERROR`, `BYTE_CAP_REACHED`, `LINE_CAP_REACHED_OR_POSSIBLE`,
`OVERALL_EVENT_CAP` (runtime, via `searchWithOutcome`); `SCOPE_PARTIAL`,
`TARGET_CAP_REACHED` (pre-search, via `describeScopeWarnings`, unchanged).

**All-targets-failed is never a silent complete-empty result.**
`DirectPodLogProvider#fetchAndMerge` now checks `anyOk` (at least one
target succeeded), not just `allForbidden`:

- All-forbidden → unchanged, still `OpenShiftApiException(Kind.FORBIDDEN)`
  (mission §7 case D — "existing behavior should remain").
- All-failed for any other reason (all 404, all timeout, all generic
  error, or a mix of those with zero successes) → **new** —
  `OpenShiftApiException(Kind.UPSTREAM_UNAVAILABLE)`, a new `Kind` added
  specifically for this (deliberately not reusing `Kind.NOT_FOUND`, which
  means something narrower and connection-level-specific — "the Projects
  API itself does not exist on this cluster" — or `Kind.NETWORK`/`Kind.TIMEOUT`,
  which are connection-level, not pod-log-fetch-specific). Covers mission
  §7 cases C and E.
- `Kind.TIMEOUT` is also new — split out of what used to be folded into
  `Kind.NETWORK`, so a per-target timeout is distinguishable from a
  generic connect/DNS failure (mission §8).
- Mixed (at least one success) → unchanged resilience behavior, now with
  runtime warnings attached — mission §7 cases A/B (partial, not
  "no results").

### Integration into `SearchResult` — reusing existing truncation/notes, no new DTO field

`api.SearchService#toResult` now takes `SourceSearchOutcome` instead of a
plain event list. When `outcome.runtimeWarnings()` is non-empty:

- `ResultCounts#truncated()` is set `true` — the *same* existing field
  ordinary pagination truncation already uses, deliberately reused rather
  than inventing an OpenShift-only completeness flag: both conditions
  share the exact same real-world meaning ("more matching events may exist
  than what is shown"), just with different root causes. `estimatedTotal`
  is correspondingly never reported as an exact number when this is true —
  the same discipline the class javadoc's own "Totals" section already
  established for pagination truncation.
- The runtime warnings are appended into the *same* `QueryPlan.notes` list
  `describeScopeWarnings` already populates pre-search (`SearchService#withAppendedNotes`)
  — a search can genuinely have both a known-partial scope *and* a runtime
  target failure at once, and both reasons now coexist in the one place a
  reader already looks (mission §5/§10 "scope PARTIAL + runtime target
  failure -> both reasons preserved" — covered by
  `preSearchScopeWarningsAndRuntimeWarningsCoexistInTheSameNotesList` and
  `targetCapAndByteCapReasonsBothSurviveTogether`).

No new DTO field, no new frontend concept — see the "Frontend" subsection
below.

### Frontend — real rendered evidence, zero code changes

Per mission §14, LERUX-1 was run again now that the runtime-metadata
contract exists. Finding: **zero frontend changes were needed.**
`frontend/src/features/results/QueryPlanDisclosure.tsx` already renders
`queryPlan.notes` generically (no source-specific branch), and
`frontend/src/features/results/counts.ts#buildCountsSummary` already
renders `counts.truncated` generically. Both were already proven correct
for Docker/Loki's own pre-existing warning use; OS-1C's new note text
flows through the identical, unmodified code path.

Proven with real rendered-browser evidence (LERUX-1's own "reproduce,
capture, inspect the payload" discipline), not "looks right in source"
alone: the real dev app, driven by Playwright, with `/api/v1/logs/search`'s
response stubbed to a realistic OS-1C-shaped payload
(`counts.truncated: true`, one `queryPlan.notes` entry containing
`TARGET_NOT_FOUND`) —

```
Showing 1 event loaded — total unknown for this source, more available — showing results for ...
▾ Query details
  Notes
  • This source reports no source-side push-down for this search — every condition below is evaluated after retrieval.
  • 1 of 2 pod/container targets could not be found - the pod may have been deleted or recycled since scope was last resolved (TARGET_NOT_FOUND).
```

Both the always-visible counts-summary line and the existing collapsed
"Query details" disclosure correctly show the new signal, non-modally, with
no OpenShift-specific visual clutter — exactly the mission's own "prefer
existing generic surfaces... no broad Search redesign" requirement. A real
OpenShift cluster was not available in this environment to drive this
same evidence end-to-end from a genuine backend response (same
`REAL_OPENSHIFT_1C=BLOCKED_CREDENTIALS` constraint as §20) — the stubbed
wire payload matches the DTO shape `SearchController`/`EventMapper`
actually produce byte-for-byte, so this is real evidence of the frontend's
own rendering contract, not a claim about a live cluster.

### Tests added/changed

| File | What |
|---|---|
| `OpenShiftApiClientByteBoundTest.java` (new, 20 tests) | Unit-level `readBounded`/`trimIncompleteUtf8Suffix` coverage (under/at/over cap, multi-buffer boundary straddling, real-byte-vs-char-count proof, a 2,000-chunk/~20 MB synthetic source proving no full materialization and real cancellation, pooled-buffer `refCnt()` release proof including the cap-mid-stream/discard case, error-path release) plus end-to-end `fetchPodLog` coverage against `MockOpenShiftPodLogServer` (under-cap, over-cap, a real ~5 MB HTTP response bounded to 4 KB) |
| `DirectPodLogProviderTest.java` (+15 new tests, 1 updated) | The full runtime-partial matrix (mission §10): one-OK-plus-one-{404,403,timeout,byte-capped}, all-404/all-timeout explicit failure, line-cap-possible flagging (positive and negative), target-cap+byte-cap coexistence, `OVERALL_EVENT_CAP` (and the negative case — the caller's own smaller `limit` never flagged as a safety-cap surprise), a byte-capped target cancelled alongside a normal one, and the concurrent-searches-never-cross-contaminate proof. `deselectingWorkloadStillOnlyQueriesWhatOs1bResolvedNeverEveryNamespacePod` was updated (its own single-unregistered-pod scenario is now, correctly, the all-failed case — StepVerifier now expects `Kind.UPSTREAM_UNAVAILABLE`, and the request-count assertion it actually exists to prove is retained) |
| `SearchServiceTest.java` (+4 new tests) | Runtime-warning → `truncated=true`/`notes` merge, the no-warnings-regression case, scope+runtime coexistence, and the `SearchService`-level cross-search-isolation proof |
| `StubLogSource.java` (test-only, extended) | `withScopeWarnings`/`withRuntimeWarnings` builders + `describeScopeWarnings`/`searchWithOutcome` overrides, so `SearchServiceTest` can exercise the full merge path without a real OpenShift adapter |

### Validation (post-recovery)

| Check | Result |
|---|---|
| `./mvnw test -Dtest='com.logexplorer.source.openshift.**'` | PASS — 267 tests, 0 failures, 0 errors, 5 skipped (`OpenShiftRealSandboxIT`, credential-gated) |
| `./mvnw test` (full backend suite) | PASS — 894 tests, 0 failures, 0 errors, 5 skipped |
| `npm run test` (full frontend unit suite) | PASS — 751 tests, unchanged (no frontend file touched) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS, unchanged bundle (no frontend file touched) |
| Real rendered-browser frontend check (stubbed OS-1C-shaped response) | PASS — see "Frontend" subsection above |
| `REAL_OPENSHIFT_1C` (live cluster) | `BLOCKED_CREDENTIALS`, unchanged from §20 — no credentials available in this environment |

No test was skipped, weakened, or deleted to reach green. The one
pre-existing test whose own premise the fix intentionally changed
(`deselectingWorkloadStillOnlyQueriesWhatOs1bResolvedNeverEveryNamespacePod`)
was updated deliberately, with its real invariant (request count) kept
intact, exactly as CLAUDE.md §3 requires.
