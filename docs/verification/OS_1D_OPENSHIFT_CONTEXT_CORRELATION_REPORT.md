# OS-1D — OpenShift Context, Surrounding Logs & Correlation

Branch: `os/1d-openshift-context-correlation`. Builds on OS-1A/1B/1C (all
`APPROVED`/`IMPLEMENTED`, merged to `main` at `afbcf7d9587e47d793acdeeb745e2816a8993baf`).

## 1. Scope

Make direct OpenShift logs useful for *investigation*, not merely search:
Search → select an event → inspect → **Show surrounding logs** → **follow
correlation/trace/journey evidence**, strengthening the product's WHY and
WHERE questions while preserving WHO/WHAT. Live (OS-1E), Loki restructuring
(OS-1G), and Local Reproducible Desktop Packaging (REL-1) are explicitly out
of scope and untouched.

## 2. Design decision — reuse, not a parallel architecture

Every one of OS-1D's product behaviors (context, correlation, trace,
journey) already existed as a **generic**, source-agnostic feature before
this slice, reused unchanged for every existing source (Fixture, Docker,
Loki):

- `POST /api/v1/logs/context` (`SearchController#context` →
  `RequestMapper#toContextDomain` → `SearchService#search`) — a fixed
  ±30s window (`RequestMapper.CONTEXT_WINDOW`) around one event's
  timestamp, optionally scoped by `service`/`containerId`/`pod`.
- `POST /api/v1/logs/journey` (`SearchController#journey` →
  `RequestMapper#toJourneyDomain`) — bounded search by exactly one of
  `journeyId`/`correlationId`/`traceId`/`eventId`, within the caller's own
  currently-committed time window.
- `core.search.EventFilters#matches` — the single, source-agnostic
  structured-filter predicate every `LogSource.search()` already calls,
  which already checks `traceId`/`spanId`/`correlationId`/`journeyId`/
  `eventId`/`pod`/`containerId` for every event, regardless of source.

**OS-1D therefore implements almost no new endpoints or DTOs.** It:

1. Adds one new generic scope-hint field, `containerName` (parallel to the
   pre-existing `containerId`/`pod`), threaded through `SearchRequest`,
   `EventFilters`, `ContextRequestDto`, `RequestMapper#toContextDomain`,
   and the frontend's `ContextRequestBody`/`showContext` — because
   OpenShift, unlike Docker, has no short container-id concept, only a
   container *name*, and container-level context narrowing needs a field
   Docker's `containerId` semantics cannot honestly represent for it.
2. Makes `DirectPodLogProvider`'s own target resolution **bounded-context-
   aware**: when a request names both `pod` and `containerName` (which
   only ever happens for a "Show surrounding logs" call), it resolves to
   *exactly that one (pod, container) target* instead of OS-1B's full
   currently-selected scope — never a second, parallel, unbounded
   retrieval implementation.
3. Flips `OpenShiftLogSource#capabilities().contextView()` to `true`, now
   that the generic `/context` endpoint genuinely works end to end for
   this source, tested the same way every other capability claim in this
   project is: real behavior, not merely an endpoint existing.
4. Adds a client-side truthfulness fix that turns out to matter *more* for
   OpenShift (a pod's logs roll off far faster than Docker's or an
   indexed Loki store's): `eventIdentity()` — the pure identity function
   both "Load more" dedup and context root-marking already relied on — is
   strengthened with `containerName`/`namespace`, and `ContextSummary`
   now shows an explicit, truthful "root event unavailable" notice when
   the root cannot be re-identified in the returned context window,
   instead of silently highlighting nothing.

No `/api/openshift/context-v2` or any OpenShift-only endpoint was created.
No second `ContextService`/`ContextResult` type was created. Correlation,
trace, and journey search required **zero new backend code** beyond the
`containerName` field above — `DirectPodLogProvider` already threads every
`SearchRequest` filter field (including `traceId`/`correlationId`/
`journeyId`/`eventId`) through the shared `EventFilters.matches` call in
`parseFilterAndMerge`, exactly like Fixture/Docker/Loki. This report's own
new tests (§6) exist to *prove* that reuse actually works for OpenShift,
not merely to assert it by code inspection.

## 3. Context window / bounds (mission §7/§30/§31)

| Bound | Value | Source |
|---|---|---|
| Context window (before/after) | Fixed ±30 seconds | `RequestMapper.CONTEXT_WINDOW` (pre-existing, reused verbatim — "the exact duration should follow repository conventions if already present") |
| Max targets queried for a narrow context call | Exactly 1 (pod+containerName both present) | `DirectPodLogProvider#resolveTargetPlan`'s OS-1D override |
| Max pods / (pod,container) targets for correlation/trace/journey | `DirectPodLogProperties.maxPods` / `maxTargets` (unchanged, OS-1C) | Correlation/trace/journey never narrow — they use the full OS-1B resolved scope, exactly like an ordinary search |
| Max concurrency | `DirectPodLogProperties.maxConcurrency` (unchanged) | |
| Per-target byte/line cap | `maxBytesPerTarget`/`maxLinesPerTarget` (unchanged) | Still enforced and still disclosed (`BYTE_CAP_REACHED`/`LINE_CAP_REACHED_OR_POSSIBLE`) for a narrow context call — see §6 |
| Max events overall | `maxEventsOverall` (unchanged) | |
| Per-target / overall timeout | `perTargetTimeout` / `overallTimeout` (unchanged) | |

No new configuration was introduced — every OS-1D operation is bounded by
the exact same `DirectPodLogProperties` OS-1C already enforces, per the
mission's own "reuse OS-1C properties rather than inventing unrelated
limits."

## 4. Context target scope decision (mission §8)

**Decision: "Show surrounding logs" defaults to same pod + same container.**
Correlation/trace/journey remain scoped to the full OS-1B resolved scope
(never narrowed to one pod). Sibling-container and cross-replica broadening
were assessed and explicitly **not implemented** in this slice — the
mission itself only asks that this be assessed and documented, not
implemented, and broadening scope implicitly is explicitly forbidden
(mission §8/§16). If a future slice wants "also show this pod's other
containers," it is an explicit, separate, opt-in action, not a silent
default.

**Why the narrow single-target fetch is correct and still bounded.** Every
OpenShift `CanonicalLogEvent` already carries its own `namespace`/`pod`/
`containerName` (set by `DirectPodLogProvider#parseFilterAndMerge`), so the
originally-selected event always supplies both `pod` and `containerName`
to the context request — `resolveTargetPlan`'s narrow-context branch
therefore always has exactly the information it needs, and only ever
triggers for that specific combination (proved by
`aPodOnlyContextHintWithoutAContainerNameIsTreatedAsAnOrdinaryFullScopeSearch`
and `ordinaryFullScopeSearchIsUnaffectedWhenNeitherPodNorContainerNameIsSet`
in `DirectPodLogProviderTest` — an ordinary search/correlation/trace/journey
call, which never sets these fields, is completely unaffected).

## 5. Root identity (mission §9)

Root re-identification is, and remains, a **frontend concern** — the
backend has no "root" concept at all; it returns events, and the frontend
matches the one the investigator clicked by content identity
(`useSearchState.ts#eventIdentity`). OS-1D strengthens that identity from

```
[timestamp, sourceId, containerId, pod, stream, rawLine ?? message,
 logger, thread, traceId, spanId, correlationId, journeyId, eventId]
```

to also include `containerName` and `namespace`:

```
[timestamp, sourceId, containerId, pod, containerName, namespace, stream,
 rawLine ?? message, logger, thread, traceId, spanId, correlationId,
 journeyId, eventId]
```

This was a real, previously-latent gap: two sibling containers in the same
pod emitting the identical message at the identical timestamp (a common
real pattern — e.g. two replicas' shared startup banner) were
indistinguishable by the pre-OS-1D identity, so a "Show surrounding logs"
root highlight could silently mark the wrong row. Proven directly:
`ResultsTable.test.tsx`'s new
`aRepeatedMessage+timestampFromASiblingContainerInTheSamePodIsNeverMistakenForTheRoot`
and `theSamePodNameInADifferentNamespaceIsNeverMistakenForTheRoot`.

**When the root cannot be re-identified** (the mission's `ROOT_NOT_FOUND`
case — most commonly, the pod's logs have rolled past the original event
since the investigator's first search), the backend still returns whatever
nearby evidence exists within the ±30s window (mission §9: "Context can
still show nearby evidence"), and `ContextSummary` now renders an explicit,
non-modal notice:

> ⚠ The original event is no longer available from this source — showing
> nearby evidence only. It may have aged out of the retained log window
> since your original search.

with the disclaimer sentence itself switching from "The highlighted row
below is the original event..." to "The original event itself could not
be re-identified below — these are correlated/nearby evidence only." —
never a silent "nothing highlighted" with no explanation. Real
rendered-browser evidence (Playwright against the running dev app, `/context`
stubbed to a response deliberately missing the root event) is in §8 below.

## 6. Backend — new/changed behavior and tests

### `containerName` (generic scope hint)

- `SearchRequest.containerName` — new field, builder, `withPageBoundary`
  copy, redacted-safe `toString()` entry (structural, never sensitive).
- `EventFilters#matches` — new `fieldMatches(request.containerName(),
  event.containerName())` check, parallel to the existing `containerId`/
  `pod` checks. Tested: `EventFiltersTest#filtersByContainerNameOs1d`.
- `ContextRequestDto`/`RequestMapper#toContextDomain` — new optional
  `containerName` field, carried straight through. Tested:
  `RequestMapperTest#containerNameIsCarriedThroughUnchangedForOs1dOpenshiftNarrowContext`
  (and all 6 pre-existing `ContextRequestDto` construction sites updated
  for the new positional field, unchanged behavior otherwise).

### `DirectPodLogProvider#resolveTargetPlan` — narrow-context override

New behavior, gated **only** when both `request.pod()` and
`request.containerName()` are non-blank: resolves to exactly one
`PodLogTarget`, constructed directly (via `narrowContextTarget`) rather
than requiring the pod to already be present in the locally cached
`scope.pods()`. This is what makes a genuinely disappeared pod a real,
evidenced failure instead of a silent local decision — see below.

| Test | Proves |
|---|---|
| `aContextRequestNamingPodAndContainerQueriesOnlyThatOneTargetEvenWithManyPodsInScope` | 3 pods resolved in scope; a context call naming one queries only that one (`requestCount()==1`) |
| `aContextRequestNarrowsToTheNamedContainerEvenWhenAnotherContainerInThatSamePodMatchesTimeWindow` | Sibling-container exclusion at the fetch level, not just a post-filter |
| `aContextRequestForAPodThatHasDisappearedFromCurrentScopeStillAsksTheRealApiRatherThanSilentlyReturningEmpty` | A pod never seeded into local scope is still queried for real; the real 404 becomes `Kind.UPSTREAM_UNAVAILABLE`, never a silent empty context (mission §9/§19/§32) |
| `aContextRequestForAForbiddenPodIsAnExplicitForbiddenResultNeverASilentEmptyContext` | 403 on the sole narrowed target → `Kind.FORBIDDEN`, unchanged existing semantics |
| `aContextRequestStillSurfacesByteAndLineCapTruncationOnTheSingleNarrowedTarget` | `BYTE_CAP_REACHED` still disclosed through the same `SourceSearchOutcome.runtimeWarnings` channel for a narrowed single-target call |
| `ordinaryFullScopeSearchIsUnaffectedWhenNeitherPodNorContainerNameIsSet` | Regression guard — plain search/correlation/trace/journey calls are completely unaffected |
| `aPodOnlyContextHintWithoutAContainerNameIsTreatedAsAnOrdinaryFullScopeSearch` | Defensive — `pod` without `containerName` (a shape that cannot arise from a real OpenShift event, only theoretically from another source's context shape) never mis-fires the narrow branch |

### Correlation / trace / journey — proven working for OpenShift

No production code change was needed beyond `containerName` above — these
tests exist to prove the pre-existing generic `EventFilters` reuse actually
works correctly for OpenShift's own event-construction path, which none of
OS-1A/1B/1C's own test suites previously exercised:

| Test | Proves |
|---|---|
| `correlationIdMatchesEventsAcrossDifferentPodsWithinTheCurrentlyResolvedScope` | A shared `correlationId` across two different pods, both in the result |
| `traceIdMatchesEventsAcrossMultipleServicesAndPods` | Same, for `traceId` |
| `journeyIdMatchesEventsWithinTheCurrentOpenShiftResolvedScope` | `x-journey-trace-id` (journeyId) match |
| `aCorrelationIdWithNoMatchesIsAnOrdinaryEmptyResultNeverAnError` | A legitimate zero-match correlation search is not an error |
| `correlationSearchWithOneForbiddenTargetStillReturnsMatchesFromTheReadableOneWithAPartialWarning` | Mission §42 - 1 success + 1 forbidden → correlated results **and** `PERMISSION_DENIED` runtime warning, never a silent complete-looking result |
| `correlationSearchWithAllTargetsUnavailableIsAnExplicitFailureNeverASilentNoReadableTargetsSuccess` | All targets 404 + a correlation filter set → still `Kind.UPSTREAM_UNAVAILABLE`, never a silent empty "no matches" |

Cross-pod/cross-workload correlation is bounded exactly by whatever OS-1B
currently resolved as scope — the same `resolveTargets` full-scope path
every ordinary search already uses. No new "all namespace pods" fallback
was added or is reachable (mission §16); no Jobs/CronJobs/standalone pods
are ever queried (unchanged from OS-1B/1C — this class never resolves
those workload kinds at all).

### `OpenShiftLogSource#capabilities().contextView()` → `true`

Corrected (not silently changed) alongside the test that pinned the old
value: `OpenShiftSecurityBoundariesTest#openShiftAdvertisesExactlyTheCapabilitiesItCanDeliver`,
now documented as `CORRECTED (OS-1D)` with the reasoning, matching this
project's "mark corrections, never silently rewrite" discipline.

### Location metadata / Inspector (mission §23/§24)

**Already satisfied before this slice — verified, not implemented.**
`frontend/src/features/inspector/sections.ts#buildOverviewFields` already
renders `Namespace`/`Pod`/`Container` "when present" in the Overview
section (added for Loki/Docker; OpenShift populates the same
`CanonicalLogEvent` fields, so it was already correct for OpenShift with
zero code change). "Application/workload" is represented the same way
every other source's Service field already is: `DirectPodLogProvider`
passes the resolved workload's name as the parser's `serviceHint`, so
Overview's existing `Service` row already carries it — no separate
"Workload" row, no raw Kubernetes metadata dump (no Pod YAML, no labels,
no annotations — mission §23 explicit prohibition), consistent with "reuse
existing generic UI, no OpenShift-only clutter."

## 7. Security (mission §43)

No new attack surface was introduced. The narrow-context target is
constructed from already-validated `SearchRequest`/`ContextRequestDto`
string fields (namespace/pod/container names, structural identifiers, not
sensitive filter values) and flows through the exact same
`OpenShiftApiClient#fetchPodLog` bounded-byte-streaming path OS-1C's own
review recovery already hardened (token never logged, `Authorization`
header never echoed, byte-bounded, cancellation-bridged). No Secret/
ConfigMap/exec/attach/port-forward/shell/`oc` call was added — this class
still only ever issues the one read-only Kubernetes pod-log `GET`
OS-1C established. `RawSensitiveFields`/masking is completely unaffected
(context/correlation reuse the exact same `SearchService`/
`GlobalExceptionHandler` pipeline every existing source's search already
goes through). No search value, token, or raw protected identifier is
logged anywhere in the new code (`resolveTargetPlan`'s own new javadoc and
code were written and reviewed against CLAUDE.md §2 rule 2 specifically).

## 8. Frontend — real rendered-browser evidence (LERUX-1)

Protocol marker: `LERUX-1`. Method: real dev app (backend `SPRING_PROFILES_ACTIVE=dev`
port 3434, frontend `npm run dev` port 3435), driven by Playwright, with
`/api/v1/logs/search` and `/api/v1/logs/context` stubbed via `page.route()`
to a realistic OS-1C/1D-shaped payload — the second response deliberately
omits the root event to exercise the new truthfulness notice.

Reproduce → select Fixture source → run search ("root event" visible) →
open the row's Actions menu → "Show surrounding logs" → real render:

```
Context — ±30s around Jan 1, 2026, 12:00:00.000 AM UTC     ← Back to original search

EVENTS  SERVICES  ERRORS  WARNINGS  WINDOW           RANGE                                    SOURCE                GAPS
1       1         0       0         60 seconds (±30s) Jan 1, 2:59 AM – 3:00 AM (Asia/Kuwait)   Fixture (dev/test only) 0

⚠ The original event is no longer available from this source — showing nearby evidence only.
  It may have aged out of the retained log window since your original search.

Sorted chronologically, oldest first — this order does not indicate causality between events.
The original event itself could not be re-identified below - these are correlated/nearby events only.
A detected gap means no event was observed in that interval - it is not evidence that anything failed.

TIME                     LEVEL   SERVICE   WHAT HAPPENED
Jan 1, 2026, 03:00:05.00 ● INFO  gateway   nearby evidence
```

Confirms, with real rendered output (not "looks right in source"): the
notice renders non-modally alongside the existing `ContextSummary`
machinery, nearby evidence is still shown (never hidden), the disclaimer
sentence correctly switches, and no OpenShift-specific visual clutter was
introduced — the exact same generic component every other source's context
view already renders through. Scratch spec (`_scratch-os1d-root-notice.spec.ts`)
was deleted after capturing this evidence, per this repo's established
one-off-verification convention (not a permanent spec — the permanent,
committed coverage is the RTL/vitest tests in §6/§9 below).

## 9. Frontend — unit/component tests added

| File | New tests | Proves |
|---|---|---|
| `ContextSummary.test.tsx` (+4) | No notice when `rootIdentity` absent (unchanged pre-OS-1D behavior); no notice when root present; explicit truthful notice + disclaimer switch when root absent, nearby events still shown; no accessibility violations with the notice present | §9/§36 |
| `ResultsTable.test.tsx` (+2) | Sibling-container collision and cross-namespace pod-name collision are never mistaken for the root | §9/§40-C |
| `useSearchState.contextReturn.test.ts` (+2) | `containerName` is sent for an OpenShift-shaped event, never sent for a non-OpenShift one | §6 |
| `RequestMapperTest.java` / `EventFiltersTest.java` (backend, +2, listed in §6) | | |

`useSearchState.contextReturn.test.ts`'s **pre-existing** `§26 - a
superseded context response can never overwrite a newer one` test already
covers the mission's §17/§40-K "late old-scope response cannot overwrite
current state" requirement generically — reused unchanged, re-verified
passing, no new test needed since the mechanism (`supersedeActiveRequest`)
is completely source-agnostic and untouched by this slice.

## 10. Capability truthfulness (mission §34)

| Capability | Before OS-1D | After OS-1D | Why |
|---|---|---|---|
| `historicalSearch` | `true` (OS-1C) | `true`, unchanged | |
| `contextView` | `false` | `true` | Tested end to end: real backend narrowing (§6) + real rendered frontend behavior (§8) |
| `liveTail` | `false` | `false`, unchanged | OS-1E's job — no `follow=true`, no Watch, no auto-reconnect anywhere in this slice |
| `pagination` | `false` | `false`, unchanged | `DirectPodLogProvider` still never produces a `nextCursor`; no fake pagination introduced for context/correlation |
| `rawLogQL` | `false` | `false`, unchanged | Loki-only |
| `serviceDiscovery` / `composeProjectScoping` | `false` | `false`, unchanged | Docker-shaped concepts, expressed through OS-1B's own scope endpoints instead |

## 11. Explicitly not implemented in this slice (assessed, deferred)

Per the mission's own "assess whether... do NOT broaden scope implicitly"
and no-scope-creep list:

- Sibling-container / replica broadening for "Surrounding logs" (§8) —
  same pod/container remains the default; a future slice could add an
  explicit, opt-in broaden action.
- `OBSERVED_TRANSITIONS`-style service-transition summarization UI (§21)
  — the mission itself says "may summarize," not "must"; the underlying
  evidence (namespace/pod/container/timestamp/service per event) is
  already present in every returned event via the unchanged Overview
  fields, so a future summarization view has what it needs without any
  OS-1D backend change.
- OpenShift Live, `follow=true`, Kubernetes Watch, auto-follow new
  replicas, SSE tail, reconnect logic — OS-1E, untouched.
- OpenTelemetry/tracing-backend integration, causal/AI root-cause
  inference — explicitly out of scope, not implemented, not planned here.
- Loki restructuring (OS-1G), REL-1 implementation, Phase M — untouched.

## 12. TEST-INFRA hardening item (mission §46)

Registered as its own tracked item, **not fixed opportunistically** in this
slice (see `OWNER_REQUIREMENTS_REGISTER.md` §12g,
`TEST-INFRA-1 — Historical Evidence Mutation Isolation`, status
`APPROVED_PENDING_HARDENING`): running the full Playwright suite as part of
this slice's own validation (§13) again wrote into ~188 tracked
`docs/verification/*` evidence PNGs as an unintentional side effect of
`captureScreenshot`'s own convention of writing directly into
`docs/verification/<phase>/`. Restored via `git checkout -- <paths>` before
finalizing (verified: `git diff --name-status main...HEAD` contains zero
`.png` entries) — this is the second time this exact defect has been
observed (first: OS-1C final review recovery) and confirms it is a real,
reproducible test-infrastructure gap, not a one-off.

## 13. Validation

| Check | Result |
|---|---|
| `./mvnw test -Dtest=DirectPodLogProviderTest,RequestMapperTest,EventFiltersTest,OpenShiftSecurityBoundariesTest` | PASS |
| `./mvnw test -Dtest='com.logexplorer.source.openshift.**'` | PASS |
| `./mvnw test` (full backend suite) | PASS — 913 tests, 0 failures, 0 errors |
| `npm run test` (full frontend unit suite) | PASS — 759 tests, 0 failures |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| Real rendered-browser check (§8) | PASS |
| Full Playwright E2E | see final mission response |
| `REAL_OPENSHIFT_1D` | `BLOCKED_CREDENTIALS` — no live cluster credentials available in this environment; not fabricated |

No test was skipped, weakened, or deleted to reach green. Every existing
`ContextRequestDto` construction site (6, in `RequestMapperTest.java`) was
updated for the new positional field with unchanged assertions — a
mechanical, additive change, not a behavior change.

## 14. OS-1D REVIEW RECOVERY — context target authorization & scope proof

A second review pass on PR #42 (reviewed HEAD `df7ce6a8222d8905059657c39a0a90bae23b9942`)
found a real server-side scope-integrity defect in §4/§6's own narrow-context
target resolution, fixed without touching the rest of OS-1D's design
(correlation/trace/journey, root identity, gap model, capability truthfulness
all unchanged).

### The defect

**`CLIENT_POD_CONTAINER_FIELDS != AUTHORIZATION`, corrected.** The original
`DirectPodLogProvider#resolveTargetPlan` narrow-context branch constructed a
`PodLogTarget` directly from `request.pod()`/`request.containerName()`
whenever the pod was absent from the locally cached `scope.pods()` — with
no further check. Since those two fields arrive straight off the
`/api/v1/logs/context` HTTP request body, a crafted request could name
**any** pod/container name in the currently-selected namespace — a Job
pod, a CronJob pod, a standalone pod, an operator/controller pod, or any
other workload kind OS-1B never resolves into scope at all — and this
backend would still issue the real Kubernetes pod-log `GET` for it. The
"disappeared pod" requirement this branch existed to satisfy (a pod
present when the original search ran, gone by the time the investigator
clicks "Show surrounding logs") was genuine and correct; the mechanism
chosen to satisfy it conflated *"the request named this target"* with
*"this backend has evidence this target was ever legitimately resolved,"*
which are not the same thing.

### The fix — server-verifiable, non-forgeable historical scope proof

**`core.search.ContextTargetProofCodec`** (new, deliberately modeled on
the existing `PageCursorCodec` — same opaque "base64 payload . base64 HMAC
signature" envelope, same in-memory-only `SecureRandom` signing key
generated once at process start, same "one fixed rejection message, never
reveal which check failed" discipline — but its own small, independent
codec with its own independent key, since a context-target proof answers a
completely different question ("was this pod/container a real target of a
search this backend produced") than a pagination cursor does):

- **Issued** once per (namespace, pod, container) target, inside
  `DirectPodLogProvider#parseFilterAndMerge`, only for a target this
  search actually, successfully queried — binds `sourceId="openshift"`,
  `OpenShiftSession#generation()`, `namespace`, `pod`, `container`.
- Carried to the browser as `EventDto#contextTargetProof` (new field,
  `CanonicalLogEvent#contextTargetProof` → `EventMapper` → `EventDto`,
  `null` for every source except OpenShift) and echoed back verbatim by
  the frontend (`LogEvent#contextTargetProof`, `showContext`,
  `ContextRequestBody#contextTargetProof`) on a later "Show surrounding
  logs" call, through `ContextRequestDto#contextTargetProof` →
  `RequestMapper#toContextDomain` → `SearchRequest#contextTargetProof`.
- **Verified** inside a new `DirectPodLogProvider#authorizeNarrowContextTarget`,
  which replaces the old unconditional target construction:

  1. **Target still in current `scope.pods()`** — ordinary, unweakened
     OS-1B scope validation is authoritative on its own; no proof is
     required or consulted at all (mission §12 — this path was, and
     remains, unchanged).
  2. **Target not in current scope** — `ContextTargetProofCodec#verify`
     is required to succeed against every one of: source id, connection
     generation, namespace, pod, container. Any mismatch (missing proof,
     tampered/forged proof, wrong source, stale generation, wrong
     namespace, wrong pod, wrong container) throws
     `GuardrailViolationException(Reason.INVALID_CONTEXT_TARGET)` —
     **before `resolveTargetPlan` returns a target at all**, so
     `fetchTarget`/`OpenShiftApiClient#fetchPodLog` are never reached and
     the cluster is never called for an unauthorized target. The
     rejection message is always the same fixed string
     ("This log location could not be verified for surrounding-log
     retrieval.") regardless of which check failed, so it can never
     become an oracle for probing arbitrary pod names (mission §8).

  A historically-valid but now-disappeared pod still works exactly as
  the original OS-1D design intended: a valid proof lets the real API
  call through, and a genuine 404 becomes the truthful
  `TARGET_NOT_FOUND`/`UPSTREAM_UNAVAILABLE` outcome — nothing about that
  behavior changed, only *what is required to reach it*.

- Correlation/trace/journey requests never set `pod`/`containerName` at
  all, so `authorizeNarrowContextTarget` is never invoked for them — they
  continue resolving the full OS-1B scope exactly as before (mission §13,
  unchanged, re-verified by the pre-existing correlation test suite
  passing unmodified).

### Why no proof expiry beyond connection-generation binding

The proof never grants access beyond what the requester's own current
OpenShift bearer token and connection already permit — the Kubernetes
API itself is still the real authorization boundary for the actual read;
this proof only re-attempts a read the backend itself already resolved
once before, during the same connection. Reconnecting (`OcLoginCommand`
→ a new `OpenShiftSession#generation()`) invalidates every previously-
issued proof outright (mission §9), which is the staleness control the
mission actually asks for; no separate wall-clock TTL was added on top.

### Security tests added (mission §14, all in `DirectPodLogProviderTest.java` unless noted)

| Test | Mission ref | Proves |
|---|---|---|
| `a_currentScopeTargetIsAllowedWithNoProofAtAll` | A | Unchanged fast path |
| `b_aDisappearedPodWithAValidProofStillReachesTheRealApiAndGetsATruthfulNotFound` | B | Valid historical proof still works |
| `c_anArbitraryOutOfScopePodWithNoProofIsRejectedWithZeroClusterCalls` | C | The core defect - fixed, zero cluster calls |
| `d_anArbitraryOutOfScopePodWithAForgedOrTamperedProofIsRejectedWithZeroClusterCalls` | D | Both a modified real proof and a fabricated-from-scratch string rejected |
| `e_aValidProofForADifferentContainerIsRejected` | E | Container binding |
| `f_aValidProofForADifferentNamespaceIsRejected` | F | Namespace binding |
| `g_aProofFromAnOldConnectionGenerationIsRejectedAfterReconnect` | G | Generation binding, real reconnect |
| `h_aProofIssuedForAnotherSourceIdIsRejected` | H | Source binding |
| `i_aJobOwnedPodOutsideSupportedWorkloadScopeCannotBeReadViaACraftedContextRequest` | I | Job pods unreachable |
| `j_aStandalonePodOutsideScopeCannotBeReadViaACraftedContextRequest` | J | Standalone pods unreachable |
| `k_anOperatorOrUnknownControllerPodCannotBeReadViaACraftedContextRequest` | K | Operator/controller pods unreachable |
| `l_theProofMechanismDoesNotBreakTheNormalContextWorkflowWhenTheTargetIsStillInScope` | L | No regression to the common case |
| `anIssuedProofRoundTripsThroughSearchWithOutcomeOntoEachOpenShiftEvent` | — | End-to-end: a proof this class itself issues is later accepted as valid for that exact target |
| `ContextTargetProofCodecTest` (new, 12 tests) | — | Codec-level: round-trip, missing/malformed/tampered/forged rejection, every field mismatch individually, fixed non-leaking rejection message |
| `RequestMapperTest#contextTargetProofIsCarriedThroughUnchangedForOs1dReviewRecovery` | — | DTO→domain passthrough |
| `useSearchState.contextReturn.test.ts` (+2) | — | Frontend echoes the proof verbatim when present, sends nothing when absent |

The pre-existing "disappeared pod" test
(`aContextRequestForAPodThatHasDisappearedFromCurrentScopeStillAsksTheRealApiRatherThanSilentlyReturningEmpty`)
was updated to supply a valid proof (it previously relied on the now-fixed
defect) — its own real invariant (`server.requestCount()==1`, a genuine
API call happens) is preserved unchanged.

### `contextTargetProof` handling (mission §15)

Not a secret — a signed opaque token, the same class of value
`SearchRequest#cursor` already is. Never displayed (absent from both
`buildOverviewFields` and the explicit, closed field list
`buildCanonicalFieldEntries` builds for "All fields" — nothing needed to
be added to *exclude* it, it was simply never added to either list). Never
copied to clipboard (`RequestFlowSection`'s copyable-identifier set is a
closed five-field list — `journeyId`/`correlationId`/`traceId`/`spanId`/
`eventId` — `contextTargetProof` is not and will never be a member).
Never persisted (no `localStorage` write in this codebase touches event
data at all — confirmed unchanged, `tablePreferences.ts`'s own writes are
column-visibility/order/density preferences only). Never put in a URL
(only ever a JSON POST body field, the same discipline every other
search/context/journey field already follows). Kept out of `toString()`-
style logging defensively: `SearchRequest#toString()` now redacts it the
same way `query`/`rawLogQl` already are, even though it is not sensitive
user data — caution per the mission's own explicit "do not log it".

### Documentation/history correction (mission §17)

This section itself is that correction: the original OS-1D report (§4/§6
above) described the pre-recovery target-construction behavior as
correct and complete. It was not — it satisfied the valid "disappeared
pod" requirement by a mechanism that also, unintentionally, permitted
reading any pod/container name in the namespace. That description is left
in place above (never silently rewritten); this section names the defect,
the fix, and the new invariant explicitly:

```
CLIENT_TARGET_FIELDS != AUTHORIZATION
DISAPPEARED_POD_CONTEXT_REQUIRES_SERVER_TRUSTED_HISTORICAL_SCOPE_PROOF
```

### Validation

| Check | Result |
|---|---|
| `./mvnw test -Dtest=DirectPodLogProviderTest,ContextTargetProofCodecTest,RequestMapperTest,EventFiltersTest` | PASS — 70 + 12 + 15 + 21 tests, 0 failures |
| `./mvnw test -Dtest='com.logexplorer.source.openshift.**,com.logexplorer.core.search.**,com.logexplorer.api.**'` | PASS — 499 tests, 0 failures |
| `./mvnw test -Dtest='com.logexplorer.source.openshift.**'` | PASS — 302 tests, 0 failures |
| `./mvnw test` (full backend suite) | PASS — 939 tests, 0 failures, 0 errors |
| `npm run test` (full frontend unit suite) | PASS — 759 tests, 0 failures |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| Full Playwright E2E | see final mission response |
| `REAL_OPENSHIFT_1D` | `BLOCKED_CREDENTIALS`, unchanged — this fix is proven against `MockOpenShiftPodLogServer` (real HTTP, deterministic fake Kubernetes pod-log API), not a live cluster; no real-cluster evidence is claimed |

No test was skipped, weakened, or deleted to reach green.
