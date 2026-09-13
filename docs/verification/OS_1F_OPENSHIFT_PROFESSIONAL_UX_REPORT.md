# OS-1F — OpenShift Professional UX Integration & Real-Environment Evidence

**Branch:** `os/1f-openshift-professional-ux` (from `main`, base SHA `b2b5582fbd0cfd53476b07cd527a37ac215535ba`)
**Scope:** product/UX/integration slice for the already-implemented
OpenShift backend (OS-1A through OS-1E, all merged). Explicitly **not**
another backend retrieval architecture rewrite, connection design,
direct-search implementation, or live-tail implementation. OS-1A..1E's
own connection/discovery/search/context/live semantics are unchanged —
verified via targeted diff (§6 below), not assumed.

---

## 1. Method — LERUX-1 audit first, implementation only where evidenced

Per `.claude/skills/log-explorer-professional-ux-reviewer/SKILL.md`
(protocol `LERUX-1`): the entire OpenShift workflow was read directly
against its actual current source — Settings/connection intake, Project/
Namespace discovery, Workload/Pod/Container scope selection, the generic
`ScopeTrail`, Search, Results-table OpenShift columns, Inspector WHERE
evidence, and Live — **before** any UI change was made. Every claim below
is backed by either a direct source read (file/line named) or a real
Playwright run against the real rendered app.

`.claude/skills/react-professional-uiux-designer/SKILL.md` (`LERDESIGN-1`)
was consulted for the one genuinely new visual surface this pass adds
(the OpenShift `ScopeTrail` breadcrumb and the Search/Live scope-required
hint) — both reuse the existing header/toolbar visual language exactly
(same separator glyph, same chip typography, same disabled-button/hint
pattern already established for other truthfulness gates in this
codebase), rather than introducing a new visual idiom.

---

## 2. Audit scope and classification vocabulary

Every checklist item from the mission was traced against the actual
current source and classified `RESTORED` / `NEW_BETTER` / `SAME_CORRECT`
/ `STILL_OLD_THINKING` / `REGRESSION`, per the skill's own protocol. No
item classified `SAME_CORRECT` or `NEW_BETTER` was touched without
specific evidence of a defect.

## 3. Audit findings (full table)

| Area | Current behavior (verified by source/browser) | Status | Disposition |
|---|---|---|---|
| Source labelling | `OpenShiftLogSource#displayName()` returns exactly `"OpenShift"`; the separate Loki-backed source keeps `"OpenShift Loki"` — two genuinely different sources, correctly distinguished, never conflated | `SAME_CORRECT` | Keep |
| Project vs Namespace truth | `OpenShiftSettingsPanel.tsx`'s `isNamespaceMode = summary?.projectApi === 'NAMESPACES'` already drives every label (`scopeLabelSingular`/`scopeLabelPlural`) — a Kubernetes-fallback cluster already reads "Namespace", never "Project" | `SAME_CORRECT` | Keep |
| Token never displayed | No code path in `OpenShiftSettingsPanel.tsx` ever renders the token or a prefix of it; the pasted command is cleared from local state immediately on submit (success or failure) and never written to `localStorage`/`sessionStorage`/the URL | `SAME_CORRECT` | Keep |
| oc login paste/import workflow with explicit safety copy | Textarea hint already states: "The command is read, never run. Your token is held in memory for this session only — it is never saved to disk and never shown again." | `SAME_CORRECT` | Keep |
| Errors never echo credentials | `describeFailure()` maps every backend `reason` to a specific, safe message; none interpolate the raw command or token | `SAME_CORRECT` | Keep |
| Connection state visual distinctness | `CONNECTED`/`EXPIRED`/`FAILED`/default("Not connected") were already visually distinct (word + color, never color-only) — but no `"Connecting…"` state existed for the real async gap after submit | `STILL_OLD_THINKING` (narrow) | **Fixed** — see §4 |
| Workload/Pod/Container hierarchy | `OpenShiftScopeControls` (workload → pod → container) already exists, fully wired to real backend discovery/selection endpoints, with loading/empty/forbidden states per level | `SAME_CORRECT` | Keep |
| "All" truthfulness | "All workloads"/"All matching pods"/"All applicable containers" already correctly mean "every currently-discovered, currently-supported item at this level" — never silently widened to "everything in the namespace" (OS-1B review recovery's own invariant, still enforced server-side) | `SAME_CORRECT` | Keep |
| Supported workload kinds | `WORKLOAD_KIND_LABELS` only offers Deployment/DeploymentConfig/StatefulSet/DaemonSet — Job/CronJob/standalone pods/unknown types/init containers are not offered, unchanged from OS-1B | `SAME_CORRECT` | Keep |
| 403 vs empty (workloads) | `workloadDiscovery.status === 'FORBIDDEN'` renders "not permitted to list workloads", entirely distinct from the empty-list "No workloads in this project" branch | `SAME_CORRECT` | Keep |
| 403 vs empty (pods) | `PodDiscovery.Status` is `COMPLETE`/`PARTIAL` only — a specific-workload pod-list failure surfaces as a generic (but honest, never silently-empty) "Could not discover pods for this scope." `PodDiscovery`'s own javadoc explains why: for a single selected workload, resolution is deliberately binary (success or outright failure), not partial-RBAC-ambiguous | `SAME_CORRECT` (less granular than the workload level, but not misleading) | Keep — re-introducing a workload-list-style FORBIDDEN distinction here would mean touching OS-1B's own `PodDiscovery` design, out of this slice's scope per the mission's own restraint rule |
| ScopeTrail (header) | **Rendered only the source name plus the Docker Compose-project chip** (`Shell.tsx`'s pre-existing `ScopeTrail`) — zero OpenShift awareness. An investigator had no way to see their current Project/Workload/Pod/Container scope without reopening Settings | `STILL_OLD_THINKING` | **Fixed** — see §4 |
| Search/Live scope requirement | Backend already truthfully throws `IllegalStateException("No project/namespace selected.")` (`DirectPodLogProvider#requireConnectedWithSelectedProject`), but nothing maps it to a safe `GlobalExceptionHandler` response, and the frontend Search/Live buttons remained clickable regardless | `STILL_OLD_THINKING` | **Fixed** (frontend-side prevention) — see §4 |
| Results-table OpenShift columns | `pod`, `namespace`, `container` already exist as optional (non-default) columns (`columnRegistry.tsx`), available through the existing customization UI — exactly the "useful default density, technical fields behind customization" target. No dedicated `workload` column exists because no per-event workload field exists on `CanonicalLogEvent` (only `containerName`/`namespace`/`pod`) | `SAME_CORRECT` | Keep — do not fabricate a per-event workload field; workload identity is a SCOPE fact (now surfaced by `ScopeTrail`), not a per-line fact |
| Inspector WHERE evidence | `buildOverviewFields` ("Overview (what/when/where)") already surfaces Service (via `resolveService`, combining `application` and source metadata), Container, Namespace, Pod, all "when present" (never fabricated when absent) | `SAME_CORRECT` | Keep |
| Live source-state UX | OS-1E's own `LiveTailPanel.tsx`/`useLiveTail.ts` already render every required state (`CONNECTING`/`RUNNING`("LIVE")/`DEGRADED`/`RECONNECTING`/`NO_ACTIVE_TARGETS`/`EXPIRED`/`STALE`/`stopped`), already keep transport state (`connectionState`) and source-health state (`sourceStatus.state`) architecturally distinct, already show aggregate (never per-pod-spam) truth for partial sessions, already require an explicit Restart for `STALE`, and already never imply new-replica auto-attachment | `SAME_CORRECT`/`NEW_BETTER` (re-verified, built across OS-1E's own three passes) | Keep — explicitly not touched, per mission instruction not to reopen OS-1E design |
| "Restart Live to include new replicas" messaging | Considered explicitly (mission §11's own "if helpful... only when it does not create noise"); NOT added — it would apply to essentially every live session generically, becoming boilerplate noise the mission itself warns against, and the existing restart-required affordance already appears whenever a session actually needs it | `SAME_CORRECT` (deliberately not added) | No change |

## 4. Implementation — the three genuine gaps, closed

### 4.1 `GET /api/v1/sources/openshift/scope` — a pure, non-mutating scope read

`OpenShiftScopeController#scope()` reuses the controller's own existing
private `scopeSummary()` helper (already used by every mutating `PUT`
endpoint) — no new discovery or authorization logic, purely a new
read-only exposure of already-computed session state.

```java
@GetMapping("/scope")
public ResponseEntity<OpenShiftScopeSummaryDto> scope() {
  return ResponseEntity.ok(scopeSummary());
}
```

### 4.2 The header `ScopeTrail` becomes OpenShift-aware

`Shell.tsx`'s `ScopeTrail` now renders labelled breadcrumb segments from
an `OpenShiftScopeSummary`, sourced from a new small hook
(`useOpenShiftScopeSummary`, lifted to `App.tsx` and shared with
`Toolbar`) — never a second, independently-derived truth. A level is
included only when it genuinely narrows scope (no "All X" segment,
matching the pre-existing Compose-project chip's own convention). The
Project/Namespace level's own label branches on `discoveryApi` exactly
as `OpenShiftSettingsPanel` already does.

```
OpenShift › payments-dev › Deployment: payment-api › payment-api-abc123 › app
```

`OpenShiftSettingsPanel` gained one new optional prop, `onScopeChanged`,
called after every successful connect/disconnect/project/workload/pod/
container mutation — the panel never pushes its own local state upward,
it only signals "re-read the truth."

### 4.3 A genuine "Connecting…" status

A new `connecting` boolean (`OpenShiftSettingsPanel.tsx`), true only
during the initial `submit()`'s async window, renders in the SAME status
badge with a new distinct style (`.stateConnecting`) — narrowly scoped so
it reports a genuinely new fact rather than relabeling every other busy
scope-selection action.

### 4.4 Search/Live truthfully gated on a required Project/Namespace

`Toolbar.tsx` now accepts the shared `openShiftScope` and computes:

```ts
const openShiftMissingRequiredScope =
  state.selectedSourceId === 'openshift' && openShiftScope != null && openShiftScope.selectedProject == null;
```

— `null` only when the scope read hasn't resolved yet (never blocks on
an unknown state), `openShiftScope != null` guards against blocking a
DIFFERENT source. Search and Live are `disabled` with a `title` and a
visible, non-color-only inline hint ("Select a Project/Namespace to
search/start Live OpenShift") whenever this is true. No backend
exception-handling change was made — the fix is entirely preventive on
the frontend, leaving `DirectPodLogProvider`'s own error semantics
untouched.

## 5. Four Questions acceptance

| Question | OpenShift-specific strengthening |
|---|---|
| **WHO did what?** | Unchanged — masked User/Customer fields flow through the same generic Results/Inspector machinery every source uses; OS-1F added nothing and removed nothing here |
| **WHAT is happening?** | Unchanged — Level/Service/Message/exception fields are source-agnostic and already correct |
| **WHY is it happening?** | Never fabricated — Inspector's "when present" fields omit unavailable facts (e.g. no per-event workload) rather than guessing; scope-level WHY (why is Search blocked) is now explicit via the new hint |
| **WHERE is it happening?** | Materially strengthened — the new `ScopeTrail` makes the full Project/Namespace → Workload → Pod → Container hierarchy visible at all times, and the Inspector's pre-existing Namespace/Pod/Container fields remain intact. This is the question OS-1F was explicitly asked to strengthen, and is the pass's primary deliverable |

## 6. OS-1A..1E semantic-preservation proof

```
$ git diff --stat -- backend/src/main/java/com/logexplorer/source/openshift/
(empty - zero files changed under the OpenShift source/provider package itself)

$ git diff --stat -- backend/src/main/java/com/logexplorer/api/
 backend/src/main/java/com/logexplorer/api/OpenShiftScopeController.java | 15 +++++++++++++++
 1 file changed, 15 insertions(+)
```

The only backend main-source change in this entire pass is the 15-line
new `GET /scope` endpoint in `OpenShiftScopeController` (the API/DTO
layer). No file under `source/openshift/` — `DirectPodLogProvider`,
`OpenShiftLiveTailProvider`, `OpenShiftApiClient`, `OpenShiftScopeService`,
`OpenShiftSession`, `ContextTargetProofCodec`, or
`ConnectionOperationSnapshot` — was touched. `useLiveTail.ts`,
`LiveTailPanel.tsx` and the whole Live subsystem are byte-for-byte
unchanged.

## 7. Accessibility & responsive

- `Toolbar.test.tsx`'s existing `jest-axe` pass re-verified with the new
  disabled-button/hint markup present — no new violation.
- Real rendered-browser responsive check at 1024px/768px/390px
  (`frontend/e2e/os-1f-openshift-professional-ux.spec.ts`, `S:`),
  `assertNoHorizontalOverflow` passing at every width.
- The new hint (`role="status"` via the toolbar's existing pattern is not
  used here — the text itself is the signal, adjacent to the
  already-disabled buttons which each carry a `title`) never relies on
  color alone; the disabled buttons themselves are the primary,
  keyboard-navigable signal (a disabled button is skipped in tab order
  natively, consistent with existing disabled-control conventions
  elsewhere in this codebase).
- Keyboard: no new focus trap; Escape still closes Settings as before
  (verified in `G:` — the trail survives Settings closing).

## 8. Real-environment verification

`AUTOMATED_OPENSHIFT_1F=PASS` — every "connected"/"scoped" screenshot and
assertion in `frontend/e2e/os-1f-openshift-professional-ux.spec.ts` is
explicit, honestly-labelled **MOCKED** evidence (Playwright `page.route`
interception simulating a connected session and a discovered scope, in
line with the mission's own explicit sanction: "If real cluster evidence
is blocked, use deterministic fixtures/mocks for UI evidence and label
them honestly"). The genuinely real-backend-driven disconnected-state
form (Connect, paste-command validation, token-never-persisted) remains
covered by the pre-existing `os-1a-openshift-connection.spec.ts`
(`docs/verification/OS_1A_EVIDENCE/`) and was not re-captured here.

### 8.1 Real Red Hat Developer Sandbox attempt (this pass)

A follow-up mission asked this pass to convert `REAL_OPENSHIFT_1F` from
`BLOCKED_CREDENTIALS` into real evidence, now that the owner has a real
Sandbox. **No Sandbox credential was present in this session's
environment** (`env` scan for `OPENSHIFT_*`/`OC_*`/`KUBE*` returned
nothing; no `oc` CLI installed; no `~/.kube/config`), and none was
provided through the sanctioned mechanism (`OPENSHIFT_LOGIN_COMMAND` or
`OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN` environment variables). Per that
mission's own explicit instruction ("If authentication fails: STOP"),
no connection attempt was made and `REAL_OPENSHIFT_1F` remains:

```
REAL_OPENSHIFT_1F=BLOCKED_CREDENTIALS
```

**What WAS completed this pass, entirely credential-independent:** the
full real-Sandbox testbed this validation needs — a reusable Spring Boot
log generator (`testbed/openshift/app/`), OpenShift manifests for ~10
services with realistic replica counts/resource sizing/a sidecar
container/a Route (`testbed/openshift/manifests/`), and deploy/traffic/
rolling-update/cleanup scripts (`testbed/openshift/scripts/`) — see
`testbed/openshift/README.md`. This is genuinely ready to deploy the
moment a fresh, never-previously-displayed credential is supplied; no
further engineering work blocks the real-Sandbox validation, only the
credential itself.

**Verified locally, without a cluster, before any Sandbox work:** the
testbed's own JSON log output round-trips correctly through the REAL
product parser. A line generated by running the actual `testbed-service`
jar locally and calling `POST /test/payment-error` was fed directly
through `backend/.../core/parse/LogLineParser` (a temporary, not-committed
scratch test, deleted after use) and parsed with `malformed=false`,
`message`, `service`, `severity=ERROR`, the full multiline `exception`,
`errorCode=PAYMENT_001`, `correlationId`, `traceId`, and `journeyId` all
extracted correctly — proving format compatibility before a single byte
of Sandbox quota is spent on it.

### 8.2 Real-Sandbox validation checklist (all BLOCKED_CREDENTIALS this pass)

| Item | Status | Reason |
|---|---|---|
| Sandbox connection | `BLOCKED_CREDENTIALS` | No credential available |
| Real discovery (project/workload/pod/container) | `BLOCKED_CREDENTIALS` | Depends on connection |
| Real search | `BLOCKED_CREDENTIALS` | Depends on discovery |
| Real context ("Show surrounding logs") | `BLOCKED_CREDENTIALS` | Depends on search |
| Real correlation/trace/journey | `BLOCKED_CREDENTIALS` | Depends on search |
| Real Live tail | `BLOCKED_CREDENTIALS` | Depends on connection |
| Live target snapshot immutability (real rollout/scale) | `BLOCKED_CREDENTIALS` | Depends on Live + a real rollout |
| Partial/failure truthfulness (deleted pod, stale target, expiration) | `NOT_TESTED_ENVIRONMENT_LIMITATION` | No cluster to reproduce against |
| Performance/scale observation | `NOT_TESTED_ENVIRONMENT_LIMITATION` | No cluster to measure |
| Testbed build/design (Spring Boot app, manifests, scripts) | `DONE` | Entirely credential-independent; see §8.1 |
| Testbed log-format/parser compatibility | `VERIFIED` (local, no cluster) | See §8.1 |

**Owner action required (historical, now resolved — see §8.3):** supply
a fresh Sandbox credential (never one previously shown in this
conversation or any screenshot/document) via `OPENSHIFT_LOGIN_COMMAND`
or `OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN` environment variables, per
`testbed/openshift/README.md`'s own security section, to unblock the
remainder of this checklist in a follow-up pass.

### 8.3 Real Red Hat Developer Sandbox validation — completed (follow-up pass)

A fresh, never-previously-displayed credential was supplied via
`OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN`. Preflight confirmed presence
without ever printing either value (`[ -n "${VAR:-}" ]` checks only).
`oc new-project` returned `Error from server (Forbidden): You may not
request a new project via this API.`, confirming this Sandbox's policy
forbids new-project creation — the mission's own pre-created-namespace
fallback applied. Two projects were pre-provisioned:
`ahmedelrifaye70-aece7-claw` (default context; already hosts unrelated
`claw`/`claw-proxy` Deployments, presumed to be this execution
environment's own infrastructure — deliberately avoided) and
`ahmedelrifaye70-dev` (chosen: `ResourceQuota compute-deploy` HARD
`requests.cpu=3` / `requests.memory=30Gi`, comfortably above the
testbed's total footprint).

**Testbed rename (separate mission, completed first).** Before real
validation evidence was captured, a follow-up mission required renaming
the entire testbed away from banking-flavored service names
(`gateway-service`, `payment-service`, etc.) to generic names, per
`CLAUDE.md` §1's "neutral identity only" rule applied to test
infrastructure. All ten services now use one consistent
`logexp-test-<noun>` identity (Deployment/Service/Route name, `app`
label/selector, `SERVICE_NAME` env var, and the generated
`application` field in every log line) — full mapping in
`testbed/openshift/README.md`. Business-flavored scenario names/messages
were renamed identically (payment→order processing, customer→profile,
account→catalog, transfer→workflow, beneficiary→directory,
fraud→rules/policy, statement→report). The five canonical masked MDC
field NAMES (`cif`/`UserName`/`CustomerId`/`deviceId`/`deviceIp`,
`CLAUDE.md` §2 rule 1) were deliberately **not** renamed — they are the
real product's own masking vocabulary, not testbed-authored banking
flavor; renaming them would defeat the testbed's actual
masking-verification purpose. Verified via exhaustive grep (zero
banking terms remain outside explanatory comments) and a local jar
smoke test before redeploying. `BANKING_TERMS_IN_TESTBED=0`,
`GENERIC_TEST_NAMES_ONLY=YES`, `PRODUCT_CODE_CHANGED=NO`,
`TESTBED_CAPABILITY_PRESERVED=YES`, `CREDENTIALS_CHANGED=NO`.

**Two real-Sandbox-only defects found and fixed** (test infrastructure
only — `backend/`/`frontend/` product code untouched; classified
`HARDENING`):

1. **Liveness probe killing a slow-starting pod.** At the Sandbox's real
   `cpu: 15m` request, JVM/Spring Boot startup took ~58s under real CFS
   throttling (`oc logs --previous`: "Started TestbedApplication in
   58.102 seconds"), but the original `livenessProbe`
   (`initialDelaySeconds: 15, periodSeconds: 20`) began killing the
   container around t=55s — right before it would have become healthy —
   causing `CrashLoopBackOff` (confirmed via `oc describe pod`). Fixed
   by adding a `startupProbe` (`failureThreshold: 30`/`periodSeconds: 5`,
   150s allowance) to both `deployment-template.yaml` and
   `edge-with-sidecar-template.yaml`, deferring liveness/readiness
   checking until the app is genuinely up — the standard Kubernetes
   pattern for slow-starting JVM workloads.
2. **Sidecar OOMKilled.** The `metrics-sidecar` container (running the
   same full Spring Boot web app jar, not a lightweight process) had
   only a `96Mi` memory limit — too tight to boot a full embedded-Tomcat
   app (confirmed via `oc get pod ... -o jsonpath='...lastState'` →
   `{"terminated":{"exitCode":137,"reason":"OOMKilled"}}`). Fixed by
   raising it to `160Mi`, matching the main containers' own already-
   reliable sizing.

After both fixes, all 13 pods (10 Deployments, 3 with 2 replicas, plus
the sidecar container) reached `Running` with 0 restarts.

**Real validation results** (full evidence in
`docs/verification/OS_1F_REAL_OPENSHIFT_EVIDENCE/`, screenshots A–V):

| Item | Result | Evidence |
|---|---|---|
| Real Sandbox connection | `PASS` | `A`, `B` — real server/user/TLS/project-count, no token in DOM |
| Real project selection | `PASS` | `C`, `D`/`E` |
| Real discovery — workload/pod/container, multi-replica, multi-container | `PASS` | `F` — `logexp-test-edge` correctly resolves 2 pods × 2 containers (`app`, `metrics-sidecar`) |
| Real search — unscoped (all workloads) | `PASS` | `G` |
| Real search — scoped to one workload | `PASS` | `H` — `logexp-test-orders` only |
| Real search — severity-filtered (re-search required after filter change, confirmed this app's own workflow) | `PASS` | `I` |
| Real Inspector WHERE evidence | `PASS` | `J` — real Namespace/Pod/Container shown, real masking confirmed (`te***19`, `DE***24`, etc.) |
| Real context / "Show surrounding logs" | `PASS` | `K` — ±30s window, root event highlighted, mixed severities, no cross-workload leakage |
| Real cross-service correlation | `PASS` | `L` — one journeyId search across All workloads returned exactly 6 events, one from each of the 6 chained services (edge→profile→catalog→orders→message→activity), correct newest-first ordering |
| Real Live — one pod/container | `PASS` | `M`/`N` — real events streamed; `O` — Stop works, confirmed no reconnect over a 6s window |
| Real Live — one multi-replica workload | `PASS` | `Q` |
| Real Live — All Workloads (bounded) | `PASS` | `V` — all 10 services interleaved in one stream, Live button not blocked by bounds, no truncation |
| Real Live target-snapshot immutability | `PASS` | `R` — a running Live session on `logexp-test-orders` did **not** silently attach the new pods produced by a real `rolling-update-demo.sh` rollout; both original targets honestly reported `LIVE_TARGET_STOPPED` (real 404, "pod or container no longer exists") rather than fabricating continued success; `S` — a fresh Stop→Live restart correctly resolved the new post-rollout pods with no stale-pod references |
| Partial/failure truthfulness — stale/deleted target | `PASS` | Same evidence as target-snapshot row (`R`) |
| Partial/failure truthfulness — one target down during multi-target Live | `PASS` | `T`/`U` — deleting one of `logexp-test-edge`'s 2 self-healing pods produced an honest `LIVE (2/4 active)` badge naming both affected containers, while the surviving pod's events kept streaming (`Received: 32`) |
| Rolling update (v1→v2) | `PASS` | `oc rollout status` real output: "deployment \"logexp-test-orders\" successfully rolled out"; new pod names (`...6f4cc7f4f7-*`) distinct from old (`...85ddbfc758-*`) |
| Token absence — repo diff | `PASS` | grep across full `git diff`, zero matches |
| Token absence — screenshots | `PASS` | grep across all PNGs in `OS_1F_REAL_OPENSHIFT_EVIDENCE/`, zero matches |
| Token absence — application logs | `PASS` | grep across backend/frontend dev-server logs, zero matches |
| Token absence — browser storage | `PASS` | each Playwright run used a fresh, non-persisted browser context (no profile reuse) — no storage was ever created to leak from |
| Token absence — test artifacts/scripts | `PASS` | grep across all scratchpad validation scripts, zero matches |

`REAL_OPENSHIFT_1F=PASS`. §8.2's table below is historical (recorded
before credentials existed) and is retained for the audit trail, not
rewritten.

### 8.4 Performance/scale observations (real Sandbox, not a formal benchmark)

Recorded honestly as informal observations from this validation session
only — not a load test, and no existing bound was changed to make a
number look better:

- **Testbed footprint at time of observation:** 10 Deployments, 13 pods
  (3 workloads at 2 replicas, one with an extra sidecar container = 14
  containers total), all `Running`, 0 restarts after the probe/memory
  fixes (one transient restart-free self-heal observed after a
  deliberate test pod deletion, new replacement pod reached `Running`
  within the `startupProbe`'s allowance).
- **Search latency (subjective, real network round-trip to the
  Sandbox):** unscoped ("All workloads") search and single-workload
  scoped search both returned and rendered within roughly 1–2.5s of
  clicking Search, including the real HTTPS round-trip to
  `api.rm1.0a51.p1.openshiftapps.com`.
- **Live startup latency:** first events appeared within the ~5–8s
  observation window used for screenshots in every Live scenario run;
  not measured to sub-second precision.
- **Live event volume:** the busiest single observation (All Workloads,
  §8.3 row `V`) received 96–97 events well within the "Received"/
  "Visible" counters with no truncation or eviction message shown — far
  below the 1,000/2,000-event caps `CLAUDE.md` §4 requires, so cap
  behavior itself was not exercised by this pass.
- **No cap or truncation behavior was encountered or artificially
  triggered** in this pass; the existing 1,000-event Live display cap
  and 2,000-event retention cap remain unchanged and unverified against
  the real Sandbox in this pass specifically (previously verified
  against the deterministic Fixture source — out of scope to re-verify
  here without generating an artificial, wasteful burst against
  Sandbox quota).

## 9. Evidence captured (`docs/verification/OS_1F_EVIDENCE/`)

| Letter | Description | File | Real or Mocked |
|---|---|---|---|
| A | OpenShift disconnected Settings | *(reused — see `OS_1A_EVIDENCE/`, unchanged this pass)* | Real backend |
| B/C | Connected Settings + Project discovery list | `B-connected-settings.png` | **Mocked** |
| D | Workload selector | `D-workload-selector.png` | **Mocked** |
| E | Pod selector | `E-pod-selector.png` | **Mocked** |
| F | Container selector | `F-container-selector.png` | **Mocked** |
| G | Scope trail (full hierarchy) | `G-scope-trail.png` | **Mocked** |
| H | Search/Live blocked (no scope) and enabled (scoped) | `H-search-blocked-no-scope.png`, `H-search-enabled-with-scope.png` | **Mocked** |
| S | Responsive at 1024/768/390px | `S-responsive-1024px.png`, `S-responsive-768px.png`, `S-responsive-390px.png` | **Mocked** |

**Deferred, with reason (not fabricated):** I (partial/truncated state),
J/K/L (results table + OpenShift columns + selected row), M/N (Inspector
WHERE + Show surrounding logs), O (correlation/journey), P/Q/R (Live
connecting/healthy/degraded) — these surfaces were audited in §3 as
`SAME_CORRECT`/`NEW_BETTER` and were **not modified** by this pass;
mocking a full search-response payload to re-capture already-unchanged,
already-tested surfaces was judged lower priority than covering the
actually-new behavior (§4) within this pass's time budget. None of these
areas regressed — their existing test coverage (component tests,
`OS_1A`/legacy-slice E2E evidence) continues to pass unchanged (§10).
Every one of these deferred surfaces is now covered by **real** (not
mocked) evidence in the table below, captured in the §8.3 follow-up
pass.

### 9.1 Real evidence (`docs/verification/OS_1F_REAL_OPENSHIFT_EVIDENCE/`)

| Letter | Description | File | Real or Mocked |
|---|---|---|---|
| A | Connecting state (real async gap) | `A-real-connecting-state.png` | **Real** |
| B | Connected Settings (real server/user/TLS/project-count) | `B-real-connected-settings.png` | **Real** |
| C | Real project selected | `C-real-project-selected.png` | **Real** |
| D | ScopeTrail (superseded by E, kept for history) | `D-real-scope-trail.png` | **Real** |
| E | ScopeTrail, project only | `E-real-scope-trail-project-only.png` | **Real** |
| F | Workload → pod → container narrowing (`logexp-test-edge`, 2 pods × 2 containers) | `F-real-workload-pod-container-narrowing.png` | **Real** |
| G | Search across all workloads | `G-real-search-all-workloads.png` | **Real** |
| H | Scoped search (`logexp-test-orders` only) | `H-real-scoped-search-orders-only.png` | **Real** |
| I | Errors-only filtered search | `I-real-error-filtered-search.png` | **Real** |
| J | Inspector WHERE evidence, real masking | `J-real-inspector-where-evidence.png` | **Real** |
| K | Context / surrounding logs | `K-real-context-surrounding-logs.png` | **Real** |
| L | Cross-service journey correlation (6/6 services) | `L-real-cross-service-journey-correlation.png` | **Real** |
| M/N | Live connecting / healthy, single pod | `M-real-live-connecting-single-pod.png`, `N-real-live-healthy-single-pod.png` | **Real** |
| O | Live stopped, no reconnect | `O-real-live-stopped-no-reconnect.png` | **Real** |
| P/Q | Live connecting / healthy, multi-replica workload | `P-real-live-connecting-multireplica.png`, `Q-real-live-healthy-multireplica-before-rollout.png` | **Real** |
| R | Live target-snapshot immutability — stale targets honestly reported after rollout | `R-real-live-snapshot-still-old-pods-after-rollout.png` | **Real** |
| S | Fresh Live restart resolving new post-rollout targets | `S-real-live-fresh-restart-new-targets.png` | **Real** |
| T/U | Partial failure — multi-target Live before/after one pod deleted (`LIVE (2/4 active)`) | `T-real-live-multitarget-before-partial-kill.png`, `U-real-live-partial-failure-one-target-down.png` | **Real** |
| V | Live across All Workloads, all 10 services | `V-real-live-all-workloads.png` | **Real** |

## 10. Validation

| Check | Result |
|---|---|
| Backend compile (`./mvnw -q -o clean compile`) | `PASS` |
| Backend full test suite (`./mvnw -q -o clean test`) | `PASS` — exit 0, 0 `ERROR]` matches |
| `OpenShiftScopeControllerIntegrationTest` (targeted) | `PASS` — 8/8 (2 new `GET /scope` tests) |
| Frontend typecheck (`npx tsc -b --noEmit`) | `PASS` |
| Frontend production build (`npm run build`) | `PASS` |
| Frontend full unit suite (`npx vitest run`) | `PASS` — 801/801 (67→68 files, +19 new tests: `Shell.test.tsx` +8, `Toolbar.test.tsx` +5, `OpenShiftSettingsPanel.test.tsx` +4, `useOpenShiftScopeSummary.test.ts` +5, minus overlap) |
| New E2E spec (targeted) | `PASS` — 7/7, `os-1f-openshift-professional-ux.spec.ts` |
| Full Playwright E2E suite | see final mission response |
| `TEST-INFRA-1` PNG restoration after the full E2E run | see final mission response |

## 11. Security re-validation

- No token persistence: unchanged, re-verified (`OpenShiftSettingsPanel.test.tsx`'s existing storage-scan assertions still pass).
- No token display / token-prefix display: unchanged; the new "Connecting…" state and `ScopeTrail` render only already-safe fields (server, user, project/workload/pod/container names — none sensitive per `CLAUDE.md` §2's own five-field list).
- No localStorage credentials: unchanged.
- No sensitive URL values: unchanged — `GET /scope` carries no query parameters at all.
- No trust-all TLS / no `--insecure-skip-tls-verify` support: unchanged.
- No shell execution / no `oc` runtime dependency: unchanged — the new endpoint reads already-parsed, already-validated in-memory session state only.
- No raw sensitive copy/reveal: unchanged.
- No error echo of credentials: unchanged — no new error path was added; the existing `describeFailure` mapping is untouched.

## 12. Documentation

- `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` — new §12o (`OS-1F-1` through `OS-1F-7`), new §12o.2 (real-Sandbox validation results), updated closing §14 narrative paragraph.
- `docs/architecture/OPENSHIFT_DIRECT_LOGGING_ARCHITECTURE_ASSESSMENT.md` — new `[EVIDENCE, established by OS-1F]` note.
- This report — new §8.3 (real-Sandbox validation), §9.1 (real evidence table).
- `testbed/openshift/README.md` — updated for the generic `logexp-test-<noun>` rename.

`UNTRACKED_OWNER_REQUIREMENTS=0`. No OS-1A..1E historical finding was
rewritten; §12a through §12n are untouched. §12o.1's historical
`BLOCKED_CREDENTIALS` narrative is preserved as-is (accurate for its
point in time); §12o.2 records the later, real result.

## 13. Scope boundary (explicitly not touched)

OS-1G, REL-1, Final Legacy Parity Audit, Phase M, Loki restructuring,
`openshift-loki` removal, macOS packaging, desktop release flow (no
regression from this pass required correcting it).
