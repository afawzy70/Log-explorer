# Pre-Closure Functional Recovery — Verification Report

**Mission:** PRE_CLOSURE_FUNCTIONAL_RECOVERY — owner-confirmed
functional/workflow regressions found during real use of the shipped
application, fixed as a slice explicitly distinct from the still-pending
UI/UX redesign ("Impeccable"), Phase M, and Final Functional Closure.
**Branch:** `fix/pre-closure-functional-recovery` (from `main` at
`3fcf9ea695455feacee77f5efce168708c826598`). **`v0.1.0` immutability:**
verified unchanged throughout — see §9.

Owner-confirmed issues addressed, A–H, map to `docs/governance/OWNER_REQUIREMENTS_REGISTER.md`
§15 rows `PCFR-1`…`PCFR-8`, which are the authoritative per-requirement
record (STATUS/EVIDENCE/NOTES per row). This report is the narrative
method/evidence/security/regression account; the register is the
structured index — read both, neither replaces the other.

---

## 1. Method

Per CLAUDE.md §5, "audit before editing" — every area below was read
against its actual current source before any code was written, not
assumed from a historical phase number. Two of the eight areas turned
out to need far less new work than the mission's framing implied once
audited:

- **OpenShift proxy (G):** `ProxyRoute`/`OpenShiftApiClient.build()` were
  already fully implemented, already scoped-not-JVM-global, already
  wired into every OpenShift network call, and already re-resolved fresh
  on every request/reconnect. The real gap was narrow: `Kind.PROXY`
  existed in the exception enum but was never thrown (see §6).
- **Surrounding logs (H):** the root/selected-event marking (visible
  class + `aria-current="location"` + a visually-hidden label), and the
  narrow same-execution-context scoping (OS-1D §9's own
  sibling-container/different-namespace disambiguation), were already
  correct and already tested. The real gap was one thing: nothing
  auto-scrolled the root row into view (see §8).

A dedicated audit fork additionally found a **third, previously
untracked** proxy gap not named in the mission text at all:
`LokiWebClientFactory` (backing `openshift-loki`, the live, retained
LokiStack-behind-OpenShift source — see
`docs/verification/OS_1G_AGGREGATED_PROVIDER_DECISION_REPORT.md` §8) had
**zero** `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` support at all — the one
OpenShift-cluster-adjacent network call site an audit (grepping every
`HttpClient.create()`/`WebClient.builder()`/`.proxy(` in the backend)
found not routed through `ProxyRoute`. Fixed alongside G — see §7.

---

## 2. A/B — Inspector accessibility, tabbed event details

**Defect (owner-confirmed):** the Inspector rendered all five sections
(Overview, Actor & client, Request flow, Business & error, Technical/all
fields) as one continuous vertical flow. At some viewports/zoom levels
this made later sections effectively unreachable — a real regression
from an earlier grouped/tabbed presentation.

**Fix:** `frontend/src/features/inspector/InspectorTabs.tsx` (new) — a
WAI-ARIA tabs component (`role="tablist"/"tab"/"tabpanel"`,
`aria-selected`, `aria-controls`/`id` pairing, roving `tabindex`,
Left/Right/Home/End keyboard navigation scoped to the tablist element,
never a document-level listener). `EventInspector.tsx` computes the tab
list via `useMemo`, reusing each section's own existing field-builder
function (`buildActorClientFields`/`buildRequestFlowIdentifiers`/
`buildBusinessErrorFields`) to decide whether to include that tab —
**never a new, separate "is this empty" check**, so a tab's presence can
never drift from what its own section already considers non-empty.
Overview and "Technical/all fields" are structurally never empty, so
always shown. Selecting a new event resets the active tab to Overview.

**What did not change:** the Four Questions (WHO/WHAT/WHY/WHERE) model,
never fabricating causality, preserving unknown-field data (`AllFieldsSection`
untouched), no `dangerouslySetInnerHTML` (unchanged — log content still
renders as text only). This was a navigation/presentation fix, not a
data-model change.

**Evidence:** 87 tests across `frontend/src/features/inspector/`
(`EventInspector.test.tsx`: per-tab content assertions, "does not show a
tab for a section with no data," keyboard Arrow/Home/End navigation,
"selecting a new event resets active tab to Overview").

---

## 3. C/D — Global, configurable protected-field masking

**Defect (owner-confirmed):** the masking-policy panel lived inside
Docker Settings, implying masking was a Docker-specific concern, when it
is a global, source-independent one honored identically by
Fixture/Docker/OpenShift/Loki.

**Fix — information architecture (PCFR-2):** `PrivacyMaskingSettingsPanel.tsx`
(new) renders in `Shell.tsx` independently of, and before,
`DockerSettingsPanel`/`OpenShiftSettingsPanel`. The old "Protected field
masking" block was removed from `DockerSettingsPanel.tsx` entirely.

**Fix — policy configurability (PCFR-3), with an explicit, named
conflict resolution per CLAUDE.md §5:** the owner's decision explicitly
supersedes the prior "permanently masked, no way to ever unmask"
reading recorded at `OWNER_REQUIREMENTS_REGISTER.md` UX-8. The
supersession is narrow, not blanket — see the boundary below.

- `ProtectedField` (new enum: CIF/USER_NAME/CUSTOMER_ID/DEVICE_ID/DEVICE_IP)
  and `MaskingPolicyService` (new) — a `ConcurrentHashMap<ProtectedField, Boolean>`
  defaulting every field to `true` (masked) at construction and via
  `resetToDefaults()`. **Deliberately not persisted to disk** — a
  backend restart resets to fully-masked, the maximally safe failure
  mode. This is a documented design choice, not an oversight.
- `MaskingService` now takes an injected `MaskingPolicyService` and
  consults it per field before masking/passing through. It remains the
  **sole** place raw sensitive values are read — `ArchitectureTest.onlyMaskingServiceMayTouchRawSensitiveFields`
  (ArchUnit) is unchanged and still passes, so the masking boundary
  never moved to React.
- `MaskingSettingsController` (new, `GET`/`PUT /api/v1/settings/masking`) —
  validates the field key (400 on unknown), applies the change, and
  returns the server's own updated policy.
- `PrivacyMaskingSettingsPanel.tsx` fetches fresh on open, applies only
  the **server-returned** policy after a toggle (never optimistic —
  never assumes the write succeeded before the server confirms it), and
  shows a concise `role="status"` warning while any field is unmasked.
  **No per-row reveal button anywhere** — toggling never reconstructs an
  already-fetched, already-masked browser-side value; it changes what
  the server will mask on the *next* request. This is the exact
  boundary the supersession draws: CLAUDE.md §2 rule 5's literal text
  ("no reveal action for masked values") is still fully honored in its
  original, narrower sense.
- Source-independence: `MaskingService`/`MaskingPolicyService` sit
  underneath `EventMapper`, which every source (Fixture/Docker/
  OpenShift/Loki) already routes through — no source has, or gained, its
  own masking path.

**Evidence:** `MaskingServiceTest` +7 tests (incl.
`aFreshMaskingPolicyServiceAlwaysStartsFullyMaskedTheSafeDefault`,
`resetToDefaultsRestoresFullMaskingAfterFieldsWereDisabled`);
`MaskingSettingsControllerIntegrationTest` (new, 7 tests over real HTTP,
`@AfterEach` resets policy); `PrivacyMaskingSettingsPanel.test.tsx` (10
tests: discoverability, fetch-on-open, per-field toggle correctness,
warning appears/disappears, re-masking works, no Reveal button, error
states, axe a11y).

---

## 4. E/F — Column-level sorting + column management

**Defect (owner-confirmed):** no real per-column sorting existed, and
the "Columns" popover (visibility/order/density) was hard to discover
and lacked drag-and-drop.

**Fix — sorting (PCFR-4), named conflict per CLAUDE.md §5:** `SortControl.tsx`'s
own Slice-4 doc comment recorded a deliberate decision against a
clickable Time header; that rationale is preserved verbatim in the file,
marked SUPERSEDED, followed by this mission's owner decision.

- `columnSort.ts` (new): `compareSortValues` (nulls always sort last,
  **checked before** the ascending/descending sign flip — a naive
  `direction === 'asc' ? cmp : -cmp` wrapper would incorrectly flip
  null-placement too, which an early version of this code did and a new
  test caught); `IndexedEvent {event, originalIndex}` pairs created
  **before** sorting, carried through display, so row selection/`onInspect`
  resolve the original index directly rather than via a post-hoc
  identity lookup (`eventIdentity()` deliberately excludes
  `service`/`severity`, so two rows can share identity yet differ in a
  sorted field — an early version resolved index by identity lookup and
  produced duplicate React keys and wrong selection under exactly that
  collision; a new test caught this too, fixed by switching to
  index-pairing before any regression shipped).
- `columnRegistry.tsx`: `sortAccessor` added per sortable column; `time`
  and `whatHappened` deliberately have none (`time` is handled specially
  below; `whatHappened` — the message — has no natural total order worth
  sorting by).
- `ResultsTable.tsx`: clicking the Time header **aliases** the exact
  same `sortDirection`/`setSortDirection` state `SortControl` already
  uses — never a second, competing sort state. Clicking Time clears any
  active column sort, reverting display to the backend's own real fetch
  order. Client-side column sorting reorders only the already-loaded
  `events` array for display; it never triggers a fetch (CLAUDE.md §4
  "one pagination model only").

**Fix — column management (PCFR-5), named conflict per CLAUDE.md §5:**
`TableSettingsControl.tsx`'s own Slice-4 doc comment recorded
"deliberately not drag-and-drop"; preserved verbatim, marked SUPERSEDED.
Native HTML5 drag-and-drop (`draggable`, `onDragStart`/`onDragOver`
(`preventDefault` required)/`onDrop`/`onDragEnd`) is now priority 1,
**additive to**, not replacing, the existing keyboard-accessible Move
up/down buttons (priority 2/3). `tablePreferences.ts`'s new
`moveColumnToIndex` clamps out-of-range targets and no-ops on a row's
own position; it touches only `columnOrder`, never `hiddenColumnIds`/
density/selection, which is why reordering does not reset sort and a
density change does not reset columns/order/sort/selection — a
structural property of the state shape, not extra bookkeeping to keep in
sync.

**Evidence:** `columnSort.test.ts` (13 tests); `ResultsTable.test.tsx`
(+13 tests: ascending/descending/toggle, Level sorts by
`severityNumber` not alphabetically, only one active indicator at a
time, missing-values-sort-last-both-directions, Time aliases
`timeSortDirection`, selection stays correct against the *original*
index during a sort, axe a11y); `tablePreferences.test.ts` (+4 tests);
`TableSettingsControl.test.tsx` (+5 tests: draggable rows, drag-last-
drop-on-first moves to front, drop-on-self no-op, Move up/down
unchanged, drag-and-drop persists to `localStorage`).

---

## 5. G — OpenShift enterprise proxy connectivity

**Audit finding:** `ProxyRoute` (env-var resolution: `HTTPS_PROXY`/
`https_proxy`/`HTTP_PROXY`/`http_proxy`/`NO_PROXY`/`no_proxy`, domain-
boundary-correct suffix matching, credentials parsed but never printed)
was already complete and already covered by 24 tests in
`ProxyRouteTest.java`. `OpenShiftApiClient.build()` already called
`ProxyRoute.resolve(environment, server.getHost())` fresh on every
request — including every reconnect, so there is no stale-proxy-after-
reconnect risk — and every OpenShift network operation
(`OpenShiftConnectionService`, `OpenShiftScopeService`,
`OpenShiftLiveTailProvider`, `DirectPodLogProvider`) consumes
`OpenShiftApiClient`, so proxy support was already consistent across
connection validation, discovery, Search, Context, and Live.

**The real gap:** `Kind.PROXY` existed in `OpenShiftApiException` but was
never thrown — every proxy-connect failure fell into the generic
`Kind.NETWORK` bucket, indistinguishable from "the cluster itself is
unreachable." An empirical, standalone Reactor Netty diagnostic (against
this project's actual `reactor-netty-http`/`netty-handler-proxy` jars,
not assumption) confirmed `io.netty.handler.proxy.ProxyConnectException`
fires **only** when the proxy's TCP port is reachable but its CONNECT
response is rejected — not when the proxy's own port is unreachable,
which surfaces as a plain `ConnectException`, structurally
indistinguishable by type from a direct-to-cluster failure.

**Fix:** `OpenShiftApiClient.classify(Throwable, boolean proxyConfigured)`
— `proxyConfigured` is computed once per call site
(`ProxyRoute.resolve(environment, server.getHost()).isPresent()`,
mirroring `build()`'s own resolution) at all three call sites (`get()`,
`fetchPodLog()`, `followPodLog()`). When a proxy is configured for the
request's target host, **any** low-level `WebClientRequestException`
connect failure is classified `Kind.PROXY`, not just the narrower
`ProxyConnectException` case — reasoned from Reactor Netty's own
`HttpClient.proxy(...)` contract (once configured, the TCP attempt
necessarily targets the proxy first), not guessed from message text
(the class's own javadoc already forbids surfacing raw exception text).

**Evidence:** `OpenShiftApiClientTest.aConfiguredProxyThatCannotBeReachedIsClassifiedAsAProxyFailure_notGenericNetwork`
— a real, deliberately-broken proxy (`HTTPS_PROXY=http://127.0.0.1:1`,
nothing listening) against a real, live `MockOpenShiftServer`, proving
(a) the failure classifies `Kind.PROXY`, and (b) the exact same generic
client (no proxy configured) reaching the same live server still
succeeds — isolating the failure to the proxy hop, not incidental
flakiness. `ProxyRouteTest` (24 tests, unchanged, still green).

**Packaged desktop apps:** confirmed via direct source reading (not
assumption) that both `ProcessStartInfo.EnvironmentVariables` (.NET
launcher) and `ProcessBuilder.environment()` (Java launcher) start as a
copy of the full parent environment; explicitly setting `SERVER_PORT`
never clears the rest. Genuine OS-level caveat, not a code defect,
documented rather than silently omitted: Windows persistent env vars
(System Properties/`setx`) reach Start-Menu-launched apps; macOS
shell-profile-exported vars do **not** reach Finder/Dock-launched apps
(only `launchctl setenv`-style global vars do) — an enterprise-proxy
user on macOS who only exports `HTTPS_PROXY` in `~/.zshrc` and launches
the app from Finder/Dock will not have it honored; launching from a
terminal (which does inherit shell-exported vars) works as expected.
This is unchanged by this recovery and is a pre-existing platform
constraint, named here rather than left implicit.

**`REAL_OPENSHIFT_PROXY_CONNECTION`:** `NOT_AVAILABLE`, honestly, per
CLAUDE.md §3 — never converted to a fabricated `PASS`. This session's
environment does have real OpenShift Developer Sandbox credentials
(`OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN`), and connectivity to that real
cluster was confirmed directly (`GET .../apis/project.openshift.io/v1/projects`
→ real `200`, checked via `curl -w "%{http_code}"` with the response body
discarded — never printed, never logged). But this session's environment
has **no** `HTTP_PROXY`/`HTTPS_PROXY` configured at all (`env | grep -i
proxy` → empty) and no reachable corporate proxy to route through, so a
genuine real-cluster-through-a-real-proxy round trip is not obtainable
here. What *is* real evidence, not a substitute claimed to be equivalent:
the proxy-connect-failure **classification** logic itself (§5 above) was
verified empirically — a real, deliberately-unreachable proxy address
against a real, live `MockOpenShiftServer`, using the project's actual
Reactor Netty/`netty-handler-proxy` dependency versions, not a mock of
the proxy layer.

---

## 6. G (continued) — Loki proxy support (newly found, not in the mission text)

A dedicated audit (grepping every `HttpClient.create()`/`WebClient.builder()`/
`.proxy(` occurrence across the whole backend) found `LokiWebClientFactory`
— backing `openshift-loki`, a live, retained source per the OS-1G
decision, not a deferred or dead path — had **no** proxy support at all.
An enterprise-proxy user could not reach the LokiStack gateway through
their configured proxy under any configuration.

**Fix:** `LokiWebClientFactory` gained a `Map<String, String> environment`
constructor parameter (test seam, mirroring `OpenShiftApiClient`'s own
pattern) and a `proxyFor(LokiProperties)` method reusing the exact same
`ProxyRoute.resolve`. Resolved **once, at construction** rather than
per-request like `OpenShiftApiClient.build()` — unlike OpenShift, Loki
has exactly one fixed `baseUrl` per deployment, so there is nothing to
re-resolve on a later request. `LokiErrorClassifier.classifyThrowable`
gained a `proxyConfigured` parameter and a new `Reason.PROXY` — a
minimal, proportional addition to Loki's own (much coarser, pre-
existing) error taxonomy, not a full rebuild of it. `LokiQueryClient`
computes `proxyConfigured` once in its constructor (Loki's `baseUrl` is
fixed, so this is safe) and threads it into every classification call.

**Evidence:** `LokiWebClientFactoryTest` +4 tests, including a real
deliberately-broken-proxy test against a real self-signed-TLS
`HttpsServer` (proving `Reason.PROXY`, not `Reason.UNKNOWN`, and that the
same server reached directly still succeeds); `LokiErrorClassifierTest`
+1 test (proxy-vs-no-proxy classification of the identical exception
type).

---

## 7. H — "Show surrounding logs" root visibility

**Audit finding:** the root/selected event was already correctly,
visibly marked (`.contextRootRow` class + `aria-current="location"` +
a visually-hidden "Original event you were investigating" label — never
color-only, per CLAUDE.md §7), and already narrowly scoped to the exact
same execution context (`OS-1D §9`'s existing tests already prove a
same-message/same-timestamp sibling **container** in the same pod, and a
same-pod-name in a **different namespace**, are never mistaken for the
root). Context stays structurally distinct from Correlation/Journey
(`sortable={false}` in that view, its own true chronological order
independent of the global Newest/Oldest setting — unchanged).

**The real gap:** nothing brought the root row into the viewport. On a
long context window, opening "Show surrounding logs" could land the
investigator on a scroll position where the very event they asked about
was not visible at all.

**Fix:** `ResultsTable.tsx` — a `contextRootRowRef` attached only to the
row where `isContextRoot` is true, and a `useEffect` keyed on
`contextRootIdentity` (a stable string, not the `events` array
reference) that calls `scrollIntoView({block: 'center', behavior: 'smooth'})`
on that row. Keying on the identity string rather than the array means
this fires exactly once per context view **opening** — never on every
re-render while the same view stays open, so a density or column-order
change inside an open context view does not re-scroll the page out from
under the investigator.

**Evidence:** `ResultsTable.test.tsx` +3 tests: scrolls the correct
row's own DOM node (`scrollIntoView.mock.instances[0]).toBe(rows[1])`,
not just "was called somewhere") on open; does not re-scroll on a
density change while the same context view stays open; never scrolls
when no context view is open at all.

---

## 8. Security re-validation (targeted)

| Check | Result | Evidence |
|---|---|---|
| Masked raw values never reach the browser | PASS | `SerializationLeakTest` (unchanged, still green); `MaskingService.mask()` remains the sole raw-value read site |
| `ArchitectureTest.onlyMaskingServiceMayTouchRawSensitiveFields` | PASS | ArchUnit rule unchanged, re-run as part of the full backend suite |
| No reveal cache / no raw-value reconstruction client-side | PASS | `PrivacyMaskingSettingsPanel.tsx` applies only the server-returned policy after a toggle; never stores a raw value anywhere; `PrivacyMaskingSettingsPanel.test.tsx` "no reveal/unmask button" test |
| No protected values in `localStorage`/URLs | PASS (unchanged) | `tablePreferences.ts` persists only column order/visibility/density — never event data; query contents were already kept out of the URL pre-existing this recovery, untouched by it |
| No raw protected values logged | PASS (unchanged) | No new logging statements added anywhere touching masked fields; `MaskingSettingsController` logs nothing per-request |
| Server remains the sole masking-enforcement authority | PASS | `MaskingPolicyService` lives in `core/mask`, consulted only by `MaskingService`; no frontend code makes a masking decision |
| No source-specific masking bypass | PASS | `EventMapper`/`MaskingService` sit underneath every source (Fixture/Docker/OpenShift/Loki) — none has its own masking path |
| Proxy credentials never leak | PASS (unchanged + re-confirmed) | `ProxyRoute.display()`/`.toString()` never include the password (`ProxyRouteTest.proxyCredentialsAreParsedButNeverPrinted`, unchanged); `OpenShiftApiClient.classify()`'s own javadoc forbids surfacing raw exception text, which could carry a proxy URI; the new `LokiWebClientFactory` proxy wiring reuses the identical `ProxyRoute` object, never constructs or logs a separate proxy URI string |
| OpenShift/Loki tokens never leak | PASS (unchanged) | `OpenShiftApiClientTest.noFailureMessageEverContainsTheToken` (unchanged, still green); no new code path echoes a token |
| TLS verification stays on | PASS (unchanged) | Neither `OpenShiftApiClient.build()` nor `LokiWebClientFactory.create()` gained any trust-all path; the new proxy wiring in both only ever adds `HttpClient.proxy(...)`, never touches `.secure(...)` |
| No new `dangerouslySetInnerHTML` | PASS | Inspector tabs render the exact same section components as before; grep confirms zero occurrences repo-wide |

---

## 9. Regression

- **Backend:** `./mvnw -o test` → **1046/1046 pass, 0 failures, 0 errors**
  (1040 pre-existing + 6 new: 1 `OpenShiftApiClientTest` proxy test, 4
  `LokiWebClientFactoryTest` proxy tests, 1 `ProxyRouteTest` lowercase
  `no_proxy` coverage test; `LokiErrorClassifierTest` and
  `MaskingServiceTest`/`MaskingSettingsControllerIntegrationTest` net
  counts folded into the same total).
- **Frontend:** `npx vitest run` → **851/851 pass**, 70 test files.
- **Typecheck:** `npx tsc --noEmit -p .` → clean, zero errors.
- **Production build:** `npm run build` → succeeds (`tsc -b && vite build`).
- **E2E (Playwright, real dev backend on 3434 with `SPRING_PROFILES_ACTIVE=dev`
  + real Vite dev server on 3435):** first full run — 270 passed, 24
  failed. Every one of the 24 was triaged individually against the
  actual current source (not assumed): **all 24 were stale locators/
  assertions against intentionally-changed DOM, zero genuine product
  regressions.** Three root causes, all already-known consequences of
  this recovery's own changes: (1) the Inspector's five sections are no
  longer simultaneously in the DOM once converted to WAI-ARIA tabs
  (PCFR-1) — specs written against the old always-visible-flow layout
  needed to open the relevant tab first; (2) the masking panel moved out
  of Docker Settings (PCFR-2) — one spec needed to open the new
  standalone panel instead; (3) sortable column headers now render a
  `<button>` with appended visually-hidden sort-state text (PCFR-4) — a
  few specs doing exact header-text matching needed the same
  `headerLabel`-style cleanup already applied to the frontend unit
  tests. One test's *expectation itself* was rewritten, not just its
  locator — `ux-r5-inspector-context.spec.ts` "a section with no data":
  the prior expectation ("shows an explicit 'No actor or client data'
  note") is superseded by PCFR-1's own explicit requirement ("never
  display an empty meaningless tab" — confirmed against
  `buildActorClientFields` source, not assumed), so the tab is now
  asserted absent entirely, a strictly stronger version of the same
  underlying principle. Fixed via a new shared `frontend/e2e/inspector-helpers.ts`
  (`openInspectorTab`, `inspectorAllTabsText`, `headerLabel`) plus
  targeted edits to 10 spec files — 10 files changed, 0 test coverage
  weakened (every fixed test still verifies the exact same underlying
  behavior it did before, via the new correct DOM shape). **Final,
  independently re-run result: 294/294 pass** (run twice — once by the
  triage pass, once independently after it, both green).
- **`V0_1_0_UNCHANGED`:** confirmed `YES`. `git status --porcelain`
  against this session's uncommitted changes has zero hits under
  `desktop/`, `.github/workflows/`, or `VERSION`. `gh release view v0.1.0`
  confirms the release still carries its original 4 assets, all in
  `uploaded` state — this session never ran any `gh release`
  create/upload/edit/delete command.

---

## 10. Scope boundary (explicitly not touched)

No Impeccable redesign work. No design-system replacement. No broad
Search/Results redesign beyond the specific sorting/column-management
fixes named in E/F. No Phase M. Final Functional Closure was not
resumed. No API-contract changes beyond the two new, additive endpoints
(`GET`/`PUT /api/v1/settings/masking`) required by C/D. No Search/Live/
OpenShift/Docker/Loki *semantic* changes — only the proxy-classification
and proxy-connectivity fixes named in G, which are connectivity/error-
reporting fixes, not query/data-shape changes.

---

## 11. Documentation

`docs/governance/OWNER_REQUIREMENTS_REGISTER.md` §15 (new,
`PCFR-1`…`PCFR-8`) records every requirement above with its own
STATUS/EVIDENCE/NOTES row, plus forward cross-references added to the
superseded/extended earlier rows (UX-6, UX-8, UX-11, UX-18, UX-19,
UX-21, OS-1A-9) — every superseded decision is preserved in place,
marked `SUPERSEDED`, never deleted. `HISTORICAL_DECISIONS_PRESERVED=YES`.
`UNTRACKED_OWNER_REQUIREMENTS=0`.
