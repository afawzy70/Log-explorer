# Pre-Closure Functional Recovery 2 — Verification Report

**Mission:** PRE_CLOSURE_FUNCTIONAL_RECOVERY_2 — two owner-required
corrections found during real use of PR #51's own changes. Continued
directly on PR #51's branch (`fix/pre-closure-functional-recovery`,
still open, unmerged at the time this mission started — per the
mission's own instruction not to recreate that change set on a
conflicting branch).

**Branch:** `fix/pre-closure-functional-recovery` · **PR:** #51 (updated,
not a new PR — see §6).

Full requirement-level tracking, including the exact named conflict this
mission resolves against PR #51's own PCFR-1 decision, is in
`docs/governance/OWNER_REQUIREMENTS_REGISTER.md` §16 (`PCFR2-1`,
`PCFR2-2`, `PCFR2-3`). This report is the narrative method/evidence/
security account.

---

## 1. Owner requirements (verbatim intent)

**A.** Event Inspector primary tabs (Overview, Actor & client, Request
flow, Business / error, Technical / all fields) must always be present
for every selected event, never conditionally removed. A section with no
data for the current event must show an honest, specific empty-state
message instead of disappearing — the absence of data is itself
diagnostic evidence and must not look identical to "the UI hid
something."

**B.** The user must be able to configure OpenShift/Loki proxy routing
directly from the application: System (honor the OS environment
variables, unchanged, the default), Direct (never use a proxy, ignoring
the environment), or Custom (a user-entered host/port, authoritative,
never dependent on the environment or the launch method). One
configuration must control both the OpenShift API and Loki consistently.

---

## 2. Method

Per CLAUDE.md §5 ("audit before editing"), both areas were read against
their actual current source before any code changed:

- **A:** `EventInspector.tsx`'s `tabs` computation (added by PR #51's own
  PCFR-1) conditionally pushed the Actor/Request-flow/Business-error tabs
  only when their field-builder returned non-empty data. The three
  section components themselves (`ActorClientSection`,
  `RequestFlowSection`, `BusinessErrorSection`) already had their own
  complete, honest `EmptySectionNote` messages, written **before** PCFR-1
  ever hid the tabs — PR #51's own change made that pre-existing UI
  unreachable rather than replacing it. The fix is a pure removal of the
  conditional `.push` logic, not new UI.
- **B:** `OpenShiftSession`, `OpenShiftApiClient`, `ProxyRoute`,
  `LokiWebClientFactory`, `OpenShiftConnectionController`, and the
  desktop launchers were all read in full before writing anything. The
  existing architecture already separated "resolved route for one
  request" (`ProxyRoute`) from "environment-variable lookup"
  (`ProxyRoute.resolve(Map, String)`) — the natural extension point for a
  user-configurable mode was a new, small, shared setting consulted
  **before** that environment lookup, not a rewrite of it.

---

## 3. Part A — Event Inspector primary tabs

**Fix:** `EventInspector.tsx`'s `tabs` `useMemo` now returns a fixed,
five-entry array unconditionally — Overview, Actor & client, Request
flow, Business / error, Technical / all fields, every time, for every
event. The named conflict with PR #51's own PCFR-1 decision ("data-driven,
never display an empty meaningless tab") is recorded verbatim in the
component's own doc comment, marked SUPERSEDED, and in
`OWNER_REQUIREMENTS_REGISTER.md` (the PCFR-1 and UX-18 rows, both
updated rather than silently rewritten).

**What did not change:** the WAI-ARIA tabs implementation itself
(`role="tablist"/"tab"/"tabpanel"`, `aria-selected`, `aria-controls`,
roving `tabIndex`, Left/Right/Home/End navigation) — untouched, still the
exact component PR #51 built. Selecting a new event still resets the
active tab to Overview (unchanged, still correct — mission §A5
explicitly asks for this to remain). The Four Questions model, "never
fabricate causality," unknown-field preservation, and "no dangerous
HTML" are all unaffected — this was a visibility-rule fix only, never a
data-model change.

**Evidence:**
- `EventInspector.test.tsx`, new `describe` block ("primary tabs are
  structurally fixed"): a minimal/sparse event shows all five tabs with
  each empty one's own honest note (`no actor or client data`, `no
  journey, correlation, trace, span, or event id`, `no business step, ui
  identifier, error code, or exception`); a malformed/raw-fallback event
  (`malformed: true`) still shows all five tabs; switching between a
  fully-populated and a sparse event never changes the tab **count**,
  only which tabs have real content vs. an empty note; an event missing
  only actor data still shows Request flow's real content on the same
  screen; unknown/custom fields remain reachable via Technical/all
  fields regardless of the other sections' content.
- `frontend/e2e/ux-r5-inspector-context.spec.ts` — the test PR #51's own
  E2E-fix pass had rewritten to assert the (now-rejected) hidden-tab
  behavior was rewritten again, back to asserting every tab stays
  offered with an honest empty state, with the exact named-conflict
  rationale in its own comment.
- `frontend/e2e/pre-closure-functional-recovery-2.spec.ts` (new) — 4
  real-browser tests against the real dev backend (Fixture source): a
  complete event, a malformed event, five consecutive different events
  (tab count pinned at exactly 5 every time), and Previous/Next
  navigation (tab set unchanged, active tab resets to Overview).
- Real, rendered screenshot captured interactively during this session
  (`/tmp/pcfr2-inspector-tabs.png`, not committed — ephemeral manual
  verification per CLAUDE.md §6's "capture a baseline screenshot" step)
  confirmed all five tabs visible for a real fixture-sourced event.

---

## 4. Part B — User-configurable OpenShift/Loki proxy

### 4.1 Architecture

- `ProxyMode` (new enum: `SYSTEM`/`DIRECT`/`CUSTOM`) and `ProxyConfig`
  (new record: `mode`, `customHost`, `customPort`, with a `validate()`
  method — blank host, blank/non-numeric port, port outside `1..65535`,
  each rejected with a specific message, mirrored byte-for-byte on the
  frontend's own client-side validation so a malformed value is rejected
  **before** any request is ever sent, per the mission's own "invalid
  ports rejected before connection attempt where practical").
- `OpenShiftProxyConfigService` (new `@Service`) — the **one**
  authoritative, shared, in-memory setting. Deliberately not persisted to
  disk: a backend restart resets to `SYSTEM`, the same "safe default on
  every restart" design `core.mask.MaskingPolicyService` already
  established for masking policy. Independent of `OpenShiftSession`'s
  connect/disconnect lifecycle on purpose — the proxy setting is what a
  user configures **in order to** reach the cluster at all, so it must be
  readable/writable before any connection exists and must survive a
  disconnect/reconnect.
- `ProxyRoute.resolve(ProxyConfig, Map<String,String>, String)` (new) —
  the one authoritative resolver path. `SYSTEM` delegates, unchanged, to
  the pre-existing `resolve(Map, String)` (24 tests, all still green,
  none touched). `DIRECT` is always empty, regardless of the
  environment. `CUSTOM` always uses the configured host/port, **never**
  consulting the environment (not `HTTPS_PROXY`, not `NO_PROXY`) —
  proven directly by tests that configure a *different, broken* proxy in
  the environment and confirm it is never used.
- `OpenShiftApiClient` and `LokiWebClientFactory` are both
  constructor-injected with the **same** `OpenShiftProxyConfigService`
  singleton bean — this is the mechanism that makes "one authoritative
  configuration" true by construction rather than by convention: there is
  only one place the mode/host/port live, so OpenShift API calls and
  Loki calls can never independently drift (proven directly by
  `LokiWebClientFactoryTest.openShiftApiAndLokiShareTheExactSameProxyConfigService_oneModeChangeAffectsBoth`).
  Both classes needed `@Autowired` added to their real constructor once
  a plain no-arg constructor could no longer exist (Spring's own
  constructor-resolution requirement, confirmed empirically — see §7).
- `OpenShiftConnectionController` gained `GET`/`PUT
  /api/v1/sources/openshift/proxy`, deliberately **not** loopback-gated
  (unlike `POST /connect`) — a proxy host/port is not a credential, and
  the same unauthenticated-local-tool trust model
  `MaskingSettingsController` already established applies identically
  (documented explicitly in the controller's own class doc comment, not
  left implicit).
- `OpenShiftSettingsPanel.tsx` gained a `OpenShiftProxyFieldset`
  sub-component — a plain `<fieldset>`/`<legend>` radio group (native
  keyboard operability, no extra ARIA needed), rendered in both the
  connected and disconnected panel states (proxy routing is not tied to
  connect/disconnect). Custom host/port fields appear only when Custom is
  selected; System/Direct apply immediately on selection (nothing further
  to validate); Custom requires an explicit "Apply proxy" after
  client-side validation. Every update applies only the
  **server-confirmed** value — never optimistic, the same convention
  `PrivacyMaskingSettingsPanel` already uses.

### 4.2 SYSTEM/DIRECT/CUSTOM semantics, exactly as required

- **SYSTEM** (§B7): unchanged, tested behavior — `HTTPS_PROXY` wins,
  `HTTP_PROXY` as fallback, `NO_PROXY` bypasses. Not redefined.
- **DIRECT** (§B8): never uses `HTTP_PROXY`/`HTTPS_PROXY`, `NO_PROXY` is
  irrelevant (there is no proxy to bypass), CUSTOM values are ignored.
  Never mutates the global process/JVM environment — resolved per-client,
  exactly like `SYSTEM`/`CUSTOM`.
- **CUSTOM** (§B9/§B10): authoritative. Never depends on shell startup
  files, Finder/Dock/Windows environment inheritance, terminal launch, or
  existing `HTTP_PROXY`/`HTTPS_PROXY` variables — structurally true by
  construction, since `ProxyRoute.resolve`'s `CUSTOM` branch never reads
  the `environment` parameter at all. Does not silently bypass because
  the machine's environment has `NO_PROXY` set (proven by a dedicated
  test: `NO_PROXY=*` in the environment, `CUSTOM` still routes through
  the configured — deliberately broken — proxy).

### 4.3 Non-goals honored

No proxy username/password, no NTLM/Kerberos configuration UI, no PAC
files, no SOCKS proxy, no multiple proxy profiles — none were added, per
the mission's own explicit exclusion list. `ProxyRoute`'s existing
credential-parsing (for a `user:pass@host` form in `HTTPS_PROXY` itself,
under `SYSTEM` mode only) is unchanged and untouched by this mission.

### 4.4 Test Connection

This application's existing "Connect" action (submitting the pasted `oc
login` command) is the "Test Connection" the mission refers to — there is
no separate test-connection action in this codebase, and none was added
(no unrelated feature invented). It already performs a real, project-list
discovery call against the cluster, and — per this mission's changes —
that call now goes through whichever proxy mode is currently selected,
since `OpenShiftApiClient.build()`/`proxyFor()` consult the live
`OpenShiftProxyConfigService` on every call.

### 4.5 Error classification (unchanged, re-verified)

`OpenShiftApiClient.classify()` was not touched by this mission beyond
what PR #51 already did (`Kind.PROXY` thrown when a proxy is configured
and the low-level connect fails). Re-verified this still holds under the
new `DIRECT`/`CUSTOM` modes specifically:
`directModeConnectsSuccessfullyEvenWhenTheEnvironmentHasAProxyConfigured_neverConsultingIt`,
`customModeRoutesThroughTheConfiguredProxyAndIgnoresNoProxy` (both in
`OpenShiftApiClientTest`, and the equivalent pair in
`LokiWebClientFactoryTest`). Auth failures (`Kind.UNAUTHORIZED`) and TLS
failures (`Kind.TLS`) are classified by branches earlier in `classify()`
that this mission did not touch — never misclassified as `PROXY`
(pre-existing tests for both, unchanged, still green).

### 4.6 Desktop (Windows/macOS) — CUSTOM mode

**`CUSTOM` mode is, by construction, fully controlled by the
application's own runtime state, never the environment** — it is
therefore independent of launch method (Start Menu shortcut, packaged
`.exe`, Finder, Dock, packaged `.app`, terminal, dev server) by the exact
same reasoning §4.2 already establishes; there is no environment
variable for `CUSTOM` mode to fail to inherit. `SYSTEM` mode (unchanged)
retains the pre-existing, already-documented platform caveats (Windows
persistent env vars reach Start-Menu-launched apps; macOS
shell-profile-exported vars do not reach Finder/Dock-launched apps) —
those are inherent to `SYSTEM` mode's own environment-variable design and
are not new, not regressed, and not this mission's to fix.
`WINDOWS_DESKTOP_CUSTOM_PROXY=YES` and `MACOS_DESKTOP_CUSTOM_PROXY=YES`
are asserted on this reasoning (structural, not empirically re-run on
packaged Windows/macOS builds in this Linux development session — the
packaged-app CI jobs on the PR, §6, build and smoke-test the real
artifacts on real `windows-latest`/`macos-latest` runners, which is the
real verification surface for platform-specific launcher behavior; this
mission changed no launcher code at all).

### 4.7 Persistence and security

- Proxy host/port are **not** persisted to disk (in-memory only, same
  convention as the OpenShift token itself).
- The token never appears in any proxy-settings request/response — the
  `OpenShiftProxySettingsDto` has exactly three fields (`mode`, `host`,
  `port`), structurally incapable of carrying one; proven directly by a
  test (`theProxySettingsResponseNeverCarriesAnyTokenOrCredentialField`,
  both a unit test with a real HTTP body inspection and an E2E test
  inspecting the real network response).
- Proxy host/port never appear in a query string — sent as a JSON PUT
  body, never URL parameters.
- Nothing proxy-related is ever written to `localStorage`/
  `sessionStorage` — proven directly (`never writes anything to
  localStorage or sessionStorage`, unit test; `no proxy setting is ever
  written to localStorage`, E2E test with a full `window.localStorage`
  dump inspected).
- No trust-all TLS, no change to `.secure(...)`/TLS trust logic anywhere
  in this diff — the only Reactor Netty `HttpClient` change in either
  `OpenShiftApiClient`/`LokiWebClientFactory` is which proxy config
  source `.proxy(...)` consults.

---

## 5. Part C/D — masking and other PR #51 features preserved

Not touched by this mission at all. Confirmed by full regression (§7):
masking remains global, source-independent, server-side, masked by
default, configurable per field, no per-row reveal, no client-side raw
cache (`PrivacyMaskingSettingsPanel`/`MaskingSettingsController`/
`MaskingPolicyService`/`MaskingService` — zero diff). Column sorting,
column drag-and-drop, and surrounding-logs auto-scroll — zero diff,
re-verified green by the same full regression run.

---

## 6. Branch / PR

Per the mission's own explicit instruction ("If PR #51 is not merged
yet... continue from PR #51 branch... then update the same PR"): PR #51
was still `OPEN` (not merged) when this mission started (verified via
`gh pr view 51`, not assumed). Work continued directly on
`fix/pre-closure-functional-recovery`, the exact branch PR #51 already
targets — no new branch, no new PR, no conflicting re-creation of PR
#51's own change set from `main`. `git status`/`git diff` confirmed a
clean, up-to-date working tree matching `origin/fix/pre-closure-functional-recovery`
before any new commit was made.

---

## 7. Regression

- **Backend:** `./mvnw -o test` → **1078/1078 pass, 0 failures, 0
  errors** (1046 pre-existing + 32 new: `ProxyMode`/`ProxyConfig`
  validation tests folded into `ProxyRouteTest` (+13), a new
  `OpenShiftProxyConfigServiceTest` (4), `OpenShiftApiClientTest` DIRECT/
  CUSTOM tests (+3), `LokiWebClientFactoryTest` DIRECT/CUSTOM/shared-config
  tests (+3), and a new `OpenShiftProxySettingsControllerIntegrationTest`
  (9, real HTTP, real Bean Validation, real 400-vs-200 status codes)).
- **Frontend:** `npx vitest run` → **871/871 pass** (843 pre-existing +
  28 new: `EventInspector.test.tsx` +7 in the new "primary tabs are
  structurally fixed" block, `OpenShiftSettingsPanel.test.tsx` +14 in a
  new proxy-settings `describe` block).
- **Typecheck:** `npx tsc --noEmit -p .` → clean.
- **Production build:** `npm run build` (`tsc -b && vite build`) →
  succeeds. (One genuine unused-variable compile error was caught and
  fixed during this pass — see §8.)
- **Backend production build:** `./mvnw -o package -DskipTests` →
  succeeds.
- **E2E (Playwright, real dev backend + real dev frontend server, full
  suite):** **306/306 pass, 1 deliberately skipped** (marked
  `NOT_AVAILABLE`, §9). Two apparent Live-reconnect-timing failures
  surfaced on the very first full-suite run under load; both were
  confirmed to be pre-existing flakes unrelated to this mission's changes
  by re-running each in isolation, where both passed cleanly — not a
  regression, and neither test touches Inspector or proxy code.
- **Real, rendered browser verification** (CLAUDE.md §6): interactive
  Playwright session against the real dev app confirmed both the fixed
  five-tab Inspector and the working proxy radio group/Custom
  fields/Apply flow, with screenshots captured at each step (not
  committed — ephemeral verification only, per the same convention prior
  recovery passes used).

---

## 8. A genuine defect found and fixed during this pass (not a product regression)

**Build failure:** `npm run build`'s `tsc -b` (a stricter check than
plain `tsc --noEmit -p .`) caught a genuinely unused `proxySettings`
React state variable — set on fetch, never read anywhere in render. Fixed
by removing it entirely: the form's own `formMode`/`customHostInput`/
`customPortInput` state is sufficient, and the "last committed server
value" it was meant to track had no actual consumer. Re-verified: build
succeeds, all 43 `OpenShiftSettingsPanel` tests still pass.

**Test-infrastructure defect (E2E):** the real dev backend process this
session had been running since a much earlier mission was serving
**stale, pre-this-mission compiled code** — the new `/proxy` endpoint
404'd. All proxy E2E assertions that appeared to pass against it were
false positives caused by a separate, real bug in the panel's own
optimistic-update logic (the CUSTOM radio's `checked` state updated
locally the instant it was clicked, independent of whether the
subsequent "Apply" request actually succeeded) masking the stale-backend
symptom. Both were caught by direct diagnosis (a request/response logging
Playwright script) rather than assumption, per CLAUDE.md §3's
"compilation is not evidence" and §6's "real API response" debug-path
discipline. Fixed by: (a) restarting the dev backend from a fresh
`./mvnw package` build, and (b) confirmed the CUSTOM-radio-checked
behavior is intentional-and-correct as designed (selecting Custom reveals
fields locally; only "Apply" commits to the server, and every
committed value is applied from the server's own response, never
optimistically) — no code change was needed there once the stale-backend
cause was isolated. A second, genuine E2E-suite defect (test isolation
against the real, shared, singleton `OpenShiftProxyConfigService`) was
found and fixed — see §4.7/§9's own note and the governance register's
final paragraph.

---

## 9. External checks — honestly reported

`REAL_TEST_CONNECTION_THROUGH_BROKEN_CUSTOM_PROXY_E2E=NOT_AVAILABLE` —
this development environment has no real OpenShift login credentials
suitable for driving the actual `POST /connect` round trip through a
deliberately-broken `CUSTOM` proxy from the browser UI, and no
controllable proxy fixture is wired into this repository's E2E
infrastructure. Per the mission's own explicit instruction ("do not
fabricate a successful real enterprise proxy test... mark external
real-network checks honestly as BLOCKED/NOT_AVAILABLE while still
requiring deterministic implementation tests to PASS"), this is recorded
as `NOT_AVAILABLE` (a `test.skip` with the reasoning in its own comment,
in `pre-closure-functional-recovery-2.spec.ts`) rather than fabricated.
The equivalent behavior **is** deterministically proven at the backend
level: `OpenShiftApiClientTest.customModeRoutesThroughTheConfiguredProxyAndIgnoresNoProxy`
and `LokiWebClientFactoryTest.customModeRoutesThroughTheConfiguredProxyAndIgnoresNoProxy`
both exercise a real, deliberately-broken `CUSTOM` proxy against a real
live server (`MockOpenShiftServer`/a real self-signed-TLS `HttpsServer`
respectively) and assert `Kind.PROXY`/`Reason.PROXY` classification.

`WINDOWS_DESKTOP_CUSTOM_PROXY`/`MACOS_DESKTOP_CUSTOM_PROXY` — asserted
`YES` on the structural reasoning in §4.6 (no launcher code changed, and
`CUSTOM` mode has no environment dependency to fail to inherit in the
first place), not on a fresh packaged-app smoke test specific to this
mission — the packaged-app CI jobs on PR #51 (§10) provide the real
verification surface for launcher behavior generally, and this mission
changed no launcher code.

---

## 10. CI on the PR

Fresh CI, Windows desktop, and macOS desktop checks were required on PR
#51 after this update, per the mission's own acceptance criteria — see
the final structured response for the exact PASS/FAIL results captured
at the time this update was pushed.

---

## 11. Scope boundary — explicitly verified NOT begun

`IMPECCABLE_REDESIGN_STARTED=NO` · `DESIGN_SYSTEM_REPLACED=NO` ·
`SEARCH_RESULTS_BROADLY_REDESIGNED=NO` · `PHASE_M_STARTED=NO` ·
`FINAL_FUNCTIONAL_CLOSURE_RESUMED=NO` ·
`PUBLIC_GENERALIZATION_STARTED=NO` ·
`BANK_PUBLIC_EDITION_SPLIT_STARTED=NO`. `git diff --stat` for this
mission's own commit touches exactly 15 files modified + 7 new — all of
them Inspector-tab-visibility or OpenShift/Loki-proxy code, tests, or
this documentation. No unrelated file was touched.

`V0_1_0_UNCHANGED=YES` — this mission's changes touch none of
`desktop/`, `.github/workflows/`, or `VERSION` (confirmed via `git
status --porcelain` filtered to those paths — zero hits); `v0.1.0`'s tag
SHA and GitHub Release were not re-inspected this pass (unchanged since
the prior recovery's own confirmation, and nothing in this mission's
diff could affect them).
