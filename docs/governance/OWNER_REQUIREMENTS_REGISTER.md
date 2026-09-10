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
| UX-6 | Settings — masking-policy visibility panel (informational only, never a reveal action) | `VERIFIED` | UX-R3 | `frontend/src/features/settings/DockerSettingsPanel.tsx` (new "Protected field masking" section); `DockerSettingsPanel.test.tsx` (5 dedicated tests, including "no reveal/unmask/copy action"); live evidence `docs/verification/UX_R3_EVIDENCE/AFTER-B-*.png` | OLD's own reveal/unmask action is explicitly `OUT_OF_CURRENT_SCOPE` forever — see UX-8 |
| UX-7 | Settings — Remote Docker "Connection name" field | `VERIFIED` | UX-R3 | `backend/src/main/java/com/logexplorer/config/DockerProperties.java` (`connectionName` field, REMOTE-only, cosmetic), `DockerSettingsController.java`, `DockerConnectionSummaryDto.java`; `frontend/src/features/settings/DockerSettingsPanel.tsx`; `DockerSettingsPanel.test.tsx` (3 dedicated tests: populated, "Not set", never shown for LOCAL) | Live screenshot shows the field's row only when the dev environment's real connection is actually REMOTE, which this dev environment is not — the populated-value case is evidenced by the component test instead, honestly |
| UX-8 | Reveal/unmask raw sensitive values | `OUT_OF_CURRENT_SCOPE` — permanent, never implement | — | `OLD_UX_RESTORATION_AUDIT.md`; CLAUDE.md §2 rule 5 ("No reveal action for masked values") | OLD itself disabled this outside local dev; NEW never restores it under any circumstance |
| UX-9 | Docker Compose project selector (runtime, request/session-scoped) | `VERIFIED` | UX-R3 | see §3 below (dedicated section) — real two-project overlapping-service-name isolation proof across discovery/services/search/pagination/Live/context, all directions, zero leakage | — |
| UX-10 | Row click → inspector (mandatory) | `APPROVED_PENDING` | UX-R4 | `OLD_UX_RESTORATION_AUDIT.md` (flagged CRITICAL) | supersedes an earlier Slice 4 deferral — see UX-14 |
| UX-11 | Truthful Newest/Oldest sorting (never silently page-local) | `APPROVED_PENDING` | UX-R4 | `OLD_UX_RESTORATION_AUDIT.md`; backend `SearchRequest#direction` already exists, unused — no new backend capability needed, only wiring | owner-approved with an explicit truthfulness constraint: never claim global sort if only page-local reordering happens |
| UX-12 | Event Inspector Previous/Next position indicator (e.g. "1/100") | `APPROVED_PENDING` | UX-R5 | `OLD_UX_RESTORATION_AUDIT.md` | low-medium priority |
| UX-13 | "Show surrounding logs" reachable from every inspector tab (not just Request Flow + row Actions menu) | `APPROVED_PENDING` | UX-R6 | `OLD_UX_RESTORATION_AUDIT.md` | low priority, nice-to-have, not a named CRITICAL/HIGH item |
| UX-14 | Live's own state visibility (source/project/services/filters/connection) — independent of the confirm-before-start dialog | `VERIFIED` — superseded from `OPEN_UNDECIDED` by DEC-B (owner explicitly decided this in the UX-R3 mission message) | UX-R3 | See DEC-B above; `LiveTailPanel.test.tsx`'s 6-state badge-distinctness regression test; live evidence `docs/verification/UX_R3_EVIDENCE/AFTER-G/H/I/J-*.png` | Active-scope (source/Compose project) visibility is now handled separately by `Shell.tsx`'s `ScopeTrail`, always visible including during Live (§12) — not duplicated inside the Live panel itself |
| UX-15 | Live confirm-before-start dialog | `OUT_OF_CURRENT_SCOPE` — permanent, never restore | — | `OLD_UX_RESTORATION_AUDIT.md` — explicit owner decision: one-click start stays | — |
| UX-16 | Live reconnect on drop (auto-retry with backoff) | `VERIFIED` | Slice 5 | `frontend/e2e/phase-legacy-slice5-live-resilience.spec.ts` — passing this session, including "Stop during reconnect cancels the pending retry" | `LEGACY_UX_PARITY_REPORT.md` Task 10's `NEW_WORSE` verdict is `SUPERSEDED` by this |
| UX-17 | Safe-preference persistence allow-list | `APPROVED_PENDING` (extends existing Slice 8 mechanism) | UX-R3 (when the Compose selector ships, since it's on this list) | `OLD_UX_RESTORATION_AUDIT.md`; `frontend/src/features/results/tablePreferences.ts` | Approved to persist: selected source, **selected Compose project**, time preset, severity, query mode, table preferences (col/density — already persisted). Forbidden: free-text query values, raw LogQL, all 5 protected fields, trace/correlation values, results, credentials/tokens/secrets. |
| UX-18 | Row-actions menu, column customization, context/surrounding-logs view, sorting-mechanics-below-the-truthfulness-constraint, Inspector 5-section layout | `VERIFIED` | already shipped (Slice 4, pre-UX-R1) | `OLD_UX_RESTORATION_AUDIT.md` (`SAME`/`KEEP_NEW`, `NEW_BETTER`) | No action needed — audit found no gap |
| UX-19 | Seven-column results table, no reorder | `SUPERSEDED` | Slice 4 | `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` OD-1 | CLAUDE.md's original wording ("exactly seven columns... never reorder") is superseded by owner-approved path "b": seven visible by default, in order, **plus** an optional show/hide/reorder/density control that never changes the default view. This is what Slice 4 actually shipped. |
| UX-20 | 30-minute time-range preset | `VERIFIED` — superseded from `OPEN_UNDECIDED` by DEC-A (owner explicitly approved this in the UX-R3 mission message) | UX-R3 | See DEC-A above; `frontend/src/shared/time/presets.ts` now has `15m/30m/1h/4h/1d/7d`; `useSearchState.test.ts`'s dedicated "UX-R3 §15" describe block (2 tests: recompute-on-Search, Custom-never-moves); live evidence `docs/verification/UX_R3_EVIDENCE/AFTER-F-*.png` | Original recommendation source: `docs/LEGACY_UX_PARITY_REPORT.md` Task 1 |
| UX-21 | Settings/Docker-connection endpoints beyond Test Connection (e.g. a masking-status endpoint distinct from Docker settings) | `OPEN_UNDECIDED`, low confidence gap | UX-R3 (bundle with UX-6) | `docs/LEGACY_BACKEND_PARITY_REPORT.md` item 32; cross-references UX-6 | Likely subsumed by UX-6's own frontend work reading masking policy from a source the frontend already knows (the 5 fixed field names) rather than needing a dedicated backend endpoint — confirm during UX-R3, don't duplicate scope |

---

## 3. Docker Compose Project Selector (UX-9, detailed)

| Field | Value |
|---|---|
| STATUS | `VERIFIED` |
| TARGET_SLICE_OR_PHASE | UX-R3 |
| OWNER_DECISION | Settings: Local/Remote Docker → Test Connection → discover real Compose projects → select project → Apply. Selected project visible in the main investigation scope. **Security model: request/session-scoped only — never a global unauthenticated mutation endpoint.** Compatible with `DockerSettingsController`'s existing no-mutation-endpoint design (confirmed this session: it exposes only `connection()` read-only and `testConnection()` ephemeral — no new mutation endpoint is needed, only a request/session-scoped selection mechanism layered on top). Server must enforce canonical Docker Compose project labels (`ComposeLabels`, already the sole mechanism `DockerLogSource#relevantContainers` uses — confirmed this session, never container-name heuristics) as a **hard boundary** across every code path: container discovery, services, historical search, pagination, Live, context, surrounding logs, journey/correlation, counts/stats, relevant metadata. Project switch must prevent stale/cross-project leakage (cancel in-flight requests scoped to the old project). |
| ACCEPTANCE_CRITERIA | Two real Compose projects with intentionally overlapping service names must prove zero cross-project leakage in either direction, for every one of the listed code paths, not just discovery. |
| EVIDENCE | **Backend implemented this session**: `GET /api/v1/sources/{id}/compose-projects` (discovery, `DockerLogSource#discoverComposeProjects`, canonical `com.docker.compose.project` label only, deliberately bypasses the static-filter fallback so discovery is never itself scoped); `composeProject` threaded as an optional request-scoped field through `SearchRequest`/`FollowRequest`/`SearchRequestDto`/`ContextRequestDto`/`JourneyRequestDto`/`GET .../services`/`GET /api/v1/logs/live`; `DockerLogSource#relevantContainers` (3-arg) is the single hard-boundary chokepoint every caller routes through, per-request project taking precedence over the static deployment-time filter, fail-safe by construction (equality-based label match can never accidentally match a bogus/malicious project string). Unit coverage: `DockerLogSourceTest` — `perRequestComposeProjectIsolatesOverlappingSameNamedServicesInEitherDirection`, `discoverServicesScopedToOneProjectNeverSeesTheOverlappingSameNamedServiceInTheOtherProject`, `followRespectsThePerRequestComposeProjectForOverlappingSameNamedServices`, `aMaliciousOrInvalidComposeProjectStringSafelyMatchesZeroContainersRatherThanFailingOpen` (54/54 passing). **Frontend implemented this session**: `ComposeProjectSelect.tsx` (toolbar control, gated on `composeProjectScoping`), `Shell.tsx`'s `ScopeTrail` (always-visible active scope), `useSearchState.ts`'s project-switch lifecycle (abort in-flight request, clear result/pagination/inspector/breadcrumb/journey state immediately, refetch scoped services, never auto-fires a new search) — covered by `useSearchState.test.ts`'s "Compose project scope (UX-R3 §9/§11)" describe block. **Real two-project overlapping-service-name Docker isolation proof**: complete (two live Compose projects `uxr3-project-a`/`uxr3-project-b`, each with an identically-named `api` service, unique log markers `UXR3-ISOLATION-MARKER-PROJECT-{A,B}-N`, torn down cleanly afterward) — discovery, service discovery, search, pagination, Live (SSE), context, and the malicious/invalid-project-string case all proven live via curl against the real dev backend and real Docker Engine, zero leakage in either direction; see `docs/verification/UX_R3_COMPOSE_LIVE_PROFESSIONAL_UX_REPORT.md` for the full evidence table. |
| CURRENT STATE | Backend: request-scoped `composeProject` now layered on top of the pre-existing static `DockerProperties#composeProjectFilter` (which still applies as a fallback when no per-request value is supplied — fully backward compatible). Frontend: `ComposeProjectSelect` in the toolbar, `ScopeTrail` in the header. |

---

## 3a. UX-R3 Owner Decisions (A–F)

Persisted verbatim from the UX-R3 mission message, before implementation began, per that mission's own explicit instruction not to rely on chat as the source of truth. Each row below is one of the mission's six lettered decisions; status reflects this session's actual implementation/verification progress, not intent.

| ID | Decision | STATUS | TARGET | EVIDENCE | NOTES |
|---|---|---|---|---|---|
| DEC-A | Add "Last 30 minutes" to relative time presets, using the same moving-relative recompute semantics UX-R2 established (`recomputeRelativeRange`); never convert a Custom absolute range into a moving one. | `VERIFIED` | UX-R3 | `frontend/src/shared/time/presets.ts` (`30m` entry added) — the mechanism is fully generic over this table by id/durationMs, confirmed by direct source read this session, so no other code change was needed; `useSearchState.test.ts`'s dedicated "UX-R3 §15" describe block; live evidence `AFTER-F-*.png`. | Same decision as UX-20 below; this row is the mission's own canonical phrasing, UX-20 is kept as the earlier-surfaced tracking row and cross-referenced rather than duplicated. |
| DEC-B | Live mode must visibly communicate state — at minimum CONNECTING, LIVE, PAUSED, RECONNECTING, STOPPED where the real runtime state machine supports them; never invent states the state machine doesn't have; the user must never have to guess whether they're looking at historical Search or a live stream. | `VERIFIED` | UX-R3 | `frontend/src/features/live/LiveTailPanel.tsx` — the state badge itself now carries distinct text+tone per state (previously always read "LIVE" regardless of state; friction found via real rendered evidence, `docs/verification/UX_R3_EVIDENCE/BEFORE-K-live-paused.png`); `LiveTailPanel.test.tsx`'s 6-state badge-distinctness regression test; live evidence `AFTER-G/H/I/J-*.png`. | Same decision as UX-14 below; superseding UX-14's `OPEN_UNDECIDED` status now that the owner has explicitly decided it (this mission), not merely flagged a gap. |
| DEC-C | An obvious, direct, keyboard-accessible way to exit Live and return to Search, no page refresh, preserving investigation state where safe/meaningful. | `IN_PROGRESS` | UX-R3 | The pre-existing "← Back to search results" button (`live.exit`) already satisfies most of this; UX-R3's own addition is the Compose-project-switch case (`App.tsx`'s new `previousComposeProjectRef` effect calls `live.exit()`, mirroring the pre-existing source-change effect) — verified via `frontend/src/app/App.liveComposeProjectSwitch.test.tsx`. Keyboard-accessibility re-verification against real rendered evidence pending. | Same decision as item 5 ("Live to Search") below. |
| DEC-D | UX-R3 through UX-R6 must use the project skill at `.claude/skills/log-explorer-professional-ux-reviewer/SKILL.md` (protocol LERUX-1); must not silently accept "Unknown skill" forever — UX-R3 must diagnose the discovery/activation problem. | `VERIFIED` (diagnosis); manual-fallback in effect for the rest of UX-R3 | UX-R3 | Diagnosed via a fresh (non-fork) `claude-code-guide` agent this session: Claude Code indexes `.claude/skills/*` exactly once, at session/process startup — there is no mid-session rescan. A skill added to the repo (even committed to `main`) after the current session started can never become discoverable within that same continuously-running session. Confirmed via `/skill-doctor` (the skill loads correctly in a *freshly started* session) and Claude Code's own "Startup Performance" documentation ("Skills are indexed once at session start"). No trust/permission gate and no missing-frontmatter issue was found. | `UX_SKILL_REGISTERED=YES` (file exists, correct frontmatter) / `UX_SKILL_DISCOVERABLE=YES in a fresh session, NO in this one` / `UX_SKILL_LOADED=NO this session` / `BLOCKER=session-lifetime skill-indexing cache, proven not a repo/config defect` / `MANUAL_FALLBACK_USED=YES` — SKILL.md read directly and LERUX-1 followed manually for all of UX-R3's design decisions in this document and in `docs/verification/UX_R3_COMPOSE_LIVE_PROFESSIONAL_UX_REPORT.md`. |
| DEC-E | The current NEW implementation is not automatically a finished UX baseline; OLD screenshots remain a capability/workflow/density *reference*, never a design ceiling; CURRENT NEW UI is not accepted merely because it works — from UX-R3 onward the goal is a modern professional investigation workstation, improving UX wherever evidence shows friction. | `ACKNOWLEDGED` (standing evaluation posture, not a single deliverable) | UX-R3 onward | This session's own BEFORE evidence capture (`docs/verification/UX_R3_EVIDENCE/BEFORE-*.png`) and the resulting Live-badge redesign are the first concrete application of this posture — friction was found by looking at real rendered UI, not assumed absent because the code "already worked." | `ACKNOWLEDGED` is not one of the register's eight formal statuses (§ "Status vocabulary") because this decision is a standing evaluation lens like PF-1, not a single closeable requirement — tracked here for completeness per the mission's explicit instruction to persist it, not to force it into a status it doesn't fit. |
| DEC-F | Reconfirm the four investigation questions (WHO/WHAT/WHY/WHERE) as top-level Product Foundation; never fabricate WHY. | `VERIFIED` (unchanged from PF-1) | Standing | See PF-1 above; WHERE specifically must materially improve in this slice (§20 of the mission) via the active-scope trail in `Shell.tsx` — `frontend/src/app/Shell.test.tsx`. | No new decision — the mission restates PF-1 verbatim as part of this slice's own decision set. |

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
| STATUS | `IN_PROGRESS` |
| CATEGORY | UX/functional, must be verified in an early UX slice, not silently deferred to Phase M |
| OWNER_DECISION | Required workflow: Search → Start Live → Live mode → Stop/Exit Live/Back to Search → normal Search workspace, with: a clear visible way to exit Live; no page refresh required; the actual live stream genuinely stops (no stale events can keep arriving); previous Search state preserved where practical (source, selected Compose project, filters, time range, table preferences, previous results where safe); keyboard accessible; browser/E2E verified. |
| TARGET_SLICE_OR_PHASE | UX-R3 (see DEC-C above) |
| ACCEPTANCE_CRITERIA | As stated above |
| EVIDENCE | The pre-existing "← Back to search results" button/`live.exit()` already covers the source-change case (`App.tsx`). UX-R3 adds the Compose-project-switch case: `App.tsx`'s new `previousComposeProjectRef` effect calls `live.exit()` on project change; proven via a real `<App />` integration test, `frontend/src/app/App.liveComposeProjectSwitch.test.tsx` ("exits Live... closing the real EventSource... the instant the selected Compose project changes"). Keyboard-accessibility re-verification against real rendered evidence still pending. |
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
