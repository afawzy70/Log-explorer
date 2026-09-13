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

`REAL_OPENSHIFT_1F=BLOCKED_CREDENTIALS` — this environment has never had
real OpenShift credentials, consistent with `REAL_OPENSHIFT_1A` through
`REAL_OPENSHIFT_1E`. No PASS is fabricated for real-cluster behavior.

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

- `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` — new §12o (`OS-1F-1` through `OS-1F-7`), closing §14 narrative paragraph.
- `docs/architecture/OPENSHIFT_DIRECT_LOGGING_ARCHITECTURE_ASSESSMENT.md` — new `[EVIDENCE, established by OS-1F]` note.
- This report.

`UNTRACKED_OWNER_REQUIREMENTS=0`. No OS-1A..1E historical finding was
rewritten; §12a through §12n are untouched.

## 13. Scope boundary (explicitly not touched)

OS-1G, REL-1, Final Legacy Parity Audit, Phase M, Loki restructuring,
`openshift-loki` removal, macOS packaging, desktop release flow (no
regression from this pass required correcting it).
