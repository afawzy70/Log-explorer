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
| UX-10 | Row click → inspector (mandatory) | `VERIFIED` | UX-R4 | `frontend/src/features/results/ResultsTable.tsx`; `ResultsTable.rowInteraction.test.tsx` (13 tests: right event opened by click and by keyboard, Actions/journey-link clicks excluded, roving tabindex, `aria-selected`); `frontend/e2e/ux-r4-results-workstation.spec.ts` (real browser, real backend); evidence `docs/verification/UX_R4_EVIDENCE/AFTER-A/C/D-*.png` | supersedes an earlier Slice 4 deferral. The pre-UX-R4 state was proven, not assumed: `getComputedStyle` showed rows with `cursor: auto`, no `tabindex`, and a row click opening nothing (`BEFORE-A-results-default.png`) |
| UX-11 | Truthful Newest/Oldest sorting (never silently page-local) | `VERIFIED` | UX-R4 | `frontend/src/features/results/SortControl.tsx`; `useSearchState.sorting.test.ts` (9 tests, incl. fresh-cursor-on-direction-change); `FixtureLogSourceTest` (exact ordering both directions + mirror-set proof); real-backend and **real-Docker** verification recorded in `docs/verification/UX_R4_RESULTS_WORKSTATION_PROFESSIONAL_UX_REPORT.md`; evidence `AFTER-G/H-*.png` | The truthfulness constraint is met by construction: the direction is a **request parameter the source honors**, never a client-side re-sort. Confirmed empirically before the control was built (both directions, across page boundaries, no duplicates/gaps) on Fixture and on real Docker containers. Real Loki remains unverified — see UX-25 |
| UX-12 | Event Inspector Previous/Next position indicator (e.g. "1/100") | `VERIFIED` | UX-R5 | `frontend/src/features/inspector/InspectorHeader.tsx`; `InspectorPosition.test.tsx` (13 tests incl. 1-based, bounds, polite live region, omitted-when-unknown); `frontend/e2e/ux-r5-inspector-context.spec.ts` (real browser: follows Previous/Next, keyboard `[`/`]`, and grows with Load more); evidence `AFTER-B-position-indicator.png` | Renders "Event 4 of 200 **loaded**". The word "loaded" is deliberate and load-bearing: the backend reports `total` as unknown for several sources and "more available" is normal, so a bare "4 of 200" would assert a global position the app cannot know (§5: "Do not imply global position across events that have not been loaded") |
| UX-13 | "Show surrounding logs" reachable from every inspector tab/section (not just Request Flow + row Actions menu) | `VERIFIED` | **UX-R5** (retargeted from UX-R6 by the UX-R5 mission §14, which asked for the inspector side to be solved now) | `frontend/src/features/inspector/InspectorHeader.tsx` (single inspector-level action) + `InspectorHeader.module.css` (sticky header); `RequestFlowSection.tsx` (the section-local copy removed, not duplicated); `InspectorPosition.test.tsx`; `ux-r5-inspector-context.spec.ts` ("stays visible while reading the LAST section" asserts `toBeInViewport`, and "exactly ONE context action"); evidence `AFTER-J-context-action-visible-while-scrolled.png` | Solved as **one** inspector-level action, never one per section (§14's explicit "do NOT duplicate"). The measured friction was worse than the audit assumed: the action sat 1,261px below the inspector's top, and the panel does not scroll independently (it grows to 9,224px and the *page* scrolls), so simply moving the button to the header would have left it scrolling off screen — `panelTop` measured at -1205px. The sticky header is what actually makes the requirement true |
| UX-14 | Live's own state visibility (source/project/services/filters/connection) — independent of the confirm-before-start dialog | `VERIFIED` — superseded from `OPEN_UNDECIDED` by DEC-B (owner explicitly decided this in the UX-R3 mission message) | UX-R3 | See DEC-B above; `LiveTailPanel.test.tsx`'s 6-state badge-distinctness regression test; live evidence `docs/verification/UX_R3_EVIDENCE/AFTER-G/H/I/J-*.png` | Active-scope (source/Compose project) visibility is now handled separately by `Shell.tsx`'s `ScopeTrail`, always visible including during Live (§12) — not duplicated inside the Live panel itself |
| UX-15 | Live confirm-before-start dialog | `OUT_OF_CURRENT_SCOPE` — permanent, never restore | — | `OLD_UX_RESTORATION_AUDIT.md` — explicit owner decision: one-click start stays | — |
| UX-16 | Live reconnect on drop (auto-retry with backoff) | `VERIFIED` | Slice 5 | `frontend/e2e/phase-legacy-slice5-live-resilience.spec.ts` — passing this session, including "Stop during reconnect cancels the pending retry" | `LEGACY_UX_PARITY_REPORT.md` Task 10's `NEW_WORSE` verdict is `SUPERSEDED` by this |
| UX-17 | Safe-preference persistence allow-list | `APPROVED_PENDING` (extends existing Slice 8 mechanism) | UX-R3 (when the Compose selector ships, since it's on this list) | `OLD_UX_RESTORATION_AUDIT.md`; `frontend/src/features/results/tablePreferences.ts` | Approved to persist: selected source, **selected Compose project**, time preset, severity, query mode, table preferences (col/density — already persisted). Forbidden: free-text query values, raw LogQL, all 5 protected fields, trace/correlation values, results, credentials/tokens/secrets. |
| UX-18 | Row-actions menu, column customization, context/surrounding-logs view, sorting-mechanics-below-the-truthfulness-constraint, Inspector 5-section layout | `VERIFIED` | already shipped (Slice 4, pre-UX-R1) | `OLD_UX_RESTORATION_AUDIT.md` (`SAME`/`KEEP_NEW`, `NEW_BETTER`) | No action needed — audit found no gap |
| UX-19 | Seven-column results table, no reorder | `SUPERSEDED` | Slice 4 | `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` OD-1 | CLAUDE.md's original wording ("exactly seven columns... never reorder") is superseded by owner-approved path "b": seven visible by default, in order, **plus** an optional show/hide/reorder/density control that never changes the default view. This is what Slice 4 actually shipped. |
| UX-20 | 30-minute time-range preset | `VERIFIED` — superseded from `OPEN_UNDECIDED` by DEC-A (owner explicitly approved this in the UX-R3 mission message) | UX-R3 | See DEC-A above; `frontend/src/shared/time/presets.ts` now has `15m/30m/1h/4h/1d/7d`; `useSearchState.test.ts`'s dedicated "UX-R3 §15" describe block (2 tests: recompute-on-Search, Custom-never-moves); live evidence `docs/verification/UX_R3_EVIDENCE/AFTER-F-*.png` | Original recommendation source: `docs/LEGACY_UX_PARITY_REPORT.md` Task 1 |
| UX-22 | Selected row must stay visually obvious while investigating (survives inspector open, Previous/Next, Load more, density/column changes) | `VERIFIED` | UX-R4 | `ResultsTable.module.css` (`.selectedRow` — distinct background **plus** a 4px accent rail, wider than the severity rails so a selected ERROR row still reads as selected); `aria-selected` on the row; `ux-r4-results-workstation.spec.ts` ("selected row survives Load more", "column visibility, reorder and density all preserve the selected row"); evidence `AFTER-D/K/L/M-*.png` | Owner requirement B of the UX-R4 mission. The pre-existing selected style was already reasonable (measured: `rgb(234,241,254)` + 3px inset rail); UX-R4 strengthened the rail to 4px and added `aria-selected`, rather than claiming a defect that did not exist |
| UX-23 | Row Actions must expose **View details** and **Show surrounding logs** | `VERIFIED` | UX-R4 | `frontend/src/features/results/ActionsCell.tsx`; `ActionsCell.test.tsx` (5 UX-R4 tests incl. workflow ordering and the no-timestamp case); `ux-r4-results-workstation.spec.ts`; evidence `AFTER-F-actions-menu.png` | Owner requirement H. Before UX-R4 the menu offered "Inspect event" plus five "Copy …" entries and **no** surrounding-logs action at all — that action existed only inside the inspector's Request Flow section, i.e. only after already opening an event (proven by an assertion in the BEFORE capture, `BEFORE-F-actions-menu.png`). "Inspect event" was deliberately renamed to "View details"; every affected test/spec was updated knowingly, not weakened |
| UX-24 | Returning from "Show surrounding logs" restores the original result set, sort direction and selected row | `VERIFIED` | UX-R4 | `useSearchState.ts` `restoreOriginalSearch` (now restores `sortDirection` and re-validates the saved `selectedIndex`); `useSearchState.sorting.test.ts` §20 test; `ux-r4-results-workstation.spec.ts` ("returning restores the original results"); evidence `AFTER-I/J-*.png` | Owner requirement in §20. Previously the detour return dropped both the committed direction and the selection, so an investigator reading oldest-first silently landed back on newest-first |
| UX-25 | `contextView` capability must tell the truth | `VERIFIED` (Fixture, Docker) / `BLOCKED` (Loki) | UX-R4 | `FixtureLogSource.java`, `DockerLogSource.java` (now declare `contextView = true`); `FixtureLogSourceTest#declaresContextViewTruthfully`; verified against the running backend (a real ±30s context request returned 7 events while the capability said `false`) | **Found during UX-R4, previously untracked.** All three sources declared `contextView = false` while the ±30s context action was offered and worked, and the Source health popover lists "Context" as a capability — so the app both offered the feature and told the user it was unavailable. Nothing gates behaviour on this flag (it is display-only), so correcting it is safe. **Loki deliberately left `false`**: no reachable Loki environment exists here, and this project does not mark unverified things as working |
| UX-26 | Results information hierarchy — the message column must not be the only column that shrinks | `VERIFIED` | UX-R4 | `columnRegistry.tsx` (message column keeps no fixed width, so it still absorbs surplus) + `ResultsTable.module.css` (`min-width` raised 900px → 1266px, giving it a 440px floor); `ux-r4-results-workstation.spec.ts` asserts > 400px with the inspector open | **Found during UX-R4, previously untracked.** Measured in a real browser: opening the inspector collapsed "What happened" to ~140px while Time, User/Customer and Correlation/Trace held their fixed widths — worst exactly when an investigator most needs to read messages. Now 440px in that state (measured), and still 580px at 1440 with no inspector, i.e. no loss in the default view |
| UX-27 | Severity must be scannable at row level without turning the table into a rainbow | `VERIFIED` | UX-R4 | `ResultsTable.tsx` `severityRowClass`; `ResultsTable.rowInteraction.test.tsx` (ERROR/WARN marked, INFO unmarked, level still spelled out in text); evidence `AFTER-E-error-row.png` | **Found during UX-R4, previously untracked.** Measured BEFORE: an ERROR row had no row-level treatment whatsoever (`backgroundColor: rgba(0,0,0,0)`, no border, no shadow) — only a small dot inside the Level cell. ERROR now carries a faint tint + red rail, WARN a rail only, INFO nothing (CLAUDE.md §7: never colour alone — the level text remains) |
| UX-28 | Hover / focus / selected must be three visually distinct row states | `VERIFIED` | UX-R4 | `ResultsTable.module.css`; `ux-r4-results-workstation.spec.ts` ("the three states are three different backgrounds", "hover never erases the selected state") | **Found during UX-R4, previously untracked.** Measured BEFORE: rows had *no* hover style at all (`backgroundColor` identical before and after `hover()`) and were not focusable, so two of the three states did not exist |
| UX-29 | Inspector information hierarchy — a structured investigation surface, not a field dump | `VERIFIED` | UX-R5 | `sections.ts` (Overview's three time rows collapsed to one; thread/schema version demoted to All fields); `AllFieldsSection.tsx` + `InspectorSection.tsx` (`CollapsibleInspectorSection`); `sections.test.ts`, `allFields.test.ts` (demoted fields proved still reachable), `ux-r5-inspector-context.spec.ts` (asserts panel scroll height < 3000px, and that zone/UTC are still rendered) | **Found by measurement during UX-R5.** The inspector was a single ~3,992px scroll in a 900px viewport: Overview spent 3 of its 10 rows restating one instant ("Local time"/"Zone"/"UTC" as peer rows), and "All fields" alone was 1,895px — 47% of the whole panel, more than the four structured sections combined. Now ~1,920px (-52%) with All fields collapsed. **Nothing was removed**: every demoted field is still in All fields, and the zone/UTC values still render on the Time row's secondary line |
| UX-30 | Returning from a context detour restores the inspector state the investigator actually left | `VERIFIED` | UX-R5 | `useSearchState.contextReturn.test.ts` (both entry paths); `ux-r5-inspector-context.spec.ts` (both entry paths in a real browser) | **§25 asked for an A-or-B decision; the evidence says neither as a global rule.** Since UX-R4 there are two ways into a context view — from the inspector (where the investigator was reading an event) and from a results row's Actions menu (where they never opened the inspector). Rule A would conjure an inspector the row-menu user never opened; rule B would close one the inspector user was mid-read of. The committed behaviour is "restore what you left", which is continuity in both paths. It already worked by construction (the snapshot is taken *before* `closeInspector`), but was untested and undocumented — it is now both |
| UX-31 | Request-flow identifier actions must not move between rows | `VERIFIED` | UX-R5 | `RequestFlowSection.tsx` (Copy rendered last, anchored to the trailing edge); `ux-r5-inspector-context.spec.ts` asserts every row's Copy shares the same x within 2px | **Found by measurement during UX-R5.** Copy was rendered first inside a trailing-aligned group, so its horizontal position depended on whether the row also had a "Find this …" action: the Span ID row (the one identifier with no journey action) put its Copy ~330px right of every other row's. Same control, same job, different place on each line |
| UX-32 | Source-scoped discovery must be stale-response protected (services, Compose projects, health) | `VERIFIED` | UX-R6 | `frontend/src/app/useSearchState.ts` (`discoveryGenerationRef`); `useSearchState.discoveryRace.test.ts` (3 tests resolving responses out of order on purpose); rendered-browser proof before/after (service filter listed `caddy`/`db`/`web` under Fixture before, the correct four services after) | **This is the root cause of the "environment-specific" Phase-M Task 1 Playwright failure carried since UX-R4.** It was never environmental and never a test defect: selecting a source fires discovery for the new source while the previous source's requests are still in flight, and none of the three `fetch().then(setState)` chains had any ordering guarantee, so the older response simply overwrote the newer one. It reproduced only where the default `local-docker` source could actually answer (a machine with a running Docker daemon that has containers), which is exactly why CI never saw it. Health carries the source's declared **capabilities**, so the same race could paint one source's capabilities under another's name |
| UX-33 | Inspector scroll model — bounded, viewport-height, sticky column with its own scroll | `VERIFIED` | UX-R6 | `frontend/src/features/inspector/EventInspector.module.css`; `ux-r6-final-polish.spec.ts` §3 block (4 tests); evidence `BEFORE-C-inspector-unbounded-sparse-event.png` vs `AFTER-C-inspector-bounded-sparse-event.png` | See DEC-D for the decision and the evidence behind it. Measured: the panel took the *results column's* height (9,224px) regardless of content, leaving **8,150px of empty panel** for a sparse event, and scrolling the results scrolled the Inspector's content away entirely |
| UX-34 | A failed search must say what failed and offer a way forward | `VERIFIED` | UX-R6 | `frontend/src/features/results/ResultsPanel.tsx`; `ux-r6-final-polish.spec.ts` §11 block (3 tests, incl. one asserting the typed search value never appears in the error copy); evidence `BEFORE-H-error-state.png` vs `AFTER-H-error-state.png` | **Found during UX-R6.** The failed-search state was a bare strip carrying only the backend's sanitized detail, with no statement of what had failed and **no action at all** — while the "Load more" failure path already had an inline Retry. The pattern existed; it had simply never been applied to the primary error |
| UX-35 | Escape closes the top-most transient layer only | `VERIFIED` | UX-R6 | `frontend/src/shared/ui/useDismissableLayer.ts` (`wasConsumedByDismissableLayer`); `useDismissableLayer.test.tsx` (2 new tests); `ux-r6-final-polish.spec.ts` §13 block | **Found during UX-R6.** Popovers cooperate through a layer stack, but the Event Inspector's Escape lives outside that stack, so one Escape closed a row's Actions menu **and** the inspector beneath it. The first fix attempt (checking whether any layer is open) did not work and the measurement said so: layers listen in the capture phase and `ShortcutRegistry` in the bubble phase, and React flushes the layer's close in between, so the stack already read empty. Marking the **event** is immune to that ordering |
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

## 3b. UX-R4 Owner Requirements (A–M) — reconciliation

The UX-R4 mission message restated thirteen owner-approved requirements
(A–M) for the Results investigation workstation. Per this register's own
"do not create duplicate requirements if equivalent rows already exist"
rule, each is mapped below to the row that owns it rather than
re-entered. Nothing in A–M was found to be untracked *after* this pass;
five of them had no owning row before it (UX-22, UX-23, UX-24, UX-26,
UX-27/UX-28) and were added above.

| Mission item | Owning row | Status after UX-R4 |
|---|---|---|
| A. Clicking ANY event row opens/selects that event | UX-10 | `VERIFIED` |
| B. Selected row must remain visually obvious | UX-22 (new) | `VERIFIED` |
| C. Truthful sorting, at minimum Newest/Oldest | UX-11 | `VERIFIED` |
| D. Sorting must reflect real result-set/source semantics, not page-local | UX-11 | `VERIFIED` — direction is a source-honored request parameter; no client-side re-sort exists |
| E. Column visibility remains configurable | UX-19 (Slice 4, superseding CLAUDE.md's original "never reorder") | `VERIFIED` — re-verified this slice, incl. selection surviving the change |
| F. Column order/repositioning remains configurable | UX-19 | `VERIFIED` — re-verified this slice |
| G. Density remains configurable | UX-19 | `VERIFIED` — re-verified this slice |
| H. Row Actions expose View details + Show surrounding logs | UX-23 (new) | `VERIFIED` |
| I. Results scanning must remain fast and information-dense | UX-26, UX-27, UX-28 (new) | `VERIFIED` — and measurably improved: message column floor, row-level severity, real hover/focus states |
| J. The current NEW UX is not accepted merely because it works | Standing evaluation stance (this section) | Applied — UX-R4 changed the table's information hierarchy and interaction model, not just its wiring; see the report's "STILL_OLD_THINKING" classification |
| K. UX-R4 must visibly improve the investigation experience | Standing (this section) | `VERIFIED` — BEFORE/AFTER evidence in `docs/verification/UX_R4_EVIDENCE/`, with the friction each change removes measured, not asserted |
| L. OLD screenshots are a capability/workflow reference, not a visual ceiling | Standing (`OLD_UX_RESTORATION_AUDIT.md`'s own comparison protocol) | Applied — no OLD visual was cloned; OLD's *capabilities* (row click, truthful sort, row-level context action) were restored in a NEW design |
| M. Four Questions foundation remains mandatory | PF-1 | Applied — see the report's "Four Questions assessment" |

---

## 3c. UX Working Method — two complementary project-local skills (DEC-C)

| ID | DEC-C |
|---|---|
| NAME | All remaining UX implementation work uses two complementary project-local skills |
| STATUS | `VERIFIED` (as a working method — both skills exist, are discoverable, and load; see EVIDENCE) |
| CATEGORY | Working method / governance |
| OWNER_DECISION | **All remaining UX implementation work must use two complementary project-local skills: (1) Professional UX Reviewer / `LERUX-1` for diagnosis and acceptance; (2) React Professional UI/UX Designer / `LERDESIGN-1` for visual and interaction design. Designer proposes/designs. Reviewer verifies/accepts. Neither role replaces the other.** |
| TARGET_SLICE_OR_PHASE | Standing/cross-cutting from UX-R5 onward |
| ACCEPTANCE_CRITERIA | Both skills registered, discoverable and loadable in the session doing the work; every UX slice from UX-R5 on follows the four-step sequence (reviewer diagnoses → designer proposes → implement → reviewer verifies); the designer role never self-certifies its own output |
| EVIDENCE | `.claude/skills/log-explorer-professional-ux-reviewer/SKILL.md` (`LERUX-1`, 8768 bytes) and `.claude/skills/react-professional-uiux-designer/SKILL.md` (`LERDESIGN-1`, 16955 bytes), both committed to the repository with valid frontmatter whose `name` matches its directory. Both were invoked and loaded in the UX-R5 session before any implementation began. |
| NOTES / CONFLICTS | The designer skill is **additive** — it does not replace or weaken the reviewer skill, which remains mandatory and sole owner of diagnosis, rendered-browser verification, investigation-workflow analysis, functional truth, accessibility, end-to-end behaviour and evidence-based acceptance. The explicit separation exists so a design can never accept itself: `LERDESIGN-1` produces proposals, `LERUX-1` produces verdicts. Discovery note: the new skill was **not** picked up by the already-running session immediately on creation (a `Skill` invocation returned "Unknown skill"), but was picked up live moments later without any process restart — so the previously-assumed "skills are only indexed at session startup" constraint is not absolute. |

---

## 3d. UX-R6 Decision — Inspector scroll model (DEC-D)

| ID | DEC-D |
|---|---|
| NAME | The desktop Event Inspector is a bounded, viewport-height, sticky column with its own scroll |
| STATUS | `VERIFIED` |
| CATEGORY | Structural layout |
| OWNER_DECISION | UX-R6 §3 asked for an evidence-backed choice between (A) retaining the page-scroll architecture, (B) a bounded independently-scrolling Inspector, or (C) another evidence-backed layout, and explicitly warned against choosing B "merely because it sounds architecturally cleaner". **Option C was chosen**: the panel is bounded to the viewport and sticky, with its own internal scroll, while the results list keeps the ordinary page scroll. |
| EVIDENCE FOR CHANGING | Measured at 1440×900 on the real app: the panel was a stretched flex child taking the *results column's* height (9,224px) **regardless of its own content**, so inspecting the fixture's sparse malformed line left **8,150px of empty white panel**; and because the panel flowed with the page, scrolling the results scrolled the Inspector's content out of view, leaving only UX-R5's sticky header — the Inspector degraded to a header-only strip exactly when an investigator wants to read an event *and* keep scanning. |
| EVIDENCE AGAINST A FULL REWRITE | Three properties were measured and found **already correct**, and a wholesale bounded-layout rewrite risked all three for no gain: the clicked row does not move when the panel opens (0px displacement at every scroll depth tested), focus returns to the originating row on Escape, and there is no page-level horizontal overflow at any width. Narrow viewports (≤1024px) were *already* a bounded fixed sheet and were left untouched. |
| ACCEPTANCE_CRITERIA | No double-scroll confusion; no trapped scrolling; no horizontal overflow; Results table remains usable; sticky header still correct; Escape/focus unchanged; narrow layout unchanged; scrolling the Inspector must not silently scroll Results; Results selection stable |
| EVIDENCE | `ux-r6-final-polish.spec.ts` §3 block: panel height ≤ viewport, Overview and the context action still in viewport while the results are scrolled to 3000px, `overscroll-behavior: contain` asserted on the Inspector's own scroll container, and 0px row displacement on open. Full UX-R4 + UX-R5 + geometry suites re-run green (63/63) after the change. |
| NOTES / CONFLICTS | Supersedes UX-R5's own "candidate for UX-R6" note, which proposed a bounded panel as the structural fix but deliberately deferred it. Under CSS `zoom`, `100vh` resolves against the unzoomed viewport, so at 125%/200% the panel is proportionally taller than the visible area; measured as still usable (Overview, position indicator and the context action all in view, internal scroll working, no overflow) and recorded rather than hidden. |

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
| Live-cluster verification | `DEFERRED` — external blocker (no reachable cluster), not resolvable from inside this project alone | `REQUIREMENTS_TRACEABILITY.md`; `IMPLEMENTATION_PLAN.md` §2; reconfirmed in UX-R2, UX-R4, UX-R5 and UX-R6, all of which recorded `REAL_LOKI=BLOCKED` |

### 12a. OS-A — first-class OpenShift direct logging (assessment complete, implementation not started)

All rows below are **owner-approved direction recorded by the OS-A
assessment mission**. OS-A was an architecture/feasibility mission only:
**no OpenShift code was written**, and no production behaviour changed.
Full reasoning, with fact/assumption separation, is in
`docs/architecture/OPENSHIFT_DIRECT_LOGGING_ARCHITECTURE_ASSESSMENT.md`.

| ID | NAME | STATUS | TARGET | NOTES |
|---|---|---|---|---|
| OS-1 | OpenShift becomes a **first-class product source** (`openshift`), backed by the Kubernetes/OpenShift API directly | `APPROVED_PENDING` | OS-1A…1F | The current `openshift-loki` source is architecturally a *deployed-in-cluster* component (service-account token mount, one fixed namespace, zero discovery) while the product is a *developer desktop application* — the mismatch, not the UX, is why it never felt first-class |
| OS-2 | **Local desktop architecture**: no Log Explorer deployment inside OpenShift is required | `APPROVED_PENDING` | OS-1A | Direct mode uses the same API server, network route and credential as `oc login`. Published rule: "if `oc login` works from this machine, Log Explorer should work through the same route" |
| OS-3 | **Safe `oc login` import** — parse only, never execute | `APPROVED_PENDING` | OS-1A | Strict whitelist parser extracting only server URL, token and CA; **rejects** (never sanitizes) any input containing shell metacharacters. `OC_BINARY_RUNTIME_DEPENDENCY=NO` |
| OS-4 | **Direct pod-log provider** as the primary provider | `APPROVED_PENDING` | OS-1C | Kubernetes pod-log API: current + `previous` logs, `sinceTime`, `timestamps`, `tailLines`, `limitBytes`, `container`, `follow` |
| OS-5 | Scope hierarchy **Cluster → Project → Workload → Pod → Container**, each level optional after Project | `APPROVED_PENDING` | OS-1B | UI says "Project", backend says `namespace`; both shown in the Inspector so the language stays truthful |
| OS-6 | **Bounded fan-out is mandatory** — Project required; caps on pods, containers, concurrency, lines, bytes, time range; visible truncation | `APPROVED_PENDING` | OS-1C | Builds on existing `SearchGuardrailsProperties` (incl. its existing `perSourceMaxTimeRange`). Proposed numeric defaults are **starting points to calibrate against a real cluster**, explicitly not evidence-backed finals |
| OS-7 | **Token security**: session/in-memory only, wrapped in the existing `RawToken`, never logged/persisted/echoed/in-URL; connect endpoint refuses on a non-loopback bind | `APPROVED_PENDING` | OS-1A | This is the product's **first runtime credential intake** — `DockerSettingsController` is read-only + ephemeral test, and there is no authenticated admin boundary, so the loopback guard is what makes an unauthenticated local token endpoint acceptable |
| OS-8 | **TLS verification always on**; enterprise/private CA supported; `--insecure-skip-tls-verify` **refused**, not honoured | `APPROVED_PENDING` | OS-1A | Reuses the proven `LokiWebClientFactory` + `CompositeX509TrustManager` pattern (extra CA on top of JVM defaults, never trust-all) |
| OS-9 | **RBAC inheritance** — namespace-scoped discovery only; no cluster-admin assumed; partial permissions produce visibly partial results | `APPROVED_PENDING` | OS-1B | 401 → re-auth; 403 on a namespace → omit, never fabricate as empty; one inaccessible pod among several → partial result with the gap reported |
| OS-10 | **Truthful source-specific ordering/pagination** — deterministic k-way merge over a fully materialised window; window-narrowing instead of cursors; never simulate pagination in React | `APPROVED_PENDING` | OS-1C | The pod-log API has no cursor and no backwards search. If the existing cursor contract cannot express this honestly, report `pagination` as unsupported rather than fake one |
| OS-11 | **Capability model extended additively** (`projectDiscovery`, `workloadDiscovery`, `podDiscovery`, `pagination`, `globalSort`, `correlationSearch`), computed from the active provider and connection state | `APPROVED_PENDING` | OS-1C | UX-R4 already had to correct a capability that lied (`contextView`), so vague capabilities have a demonstrated cost here |
| OS-12 | **Loki becomes an aggregated/historical provider behind OpenShift**, not a peer user-facing source | `OPEN_UNDECIDED` — direction proposed, final fold-in gated | OS-1G | Migration strategy **A (additive first)**: keep `openshift-loki` visible during OS-1A…1F. Folding in is gated on real-Loki verification existing, or an explicit owner decision to restructure an adapter that has never run against its real backend |
| OS-13 | **Real OpenShift verification** on Red Hat Developer Sandbox | `APPROVED_PENDING` | OS-1A onward | Verified externally: free, 30-day renewable, "shared, multi-tenant", "Pods are automatically deleted after running for 12 consecutive hours". Direct mode needs only namespace-scoped rights → `FEASIBLE`. The 12h pod deletion is an **asset**: free, repeatable pod churn for the hardest test cases |
| OS-14 | **Three-layer test pyramid**; normal CI stays deterministic and credential-free | `APPROVED_PENDING` | OS-1A onward | Layer 1 unit/contract · Layer 2 fake Kubernetes API · Layer 3 opt-in real sandbox that **skips cleanly without credentials** |
| OS-15 | **Enterprise proxy support** (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`) | `OPEN_UNDECIDED` — **unverified assumption**, must be checked before OS-1A is estimated | OS-1A | Reactor Netty is *assumed* not to honour these automatically. If that holds, proxy handling is real work that belongs in the connection slice rather than being discovered late |
| OS-16 | **Release order**: UX-R6 → OS-A → OS-1A…1F → REL-1 → Final Parity + Hardening → Phase M | `APPROVED_PENDING` | — | Confirmed as owner-stated. Flagged for the owner: REL-1 and OS-1x are independent, so REL-1-first is defensible if an earlier desktop release is wanted — a genuine owner choice, not a settled fact |
| OS-17 | **Multi-cluster / multiple simultaneous OpenShift connections** | `OUT_OF_CURRENT_SCOPE` — unchanged | — | Already excluded by `CLAUDE.md` §8. This is what makes a **single** `OpenShiftLogSource` bean correct: `LogSourceRegistry` is immutable after construction, `PageCursorCodec` binds `sourceId` into the cursor HMAC, and UX-17 persists the selected source id. "Add Source → OpenShift" is therefore read as *configure and connect the OpenShift source* |

---

## 13. Out of Current Scope

Stable, unchanged since project inception (`CLAUDE.md` §8 / `IMPLEMENTATION_PLAN.md` §11): corporate SSO / per-user OpenShift OAuth, long-term log storage, SIEM, alerting, full APM, log mutation, cross-source single-request query, an application database, cluster-wide production permissions, query/audit persistence, HA/horizontal scale, saved/team queries, retention/DR, scheduled queries, tracing-backend integration, pseudonymized lookup, multi-cluster queries, penetration testing / formal production approval, AI root-cause diagnosis, analytics, production identity features.

**STATUS: `OUT_OF_CURRENT_SCOPE` for every item above.** None were found already (even partially) implemented during this reconciliation pass. Do not enter any future implementation plan unless the owner explicitly revises this list.

---

## 14. Untracked-requirements proof

This register was built by: (a) a full read of `REQUIREMENTS_TRACEABILITY.md`, `IMPLEMENTATION_PLAN.md`, `HANDOVER.md` (2075 lines), `PHASE_PROMPTS.md`, `CLAUDE.md`; (b) a full read of `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md`, `docs/LEGACY_BACKEND_PARITY_REPORT.md`, `docs/LEGACY_UX_PARITY_REPORT.md`, `docs/LEGACY_PARITY_OWNER_SUMMARY.md`, `docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md`, `docs/UX_ACCEPTANCE_REPORT.md`, `docs/AUDIT.md`, `docs/SECURITY_NOTES.md`, `docs/RUN_GUIDE.md`; (c) a full read of every `docs/verification/*.md` report from every merged Legacy Remediation Slice and UX-R1; (d) direct source verification (not assumed) for every claim above marked `VERIFIED` this session, by grep/read against the actual current `backend/`/`frontend/` source; (e) `git log --oneline` across the full merged-PR history for anything a document might have missed.

Two genuinely new, previously-untracked findings surfaced by the UX-R2 pass and were captured above: the 30-minute time-range preset gap (UX-20) and Live's own state-visibility gap independent of the confirm dialog (UX-14). Both were `OPEN_UNDECIDED`, not silently implemented and not silently dropped; both are now `VERIFIED` via UX-R3.

**OS-A pass (assessment only).** The OS-A mission added seventeen
OpenShift rows (§12a) recording owner direction that had never been
tracked anywhere: first-class OpenShift source, desktop-local
architecture, safe `oc login` import, the direct pod-log provider, the
project/workload/pod/container hierarchy, bounded fan-out, the token and
TLS security models, RBAC inheritance, source-specific ordering, the
capability extension, Loki's future role, real-environment verification,
the test pyramid, proxy support, release order, and the standing
multi-cluster exclusion. Two are deliberately `OPEN_UNDECIDED` rather
than assumed settled: **OS-12** (folding Loki behind OpenShift, gated on
real-Loki verification that has never existed) and **OS-15** (enterprise
proxy behaviour, an unverified assumption about Reactor Netty that must be
checked before OS-1A is estimated). No OpenShift code was written.

**UX-R6 pass.** Four further previously-untracked findings surfaced, all
by measuring the rendered application, and all are tracked above: the
stale-response race in source-scoped discovery (UX-32) — which turned out
to be the **root cause of the long-unexplained "environment-specific"
Phase-M Playwright failure**, so that item is now closed as a real product
defect rather than carried as test debt; the Inspector's unbounded panel
and its 8,150px void (UX-33, decided as DEC-D); the failed-search state
having no way forward (UX-34); and Escape closing a popover *and* the
panel beneath it (UX-35). Two of the four corrected a wrong first
diagnosis mid-investigation — the scroll-model review nearly recorded
"the clicked row is displaced on open", which measurement disproved (0px),
and the Escape fix's first implementation was shown by measurement not to
work at all.

**UX-R5 pass.** Three further previously-untracked findings surfaced, all
again by measuring the rendered application rather than reading source,
and all are tracked above: the inspector's ~3,992px scroll height with
"All fields" alone accounting for 47% of it (UX-29); the context detour's
return behaviour being correct-by-accident but untested and undocumented,
with the §25 A-or-B question actually having a third, better answer
(UX-30); and the Request-flow "Copy" action changing horizontal position
between rows depending on whether that row had a second action (UX-31).
One tracked item was **retargeted rather than deferred**: UX-13 moved from
UX-R6 to UX-R5 because the mission asked for the inspector side to be
solved now. A measurement also corrected a wrong assumption made earlier
in this same session — the inspector panel does *not* scroll
independently, so its header had to be made sticky for the single
inspector-level context action to genuinely be reachable "from anywhere".

**UX-R4 pass.** Five further previously-untracked findings surfaced, all
by measuring the real rendered application rather than by reading source,
and all are now tracked above rather than silently fixed or silently
dropped: the `contextView` capability declaring `false` for sources where
the context action demonstrably works (UX-25); the message column being
the only width-less column and therefore the only one that shrank
(UX-26); ERROR rows carrying no row-level treatment at all (UX-27); rows
having no hover state and no focus state whatsoever (UX-28); and the
selected-row/sort-direction loss when returning from a context detour
(UX-24). One further pre-existing defect was found and is recorded in the
UX-R4 report rather than here because it is a test-environment issue, not
a product requirement: two E2E specs (`phase-m-ux-acceptance`,
`phase-legacy-slice2-query-transparency`) fail locally on the service
multi-select, and were confirmed to fail identically on unmodified `main`
(commit `f237ebd`), so they are neither introduced nor masked by UX-R4.

```
UNTRACKED_OWNER_REQUIREMENTS=0
```
