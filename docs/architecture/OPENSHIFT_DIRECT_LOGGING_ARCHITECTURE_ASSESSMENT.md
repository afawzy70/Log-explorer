# OpenShift Direct Logging — Architecture & Verification Assessment (OS-A)

**Assessment only. No OpenShift feature is implemented by this mission.**
No production behaviour changed; no adapter added; no Loki code touched.

Base: `6205d2bfb7b2ebce06e15debb6e33bb5235d754e` (post-PR #37 `main`).

Every statement below is tagged so assumption is never presented as fact:

| Tag | Meaning |
|---|---|
| **[OWNER]** | An owner decision, quoted or paraphrased from the mission |
| **[FACT]** | Verified in this repository at the base commit, with the file named |
| **[PROPOSED]** | This assessment's recommendation |
| **[ASSUMPTION]** | Not verified — must be proven before it is relied on |
| **[EVIDENCE]** | External evidence gathered during this assessment, with its source |
| **[BLOCKER]** | Prevents progress until resolved |
| **[FUTURE]** | Deliberately out of the first implementation |

---

## 1. Executive summary

**[PROPOSED]** OpenShift should become a first-class product source backed
by the **Kubernetes/OpenShift API directly**, with Loki demoted from a
user-facing source to an optional *aggregated/historical provider* behind
it. The strongest argument is not conceptual tidiness — it is that the
current Loki source is architecturally a **deployed-in-cluster** component
while the owner's product is a **developer desktop application**, and the
two models disagree on nearly every axis that matters.

The repository is in unusually good shape for this change. Three findings
drive the whole plan:

1. **[FACT]** The canonical event model *already* carries `namespace`,
   `pod` and `containerName` (`CanonicalLogEvent`, Loki Phase D
   enrichment). The OpenShift "WHERE" hierarchy is mostly already
   expressible; only `cluster` and `workload` are genuinely new fields.
2. **[FACT]** `LogSource` already has precedent for a **source-specific
   scope dimension** that other sources ignore —
   `discoverServices(String composeProject)` and
   `discoverComposeProjects()` both ship with safe defaults so Fixture and
   Loki need no changes (UX-R3). OpenShift's deeper hierarchy is the same
   pattern, not a new one.
3. **[FACT]** `LogSourceRegistry` builds `Map.copyOf(byId)` from
   constructor-injected beans. **Sources are fixed at application
   startup; there is no runtime registration path.** This single fact
   shapes the entire connection model (§4).

The largest genuinely new work is not the adapter — it is **runtime
credential intake**, which this application has never had (§6), and
**bounded multi-pod fan-out with truthful ordering** (§10).

---

## 2. Current state — what "OpenShift" means in the product today

**[FACT]** `LokiLogSource` (`backend/.../source/loki/LokiLogSource.java`):

| Property | Current value |
|---|---|
| Source id / display name | `openshift-loki` / "OpenShift Loki" |
| Capabilities | `historicalSearch=true`, `liveTail=false`, `rawLogQL`=config, `serviceDiscovery=false`, `queryStatistics=false`, `contextView=false`, `composeProjectScoping=false` |
| Namespace | **One**, fixed in configuration (`LokiProperties#namespace`) |
| Credentials | `LokiTokenSupplier` — env var **or a token file path** (the standard service-account token mount) |
| Discovery | **None.** `discoverServices()` returns `Flux.empty()` by deliberate design |
| Live | Not implemented; capability hardcoded `false` |

**[FACT]** That configuration shape — a service-account token mount, one
pre-selected namespace, no discovery — describes a component **deployed
inside or alongside the cluster by an operator**, configured once.

**[FACT]** It does not describe the owner's stated workflow at all. A
developer who runs `oc login` on their laptop has: a personal bearer
token, access to *several* projects, and an expectation of discovering
what they can see. None of those three things exist in the current source.

**Conclusion [PROPOSED]:** this is not a UX gap to be papered over. The
current OpenShift source answers a different question from the one the
owner is asking, which is why it has never felt first-class.

---

## 3. Recommended architecture

**[PROPOSED]**

```
OpenShiftLogSource                    (product-level source, id: "openshift")
   │
   ├── OpenShiftConnection            (session: API server + token + CA + TLS)
   │
   ├── DirectPodLogProvider           (Kubernetes/OpenShift pod-log API)   ← OS-1x
   │      · namespaces / workloads / pods / containers discovery
   │      · bounded multi-pod log retrieval + deterministic merge
   │      · follow (Live)
   │
   └── AggregatedLogProvider          (interface)                          ← later
          └── LokiAggregatedProvider  (wraps today's Loki client)          ← OS-1G
```

**[PROPOSED]** `OpenShiftLogSource` is a **single Spring bean**, always
present, whose `health()` and `capabilities()` reflect whether a
connection is currently established and which provider is active.

**Why a single bean rather than "Add Source" creating N sources**:

- **[FACT]** `LogSourceRegistry` is immutable after construction.
- **[FACT]** `PageCursorCodec` binds `sourceId` into the cursor's
  request-binding HMAC, so source ids participate in pagination
  integrity — dynamically generated ids would need care there.
- **[FACT]** UX-17 in the requirements register persists **selected
  source id** as a safe preference; unstable ids would break restore.
- **[FACT/OWNER]** `CLAUDE.md` §8 lists **multi-cluster** as
  `OUT_OF_CURRENT_SCOPE`.

So "Add Source → OpenShift" should be read as **"configure and connect
the OpenShift source"**, exactly as "Docker settings" configures the
Docker source — not as creating arbitrary new source instances.
**[FUTURE]** Multiple simultaneous clusters, if the owner ever lifts the
multi-cluster exclusion, would then be a registry change with a known
blast radius rather than a first-slice risk.

---

## 4. Connection & credential intake — the real new surface

**[FACT]** `DockerSettingsController` exposes exactly two operations:
`GET /connection` (sanitized, read-only) and `POST /test-connection`
(ephemeral — builds temporary properties, pings, closes, and **never
touches the committed configuration**). Its own javadoc states there is
"no authenticated admin boundary (no Spring Security, no `@PreAuthorize`,
nothing gating any endpoint by identity)".

**[FACT]** Committed Docker configuration comes from environment/config,
never from the browser. **The application has never accepted a credential
from the UI.**

**[FACT]** `application.yml` binds `server.address` to
`${SERVER_ADDRESS:127.0.0.1}` — loopback by default.

**[PROPOSED]** OpenShift requires the first genuine runtime-credential
intake in this product, and it must be designed as such rather than
treated as "another settings field":

| Control | Recommendation |
|---|---|
| Transport | Loopback-bound backend only. **[PROPOSED]** the OpenShift connect endpoint must refuse to serve when `server.address` is not a loopback address, since the desktop model is what makes an unauthenticated token endpoint acceptable |
| Lifetime | **Session/in-memory only** for the first implementation, per **[OWNER]** §13 |
| Representation | Wrap in the existing **`RawToken`** (**[FACT]** `toString()` returns `RawToken[REDACTED]` by type, so an accidental log cannot leak it) |
| Read-back | No endpoint ever returns the token or any prefix of it; connection summary reports only server URL, user identity and expiry-ish state |
| Diagnostics | The pasted command is redacted at intake; never stored raw |

**[ASSUMPTION]** That loopback binding is sufficient protection for an
unauthenticated local token endpoint. This holds for the desktop product
but would **not** hold if Log Explorer were ever served to multiple users
from one host. That case is already excluded by the desktop-first
direction, and the guard above makes the assumption enforced rather than
implicit.

---

## 5. `oc login` import — safe parsing

**[OWNER]** Accept a pasted `oc login` command as a convenience input
format. **Never execute it.**

**[PROPOSED]** Treat the pasted string as **untrusted data to be parsed,
never a command line to be interpreted**. The parser:

1. Rejects the input outright unless it matches a strict whitelist shape.
2. Extracts **only** three approved values: `--server=<https URL>`,
   `--token=<bearer token>`, and optionally
   `--certificate-authority=<path>` / `--insecure-skip-tls-verify`
   (the latter only to **detect and refuse**, see §7).
3. Ignores every other flag rather than guessing at it.

**[PROPOSED]** Explicit rejection rules — the parser must refuse, not
sanitize, when the input contains shell metacharacters anywhere:
`;` `&` `|` `` ` `` `$(` `${` `<` `>` `\n` `\r`, or quoting that would
change token boundaries.

| Hostile input | Required behaviour |
|---|---|
| `oc login --token=T --server=https://a ; rm -rf /` | **Reject** (contains `;`) |
| `oc login --token=$(cat /etc/passwd) ...` | **Reject** (contains `$(`) |
| `oc login --token=T --server=https://a && curl evil` | **Reject** (contains `&&`) |
| `oc login --token=T --server=https://a > /tmp/x` | **Reject** (contains `>`) |
| `oc login --token="T; evil" --server=...` | **Reject** (metacharacter inside quotes) |
| `--server=http://…` (plain HTTP) | **Reject** — TLS required (§7) |
| `--server=file:///…` or non-URL | **Reject** |
| Anything not matching `oc login` shape | **Reject** with a generic message |

**[PROPOSED]** Rejection messages must name the *rule* violated, never
echo the offending input — the same discipline UX-R6 applied to search
errors (which are asserted never to echo the typed value).

**[PROPOSED]** `OC_BINARY_RUNTIME_DEPENDENCY = NO`. The `oc` executable
is not required at runtime, is never invoked, and its presence or absence
must not change behaviour. This also keeps desktop packaging unchanged.

---

## 6. TLS / CA model

**[FACT]** The repository already solves this exact problem for Loki.
`LokiWebClientFactory` + `CompositeX509TrustManager` add **one extra
trusted CA on top of the JVM's default trust anchors** — they never
replace or bypass verification, and `CLAUDE.md` §2 rule 7 forbids
trust-all outright.

**[PROPOSED]** Reuse that mechanism unchanged for the OpenShift API
client. Supported cases: public CA; enterprise/private CA supplied as a
PEM path or inline PEM data; hostname verification always on.

**[PROPOSED]** `--insecure-skip-tls-verify` in a pasted command must be
**detected and refused with an explanatory message**, not silently
honoured and not silently dropped. Refusing is the honest behaviour: the
user believes they pasted something meaningful, and quietly ignoring it
would make the app's security posture differ from the user's belief.
**[FUTURE]** If a development-only insecure mode is ever required, it
must be non-default, explicit, loudly visible in the UI, and assessed
against §2 rule 7 — this assessment does **not** recommend adding it.

---

## 7. RBAC & permission truthfulness

**[OWNER]** The app acts as the authenticated developer and must not
imply access the user does not have.

**[PROPOSED]** Discovery is **never** cluster-scoped:

| Need | API approach | Notes |
|---|---|---|
| Accessible projects | OpenShift `projects.project.openshift.io` list (falls back to namespace list) | Returns only what the user can see; no cluster-admin needed |
| Workloads in a project | List Deployments / StatefulSets / DaemonSets / Jobs / CronJobs in that namespace | Namespace-scoped |
| Pods | List pods in the namespace, filtered by owner/selector (§8) | Namespace-scoped |
| Logs | `GET /api/v1/namespaces/{ns}/pods/{pod}/log` | Subject to `pods/log` RBAC |

**[PROPOSED]** Error semantics, all of which must be truthful rather than
collapsed into a generic failure:

| Condition | Behaviour |
|---|---|
| `401` | Session invalid/expired → prompt to re-authenticate; clear the in-memory token |
| `403` on project list | Show "no accessible projects", not an error |
| `403` on one namespace | Omit it; never fabricate it as empty |
| `403` on `pods/log` | Surface as an explicit per-pod permission state |
| One pod inaccessible among several | **Partial result** — return what was readable and report the gap, in the same spirit as the existing truncation/gap model |

**[PROPOSED]** Partial-permission results must be visibly partial. The
product already has honest vocabulary for this (truncation counts, gap
markers, "results may be incomplete") and should reuse it rather than
inventing a parallel notion.

---

## 8. Scope model: cluster → project → workload → pod → container

**[PROPOSED]** UI language: **"Project"**, with "namespace" used in
backend models, API fields and the Inspector's technical metadata.
Rationale: `oc` and the OpenShift console both say *Project* to
developers, and the mission's own audience is an OpenShift developer. The
term stays technically truthful because a Project *is* a namespace with
additional OpenShift semantics, and the Inspector still shows the literal
`namespace` value. **[PROPOSED]** Where both must appear in one label,
use "Project / Namespace" once, in Settings, rather than everywhere.

**[PROPOSED]** Selection semantics — each level narrows, none is
mandatory beyond the project:

| Selection | Meaning | Bound |
|---|---|---|
| Project only | All readable pods in the project | Hard pod cap applies (§10) |
| Project + Workload | All pods currently owned by that workload | Pod cap applies |
| Project + Workload + Pod | That pod only | — |
| … + Container | That container only | — |

**[PROPOSED]** **Project is required** for any Direct search. This is the
single most important bound in the whole design: without it, "search" is
a cluster-wide fan-out.

**[EVIDENCE, established by OS-1A, not this assessment]** The "Project"
naming decision above assumed the OpenShift Projects API is always
reachable. OS-1A's implementation found a real exception: a vanilla
Kubernetes API server (no OpenShift `project.openshift.io` API group)
answers the Projects endpoint with a genuine HTTP 404, in which case
OS-1A falls back to the Kubernetes `namespaces` API and the UI must say
"Namespace"/"Namespaces", never "Project" — presenting a namespaces
result as a native Projects response would misrepresent what the cluster
actually supports (see `OS_1A_OPENSHIFT_CONNECTION_PROJECT_DISCOVERY_REPORT.md`
and `OWNER_REQUIREMENTS_REGISTER.md` OS-1A-12/OS-1A-18/OS-1A-19). This
matters for any OS-1B+ design built on top of this section: **which API
answered discovery is part of the connection's current truth**, stored
explicitly (`OpenShiftSession#discoveryApi()`), never re-derived from
project/namespace names later — the two lists are not structurally
distinguishable from their contents alone. OS-1B's scope model should
read this field rather than re-deciding "Project vs Namespace" itself.

### Workload → pod resolution

**[PROPOSED]** First implementation supports **Deployment,
DeploymentConfig, StatefulSet, DaemonSet** by resolving pods through
**label selectors**, and validating with **owner references** where
cheaply available. Jobs/CronJobs are **[FUTURE]** — their pods are
short-lived and completed-pod semantics deserve their own design.

**[ASSUMPTION]** Label-selector resolution is sufficient for the common
case. It is not perfect: a Deployment's selector also matches pods from
an older ReplicaSet during a rollout. **[PROPOSED]** That is acceptable
and arguably *desirable* for log investigation (you usually want the old
replicas' logs during a bad rollout), but it must be **stated in the UI**
rather than hidden — e.g. the pod count reflects what was actually
resolved at query time.

**[PROPOSED]** Pod churn is a first-class truth, not an edge case: pods
resolved at query time may not exist moments later, and pods deleted
before the query are invisible. This must be said plainly in the product
(§9), not discovered by the user.

---

## 9. What Direct mode can and cannot honestly do

**[FACT]** The Kubernetes pod-log API supports: current container logs,
`previous=true` for the prior terminated container, `sinceTime` /
`sinceSeconds`, `timestamps=true`, `tailLines`, `limitBytes`,
`container=<name>`, and `follow=true` for streaming.

**[FACT]** It does **not** provide: indexed search, cross-pod queries,
server-side field filtering, logs for deleted pods, or logs rotated out
by the container runtime.

**[PROPOSED]** Truthful capability mapping for **Direct** mode:

| Log Explorer capability | Direct OpenShift | Why |
|---|---|---|
| Pod/container/workload/project discovery | **SUPPORTED** | Namespace-scoped list APIs |
| Live tail | **SUPPORTED** | `follow=true` per pod/container |
| Time-bounded retrieval | **PARTIAL** | `sinceTime` gives a lower bound; there is **no** upper bound — an end time must be enforced client-side by discarding later events |
| Historical search beyond retention | **UNSUPPORTED** | Not an index; bounded by node/runtime retention |
| Logs of deleted pods | **UNSUPPORTED** | Gone with the pod |
| Structured/field filtering | **PARTIAL** — post-filtered only | `EventFilters` already re-applies every condition to every fetched event, so correctness holds; the cost is bandwidth, not accuracy |
| Free-text search | **PARTIAL** — post-filtered | Same |
| Correlation/trace/journey search | **PARTIAL** | Requires bounded fan-out (§11) |
| Newest/Oldest ordering | **PARTIAL** — see §10 | |
| Cursor pagination | **UNSUPPORTED as today's model** — see §10 | |
| Context (±30s) | **PARTIAL** | Feasible within the same pod/container; see §12 |
| Raw query (LogQL) | **UNSUPPORTED** | Belongs to the aggregated provider |

**[PROPOSED]** `describePushDown()` must be honest here: for Direct mode
the only genuine push-downs are **namespace, pod, container, `sinceTime`
and `tailLines`**. Everything else is post-filtering and must not be
claimed. **[FACT]** The existing default returns an empty list precisely
so that a source cannot accidentally over-claim.

---

## 10. Ordering, pagination and bounded fan-out

**[FACT]** Today's pagination is a signed, integrity-protected cursor
(`PageCursorCodec`) binding source, direction, time range, filters and a
boundary position; `SearchRequest.Direction` is honoured **source-side**
by Fixture, Docker and Loki, verified against real Docker in UX-R4.

**[FACT]** The pod-log API has **no cursor and no "search backwards"**.
It returns a forward-ordered stream from a start point.

**[PROPOSED]** Therefore Direct OpenShift must define a **truthful,
source-specific** model rather than imitate Loki's:

- **Ordering:** fetch each pod/container's window, parse timestamps, and
  perform a **deterministic k-way merge** — the same shape Docker already
  uses for multi-container merge. Both directions are then truthful
  *within the fetched window*, because the window is fully materialised
  before ordering.
- **Pagination:** **[PROPOSED]** replace page-cursors with **window
  narrowing** for this source — "older" continues by moving the window
  back in time, and the UI reports it as such. **[PROPOSED]** If the
  existing cursor contract cannot express that honestly, the correct
  answer is to report `pagination` as a capability this source does not
  have, not to fake one. **Never simulate global pagination in React** —
  **[OWNER]** §18, and consistent with UX-R4's finding that the frontend
  must never re-sort.
- **[PROPOSED]** The merged window must expose truncation explicitly when
  any pod hit its `tailLines`/`limitBytes` cap, so "newest 200 of an
  unknown total" is never presented as completeness.

### Mandatory bounds

**[FACT]** Existing guardrails to build on:
`SearchGuardrailsProperties` — `defaultLimit=200`, `maxLimit=5000` (hard
ceiling), `maxTimeRange=7d`, **`perSourceMaxTimeRange`** (per-source
override, already supported), `requestTimeout=30s`, `maxConcurrency=8`;
Docker's `max-containers=200`; Live's `max-concurrent-tails=4`.

**[PROPOSED]** New OpenShift-specific bounds, as configurable defaults
with hard ceilings — **numbers below are starting proposals to be
calibrated against the real sandbox, not evidence-backed finals**:

| Bound | Proposed default | Hard ceiling |
|---|---|---|
| Project selected | **required** | — |
| Max pods per search | 20 | 50 |
| Max containers per pod | 5 | 10 |
| Concurrent log requests | reuse `maxConcurrency=8` | 8 |
| Per-pod line cap | `tailLines` derived from the request limit | — |
| Per-pod byte cap | `limitBytes` set | always set |
| Time range | **per-source cap via `perSourceMaxTimeRange`**, materially shorter than 7d | — |
| Request timeout / cancellation | reuse existing 30s + supersession | — |

**[PROPOSED]** A search whose resolved pod set exceeds the cap must
**refuse or explicitly truncate with a visible count** — never silently
sample.

**[EVIDENCE, established by OS-1C, not this assessment]** Implemented as
two independently-enforced dimensions rather than the "max pods" + "max
containers per pod" pair proposed above: `maxPods` (distinct pods
considered, applied before per-pod container expansion) and `maxTargets`
(the resulting (pod, container) fan-out, applied after). This is a
deliberate simplification, not an oversight — `maxTargets` bounds the
real fan-out cost (one HTTP call per target) directly and precisely,
which a strict per-pod container sub-cap would only bound indirectly and
less tightly for the actual concern (total concurrent/sequential upstream
calls). Both caps are single configurable values with no separate
"hard ceiling," unlike `SearchGuardrailsProperties`' `defaultLimit`/
`maxLimit` pair — an intentionally simpler model for a source-internal
bound that only the deployer (not an end-user request) can ever change.
Truncation is never silent: exceeding either cap is named through
`LogSource#describeScopeWarnings`, surfaced via the existing `QueryPlan`
notes channel — see `OS_1C_OPENSHIFT_DIRECT_SEARCH_REPORT.md` §4. The
"window narrowing instead of cursor pagination" idea above was not
needed: OS-1C instead self-trims its own result to its internal cap
before `SearchService` ever sees it, which is what keeps `pagination`
honestly `false` without inventing any window-narrowing cursor concept —
see the report's §8.

**[EVIDENCE, established by OS-1C review recovery]** The §10 proposal's
own "Per-pod byte cap | `limitBytes` set | always set" row (above) named
the *intent* correctly but the first implementation did not fully deliver
it: `maxBytesPerTarget` was enforced by truncating an already-fully-
materialized `String` by character count, not a real streaming byte
bound. Corrected to true streaming byte-counted consumption (never more
than `maxBytes` ever held in memory, cancelled on the wire the instant the
cap is reached) — see `OS_1C_OPENSHIFT_DIRECT_SEARCH_REPORT.md` §21 for
the full before/after account, and per-target runtime failures (a pod
403/404/timeout/error) are now also disclosed through the same
`describeScopeWarnings`/`QueryPlan.notes` channel this section describes,
closing the "not yet individually named" gap the original OS-1C
implementation disclosed.

**[EVIDENCE, established by the OS-1C final review recovery]** §21's own
streaming byte-bound fetch had one remaining gap: cancelling the fetch from
outside (a per-target timeout, or the overall search itself being
cancelled) was not bridged to the raw HTTP body's subscriber, so the body
could keep being consumed after nobody would read the result. Fixed by
registering the returned `Mono`'s own cancellation against the same
subscriber the byte cap already controls, with the two causes (the cap's
own self-cancel vs. an external cancel) tracked explicitly so an aborted
request can never resurface as a successful result. Backpressure was also
tightened from unlimited demand to a pull-style `request(1)` — see
`OS_1C_OPENSHIFT_DIRECT_SEARCH_REPORT.md` §22 for the full account and
test evidence.

---

## 11. Correlation / trace / journey

**[PROPOSED]** Without an index, "find this trace ID" under Direct mode
is a **bounded fan-out post-filter** over the currently scoped pods and
time window. It must therefore:

- stay within the same pod/time bounds as an ordinary search;
- state that results are **scoped**, not cluster-wide;
- never imply that an absent result proves the ID does not exist.

**[PROPOSED]** This is the single clearest argument for keeping an
aggregated provider (§13): cross-service journey reconstruction is
exactly what an index is for. Direct mode should present journey results
as "within this project and window" and say so.

---

## 12. Context (±30s)

**[FACT]** The ±30s context endpoint reuses the ordinary search pipeline
with a bounded window, and the frontend sorts it ascending.

**[PROPOSED]** Direct mode can support context honestly at
**pod/container scope** (`sinceTime = t-30s`, discard beyond `t+30s`) and
at **workload scope** within the pod cap. **[PROPOSED]** It must be
explicit that context is **incomplete if pods churned** within the
window — a replaced pod's logs may simply not exist. The product already
has the right vocabulary (gap markers, "results may be incomplete") and
must reuse it rather than implying completeness.

**[PROPOSED]** The `contextView` capability should be reported per
provider, honestly — a lesson already learned in UX-R4, where all three
sources declared `contextView=false` while the feature worked.

---

## 13. Loki's role after first-class OpenShift

**[PROPOSED]** Loki becomes an **aggregated/historical provider behind
the OpenShift source**, not a peer user-facing source.

**[PROPOSED]** Recommended end state:

- `openshift` is the user-facing source.
- Provider selection is **capability-driven**, not a manual toggle the
  user must understand: Direct is always available once connected; the
  aggregated provider appears only when a Loki endpoint is configured
  **and** reachable.
- Historical queries beyond Direct's honest retention **offer** the
  aggregated provider when present, and otherwise **say plainly** that the
  window exceeds what pod logs retain — never silently return less.

**[PROPOSED]** Do **not** delete or hide the Loki source in the first
slices. Reasons grounded in current code, not aesthetics:

- **[FACT]** `openshift-loki` is a persisted, user-visible source id;
  UX-17 persists the selected source id as a safe preference.
- **[FACT]** A substantial Loki test suite exists and is currently the
  only coverage of that adapter.
- **[FACT]** **Real Loki has never been verified** — UX-R4, UX-R5 and
  UX-R6 all recorded `REAL_LOKI=BLOCKED`. Restructuring an adapter that
  has never run against its real backend would be changing unverified
  code into differently-unverified code.

**[PROPOSED]** Migration strategy: **A — additive first.** Add
`openshift` alongside `openshift-loki`; keep both user-visible during the
implementation slices; fold Loki in behind OpenShift (OS-1G) **only
after** real-Loki verification exists, or after the owner explicitly
accepts folding in an unverified adapter. **[FUTURE]** Retiring the
standalone `openshift-loki` id, with a preference migration for anyone
who had it selected.

**[PROPOSED]** Loki outside OpenShift: technically possible (it is just
an HTTP API), but there is no current use case in this product, and the
source is literally named "OpenShift Loki". Keep it as an OpenShift
provider only.

---

## 14. Event enrichment & the WHERE dimension

**[FACT]** `CanonicalLogEvent` already carries `namespace`, `pod`,
`containerName`, `containerId`, `stream`, `composeProject`,
`composeService`, `serverHost`, `serverIp`, plus `service` and
`serviceSourceHint`.

**[PROPOSED]** Additive fields needed: **`cluster`** (a user-supplied
connection label, since an API URL is not a friendly name) and
**`workload`**. **[FUTURE]** `node`, only if a real investigation need
appears.

**[PROPOSED]** Precedence — must not regress **[FACT]** CLAUDE.md §4's
rule that `service` comes from top-level `application` first, then source
metadata, keeping both when they differ:

1. `service` ← the application's own `application` field, unchanged.
2. If absent, fall back to the **workload name** as
   `serviceSourceHint`-style metadata — never overwrite a real
   application value with a Kubernetes name.
3. `namespace`, `pod`, `containerName`, `workload`, `cluster` are always
   adapter enrichment and never overwrite parsed application fields.

**[PROPOSED]** Where this metadata belongs (LERDESIGN-1 view, §15):

| Field | Placement |
|---|---|
| Cluster, Project | **Scope trail** — active investigation scope, exactly as UX-R3 does for Docker Compose project |
| Workload | Optional Results column; Inspector Overview |
| Pod, Container | Optional Results columns (**off by default**); Inspector Overview |
| Node | Inspector only, if ever added |

**[PROPOSED]** Do **not** add pod/container to the default seven-column
table. UX-R4 measured what happens when low-value columns hold fixed
width: the message column — the primary scanning field — is the one that
gets crushed. Pod names are long, low-entropy across replicas, and belong
behind the Columns control.

---

## 15. UX architecture (LERUX-1 diagnosis → LERDESIGN-1 proposal)

**LERUX-1 — what the current source UX actually is [FACT]:**

- `SourceSelect` is a 34-line `<select>`; source choice is a single flat
  dimension.
- Scope beyond source exists only for Docker (Compose project), added in
  UX-R3, surfaced in the `ScopeTrail` and a dedicated selector.
- Settings (`DockerSettingsPanel`, 267 lines) is **read-only + Test
  Connection**; it cannot commit a connection.
- Capability gating is already strict and already correct: the frontend
  never infers what a source can do.

**LERDESIGN-1 — proposed interaction model [PROPOSED]:**

*Settings → OpenShift connection* (a genuinely new surface, **not** a
clone of Docker Settings):

1. **Connect** — one paste field ("Paste your `oc login` command"), an
   optional connection name, optional CA. Primary action: **Connect**.
2. Parse failures are explained by rule, never by echoing input.
3. On success show *who you are* and *which server*, never the token.
4. **Disconnect** clears the in-memory session.

*Search workspace* — extend the existing scope trail rather than
inventing a second pattern:

```
Source: OpenShift  ·  Cluster: PROD  ·  Project: payments  ·  Workload: payment-api  ·  Pods: all (3)
```

**[PROPOSED]** Progressive narrowing, each level optional after Project,
each defaulting to "all" — mirroring how Compose project/service already
behave, so an investigator who already knows the Docker flow needs no new
concepts.

**[PROPOSED]** Differences from Docker are legitimate and should not be
flattened: Docker is `Connection → Compose project → Service → Container`;
OpenShift is `Cluster → Project → Workload → Pod → Container`. **[OWNER]**
§24 explicitly allows this.

---

## 16. Capability truthfulness

**[PROPOSED]** **[FACT]** `SourceCapabilities` is a 7-boolean record
shared by all sources. OpenShift needs finer granularity than it offers
(e.g. discovery is not one thing; pagination and global sort are not the
same as historical search).

**[PROPOSED]** Extend `SourceCapabilities` **additively** with explicit
flags — `projectDiscovery`, `workloadDiscovery`, `podDiscovery`,
`pagination`, `globalSort`, `correlationSearch` — each defaulting to
`false` so no existing source's declared behaviour changes. **[FACT]**
UX-R4 already had to correct a capability that lied (`contextView=false`
while the feature worked), so the cost of a vague capability model is
already demonstrated in this repo.

**[PROPOSED]** Capabilities must be computed from the **active provider
and connection state**, not hardcoded per source.

---

## 17. Desktop-first & enterprise networking

**[PROPOSED]** `OPENSHIFT_DEPLOYMENT_REQUIRED = NO`. Nothing in the
Direct design needs anything running inside the cluster: it uses the same
API server, over the same network path, with the same credential that
`oc login` already uses from that machine.

**[PROPOSED]** Documented prerequisites: the API server must be reachable
from the developer's machine — VPN/ZTNA connected, corporate DNS
resolving the API hostname, any required proxy configured, and the
cluster CA trusted (or supplied). **The working rule to publish: if
`oc login` works from this machine, Log Explorer should work through the
same route.**

**[PROPOSED]** Proxy support must be explicit, not assumed.
**[ASSUMPTION]** Reactor Netty (the existing WebClient transport) does
**not** honour `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` environment
variables automatically the way some HTTP clients do. This must be
**verified before OS-1A is estimated**; if it holds, proxy configuration
(including `NO_PROXY` handling) is real work that belongs in the
connection slice rather than being discovered late.

---

## 18. Real-environment verification strategy

### Environment

**[EVIDENCE]** Red Hat Developer Sandbox for OpenShift
(`developers.redhat.com/developer-sandbox`, `/faq`, fetched during this
assessment): free, no credit card; a **30-day** trial that is renewable
(the FAQ advises exporting work "before one trial ends, and import it when
you've started your next 30 day trial"); **"private access to a shared,
multi-tenant OpenShift cluster"**; **"Pods are automatically deleted after
running for 12 consecutive hours."**

**[EVIDENCE]** The public pages do **not** document: number of
projects/namespaces per user, whether cluster-admin is granted, resource
quotas, authentication/token mechanics, or availability of the cluster
logging/Loki stack.

**[ASSUMPTION]** A shared multi-tenant sandbox grants **no cluster-admin**
and **no access to cluster-scoped logging infrastructure**. This is a
well-founded inference from "shared, multi-tenant", not a documented
fact, and must be confirmed by the owner on first login.

**[PROPOSED]** Consequences, which are mostly favourable:

- `REAL_OPENSHIFT_DIRECT_ENVIRONMENT = FEASIBLE` — Direct mode needs only
  namespace-scoped rights, which is exactly what a sandbox tenant has.
- `REAL_LOKI_ENVIRONMENT = BLOCKED (expected)` — and **[OWNER]** §33 says
  that must not block Direct verification.
- The **12-hour pod deletion is an asset**, not an obstacle: it gives a
  real, free, repeatable source of **pod churn and replacement**, which
  is precisely the hardest thing to test (§30 N, §12's context-incomplete
  case).

**[PROPOSED]** Sandbox limits (30 days, shared tenancy) make it right for
**correctness** verification and wrong for **scale** verification. Scale
bounds (§10) should be calibrated against the owner's real cluster, or
explicitly deferred.

### Credential flow

**[PROPOSED]** `OPENSHIFT_API_SERVER` + `OPENSHIFT_TOKEN` as environment
variables read by an **opt-in, tagged** integration test that **skips
cleanly when unset**. **[OWNER]** §32: tokens are never committed and
never appear in reports. **[PROPOSED]** Sandbox tokens are short-lived,
which suits this well: the owner re-exports a fresh token per verification
session rather than storing one.

**What the owner must provide before real verification begins:**

1. A Developer Sandbox account (or a real cluster they are willing to use).
2. `OPENSHIFT_API_SERVER` and a current `OPENSHIFT_TOKEN` in the local
   environment — never pasted into an issue, PR, report or chat.
3. Confirmation of what that account can actually see: how many projects,
   whether workloads can be created, and whether any logging stack is
   exposed.

### Test pyramid

**[PROPOSED]**

| Layer | Scope | Runs in CI? |
|---|---|---|
| **1 — Unit/contract** | `oc login` parser (especially every hostile input in §5), scope resolution, merge/ordering, bounds, capability computation, token redaction | **Yes, always** |
| **2 — Fake API** | MockWebServer-style deterministic Kubernetes/OpenShift API: project/workload/pod lists, log streams, `401`/`403`/partial permissions, pod-deleted mid-stream | **Yes, always** |
| **3 — Real sandbox** | The §19 matrix against a real cluster | **No** — explicit opt-in workflow, skipped without credentials |

**[PROPOSED]** Normal CI must stay fully deterministic and credential-free.
**[FACT]** The repository already follows exactly this discipline: the CI
E2E job runs the deterministic Fixture source and never touches real
external infrastructure.

---

## 19. Real-environment test matrix

**[PROPOSED]** (A–S as specified by **[OWNER]** §30, with the expected
Direct-mode outcome):

| # | Scenario | Expected |
|---|---|---|
| A | Authenticate from a pasted `oc login` | Connects; token never echoed |
| B | List accessible projects | Only the user's own |
| C | Select project | Scope trail updates |
| D | Discover workloads | Deployments/StatefulSets/DaemonSets |
| E | Discover pods | Owned pods only |
| F | Discover containers | Per pod |
| G | One-pod logs | Parsed, masked, ordered |
| H | Multi-replica workload logs | Bounded merge across replicas |
| I | Newest/Oldest | Truthful **within the fetched window** |
| J | Bounded multi-pod merge | Deterministic; truncation visible |
| K | Masking | `cif`/`UserName`/`CustomerId`/`deviceId`/`deviceIp` masked **on the wire** |
| L | Context ±30s | Bounded; incomplete-on-churn stated |
| M | Live/tail | Multi-pod streaming, Pause/Resume/Stop |
| N | Pod termination/replacement | **Sandbox's 12h deletion makes this free** |
| O | Permission denial | Partial results, honest message |
| P | Source switch | No cross-source contamination |
| Q | Stale-response protection | Reuses the UX-R6 generation guard |
| R | Logout / token expiry | Clean re-auth prompt; memory cleared |
| S | Token redaction | Absent from logs, errors, storage, URLs, evidence |

**[PROPOSED]** K, Q, R and S are **security gates**: no slice ships
without them.

---

## 20. Implementation slices

**[PROPOSED]** Bounded, reviewable, each independently mergeable.

| Slice | Scope | Excludes | Tests | Exit criteria | Risk |
|---|---|---|---|---|---|
| **OS-1A** | `oc login` parser; `OpenShiftConnection` session; TLS/CA; connect/disconnect/test endpoints; loopback guard; token redaction; **project discovery** | Any log retrieval; any UI | Layer 1 + 2; every hostile input in §5 | Connect to real sandbox; list real projects; token provably absent everywhere | **Med** — new credential surface |
| **OS-1B** | Workload / pod / container discovery; scope resolution; RBAC/partial-permission semantics | Log retrieval | Layer 1 + 2; `403` paths | Real workloads/pods discovered; denial handled honestly | Low–Med |
| **OS-1C** | **Direct bounded search**: multi-pod fetch, deterministic merge, ordering, bounds, truncation, cancellation; capability model extension | Context, correlation, Live | Layer 1 + 2 + 3 (G–J) | Truthful ordering + visible truncation against real pods | **High** — the core |
| **OS-1D** | Context ±30s; correlation/trace/journey as bounded fan-out | Live | Layers 1–3 (L) | Bounded, honest, incompleteness stated | Med |
| **OS-1E** | Live/tail: multi-pod follow, buffering, reconnect, Stop/Pause/Resume, memory bounds | Pod-watch auto-attach of new pods (**[FUTURE]**) | Layers 1–3 (M, N) | Stable multi-pod stream; clean teardown | **High** — streaming lifecycle |
| **OS-1F** | OpenShift UX (Settings + scope trail + columns) under LERUX-1/LERDESIGN-1; full real-environment evidence | — | Full matrix A–S | Professional UX; evidence captured | Med |
| **OS-1G** | Aggregated provider decision; Loki behind OpenShift **if** real-Loki verification exists | Removing `openshift-loki` | Provider selection + fallback | Owner decision recorded | Med |

**[PROPOSED]** Order: **OS-1A → 1B → 1C → 1D → 1E → 1F**, with **1G
gated on real-Loki access**.

**[EVIDENCE, established by OS-1B, not this assessment]** The OS-1B row
above is now implemented for its stated scope (workload/pod/container
discovery, RBAC/partial-permission semantics via Layer 1+2 evidence) —
see `docs/verification/OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` and
`OWNER_REQUIREMENTS_REGISTER.md` §12c for the full requirement-by-
requirement evidence. "Real workloads/pods discovered" (this table's own
exit criterion) remains real-sandbox evidence, not yet gathered —
`REAL_OPENSHIFT_1B = BLOCKED_CREDENTIALS`, exactly the same honest gap
`REAL_OPENSHIFT_1A` has carried since OS-1A. Two implementation details
worth recording here since they affect §9's "Workload → pod resolution":
resolving pods for one *specific, selected* workload re-reads that
workload's *current* label selector fresh (not cached from discovery);
resolving pods for "All workloads" instead uses each discovered
workload's selector as *captured at discovery time* (Kubernetes enforces
these selectors as immutable after creation, so this is not a staleness
risk) — re-reading every discovered workload's selector individually
would have reintroduced an "N calls per workload" cost for exactly the
case that needs to stay boundedly cheap. Only equality-based
`matchLabels`/`DeploymentConfig`'s flat `spec.selector` are supported —
`matchExpressions` is out of scope for this slice.

**[EVIDENCE, established by the OS-1B review recovery
`OS_1B_REVIEW_RECOVERY_ALL_WORKLOADS_SCOPE`, not this assessment]** A
review found that OS-1B's first cut of "All workloads" pod resolution
used an *unfiltered* namespace-wide pod list — silently widening
"all supported workloads" into "all pods in the namespace" (Job/CronJob/
unsupported-kind/standalone/operator-managed pods included). Fixed to
union each discovered supported workload's own selector-filtered pod
list instead; see `OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` §20. **This
is now the authoritative OS-1C contract**: any future OS-1C design that
consumes OS-1B's scope must treat `PodDiscovery` (the resolved pod set
plus a `COMPLETE`/`PARTIAL` completeness flag) as given, never re-derive
"All workloads" pod scope by its own, looser query.

**[EVIDENCE, established by OS-1C, not this assessment]** OS-1C
implemented direct log search exactly against the "consume, never
re-derive" contract above: `DirectPodLogProvider` reads
`OpenShiftSession#scope()` (OS-1B's resolved `PodDiscovery`/pod list plus
its `podScopeComplete`/`workloadScopeComplete` flags) and never calls any
`OpenShiftScopeService` discovery method itself. See
`OS_1C_OPENSHIFT_DIRECT_SEARCH_REPORT.md` §2 for the test evidence. No
correction to this contract was needed — OS-1C confirmed it rather than
revising it.

**[PROPOSED]** Highest-risk areas, stated plainly: (1) credential intake
and its unauthenticated-local-endpoint assumption; (2) multi-pod merge
ordering and pagination truthfulness; (3) Live stream lifecycle across
pod churn; (4) enterprise proxy behaviour (§17), which is an unverified
assumption that could surprise the estimate.

---

## 21. Release order

**[PROPOSED]** Confirmed as owner-stated, with one qualification:

```
UX-R6 ✅ → OS-A (this) → OS-1A…1F → REL-1 → Final Parity + Hardening → Phase M
```

**[PROPOSED]** The qualification: REL-1 ships a **Windows/macOS desktop
release**. If OpenShift Direct lands first, REL-1's scope grows to include
shipping a credential-handling feature. If the owner would rather release
sooner, **REL-1 before OS-1x** is defensible — the two are independent.
This assessment does not change the order, but flags it as a genuine
owner choice rather than a settled fact.

**[FACT]** REL-1 remains `TRACKED_NOT_STARTED`; Phase M `NOT_STARTED`.

---

## 22. Open decisions the owner must make

1. **Provider visibility** — should Loki remain a separately selectable
   source during OS-1A…1F (recommended: yes, additive), and should it be
   retired afterwards?
2. **Multi-cluster** — remains `OUT_OF_CURRENT_SCOPE`. Confirm, since
   "Add Source → OpenShift" could be read either way.
3. **Insecure TLS** — confirm that `--insecure-skip-tls-verify` is
   **refused**, not honoured (recommended: refuse).
4. **Token persistence** — session-only first (recommended), with
   Credential Manager / Keychain as a later slice.
5. **Sandbox vs real cluster** — sandbox proves correctness; scale bounds
   need a real cluster or explicit deferral.
6. **Release order** — OS-1x before REL-1, or REL-1 first (§21).
