# Owner Requirements Register

The authoritative, repo-persisted record of every owner-approved, pending,
deferred, or superseded product/UX/defect/distribution requirement for Log
Explorer. Created because the project must no longer depend on chat
history to remember approved scope (UX-R2 mission, Part A).

**Not a duplicate of `REQUIREMENTS_TRACEABILITY.md`.** That document is a
narrower, historical Phase-A→M coverage matrix mapping `HANDOVER.md` §34's
original pre-Legacy-Remediation requirements to their owning phase — it
predates the Legacy Remediation slices, the UX restoration work, and
everything below, and uses a different status vocabulary. It remains the
record of *original scaffolding* requirement coverage; this register is
the record of *everything decided since*, plus a reconciled view of what
in that original list is now superseded. Neither replaces the other.

**Status vocabulary** (exactly these eight values):

| Status | Meaning |
|---|---|
| `APPROVED_PENDING` | Owner-approved, not yet implemented |
| `IN_PROGRESS` | Actively being implemented in the current or a just-opened slice |
| `IMPLEMENTED` | Code exists for it — **not** the same as verified |
| `VERIFIED` | Implemented **and** evidenced (a passing test, a real-environment run, a screenshot) |
| `DEFERRED` | Explicitly postponed, with a reason |
| `SUPERSEDED` | An earlier decision on this exact requirement was replaced by a later one — the row names both |
| `OUT_OF_CURRENT_SCOPE` | Explicitly excluded by `CLAUDE.md` §8 / `IMPLEMENTATION_PLAN.md` §11 |
| `OPEN_UNDECIDED` | A real finding or recommendation exists, but the owner has never explicitly approved, rejected, or deferred it |

A requirement is `IMPLEMENTED` only when code exists for it. It is
`VERIFIED` only when there is real evidence behind it — a citation, not an
assertion. This register cites its evidence per row; when evidence is
"this session's own passing test suite," the exact spec/test file is
named so a future reader can re-run it rather than take it on faith.

The `IMPLEMENTATION_PLAN.md` §2 "Conflict resolution" rule — *"when an
older requirement conflicts with a later decision, name the conflict
explicitly and apply the later decision"* — is this register's own
organizing principle, applied project-wide rather than phase-by-phase.

---

## 1. Product Foundation

| ID | PF-1 |
|---|---|
| NAME | The four investigation questions |
| STATUS | `APPROVED_PENDING` (as a formal acceptance model; the product itself already substantially satisfies it — see below) |
| CATEGORY | Product foundation |
| OWNER_DECISION | Log Explorer exists to help a user answer: **WHO DID WHAT** (username/user, customer/CIF, device/client, operation/business step/UI action/event), **WHAT IS HAPPENING** (message, severity, error, exception, error code, business step, event/time), **WHY IS IT HAPPENING** (error/exception evidence, business failure evidence, logger/class, surrounding events, correlation/trace/journey, request flow, gap/incomplete evidence — never fabricate causality), **WHERE IS IT HAPPENING** (environment, source, Docker engine, Compose project, service/application, container, host/server, logger, trace/journey path). Every major UX surface must be judged against these four questions. |
| TARGET_SLICE_OR_PHASE | Standing/cross-cutting — applies to all future UX-R slices as an evaluation lens, not a one-time deliverable |
| ACCEPTANCE_CRITERIA | For a representative investigation scenario, every field the model names is either genuinely surfaced in the UI/API or explicitly marked unavailable (never invented) |
| EVIDENCE | This session: see `docs/verification/UX_R2_FILTER_AND_SEARCH_FUNCTIONAL_REPORT.md` §"WHO/WHAT/WHY/WHERE validation" for a real worked scenario against the Fixture source |
| NOTES / CONFLICTS | First stated in this exact phrasing in the UX-R2 mission message; not found phrased this way anywhere earlier in the repo. Genuinely new as a *named, formal* acceptance model — the underlying fields it names were already individually implemented (canonical parsing, masking, correlation/trace/journey, context) well before this session. |

---

## 2. UX Restoration

Reconciled against `docs/verification/OLD_UX_RESTORATION_AUDIT.md`'s master table and its "Owner decisions — now resolved" section, updated for UX-R1 (merged, PR #32).

| ID | NAME | STATUS | TARGET | EVIDENCE | NOTES |
|---|---|---|---|---|---|
| UX-1 | Active filter chips, individually removable | `VERIFIED` | UX-R1 | `docs/verification/UX_R1_SEARCH_WORKSPACE_RESTORATION_REPORT.md`, `docs/verification/UX_R1_EVIDENCE/` | — |
| UX-2 | "Clear all" (investigation criteria only, never source/scope) | `VERIFIED` | UX-R1 | same | — |
| UX-3 | Per-field EXACT MATCH/CONTAINS truthful labels | `VERIFIED` | UX-R1 | same, cross-checked against `EventFilters.java` | — |
| UX-4 | Advanced Query under More Filters (not a toolbar peer) | `VERIFIED` | UX-R1 | same | — |
| UX-5 | Search remains the toolbar's sole primary action; one-click Live | `VERIFIED` | UX-R1 (search primary confirmed pre-existing + preserved); Live one-click already existed pre-UX-R1 | `OLD_UX_RESTORATION_AUDIT.md` (button hierarchy `SAME`/`KEEP_NEW`), `UX_R1_EVIDENCE/A-search-empty-state.png` | Live's *reconnect* resilience (separate from one-click start) is `VERIFIED` via Slice 5, see UX-13 below |
| UX-6 | Settings — masking-policy visibility panel (informational only, never a reveal action) | `APPROVED_PENDING` | UX-R3 | `OLD_UX_RESTORATION_AUDIT.md` | OLD's own reveal/unmask action is explicitly `OUT_OF_CURRENT_SCOPE` forever — see UX-8 |
| UX-7 | Settings — Remote Docker "Connection name" field | `APPROVED_PENDING` | UX-R3 | `OLD_UX_RESTORATION_AUDIT.md` | minor |
| UX-8 | Reveal/unmask raw sensitive values | `OUT_OF_CURRENT_SCOPE` — permanent, never implement | — | `OLD_UX_RESTORATION_AUDIT.md`; CLAUDE.md §2 rule 5 ("No reveal action for masked values") | OLD itself disabled this outside local dev; NEW never restores it under any circumstance |
| UX-9 | Docker Compose project selector (runtime, request/session-scoped) | `APPROVED_PENDING` | UX-R3 | see §3 below (dedicated section) | — |
| UX-10 | Row click → inspector (mandatory) | `APPROVED_PENDING` | UX-R4 | `OLD_UX_RESTORATION_AUDIT.md` (flagged CRITICAL) | supersedes an earlier Slice 4 deferral — see UX-14 |
| UX-11 | Truthful Newest/Oldest sorting (never silently page-local) | `APPROVED_PENDING` | UX-R4 | `OLD_UX_RESTORATION_AUDIT.md`; backend `SearchRequest#direction` already exists, unused — no new backend capability needed, only wiring | owner-approved with an explicit truthfulness constraint: never claim global sort if only page-local reordering happens |
| UX-12 | Event Inspector Previous/Next position indicator (e.g. "1/100") | `APPROVED_PENDING` | UX-R5 | `OLD_UX_RESTORATION_AUDIT.md` | low-medium priority |
| UX-13 | "Show surrounding logs" reachable from every inspector tab (not just Request Flow + row Actions menu) | `APPROVED_PENDING` | UX-R6 | `OLD_UX_RESTORATION_AUDIT.md` | low priority, nice-to-have, not a named CRITICAL/HIGH item |
| UX-14 | Live's own state visibility (source/project/services/filters/connection) — independent of the confirm-before-start dialog | `OPEN_UNDECIDED` | UX-R5/R6 | `OLD_UX_RESTORATION_AUDIT.md` — the audit itself says: *"a remaining gap in evidence, not a decision left open"* (no OLD Live screenshot was supplied to assess it against) | Genuinely open — not previously tracked as its own row anywhere. Needs either an OLD reference or an explicit owner call before a slice can close it. |
| UX-15 | Live confirm-before-start dialog | `OUT_OF_CURRENT_SCOPE` — permanent, never restore | — | `OLD_UX_RESTORATION_AUDIT.md` — explicit owner decision: one-click start stays | — |
| UX-16 | Live reconnect on drop (auto-retry with backoff) | `VERIFIED` | Slice 5 | `frontend/e2e/phase-legacy-slice5-live-resilience.spec.ts` — passing this session, including "Stop during reconnect cancels the pending retry" | `LEGACY_UX_PARITY_REPORT.md` Task 10's `NEW_WORSE` verdict is `SUPERSEDED` by this |
| UX-17 | Safe-preference persistence allow-list | `APPROVED_PENDING` (extends existing Slice 8 mechanism) | UX-R3 (when the Compose selector ships, since it's on this list) | `OLD_UX_RESTORATION_AUDIT.md`; `frontend/src/features/results/tablePreferences.ts` | Approved to persist: selected source, **selected Compose project**, time preset, severity, query mode, table preferences (col/density — already persisted). Forbidden: free-text query values, raw LogQL, all 5 protected fields, trace/correlation values, results, credentials/tokens/secrets. |
| UX-18 | Row-actions menu, column customization, context/surrounding-logs view, sorting-mechanics-below-the-truthfulness-constraint, Inspector 5-section layout | `VERIFIED` | already shipped (Slice 4, pre-UX-R1) | `OLD_UX_RESTORATION_AUDIT.md` (`SAME`/`KEEP_NEW`, `NEW_BETTER`) | No action needed — audit found no gap |
| UX-19 | Seven-column results table, no reorder | `SUPERSEDED` | Slice 4 | `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` OD-1 | CLAUDE.md's original wording ("exactly seven columns... never reorder") is superseded by owner-approved path "b": seven visible by default, in order, **plus** an optional show/hide/reorder/density control that never changes the default view. This is what Slice 4 actually shipped. |
| UX-20 | 30-minute time-range preset | `OPEN_UNDECIDED` | unassigned | `docs/LEGACY_UX_PARITY_REPORT.md` Task 1: *"OLD's 30-minute default preset has no exact NEW equivalent (nearest is 1h, double the window)... Recommend adding a 30m preset to NEW's set (trivial... flagged here for the owner)"* | **Newly surfaced by this register's own reconciliation pass**, not previously tracked anywhere. `frontend/src/shared/time/presets.ts` confirmed unchanged (`15m/1h/4h/1d/7d`) as of this session. A real, specific, owner-facing recommendation that was never actually approved, rejected, or deferred — do not silently implement it and do not silently drop it. |
| UX-21 | Settings/Docker-connection endpoints beyond Test Connection (e.g. a masking-status endpoint distinct from Docker settings) | `OPEN_UNDECIDED`, low confidence gap | UX-R3 (bundle with UX-6) | `docs/LEGACY_BACKEND_PARITY_REPORT.md` item 32; cross-references UX-6 | Likely subsumed by UX-6's own frontend work reading masking policy from a source the frontend already knows (the 5 fixed field names) rather than needing a dedicated backend endpoint — confirm during UX-R3, don't duplicate scope |

---

## 3. Docker Compose Project Selector (UX-9, detailed)

| Field | Value |
|---|---|
| STATUS | `APPROVED_PENDING` |
| TARGET_SLICE_OR_PHASE | UX-R3 |
| OWNER_DECISION | Settings: Local/Remote Docker → Test Connection → discover real Compose projects → select project → Apply. Selected project visible in the main investigation scope. **Security model: request/session-scoped only — never a global unauthenticated mutation endpoint.** Compatible with `DockerSettingsController`'s existing no-mutation-endpoint design (confirmed this session: it exposes only `connection()` read-only and `testConnection()` ephemeral — no new mutation endpoint is needed, only a request/session-scoped selection mechanism layered on top). Server must enforce canonical Docker Compose project labels (`ComposeLabels`, already the sole mechanism `DockerLogSource#relevantContainers` uses — confirmed this session, never container-name heuristics) as a **hard boundary** across every code path: container discovery, services, historical search, pagination, Live, context, surrounding logs, journey/correlation, counts/stats, relevant metadata. Project switch must prevent stale/cross-project leakage (cancel in-flight requests scoped to the old project). |
| ACCEPTANCE_CRITERIA | Two real Compose projects with intentionally overlapping service names must prove zero cross-project leakage in either direction, for every one of the listed code paths, not just discovery. |
| EVIDENCE | Design-level only — `docs/verification/OLD_UX_RESTORATION_AUDIT.md`'s own "Docker Compose project selector — current state and resolved model" section sketches the concrete shape; not yet implemented. `DockerLogSource.java`/`ComposeLabels.java`/`DockerSettingsController.java` current-state confirmed via direct source reading this session. |
| CURRENT STATE | Backend: a single static, config-time-only value (`DockerProperties#composeProjectFilter`, env var `LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER`), no discovery endpoint, no runtime switch (requires a restart). Frontend: read-only display of the current connection only. |

---

## 4. Known Functional Defect — Search Freshness

| Field | Value |
|---|---|
| STATUS | `VERIFIED` (fixed and verified in UX-R2) |
| CATEGORY | Functional correctness, HIGH priority |
| OWNER_DECISION | Every explicit fresh Search with no pagination cursor must perform a new source query and include newly-created events that fall within the effective current time range. |
| ROOT_CAUSE | `frontend/src/features/timerange/TimeRangeControl.tsx#selectPreset` commits an **absolute** `start`/`end` the instant a relative preset (e.g. "Last 1 hour") is selected. Every later Search/Refresh click reused that same, increasingly stale `end` — `useSearchState.ts`'s `runSearch`/`buildRequestBody` never recomputed it. Not a backend/adapter bug — the backend correctly returns whatever window it's asked for; confirmed by replaying the identical stale window directly against `/api/v1/logs/search` (legitimately excludes the new event) versus a freshly recomputed one (legitimately includes it). |
| FIX | `useSearchState.ts`: a new `recomputeRelativeRange()` helper recomputes a relative preset's effective window (same `presetId`/`durationMs`, `end` advanced to "now") on every explicit fresh `runSearch()` (covers both the Search and Refresh buttons, since Refresh is the same function). A CUSTOM absolute range is never auto-advanced — returns the same object reference, so it's a structural no-op for that case. The recomputed window is also committed back via `setTimeRange`, so the UI honestly reflects what was actually queried (same invariant UX-R1 established for filter chips). `loadMore` (pagination) was deliberately left untouched — it must never recompute mid-pagination. |
| ACCEPTANCE_CRITERIA | Real-Docker before/after reproduction (not Fixture-only) |
| EVIDENCE | See `docs/verification/UX_R2_FILTER_AND_SEARCH_FUNCTIONAL_REPORT.md`'s dedicated `SEARCH_FRESHNESS_DEFECT` section for the full real-Docker before/after evidence, plus `frontend/src/app/useSearchState.test.ts`'s `"UX-R2 — search-freshness defect"` describe block (6 tests, all passing) for fast deterministic regression coverage. |

---

## 5. Known UX/Functional Defect — Live to Search

| Field | Value |
|---|---|
| STATUS | `APPROVED_PENDING` |
| CATEGORY | UX/functional, must be verified in an early UX slice, not silently deferred to Phase M |
| OWNER_DECISION | Required workflow: Search → Start Live → Live mode → Stop/Exit Live/Back to Search → normal Search workspace, with: a clear visible way to exit Live; no page refresh required; the actual live stream genuinely stops (no stale events can keep arriving); previous Search state preserved where practical (source, selected Compose project, filters, time range, table preferences, previous results where safe); keyboard accessible; browser/E2E verified. |
| TARGET_SLICE_OR_PHASE | Earliest appropriate UX slice — **not yet assigned to a specific UX-R slice number; do not silently fold into Phase M** |
| ACCEPTANCE_CRITERIA | As stated above |
| EVIDENCE | Not yet implemented/verified this session — genuinely new to this mission. `frontend/src/features/live/` already has `live.exit()` (used today when the source changes mid-tail, confirmed in `App.tsx`) — likely the mechanism a Stop/Exit control would call, but no dedicated UI verification of the full round-trip exists yet. |
| NOTES / CONFLICTS | No conflicting prior treatment found anywhere in the repo. |

---

## 6. Filter Functional Truth

| Field | Value |
|---|---|
| STATUS | `IN_PROGRESS` → see UX-R2 report for current disposition |
| CATEGORY | Functional correctness |
| OWNER_DECISION | The owner previously reported filtering "appeared not to work." A representative sample (`docs/verification/FILTER_FUNCTIONAL_AUDIT.md`, pre-UX-R2) was explicitly insufficient to close this. UX-R2 must exhaustively verify every relevant filter. |
| TARGET_SLICE_OR_PHASE | UX-R2 (this mission) |
| ACCEPTANCE_CRITERIA | Every field proven with real included AND excluded evidence, not HTTP 200 alone |
| EVIDENCE | `docs/verification/UX_R2_FILTER_AND_SEARCH_FUNCTIONAL_REPORT.md` |

---

## 7. Cross-Platform Desktop Distribution (REL-1)

| ID | REL-1 |
|---|---|
| NAME | Versioned Cross-Platform Desktop Release & Branding |
| STATUS | `APPROVED_PENDING` (tracked, not started) |
| CATEGORY | Distribution |
| OWNER_DECISION | Current required user platforms: **Windows** and **macOS**. Linux: `DEFERRED` / not currently required. Windows target: a versioned installer executable, e.g. `LogExplorer-1.0.0-windows-x64.exe`. macOS target: a normal end-user downloadable `.app` package (preferred format, e.g. DMG, decided at implementation time per standard macOS UX). Do not promise Intel + Apple Silicon until architecture support is explicitly decided — evaluate Apple Silicon, Intel if justified, universal build only if technically/practically appropriate. **GitHub Releases must be the end-user distribution surface** — users must never need to navigate GitHub Actions artifacts for a production release. Example: tag `v1.0.0` with Windows and macOS downloadable assets. Required release behavior: explicit version/tag release; deterministic version from the tag; build on appropriate OS runners; smoke verification before publish; a failed package is never published; SHA-256 checksums; a documented release process; release notes; temporary CI artifacts may remain for CI diagnostics only. |
| TARGET_SLICE_OR_PHASE | Not started — explicitly excluded from UX-R2/R3/R4/R5/R6 |
| ACCEPTANCE_CRITERIA | As stated above |
| EVIDENCE | None yet — genuinely new to this mission, no prior repo mention beyond Windows-only Slice 9 |
| NOTES / CONFLICTS | Slice 9 (merged) is Windows-only and does not itself publish via GitHub Releases (CI artifact only) — REL-1 supersedes/extends Slice 9's distribution story, not its packaging mechanics (jlink/jpackage/Inno Setup remain the Windows build path). Slice 9's own known limitations remain tracked, not silently converted to PASS: |

### 7a. Slice 9 known limitations (carried forward, must remain tracked)

| Item | Status | Evidence |
|---|---|---|
| Port collision handling | `PARTIAL` | `docs/verification/SLICE_9_WINDOWS_DESKTOP_REPORT.md` — "design + code review; free-port path exercised for real, collision/existing-instance paths not yet CI-exercised" |
| Single-instance behavior | `PARTIAL` | same report, same caveat |
| Code signing | Unsigned, by design/honesty, not a defect to silently fix | same report — "no certificate is available in this environment... reported honestly as unsigned rather than self-signed with a fabricated trust claim." Scripted so `[SignTool]` can be added later without restructuring. |
| WebView2 pixel-level rendering | Manual-verification-only | same report — "no UI-automation harness... A human running the installed app and visually confirming the UI renders correctly... remains the one manual step this automation doesn't replace." |
| Port-collision-with-occupied-port scenario | `DEFERRED` | same report — "Not exercised in the hosted CI job." |

---

## 8. Desktop Branding

| Field | Value |
|---|---|
| STATUS | `APPROVED_PENDING` |
| CATEGORY | Distribution / polish |
| OWNER_DECISION | Windows icon correctly applied, as supported, to: application executable, running window, taskbar, Start Menu shortcut, installer, installed application entry (Add/Remove Programs where applicable). macOS: native application icon integration appropriate to its package/app bundle. Canonical branding source assets stored in the repo. Never ship a production release with placeholder/default framework icons. CI/release verification should prove branding resources are actually wired, not merely committed. |
| TARGET_SLICE_OR_PHASE | REL-1 / final hardening, before Phase M |
| ACCEPTANCE_CRITERIA | As stated above |
| EVIDENCE | `desktop/launcher/Resources/app.ico` exists as a committed file (Slice 9) but its wiring into taskbar/Start Menu/installer entries has not been verified against this mission's stricter bar (CI proving it's wired, not just present) |
| NOTES / CONFLICTS | Genuinely new scope — no prior icon/branding verification requirement existed before this mission |

---

## 9. Security (standing, cross-cutting)

| Requirement | STATUS | Notes |
|---|---|---|
| Server-side masking, single boundary, never client-side | `VERIFIED` (standing) | `MaskingService.java`, `SerializationLeakTest`; re-confirmed this session for every one of the 11 newly-tested filter fields — raw sensitive filter values (userName, cif, deviceId, deviceIp) never echoed anywhere in the search response, even when used as the filter itself |
| No reveal/unmask action | `OUT_OF_CURRENT_SCOPE`, permanent | see UX-8 |
| Docker/OpenShift read-only, no cluster-wide RBAC, TLS verification always on | `VERIFIED` (standing) | `docs/SECURITY_NOTES.md` |
| Sensitive-field query matching without raw-value exposure (HMAC vs. raw-value-server-side-only comparison) | `SUPERSEDED` (owner-approved architecture simplification) | `docs/LEGACY_BACKEND_PARITY_REPORT.md` item 8 — OLD used keyed-HMAC token equality; NEW uses a simpler raw-value comparison confined entirely to the adapter/filter layer, same real guarantee, fewer moving parts. Per the owner's explicit "do not copy OLD's architecture" instruction. |
| Free-text redaction of secrets in message/exception content | `VERIFIED` | Slice 7 (`phase-legacy-slice7-redaction.spec.ts`, passing). `docs/LEGACY_BACKEND_PARITY_REPORT.md` item 9's `NEW_WORSE` verdict is `SUPERSEDED` by this. |
| Docker self-exclusion label (app never appears in its own discovery) | `VERIFIED` | `ComposeLabels.EXCLUDED = "logexplorer.excluded"` confirmed present this session in `backend/src/main/java/com/logexplorer/source/docker/ComposeLabels.java`. `docs/LEGACY_BACKEND_PARITY_REPORT.md` item 19's `NEW_WORSE` verdict is `SUPERSEDED` by this. |
| SSRF/DNS-rebinding guard on remote Docker connections | `VERIFIED` | `RemoteHostGuard`, Slice 3. `docs/LEGACY_BACKEND_PARITY_REPORT.md` item 15's depth finding is `SUPERSEDED` by this. |
| OpenShift resource limits/health-probe values are load-tested against real cluster traffic | `OPEN_UNDECIDED` | `docs/SECURITY_NOTES.md`: "conservative starting defaults... not load-tested or tuned against a real cluster's traffic in this session, and should be revisited against real usage." No cluster available to close this from inside this project. |

---

## 10. Performance

No formal numeric performance budget (no "must stay under X kB/ms") is defined anywhere in the repo. The established convention is measure-and-report-delta on every slice (see e.g. `docs/verification/UX_R1_SEARCH_WORKSPACE_RESTORATION_REPORT.md`'s bundle-size before/after table). This register does not invent a budget; if the owner wants one, it should be added here explicitly as a new `APPROVED_PENDING` row with a concrete number.

---

## 11. Accessibility (standing, permanent)

| Requirement | STATUS | Evidence |
|---|---|---|
| WCAG 2.2 AA | `VERIFIED` (standing, never `DEFERRED`/`SUPERSEDED`) | `CLAUDE.md` §7; `HANDOVER.md`; `docs/AUDIT.md` row 84; `docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md` row A11Y-01 (`PRESERVE_AS_IS`); evidenced by `jest-axe` across 20+ component test files plus real-browser zoom/responsive checks in the E2E suite, re-confirmed every UX-R slice |

---

## 12. OpenShift / Loki

| Requirement | STATUS | Evidence |
|---|---|---|
| Loki adapter implementation | `VERIFIED` | `REQUIREMENTS_TRACEABILITY.md` row 2; `LokiLogSourceTest` etc. |
| Live-cluster verification | `DEFERRED` — external blocker (no reachable cluster), not resolvable from inside this project alone | `REQUIREMENTS_TRACEABILITY.md`; `IMPLEMENTATION_PLAN.md` §2; reconfirmed this session (UX-R2's own filter matrix could not reach a real OpenShift/Loki environment either) |

---

## 13. Out of Current Scope

Stable, unchanged since project inception (`CLAUDE.md` §8 / `IMPLEMENTATION_PLAN.md` §11): corporate SSO / per-user OpenShift OAuth, long-term log storage, SIEM, alerting, full APM, log mutation, cross-source single-request query, an application database, cluster-wide production permissions, query/audit persistence, HA/horizontal scale, saved/team queries, retention/DR, scheduled queries, tracing-backend integration, pseudonymized lookup, multi-cluster queries, penetration testing / formal production approval, AI root-cause diagnosis, analytics, production identity features.

**STATUS: `OUT_OF_CURRENT_SCOPE` for every item above.** None were found already (even partially) implemented during this reconciliation pass. Do not enter any future implementation plan unless the owner explicitly revises this list.

---

## 14. Untracked-requirements proof

This register was built by: (a) a full read of `REQUIREMENTS_TRACEABILITY.md`, `IMPLEMENTATION_PLAN.md`, `HANDOVER.md` (2075 lines), `PHASE_PROMPTS.md`, `CLAUDE.md`; (b) a full read of `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md`, `docs/LEGACY_BACKEND_PARITY_REPORT.md`, `docs/LEGACY_UX_PARITY_REPORT.md`, `docs/LEGACY_PARITY_OWNER_SUMMARY.md`, `docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md`, `docs/UX_ACCEPTANCE_REPORT.md`, `docs/AUDIT.md`, `docs/SECURITY_NOTES.md`, `docs/RUN_GUIDE.md`; (c) a full read of every `docs/verification/*.md` report from every merged Legacy Remediation Slice and UX-R1; (d) direct source verification (not assumed) for every claim above marked `VERIFIED` this session, by grep/read against the actual current `backend/`/`frontend/` source; (e) `git log --oneline` across the full merged-PR history for anything a document might have missed.

Two genuinely new, previously-untracked findings surfaced by this pass and now captured above: the 30-minute time-range preset gap (UX-20) and Live's own state-visibility gap independent of the confirm dialog (UX-14). Both are `OPEN_UNDECIDED`, not silently implemented and not silently dropped.

```
UNTRACKED_OWNER_REQUIREMENTS=0
```
