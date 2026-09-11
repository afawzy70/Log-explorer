# OS-1B — OpenShift Workload / Pod / Container Discovery

Mission: `OS_1B_OPENSHIFT_SCOPE_DISCOVERY`.
Base: `892b06b7960542c27b0666cd2ed1166ec7a26181` (post-PR #39 `main`, the OS-1A
review-recovery-#2 squash merge).
Branch: `os/1b-openshift-scope-discovery`.

OS-1B implements **namespace-scoped workload, pod and container discovery
and selection only**. There is no log retrieval, no search, no context,
no correlation and no Live — the source's declared capabilities are
unchanged from OS-1A and continue to say so.

---

## 0. PR #39 merge gate

| Gate | Result |
|---|---|
| HEAD equals accepted `aa93d3f90c9bcc875f9a9196de5f2525746cc8ea` | PASS |
| OPEN / MERGEABLE / CLEAN | PASS |
| CI green pre-merge (Backend, Frontend, E2E) | PASS |
| Windows Desktop green pre-merge | PASS |
| Squash-merge | PASS — `892b06b7960542c27b0666cd2ed1166ec7a26181` |
| Local `main` synced | PASS — fast-forwarded to `892b06b` |
| Post-main CI (Backend, Frontend, E2E) | PASS |
| Post-main Windows Desktop | PASS |

This mission's own branch (`os/1b-openshift-scope-discovery`) was cut
from `main` only after every gate above was green, per the mission's
explicit "recover main first" instruction.

---

## 1. Architecture

```
OpenShiftLogSource
   └── OpenShiftSession                 (OS-1A) connection + project + generation
         └── OpenShiftScope             (OS-1B) workload/pod/container scope, one value
   OpenShiftConnectionService           (OS-1A) connect/disconnect/refresh
   OpenShiftScopeService                (OS-1B) discoverWorkloads/discoverPods/discoverContainers
   OpenShiftApiClient
         ├── fetchProjects/fetchNamespaces      (OS-1A)
         ├── fetchWorkloads(kind, namespace)    (OS-1B) one GET per WorkloadKind
         ├── fetchWorkloadSelector(ref)         (OS-1B) one GET, read fresh at pod-resolution time
         └── fetchPods(namespace, selector)     (OS-1B) one namespace-scoped, selector-filtered GET
```

`OpenShiftScope` (new) is a small immutable value nested inside
`OpenShiftSession`'s own snapshot — discovered workloads/pods/containers
plus the current selection at each level — with its own `with*` methods
owning the workload→pod→container cascading-reset rules (§14 of the
mission) so they are one small, directly-unit-tested surface
(`OpenShiftScopeTest`) rather than scattered field-clearing at every call
site. `OpenShiftSession` itself owns the coarser project-level cascade
(project change / reconnect / disconnect / expiry all replace the whole
`OpenShiftScope` with `OpenShiftScope.EMPTY`).

No new Spring bean touches `openshift-loki`, Docker, or the Fixture
source. `OpenShiftScopeService` and `OpenShiftScopeController` are
additive, sitting beside the existing OS-1A connection service/controller.

---

## 2. Workload identity is a strongly-typed value (§6)

```java
public record WorkloadRef(WorkloadKind kind, String name, String namespace)
```

Never a bare display string — two workloads of different `WorkloadKind`
sharing a name (a `Deployment` and a `StatefulSet` both called `payments`,
which Kubernetes genuinely allows since they are different resource
types) are different, non-equal references. Validated in the compact
constructor (kind/name/namespace all required) and proved directly in
`WorkloadRefTest` (5 tests).

Supported kinds (`WorkloadKind` enum, in the fixed order they are always
discovered and sorted): `DEPLOYMENT`, `DEPLOYMENT_CONFIG`, `STATEFUL_SET`,
`DAEMON_SET`.

**Jobs and CronJobs: `DEFERRED`.** No repository evidence required them
for this slice, and their pods are short-lived with completed-pod
semantics (a finished Job, a CronJob's historical runs) that deserve their
own design rather than being squeezed into the "current replicas" model
the four supported kinds share. Not silently forgotten — tracked in
`OWNER_REQUIREMENTS_REGISTER.md`.

---

## 3. Workload discovery — namespace-scoped, per-kind independent (§7)

`OpenShiftScopeService#discoverWorkloads()` fires one GET per supported
`WorkloadKind` **concurrently** (`Flux.merge`), all scoped to the
currently-selected project/namespace — never a cluster-wide scan. Each
kind's outcome is recorded independently:

| Outcome | Meaning | Effect on the other 3 kinds |
|---|---|---|
| `AVAILABLE` | the kind's own list call succeeded | none — its workloads are included |
| `UNAVAILABLE_RESOURCE_TYPE` | a genuine HTTP 404 on that kind's own API (e.g. no DeploymentConfig on a vanilla Kubernetes cluster) | none — the other kinds still resolve |
| `FORBIDDEN` | a genuine HTTP 403 on that kind — this user may not list it | none |
| `ERROR` | any other real failure (429/5xx/network/TLS/proxy/malformed) on that kind | none |

**Only `401` aborts the whole operation** and marks the session `EXPIRED`
— an invalid token invalidates every subsequent call regardless of
resource kind, so there is no useful "partial" result to report. Every
other failure is scoped to its own kind.

Overall `WorkloadDiscovery.status()` is derived, never independently
tracked: `SUCCESS` (every attempted kind `AVAILABLE`, including a
genuinely empty result — zero workloads is still success), `PARTIAL`
(some kinds `AVAILABLE`, some not), `FORBIDDEN` (every attempted kind
`FORBIDDEN` — nothing could be discovered at all).

**§8 DeploymentConfig.** Supported when the cluster exposes
`apps.openshift.io/v1/deploymentconfigs`; when it 404s, that kind is
recorded `UNAVAILABLE_RESOURCE_TYPE` and the other three kinds still
discover normally — the whole operation is never failed for one absent,
OpenShift-specific API. Its selector is read as a **flat map** directly
under `spec.selector` (not nested under `matchLabels` the way `apps/v1`
kinds are) — a real API shape difference, proved by
`deploymentConfigSelectorIsReadAsAFlatMapNotNestedUnderMatchLabels`.

Proven by `OpenShiftScopeServiceTest` (23 tests) against
`MockOpenShiftScopeServer`, a fully-programmable fake covering: 2
Deployments + 1 StatefulSet + 1 DaemonSet sorted by kind then name; a
DeploymentConfig that is both available and genuinely 404; every-kind-
forbidden → overall `FORBIDDEN`; a genuine 500 on one kind recorded as
`ERROR` without failing the others; and a 401 on any kind aborting the
whole discovery and expiring the session.

---

## 4. Workload → pod resolution — selector-based, never per-pod (§9/§18)

Resolving pods for a selected workload is **exactly two calls**:

1. `fetchWorkloadSelector(ref)` — a single GET re-reading that workload's
   *current* label selector (never cached from discovery time — read
   fresh so a selector change between discovery and selection is honoured).
2. `fetchPods(namespace, selector)` — a single namespace-scoped GET with
   an equality-based `labelSelector` query parameter.

Never a call per pod. Only equality-based labels (`matchLabels`) are
read — `matchExpressions` is **not supported in this slice** (a scope
decision, not an oversight — every kind's typical Deployment/StatefulSet/
DaemonSet/DeploymentConfig selector in practice uses simple equality
labels, and expression-based selectors can be added later without
changing the wire contract).

**Rolling deployments, old + new ReplicaSet (§9):** both an old and a new
ReplicaSet's pods carry the Deployment's own selector labels during a
rollout, so selector-based matching correctly returns both — this is
consistent with the OS-A architecture assessment §8's own conclusion that
old-replica visibility during a bad rollout is *desirable* for log
investigation, not a defect to hide. Proved by
`rollingDeploymentOldAndNewReplicaSetPodsBothMatchTheSameSelector`. No
owner-reference chase (pod → ReplicaSet → Deployment) was implemented —
selector matching alone already produces the correct, desired result, so
adding ownership-chain validation would be complexity without a
correctness or product benefit.

**A real defect found and fixed during this slice:** the label-selector
query value was being percent-encoded twice — once explicitly via
`UriComponentsBuilder...encode()`, and again by `WebClient`'s own
`uri(String)` call, which also encodes its argument. `app=payment-api`
became `app%3Dpayment-api` and then `app%253Dpayment-api` on the wire,
which no selector could ever match — silently degrading to "the mock
server received it as unparseable and returned every pod, unfiltered"
rather than an explicit error. Caught by
`resolvesPodsForASelectedWorkloadViaItsSelectorOnly` (a pod belonging to
a different workload leaking into the result). Fixed by encoding exactly
once, at the `WebClient` call site, never pre-encoding the query string
built in `OpenShiftApiClient#podsPath`.

---

## 5. Pod and container discovery (§10/§11)

**Pods.** `GET /api/v1/sources/openshift/pods` resolves pods for
whatever is currently selected: the selected workload's selector, or —
when no workload is selected ("All workloads", §22) — the **union of
pods belonging to every currently-discovered supported workload**, via
one selector-filtered GET per discovered workload (never a cluster- or
namespace-wide unfiltered listing). See §20 below for the full review-
recovery writeup — the original text here, "every pod in the namespace
via one unscoped, namespace-only GET", is **CORRECTED/SUPERSEDED**: that
was the defect this recovery fixed, not the intended or shipped
behaviour. `PodSummary` carries
name, phase, a `readySummary` (e.g. `"1/2"`, computed from
`status.containerStatuses`, falling back to the spec's container count as
the denominator for a still-`Pending` pod that has not reported
container statuses yet), summed restart count, and runtime container
names — never a manifest, never environment variables, never labels or
annotations (§29).

**Containers, and the init-container decision (§11).** `spec.initContainers`
is **deliberately excluded** from `containerNames` — `DEFERRED`, not
silently merged with runtime containers. Init containers run to
completion before the pod's main containers start and have different
lifecycle/log semantics that this discovery-only slice has no occasion to
reason about yet; conflating them with runtime containers here would
create ambiguity a future Search slice would have to unwind.
`GET /api/v1/sources/openshift/containers` returns the **cached**
container list from the last pod-discovery call for the currently-selected
pod — **no extra network call** (proved by
`containerDiscoveryReturnsTheSelectedPodsCachedContainersWithNoExtraNetworkCall`
asserting the mock server's pod-request counter is unchanged), and no risk
of disagreeing with the pod list the user is actually looking at.

---

## 6. Scope identity, selection validation and cascading resets (§12/§13/§14)

`OpenShiftScope` (immutable, `record`):

```java
public record OpenShiftScope(
    List<WorkloadSummary> workloads, List<WorkloadDiscovery.KindOutcome> workloadKindOutcomes,
    WorkloadRef selectedWorkload,
    List<PodSummary> pods, String selectedPod,
    List<String> containers, String selectedContainer)
```

(`workloadKindOutcomes` was added by the review recovery in §20 — it is
what lets a later "All workloads" pod resolution know whether the
workload set it is built from is genuinely complete.)

Every selection is **server-validated against the last discovery result**
— `OpenShiftSession#selectWorkload`/`selectPod`/`selectContainer` reject
(return `false`) anything not present in the cached list, exactly the same
discipline OS-1A already applies to project selection. Never trusts a
frontend-supplied selection blindly.

Cascading resets (`OpenShiftScope`'s own `with*` methods, proved directly
by `OpenShiftScopeTest`, 7 tests):

| Change | Effect |
|---|---|
| Select a workload | pods, selected pod, containers, selected container all clear |
| Select a pod | containers, selected container clear |
| A workload disappears from a refreshed list | its selection (and everything below it) clears |
| A workload is still present after a refresh | its selection AND everything below it is kept |
| A pod disappears from a refreshed list | its selection (and container) clears |
| A container disappears from a refreshed list | its selection clears |

Project-level cascades (`OpenShiftSession`, proved by
`OpenShiftSessionScopeCascadeTest`, 7 tests): switching to a different
project clears the whole scope; reselecting the *same* project leaves it
untouched; a project disappearing from a refreshed project list clears
scope too; reconnecting never inherits the previous scope; disconnect and
expiry both clear it.

---

## 7. Stale-response protection, one level deeper than OS-1A (§15)

OS-1A's generation counter alone protects a response from outliving its
*connection*. It does **not** protect against a response outliving its
*project* or *workload selection* within the same connection — the user
can switch projects or workloads while a request is still in flight.
Every OS-1B discovery method therefore captures **generation AND the
exact project/workload it was resolved against** before firing the
network call, and `OpenShiftSession#updateWorkloads`/`updatePods` reject
the result if either has changed by the time it arrives:

- `updateWorkloads(workloads, kindOutcomes, expectedProject, generation)` —
  rejects if the connection was replaced *or* the project selection
  changed.
- `updatePods(pods, expectedProject, expectedWorkload, generation)` —
  rejects if the connection was replaced, *or* the project changed, *or*
  the workload selection changed (including a change to/from "All
  workloads", `null`). **`expectedProject` was added by the review
  recovery in §20** — checking only the workload was not sufficient for
  "All workloads" (`expectedWorkload == null`), since a project switch
  leaves that value unchanged on both sides of the switch.

A rejected update raises `OpenShiftScopeService.StaleScopeException` → HTTP
409 with `reason: "STALE_SCOPE"` (mapped in `GlobalExceptionHandler`,
distinct from OS-1A's own `STALE_CONNECTION` so the two remain
distinguishable). Proved by
`aWorkloadDiscoveryResponseForAProjectTheUserHasSinceLeftIsDiscarded`,
`aPodDiscoveryResponseForAWorkloadTheUserHasSinceLeftIsDiscarded`,
`aStaleWorkloadDiscoveryFromAReplacedConnectionThrowsRatherThanOverwriting`,
and — added by the review recovery in §20, specifically for the
`expectedProject` gap — `aStaleAllWorkloadsPodResponseForAnAbandonedProjectIsDiscarded`
and `aStaleAllWorkloadsPodResponseAfterReconnectIsDiscarded`.

---

## 8. RBAC and empty-state truthfulness (§17/§24)

| Condition | Representation |
|---|---|
| 401 on any workload/pod call | Session `EXPIRED`; every subsequent call must reconnect |
| 403 on one workload kind | That kind's `KindOutcome.status = FORBIDDEN`; other kinds unaffected |
| 403 on every workload kind | `WorkloadDiscovery.status = FORBIDDEN` |
| 404 on one workload kind's own API | That kind's `KindOutcome.status = UNAVAILABLE_RESOURCE_TYPE` |
| A genuinely empty, successful list | `SUCCESS`/`AVAILABLE` with zero items — never conflated with `FORBIDDEN` or `UNAVAILABLE_RESOURCE_TYPE` |
| "All workloads" pods, one supported kind `FORBIDDEN`/`ERROR` (added by the review recovery, §20) | `PodDiscovery.status = PARTIAL` — the pods that could be proven are still returned; the gap is never filled in with unrelated namespace pods |
| "All workloads" pods, one kind `UNAVAILABLE_RESOURCE_TYPE` only | `PodDiscovery.status = COMPLETE` — a genuinely absent API is not a gap |
| "All workloads" pods, one specific workload's own pod fetch fails (403/5xx/etc.) | `PodDiscovery.status = PARTIAL`; that workload's pods are excluded, not fabricated |

Frontend copy keeps these distinct (`OpenShiftScopeControls`): "No
workloads in this project" (genuinely empty) is never shown for a
`FORBIDDEN` discovery, which instead reads "Signed in, but this account
is not permitted to list workloads in this project." A `PARTIAL` result
surfaces a short note naming only the kinds that were `FORBIDDEN`/`ERROR`
— a kind that is `UNAVAILABLE_RESOURCE_TYPE` (the common, expected case
on a vanilla Kubernetes cluster with no DeploymentConfig API) is
deliberately **not** called out inline, per the mission's own "do not
spam the UI with technical noise unless relevant" instruction. Proved by
`discoversTwoDeploymentsOneStatefulSetOneDaemonSetSortedByKindThenName`
(absent DeploymentConfig produces no visible note),
`saysNoWorkloadsInThisProjectRatherThanABlankControl`, and
`reportsAForbiddenWorkloadListingDistinctlyNeverAsNoWorkloads`.

---

## 9. Project vs Namespace terminology is consumed, not re-derived (§5)

OS-1B adds no independent guess about whether the current scope is a
"Project" or a "Namespace" — it reads `OpenShiftSession#discoveryApi()`
(OS-1A review recovery #2's session-level truth) exactly as OS-1A's own
`OpenShiftSettingsPanel` summary row already does, and the same
`scopeLabelSingular`/`scopeLabelPlural` values already computed there
continue to govern the project-level label above the new workload
controls. The workload/pod/container controls themselves use
kind-neutral wording ("Workload", "Pod", "Container") that does not
depend on discovery mode at all — only the *scope above them* (Project
vs Namespace) is a discovery-mode-sensitive word, and that word is
unchanged by this slice.

---

## 10. Sorting is deterministic (§19)

- **Workloads**: kind (enum declaration order: Deployment, DeploymentConfig,
  StatefulSet, DaemonSet), then name — `OpenShiftScopeService#discoverWorkloads`.
- **Pods**: name, alphabetical — `OpenShiftApiClient#podSummaries`. Chosen
  over creation-timestamp ordering for this slice: pod names already
  contain enough entropy to be stable sort keys, and avoids parsing/
  comparing RFC3339 timestamps for a discovery-only concern.
- **Containers**: whatever order the pod's own `spec.containers` array
  reports (manifest order) — the array a Kubernetes pod spec actually
  returns, never re-sorted, since a pod typically has few containers and
  manifest order is itself meaningful (e.g. "application" listed before
  "sidecar" the way the deployer wrote it).

None of this ordering is left to leak nondeterministically from the raw
API response — `MockOpenShiftScopeServer`'s own fixtures are deliberately
supplied out of order in `OpenShiftScopeServiceTest` to prove the
client's own sort, not the fixture's.

---

## 11. API call bounding (§18)

**Corrected by the review recovery (§20) — read this section together
with it, not the original text alone.**

One full workload-discovery refresh: **exactly 4 GETs** (one per
`WorkloadKind`), concurrent, never sequential, never retried into a 5th.

One pod-discovery-for-a-selected-workload: **exactly 2 GETs** (one
selector re-read, then one filtered pod list) — unchanged by the
recovery.

One pod-discovery-for-**"All workloads"**: **exactly W GETs, where W is
the number of currently-discovered supported workloads** (one
selector-filtered pod-list GET per workload, run concurrently) — **not**
the flat "exactly 1 GET" the original version of this slice had, because
that 1 GET was the unfiltered, defective listing this recovery removed.
Each workload's selector is already known from the 4 workload-discovery
GETs above (captured for free from their list-response bodies — see §4),
so no separate selector re-read is needed for this path, unlike the
single-selected-workload case. `W` is bounded by how many supported
workloads actually exist in the namespace — never cluster-wide, never a
call per pod. Container discovery remains **0 GETs** (served from the
cached pod summary). No namespace is ever listed other than the currently
selected one; no cluster-wide enumeration exists anywhere in
`OpenShiftScopeService`/`OpenShiftApiClient`'s methods, before or after
this recovery.

---

## 12. Source capabilities remain unchanged (§20)

`OpenShiftLogSource#capabilities()` was **not modified** in this slice.
All seven booleans remain `false`; `search()` still refuses loudly. The
OS-A assessment's own OS-11 (`projectDiscovery`/`workloadDiscovery`/
`podDiscovery` capability fields) remains targeted at OS-1C in the
requirements register — extending the capability model is deliberately
not part of this discovery-only slice, since nothing here needs a new
capability flag: workload/pod/container discovery is reached through its
own dedicated endpoints (`/workloads`, `/pods`, `/containers`), the same
pattern OS-1A already established for project discovery
(`/connection`, `/project`), not through the generic `LogSource`
capability-gated surface.

---

## 13. Existing sources unaffected (§30)

No file under `source/docker/`, `source/fixture/`, or `source/openshift/
*Loki*` was touched. `openshift-loki` remains a separate, untouched
source. Full backend suite (below) includes the complete pre-existing
Docker/Fixture/Loki test set, all green.

---

## 14. Frontend (LERUX-1 → LERDESIGN-1 → implement → LERUX-1)

**LERUX-1 diagnosis.** `OpenShiftSettingsPanel` already had exactly one
scope level (Project/Namespace) with a `<select>` + summary row pattern.
OS-1B needed three more levels beneath it, each with its own loading/
empty/forbidden state — no existing component in this panel modeled a
multi-level, cascading selection.

**LERDESIGN-1, implemented.** A new `OpenShiftScopeControls` sub-component
(small, focused, composition over configuration — matches the design
skill's own guidance) renders Workload → Pod → Container as three
`.field` blocks, visually separated from the Project selector above by a
`.scope` wrapper with a top border, reusing the exact same tokens/select/
label styling the Project field already uses so the panel reads as one
family. Selecting a workload immediately re-resolves and re-renders pods;
selecting a pod immediately re-resolves and re-renders containers — no
separate "Apply" step, matching the panel's existing project-selection
interaction model. The Container field is disabled with an explanatory
hint ("Select a specific pod to choose a container") until a specific pod
is chosen, since OS-1B deliberately resolves containers per-pod rather
than inventing a cross-pod "containers common to every replica"
aggregation the mission never asked for.

**LERUX-1 verification.** Real rendered-DOM verification (React Testing
Library, actual JSX tree and actual `fetch` interception — the same
evidentiary bar OS-1A's own "labels the list truthfully" test already
established for an equivalent truthfulness concern) — 5 new tests in
`OpenShiftSettingsPanel.test.tsx`: workloads discovered and listed with
no inline noise about an absent DeploymentConfig API; a genuinely empty
workload list renders "No workloads in this project"; a `FORBIDDEN`
discovery renders the permission message and never "no workloads"; a real
DOM SELECT change to a workload re-triggers pod discovery scoped to it;
selecting a pod discovers and renders its containers. The pre-existing 17
OS-1A E2E Playwright tests were re-run against a freshly-restarted
dev-profile backend and remain 17/17 green — no regression to the
disconnected-state form, hostile-input handling, token-storage
guarantees, or the existing Project/Namespace summary labelling.

**Live-browser verification of the connected+workload-selected state
itself is `BLOCKED`** — the same constraint the OS-1A controller
integration test already documents: driving `POST /connect` against a
real `https://` cluster is not possible without real Sandbox credentials
(`REAL_OPENSHIFT_1B = BLOCKED_CREDENTIALS`, see §16), and Playwright's
own dev-server E2E harness has no mechanism to substitute a fake
OpenShift/Kubernetes API reachable from the real backend process it
starts. The rendered-DOM component tests above are the evidence available
at this gate, and are the same class of evidence OS-1A's own equivalent
truthfulness test already relied on.

**Review recovery addition (§20).** The Pod field gained a truthful
`PodDiscovery.status === 'PARTIAL'` note ("This list may be incomplete -
not every workload type could be checked, so some pods may be missing"),
shown only when the backend actually reports `PARTIAL` — never for an
ordinary `COMPLETE` result, per the mission's own "do not clutter normal
successful discovery" instruction. Proved by two new tests: the note
appears for a `PARTIAL` result (and the pods that *were* proven still
render normally), and is absent for a `COMPLETE` one.

---

## 15. Tests

| Layer | New tests | Result |
|---|---|---|
| L1 unit/contract | `WorkloadRefTest` 5, `OpenShiftScopeTest` 9 (+2 review recovery: `workloadScopeComplete()`), `OpenShiftSessionScopeCascadeTest` 7 | PASS |
| L2 fake OpenShift/Kubernetes API | `OpenShiftScopeServiceTest` 31 (+8 review recovery: the "All workloads" pod-union block, §20) | PASS |
| Controller integration | `OpenShiftScopeControllerIntegrationTest` 6 (+1 review recovery) | PASS |
| Backend total (`./mvnw test`) | **820 pass, 0 failures, 0 errors** (+11 over this report's original 809, all from the review recovery in §20) | PASS |
| Frontend component | `OpenShiftSettingsPanel.test.tsx` — 25 OS-1B-specific tests total (+2 review recovery: PARTIAL note shown/hidden truthfully) | PASS |
| Frontend total | **751 pass** (+2 over 749) | PASS |
| E2E OS-1A (regression) | **17/17**, re-run against a freshly-restarted dev-profile backend carrying the review recovery's changes | PASS |
| Full Playwright suite | see the review recovery's own validation run in §20 | PASS |
| Typecheck | `tsc -b --noEmit` | PASS |
| Production build | `vite build` | PASS |
| L3 real sandbox, explicit opt-in invocation (`./mvnw test -Dtest=OpenShiftRealSandboxIT`) | **5 skipped, build success** — skips cleanly without credentials | BLOCKED_CREDENTIALS |

> **Precision correction, made during this mission.** `OpenShiftRealSandboxIT`
> is named with the `*IT` suffix specifically because Maven Surefire's
> **default** include pattern (`**/*Test.java`, `**/*Tests.java`, `**/
> TestCase.java`, `**/Test*.java`) does not match `*IT.java` — this
> project has no Failsafe plugin bound to `verify` either, so `./mvnw
> test` and `./mvnw verify` (the exact command CI's Backend job runs)
> **never execute this class at all**, not even to report it as skipped.
> This is the intended design (`OWNER_REQUIREMENTS_REGISTER.md` OS-14:
> "Layer 3 **opt-in** real sandbox that skips cleanly without
> credentials" — opt-in meaning an explicit `-Dtest=OpenShiftRealSandboxIT`
> invocation, exactly as the README documents), not a defect introduced
> by this slice. It is called out here because this session's own
> intermediate `awk`-aggregated test counts, taken across every file in
> `target/surefire-reports/`, briefly and unintentionally conflated a
> stale report left over from an earlier explicit `-Dtest=` invocation
> with the actual full-suite run's fresh output, implying the "5 skipped"
> were part of one single `./mvnw test` run when they were not. Re-run
> from a clean `./mvnw clean` state, `./mvnw test` genuinely produces 809
> tests with no sandbox-IT entry at all; the sandbox IT was then re-run
> explicitly and separately, exactly as intended, producing the 5-skipped
> result recorded above. The backend total row above is corrected
> accordingly, and this note is preserved rather than quietly fixing the
> number, per this repository's own historical-correction convention.

### Real-environment status

```
REAL_OPENSHIFT_1A = BLOCKED_CREDENTIALS   (unchanged, carried forward honestly)
REAL_OPENSHIFT_1B = BLOCKED_CREDENTIALS
```

No `OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN` were supplied during this
mission. No real-cluster workload/pod/container evidence was captured, and
none is fabricated here. `OpenShiftRealSandboxIT` (OS-1A's Layer 3 test)
is unchanged; an OS-1B-specific Layer-3 extension (disposable Deployment/
StatefulSet/DaemonSet fixtures, real selector-based pod resolution) was
**not implemented in this mission**, since §28 makes it explicitly
conditional on credentials being available, which they were not.

---

## 16. Security (§29)

No additional credential persistence — `OpenShiftScopeService` reads the
token from the existing `OpenShiftSession` accessor, never stores its own
copy. No resource YAML, no secret/configMap values, no pod environment
variables, and no annotations/labels are ever returned to the frontend —
`WorkloadSummary`/`PodSummary`/the new DTOs carry exactly the fields
listed in §7/§10/§11 above and nothing else. Every new HTTP call in
`OpenShiftApiClient` is a `GET`. The only place a label ever appears is
the label **selector query value** sent *to* the cluster to filter pods —
labels a pod actually carries are never read back or exposed.

---

## 17. Documentation consistency audit (§34)

| Comparison | Result |
|---|---|
| Implementation vs `OWNER_REQUIREMENTS_REGISTER.md` | Workload discovery, DeploymentConfig, StatefulSet, DaemonSet, Jobs/CronJobs deferral, workload→pod resolution, pod/container discovery, cascading resets, stale-scope protection, partial RBAC, source-specific scope, truthful capabilities, and the OS-1B real-evidence gate are all tracked in `OWNER_REQUIREMENTS_REGISTER.md` |
| Implementation vs architecture doc | §6 of the assessment (scope model) already anticipated the Project→Workload→Pod→Container hierarchy; no correction was needed to that doc's OS-1B-relevant content |
| Tests vs documented semantics | Every claim in §3–§11 above cites the specific test that proves it |
| Frontend labels vs `discoveryApi` | Unchanged code path (§9 above) — no drift introduced |
| Capability flags vs actual behaviour | Unchanged (`false` × 7), confirmed by re-reading `OpenShiftLogSource.java` this session, not assumed |
| OpenShift source vs `openshift-loki` coexistence | No file under the Loki adapter touched; both sources present in `GET /api/v1/sources` (OS-1A E2E test 11, still green) |
| This report vs actual test evidence | Every count in §15 was read from `target/surefire-reports/*.txt` / real `vitest run` / `playwright test` output this session, not estimated |
| REL-1 requirement vs status | Registered as `APPROVED_PENDING` in `OWNER_REQUIREMENTS_REGISTER.md` — not implemented, not marked `IMPLEMENTED` |
| "All workloads" semantics vs this report's own original text | **Corrected in §20** — §5's original wording ("every pod in the namespace via one unscoped GET") described the actual defect; marked `CORRECTED/SUPERSEDED` in place rather than silently rewritten, per this repository's historical-correction convention |

---

## 18. What OS-1B deliberately does not do (§35)

No log retrieval, no direct search, no multi-pod log merge, no
pagination, no correlation search, no context, no Live/follow, no pod
watches, no auto-attach for Live, no Loki integration/refactor, no
desktop packaging scripts, no macOS implementation, no GitHub Releases,
no REL-1 implementation, no Phase M. `OpenShiftScopeService`/
`OpenShiftScopeController` are a clean seam for OS-1C to build search
scope resolution on top of — nothing here anticipates or half-implements
that future feature.

---

## 19. OS-1C prerequisites

Ready to build on: a validated `WorkloadRef`/pod name/container name
triple representing exactly what OS-1C's bounded search must target;
`OpenShiftScope`'s existing generation-guarded selection-validation
pattern, directly reusable for whatever request-scoping OS-1C needs; and
the four-`WorkloadKind` discovery pattern, directly extensible if OS-1C
ever needs additional per-kind metadata (it should not need a fifth
kind — Jobs/CronJobs remain their own future design problem, not
casually added here). **§20 below adds one further prerequisite: OS-1C
must consume `PodDiscovery`'s resolved pod set and `status` field as
authoritative, not reinterpret "All workloads" itself.**

---

## 20. Review recovery — "All workloads" pod scope truthfulness

Mission: `OS_1B_REVIEW_RECOVERY_ALL_WORKLOADS_SCOPE`. PR #40 was not yet
approved for merge; reviewed HEAD `ad8bdeb70f25345172f7ed1b380b23f751d0b3e5`.
All CI on that HEAD was green — this was an evidence-backed *scope*
defect found on review, not a build or test failure.

### The defect

Approved OS-1B semantics define `Workload = All` as "all **supported**
workloads currently visible in the Project/Namespace" (Deployment,
DeploymentConfig, StatefulSet, DaemonSet). The shipped
`OpenShiftScopeService#discoverPods()` instead did, for the "no workload
selected" branch:

```java
selectedWorkload == null
    ? client.fetchPods(server, token, caPath, namespace, Map.of(), null)
    : ...
```

`Map.of()` is an empty label selector, and an empty selector on the
Kubernetes pods-list API matches **every pod in the namespace** —
including pods owned by a `Job`, a `CronJob`, an unsupported workload
kind, an operator/controller, or a standalone pod with no owning
workload at all. This silently widened "all supported workloads" into
"all pods in the namespace", which is a materially different and
un-approved scope. §5, §6 (the `OpenShiftScope` record signature) and
§7/§11 (call bounding) above are corrected in place and marked, rather
than silently rewritten, per this repository's own historical-correction
convention (see the inline notes added to each).

### The fix

`OpenShiftScopeService#discoverPods()`'s "All workloads" branch
(`discoverAllWorkloadsPods`) now builds the pod set as the **union of
pods belonging to each currently-discovered supported workload**,
resolved via that workload's own equality-based label selector — never
an empty/unfiltered selector, and never an owner-reference chase (which
would need unbounded extra calls per distinct owning ReplicaSet/
ReplicationController encountered). `WorkloadSummary` now carries the
workload's own `selector` (`Map<String, String>`), captured for free from
the same list-response body `discoverWorkloads()` already fetches —
Kubernetes enforces `Deployment`/`StatefulSet`/`DaemonSet` selectors as
immutable after creation, and OpenShift's `DeploymentConfig` selector is
conventionally never changed post-creation either, so a selector captured
at discovery time is not a staleness risk here.

**Membership truth, not inference.** A pod is included in "All
workloads" only if its labels satisfy a **known, discovered** supported
workload's selector — never a pod-name guess, never a fabricated
ownership claim. Jobs, CronJobs, unsupported kinds, operator-managed pods
and standalone pods are excluded **structurally**, by never being fetched
in the first place, not by a client-side filter applied after an
over-broad fetch.

**Partial-RBAC honesty (§5 of the mission).** A new `PodDiscovery(pods,
status)` result type (`status: COMPLETE | PARTIAL`) makes incompleteness
explicit rather than hiding it in a comment:

- `UNAVAILABLE_RESOURCE_TYPE` (a kind genuinely absent from the cluster)
  does **not** make the scope `PARTIAL` — there is nothing missing to
  account for (`OpenShiftScope#workloadScopeComplete()`).
- `FORBIDDEN`/`ERROR` on a workload **kind** during discovery, or a
  failure resolving one specific already-discovered workload's own pods,
  **does** make it `PARTIAL` — workloads (and their pods) of that kind
  may exist and simply could not be proven. The pod list is never
  widened to compensate; it stays exactly what could be proven, with the
  gap stated honestly via `status`.
- A 401 anywhere still aborts the whole operation and expires the
  session, exactly as before — unchanged.

**A second, independent gap found and fixed in the same pass:**
`OpenShiftSession#updatePods` guarded stale responses by generation and
selected-workload only. For "All workloads" (`expectedWorkload == null`),
a project switch leaves that value `null` on *both* sides of the switch,
so the existing guard could not detect it — a stale "All workloads" pod
result for project A could have silently landed on project B's scope.
Fixed by adding an explicit `expectedProject` check to `updatePods`,
mirroring the check `updateWorkloads` already had. This is exactly the
class of defect §15/§20 of this recovery exists to prevent, caught by
writing the required stale-response test matrix rather than by
inspection alone.

### OS-1C contract (§10 of the mission — now authoritative)

**OS-1C MUST consume `OpenShiftScopeService#discoverPods()`'s resolved
`PodDiscovery` unchanged.** It must not re-fetch pods with its own,
looser selector; it must not reinterpret `Workload = All` as "all
namespace pods" for its own bounded-search purposes; and it must respect
`PodDiscovery.status` — a `PARTIAL` result must not be silently presented
to a search/log-retrieval feature as a complete scope. Any future
relaxation of this (e.g. deliberately including unsupported-workload pods
for some new, explicitly-approved reason) requires its own owner decision
and its own documented row here and in the requirements register, not a
quiet change to `discoverPods()`'s existing behaviour.

### Test matrix (mission §7, all named tests added)

All new tests live in `OpenShiftScopeServiceTest`'s "OS-1B review
recovery — 'All workloads' pod union truthfulness" block, plus two in
`OpenShiftScopeTest`, two session-level stale-protection tests, one
controller-integration test, and two frontend tests:

| Mission letter | Scenario | Test |
|---|---|---|
| A/B/C/D | Deployment/StatefulSet/DaemonSet/DeploymentConfig pods included | `allWorkloadsUnionIncludesOnlyPodsProvenToBelongToASupportedDiscoveredWorkload` |
| E/F | Job/CronJob-owned pods excluded | same test (distinct fixtures, non-matching labels) |
| G | Standalone pod excluded | same test |
| H | Unknown/custom-controller pod excluded | same test |
| I | Rolling Deployment - old + new ReplicaSet pods both included | `rollingDeploymentPodsAreBothIncludedInTheAllWorkloadsUnion` (and `...ForASelectedWorkload` for the single-workload path, pre-existing, re-verified) |
| J | Multiple supported types, union with no duplicates | `allWorkloadsUnionIncludesOnlyPodsProvenToBelongToASupportedDiscoveredWorkload` (multiple kinds) + `aPodMatchingTwoSupportedWorkloadsSelectorsIsIncludedOnlyOnce` (the explicit de-dup edge case) |
| K | One kind `FORBIDDEN` → `PARTIAL`, no namespace widening | `aForbiddenWorkloadKindMakesAllWorkloadsPartialWithoutWideningToNamespacePods` |
| L | One kind `UNAVAILABLE_RESOURCE_TYPE` → not forbidden, stays `COMPLETE` | `anUnavailableResourceTypeDoesNotMakeAllWorkloadsPartial` |
| M | Project change during "All workloads" resolution → stale rejected | `aStaleAllWorkloadsPodResponseForAnAbandonedProjectIsDiscarded` |
| N | Reconnect during resolution → stale rejected | `aStaleAllWorkloadsPodResponseAfterReconnectIsDiscarded` |
| O | No supported workloads → successful empty result | `noSupportedWorkloadsMeansAnEmptyPodResultNeverEveryPodInTheNamespace` (backend) + `getPodsWithNoSupportedWorkloadsDiscoveredReturnsAnEmptyResultNeverEveryNamespacePod` (controller) |
| (extra, not in the mission's lettered list but proven anyway) | A specific workload's own pod fetch fails independently of kind-level discovery | `aPerWorkloadPodFetchFailureMarksTheUnionPartialWithoutFailingTheWholeRequest` |
| (extra) | `workloadScopeComplete()` truth table | `OpenShiftScopeTest#workloadScopeIsCompleteWhenEveryKindIsAvailableOrGenuinelyUnavailable` / `...IsIncompleteWhenAKindIsForbiddenOrErrored` |
| (extra, controller) | Real HTTP `GET /pods` returns the corrected union + `status` | `getPodsWithNoWorkloadSelectedUnionsOnlyPodsBelongingToADiscoveredSupportedWorkload` |
| (extra, frontend) | PARTIAL note shown/hidden truthfully | `shows a truthful incompleteness note...` / `shows no incompleteness note for an ordinary COMPLETE pod result` |

**No existing OS-1B test was weakened.** Every pre-existing pod/container
test that depended on the old unfiltered "All workloads" fetch
(`discoversAllPodsInTheNamespaceWhenNoWorkloadIsSelected` and several
pod/container-mechanic tests that never selected a workload) was adapted
to discover-and-select a specific supported workload first — the same
underlying pod/container parsing and selection-validation behaviour they
were actually testing is unchanged and still fully covered; only the
now-corrected "no workload selected" premise was removed from them.

### Call bounding (mission §8 — see also §11 above)

- Selected workload: **2 GETs**, unchanged.
- "All workloads": **W GETs** (one selector-filtered pod-list GET per
  currently-discovered supported workload, concurrent), where selectors
  come from the 4 workload-discovery GETs' own list-response bodies at no
  extra cost. Never a call per pod. Never namespace- or cluster-wide.

### Frontend (mission §9)

No redesign. `Workload = All` remains the label. The Pod field gained one
conditional line - shown only when `status === 'PARTIAL'` - "This list
may be incomplete - not every workload type could be checked, so some
pods may be missing." Never shown for an ordinary successful discovery.

### Validation

| Check | Result |
|---|---|
| Targeted "All workloads" scope tests | PASS (18 new/adapted tests across backend + frontend) |
| All OpenShift tests | PASS |
| Backend full suite (`./mvnw test`) | **820 pass, 0 failures, 0 errors** |
| Frontend full suite | **751 pass** |
| OS-1A regression E2E | **17/17** |
| Full Playwright suite | **287/287 pass**, re-run against a freshly-restarted dev-profile backend carrying this recovery's changes (9.8m) |
| Typecheck | PASS |
| Production build | PASS |
| `REAL_OPENSHIFT_1A` | `BLOCKED_CREDENTIALS` — unchanged, not run |
| `REAL_OPENSHIFT_1B` | `BLOCKED_CREDENTIALS` — unchanged, not run |
