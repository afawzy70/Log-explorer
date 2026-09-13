# Final Functional Closure Report

**Mission:** MERGE_PCFR2_AND_RESUME_FINAL_FUNCTIONAL_CLOSURE, Stage 5–9.
This is the **first real execution** of Final Functional Closure — a
repo-wide grep confirmed it had been referenced repeatedly as
"still-pending"/"paused" across the UX-R, Legacy Remediation, OS-1x, and
PCFR missions, but no closure audit or report had ever actually been
produced. There is no prior partial closure state to resume from; the
underlying product features themselves are already built and extensively
tested — this report's job is to compile, cross-check, and formally close
the loop on all of that work, not to re-do it.

**Distinct from, and never confused with:** the historical "Phase M —
Final acceptance" (`IMPLEMENTATION_PLAN.md` §"Phase M", `docs/verification/PHASE_M_REPORT.md`)
was a real, separate, already-completed milestone for the ORIGINAL MVP
scaffolding requirements (`REQUIREMENTS_TRACEABILITY.md`, Handover §34) —
it predates the UX restoration, Legacy Remediation, OS-1x, and PCFR work
entirely. Final Functional Closure is a newer, broader gate over
everything decided since, and is not itself a feature phase.

---

## 1. Stage 1–2 — PR #51 merge evidence

Pre-merge safety check, performed against live GitHub state (not
assumed):

```
PR_51_STATE=OPEN
PR_51_MERGEABLE=MERGEABLE
PR_51_HEAD=939cc05167900607f78869b162d530ee73316063  (matched exactly)
PR_51_BASE=main
CI=PASS, Frontend=PASS, Backend=PASS, E2E=PASS,
  Windows desktop=PASS, macOS desktop=PASS  (gh pr checks 51)
Review threads: none (reviewDecision empty, 0 reviews, 0 comments)
Branch protection: none configured (gh api .../branches/main/protection → 404)
```

Merged via `gh pr merge 51 --squash --match-head-commit 939cc05...` — the
established repository method (confirmed by inspecting the last 5 merged
PRs: every one is a single-parent commit, i.e. squash-merged, never a
2-parent merge commit; `git log --merges` on `main` returns nothing).
`--match-head-commit` pinned the merge to the exact reviewed SHA, so a
newer unreviewed push could not have been silently merged instead.

```
PR_51_MERGED=YES  (gh pr view 51 --json state,mergedAt,mergeCommit → "MERGED")
MERGE_SHA=01f53cd71dc00b6a7b8221175cd485d5661aa5d3
MAIN_HEAD_AFTER_MERGE=01f53cd71dc00b6a7b8221175cd485d5661aa5d3
```

---

## 2. Stage 3 — post-merge synchronization

`git fetch origin` + `git checkout main` + `git pull origin main --ff-only`
— fast-forwarded `3fcf9ea..01f53cd`, no conflicts, no rebase. Verified
`git rev-parse HEAD` == `git rev-parse origin/main` ==
`01f53cd71dc00b6a7b8221175cd485d5661aa5d3`, `git status --porcelain`
empty.

**Stale runtime, found and stopped (not reused):** the dev backend
process running since the PCFR2 mission (PID 322509/322672) was still
serving code compiled *before* this merge. Per this mission's own
explicit warning (PCFR2 already found this exact class of defect once),
it was stopped (`kill`, confirmed dead via a fresh `ps aux` — not assumed
from the kill command's own exit status) and a fresh backend was built
(`./mvnw package -DskipTests`) and started from the just-merged `main`
tree. Confirmed fresh, not stale, by calling the two endpoints this
merge actually added (`GET /api/v1/sources/openshift/proxy` → `200`,
`GET /api/v1/settings/masking` → `200`) — a stale pre-merge backend would
404 on both, exactly as it did the first time this defect was caught
during PCFR2.

```
POST_MERGE_MAIN_CLEAN=YES
STALE_TEST_RUNTIME_REUSED=NO
```

---

## 3. Stage 4 — post-merge regression gate

All run against the fresh post-merge backend/frontend, on `main` at
`01f53cd`:

| Check | Result |
|---|---|
| Backend (`./mvnw -o test`) | **1078/1078 pass, 0 failures, 0 errors** |
| Frontend (`npx vitest run`) | **871/871 pass** |
| Typecheck (`npx tsc --noEmit -p .`) | clean |
| Frontend production build (`npm run build`) | succeeds |
| Backend production build (`./mvnw package -DskipTests`) | succeeds, `target/log-explorer-backend-0.1.0-SNAPSHOT.jar` produced |
| E2E (`npx playwright test`, full suite) | **306/306 pass, 1 deliberately skipped** (the same `NOT_AVAILABLE`-marked real-enterprise-proxy test PCFR2 already named) |
| Targeted security tests (`SerializationLeakTest`, `LogLeakTest`, `MaskingServiceTest`, `MaskingSettingsControllerIntegrationTest`, `OpenShiftApiClientTest`, `LokiTokenLeakTest`, `ArchitectureTest`) | **70/70 pass**, including the ArchUnit `onlyMaskingServiceMayTouchRawSensitiveFields` rule |
| Targeted frontend security tests (`PrivacyMaskingSettingsPanel.test.tsx`, `OpenShiftSettingsPanel.test.tsx`, `app/persistence.test.tsx`) | **55/55 pass** |

**Environment inspection discipline:** no broad environment dump was run
this pass. `OPENSHIFT_TOKEN`/`OPENSHIFT_API_SERVER` (present in this
session's environment from earlier real-Sandbox verification work) were
never queried or printed at any point in this mission.

**Historical evidence PNG mutation (TEST-INFRA-1, again):** as expected
given the still-open, named defect, both E2E runs this pass (a targeted
run and the full-suite run) mutated 198 tracked `docs/verification/*.png`
files in place. Both times caught and reverted via `git checkout --
<files>` before proceeding — confirmed via `git status --porcelain`
showing zero `.png` diffs before any commit. See §6.K for the formal
disposition.

### 3.1 Specific merged-behavior re-verification (mission's own explicit checklist)

**Inspector** — `frontend/src/features/inspector/EventInspector.test.tsx`
("primary tabs are structurally fixed" `describe` block) and
`frontend/e2e/pre-closure-functional-recovery-2.spec.ts`, both re-run
green post-merge:

```
OVERVIEW_TAB_ALWAYS_PRESENT=YES
ACTOR_CLIENT_TAB_ALWAYS_PRESENT=YES
REQUEST_FLOW_TAB_ALWAYS_PRESENT=YES
BUSINESS_ERROR_TAB_ALWAYS_PRESENT=YES
TECHNICAL_ALL_FIELDS_TAB_ALWAYS_PRESENT=YES
EMPTY_ACTOR_STATE_VISIBLE=YES
EMPTY_REQUEST_FLOW_STATE_VISIBLE=YES
EMPTY_BUSINESS_ERROR_STATE_VISIBLE=YES
```

No conditional tab removal exists anywhere in `EventInspector.tsx`'s
`tabs` computation (a fixed five-entry array — re-read directly from the
post-merge `main` source, not assumed).

**Masking:**

```
MASKING_SCOPE=GLOBAL_SOURCE_INDEPENDENT
MASKING_DEFAULT=MASKED
MASKING_SERVER_SIDE_ONLY=YES
MASKING_DOCKER_COVERAGE=YES
MASKING_OPENSHIFT_COVERAGE=YES
```

Five fields (CIF/Username/CustomerId/DeviceId/DeviceIp), no per-row
reveal (`PrivacyMaskingSettingsPanel.test.tsx` "no reveal/unmask button"
test, re-run green), no raw-value browser cache (same panel applies only
the server-returned policy).

**Proxy:**

```
PROXY_MODE_SYSTEM=YES
PROXY_MODE_DIRECT=YES
PROXY_MODE_CUSTOM=YES
CUSTOM_PROXY_HOST_CONFIGURABLE=YES
CUSTOM_PROXY_PORT_CONFIGURABLE=YES
OPENSHIFT_API_PROXY_COVERAGE=YES
OPENSHIFT_LOKI_PROXY_COVERAGE=YES
SYSTEM_ENV_PROXY_PRESERVED=YES
NO_PROXY_PRESERVED=YES
DIRECT_BYPASS_VERIFIED=YES
CUSTOM_PROXY_ENV_INDEPENDENT=YES
```

Re-run green: `OpenShiftApiClientTest`, `LokiWebClientFactoryTest`,
`ProxyRouteTest`, `OpenShiftProxyConfigServiceTest`,
`OpenShiftProxySettingsControllerIntegrationTest`,
`OpenShiftSettingsPanel.test.tsx`'s proxy `describe` block.

**Security:**

```
TLS_VERIFICATION_UNCHANGED=YES
TRUST_ALL_TLS=NO
TOKEN_LEAKAGE=NO
PROXY_SECRET_LEAKAGE=NO
SENSITIVE_DATA_LOCALSTORAGE=NO
SENSITIVE_DATA_URL=NO
RAW_VALUE_LOGGING=NO
```

---

## 4. Stage 5 — Final Functional Closure audit (objectives 1–10)

Compiled from a full, dedicated read of `docs/governance/OWNER_REQUIREMENTS_REGISTER.md`
(1800+ lines), `REQUIREMENTS_TRACEABILITY.md`, `docs/SECURITY_NOTES.md`,
`OS_1G_AGGREGATED_PROVIDER_DECISION_REPORT.md`, and both PCFR reports —
every claim below cites the specific row/test/report it comes from.
Historical `APPROVED_PENDING`/`OPEN_UNDECIDED` status TEXT still visible
in the register for several rows in this section is stale (the
capability was implemented and independently `VERIFIED` by a later,
more granular row) — see §6.K for the full reconciliation, which this
section already applies.

### 4.1 Source connectivity

- **Docker (local):** read-only 5-op facade (`ReadOnlyDockerClientMethodSetTest`), Compose label discovery, stream framing incl. tty, Compose project request/session-scoped isolation (two-project overlapping-service-name proof) — `IMPLEMENTATION_VERIFIED`.
- **Remote Docker:** default port 2375 prefilled, custom port, TLS optional never-trust-all, SSRF/DNS-rebinding guard (`RemoteHostGuard`) — `IMPLEMENTATION_VERIFIED`.
- **OpenShift Direct:** connection/discovery/search/context/correlation/Live all `VERIFIED` per-slice. **`REAL_OPENSHIFT_1F=PASS`** — a real Red Hat Developer Sandbox run validated connection, multi-replica/multi-container discovery, search, context, cross-service correlation, Live (single/multi-replica/all-workloads/target-snapshot-immutability/partial-failure honesty), rolling update, and zero token leakage (register §12o.1). Proxy: System/Direct/Custom, `Kind.PROXY` classification, shared config with Loki — `VERIFIED` (PCFR-6, PCFR2-2/3). TLS always-on, private-CA support, `--insecure-skip-tls-verify` refused.
- **OpenShift Loki:** adapter `VERIFIED`; proxy support added this session (PCFR-7). **`REAL_LOKI=EXTERNAL_VALIDATION_NOT_AVAILABLE`** — no Loki route/service/env vars found in either real Sandbox namespace checked (OS-1G-2) — an honestly-reported infrastructure gap, not a defect. Loki-as-aggregated-provider consolidation (`OS-12`) remains `OPEN_UNDECIDED`/`EXTERNAL_VALIDATION_NOT_AVAILABLE`, deliberately gated on that same missing evidence.
- **Real enterprise proxy:** `Kind.PROXY`/`Reason.PROXY` classification proven via a real deliberately-broken proxy against a real live fake server (`IMPLEMENTATION_VERIFIED`); a real corporate-proxy round trip is `EXTERNAL_VALIDATION_NOT_AVAILABLE` (no such proxy/credentials exist in this environment).

### 4.2 Log parsing and data preservation

All `Done` per `REQUIREMENTS_TRACEABILITY.md` #12–18, re-confirmed via
the still-green `LogLineParserTest`: canonical top-level field mapping,
all MDC fields, the literal dotted key `event.correlationId` (never
mistaken for a nested path), correlation precedence, unknown JSON/MDC
fields preserved (never discarded), malformed lines become raw fallback
events (never silently dropped), timestamp normalization (`timestampRaw`
always kept, no double conversion), empty `message` preserved with a
display fallback, multiline/escaped-newline exceptions stay one logical
event. No valid log event silently disappears for a missing known
field — structurally guaranteed by the parser's own fallback path, not
merely untested.

### 4.3 Search

Time range (presets incl. Last 1 day, custom popover, zone
display/conversion, 4-class validation), service multi-select, severity,
universal text search with ID auto-detection, advanced filters grouped
by question, trace/correlation/journey/event ID/error code/business
step, the guided Query builder (closed AST, no eval/SpEL/reflection), raw
LogQL (Loki-only, config-gated, bounded) — all `Done`/`VERIFIED`
(`REQUIREMENTS_TRACEABILITY.md` #29–47, #69–72). Filter functional truth
specifically re-closed by `UX_R2_FILTER_AND_SEARCH_FUNCTIONAL_REPORT.md`
(all 11 remaining fields, real inclusion/exclusion counts against the
real Fixture backend) — register §6 updated this pass from an ambiguous
`IN_PROGRESS → see report` to a direct `VERIFIED`. No new search feature
added this closure pass, per the mission's own explicit instruction.

### 4.4 Results table

Seven columns exact order, `—` for missing (never omitted), one
`<table>`/`<colgroup>`/fixed layout, Actions as the row's 7th cell,
newest-first no duplicates, one pagination model, truthful counts, ≤2px
header/cell geometry at 6 viewports + zoom — all `Done`. **Column-level
sorting** (first click ascending, second descending, non-color
indicator, deterministic — PCFR-4), **Newest/Oldest alias** (the Time
column header click aliases the exact same `sortDirection` state, never
a second competing sort state), **column drag-and-drop** (priority 1)
**+ keyboard Move up/down** (priority 2/3, unchanged) **+ Reset to
default** (PCFR-5), **table-state consistency** (reorder never resets
sort, density never resets columns/order/sort/selection — structural by
construction, re-verified by the combined `results/` test suite) —
`VERIFIED`. Bounded collections: `VISIBLE_CAP`/live buffers. In-flight
search cancellation is `Partial` by original design — implemented as
request-supersession/`AbortController` protection rather than a separate
visible "cancelled" UI state, an explicitly named scope boundary (Phase
G report), not a gap this closure pass found new.

### 4.5 Event Inspector

Five primary tabs (Overview, Actor & client, Request flow, Business /
error, Technical / all fields) **structurally fixed, always present**
(PCFR2-1) — re-verified post-merge (§3.1). A missing category produces
its own specific, honest empty-state message
(`no actor or client data on this event`, `no journey, correlation,
trace, span, or event id on this event`, `no business step, ui
identifier, error code, or exception on this event`) — never fabricated,
never hidden. Unknown/custom fields retained and reachable via Technical
/ all fields (`AllFieldsSection`, unchanged). No `dangerouslySetInnerHTML`
anywhere in the codebase (grep-verified, zero matches). WAI-ARIA tabs
(`role="tablist"/"tab"/"tabpanel"`, roving tabindex, Left/Right/Home/End)
unchanged from PCFR-1, only the tab-visibility rule changed. Previous/Next
+ position indicator (`UX-12`). Overview resets to active on every new
event selection — still the owner-authoritative behavior, unchanged, and
still tested (`EventInspector.test.tsx`).

### 4.6 Investigation capabilities

Trace/correlation/journey investigation (`Done`); the
timestamp-order-≠-causality disclaimer is always shown, never a fabricated
relationship. **Surrounding logs**: the root/selected event is marked
with a visible `.contextRootRow` class + `aria-current="location"` + a
visually-hidden label (never color-only) **and now auto-scrolled into
view** on open (PCFR-8) — re-verified post-merge. Narrow
same-execution-context scoping is proven directly (`OS-1D §9`'s
sibling-container-in-the-same-pod and same-pod-name-different-namespace
disambiguation tests — a repeated message+timestamp from a neighboring
container/namespace is never mistaken for the root). Context stays
structurally distinct from Correlation/Journey — the context view is
`sortable={false}`, its own true chronological order independent of the
global Newest/Oldest setting. Partial-result honesty: `counts.truncated`,
Live's own honest `LIVE (2/4 active)` badge when some targets are
unreachable (real Sandbox evidence, OS-1F).

### 4.7 Live logs

Start/pause/resume/stop/exit, unmount closes the stream (`Done`). SSE
transport, no token/sensitive-filter value ever in the URL. Docker
upstream cancellation on disconnect. Loki live capability honestly
gated `false` (not a fake capability — `LokiLogSource.capabilities()`'s
own doc comment explains why). Bounded backend buffer + heartbeat +
timeout + concurrent-tail cap; bounded frontend buffer with a 1,000-event
visible cap; dropped/buffered counts shown distinctly, never silently
absorbed. Real-cluster Live evidence (OS-1F): multi-replica, all-workloads,
target-snapshot immutability, partial-failure honesty, rolling-update —
all `PASS`.

**Known Live flakiness, accounted for honestly, not ignored:** two
Live-reconnect-timing E2E tests flaked once during PCFR2's mid-session
run under full parallel load. Per the mission's own instruction ("if a
flaky test fails once: investigate rather than automatically ignoring,
rerun targeted, classify genuine regression vs known timing flake with
evidence"), both were re-run in isolation immediately and passed cleanly,
and both then passed cleanly again in *two full-suite reruns this
mission alone* (the PCFR2 post-push run and this closure's own post-merge
run) — zero repeats. Classified as timing-sensitive-under-full-parallel-load,
not a regression, on direct evidence, not assumption. Neither test was
disabled, skipped, or weakened.

**A real, narrow accessibility-verification gap found and closed by this
closure pass** (not a pre-existing defect in the product, a gap in
*evidence*): register rows DEC-C/§5 "Live to Search" both explicitly
named "keyboard-accessibility re-verification against real rendered
evidence" as the one thing still pending, going back to UX-R3. The
underlying "← Back to search results" control was already a real,
native `<button>` (keyboard-operable by the browser itself, not custom
JS) and already had a real mouse-click E2E test — but nobody had actually
driven it by keyboard alone in a real browser and captured that as
evidence. Closed this pass: `frontend/e2e/phase-j-live-tail.spec.ts`,
new test `"Back to search results" is reachable and activatable by
keyboard alone (DEC-C closure)` — `.focus()` + `Enter` (no click)
against the real running app, confirms focus lands on the button, Enter
activates it, the Live panel closes, and Search is restored and usable.
Passed on first real run. Register rows DEC-C and §5 updated from
`IN_PROGRESS` to `VERIFIED` with this new evidence cited.

### 4.8 Masking/privacy

Global, source-independent, per-field configurable, masked-by-default
(PCFR-2/PCFR-3) — the five fields (CIF/Username/CustomerId/DeviceId/
DeviceIp) are the only currently-configurable set; no expansion to
arbitrary dynamic fields, per this closure's own explicit scope
boundary. Unmasking a field applies only to **new** backend responses
going forward — never reconstructs an already-fetched, already-masked
browser value (no client-side cache exists to reconstruct from).
Docker/OpenShift/Loki/Fixture all route through the identical
`EventMapper`/`MaskingService` boundary — no source has its own masking
path. Server-side enforcement re-confirmed by the still-passing ArchUnit
rule `onlyMaskingServiceMayTouchRawSensitiveFields`.

### 4.9 Desktop (Windows/macOS)

REL-1: `IMPLEMENTED_VERIFIED`, real `windows-latest`/`macos-latest` CI —
real installer/DMG, full install→launch→health→UI→API→shutdown→uninstall
lifecycle. `v0.1.0` release: publisher/author metadata verified on real
runners, exact version `0.1.0`, packaged smoke `PASS` both platforms,
secrets-in-artifact sweep clean. **This session's own fresh evidence**:
PR #51's Windows-desktop and macOS-desktop CI checks passed on both the
PCFR1 push and the PCFR2 push, independently, each a real build+package+
smoke-test run on a real hosted runner — not reused, not assumed.
Signing/notarization: not configured, truthfully disclosed, not
fabricated as done. No manual OS interaction on real Windows/macOS
hardware was performed in this (Linux) session — CI evidence is the
verification surface here, exactly as the mission itself directs
("Use CI evidence where actual desktop hardware is unavailable").

### 4.10 Portable/container deployment

Docker Compose portable delivery — all three profiles (`app`/`demo`/
`loki-mock`) built, started, and exercised against a real Docker daemon
in the original Phase K pass; `scripts/smoke.sh` passing. Single
deployable image; SPA fallback correctly excludes `/api`/actuator.
`docs/RUN_GUIDE.md` (299 lines, unchanged by this or either PCFR
mission) states Remote Docker TCP exposure is never required. OpenShift
`deploy/openshift/` manifests: no `ClusterRole`/`ClusterRoleBinding` ever
(structurally enforced by `scripts/validate-openshift-manifests.sh`), no
committed Secret, non-root/arbitrary-UID-compatible, read-only root
filesystem, resource bounds + health probes. No deployment architecture
change made or needed this pass.

---

## 5. Stage 7 — defect found and fixed

Exactly one, per the mission's own defect-handling protocol:

1. **Requirement violated:** register rows DEC-C and §5 "Live to Search"
   — both explicitly required "keyboard accessible... browser/E2E
   verified" and both explicitly named that specific verification as
   still pending.
2. **Root cause:** an evidence gap, not a code gap — the control was
   already a native, keyboard-operable `<button>`; nobody had captured a
   real keyboard-only E2E run proving it.
3. **Repair:** none needed to the control itself (already correct);
   added the missing verification.
4. **Regression coverage added:** `frontend/e2e/phase-j-live-tail.spec.ts`,
   new keyboard-only test, passing on a real run against the real app.
5. **Impacted suites re-run:** the full `phase-j-live-tail.spec.ts` file
   and the full E2E suite, both green (§3).
6. **Closure validation re-run:** confirmed via this report's own §4.7.

No other genuine functional defect was found. This is the only item
Stage 7 applied to — no unrelated enhancement was added alongside it.

---

## 6. Stage 6 — requirement traceability

### 6.A–6.J — the ten closure objectives

Every objective in §4 above resolves as follows (mission's own
4-value vocabulary):

| Objective | Resolution |
|---|---|
| 1. Source connectivity | `PASS` (Docker, remote Docker, OpenShift Direct, proxy modes) + `EXTERNAL_VALIDATION_NOT_AVAILABLE` (real Loki, real enterprise proxy — both honestly named, neither a defect) |
| 2. Log parsing / data preservation | `PASS` |
| 3. Search | `PASS` |
| 4. Results table | `PASS` (in-flight-cancellation UI state remains `DEFERRED_BY_EXPLICIT_SCOPE`, a named original design choice, not a new gap) |
| 5. Event Inspector | `PASS` |
| 6. Investigation capabilities | `PASS` |
| 7. Live logs | `PASS` (one real evidence gap found and closed this pass, §5) |
| 8. Masking/privacy | `PASS` |
| 9. Desktop | `PASS` (implementation + CI evidence; real hardware interaction `EXTERNAL_VALIDATION_NOT_AVAILABLE`, not required by the mission) |
| 10. Portable deployment | `PASS` |

### 6.K — full non-`VERIFIED` register row reconciliation (exhaustive)

Every register row whose `STATUS` text is not `VERIFIED`, resolved to
this mission's 4-value vocabulary. Historical text is **never edited to
delete the original decision** — only forward-referenced (CLAUDE.md §5).

| ID | Register's own text | Closure resolution | Why |
|---|---|---|---|
| PF-1 | `APPROVED_PENDING` (formal acceptance-model framing) | `PASS` | Underlying fields (parsing/masking/correlation/context) independently `VERIFIED` elsewhere; only the *formal model framing* was pending, not any function |
| UX-17 | `APPROVED_PENDING` | `PASS` | The approved allow-list is implemented (`tablePreferences.ts`, `useSearchState`); `frontend/src/app/persistence.test.tsx` (12 tests) re-run green this pass, confirming the forbidden set (free-text query, raw LogQL, all 5 protected fields, trace/correlation values, results, credentials) is never persisted |
| DEC-C | was `IN_PROGRESS` | `PASS` | Closed this pass — see §5 |
| §5 Live to Search | was `IN_PROGRESS` | `PASS` | Same closure as DEC-C |
| §6 Filter Functional Truth | was ambiguous `IN_PROGRESS → see report` | `PASS` | UX-R2 report closes all 11 remaining fields with real evidence; register text clarified this pass |
| §7a Windows: port collision / single-instance / WebView2 pixel rendering | `PARTIAL`/manual-only | `EXTERNAL_VALIDATION_NOT_AVAILABLE` | Edge-case robustness scenarios, not exercised in hosted CI or this Linux session; the golden path (install→launch→use→uninstall) is real-CI `VERIFIED` |
| §7a Code signing | unsigned by design, disclosed | `DEFERRED_BY_EXPLICIT_SCOPE` | No cert available; explicitly named, not hidden |
| §7b.1 `RELEASE_GRADE_MODE` real Apple signing | `NOT_TESTED_ENVIRONMENT_LIMITATION` | `EXTERNAL_VALIDATION_NOT_AVAILABLE` | No Apple Developer credentials in this environment; fail-fast behavior code-reviewed instead of fabricated as tested |
| §7b.1 native macOS embedded web view | `FUTURE_IMPROVEMENT` | `DEFERRED_BY_EXPLICIT_SCOPE` | v1 uses system browser + tray icon, a deliberate documented choice |
| §7 GitHub Releases publication (old §7b.1 table context) | was `DEFERRED` in that pass | `PASS` | Superseded — `v0.1.0` was later actually published as a real GitHub Release, and the automated tag-driven pipeline (§7e) now handles every release after it |
| §8 Desktop Branding — icon | `OPEN`, `CANONICAL_ICON_SOURCE=MISSING` | `DEFERRED_BY_EXPLICIT_SCOPE` | No official Log Explorer product mark exists anywhere in the repo; cosmetic/branding, not functional; not fabricated, owner action required for real artwork |
| §9 Security: sensitive-field query matching | `SUPERSEDED` (owner-approved simplification) | `PASS` | Current raw-value-server-side-only comparison is the approved, current approach |
| §9 Security: OpenShift resource limits/health-probe load-testing | `OPEN_UNDECIDED` | `EXTERNAL_VALIDATION_NOT_AVAILABLE` | Conservative starting defaults; no real cluster traffic available inside this project to tune against — not a hard owner-required gate |
| §9 No reveal/unmask | `OUT_OF_CURRENT_SCOPE`, narrowly superseded | `PASS` | The *policy-toggle* mechanism (PCFR-3) is now permitted and implemented; the *per-row reveal action* CLAUDE.md §2 rule 5 forbids remains permanently absent — both true at once, named explicitly at the UX-8 row |
| §12 Live-cluster verification (top-level) | was one `DEFERRED` row | `PASS` (OpenShift Direct) + `EXTERNAL_VALIDATION_NOT_AVAILABLE` (Loki) | Split this pass into its two real, different truths — see the updated register row |
| §12a `OS-1`…`OS-11`, `OS-13`, `OS-14`, `OS-16` | `APPROVED_PENDING` (stale) | `PASS` | Each superseded by its own later, granular `VERIFIED` row (`OS-1A-N`.../`OS-1B-N`.../etc.) — reconciliation note added to the register this pass |
| §12a `OS-12` | `OPEN_UNDECIDED` | `EXTERNAL_VALIDATION_NOT_AVAILABLE` | Genuinely still open — Loki-as-aggregated-provider consolidation requires real-Loki evidence that has never existed; an honest, owner-acknowledged gate, not a broken requirement |
| §12a `OS-15` | `OPEN_UNDECIDED` (stale) | `PASS` | Resolved by `OS-1A-9` (`VERIFIED`), extended by PCFR-6/7/PCFR2-2/3 |
| §12a `OS-17` | `OUT_OF_CURRENT_SCOPE` | `DEFERRED_BY_EXPLICIT_SCOPE` | Multi-cluster, permanently excluded by CLAUDE.md §8 |
| `OS-1A-17`, `OS-1B-23`, `OS-1C-20`, `OS-1D-13`, `OS-1E-13` | `BLOCKED_CREDENTIALS` (stale) | `PASS` | Each superseded in practice by `REAL_OPENSHIFT_1F=PASS`'s real Sandbox run; individual row text not yet flipped (named here rather than silently assumed) |
| `OS-1B-6` | `DEFERRED` | `DEFERRED_BY_EXPLICIT_SCOPE` | Jobs/CronJobs explicitly, not silently, excluded |
| `OS-1B-27` | `APPROVED_PENDING` (stale) | `PASS` | OS-1C has since shipped and is `VERIFIED`; this contract row's text not yet flipped |
| `TEST-INFRA-1` | `APPROVED_PENDING_HARDENING` | *(not a functional requirement — see below, not counted in the functional matrix)* | Test/tooling infrastructure, not product behavior |

**`TEST-INFRA-1` — named again, not fixed, by deliberate consistency with
its own prior disposition.** This session personally re-encountered the
exact defect it describes (`captureScreenshot` in `frontend/e2e/helpers.ts`
writes directly into tracked `docs/verification/<phase>/*.png` files) a
third and fourth time — once during PCFR, once during PCFR2's post-push
full run, and a fifth/sixth time during this closure's own two E2E runs.
Every single time it was caught and reverted via `git checkout --` before
any commit; it never once reached a finalized diff. Per the mission's own
Stage 7 instruction ("fix it only if it is required by an
already-approved/current *functional* requirement... do not introduce
unrelated enhancements") and the register's own prior explicit decision
("deferred, tracked, registered... **not fixed opportunistically**"),
this closure pass follows that same established precedent and does not
fix it — it is test tooling, not product functionality, and fixing it
here would itself be exactly the kind of unrelated scope-creep the
mission forbids. **Recommendation, not an action:** given six real
recurrences now on record, this item should be promoted from the
hardening backlog to an actual near-term fix in whatever mission next
touches E2E infrastructure.

```
UNTRACKED_OWNER_REQUIREMENTS=0
```

Every row the register itself tracks now resolves to one of `PASS`,
`EXTERNAL_VALIDATION_NOT_AVAILABLE`, or `DEFERRED_BY_EXPLICIT_SCOPE`, with
zero rows landing on `FAIL`.

---

## 7. Stage 8 — scope boundary, explicitly verified not begun

`git diff --stat main~2..main` (the two PCFR commits this session merged)
touches only Inspector/masking/results-table/OpenShift-Loki-proxy
code, tests, and documentation — nothing under a future-phase path.

```
IMPECCABLE_REDESIGN_STARTED=NO
DESIGN_SYSTEM_REPLACED=NO
PHASE_M_STARTED=NO  (the historical Phase M is already complete and untouched; no NEW Phase M work begun)
AI_LOG_DIAGNOSIS_STARTED=NO
PUBLIC_GENERALIZATION_STARTED=NO
GENERIC_SEMANTIC_LOG_MODEL_STARTED=NO
SOURCE_PLUGIN_SDK_STARTED=NO
BANK_PUBLIC_EDITION_SPLIT_STARTED=NO
SECOND_PUBLIC_REPOSITORY_STARTED=NO
NEW_OBSERVABILITY_INTEGRATIONS_STARTED=NO
OPENTELEMETRY_GENERALIZATION_STARTED=NO
ARBITRARY_DYNAMIC_MASKING_STARTED=NO
PRODUCTION_ENTERPRISE_SSO_STARTED=NO
```

---

## 8. Final verdict

```
ALL_CURRENT_FUNCTIONAL_REQUIREMENTS_ACCOUNTED_FOR=YES
ALL_MANDATORY_DETERMINISTIC_TESTS_PASS=YES
UNTRACKED_OWNER_REQUIREMENTS=0
KNOWN_FUNCTIONAL_DEFECTS=0
SECURITY_REGRESSION=NO
V0_1_0_UNCHANGED=YES

FINAL_FUNCTIONAL_CLOSURE=PASS
```

External infrastructure genuinely unavailable in this environment (real
Loki, real enterprise proxy, real cluster load traffic, real Apple
signing credentials, real desktop hardware) does not fail this closure,
per the mission's own rule: each is a deterministic-implementation-
verified, explicitly-named, non-owner-hard-gated limitation — never a
fabricated pass.

---

## 9. Next-phase boundary

Final Functional Closure has passed. Per the mission's own explicit
instruction: **stopping here.** The next owner decision — Impeccable
UI/UX redesign, public/generalized platform work, or any other scope —
is not begun, assumed, or hinted at as already underway.
