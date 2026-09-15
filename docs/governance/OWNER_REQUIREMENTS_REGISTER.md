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
| UX-6 | Settings — masking-policy visibility panel (informational only, never a reveal action) | `SUPERSEDED` — see PCFR-2/PCFR-3 | UX-R3 → superseded by Pre-Closure Functional Recovery | `frontend/src/features/settings/PrivacyMaskingSettingsPanel.tsx` (replaces the removed `DockerSettingsPanel.tsx` "Protected field masking" section) | The UX-R3 panel was purely informational (5 fixed field names, no control). Pre-Closure Functional Recovery §"C/D" moved it out of Docker Settings into its own global, source-independent panel AND added a real per-field masked/unmasked policy toggle — still never a per-row reveal action (UX-8's specific prohibition holds); see PCFR-3 for the exact scope of what changed |
| UX-7 | Settings — Remote Docker "Connection name" field | `VERIFIED` | UX-R3 | `backend/src/main/java/com/logexplorer/config/DockerProperties.java` (`connectionName` field, REMOTE-only, cosmetic), `DockerSettingsController.java`, `DockerConnectionSummaryDto.java`; `frontend/src/features/settings/DockerSettingsPanel.tsx`; `DockerSettingsPanel.test.tsx` (3 dedicated tests: populated, "Not set", never shown for LOCAL) | Live screenshot shows the field's row only when the dev environment's real connection is actually REMOTE, which this dev environment is not — the populated-value case is evidenced by the component test instead, honestly |
| UX-8 | Reveal/unmask raw sensitive values | `SUPERSEDED` (narrowly) — see PCFR-3 for the exact boundary | — | `OLD_UX_RESTORATION_AUDIT.md`; CLAUDE.md §2 rule 5 ("No reveal action for masked values") | **Named conflict (CLAUDE.md §5):** this row previously read "permanent, never implement" for *any* mechanism that could result in an unmasked field reaching the browser. The Pre-Closure Functional Recovery mission's owner decision explicitly supersedes that absolute reading: a field MAY now be shown unmasked, but only via a global, admin-facing, checkbox-based **policy** toggle (`PrivacyMaskingSettingsPanel`/`MaskingSettingsController`) that changes what the server masks for every subsequent request — never a **per-row reveal action** on an already-fetched, already-masked value. CLAUDE.md §2 rule 5's literal text ("no reveal action for masked values") is still fully honored in its original, narrower sense: no button anywhere reveals a specific already-rendered masked cell, no raw value is ever cached/reconstructed client-side, and the masking boundary stays server-side (`MaskingService`/`MaskingPolicyService`). Only the *absolute permanence* of "a protected field can never, under any admin action, be sent unmasked" is what changed. Full detail: `docs/verification/PRE_CLOSURE_FUNCTIONAL_RECOVERY_REPORT.md` §"Masking policy supersession" |
| UX-9 | Docker Compose project selector (runtime, request/session-scoped) | `VERIFIED` | UX-R3 | see §3 below (dedicated section) — real two-project overlapping-service-name isolation proof across discovery/services/search/pagination/Live/context, all directions, zero leakage | — |
| UX-10 | Row click → inspector (mandatory) | `VERIFIED` | UX-R4 | `frontend/src/features/results/ResultsTable.tsx`; `ResultsTable.rowInteraction.test.tsx` (13 tests: right event opened by click and by keyboard, Actions/journey-link clicks excluded, roving tabindex, `aria-selected`); `frontend/e2e/ux-r4-results-workstation.spec.ts` (real browser, real backend); evidence `docs/verification/UX_R4_EVIDENCE/AFTER-A/C/D-*.png` | supersedes an earlier Slice 4 deferral. The pre-UX-R4 state was proven, not assumed: `getComputedStyle` showed rows with `cursor: auto`, no `tabindex`, and a row click opening nothing (`BEFORE-A-results-default.png`) |
| UX-11 | Truthful Newest/Oldest sorting (never silently page-local) | `VERIFIED`, extended — see PCFR-4 | UX-R4 → extended by Pre-Closure Functional Recovery | `frontend/src/features/results/SortControl.tsx`; `useSearchState.sorting.test.ts` (9 tests, incl. fresh-cursor-on-direction-change); `FixtureLogSourceTest` (exact ordering both directions + mirror-set proof); real-backend and **real-Docker** verification recorded in `docs/verification/UX_R4_RESULTS_WORKSTATION_PROFESSIONAL_UX_REPORT.md`; evidence `AFTER-G/H-*.png` | The truthfulness constraint is met by construction: the direction is a **request parameter the source honors**, never a client-side re-sort. Confirmed empirically before the control was built. Still true after PCFR-4: clicking the Time column header now aliases this exact same `sortDirection`/`setSortDirection` state, never a second competing sort state — see PCFR-4/PCFR-5. Real Loki remains unverified — see UX-25 |
| UX-12 | Event Inspector Previous/Next position indicator (e.g. "1/100") | `VERIFIED` | UX-R5 | `frontend/src/features/inspector/InspectorHeader.tsx`; `InspectorPosition.test.tsx` (13 tests incl. 1-based, bounds, polite live region, omitted-when-unknown); `frontend/e2e/ux-r5-inspector-context.spec.ts` (real browser: follows Previous/Next, keyboard `[`/`]`, and grows with Load more); evidence `AFTER-B-position-indicator.png` | Renders "Event 4 of 200 **loaded**". The word "loaded" is deliberate and load-bearing: the backend reports `total` as unknown for several sources and "more available" is normal, so a bare "4 of 200" would assert a global position the app cannot know (§5: "Do not imply global position across events that have not been loaded") |
| UX-13 | "Show surrounding logs" reachable from every inspector tab/section (not just Request Flow + row Actions menu) | `VERIFIED` | **UX-R5** (retargeted from UX-R6 by the UX-R5 mission §14, which asked for the inspector side to be solved now) | `frontend/src/features/inspector/InspectorHeader.tsx` (single inspector-level action) + `InspectorHeader.module.css` (sticky header); `RequestFlowSection.tsx` (the section-local copy removed, not duplicated); `InspectorPosition.test.tsx`; `ux-r5-inspector-context.spec.ts` ("stays visible while reading the LAST section" asserts `toBeInViewport`, and "exactly ONE context action"); evidence `AFTER-J-context-action-visible-while-scrolled.png` | Solved as **one** inspector-level action, never one per section (§14's explicit "do NOT duplicate"). The measured friction was worse than the audit assumed: the action sat 1,261px below the inspector's top, and the panel does not scroll independently (it grows to 9,224px and the *page* scrolls), so simply moving the button to the header would have left it scrolling off screen — `panelTop` measured at -1205px. The sticky header is what actually makes the requirement true |
| UX-14 | Live's own state visibility (source/project/services/filters/connection) — independent of the confirm-before-start dialog | `VERIFIED` — superseded from `OPEN_UNDECIDED` by DEC-B (owner explicitly decided this in the UX-R3 mission message) | UX-R3 | See DEC-B above; `LiveTailPanel.test.tsx`'s 6-state badge-distinctness regression test; live evidence `docs/verification/UX_R3_EVIDENCE/AFTER-G/H/I/J-*.png` | Active-scope (source/Compose project) visibility is now handled separately by `Shell.tsx`'s `ScopeTrail`, always visible including during Live (§12) — not duplicated inside the Live panel itself |
| UX-15 | Live confirm-before-start dialog | `OUT_OF_CURRENT_SCOPE` — permanent, never restore | — | `OLD_UX_RESTORATION_AUDIT.md` — explicit owner decision: one-click start stays | — |
| UX-16 | Live reconnect on drop (auto-retry with backoff) | `VERIFIED` | Slice 5 | `frontend/e2e/phase-legacy-slice5-live-resilience.spec.ts` — passing this session, including "Stop during reconnect cancels the pending retry" | `LEGACY_UX_PARITY_REPORT.md` Task 10's `NEW_WORSE` verdict is `SUPERSEDED` by this |
| UX-17 | Safe-preference persistence allow-list | `APPROVED_PENDING` (extends existing Slice 8 mechanism) | UX-R3 (when the Compose selector ships, since it's on this list) | `OLD_UX_RESTORATION_AUDIT.md`; `frontend/src/features/results/tablePreferences.ts` | Approved to persist: selected source, **selected Compose project**, time preset, severity, query mode, table preferences (col/density — already persisted). Forbidden: free-text query values, raw LogQL, all 5 protected fields, trace/correlation values, results, credentials/tokens/secrets. |
| UX-18 | Row-actions menu, column customization, context/surrounding-logs view, sorting-mechanics-below-the-truthfulness-constraint, Inspector 5-section layout | `SUPERSEDED` (Inspector layout only) — see PCFR-1/PCFR2-1 | already shipped (Slice 4, pre-UX-R1) → Inspector layout superseded twice (Pre-Closure Functional Recovery, then Pre-Closure Functional Recovery 2) | `OLD_UX_RESTORATION_AUDIT.md` (`SAME`/`KEEP_NEW`, `NEW_BETTER`) | Row-actions/column-customization/context-view/sorting-mechanics parts of this row are unaffected, still `VERIFIED`. "Inspector 5-section layout" (one long vertical flow) was first replaced with a WAI-ARIA tabbed presentation whose tabs hid themselves when empty (PCFR-1); the owner then rejected that hiding behavior too (PCFR2-1) — the current, twice-corrected state is: tabbed, and every primary tab structurally always present |
| UX-19 | Seven-column results table, no reorder | `SUPERSEDED`, extended — see PCFR-5 | Slice 4 → extended by Pre-Closure Functional Recovery | `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` OD-1 | CLAUDE.md's original wording ("exactly seven columns... never reorder") is superseded by owner-approved path "b": seven visible by default, in order, **plus** an optional show/hide/reorder/density control that never changes the default view. Slice 4 itself then deliberately chose keyboard-only Move up/down over drag-and-drop, and no clickable column sorting — both of those narrower Slice-4 choices are what PCFR-4/PCFR-5 further supersede (rationale preserved verbatim in `SortControl.tsx`/`TableSettingsControl.tsx`, marked SUPERSEDED, not deleted) |
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
| UX-21 | Settings/Docker-connection endpoints beyond Test Connection (e.g. a masking-status endpoint distinct from Docker settings) | `VERIFIED` | UX-R3 (bundle with UX-6) → resolved by Pre-Closure Functional Recovery (PCFR-3) | `backend/src/main/java/com/logexplorer/api/MaskingSettingsController.java` (`GET`/`PUT /api/v1/settings/masking`, entirely independent of `DockerSettingsController`); `MaskingSettingsControllerIntegrationTest.java` | The 2025-era guess ("likely subsumed, no dedicated endpoint needed") was wrong — the actual owner requirement needed a real, dedicated, source-independent endpoint precisely because the policy is now mutable, not just readable. Recorded as a correction, not silently overwritten |

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
| DEC-C | An obvious, direct, keyboard-accessible way to exit Live and return to Search, no page refresh, preserving investigation state where safe/meaningful. | `VERIFIED` | UX-R3 → keyboard gap closed by Final Functional Closure | The pre-existing "← Back to search results" button (`live.exit`) already satisfies most of this; UX-R3's own addition is the Compose-project-switch case (`App.tsx`'s new `previousComposeProjectRef` effect calls `live.exit()`, mirroring the pre-existing source-change effect) — verified via `frontend/src/app/App.liveComposeProjectSwitch.test.tsx`. Keyboard-accessibility re-verification against real rendered evidence — the one thing this row itself named as still pending — closed by Final Functional Closure: `frontend/e2e/phase-j-live-tail.spec.ts`'s new real-browser `.focus()`+`Enter` test. | Same decision as item 5 ("Live to Search") below. |
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
| STATUS | `VERIFIED` |
| CATEGORY | UX/functional, must be verified in an early UX slice, not silently deferred to Phase M |
| OWNER_DECISION | Required workflow: Search → Start Live → Live mode → Stop/Exit Live/Back to Search → normal Search workspace, with: a clear visible way to exit Live; no page refresh required; the actual live stream genuinely stops (no stale events can keep arriving); previous Search state preserved where practical (source, selected Compose project, filters, time range, table preferences, previous results where safe); keyboard accessible; browser/E2E verified. |
| TARGET_SLICE_OR_PHASE | UX-R3 (see DEC-C above) → keyboard-accessibility gap closed by Final Functional Closure |
| ACCEPTANCE_CRITERIA | As stated above |
| EVIDENCE | The pre-existing "← Back to search results" button/`live.exit()` already covers the source-change case (`App.tsx`). UX-R3 adds the Compose-project-switch case: `App.tsx`'s new `previousComposeProjectRef` effect calls `live.exit()` on project change; proven via a real `<App />` integration test, `frontend/src/app/App.liveComposeProjectSwitch.test.tsx` ("exits Live... closing the real EventSource... the instant the selected Compose project changes"). **Keyboard-accessibility re-verification (the one gap this row named as pending) closed by Final Functional Closure**: `frontend/e2e/phase-j-live-tail.spec.ts` — `"Back to search results" is reachable and activatable by keyboard alone (DEC-C closure)` — a real rendered-browser test: `.focus()` + `Enter` (no click), against the real backend, confirms the button is keyboard-focusable, keyboard-activatable, the Live panel closes, and Search is restored and usable. |
| NOTES / CONFLICTS | No conflicting prior treatment found anywhere in the repo. |

---

## 6. Filter Functional Truth

| Field | Value |
|---|---|
| STATUS | `VERIFIED` (clarified by Final Functional Closure — was ambiguously left `IN_PROGRESS → see UX-R2 report`; the UX-R2 report itself closes every field with real included/excluded evidence, so the row is updated to state that outcome directly) |
| CATEGORY | Functional correctness |
| OWNER_DECISION | The owner previously reported filtering "appeared not to work." A representative sample (`docs/verification/FILTER_FUNCTIONAL_AUDIT.md`, pre-UX-R2) was explicitly insufficient to close this. UX-R2 must exhaustively verify every relevant filter. |
| TARGET_SLICE_OR_PHASE | UX-R2 (this mission) |
| ACCEPTANCE_CRITERIA | Every field proven with real included AND excluded evidence, not HTTP 200 alone |
| EVIDENCE | `docs/verification/UX_R2_FILTER_AND_SEARCH_FUNCTIONAL_REPORT.md` — all 11 remaining fields closed with real inclusion/exclusion counts against the real Fixture backend, on top of `FILTER_FUNCTIONAL_AUDIT.md`'s own prior PASS for `text`/`traceId`/`errorCode`/`businessStep`/`customerId`/guided Query builder |

---

## 7. Cross-Platform Desktop Distribution (REL-1)

| ID | REL-1 |
|---|---|
| NAME | Versioned Cross-Platform Desktop Release & Branding |
| STATUS | `IMPLEMENTED_VERIFIED` — `v0.1.0` published as a real GitHub Release, see the new §7d below |
| CATEGORY | Distribution |
| OWNER_DECISION | Current required user platforms: **Windows** and **macOS**. Linux: `DEFERRED` / not currently required. Windows target: a versioned installer executable, e.g. `LogExplorer-1.0.0-windows-x64.exe`. macOS target: a normal end-user downloadable `.app` package (preferred format, e.g. DMG, decided at implementation time per standard macOS UX). Do not promise Intel + Apple Silicon until architecture support is explicitly decided — evaluate Apple Silicon, Intel if justified, universal build only if technically/practically appropriate. **GitHub Releases must be the end-user distribution surface** — users must never need to navigate GitHub Actions artifacts for a production release. Example: tag `v1.0.0` with Windows and macOS downloadable assets. Required release behavior: explicit version/tag release; deterministic version from the tag; build on appropriate OS runners; smoke verification before publish; a failed package is never published; SHA-256 checksums; a documented release process; release notes; temporary CI artifacts may remain for CI diagnostics only. |
| TARGET_SLICE_OR_PHASE | Done — `v0.1.0` release mission |
| ACCEPTANCE_CRITERIA | As stated above — all met, see §7d |
| EVIDENCE | `docs/verification/RELEASE_V0_1_0_REPORT.md`; <https://github.com/afawzy70/Log-explorer/releases/tag/v0.1.0> |
| NOTES / CONFLICTS | Slice 9 (merged) is Windows-only and does not itself publish via GitHub Releases (CI artifact only) — REL-1 supersedes/extends Slice 9's distribution story, not its packaging mechanics (jlink/jpackage/Inno Setup remain the Windows build path). Slice 9's own known limitations remain tracked, not silently converted to PASS: |

### 7a. Slice 9 known limitations (carried forward, must remain tracked)

| Item | Status | Evidence |
|---|---|---|
| Port collision handling | `PARTIAL` | `docs/verification/SLICE_9_WINDOWS_DESKTOP_REPORT.md` — "design + code review; free-port path exercised for real, collision/existing-instance paths not yet CI-exercised" |
| Single-instance behavior | `PARTIAL` | same report, same caveat |
| Code signing | Unsigned, by design/honesty, not a defect to silently fix | same report — "no certificate is available in this environment... reported honestly as unsigned rather than self-signed with a fabricated trust claim." Scripted so `[SignTool]` can be added later without restructuring. |
| WebView2 pixel-level rendering | Manual-verification-only | same report — "no UI-automation harness... A human running the installed app and visually confirming the UI renders correctly... remains the one manual step this automation doesn't replace." |
| Port-collision-with-occupied-port scenario | `DEFERRED` | same report — "Not exercised in the hosted CI job." |

### 7b. REL-1 addendum — Local Reproducible Desktop Packaging (approved after OS-1A review recovery #2, registered during OS-1B)

Approved by the owner **after** the OS-1A review recovery #2 prompt was
sent, and explicitly required by the OS-1B mission to be *registered
now, not implemented now*. Do not implement any of the scripts/behaviour
below during OS-1B or any slice before REL-1 itself.

| Field | Value |
|---|---|
| ID | REL-1 (addendum) |
| NAME | Local Reproducible Desktop Packaging |
| STATUS | `IMPLEMENTED_VERIFIED` — see §7b.1 below for real evidence (both `Windows` and `macOS`, real CI runners). GitHub Releases publication (§7's separate, pre-existing requirement) and `RELEASE_GRADE_MODE` exercised with real signing credentials remain deferred, not fabricated as done — see §7b.1 |
| CATEGORY | Distribution / developer experience |
| OWNER_INTENT | A developer who downloads/clones the source repository must be able to produce the native desktop package for the host operating system **without requiring GitHub Actions**. |
| REQUIRED_FUTURE_BEHAVIOR | **Windows host:** clone repo → one documented repository-owned PowerShell entry point → Windows installer. **macOS host:** clone repo → one documented repository-owned shell entry point → native macOS package. CI/release workflows must call the **same** repository-owned packaging entry points rather than duplicating packaging logic inside GitHub workflow YAML — the workflow becomes a thin caller, not a second implementation. |
| EXPECTED_FUTURE_DESIGN_DIRECTION | `scripts/build-desktop.ps1` (Windows) and `scripts/build-desktop.sh` (macOS), or a cleaner equivalent if repository evidence at REL-1 implementation time supports one. Output convention: `dist/`, with deterministic, versioned artifact names. |
| FUTURE_REL_1_SCOPE (not exhaustive, all `APPROVED_PENDING`, none started) | Windows local one-command packaging; macOS local one-command packaging; host-native packaging only (Windows→Windows artifact, macOS→macOS artifact — unsupported cross-OS production packaging is explicitly not required); clear dependency/preflight checks with actionable missing-tool errors; React production build; Spring Boot production build; bundled runtime creation; desktop launcher/app bundle creation; installer/package generation; smoke validation; SHA-256 checksums; deterministic artifact naming; version injection; branding; unsigned/development local package support where appropriate; a release-grade mode; future signing/notarization handling; GitHub Actions calling the same scripts; GitHub Releases publication (already tracked above in §7's main REL-1 row); documentation at `docs/development/BUILD_DESKTOP.md` covering prerequisites, Windows build, macOS build, expected artifacts, version selection, unsigned/local builds, release builds, checksums, clean rebuild, troubleshooting, and host architecture requirements |
| TARGET_SLICE_OR_PHASE | REL-1 |
| ACCEPTANCE_CRITERIA | Deferred to REL-1's own implementation mission — this row exists to guarantee the requirement is never silently lost between now and then |
| EVIDENCE | None — genuinely not implemented. `desktop/` currently builds only through the existing Slice 9 CI-driven path (`jlink`/`jpackage`/Inno Setup inside `.github/workflows/windows-desktop.yml`), which is exactly the "packaging logic duplicated inside workflow YAML" pattern this new requirement says must eventually be replaced by repository-owned scripts the CI merely calls |
| NOTES / CONFLICTS | This addendum does not change or weaken §7's existing REL-1 row (GitHub Releases as the end-user distribution surface, versioned installers, SHA-256 checksums, etc.) — it adds the *local, credential-free, CI-independent* reproducibility requirement on top of it, and requires the eventual CI implementation to route through the same local scripts rather than reimplementing packaging twice. `LOCAL_WINDOWS_PACKAGING_STATUS=IMPLEMENTED_VERIFIED`, `LOCAL_MACOS_PACKAGING_STATUS=IMPLEMENTED_VERIFIED`, `CI_REUSE_LOCAL_PACKAGING_SCRIPTS_REQUIREMENT=DONE`, `BUILD_DESKTOP_DOCUMENTATION_REQUIREMENT=DONE` (see §7b.1). |

### 7b.1 REL-1 implementation — real evidence (this pass)

Full detail, real CI logs, and the two real macOS-specific defects found
and fixed: `docs/verification/REL_1_DESKTOP_RELEASE_READINESS_REPORT.md`.
Summary:

| Item | Status | Evidence |
|---|---|---|
| Windows: `scripts/build-desktop-windows.ps1`, a repository-owned local entry point, extracted from the pre-existing CI logic (not redesigned) | `VERIFIED` | Real `windows-latest` CI run: `WINDOWS_PACKAGE_BUILD=PASS`, `WINDOWS_PACKAGED_SMOKE=PASS` — real installer produced (`LogExplorer-0.1.0-dev.0c01b8b-windows-x64.exe`, 120.2 MB), real install→launch→health→UI→API→shutdown→uninstall lifecycle confirmed |
| macOS: `scripts/build-desktop-macos.sh` + new `desktop/launcher-macos` (plain Java, zero dependencies) + `desktop/packaging-macos/` — genuinely new packaging path, none of it existed before | `VERIFIED` | Real `macos-latest` CI run: `MACOS_PACKAGE_BUILD=PASS`, `MACOS_PACKAGED_SMOKE=PASS` — real DMG produced (`LogExplorer-0.1.0-dev.0c01b8b-macos-arm64.dmg`, 81 MB), real install→launch→health→UI→API→shutdown→uninstall lifecycle confirmed |
| CI orchestrates only — both `windows-desktop.yml` and the new `macos-desktop.yml` call the exact repository-owned scripts, never duplicating packaging logic in YAML | `VERIFIED` | Direct workflow-file review; both jobs' only build step is a single script invocation |
| SHA-256 checksums | `VERIFIED` | Both scripts write a `.sha256` file alongside the produced artifact, confirmed present in both real CI runs |
| One authoritative version source (`VERSION`, repository root) | `VERIFIED` | Both scripts resolve version identically; confirmed in both real CI runs (`0.1.0-dev.0c01b8b` on both platforms, from the same commit) |
| `docs/development/BUILD_DESKTOP.md` | `VERIFIED` | Created — prerequisites, build, output, DEV/RELEASE modes, versioning, clean rebuild, common failures (including both real defects found this pass), artifact verification |
| Two real macOS-only defects found via the real CI runner and fixed | `HARDENING` (packaging-script fixes, not product code) | bash 3.2's empty-array-under-`set -u` behavior (`"${SIGN_ARGS[@]}"` → the `${arr[@]+"${arr[@]}"}` idiom); jpackage's own `--app-version` rejecting this project's pre-1.0 leading-zero version (fixed with a jpackage-internal-metadata-only substitution, real `$VERSION` preserved everywhere else) |
| GitHub Releases publication (tag-triggered, end-user-facing) | `DEFERRED` (§7's own separate requirement, not in this pass's scope) | Not attempted — mission's own "Do NOT publish a public release unless explicitly authorized"; CI produces artifacts only |
| `RELEASE_GRADE_MODE` exercised with real Apple signing credentials | `NOT_TESTED_ENVIRONMENT_LIMITATION` | No Apple Developer credentials exist in this repository's CI or this session; verified only by code review and its own fail-fast behavior when credentials are absent (confirmed: it does fail loudly, never silently falls back to unsigned) |
| Native macOS embedded web view (WebView2-equivalent) | `FUTURE_IMPROVEMENT` | v1 opens the system browser with a menu-bar tray icon instead — same product/backend/API, deliberate, documented, reversible design choice (decision report §9) |

`PRODUCT_BEHAVIOR_CHANGED=NO` — `git diff --stat main -- backend/src/main/java frontend/src`
is empty; no OpenShift/Loki/Docker/Fixture source touched.
`HISTORICAL_DECISIONS_PRESERVED=YES` — the "registered now, not
implemented now" framing above (§7b's own opening paragraph) is
preserved as an accurate record of the OS-1B-era decision; this
subsection records the later, real implementation. `UNTRACKED_OWNER_REQUIREMENTS=0`.

### 7c. Windows Desktop CI/Toolchain Hardening — reproducible .NET SDK / NuGet restore (`platform/windows-dotnet-nuget-restore-hardening`)

**Branch-sequencing note, stated explicitly so it is never silently lost:**
this row is being registered directly on `main` via a standalone hardening
branch created *before* PR #42 (OS-1D) or PR #43 (OS-1E) had merged, per an
explicit owner mission ("this hardening PR is allowed to merge to main
BEFORE PR #42... it is isolated platform/CI infrastructure"). The
still-open `os/1e-openshift-live-tail` branch separately registered its
own, differently-scoped "REL-1 addendum — Reproducible Windows .NET /
NuGet Toolchain" row (also numbered §7c on that branch) as a
**tracking-only** placeholder — real evidence did not exist yet at that
time. **When PR #42/PR #43 are later rebased onto this now-hardened
`main`, that placeholder row's evidence/status should be reconciled to
point at THIS row rather than duplicated** (the rebase step already
anticipates a documentation merge here). This is a deliberate forward
note, not an oversight — this hardening branch cannot edit PR #42/#43's
own branches (explicitly out of scope for this mission).

| Field | Value |
|---|---|
| ID | PLATFORM-WIN-1 |
| NAME | Reproducible Windows .NET SDK / NuGet restore for the desktop launcher |
| STATUS | `VERIFIED` — implemented and evidenced on this branch, not merely proposed |
| CATEGORY | CI/toolchain infrastructure (platform, not product) |
| TRIGGERING_DEFECT | PR #42's Windows Desktop gate failed repeatedly with `MSB4181: The "RestoreTask" task returned false but did not log an error` at `dotnet publish ... desktop/launcher/LogExplorerLauncher.csproj`, confirmed identical across a fresh, code-unchanged retry (same signature, only the timestamp differed) |
| ROOT_CAUSE | No `global.json` existed anywhere in the repository. Without one, `dotnet` resolves to the **highest SDK installed on the runner image**, not necessarily the `8.0.x` SDK `actions/setup-dotnet@v4` explicitly installs. The observed failures were executing through a preinstalled **.NET 10 SDK** (`C:\Program Files\dotnet\sdk\10.0.400\NuGet.targets`) that this `net8.0-windows` project was never built or tested against — confirmed directly: `dotnet --version` printed `10.0.400` at the failure site, and `8.0.425` once `global.json` was added |
| FIX | `global.json` (repo root) pins `sdk.version=8.0.100`, `rollForward=latestFeature` — uses the highest installed 8.0.x feature band/patch, never crosses into 9.x/10.x. A new CI step ("Verify effective .NET SDK") fails fast with a clear message if `dotnet --version` is ever not 8.0.x, instead of an opaque downstream restore failure several steps later |
| SECONDARY_FIX | The floating `Microsoft.Web.WebView2 Version="1.0.*"` reference (originally floating specifically because the project was authored without NuGet connectivity to verify an exact version) is replaced with the actual latest published, listed, stable release `1.0.4191.47` — verified directly against the NuGet v3 API (`api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json`, published 2026-08-28), never guessed |
| DETERMINISTIC_RESTORE | `RestorePackagesWithLockFile=true` in the `.csproj`; `desktop/launcher/packages.lock.json` committed (generated by, and downloaded as a build artifact from, a real CI restore against the real nuget.org — real content hashes, never hand-written); CI restore uses `--locked-mode`, `-r win-x64` (matching the publish step's own RuntimeIdentifier — a distinct real defect this hardening's own first CI run caught: restoring without `-r win-x64` produces a `project.assets.json` with no RID-specific target, so `publish --no-restore -r win-x64` fails with `NETSDK1047`) |
| EXPLICIT_RESTORE_SEPARATION | `dotnet restore ... --locked-mode` and `dotnet publish ... --no-restore` are now two separate, individually-diagnosable CI steps — publish can never silently perform a second, different dependency resolution |
| NUGET_SOURCES | `nuget.config` (repo root) clears every inherited source and adds back exactly `nuget.org` (v3) — explicit, diagnosable, no mirrors, no disabled-verification fallback |
| RETRY_POLICY | Bounded (max 2 attempts, i.e. at most 1 retry), and only for a small explicit allowlist of transient network/feed failure signatures (SSL handshake, timeout, DNS, 502/503, etc.) — a NU1xxx dependency-resolution error, an MSB-prefixed error, or a lock-file mismatch is never retried, since retrying those would hide a real, deterministic defect |
| CACHE_POLICY | `actions/cache@v4` on the NuGet global packages folder, keyed on `hashFiles('desktop/launcher/packages.lock.json')` — optimization only; `--locked-mode` restore is the actual correctness source of truth regardless of cache staleness |
| REPRODUCIBILITY_EVIDENCE | Two independent, fully clean-runner CI runs on the identical commit (`8452aba`) both passed end to end (SDK verification → locked restore → publish → installer build → packaged install→launch→health→UI→API→shutdown→uninstall smoke test): run 34715480580 and run 34715654800 (the second via a manual `workflow_dispatch` re-trigger, not a retry of the same run). The `packages.lock.json` build artifact downloaded from the second run was diffed byte-for-byte against the committed file — identical |
| EVIDENCE | `docs/verification/WINDOWS_DOTNET_NUGET_HARDENING_REPORT.md`; PR #44 (`platform/windows-dotnet-nuget-restore-hardening` → `main`) |
| SCOPE_BOUNDARY | This row is explicitly CI/toolchain-only — no macOS packaging, GitHub Release publishing, signing, installer redesign, desktop UI/launcher feature changes, OpenShift changes, OS-1F, or REL-1 implementation were touched. §7b's "Local Reproducible Desktop Packaging" (repository-owned local build scripts) remains `APPROVED_PENDING` / **not started** — this hardening only fixes the *existing* CI-driven packaging path's restore determinism, it does not create the local script path §7b describes |

**Reconciliation with the original OS-1E registration of this same
requirement (preserved below for history, not dropped).** Exactly as
foretold by this section's own "branch-sequencing note" above: OS-1E
separately registered a same-numbered §7c placeholder for this identical
requirement, before real evidence existed. That original registration is
kept verbatim immediately below as the historical record of when and why
it was first tracked — its own `STATUS` (`APPROVED_PENDING`) is now
`SUPERSEDED` by the `VERIFIED` row above, which is the current
authoritative status for this requirement going forward. Nothing about
OS-1E's own live-tail implementation findings is touched by this
reconciliation — this placeholder was always a governance registration
about the separate Windows/.NET/NuGet CI issue observed during OS-1D's
merge gate, not an OS-1E feature/behavior finding.

### 7c (superseded, preserved for history). REL-1 addendum — Reproducible Windows .NET / NuGet Toolchain (registered during OS-1E, blocking evidence from OS-1D's own Windows Desktop gate)

**STATUS: `SUPERSEDED` by the `VERIFIED` §7c row above
(`PLATFORM-WIN-1`).** The table below is preserved exactly as OS-1E
originally registered it, for historical accuracy — do not treat its
`APPROVED_PENDING` status as current.

Registered per the OS-1E mission's own explicit instruction: **record
now, do not implement now.** Background: during OS-1D's final merge gate,
PR #42's Windows Desktop CI job failed six consecutive times (one
original run plus five reruns spread across roughly 20+ minutes) with an
**identical** generic NuGet restore infrastructure error
(`NuGet.targets(198,5): error MSB4181: The "RestoreTask" task returned
false but did not log an error.`) at `dotnet publish -r win-x64
--self-contained true` for `desktop/launcher/LogExplorerLauncher.csproj`.
Confirmed, not assumed, to be an external CI/toolchain issue rather than a
code defect: zero `desktop/**` files were changed by the commit under
test; the immediately-preceding commit on the same branch passed the
identical workflow; Backend/Frontend/E2E remained green throughout.
Reported and tracked as `WINDOWS_DESKTOP_GATE=BLOCKED_EXTERNAL_CI` —
explicitly not force-retried indefinitely, not "fixed" by touching
`csproj`/workflow/package versions merely to force a green run, and not
converted to `PASS`.

| Field | Value |
|---|---|
| ID | REL-1 (addendum) |
| NAME | Reproducible Windows .NET / NuGet Toolchain |
| STATUS | `APPROVED_PENDING` — tracked, **not started**, not implemented |
| CATEGORY | CI / build infrastructure |
| OWNER_INTENT | The Windows Desktop build's .NET/NuGet toolchain must be pinned and its restore step deterministic, so a transient upstream NuGet infrastructure hiccup cannot repeatedly block an otherwise-approved, otherwise-green PR merge the way it blocked PR #42. |
| REQUIRED_FUTURE_BEHAVIOR | A pinned .NET SDK version (`global.json` or an equivalent repository-owned pin) rather than "whatever the CI runner image currently ships"; a deterministic/locked NuGet restore (a lock file or an equivalent reproducibility mechanism) rather than a live, unlocked resolve against the NuGet feed on every run; one unified CI/local toolchain contract, so a developer's local build and CI resolve the exact same dependency graph; bounded, diagnosable retry behavior for a genuinely transient restore failure (distinct from silently retrying forever or from a raw unexplained `MSB4181`). |
| EXPECTED_FUTURE_DESIGN_DIRECTION | Integrates with, rather than duplicates, §7b's own Local Reproducible Desktop Packaging requirement — the same "one repository-owned entry point, CI calls it too" discipline extended to the .NET/NuGet layer specifically. |
| TARGET_SLICE_OR_PHASE | REL-1 |
| ACCEPTANCE_CRITERIA | Deferred to REL-1's own implementation mission — this row exists to guarantee the requirement is never silently lost between now and then |
| EVIDENCE | `WINDOWS_DESKTOP_GATE=BLOCKED_EXTERNAL_CI` evidence gathered during the "OS-1D Final Windows Gate & Merge" mission (workflow run id, failed step, exact restore error text, confirmed unchanged PR #42 HEAD/tree across every rerun) — the failure this addendum exists to make structurally less likely to recur, not proof the addendum has been implemented |
| NOTES / CONFLICTS | Does not change or weaken §7b's existing addendum — this is a narrower, .NET/NuGet-specific companion to it, surfaced by a real incident rather than proposed speculatively. Not implemented in OS-1D, OS-1E, or any slice before REL-1 itself. |

### 7d. `v0.1.0` — first published GitHub Release (real evidence)

Full detail: `docs/verification/RELEASE_V0_1_0_REPORT.md`. Summary:

| Item | Status | Evidence |
|---|---|---|
| Publisher/author metadata ("Ahmed Fawzy elrifaye") wired into Windows installer/executable and macOS app bundle metadata | `VERIFIED` (real CI assertions, not source review alone) | Windows: Add/Remove Programs `Publisher`, launcher `FileVersionInfo.CompanyName`, both read from the real installed app on a real `windows-latest` runner. macOS: `Info.plist` `NSHumanReadableCopyright`, read from the real installed `.app` on a real `macos-latest` runner |
| Version resolves to exactly `0.1.0` (no `-dev.<sha>`) for the tagged release build | `VERIFIED` | Both real CI logs: `Version: 0.1.0`; artifact filenames `LogExplorer-0.1.0-windows-x64.exe` / `LogExplorer-0.1.0-macos-arm64.dmg` |
| Windows/macOS artifacts built from the exact `v0.1.0` tag via `workflow_dispatch --ref v0.1.0`, not a push-triggered build against an untagged commit | `VERIFIED` | Real CI run IDs in the release report §4 |
| Packaged smoke tests (install→launch→health→UI→API→shutdown→uninstall) against the release-tag build | `VERIFIED` | `WINDOWS_RELEASE_SMOKE=PASS`, `MACOS_RELEASE_SMOKE=PASS`, both real runs |
| Security sweep of the two real downloaded release artifacts (not source review alone) | `VERIFIED` | Zero secret-pattern or CI-runner-path matches in either binary — `SECRETS_IN_RELEASE_ARTIFACTS=NO` |
| GitHub Release published, not draft, not prerelease, target commit matches the merge SHA exactly | `VERIFIED` | <https://github.com/afawzy70/Log-explorer/releases/tag/v0.1.0>; `gh release view` output in the release report §7 |
| Application icon | `OPEN`, not silently resolved | See §8 above — `CANONICAL_ICON_SOURCE=MISSING`, real audit performed, no branding fabricated |
| Code signing / notarization | `NOT_CONFIGURED`, truthfully unsigned | No signing/notarization success fabricated; release notes disclose SmartScreen/Gatekeeper warnings explicitly |

### 7e. Automated tag-driven release pipeline (for every release after `v0.1.0`)

Full detail: `docs/verification/AUTOMATED_RELEASE_PIPELINE_REPORT.md`.
`v0.1.0` itself was published manually and remains **untouched** by this
pipeline — verified (`V0_1_0_TAG_UNCHANGED=YES`,
`V0_1_0_RELEASE_UNCHANGED=YES`, `V0_1_0_ASSETS_UNCHANGED=YES`) in that
report §6, not merely asserted.

| Item | Status | Evidence |
|---|---|---|
| `.github/workflows/release.yml` — `push: tags: v*` triggers a strict version gate, real Windows + macOS release builds, then automated GitHub Release publication | `IMPLEMENTED` | New file; `validate-version` → `windows-release`/`macos-release` → `publish-release`, structural `needs:` dependency means publication cannot run if any prior job fails |
| Strict tag-vs-`VERSION` gate — a mismatched tag is refused, never published | `VERIFIED` (logic tested locally, both matching and mismatched cases) | `AUTOMATED_RELEASE_PIPELINE_REPORT.md` §3 |
| Windows/macOS release jobs reuse the exact same `windows-desktop.yml`/`macos-desktop.yml` every PR already runs — via `workflow_call`, not copied steps | `VERIFIED` (deepest-level reuse: whole CI job, not just the build script) | `AUTOMATED_RELEASE_PIPELINE_REPORT.md` §2 |
| Release publication gated on Windows + macOS success (build, real packaged smoke test, secret scan) | `VERIFIED` (structural `needs:`, not a conditional flag) | `AUTOMATED_RELEASE_PIPELINE_REPORT.md` §4 |
| Artifact provenance — tag commit, both platform builds, and the published release's own target commit all match | `VERIFIED` (asserted and enforced in the workflow itself, not just claimed) | `AUTOMATED_RELEASE_PIPELINE_REPORT.md` §5; `RELEASE_PROVENANCE_MATCH` computed and gated in the `publish-release` job |
| Minimum required permissions (`contents: write` only on the one job that needs it) | `VERIFIED` (code review) | `AUTOMATED_RELEASE_PIPELINE_REPORT.md` §9; `EXCESS_PERMISSIONS=NO` |
| Repository-owned release notes (`docs/release-notes/NEXT_RELEASE.md`), not hardcoded in YAML | `IMPLEMENTED` | `AUTOMATED_RELEASE_PIPELINE_REPORT.md` §8 |
| Secret/developer-path scan of the built artifact, automated and gating (both platforms) | `IMPLEMENTED` | New steps in `windows-desktop.yml`/`macos-desktop.yml`, same pattern as the manual `v0.1.0` sweep |
| Safe validation without creating a real tag or a temporary public release | `VERIFIED` (per this mission's own explicit prohibition on a fake production release) | `AUTOMATED_RELEASE_PIPELINE_REPORT.md` §7 — YAML syntax, version-gate logic, release-notes assembly all tested locally; the reused build/smoke-test logic already has real `windows-latest`/`macos-latest` CI evidence from REL-1 and the `v0.1.0` branding pass |
| Icon status | `CANONICAL_ICON_SOURCE=MISSING`, unchanged | No icon work attempted this mission, per explicit instruction |

`PRODUCT_BEHAVIOR_CHANGED=NO`. `HISTORICAL_DECISIONS_PRESERVED=YES`.
`UNTRACKED_OWNER_REQUIREMENTS=0`.

`PRODUCT_BEHAVIOR_CHANGED=NO` — no `backend/src/main/java`/`frontend/src`
file touched by either the branding PR or this documentation follow-up.
`HISTORICAL_DECISIONS_PRESERVED=YES`. `UNTRACKED_OWNER_REQUIREMENTS=0`.

---

## 8. Desktop Branding

| Field | Value |
|---|---|
| STATUS | `PARTIALLY_ADDRESSED` — publisher/author metadata is now `VERIFIED` for real (§7d below); **icon branding is still `OPEN`, flagged explicitly, not silently resolved** |
| CATEGORY | Distribution / polish |
| OWNER_DECISION | Windows icon correctly applied, as supported, to: application executable, running window, taskbar, Start Menu shortcut, installer, installed application entry (Add/Remove Programs where applicable). macOS: native application icon integration appropriate to its package/app bundle. Canonical branding source assets stored in the repo. **Never ship a production release with placeholder/default framework icons.** CI/release verification should prove branding resources are actually wired, not merely committed. |
| TARGET_SLICE_OR_PHASE | REL-1 / final hardening, before Phase M |
| ACCEPTANCE_CRITERIA | As stated above |
| EVIDENCE | `docs/verification/RELEASE_V0_1_0_REPORT.md` §3 — a real icon audit was performed for the v0.1.0 release mission (frontend assets, desktop assets, README, packaging resources), found no official Log Explorer product mark/logo anywhere in the repository, and correctly did **not** fabricate one (`CANONICAL_ICON_SOURCE=MISSING`, per that mission's own explicit "STOP icon generation... do not invent unrelated branding without owner approval" instruction). Publisher/author metadata (`desktop/packaging/installer.iss`, `desktop/launcher/LogExplorerLauncher.csproj`, `jpackage --vendor`/`--copyright`) was verified wired for real via new CI assertions on real `windows-latest`/`macos-latest` runners |
| NOTES / CONFLICTS | **This row's own standing requirement — "Never ship a production release with placeholder/default framework icons" — was NOT fully satisfied by the `v0.1.0` release.** `desktop/launcher/Resources/app.ico` (a small, generic, 32×32, 4-color rounded-rectangle-outline placeholder from Slice 9, not a distinctive designed mark) remains in use on Windows; macOS uses `jpackage`'s own default icon. The `v0.1.0` release mission explicitly authorized publication and explicitly instructed that, absent real source artwork, icon generation must stop rather than invent branding — those two instructions were in tension for this release, and publication proceeded with the pre-existing placeholder rather than blocking the release entirely. This is a genuine, owner-visible gap, not a silently-accepted one: the exact same placeholder was already shipping in the pre-`v0.1.0` state (Slice 9 onward), so `v0.1.0` does not *regress* this row, but it also does not close it. **Owner action required:** supply (or approve) real Log Explorer product artwork so a proper multi-resolution `.ico`/`.icns` can be produced for a future release. |

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
| Live-cluster verification | Split by Final Functional Closure — was one row, is now two different truths: **OpenShift Direct** `VERIFIED`/`PASS` (`REAL_OPENSHIFT_1F=PASS`, §12o.1 below — a real Red Hat Developer Sandbox run); **Loki** remains `DEFERRED` — external blocker (no reachable Loki route/service in either real Sandbox namespace) | `REQUIREMENTS_TRACEABILITY.md`; `IMPLEMENTATION_PLAN.md` §2; OpenShift Direct: §12o.1 below; Loki: reconfirmed in UX-R2, UX-R4, UX-R5, UX-R6 and OS-1G, all of which recorded `REAL_LOKI=BLOCKED` |

### 12a. OS-A — first-class OpenShift direct logging (assessment complete, implementation not started)

All rows below are **owner-approved direction recorded by the OS-A
assessment mission**. OS-A was an architecture/feasibility mission only:
**no OpenShift code was written**, and no production behaviour changed.
Full reasoning, with fact/assumption separation, is in
`docs/architecture/OPENSHIFT_DIRECT_LOGGING_ARCHITECTURE_ASSESSMENT.md`.

**Final Functional Closure reconciliation note (read before trusting the
`STATUS` column below):** every row in this §12a table is the OS-A
assessment's own **historical, as-recorded-at-the-time** status text —
preserved verbatim, per CLAUDE.md §5, never silently rewritten. Almost
all of them (`OS-1` through `OS-11`, `OS-13`, `OS-14`, `OS-16`) still read
`APPROVED_PENDING`, and `OS-15` still reads `OPEN_UNDECIDED`, here even
though the underlying capability was later actually **implemented and
independently marked `VERIFIED`** by its own granular row further down
this register (the `OS-1A-N`/`OS-1B-N`/`OS-1C-N`/etc. sections — `OS-15`
specifically by `OS-1A-9`) — this table's own status text was simply
never flipped once that happened, since §12a documents what OS-A
*decided*, not a live status feed. Do not read an `APPROVED_PENDING` or
`OS-15`'s `OPEN_UNDECIDED` here as a current gap without first checking
whether a later, more specific row already
resolved it — `docs/verification/PRE_CLOSURE_FUNCTIONAL_RECOVERY_2_REPORT.md`'s
own closure-traceability work (`docs/verification/FINAL_FUNCTIONAL_CLOSURE_REPORT.md`)
did exactly that reconciliation and is the authoritative current-status
reference. Two rows in this table are **genuinely, currently open**, not
stale: `OS-12` (Loki-as-aggregated-provider consolidation, gated on
real-Loki evidence that has never existed) and `OS-17` (multi-cluster,
permanently `OUT_OF_CURRENT_SCOPE` by CLAUDE.md §8).

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
| OS-12 | **Loki becomes an aggregated/historical provider behind OpenShift**, not a peer user-facing source | `OPEN_UNDECIDED` — interim decision recorded by OS-1G (§12p), final fold-in still gated | OS-1G | Migration strategy **A (additive first)**: keep `openshift-loki` visible during OS-1A…1F. OS-1G (§12p) confirmed with real evidence that `REAL_LOKI` remains unverified in this environment and, per the mission's own default-safety rule, deferred both product-level consolidation and the `AggregatedLogProvider` interface itself — not just the consolidation. Folding in still requires real-Loki verification (exact checklist in `docs/verification/OS_1G_AGGREGATED_PROVIDER_DECISION_REPORT.md` §6), or an explicit owner decision to restructure an adapter that has never run against its real backend |
| OS-13 | **Real OpenShift verification** on Red Hat Developer Sandbox | `APPROVED_PENDING` | OS-1A onward | Verified externally: free, 30-day renewable, "shared, multi-tenant", "Pods are automatically deleted after running for 12 consecutive hours". Direct mode needs only namespace-scoped rights → `FEASIBLE`. The 12h pod deletion is an **asset**: free, repeatable pod churn for the hardest test cases |
| OS-14 | **Three-layer test pyramid**; normal CI stays deterministic and credential-free | `APPROVED_PENDING` | OS-1A onward | Layer 1 unit/contract · Layer 2 fake Kubernetes API · Layer 3 opt-in real sandbox that **skips cleanly without credentials** |
| OS-15 | **Enterprise proxy support** (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`) | `OPEN_UNDECIDED` — **unverified assumption**, must be checked before OS-1A is estimated | OS-1A | Reactor Netty is *assumed* not to honour these automatically. If that holds, proxy handling is real work that belongs in the connection slice rather than being discovered late |
| OS-16 | **Release order**: UX-R6 → OS-A → OS-1A…1F → REL-1 → Final Parity + Hardening → Phase M | `APPROVED_PENDING` | — | Confirmed as owner-stated. Flagged for the owner: REL-1 and OS-1x are independent, so REL-1-first is defensible if an earlier desktop release is wanted — a genuine owner choice, not a settled fact |
| OS-17 | **Multi-cluster / multiple simultaneous OpenShift connections** | `OUT_OF_CURRENT_SCOPE` — unchanged | — | Already excluded by `CLAUDE.md` §8. This is what makes a **single** `OpenShiftLogSource` bean correct: `LogSourceRegistry` is immutable after construction, `PageCursorCodec` binds `sourceId` into the cursor HMAC, and UX-17 persists the selected source id. "Add Source → OpenShift" is therefore read as *configure and connect the OpenShift source* |

### 12b. OS-1A — implemented and verified

OS-1A implemented connection, credential intake and project discovery
only. Search, workloads, pods, containers, context, correlation and Live
are **not** implemented and the source's capabilities say so.

| ID | NAME | STATUS | EVIDENCE |
|---|---|---|---|
| OS-1A-1 | First-class `openshift` source registered as a single Spring bean | `VERIFIED` | `OpenShiftLogSource`; `os-1a-openshift-connection.spec.ts` asserts it in `GET /api/v1/sources` in the real app, alongside an untouched `openshift-loki` |
| OS-1A-2 | Safe `oc login` parser — parse only, never execute | `VERIFIED` | `OcLoginCommandParser`; `OcLoginCommandParserTest` (46 tests). No `ProcessBuilder`/`Runtime.exec` anywhere; `oc` is not a runtime dependency |
| OS-1A-3 | **Unknown flags are REJECTED, not ignored** (reviewer correction A) | `VERIFIED` | `OcLoginCommandParserTest#rejectsUnknownFlagsRatherThanIgnoringThem` (6 cases incl. `--namespace`, `--kubeconfig`, space-separated values, bare positionals); real-app E2E asserts the same refusal |
| OS-1A-4 | Shell metacharacters refused anywhere in the input | `VERIFIED` | 11 parameterised hostile inputs + quoting cases; refusal messages asserted never to echo the input |
| OS-1A-5 | `--insecure-skip-tls-verify` refused with its own distinct reason | `VERIFIED` | `refusesInsecureTlsExplicitlyRatherThanAsAnUnknownFlag`; real-app E2E |
| OS-1A-6 | Token is session/in-memory only, never persisted, never readable back | `VERIFIED` | `OpenShiftSession` (`RawToken`, redacted `toString`); `OpenShiftConnectionSummaryDto` has no field capable of carrying it; E2E asserts the pasted value is absent from `localStorage`, `sessionStorage`, the URL and the DOM after submit |
| OS-1A-7 | **Loopback-only credential intake, enforced not documented** | `VERIFIED` | `LoopbackBindingGuard`; allowed for `127.0.0.1`/`127.0.0.53`/`localhost`/`::1`, refused for `0.0.0.0`/`::`/`*`/routable IPs **and for a blank bind address** (Spring binds all interfaces when unset) |
| OS-1A-8 | TLS verification always on; private CA supported; no trust-all | `VERIFIED` | `OpenShiftApiClient#buildSslContext` reuses `CompositeX509TrustManager` (moved to `core.tls`, behaviour unchanged, Loki's own tests still green) |
| OS-1A-9 | **Enterprise proxy — assumption resolved** | `VERIFIED`, extended — see PCFR-6/PCFR-7/PCFR2-2/PCFR2-3 | Reactor Netty 1.2.18's `ProxyProvider` reads **only JVM system properties** (`http.proxyHost`, `https.proxyHost`, `http.nonProxyHosts`, SOCKS) — verified by inspecting the shipped class constants. No `HTTP_PROXY`/`NO_PROXY` env support exists, so `ProxyRoute` implements it explicitly, **scoped to this client, never JVM-global**. 24 tests incl. `NO_PROXY` label-boundary cases. `ProxyRoute` itself was always correct and complete — Pre-Closure Functional Recovery found two real gaps in its *consumers* instead: `OpenShiftApiClient.classify()` never actually threw `Kind.PROXY` (PCFR-6), and `LokiWebClientFactory` (the live, retained `openshift-loki` source) never called `ProxyRoute` at all (PCFR-7). Pre-Closure Functional Recovery 2 then added a user-facing System/Direct/Custom proxy mode selectable from the application itself (PCFR2-2/PCFR2-3) — additive to, never replacing, this row's own environment-variable (SYSTEM mode) behavior |
| OS-1A-10 | Project discovery via the RBAC-filtered OpenShift Projects API | `VERIFIED` | `OpenShiftApiClient#fetchProjects`; asserted to call `/apis/project.openshift.io/v1/projects`; no cluster-admin assumed |
| OS-1A-11 | **401 / 403 / empty-list are three distinct truths** (reviewer correction B) | `VERIFIED` | Modelled as distinct *types*: failures are `OpenShiftApiException` kinds, "no projects" is a successful `ProjectDiscovery` with an empty list. `OpenShiftApiClientTest` asserts all three separately; `describeFailure` asserts the 403 copy never says "no projects" |
| OS-1A-12 | Namespaces fallback **only** on a genuine HTTP 404 (`Kind.NOT_FOUND`) on the Projects API — never on 401/403/429/5xx/malformed/network/TLS/proxy | `VERIFIED` | `OpenShiftConnectionService#discoverProjectsOrNamespaces` / `#fallbackToNamespaces` (renamed and re-scoped from the original `fallbackToNamespacesIfAppropriate(OcLoginCommand, OpenShiftApiException)` by review recovery #2 — see the correction note below §12b's table); a 403 is **never** retried as namespaces; the UI labels the list "Namespaces" when that API answered. **Historical correction (review recovery #1):** the original guard checked `kind != MALFORMED_RESPONSE`, which every non-401/403 HTTP status fell into — including 429/500/502/503 real cluster failures that have nothing to do with whether the Projects API exists. `Kind.NOT_FOUND` was added so the guard could check the one genuine signal exactly; the earlier `VERIFIED` mark for this row was evidence of *a* fallback existing, not proof it was scoped correctly, and is corrected rather than erased here. `OpenShiftConnectionServiceFallbackTest` (15 tests, one YES / eleven NO / two 401-and-empty-list / one real-404-end-to-end) |
| OS-1A-13 | Stale-connection protection for connect/refresh/project-selection | `VERIFIED` | Session generation counter; tests cover replaced-connection selection, replaced-connection refresh, and a selection cleared when it disappears from a refreshed list |
| OS-1A-14 | Capabilities claim nothing OS-1A cannot do | `VERIFIED` | All seven capability booleans false; `search()` refuses loudly rather than returning an empty result that would read as "no logs" |
| OS-1A-15 | Existing `openshift-loki` unchanged | `VERIFIED` | No Loki behaviour touched; 767 backend tests green incl. the full Loki suite; both sources present in the live `/api/v1/sources` |
| OS-1A-16 | Connection UX: secret-like field, precise failures, accessible, responsive | `VERIFIED` | `OpenShiftSettingsPanel` + component tests + 17 real-browser E2E tests at 1440/1024/768/390 with no page overflow; `jest-axe` clean. Review recovery #2 also made the "Project" vs "Namespace" selection-control label, its placeholder option and the empty-scope message follow `projectApi` truthfully, not just the summary row — they were previously hard-coded to "Project"/"Projects" even when the namespaces fallback had answered |
| OS-1A-17 | Real Developer Sandbox verification | `BLOCKED_CREDENTIALS` | `OpenShiftRealSandboxIT` exists and **skips cleanly** without `OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN` (verified: 5 skipped, build success). Owner must supply credentials locally; they are never committed or printed |
| OS-1A-18 | **Discovery mode (`PROJECTS`/`NAMESPACES`) is part of the session's current truth**, not just the resulting project list — set on connect, kept current by refresh, cleared on disconnect/expiry, never inferred from list contents | `VERIFIED` | `OpenShiftSession#discoveryApi()` (new `ProjectDiscovery.Api` field on the session's `Snapshot`); `OpenShiftConnectionController#summarize` falls back to it for every caller that has no fresh discovery of its own (`GET /connection`, `disconnect`, `selectProject`) instead of always reporting `null`. `OpenShiftDiscoveryModeAndRefreshTest`, `OpenShiftConnectionControllerIntegrationTest` |
| OS-1A-19 | **Refresh uses the exact same discovery-and-fallback policy as connect** — a connection that reached `CONNECTED` via the namespaces fallback must not fail Refresh merely because refresh skips the fallback; a refresh that observes a genuinely different mode than the one recorded at connect time reports the fresh truth, never a stale pinned label | `VERIFIED` | One shared `OpenShiftConnectionService#discoverProjectsOrNamespaces`, called by both `connect` and `refreshProjects` — the fallback decision is no longer duplicated between the two call sites. `OpenShiftDiscoveryModeAndRefreshTest` covers `REFRESH_PROJECTS_200`, `REFRESH_PROJECTS_404_NAMESPACES_200`, the reverse (namespaces → available again → `PROJECTS`), `REFRESH_PROJECTS_{401,403,429,500,MALFORMED}` (no fallback in any case), a vanished selection after a namespace-fallback refresh cleared truthfully, and stale-refresh protection for both the project list and the discovery mode together |

### 12c. OS-1B — workload / pod / container discovery (implemented and verified)

OS-1B implemented namespace-scoped workload, pod and container discovery
and selection only. Search, context, correlation and Live remain **not**
implemented; the source's capabilities are unchanged from OS-1A (all
seven `false`).

| ID | NAME | STATUS | EVIDENCE |
|---|---|---|---|
| OS-1B-1 | Workload identity is a strongly-typed value (kind + name + namespace), never a bare display string | `VERIFIED` | `WorkloadRef` (validated compact constructor); `WorkloadRefTest` (5 tests) proves two different kinds sharing a name are non-equal references |
| OS-1B-2 | **Deployment** support | `VERIFIED` | `WorkloadKind.DEPLOYMENT`; `OpenShiftScopeServiceTest` |
| OS-1B-3 | **StatefulSet** support | `VERIFIED` | `WorkloadKind.STATEFUL_SET`; `OpenShiftScopeServiceTest` |
| OS-1B-4 | **DaemonSet** support, including its different desired/ready status field names (`desiredNumberScheduled`/`numberReady`, no `spec.replicas`) | `VERIFIED` | `OpenShiftApiClient#workloadSummaries`; `OpenShiftScopeServiceTest` |
| OS-1B-5 | **DeploymentConfig** support, truthfully absent-vs-forbidden-vs-available, flat (not nested) selector shape | `VERIFIED` | `WorkloadKind.DEPLOYMENT_CONFIG`; `aDeploymentConfigThatIsAvailableMakesTheOverallStatusSuccess`, `deploymentConfigSelectorIsReadAsAFlatMapNotNestedUnderMatchLabels` |
| OS-1B-6 | **Jobs/CronJobs deferred**, explicitly, not silently omitted | `DEFERRED` | `WorkloadKind`'s own javadoc; `OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` §2 |
| OS-1B-7 | Namespace-scoped-only workload discovery, one GET per kind, concurrent, never cluster-wide | `VERIFIED` | `OpenShiftScopeService#discoverWorkloads`; `OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` §11 (exact request-count accounting) |
| OS-1B-8 | One workload kind's absence/forbiddenness never fails discovery of the others - explicit `AVAILABLE`/`UNAVAILABLE_RESOURCE_TYPE`/`FORBIDDEN`/`ERROR` per kind, `SUCCESS`/`PARTIAL`/`FORBIDDEN` overall | `VERIFIED` | `WorkloadDiscovery`; `OpenShiftScopeServiceTest` (partial-RBAC, all-forbidden, one-kind-erroring, one-kind-404 cases) |
| OS-1B-9 | A 401 during workload/pod discovery aborts the whole operation and expires the session, exactly like OS-1A's own 401 semantics | `VERIFIED` | `a401OnAnyKindAbortsTheWholeDiscoveryAndExpiresTheSession` |
| OS-1B-10 | Workload→pod resolution is selector-based (never per-pod, never a name guess), read fresh at resolution time | `VERIFIED` | `OpenShiftApiClient#fetchWorkloadSelector`/`fetchPods`; `resolvesPodsForASelectedWorkloadViaItsSelectorOnly` |
| OS-1B-11 | Robust to rolling deployments - old and new ReplicaSet pods both resolve via the Deployment's own selector | `VERIFIED` | `rollingDeploymentOldAndNewReplicaSetPodsBothMatchTheSameSelector` |
| OS-1B-12 | **Real defect found and fixed this slice**: double URL-encoding of the `labelSelector` query value silently broke every selector filter | `VERIFIED` (fixed) | `OpenShiftApiClient#podsPath`; caught by `resolvesPodsForASelectedWorkloadViaItsSelectorOnly` before the fix, passing after; see `OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` §4 |
| OS-1B-13 | Pod discovery: the union of pods belonging to every currently-discovered **supported** workload when no workload is selected ("All workloads") - never every pod in the namespace - safe metadata only | `VERIFIED` | `OpenShiftScopeService#discoverAllWorkloadsPods`; `allWorkloadsUnionIncludesOnlyPodsProvenToBelongToASupportedDiscoveredWorkload`; `PodSummary`. **Historical correction (review recovery, `OS_1B_REVIEW_RECOVERY_ALL_WORKLOADS_SCOPE`):** the original implementation fetched an **unfiltered** namespace-wide pod list for "All workloads" (`discoversAllPodsInTheNamespaceWhenNoWorkloadIsSelected`, since replaced) - a genuine scope defect that could include Job/CronJob/unsupported-workload/standalone/operator-managed pods. Fixed by unioning each supported workload's own selector-filtered pod list instead; see `OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` §20 for the full writeup |
| OS-1B-14 | Container discovery is per-selected-pod, `initContainers` explicitly deferred/excluded, served from cache with no extra network call | `VERIFIED` | `OpenShiftScopeService#discoverContainers`; `containerDiscoveryReturnsTheSelectedPodsCachedContainersWithNoExtraNetworkCall` |
| OS-1B-15 | Every workload/pod/container selection is server-validated against the last discovery result, never trusted from the frontend | `VERIFIED` | `OpenShiftSession#selectWorkload/selectPod/selectContainer`; `selectingAWorkloadDiscoveryNeverReturnedIsRejected`, `selectingAPodDiscoveryNeverReturnedIsRejected`, `selectingAContainerThePodDoesNotHaveIsRejected` |
| OS-1B-16 | Cascading resets: selecting a workload clears pod/container; selecting a pod clears container; a disappeared workload/pod clears its selection and everything below it; project change/reconnect/disconnect/expiry clear the whole scope | `VERIFIED` | `OpenShiftScope` (`with*` methods); `OpenShiftScopeTest` (7), `OpenShiftSessionScopeCascadeTest` (7) |
| OS-1B-17 | Stale-response protection one level deeper than OS-1A: a workload-discovery response for an abandoned project, or a pod-discovery response for an abandoned workload, is discarded, never applied | `VERIFIED` | `OpenShiftSession#updateWorkloads/updatePods` (generation + expected-project/workload guard); `aWorkloadDiscoveryResponseForAProjectTheUserHasSinceLeftIsDiscarded`, `aPodDiscoveryResponseForAWorkloadTheUserHasSinceLeftIsDiscarded`, `aStaleWorkloadDiscoveryFromAReplacedConnectionThrowsRatherThanOverwriting`; `OpenShiftScopeService.StaleScopeException` → HTTP 409 `STALE_SCOPE` |
| OS-1B-18 | Deterministic sorting: workloads by kind then name, pods by name, containers in manifest order | `VERIFIED` | `OpenShiftApiClient#workloadSummaries/podSummaries`; fixtures deliberately supplied out of order in tests to prove the client's own sort |
| OS-1B-19 | Source-specific, bounded discovery endpoints (`/workloads`, `/pods`, `/containers`) rather than one endpoint returning the whole cluster tree | `VERIFIED` | `OpenShiftScopeController`; `OpenShiftScopeControllerIntegrationTest` (5 tests, real HTTP) |
| OS-1B-20 | Capabilities remain truthful and unchanged - no new boolean flipped merely because workloads/pods are now discoverable | `VERIFIED` | `OpenShiftLogSource#capabilities()` unmodified; confirmed by re-reading the source this session |
| OS-1B-21 | Existing `openshift-loki`/Docker/Fixture sources unaffected | `VERIFIED` | No file under those packages touched; full 809-test backend suite green (`./mvnw test`; see `OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` §15 for the sandbox-IT accounting note) |
| OS-1B-22 | Frontend workload/pod/container hierarchy, with distinct loading/empty/forbidden states, never spamming the UI about an absent (but not forbidden/erroring) resource kind | `VERIFIED` | `OpenShiftScopeControls`; 5 new `OpenShiftSettingsPanel.test.tsx` tests |
| OS-1B-23 | Real Developer Sandbox verification for workload/pod/container discovery | `BLOCKED_CREDENTIALS` | No `OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN` supplied this mission; no OS-1B-specific Layer-3 test was written (explicitly conditional on credentials per the mission's own §28) |
| OS-1B-24 | Workload/pod-kind partial-RBAC completeness is tracked explicitly (`OpenShiftScope#workloadScopeComplete()`) and threaded into pod resolution as `PodDiscovery.status` (`COMPLETE`/`PARTIAL`) | `VERIFIED` | `OpenShiftScope#workloadScopeComplete`; `PodDiscovery`; `aForbiddenWorkloadKindMakesAllWorkloadsPartialWithoutWideningToNamespacePods`, `anUnavailableResourceTypeDoesNotMakeAllWorkloadsPartial`, `aPerWorkloadPodFetchFailureMarksTheUnionPartialWithoutFailingTheWholeRequest` |
| OS-1B-25 | A specific workload's own pod-selector fetch failing (independent of workload-kind discovery) marks the union `PARTIAL` rather than failing the whole request or fabricating completeness | `VERIFIED` | `aPerWorkloadPodFetchFailureMarksTheUnionPartialWithoutFailingTheWholeRequest`; `MockOpenShiftScopeServer#setPodsForbiddenForSelector` |
| OS-1B-26 | **Second defect found and fixed in the same review recovery**: `OpenShiftSession#updatePods` did not check the expected project, only the expected workload - for "All workloads" (`expectedWorkload == null`) a project switch left that value unchanged on both sides, so a stale cross-project pod result could not be detected by the pre-existing guard | `VERIFIED` (fixed) | `OpenShiftSession#updatePods` now takes and checks `expectedProject`; `aStaleAllWorkloadsPodResponseForAnAbandonedProjectIsDiscarded`, `aStaleAllWorkloadsPodResponseAfterReconnectIsDiscarded`; see `OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` §20 |
| OS-1B-27 | OS-1C consumption contract: OS-1C must consume `PodDiscovery` (pods + `status`) unchanged, must not re-fetch pods with a looser selector, and must not reinterpret `Workload = All` as "all namespace pods" | `APPROVED_PENDING` (documented now, enforced when OS-1C is implemented) | `OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` §20 "OS-1C contract" |

### 12d. OS-1C — direct OpenShift log search (implemented and verified)

OS-1C implements bounded direct log search over the Kubernetes Pod Logs
API, consuming OS-1B's resolved scope unchanged. Live tail, context view,
raw LogQL and pagination remain **not** implemented and remain `false`.

| ID | NAME | STATUS | EVIDENCE |
|---|---|---|---|
| OS-1C-1 | Direct log search over the Kubernetes Pod Logs API, consuming OS-1B's resolved `PodDiscovery`/scope unchanged - never re-derives "All workloads"/"All pods" itself, never a namespace-wide search | `VERIFIED` | `DirectPodLogProvider#search`/`#resolveTargets`; `OpenShiftLogSource#search` delegates unmodified; class javadoc "Scope is consumed, never rediscovered"; `deselectingWorkloadStillOnlyQueriesWhatOs1bResolvedNeverEveryNamespacePod` |
| OS-1C-2 | `GET .../pods/{pod}/log` with `timestamps=true`, `follow=false` always (no live tail), `sinceTime` pushed down as an optimization only, `tailLines` as an additional hard bound - no `oc logs`, no shell, no runtime `oc` dependency | `VERIFIED` | `OpenShiftApiClient#fetchPodLog`; `sinceTimeIsPushedDownAsAnOptimizationOnly`; every call goes through `WebClient#get()` only |
| OS-1C-3 | Explicit bounded fetch model: max pods, max (pod,container) targets, max lines/bytes per target, max events overall, max concurrency, per-target and overall timeouts - every limit a real enforced ceiling, no unlimited default | `VERIFIED` — **`maxBytesPerTarget` specifically was `IMPLEMENTED` but not truthfully `VERIFIED` until the OS-1C review recovery (OS-1C-22 below); this row's own evidence for it was a false positive, corrected here rather than silently left** | `DirectPodLogProperties`; `neverQueriesMoreThanTheConfiguredTargetCap...`, `neverConsidersMoreDistinctPodsThanTheConfiguredPodCap`, `neverReturnsMoreThanMaxEventsOverall...`, `fanOutNeverExceedsTheConfiguredMaxConcurrency`, `oneSlowPodExceedingItsPerTargetTimeout...` |
| OS-1C-4 | Truncation is never silent: when resolved targets exceed the cap, the gap (resolved vs queried) is named, not dropped, via the existing query-plan `notes` channel | `VERIFIED` | `DirectPodLogProvider#describeScopeWarnings`; `LogSource#describeScopeWarnings` (new default method); `QueryPlanBuilder`'s new `sourceWarnings` overload; `SearchService` wiring; `neverQueriesMoreThanTheConfiguredTargetCap...` |
| OS-1C-5 | Pod/container target semantics: selected pod+container = one target; pod+Container=All = every runtime container in that pod; Pod=All = every OS-1B-resolved pod's own containers (never assumed identical across replicas) | `VERIFIED` | `DirectPodLogProvider#resolveTargets`; `selectedPodAndSelectedContainerIsExactlyOneTarget`, `selectedPodWithContainerAllFetchesEveryRuntimeContainerInThatPod`, `podAllWithSelectedWorkloadFetchesEveryResolvedPodItsOwnContainers` |
| OS-1C-6 | `initContainers` remain deferred, never silently merged into search targets | `VERIFIED` | `resolveTargets` reads only `PodSummary#containerNames()`, which OS-1B already excludes init containers from |
| OS-1C-7 | Canonical parsing pipeline reused exactly - malformed/non-JSON lines become raw fallback events, never dropped; a multiline exception embedded in one JSON object stays one logical event, never stitched from raw lines across pods/containers/streams | `VERIFIED` | `LogLineParser` reused unmodified; `plainTextNonJsonLineBecomesARawFallbackEventNeverDropped`; `multilineExceptionEmbeddedInOneJsonObjectStaysOneLogicalEvent` |
| OS-1C-8 | Sensitive fields (`cif`/`UserName`/`CustomerId`/`deviceId`/`deviceIp`) carried raw for source-side filter matching only, masked at the one existing boundary - no new masking path | `VERIFIED` | `sensitiveFieldsAreCarriedRawForSourceSideMatchingNeverDroppedByParsing`; `MaskingService` untouched |
| OS-1C-9 | Structured filters (`EventFilters`) reused unmodified, applied post-fetch; no OpenShift-specific query language, no raw LogQL advertised by this source | `VERIFIED` | `structuredFilterIsAppliedAfterParsingExactlyLikeEveryOtherSource`; `capabilities().rawLogQL() == false` |
| OS-1C-10 | Deterministic multi-stream merge: `sourceTimestamp` primary key, explicit tie-breakers (namespace, pod, container, per-stream sequence) - result order never depends on Flux/HTTP arrival timing | `VERIFIED` | `DirectPodLogProvider#parseFilterAndMerge`; `mergesMultiplePodsDeterministicallyByTimestampThenNamespacePodContainer`; `resultOrderDoesNotDependOnWhichUpstreamRequestCompletesFirst` (proved against a genuinely concurrent fake server where the chronologically-earlier line's HTTP response arrives last) |
| OS-1C-11 | NEWEST/OLDEST both operate on the same bounded fetched window - truthful only within it, never a claim of global historical ordering | `VERIFIED` | `newestFirstAndOldestFirstBothOperateOnTheSameBoundedCandidateSet` |
| OS-1C-12 | No fake pagination: the source self-trims to its own internal event cap before `SearchService` ever sees the list, so `SearchService` can never build a pagination cursor for this source | `VERIFIED` | `DirectPodLogProvider#trimToInternalCap` (javadoc explains the mechanism); `neverReturnsMoreThanMaxEventsOverallSoNoFakePaginationCursorCanEverBeBuilt` |
| OS-1C-13 | Capability truthfulness: `historicalSearch=true` now truthfully means "bounded direct search over currently-resolved pods," not "indexed history"; `liveTail`/`contextView`/`rawLogQL`/`composeProjectScoping` remain `false` (pagination is not a field of this record - see OS-1C-12 for why it stays honestly absent) | `VERIFIED` | `OpenShiftLogSource#capabilities()`; `openShiftAdvertisesExactlyTheCapabilitiesItCanDeliver` (test renamed and corrected from its OS-1A form - see the OS-1C narrative below) |
| OS-1C-14 | Health distinguishes CONNECTED-and-search-ready from CONNECTED-but-no-project-selected (both DEGRADED-worthy in different ways) from EXPIRED - never reports "healthy, search capable" while the session is expired | `VERIFIED` | `OpenShiftLogSource#health()`; `healthReflectsConnectionStateWithoutAlarmingAboutTheNormalStartingState` |
| OS-1C-15 | One pod/container failing (404 disappeared, 403 forbidden, timeout, other error) never fails the whole search; every target forbidden is an explicit forbidden result, never a silently empty one; a 401 on any target aborts the search and expires the session | `VERIFIED` — resilience behavior unchanged; user-*visibility* of these per-target failures was a separate, then-open gap, now closed by OS-1C-24 below | `oneDisappearedPodDoesNotFailTheWholeSearch`, `oneForbiddenTargetIsPartialWhenOthersAreReadable`, `everyTargetForbiddenIsAnExplicitForbiddenResultNeverASilentEmptySearch`, `unauthorizedAbortsTheSearchAndExpiresTheSession`, `oneSlowPodExceedingItsPerTargetTimeoutIsExcludedButOthersStillReturn`, `aMissingContainerIsExcludedLikeAnyOtherFourOhFour` |
| OS-1C-16 | Immutable scope snapshot: generation, server, token, and the whole `OpenShiftScope` are read exactly once at search start, before any network call - a project/workload change mid-search cannot retroactively alter an in-flight search's targets | `VERIFIED` | `DirectPodLogProvider#search` (everything read inside one `Mono.defer` before any upstream call); class javadoc "Immutable scope snapshot (OS-1C §23)" |
| OS-1C-17 | Strictly read-only: only `GET` is ever issued against the pod-log endpoint - no `oc exec`, no shell, no runtime `oc` CLI dependency | `VERIFIED` | `OpenShiftApiClient#fetchPodLog` uses `WebClient#get()` exclusively |
| OS-1C-18 | No new sensitive-data disclosure: errors never surface a raw response body, token, or Authorization header; pod/container/namespace identity may appear, consistent with the existing disclosure policy | `VERIFIED` | `OpenShiftApiClient#classify` (pre-existing OS-1A mechanism, unmodified) never surfaces `cause.getMessage()`; `DirectPodLogProvider` logs nothing |
| OS-1C-19 | Existing Docker/Fixture/`openshift-loki` sources unaffected | `VERIFIED` | No file under those packages touched; full 850-test backend suite green (`./mvnw test`) |
| OS-1C-20 | Real Developer Sandbox verification for direct log search | `BLOCKED_CREDENTIALS` | No `OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN` supplied this mission; no OS-1C-specific Layer-3 test was written, matching OS-1A/1B's own precedent |
| OS-1C-21 | `maxPods` (distinct-pod cap, applied before per-pod container expansion) and `maxTargets` (the resulting (pod,container) fan-out cap) are two independently enforced dimensions, not one config field left unused | `VERIFIED` (fixed during this slice - see narrative below) | `DirectPodLogProvider#resolveTargets`/`resolveTargetPlan`; `neverConsidersMoreDistinctPodsThanTheConfiguredPodCap` |

### 12e. OS-1C REVIEW RECOVERY — true byte bounds & runtime partial-result truthfulness

Two evidence-backed defects found in PR #41's reviewed HEAD
(`37f39f9826cd00095672228ba617b54f1f6b9fbd`) and fixed. Full before/after
account: `docs/verification/OS_1C_OPENSHIFT_DIRECT_SEARCH_REPORT.md` §21.

| ID | NAME | STATUS | EVIDENCE |
|---|---|---|---|
| OS-1C-22 | `maxBytesPerTarget` is a true streaming byte bound - real encoded bytes counted as `DataBuffer`s arrive, never a full-body `bodyToMono(String.class)` read followed by a `String.length()` truncation; upstream subscription cancelled the instant the cap is reached; every `DataBuffer` released (proven via real pooled Netty `refCnt()` reaching 0); Spring's default in-memory codec limit never becomes an accidental controlling limit | `VERIFIED` | `OpenShiftApiClient#readBounded`/`fetchPodLog`; `OpenShiftApiClientByteBoundTest` (20 tests: under/at/over cap, multi-buffer straddling, real-byte-vs-char-count, ~20 MB synthetic source proving no full materialization + real cancellation, pooled-buffer release including the cap-mid-stream case, error-path release, end-to-end against `MockOpenShiftPodLogServer` incl. a real ~5 MB HTTP response bounded to 4 KB) |
| OS-1C-23 | UTF-8 decoding is safe at the byte-cap boundary: a genuinely truncated multi-byte trailing sequence is dropped (never a garbled U+FFFD left in the output), every byte before the cut is untouched, malformed UTF-8 never throws | `VERIFIED` | `OpenShiftApiClient#trimIncompleteUtf8Suffix`; `aTwoByteCharacterCutAfterOnlyItsLeadByteIsDropped`, `aThreeByteCharacterCutAfterOneOrTwoBytesIsDropped`, `aFourByteEmojiCutAtAnyPointIsDroppedNeverPartiallyDecoded`, `malformedTrailingBytesNeverThrow_deterministicNotCrash` |
| OS-1C-24 | Per-target runtime failures (not found, forbidden, timeout, upstream error) and per-target caps actually reached (byte cap, line cap possibly reached) are now user-visible, appended into the same `QueryPlan.notes` channel pre-search scope warnings already use, and mark `ResultCounts.truncated=true` | `VERIFIED` — closes the gap OS-1C-15 above and the original report's §13 "known, disclosed gap" left open | `core.model.SourceSearchOutcome`; `LogSource#searchWithOutcome` (new default method); `DirectPodLogProvider#searchWithOutcome`/`buildRuntimeWarnings`; `SearchService#toResult`/`withAppendedNotes`; the full runtime-partial matrix in `DirectPodLogProviderTest` (`oneOkPlusOneNotFoundIsPartialWithATargetNotFoundReason`, `...Forbidden...`, `...Timeout...`, `...ByteCapped...`) and `SearchServiceTest` (`aSourceReportedRuntimeWarningMarksTheResultTruncatedAndAppendsItToQueryPlanNotes`, `preSearchScopeWarningsAndRuntimeWarningsCoexistInTheSameNotesList`) |
| OS-1C-25 | All-targets-failed (all 404, all timeout, all generic error - not 403, which stays its own `FORBIDDEN` case) is an explicit failure (`OpenShiftApiException(Kind.UPSTREAM_UNAVAILABLE)`), never a silent, successful, complete-looking empty result | `VERIFIED` | New `Kind.UPSTREAM_UNAVAILABLE`; `DirectPodLogProvider#fetchAndMerge`'s generalized `anyOk` check; `everyTargetNotFoundIsAnExplicitFailureNeverASilentCompleteEmptyResult`, `everyTargetTimedOutOrErroredIsAnExplicitFailureNeverASilentCompleteEmptyResult` |
| OS-1C-26 | A per-target timeout is classified distinctly from a generic network/upstream failure | `VERIFIED` | New `Kind.TIMEOUT` (split out of `Kind.NETWORK`); `TargetOutcome.TIMEOUT` |
| OS-1C-27 | Internal `maxEventsOverall` safety-cap trimming is disclosed as `OVERALL_EVENT_CAP` - but only when it, not the caller's own smaller requested `limit`, is what actually controlled the trim | `VERIFIED` | `DirectPodLogProvider#trimToInternalCap` (`TrimResult#safetyCapReached`); `internalOverallEventCapIsExposedAsARuntimeWarningWhenItActuallyControlsTrimming`, `theCallersOwnSmallerRequestedLimitTrimmingIsNeverFlaggedAsOverallEventCap` |
| OS-1C-28 | Runtime metadata is request-scoped, never a shared/mutable side channel - two overlapping concurrent searches never leak one's warnings into the other's result | `VERIFIED` — executable proof, not merely architectural | `concurrentSearchesOnTheSameProviderInstanceNeverCrossContaminateOutcomes` (provider level, real `Mono.zip` concurrency); `overlappingConcurrentSearchesOnDifferentSourcesNeverLeakOneSourcesRuntimeWarningsIntoTheOthers` (`SearchService` level) |
| OS-1C-29 | Frontend renders OS-1C's new runtime-warning notes and truncation signal via the existing generic `QueryPlanDisclosure`/counts-summary UI - zero new components, zero OpenShift-specific visual clutter | `VERIFIED` | Real rendered-browser Playwright check (stubbed OS-1C-shaped `/api/v1/logs/search` response) against the real dev app - see the OS_1C report §21 "Frontend" subsection for the captured output |
| OS-1C-30 | A byte-capped truncation never surfaces its own artificial trailing partial line as a misleading "malformed" event | `VERIFIED` — self-caught defect during this recovery's own test-writing, fixed before merge | `DirectPodLogProvider#fetchTarget` (drops the trailing split line when `byteCapReached` and the body doesn't end in `\n`); `oneOkPlusOneByteCappedTargetIsPartialWithABytesCapReachedReason`, `aByteCappedTargetIsCancelledWhileOtherTargetsContinueNormally` |

### 12f. OS-1C FINAL REVIEW RECOVERY — cancellation bridge & PR hygiene

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1C-31 | A cancellation of `OpenShiftApiClient#readBounded`'s own `Mono` (downstream abort, `Mono.timeout()`, an overall search cancelled) is bridged to the raw HTTP body's `BaseSubscriber`, so the body subscription is torn down rather than continuing to drain after nobody will read the result | `VERIFIED` | `OpenShiftApiClient#readBounded` (`MonoSink#onCancel(collector::cancelFromDownstream)`); `downstreamCancellationAfterTheFirstChunkCancelsTheUnderlyingBodySubscription`, `cancellingTheOverallSearchCancelsAnInFlightSlowPodLogBodySubscription` |
| OS-1C-32 | A downstream/external cancellation is never converted into a successful `PodLogFetchResult` - only the subscriber's own byte-cap self-cancel is a success | `VERIFIED` | `BoundedBodyCollector.CancelCause` (`INTERNAL_CAP` vs `DOWNSTREAM`, set via `AtomicReference#compareAndSet` before either cancel path calls `cancel()`); `downstreamCancellationNeverEmitsASuccessfulResultAfterward`, `internalByteCapCancellationAndDownstreamCancellationRemainDistinguishable` |
| OS-1C-33 | A per-target timeout cancels the underlying body subscription rather than merely giving up waiting locally | `VERIFIED` | `aTimeoutOperatorCancelsTheUnderlyingBodySubscriptionInsteadOfHanging` (unit, `doOnCancel` probe), `endToEnd_aTimeoutAgainstARealSlowServerFailsQuicklyRatherThanWaitingForTheFullDelay` (real HTTP, 3s fixture vs. 150ms timeout, completes in well under 1s) |
| OS-1C-34 | No `DataBuffer` is leaked on either cancellation path (downstream cancel, timeout) | `VERIFIED` — real pooled Netty `refCnt()` proof, not merely "release() was called" | `noDataBufferLeakOnDownstreamCancellation`, `noDataBufferLeakWhenATimeoutCancelsTheBody` |
| OS-1C-35 | Backpressure against the raw body publisher is pull-style (`request(1)` at subscribe, `request(1)` again only after each buffer is processed and released) rather than unlimited (`request(Long.MAX_VALUE)`) | `VERIFIED` — all 20 pre-existing + 8 new byte-bound tests pass unchanged under this strategy | `OpenShiftApiClient.BoundedBodyCollector#hookOnSubscribe`/`hookOnNext` |
| OS-1C-36 | Unrelated historical evidence PNGs unintentionally modified by the OS-1C review recovery commit are restored byte-identical to their pre-recovery content, never regenerated/recompressed | `VERIFIED` | 188 files under `docs/verification/{UX_R1,UX_R3,UX_R4,UX_R5,UX_R6}_EVIDENCE/`, `legacy-slice8/`, `m/`, `ui-gap-closure/`, `ui-parity/`, `OS_1A_EVIDENCE/` restored via `git checkout 37f39f9 -- <paths>`; verified with an empty `git diff 37f39f9 -- <paths>` |

### 12g. OS-1D — OpenShift context, surrounding logs & correlation

See `docs/verification/OS_1D_OPENSHIFT_CONTEXT_CORRELATION_REPORT.md` for
the full account. Summary table:

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1D-1 | "Show surrounding logs" works for an OpenShift direct-search result, reusing the existing generic `/api/v1/logs/context` endpoint - no OpenShift-only endpoint | `VERIFIED` | `DirectPodLogProvider#resolveTargetPlan`'s narrow-context override; `aContextRequestNamingPodAndContainerQueriesOnlyThatOneTargetEvenWithManyPodsInScope` |
| OS-1D-2 | Root identity is the strongest available (not message text alone): timestamp, source, namespace, pod, container, correlation/trace/journey/event ids | `VERIFIED` | `useSearchState.ts#eventIdentity` extended with `containerName`/`namespace`; `ResultsTable.test.tsx`'s sibling-container and cross-namespace collision tests |
| OS-1D-3 | Context view is chronological (oldest first), root visibly marked when present, deterministic tie-breaking | `VERIFIED` — unchanged, pre-existing (`ContextSummary`/`sortByTimestampAscending`/OS-1C merge ordering), re-verified for OpenShift events | `ResultsTable.test.tsx` root-marking tests; `DirectPodLogProvider`'s existing deterministic merge (OS-1C, unchanged) |
| OS-1D-4 | Root-unavailable and other context gaps (byte/line cap, pod disappeared, forbidden, timeout) are truthfully distinguished, never collapsed into "No results" | `VERIFIED` | `ContextSummary`'s new root-unavailable notice; `aContextRequestForAPodThatHasDisappearedFromCurrentScopeStillAsksTheRealApiRatherThanSilentlyReturningEmpty`, `aContextRequestForAForbiddenPodIsAnExplicitForbiddenResultNeverASilentEmptyContext`, `aContextRequestStillSurfacesByteAndLineCapTruncationOnTheSingleNarrowedTarget` |
| OS-1D-5 | Correlation search (`correlationId`) works within the current OS-1B resolved scope, bounded, no unbounded cluster query | `VERIFIED` | `correlationIdMatchesEventsAcrossDifferentPodsWithinTheCurrentlyResolvedScope`, `aCorrelationIdWithNoMatchesIsAnOrdinaryEmptyResultNeverAnError` |
| OS-1D-6 | Trace search (`traceId`) works across multiple pods/services within resolved scope; `spanId` preserved as evidence | `VERIFIED` | `traceIdMatchesEventsAcrossMultipleServicesAndPods`; `spanId` already a canonical `CanonicalLogEvent` field, unaffected |
| OS-1D-7 | Journey correlation (`x-journey-trace-id`) reuses the existing generic Journey view/endpoint, bounded to OS-1B resolved scope | `VERIFIED` | `journeyIdMatchesEventsWithinTheCurrentOpenShiftResolvedScope`; `SearchController#journey` unchanged, source-agnostic |
| OS-1D-8 | Cross-pod/cross-workload correlation stays inside the OS-1B resolved supported-workload pod set; never all-namespace, never Jobs/CronJobs/standalone pods | `VERIFIED` — unchanged from OS-1B/1C, re-confirmed | `resolveTargets`' full-scope path (untouched); no new workload-kind resolution added |
| OS-1D-9 | OS-1C runtime-partial-result metadata (`TARGET_NOT_FOUND`/`PERMISSION_DENIED`/`TARGET_TIMEOUT`/`UPSTREAM_ERROR`/`BYTE_CAP_REACHED`/`LINE_CAP_REACHED_OR_POSSIBLE`/`OVERALL_EVENT_CAP`) is preserved for context and correlation calls, not just plain search | `VERIFIED` | `aContextRequestStillSurfacesByteAndLineCapTruncationOnTheSingleNarrowedTarget`; `correlationSearchWithOneForbiddenTargetStillReturnsMatchesFromTheReadableOneWithAPartialWarning` |
| OS-1D-10 | No fabricated causality - context/correlation copy uses "correlated"/"observed"/"nearby", never "caused"/"root cause"/"call graph" | `VERIFIED` | `ContextSummary`'s existing and new copy audited; no new causal-language string was introduced anywhere in this slice |
| OS-1D-11 | Inspector shows truthful OpenShift location metadata (Source, Namespace, Pod, Container) without raw Kubernetes metadata dumps | `VERIFIED` — already satisfied before this slice, confirmed not regressed | `frontend/src/features/inspector/sections.ts#buildOverviewFields` (pre-existing `Namespace`/`Pod`/`Container` rows) |
| OS-1D-12 | `contextView` capability is only advertised `true` once genuinely tested end to end (backend narrowing + real rendered frontend) | `VERIFIED` | `OpenShiftLogSource#capabilities()`; `OpenShiftSecurityBoundariesTest#openShiftAdvertisesExactlyTheCapabilitiesItCanDeliver` (CORRECTED); LERUX-1 real-browser evidence, OS-1D report §8 |
| OS-1D-13 | `REAL_OPENSHIFT_1D` real-cluster verification gate is run if credentials are available, never fabricated if not | `BLOCKED_CREDENTIALS` | No live OpenShift credentials available in this environment; honestly reported, not simulated |
| TEST-INFRA-1 | Historical Evidence Mutation Isolation — running normal verification/E2E must not modify tracked historical evidence files unless explicitly requested | `APPROVED_PENDING_HARDENING` (deferred, tracked, registered per mission §46 — not fixed opportunistically in OS-1D) | Observed twice now (OS-1C final review recovery, and again during OS-1D's own validation pass - both times restored via `git checkout` before finalizing, verified via an empty `git diff --name-status main...HEAD -- '*.png'`); root cause is `frontend/e2e/helpers.ts#captureScreenshot` writing directly into `docs/verification/<phase>/` rather than a temporary/output directory by default |

**OS-1D pass.** No previously-`VERIFIED` OS-1A/1B/1C requirement was
reopened or changed status. `Kind.UPSTREAM_UNAVAILABLE`/`Kind.FORBIDDEN`/
`Kind.TIMEOUT` (all pre-existing, OS-1C review recovery) are reused
unchanged for the new narrow-context target-not-found/forbidden cases -
no new `OpenShiftApiException.Kind` value was needed. `REL-1` (local
reproducible desktop packaging) remains confirmed `APPROVED_PENDING`,
untouched.

### 12h. OS-1D REVIEW RECOVERY — context target authorization & scope proof

See `docs/verification/OS_1D_OPENSHIFT_CONTEXT_CORRELATION_REPORT.md` §14
for the full account, including the historical correction of OS-1D-1's
original evidence (the pre-recovery narrow-context mechanism unintentionally
permitted reading any pod/container name in the namespace via a crafted
request — fixed, not silently erased).

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1D-14 | A client-supplied `pod`/`containerName` pair alone must never authorize direct pod-log retrieval — the backend must hold its own evidence the target was a real, legitimately-resolved search target | `VERIFIED` | `DirectPodLogProvider#authorizeNarrowContextTarget`; `c_anArbitraryOutOfScopePodWithNoProofIsRejectedWithZeroClusterCalls` |
| OS-1D-15 | A pod still present in the current OS-1B resolved scope is authorized by ordinary, unweakened scope validation alone — no proof required or consulted | `VERIFIED` | `a_currentScopeTargetIsAllowedWithNoProofAtAll`, `l_theProofMechanismDoesNotBreakTheNormalContextWorkflowWhenTheTargetIsStillInScope` |
| OS-1D-16 | A pod that has disappeared from current scope since the original search is still reachable via a valid, server-issued historical scope proof, and a genuine 404 remains truthful | `VERIFIED` | `core.search.ContextTargetProofCodec`; `b_aDisappearedPodWithAValidProofStillReachesTheRealApiAndGetsATruthfulNotFound` |
| OS-1D-17 | A forged or tampered proof is rejected before any cluster call, with zero pod-log API calls made | `VERIFIED` | `d_anArbitraryOutOfScopePodWithAForgedOrTamperedProofIsRejectedWithZeroClusterCalls`; `ContextTargetProofCodecTest` (tamper/malformed/cross-instance rejection) |
| OS-1D-18 | A valid proof binds to the exact connection generation it was issued under — reconnecting invalidates every previously-issued proof | `VERIFIED` | `g_aProofFromAnOldConnectionGenerationIsRejectedAfterReconnect` (real reconnect, new generation) |
| OS-1D-19 | A valid proof binds to the exact namespace/project it was issued for | `VERIFIED` | `f_aValidProofForADifferentNamespaceIsRejected` |
| OS-1D-20 | A valid proof binds to the exact (pod, container) pair it was issued for — never just the pod | `VERIFIED` | `e_aValidProofForADifferentContainerIsRejected` |
| OS-1D-21 | A valid proof binds to the exact source id it was issued for | `VERIFIED` | `h_aProofIssuedForAnotherSourceIdIsRejected` |
| OS-1D-22 | Job/CronJob-owned, standalone, and operator/unknown-controller pods — never part of any OS-1B-resolved scope — cannot be read through a crafted context request, with or without an attempted proof | `VERIFIED` | `i_...Job...`, `j_...standalone...`, `k_...operator...` (all three: zero cluster calls) |
| OS-1D-23 | An unauthorized/out-of-scope context target never becomes an oracle for whether an arbitrary pod name exists — the rejection is a single fixed message regardless of which check failed | `VERIFIED` | `ContextTargetProofCodecTest#theRejectionMessageIsAlwaysTheSameFixedStringAndNeverEchoesFieldValues` |
| OS-1D-24 | Correlation/trace/journey search is unaffected by the authorization gate (never narrowed to one historical target, never requires a proof) | `VERIFIED` — unchanged, re-verified | Pre-existing correlation/trace/journey test suite passes unmodified; `authorizeNarrowContextTarget` is only reachable when both `pod` and `containerName` are set, which correlation/trace/journey never do |
| OS-1D-25 | `contextTargetProof` is never displayed, copied to clipboard, persisted, put in a URL, or logged | `VERIFIED` | See report §14 "`contextTargetProof` handling" subsection for the full per-surface audit |

**OS-1D REVIEW RECOVERY pass.** OS-1D-1 through OS-1D-13's evidence is
corrected where it described the pre-recovery mechanism (see report §14's
own "Documentation/history correction" subsection) — never silently
rewritten, the original text is preserved with the correction appended.
No other OS-1D/1C/1B/1A requirement changed status. `TEST-INFRA-1` remains
`APPROVED_PENDING_HARDENING`, untouched. `REL-1` remains confirmed
`APPROVED_PENDING`, untouched.

### 12i. OS-1D FINAL REVIEW RECOVERY — context proof generation snapshot consistency

See `docs/verification/OS_1D_OPENSHIFT_CONTEXT_CORRELATION_REPORT.md` §15
for the full account, including the correction of §14's own claim that
its authorization gate fully preserved OS-1C's "immutable scope snapshot"
discipline — it did, for every field except `generation`, which was
re-read live at verification time instead of using the caller's own
already-captured value.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1D-26 | Context target proof verification uses the operation's own already-captured connection generation, never a live re-read of `session.generation()` | `VERIFIED` | `DirectPodLogProvider#authorizeNarrowContextTarget` (no `session.generation()` call remains in the authorization path); `aProofNamingADifferentGenerationThanTheOperationsOwnCapturedSnapshotIsRejected` |
| OS-1D-27 | The connection generation used to authorize a context target and the server/token used to actually perform the pod-log read belong to the same immutable snapshot — no mixed-generation execution | `VERIFIED` — real interleaving, not merely architectural | `inFlight_aProofPathContextOperationCompletesAgainstItsCapturedConnectionEvenWhenTheSessionReconnectsMidFlight` (independent second mock cluster proves zero cross-contamination) |
| OS-1D-28 | The current-scope (no-proof) authorization path is equally immune to a mid-flight reconnect | `VERIFIED` | `inFlight_theCurrentScopePathAlsoCompletesAgainstItsCapturedConnectionEvenWhenTheSessionReconnectsMidFlight` |
| OS-1D-29 | A context request that starts after a real reconnect, carrying a proof issued under the old connection generation, remains rejected (regression-checked, unchanged) | `VERIFIED` — pre-existing test re-verified passing unmodified | `g_aProofFromAnOldConnectionGenerationIsRejectedAfterReconnect` |
| OS-1D-30 | `describeScopeWarnings` captures its own generation/namespace/scope once, together, rather than reading session state piecemeal across the method | `VERIFIED` | `DirectPodLogProvider#describeScopeWarnings` (single capture block at the top) |

**OS-1D FINAL REVIEW RECOVERY pass.** No `ContextTargetProofCodec` design
element, HMAC format, or field-binding rule from §12h changed — only which
value (captured vs. live) authorization compares the proof's own
generation field against. None of OS-1D-1 through OS-1D-25's `VERIFIED`
rows were reopened; §14's evidence gains the correction above, not a
rewrite. `TEST-INFRA-1` remains `APPROVED_PENDING_HARDENING`, untouched.
`REL-1` remains confirmed `APPROVED_PENDING`, untouched.

### 12j. OS-1D FINAL SNAPSHOT ATOMICITY RECOVERY

See `docs/verification/OS_1D_OPENSHIFT_CONTEXT_CORRELATION_REPORT.md` §16
for the full account, including the correction of §12i's own claim that
threading the captured `generation` value was sufficient — the value
itself, and every other connection-sensitive field, was still obtained
through several independent `OpenShiftSession` getter calls rather than
one atomic read.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1D-31 | Every authenticated OpenShift operation (search, context authorization, workload/pod/container discovery, project refresh) captures its connection-sensitive state via exactly one atomic `OpenShiftSession` read, never several independent getter calls | `VERIFIED` | New `OpenShiftSession#operationSnapshot()` (single `current.get()`), consumed by `DirectPodLogProvider#searchWithOutcome`/`describeScopeWarnings`, `OpenShiftScopeService#discoverWorkloads`/`discoverPods`, `OpenShiftConnectionService#refreshProjects` |
| OS-1D-32 | The returned operation snapshot is immutable and does not expose the raw token outside the minimum required package boundary | `VERIFIED` | `ConnectionOperationSnapshot` (package-private record, package-private `token()` accessor — verified via reflection on the type/method modifiers, not merely by convention); `ConnectionOperationSnapshotTest` |
| OS-1D-33 | It is structurally impossible for one operation to observe connection-sensitive fields from two different connections (e.g. `generation=A` paired with `server=B`) | `VERIFIED` | `ConnectionOperationSnapshotTest#everyFieldOriginatesFromTheSameUnderlyingRead_neverAMixOfTwoConnections`; structural proof — `operationSnapshot()` is the only way to obtain a `ConnectionOperationSnapshot`, and it performs exactly one `current.get()` |
| OS-1D-34 | An operation snapshot remains unchanged after a later reconnect or disconnect — it is a captured value, never a live view | `VERIFIED` | `ConnectionOperationSnapshotTest#remainsUnchangedAfterALaterReconnect...`/`...ALaterDisconnect` |
| OS-1D-35 | An operation started fresh after a reconnect fully adopts the new connection (server, namespace, scope) — not merely "the old proof is rejected" | `VERIFIED` | `anOperationStartedAfterAReconnectFullyAdoptsTheNewConnectionsServerNamespaceAndScope` (real search against an independent second mock cluster) |
| OS-1D-36 | `describeScopeWarnings` and every workload/pod/container discovery method (`OpenShiftScopeService`) use the same one-atomic-read discipline as search/context authorization | `VERIFIED` | `DirectPodLogProvider#describeScopeWarnings`; `OpenShiftScopeService#discoverWorkloads`/`discoverPods` (with `scope` threaded as a parameter into `discoverAllWorkloadsPods`, never re-read there) |
| OS-1D-37 | Intentionally-safe remaining independent `OpenShiftSession` reads (the generation guard, single-expression CAS-guard reads, local-cache-only reads, the health badge) are documented, not silently left unexplained | `VERIFIED` | Report §16 "Audit of remaining `OpenShiftSession` multi-field reads" — full table with verdicts |

**OS-1D FINAL SNAPSHOT ATOMICITY RECOVERY pass.** No `ContextTargetProofCodec`
design, HMAC format, or field-binding rule changed. No OS-1C search bound,
correlation/trace/journey behavior, or pagination invariant changed. None
of OS-1D-1 through OS-1D-30's `VERIFIED` rows were reopened — §14/§15's
own fixes remain correct and are not undone; this pass closes the deeper
"captured through one atomic read, not several" gap those fixes still
had. `TEST-INFRA-1` remains `APPROVED_PENDING_HARDENING`, untouched.
`REL-1` remains confirmed `APPROVED_PENDING`, untouched.

### 12k. OS-1E — OpenShift Live Tail

Stacked on PR #42's approved HEAD while that PR remained externally
blocked on the Windows Desktop CI gate (§7c). See
`docs/verification/OS_1E_OPENSHIFT_LIVE_REPORT.md` for the full account.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1E-1 | Direct `follow=true` Kubernetes/OpenShift pod-log streaming — no `oc logs -f`, no shell, no exec/attach/port-forward, no runtime `oc` dependency | `VERIFIED` | `OpenShiftApiClient#followPodLog`; `bodyToFlux(DataBuffer.class)`, never `bodyToMono` |
| OS-1E-2 | A genuinely streaming, bounded-memory line decoder — never materializes the unbounded body, releases every `DataBuffer`, bridges downstream cancellation to the upstream subscription | `VERIFIED` | `OpenShiftApiClient#decodeLines`/`LineDecodingSubscriber`/`LiveLineDecoder`; `OpenShiftApiClientLiveStreamTest` (15 tests, incl. real pooled-buffer ref-count release proof and real cancellation propagation) |
| OS-1E-3 | `\n`-delimited line framing is UTF-8-safe across arbitrary chunk boundaries, with a bounded max-line-size safety valve that trims rather than garbles | `VERIFIED` | `LiveLineDecoder`; chunk-boundary-inside-a-UTF-8-character and forced-cutoff-at-a-character-boundary tests |
| OS-1E-4 | Live targets are resolved through the exact same OS-1B/OS-1C scope logic search already uses (Selected Pod+Container / Pod+Container=All / Pod=All+Workload / Pod=All+Workload=All), bounded by the same `maxPods`/`maxTargets` — never a second, parallel notion of scope | `VERIFIED` | `DirectPodLogProvider#resolveTargets` widened to package-private, reused directly by `OpenShiftLiveTailProvider`; `OpenShiftLiveTailProviderTest` (target-cap and multi-target-merge tests) |
| OS-1E-5 | The live-session start captures connection state via exactly one atomic `OpenShiftSession#operationSnapshot()` read, reusing OS-1D's own mechanism rather than re-implementing it | `VERIFIED` | `OpenShiftLiveTailProvider#follow`/`startSession` |
| OS-1E-6 | Per-target bounded reconnect, classified by failure kind (401 permanent + generation-guarded session expiry; 403/404 permanent; transient bounded exponential backoff) — one target's failure never stops another | `VERIFIED` | `OpenShiftLiveTailProvider#reconnectOrStop`; `OpenShiftLiveTailProviderTest` (generation-isolation, 403/404-zero-reconnect, transient-recovers, transient-gives-up-after-max-attempts tests) |
| OS-1E-7 | A zero-target or all-targets-permanently-stopped session completes the event stream truthfully rather than hanging in a silent "quiet LIVE" | `VERIFIED` | `OpenShiftLiveTailProviderTest#zeroResolvedTargetsCompletesTheStreamAndWarnsRatherThanHanging` |
| OS-1E-8 | New replicas from a rolling deployment are not auto-attached to a running live session (`LIVE_TARGET_SNAPSHOT=IMMUTABLE`) — Kubernetes Watch-based re-resolution is explicitly deferred, not introduced casually | `VERIFIED` (as a deliberate, documented non-behavior) | `OpenShiftLiveTailProvider#boundedTargets` resolved once at session start, never re-resolved; report §7 |
| OS-1E-9 | Truthful partial-live-state disclosure (target stopped, target cap reached) reaches the existing generic Live status surface — never fabricated, never a new OpenShift-only side channel | `VERIFIED`, **superseded by OS-1E-18 below** | Original evidence named `LogSource#followWithWarnings`/`StatusPayload.warnings` (a single-latest-warning channel) — replaced by `followWithStatus`/`LiveSourceStatus` in the review recovery pass; the underlying REQUIREMENT (truthful disclosure through the existing generic surface) remains `VERIFIED`, its enforcement mechanism does not |
| OS-1E-10 | Filtering/masking fully reused from the existing canonical pipeline — server-side only, no raw protected value ever reaches the browser via the live path | `VERIFIED` | `LiveTailService#follow` masks every event via the same `EventMapper` every endpoint uses, unchanged by this slice |
| OS-1E-11 | The existing generic Live architecture (`LiveTailController`/`LiveTailService`/`LiveTailGuard`/`useLiveTail`/`LiveTailPanel`) is reused end to end — no parallel OpenShift-specific Live product, no `OpenShiftLiveTailPanel` | `VERIFIED` | §2 of the OS-1E report; the review recovery pass's own frontend change is still purely additive (`sourceStatus` replacing `sourceWarnings`) — no new Live state machine, no OpenShift-specific panel |
| OS-1E-12 | `liveTail` capability flips `true` only after full implementation and the full test matrix passed | `VERIFIED` | `OpenShiftLogSource#capabilities()`; `OpenShiftSecurityBoundariesTest`; real running-backend `/api/v1/sources` check; `os-1a-openshift-connection.spec.ts` real-browser pin |
| OS-1E-13 | Real OpenShift cluster verification | `BLOCKED_CREDENTIALS` | Consistent with every prior OS-1x slice's own honest status; no cluster behavior fabricated |

**OS-1E pass.** No `ContextTargetProofCodec`/`ConnectionOperationSnapshot`/
`resolveTargetPlan` design changed — both reused exactly as OS-1D left
them. No historical search, context, or correlation behavior changed.
One new deferred requirement registered per this slice's own mission:
`REL-1` addendum, "Reproducible Windows .NET / NuGet Toolchain" (§7c),
`APPROVED_PENDING`, **not implemented**. `TEST-INFRA-1` remains
`APPROVED_PENDING_HARDENING`, untouched — re-confirmed via the same
PNG-restoration mitigation after this slice's own full E2E run.
`REAL_OPENSHIFT_1E=BLOCKED_CREDENTIALS`, consistent with every prior
OS-1x slice.

### 12l. OS-1E REVIEW RECOVERY — live stream truthfulness, bounded reconnect, long-line integrity & active-stream state

An independent review of the §12k implementation found six real defects
before OS-1E could be approved. None reopen OS-1B/OS-1C/OS-1D's own
already-`VERIFIED` rows, and none touch `ContextTargetProofCodec`/
`ConnectionOperationSnapshot`/`resolveTargetPlan`. See
`docs/verification/OS_1E_OPENSHIFT_LIVE_REPORT.md`'s own review-recovery
section for the full before/after account.

| # | Finding | Status |
|---|---|---|
| 1 | Reconnect retry budget could be reset forever by replayed initial-tail rows — every reconnect reused `initialTailLines` (not `0`), so a pod with existing historical lines could make `receivedAnyEvent` true on every attempt, resetting the budget indefinitely and defeating `maxReconnectAttempts` as a real bound | `RESOLVED` |
| 2 | Oversized physical lines were fragmented into multiple synthetic events — the original `LiveLineDecoder` emitted a new "line" every time `maxLineBytes` was reached even mid-physical-line, so one real 200 KB log line could become several fake `CanonicalLogEvent`s | `RESOLVED` |
| 3 | `maxConcurrency` was claimed but not actually enforced in the live connect/reconnect path — `OpenShiftLiveTailProvider` used a plain `Flux.merge` over every target with no admission bound at all | `RESOLVED` |
| 4 | Zero-active targets could leave the generic SSE transport connection open (the heartbeat keeps it alive by design) and therefore visually remain labeled plain LIVE, with no distinct frontend truth | `RESOLVED` |
| 5 | Per-target warning state retained only the single most-recently-emitted warning instead of the complete CURRENT state — target A stopping then target B also stopping reported only B | `RESOLVED` |
| 6 | Connection generation changes and scope (project/workload/pod/container) changes during an immutable live-target snapshot were not surfaced as stale/restart-required — the old session correctly never migrated credentials, but also never actively terminated or flagged itself | `RESOLVED` |

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1E-14 | A target's very first connection uses the configured `initialTailLines`; every reconnect uses `tailLines=0` (the `kubectl logs -f --tail=0` idiom) — a reconnect can never replay history | `VERIFIED` | `OpenShiftApiClient#followPodLog` (`tailLines` now a genuine per-call parameter); `OpenShiftLiveTailProvider#followTarget`; `OpenShiftLiveTailProviderTest#reconnectA_initialTailUsesConfiguredValueEveryReconnectUsesZero` |
| OS-1E-15 | `REAL_RECOVERY` is explicitly defined as "a reconnect attempt (`tailLines=0`) delivers at least one genuine event" — historical initial-tail data can never reset the reconnect budget, and retry exhaustion remains genuinely deterministic and bounded even when historical data was present | `VERIFIED` | `OpenShiftLiveTailProvider#budgetBasis`; `OpenShiftLiveTailProviderTest#reconnectB_historicalTailEventCannotResetTheReconnectBudget`, `#reconnectC_persistentFailureAfterHistoricalDataStillReachesRetryExhaustion`, `#reconnectD_aGenuinePostReconnectEventResetsTheBudget`, `#reconnectE_retryExhaustionIsExactlyDeterministic`, `#reconnectF_stopDuringReconnectBackoffCancelsTheRetry` |
| OS-1E-16 | A physical overlong line produces at most ONE `CanonicalLogEvent` (marked truncated), never several fake ones; every further byte of that same physical line is discarded (never buffered, never emitted) until the real terminating `\n` | `VERIFIED` | `OpenShiftApiClient.DecodedLine`/`LiveLineDecoder` (`discardingOverlong` mode); `OpenShiftApiClientLiveStreamTest` (5 dedicated overlong-line tests, incl. a 200,000-byte physical line and a UTF-8-boundary truncation case) |
| OS-1E-17 | Overlong-line truncation is surfaced to the live runtime status as one bounded, growing COUNT ("N overlong lines truncated"), never one new warning string per occurrence | `VERIFIED` | `OpenShiftLiveTailProvider.SessionRuntimeState#incrementOverlong`; `OpenShiftLiveTailProviderTest#overlongLineTruncationReachesRuntimeStatusAsABoundedCount` |
| OS-1E-18 | Connect/reconnect ADMISSION is genuinely bounded by `DirectPodLogProperties#maxConcurrency` — distinct from `maxTargets` (the active-stream bound) — via a non-blocking per-session permit gate, releasing on first data/error/completion or a bounded timeout; deliberately not `flatMap(..., maxConcurrency)`, which would starve every target past the first `maxConcurrency` (each stream is intentionally infinite) | `VERIFIED` | `OpenShiftLiveTailProvider#gatedFollow`/`acquirePermit`; `OpenShiftLiveTailProviderTest` (`connectAttemptConcurrencyIsBoundedByMaxConcurrency_neverAllTargetsAtOnce`, `allAuthorizedTargetsEventuallyBecomeActive_oneLongLivedStreamDoesNotStarveOthers`, `cancellationReleasesAPendingConnectPermit_queuedTargetIsNeverStrandedForever`, `aFailedConnectReleasesItsPermitForTheNextQueuedTarget`) |
| OS-1E-19 | A new request/session-scoped `LiveSourceStatus` (state + resolved/active/reconnecting/stopped target counts + CURRENT warnings, never a delta) replaces the original single-warning channel; the correct state (`RUNNING`/`DEGRADED`/`RECONNECTING`/`NO_ACTIVE_TARGETS`/`EXPIRED`/`STALE`) is derived from live counts, never inferred from warning text | `VERIFIED`, **extended by OS-1E-23 below** | New `core.model.LiveSourceStatus`; `OpenShiftLiveTailProvider.SessionRuntimeState`; `OpenShiftLiveTailProviderTest` (`statusRunning_*`, `statusDegraded_*`, `statusReconnecting_*`, `statusNoActiveTargets_*`, `statusExpired_*`, `statusRetainsEveryCurrentlyStoppedTargetsTruth_*`) — the state enum and count set are widened by the final implementation pass (a `CONNECTING` state/count), the underlying "full current snapshot, never a delta" design is unchanged |
| OS-1E-20 | Zero active AND zero reconnecting targets is never displayed as plain LIVE in the rendered frontend, even though the SSE heartbeat legitimately keeps the connection open to deliver that truth | `VERIFIED` (real rendered-browser + component evidence) | `LiveTailPanel.tsx#sourceStatusBadge` (badge override for `NO_ACTIVE_TARGETS`/`EXPIRED`/`STALE` while `connectionState` is `'live'`/`'paused'`); `LiveTailPanel.test.tsx` (5 dedicated override tests); DEGRADED still reads LIVE with an appended active/resolved count, never hidden |
| OS-1E-21 | A generation change (reconnect) during a running live session marks that OLD session `STALE` and terminates its own target streams via a bounded, in-memory-only periodic check (never a cluster/Watch call) — it never migrates onto the new connection's credentials | `VERIFIED` | `OpenShiftLiveTailProvider#detectStaleness`/`startSession`'s `takeUntilOther(staleSignal)`; `OpenShiftLiveTailProviderTest#generationChangeMarksTheOldSessionStaleAndStopsIt_neverMigratesCredentials` |
| OS-1E-22 | A scope change (project/workload/pod/container) during an immutable live-target snapshot is surfaced as `STALE`/`SCOPE_CHANGED_RESTART_LIVE`, never silently displayed as if it reflected the newly-selected scope | `VERIFIED` | `OpenShiftLiveTailProvider#detectStaleness`; `OpenShiftLiveTailProviderTest#scopeChangeWhileImmutableSnapshotActiveIsSurfacedAsStale` |

**OS-1E REVIEW RECOVERY pass.** 22 new/superseded rows total (OS-1E-14
through OS-1E-22 new; OS-1E-9/OS-1E-11's evidence corrected in place,
their underlying requirement unchanged). No `ContextTargetProofCodec`/
`ConnectionOperationSnapshot`/`resolveTargetPlan` design touched. No
historical search, context, or correlation behavior changed — this
recovery is scoped entirely to the live-tail-specific defects above.
`TEST-INFRA-1` remains `APPROVED_PENDING_HARDENING`, untouched — re-
confirmed via the same PNG-restoration mitigation after this pass's own
full backend/frontend/E2E validation. `REL-1` (§7, §7b, §7c) remains
confirmed `APPROVED_PENDING`, untouched. `REAL_OPENSHIFT_1E=BLOCKED_CREDENTIALS`,
consistent with every prior OS-1x slice — this recovery neither touched
nor could convert that status.

### 12m. OS-1E FINAL IMPLEMENTATION — approved live contract (exchangeToFlux establishment, exact long-line boundary, partial-final-line contract, CONNECTING state, terminal-SSE grace-close)

A separate, owner-authorized design-closure pass (text-only, no code) re-
examined §12l's own implementation as INPUT rather than authority, and
found it still contained one real defect the review-recovery pass had not
caught, plus several genuine design gaps. This section records the
resulting FINAL implementation. See
`docs/verification/OS_1E_OPENSHIFT_LIVE_REPORT.md`'s own §14 for the full
before/after account and worked examples.

| # | Finding | Status |
|---|---|---|
| 1 | A target was marked `ACTIVE` at `followTarget()` entry — before any HTTP response, before any log line — so a target still queued behind `maxConcurrency` admission could be displayed as active; `resolvedTargets=10, maxConcurrency=2` could show `activeTargets=10, RUNNING` | `RESOLVED` |
| 2 | A physical line of exactly `maxLineBytes` bytes followed by a real newline was falsely reported `truncated=true` — the original overflow check ran on the post-write buffer size, one byte too late | `RESOLVED` |
| 3 | A clean EOF (or an error, or an explicit Stop) with a buffered-but-unterminated trailing fragment silently dropped that fragment — no flush of a final partial line existed at all, for any termination cause | `RESOLVED` |
| 4 | No `connectingTargets` count/state existed — a target waiting for admission had no distinct representation in `LiveSourceStatus`, collapsing into either "not yet counted" or the pre-existing `ACTIVE` defect (finding 1) | `RESOLVED` |
| 5 | `STREAM_ACTIVE` (HTTP `2xx` established) and `OUTAGE_RECOVERY_BUDGET_RESET` (a genuine post-reconnect data event) were at risk of being conflated once establishment became its own distinct signal — establishment alone must never reset the bounded reconnect budget | `RESOLVED` (explicit separation, not merely preserved) |
| 6 | A terminal SSE session (`NO_ACTIVE_TARGETS`/`EXPIRED`/`STALE`) rode the full `connectionTimeout` on the wire, and the frontend's generic `EventSource` auto-reconnect had no way to distinguish a deliberate terminal server-close from an ordinary transport failure, risking an infinite reconnect loop against a session that will never resume | `RESOLVED` |

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1E-23 | `OpenShiftApiClient#followPodLog` uses WebClient `exchangeToFlux`; an HTTP `2xx` response invokes a caller-supplied `onEstablished` callback exactly once, independent of any log line arriving; non-2xx routes through `response.createException().flatMapMany(Flux::error)` preserving all existing `classify()`-based exception mapping unchanged | `VERIFIED` | `OpenShiftApiClient#followPodLog`; `OpenShiftApiClientLiveStreamTest` (establishment-callback tests); `OpenShiftLiveTailProviderTest` CONNECT-1..6 |
| OS-1E-24 | A target is marked `CONNECTING` at `followTarget()` entry and only transitions to `ACTIVE` via the `onEstablished` callback (HTTP `2xx`) — never at entry, never on a bare connect-permit timeout | `VERIFIED` | `OpenShiftLiveTailProvider#followTarget`/`SessionRuntimeState#markConnecting`/`markActive`; `OpenShiftLiveTailProviderTest#connect1_targetIsConnectingNotActiveUntilEstablished` .. `#connect6_permitTimeoutReleasesConcurrencyCapacityButNeverMarksActive` |
| OS-1E-25 | `LiveSourceStatus` gains a `connectingTargets` count and a `CONNECTING` state; the invariant `resolvedTargets = connectingTargets + activeTargets + reconnectingTargets + stoppedTargets` holds for every snapshot; session state is derived by exact priority `STALE > EXPIRED > RUNNING > CONNECTING > DEGRADED > RECONNECTING > NO_ACTIVE_TARGETS`, with a documented, tested completion for the one gap in the literal owner formula (some targets connecting, some already permanently stopped, none active/reconnecting → `CONNECTING`, not `NO_ACTIVE_TARGETS`) | `VERIFIED` | `core.model.LiveSourceStatus` (`State.CONNECTING`, `connectingTargets`); `OpenShiftLiveTailProvider.SessionRuntimeState#snapshot`; `OpenShiftLiveTailProviderTest` (state-derivation tests incl. `stateConnecting_evenWithSomeAlreadyPermanentlyStopped_untilTheOutcomeIsFullyKnown`) |
| OS-1E-26 | Every resolved target's phase is seeded to `CONNECTING` synchronously before the session's first status push, so the very first snapshot never falsely reads as `NO_ACTIVE_TARGETS` before any connect attempt has even started | `VERIFIED` | `OpenShiftLiveTailProvider.SessionRuntimeState` constructor (seeds phases from the full target list); `OpenShiftLiveTailProviderTest` initial-snapshot tests |
| OS-1E-27 | `maxConcurrency` bounds simultaneous connect/reconnect OPEN attempts only (a permit is released on `2xx` establishment, on any terminating signal, or on a bounded `connectPermitTimeout`); a permit-timeout release never marks a target `ACTIVE` and never fabricates establishment | `VERIFIED` | `OpenShiftLiveTailProvider#gatedFollow` (`releasePermitOnce`, timeout path never calls `onEstablished`); `OpenShiftLiveTailProviderTest#connect6_permitTimeoutReleasesConcurrencyCapacityButNeverMarksActive` |
| OS-1E-28 | `STREAM_ACTIVE` (HTTP `2xx` establishment) is explicitly separated from `OUTAGE_RECOVERY_BUDGET_RESET` (a genuine post-reconnect `DecodedLine`, driven by `.doOnNext`, never by `onEstablished`) — establishment alone, without any real data, does not reset the bounded reconnect budget, since `tailLines=0` on every reconnect makes any real data provably non-replayed | `VERIFIED` | `OpenShiftLiveTailProvider#followTarget`/`budgetBasis` (`receivedRealDataThisAttempt` set only by `.doOnNext`); `OpenShiftLiveTailProviderTest#establishmentAloneWithoutGenuineDataDoesNotResetTheReconnectBudget` |
| OS-1E-29 | A physical line whose content is exactly `maxLineBytes` bytes followed by a real newline is reported untruncated; a physical line whose content exceeds `maxLineBytes` produces exactly one truncated event bounded at `maxLineBytes` bytes (UTF-8-safe), discarding every further byte of that same physical line until the real terminating newline | `VERIFIED` | `OpenShiftApiClient.LiveLineDecoder#onChunk` (pre-write overflow check reordered: newline checked before the `buffer.size() == maxLineBytes` branch); `OpenShiftApiClientLiveStreamTest#lineBoundary1_exactlyMaxLineBytesFollowedByNewlineIsNotTruncated`, `#lineBoundary2_*`, `#lineBoundary3_*` (plus pre-existing overlong-line tests re-verified) |
| OS-1E-30 | A clean EOF with a buffered, unterminated trailing fragment emits exactly one final `DecodedLine` marked `unterminated=true` (bounded `UNTERMINATED_LIVE_LINE` count); an error/transport-failure with a buffered fragment discards it silently, never emitting it as a complete event (bounded `PARTIAL_LINE_DROPPED` count); an explicit Stop/cancellation with a buffered fragment silently discards it with no warning at all — three distinct, tested outcomes for three distinct termination causes | `VERIFIED` | `OpenShiftApiClient.LiveLineDecoder#hasPartialContent`/`flushPartial`; `LineDecodingSubscriber#hookOnComplete`/`hookOnError`/`hookOnCancel`; `OpenShiftApiClientLiveStreamTest` (`flushPartial_*` pure-decoder tests, `partialLineA_*`..`partialLineD_*` reactive tests); `OpenShiftLiveTailProviderTest#unterminatedFinalLineBecomesAnEventAndReachesRuntimeStatusAsABoundedCount`, `#partialLineDroppedByErrorReachesRuntimeStatusAsABoundedCount` |
| OS-1E-31 | A terminal source state (`NO_ACTIVE_TARGETS`/`EXPIRED`/`STALE`) triggers a bounded, one-shot, server-side SSE grace-close (`terminalGrace = min(2×heartbeatInterval, 10s)`) instead of riding the full `connectionTimeout`; an explicit Stop may still close immediately | `VERIFIED` | `LiveTailService` (`LiveSourceStatus.State#isTerminal()`, CAS-guarded `terminalTimerStarted`, `Sinks.Empty<Void> terminalCloseSignal`, `Flux.merge(...).takeUntilOther(terminalCloseSignal.asMono())`) — generic, not OpenShift-specific |
| OS-1E-32 | The frontend never performs the generic automatic `EventSource` reconnect when the most-recently-received source state is terminal; instead it transitions to a stopped/restart-required UI state, retaining visible events, while ordinary non-terminal transport failures continue to use the existing bounded generic reconnect unchanged; the terminal-caused stop preserves its specific badge reason (never reverting to a generic "STOPPED" label), and Docker/Fixture (always non-terminal) are unaffected | `VERIFIED` (real rendered-component test evidence) | `useLiveTail.ts` (`sourceStatusRef`, `isTerminalSourceState` check inside `onerror` before the generic reconnect path); `liveTailTypes.ts#isTerminalSourceState`; `LiveTailPanel.tsx#sourceStatusBadge` (guard widened to include `connectionState === 'stopped'`, new `CONNECTING` case); `useLiveTail.test.ts` (terminal-suppresses-reconnect describe block, 5 tests incl. `MockEventSource.instances.length` proof of no new EventSource); `LiveTailPanel.test.tsx` (CONNECTING badge + terminal-reason-preserved/ordinary-Stop-unaffected tests) |

**OS-1E FINAL IMPLEMENTATION pass.** 10 new rows (OS-1E-23 through
OS-1E-32); OS-1E-19's evidence annotated in place to point at this
section's widened state/count model, its underlying requirement
unchanged. No `ContextTargetProofCodec`/`ConnectionOperationSnapshot`/
`resolveTargetPlan` design touched. No historical search, context, or
correlation behavior changed. `TEST-INFRA-1` remains
`APPROVED_PENDING_HARDENING`, untouched — re-confirmed via the same
PNG-restoration mitigation after this pass's own full backend/frontend/E2E
validation. `REL-1` (§7, §7b, §7c) remains confirmed `APPROVED_PENDING`,
untouched. `REAL_OPENSHIFT_1E=BLOCKED_CREDENTIALS`, consistent with every
prior OS-1x slice — this pass neither touched nor could convert that
status. `UNTRACKED_OWNER_REQUIREMENTS=0`.

### 12n. OS-1E FINAL TERMINAL STATUS DELIVERY FIX — guaranteeing terminal-state delivery before SSE close

An independent review of §12m's own terminal-SSE grace-close found one
remaining contract defect: the periodic heartbeat alone could not
guarantee the browser ever learned a terminal source state before the
connection closed. See `docs/verification/OS_1E_OPENSHIFT_LIVE_REPORT.md`
§15 for the full before/after account.

| # | Finding | Status |
|---|---|---|
| 1 | With the DEFAULT properties (`heartbeatInterval=15s`), `terminalGrace = min(2×15s, 10s) = 10s` is strictly LESS than the heartbeat interval — the SSE connection could close up to 5 seconds before the next periodic heartbeat would ever have carried the terminal status. `LiveTailService`'s `statusTracker` only updated an in-memory `latestStatus` reference and emitted no SSE event of its own, so the browser's last-known state at the moment `onerror` ran could still be a stale non-terminal one, incorrectly triggering the generic bounded reconnect against a session that will never resume | `RESOLVED` |
| 2 | The terminal grace timer (`Mono.delay(terminalGrace).subscribe(...)`) was a detached, fire-and-forget subscription with its OWN lifecycle, independent of the SSE connection's own cancellation | `RESOLVED` (folded into the same reactive chain as the rest of the connection) |

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1E-33 | The first time a terminal `LiveSourceStatus` (`STALE`/`EXPIRED`/`NO_ACTIVE_TARGETS`) is observed, `LiveTailService` emits ONE immediate `"status"` SSE event carrying that exact terminal snapshot — never waiting for the next periodic heartbeat tick — before starting the (unchanged) `terminalGrace` timer. Required ordering guaranteed: terminal snapshot observed → terminal status SSE emitted → grace timer starts/runs → SSE closes after grace. Non-terminal statuses are unaffected — still delivered only via the periodic heartbeat, never flooding the client with one SSE event per status mutation | `VERIFIED` | `LiveTailService#follow` (`statusTracker`'s `flatMap` branch, CAS-guarded by `terminalEmitted`); `LiveTailServiceTest#terminalStatusA_staleIsDeliveredImmediatelyNotOnTheNextHeartbeat`, `#terminalStatusB_expiredIsDeliveredImmediatelyNotOnTheNextHeartbeat`, `#terminalStatusC_noActiveTargetsIsDeliveredImmediatelyNotOnTheNextHeartbeat` — all three run against the REAL default `heartbeatInterval` (15s), proving the exact numeric relationship (`15s > 10s` grace) the defect depended on |
| OS-1E-34 | The terminal grace timer is part of the SAME reactive lifecycle as the rest of the SSE connection (never a detached `Mono.delay(...).subscribe(...)`), so it is automatically, unconditionally disposed on client disconnect, explicit Stop, or `connectionTimeout` — no orphan timer | `VERIFIED` | `LiveTailService#follow` (`Flux.concat(immediateTerminalStatus, graceThenClose)` returned as part of `statusTracker`'s own `Flux`, subscribed only as one arm of the top-level `Flux.merge`); `LiveTailServiceTest#terminalStatusE_cancellationDuringGraceCancelsTheTerminalTimerNoOrphanWork` (disposes mid-grace, asserts the underlying status source itself observes `cancel()` — Reactor's own cancellation-propagation contract) |

**OS-1E FINAL TERMINAL STATUS DELIVERY FIX pass.** 2 new rows (OS-1E-33,
OS-1E-34). §12m's own OS-1E-31 (terminal-SSE grace-close) and OS-1E-32
(frontend terminal-reconnect suppression) are neither reopened nor
silently rewritten — both mechanisms remain correct and unchanged; this
is a narrow, additional correction to WHEN the terminal status reaches
the browser, not a redesign of either mechanism.
`OpenShiftLiveTailProvider` state semantics, reconnect semantics, and
decoder semantics are all explicitly untouched by this pass, per mission
scope. No frontend production code changed — `useLiveTail.ts`'s
terminal-reconnect-suppression logic was already correct; it simply never
had the terminal status it needed, in time, until now; the existing
`useLiveTail.test.ts` terminal-suppression tests (§12m) re-ran unchanged
as sufficient proof. `TEST-INFRA-1` remains `APPROVED_PENDING_HARDENING`,
untouched. `REL-1` (§7, §7b, §7c) remains confirmed `APPROVED_PENDING`,
untouched. `REAL_OPENSHIFT_1E=BLOCKED_CREDENTIALS`, consistent with every
prior OS-1x slice. `UNTRACKED_OWNER_REQUIREMENTS=0`.

### 12o. OS-1F — OpenShift Professional UX Integration

A product/UX/integration slice, not a backend retrieval rewrite — OS-1A
through OS-1E's own connection/discovery/search/context/live semantics
are explicitly unchanged. Preceded by a real, evidence-backed LERUX-1
audit of the entire OpenShift workflow (Settings → scope hierarchy →
Search → Results → Inspector → Live) against the mission's own explicit
checklist, before any UI change was made. See
`docs/verification/OS_1F_OPENSHIFT_PROFESSIONAL_UX_REPORT.md` for the
full audit table (every area classified `SAME_CORRECT`/`NEW_BETTER`/
`STILL_OLD_THINKING`) and before/after account.

**Audit headline finding:** most of the checklist was already
`SAME_CORRECT` — OS-1A/1B/1D had already built truthful Project-vs-
Namespace labelling, safe token handling, 403-vs-empty discovery
distinctions, and OpenShift WHERE fields (namespace/pod/container) into
the generic Results/Inspector machinery, verified by direct source
reading rather than assumed. Three genuine, narrow gaps were found and
closed:

| # | Finding | Status |
|---|---|---|
| 1 | The generic header `ScopeTrail` (`Shell.tsx`) had zero OpenShift awareness — it rendered only the source name plus the Docker Compose project chip, so an investigator had no way to see their current Project/Workload/Pod/Container scope without reopening the Settings popover (`STILL_OLD_THINKING`) | `RESOLVED` |
| 2 | The Settings connection-status badge had no "Connecting…" state — during the real async gap between submitting `oc login` and the backend's response, the badge kept reading "Not connected", which could be read as if nothing were happening | `RESOLVED` |
| 3 | Attempting Search/Live on a connected OpenShift session with no Project/Namespace selected reached the backend only as an opaque, uncaught `IllegalStateException("No project/namespace selected.")` (no specific `GlobalExceptionHandler` mapping exists for it) — genuinely unusable, not merely unclear | `RESOLVED` (frontend-side prevention; no backend semantic touched) |

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| OS-1F-1 | A new, purely non-mutating `GET /api/v1/sources/openshift/scope` endpoint reflects the session's exact current project/workload/pod/container selection — reused by the frontend for both the header trail and (in principle) restoring Settings-panel display state, never re-deriving truth from a mutating response | `VERIFIED` | `OpenShiftScopeController#scope`; `OpenShiftScopeControllerIntegrationTest#getScopeReflectsTheCurrentlyCommittedProjectWorkloadPodAndContainerSelection`, `#getScopeBeforeAnySelectionReportsEveryLevelAsAll` |
| OS-1F-2 | The header `ScopeTrail` renders the full effective OpenShift hierarchy (Project/Namespace → Workload → Pod → Container) as labelled breadcrumb segments, sourced from the SAME `OpenShiftScopeSummary` the Settings panel reads/writes — never a second, independently-derived truth. A level renders only when it genuinely narrows scope ("All workloads"/"All pods"/"All containers" add no segment, exactly like the pre-existing Compose-project chip's own convention) | `VERIFIED` (real rendered-browser evidence) | `Shell.tsx` (`openShiftScopeSegments`, `ScopeTrail`); `Shell.test.tsx` (OS-1F ScopeTrail describe block, 5 tests); `frontend/e2e/os-1f-openshift-professional-ux.spec.ts` (`G:`); `docs/verification/OS_1F_EVIDENCE/G-scope-trail.png` |
| OS-1F-3 | The Project/Namespace level's own label stays truthful to `discoveryApi`: a bare value for native OpenShift Projects, `"Namespace: x"` for a Kubernetes-fallback cluster — never a bare value that could be misread as a Project (OS-1A review recovery #2's own invariant, extended to the trail) | `VERIFIED` | `Shell.tsx#openShiftScopeSegments`; `Shell.test.tsx` (Namespace-vs-Project label tests) |
| OS-1F-4 | `ScopeTrail` stays visible and truthful with the Settings popover CLOSED, and updates live the moment a scope mutation commits (`OpenShiftSettingsPanel`'s new `onScopeChanged` callback, fired after every successful connect/disconnect/project/workload/pod/container mutation) — never stale, never requiring a reopen or reload to reflect the truth | `VERIFIED` | `useOpenShiftScopeSummary` hook (lifted to `App.tsx`, shared by `Shell` and `Toolbar`); `useOpenShiftScopeSummary.test.ts` (5 tests); `OpenShiftSettingsPanel.test.tsx` (3 new `onScopeChanged` tests) |
| OS-1F-5 | The Settings connection-status badge shows a genuine, distinct "Connecting…" state during the async gap between submitting the login command and the backend's response — scoped narrowly to the initial connect attempt only, never relabeling every other busy scope-selection action | `VERIFIED` | `OpenShiftSettingsPanel.tsx` (`connecting` state, `.stateConnecting` CSS); `OpenShiftSettingsPanel.test.tsx#shows_Connecting…_in_the_top_status_badge_...` |
| OS-1F-6 | Search and Live are disabled, with a truthful, visible, non-color-only reason ("Select a Project/Namespace to search/start Live OpenShift"), whenever OpenShift is the active source and no Project/Namespace has been selected yet — never available to trigger an opaque backend failure. Never gates a non-OpenShift source, and never gates before the scope read has resolved (an unresolved `null` scope is not treated as "definitely no project") | `VERIFIED` (real rendered-browser evidence) | `Toolbar.tsx` (`openShiftMissingRequiredScope`, `scopeRequiredHint`); `Toolbar.test.tsx` (5 new tests); `frontend/e2e/os-1f-openshift-professional-ux.spec.ts` (`H:`); `docs/verification/OS_1F_EVIDENCE/H-search-blocked-no-scope.png`, `H-search-enabled-with-scope.png` |
| OS-1F-7 | Every other audited OpenShift UX area — Settings source labelling ("OpenShift" vs "OpenShift Loki"), token-never-displayed, 403-vs-empty workload/pod discovery, Results-table optional `pod`/`namespace`/`container` columns, Inspector's "when present" namespace/pod/container/service fields, and every OS-1E Live source-state badge — was independently re-verified against the mission's own checklist and found `SAME_CORRECT`/`NEW_BETTER`; none were redesigned, per the mission's own restraint requirement | `VERIFIED` (re-confirmed, not re-implemented) | `docs/verification/OS_1F_OPENSHIFT_PROFESSIONAL_UX_REPORT.md` §3 (full audit table) |

**OS-1F pass.** 7 new rows (OS-1F-1 through OS-1F-7). No OS-1A/1B/1C/1D/
1E `VERIFIED` row reopened or redesigned — `DirectPodLogProvider`,
`OpenShiftLiveTailProvider`, `ContextTargetProofCodec`, and every backend
search/context/live semantic are byte-for-byte unchanged (confirmed via
targeted diff, §OS-1F verification report §6). The one new backend
surface (`GET /scope`) is a pure, non-mutating read reusing the existing
`scopeSummary()` helper — no new discovery/authorization logic. `Job`/
`CronJob`/standalone pods/unknown workload types/init containers remain
explicitly unsupported, unchanged from OS-1B. `openshift-loki` is
untouched, not removed. `TEST-INFRA-1` remains
`APPROVED_PENDING_HARDENING`, untouched — re-confirmed via the same
PNG-restoration mitigation after this pass's own full backend/frontend/E2E
validation (new `docs/verification/OS_1F_EVIDENCE/` screenshots are new
evidence, not historical mutations, and are preserved). `REL-1` (§7, §7b,
§7c) remains confirmed `APPROVED_PENDING`, untouched.
`REAL_OPENSHIFT_1F=BLOCKED_CREDENTIALS`, consistent with every prior
OS-1x slice — every "connected"/"scoped" screenshot and test in this pass
is explicitly, honestly labelled MOCKED (Playwright route interception),
never presented as real-cluster evidence. `UNTRACKED_OWNER_REQUIREMENTS=0`.

### 12o.1 Real Red Hat Developer Sandbox validation attempt

A follow-up mission, now that the owner has a real Red Hat Developer
Sandbox, asked this pass to convert `REAL_OPENSHIFT_1F` from
`BLOCKED_CREDENTIALS` into real evidence. **No credential was present in
this session's environment** (confirmed by an explicit scan: no
`OPENSHIFT_*`/`OC_*`/`KUBE*` environment variables, no `oc` CLI
installed, no `~/.kube/config`), and none was supplied via the sanctioned
mechanism (`OPENSHIFT_LOGIN_COMMAND` or `OPENSHIFT_API_SERVER`/
`OPENSHIFT_TOKEN`). Per that mission's own explicit instruction, no
connection attempt was made — `REAL_OPENSHIFT_1F` remains
`BLOCKED_CREDENTIALS`, not fabricated as `PASS`. See
`docs/verification/OS_1F_OPENSHIFT_PROFESSIONAL_UX_REPORT.md` §8 for the
full checklist of real-Sandbox items, all correctly reported
`BLOCKED_CREDENTIALS`/`NOT_TESTED_ENVIRONMENT_LIMITATION`.

**What this pass DID complete, entirely credential-independent:** the
full real-Sandbox testbed the eventual validation needs —
`testbed/openshift/` (a reusable Spring Boot log generator matching the
real product's own JSON parser field shape exactly; OpenShift manifests
for ~10 logically distinct services with a sidecar container and a
Route; deploy/traffic/rolling-update/cleanup scripts; a README with an
explicit security section on credential handling) — genuinely test
infrastructure, never a product dependency, never referenced by
`backend/`/`frontend/`. The testbed's own JSON log format was verified,
locally and without any cluster, to round-trip correctly through the
real `LogLineParser` (a temporary, not-committed scratch test). This
closes every credential-independent prerequisite for the real-Sandbox
validation; only the credential itself remains outstanding.
`UNTRACKED_OWNER_REQUIREMENTS=0`.

### 12o.2 Real Red Hat Developer Sandbox validation — completed

A follow-up mission supplied a fresh, never-previously-displayed
credential via the sanctioned `OPENSHIFT_API_SERVER`/`OPENSHIFT_TOKEN`
environment variables. The credential was never printed or persisted
(verified: presence-only `[ -n ... ]` checks; the token appears in no
committed file, no screenshot, no application log, no test artifact —
full grep-based audit in
`docs/verification/OS_1F_OPENSHIFT_PROFESSIONAL_UX_REPORT.md` §8.3).
`oc new-project` confirmed `Forbidden` under this Sandbox's policy, so
the mission's own pre-created-namespace fallback applied:
`ahmedelrifaye70-dev` (the larger-quota of the two pre-provisioned
projects; `ahmedelrifaye70-aece7-claw` was deliberately avoided — it
already hosts unrelated `claw`/`claw-proxy` infrastructure presumed to
belong to this execution environment itself).

**Real-Sandbox-only defects found and fixed (test infrastructure, not
product code — classified `HARDENING`):** (1) at the Sandbox's real
`cpu: 15m` request, JVM startup took ~58s under real CFS throttling,
but the original `livenessProbe` began killing the container around
t=55s, causing `CrashLoopBackOff` — fixed with a `startupProbe`
(`failureThreshold: 30`/`periodSeconds: 5`, 150s allowance) absorbing
slow, throttled startup before liveness/readiness begin counting,
applied to both `deployment-template.yaml` and
`edge-with-sidecar-template.yaml`; (2) the `metrics-sidecar` container
(running the same full Spring Boot jar) OOMKilled at its original
`96Mi` limit — fixed by raising it to match the main container's own
already-reliable sizing (`160Mi`). Neither finding touches
`backend/`/`frontend/` product code.

**Mid-flight, a separate mission required renaming the entire testbed
away from banking-flavored naming** (`gateway-service` →
`logexp-test-edge`, etc. — full ten-service mapping in
`testbed/openshift/README.md`) before real validation evidence was
captured, to remove any appearance of bank-specific branding from test
infrastructure per `CLAUDE.md` §1's "neutral identity only" rule,
applied here by extension to the testbed. All ten OpenShift resource
identities (Deployment/Service/Route names, `app` labels/selectors,
`SERVICE_NAME` env values, and hence every generated log line's
`application` field) now use one single, consistent
`logexp-test-<noun>` scheme. The five canonical masked MDC field NAMES
(`cif`/`UserName`/`CustomerId`/`deviceId`/`deviceIp`, `CLAUDE.md` §2
rule 1) were deliberately left unchanged — they are the real product's
own masking vocabulary, not testbed-authored banking flavor, and
renaming them would defeat the testbed's actual masking-verification
purpose. Verified via exhaustive grep (zero banking terms remain
outside explanatory comments) and a local smoke test before
redeploying to the real Sandbox. `BANKING_TERMS_IN_TESTBED=0`,
`GENERIC_TEST_NAMES_ONLY=YES`, `PRODUCT_CODE_CHANGED=NO`,
`TESTBED_CAPABILITY_PRESERVED=YES`, `CREDENTIALS_CHANGED=NO`.

**Real validation results** (full evidence:
`docs/verification/OS_1F_REAL_OPENSHIFT_EVIDENCE/`, screenshots
A–V; command output cited in the verification report §8):

| Item | Result |
|---|---|
| Real Sandbox connection | `PASS` — real server/user/TLS/project-count shown, no token in DOM |
| Real discovery (project/workload/pod/container, multi-replica, multi-container) | `PASS` — `logexp-test-edge` correctly shows 2 pods × 2 containers (`app`, `metrics-sidecar`) |
| Real search (unscoped, scoped, severity-filtered) | `PASS` |
| Real context / "Show surrounding logs" | `PASS` — ±30s window, root event highlighted, no cross-workload leakage |
| Real cross-service correlation | `PASS` — one journeyId search across All workloads returned exactly 6 events, one from each of the 6 chained services (edge→profile→catalog→orders→message→activity), correct newest-first ordering |
| Real Live — single pod/container | `PASS` — real events streamed, Stop works, confirmed no reconnect after Stop |
| Real Live — multi-replica workload | `PASS` |
| Real Live — All Workloads (bounded) | `PASS` — all 10 services interleaved in one stream, no truncation |
| Real Live target-snapshot immutability | `PASS` — a running Live session on `logexp-test-orders` did **not** silently attach the new pods produced by `rolling-update-demo.sh`; it honestly reported both original targets `LIVE_TARGET_STOPPED` (real 404, pod no longer exists) rather than fabricating continued success; a fresh Stop→Live restart correctly resolved the new post-rollout pods |
| Partial/failure truthfulness — stale/deleted target | `PASS` — same rollout evidence above |
| Partial/failure truthfulness — one target down during multi-target Live | `PASS` — deleting one of `logexp-test-edge`'s 2 pods (self-healing Deployment) produced an honest `LIVE (2/4 active)` badge, naming both affected containers, while the surviving pod's events kept streaming |
| Rolling update (`payment-service`→`logexp-test-orders`, v1→v2) | `PASS` — real `oc rollout status` completed, new pod names confirmed distinct from old |
| Token absence (repo/screenshots/app logs/browser storage/test artifacts) | `PASS` — full grep audit, zero matches; browser storage never persisted (ephemeral Playwright contexts, no profile reuse) |

`REAL_OPENSHIFT_1F=PASS` (supersedes the `BLOCKED_CREDENTIALS` status
recorded in §12o.1, once credentials became available). No OS-1A
through OS-1E backend semantic was touched to obtain this result — the
same byte-for-byte-unchanged claim from the original OS-1F pass (§12o)
still holds; this subsection records real-cluster confirmation of
already-implemented behavior, not new implementation.
`UNTRACKED_OWNER_REQUIREMENTS=0`.

### 12p. OS-1G — OpenShift aggregated/historical provider decision

A decision-gate mission, resolving OS-12 (§12a) with real evidence.
Full inventory, decision matrix, and rationale in
`docs/verification/OS_1G_AGGREGATED_PROVIDER_DECISION_REPORT.md`; the
same conclusion is recorded in
`docs/architecture/OPENSHIFT_DIRECT_LOGGING_ARCHITECTURE_ASSESSMENT.md`
§23.

| ID | NAME | STATUS | EVIDENCE |
|---|---|---|---|
| OS-1G-1 | The current `openshift-loki` implementation was fully inventoried before any decision was made — reusable components, source-coupled components, UI coupling, security coupling, and self-reported capability gaps, all traced to exact source | `VERIFIED` | `OS_1G_AGGREGATED_PROVIDER_DECISION_REPORT.md` §2 |
| OS-1G-2 | `REAL_LOKI` was checked directly in this session's actual environment — env vars, local config, and the real Red Hat Developer Sandbox namespaces already connected to for OS-1F — rather than assumed from history | `VERIFIED` (checked, not fabricated) | `REAL_LOKI=BLOCKED_EXTERNAL_ENVIRONMENT`; §3 of the decision report; no `LOKI_*` env vars, no Loki route/service in `ahmedelrifaye70-dev` or `ahmedelrifaye70-aece7-claw`, `tools/mock-loki` correctly excluded as an explicitly-documented mock |
| OS-1G-3 | Three architecture options (keep-separate / consolidate-now / abstraction-only-defer-consolidation) were compared across user mental model, truthfulness, security, migration risk, testability, and extensibility, not decided by preference alone | `VERIFIED` | Decision report §4 (full matrix) |
| OS-1G-4 | Given `REAL_LOKI` is unverified, the mission's own default-safety rule was applied: `openshift-loki` was not removed, no Loki-backed OpenShift historical search was claimed production-verified, and the decision taken is reversible | `VERIFIED` | Decision report §5, §8; `OPENSHIFT_LOKI_RETAINED=YES`, `OPENSHIFT_LOKI_REMOVED=NO` |
| OS-1G-5 | The `AggregatedLogProvider` interface itself was deliberately NOT implemented this slice — judged, against `CLAUDE.md`'s own anti-premature-abstraction rule, as speculative scaffolding for a single candidate implementation whose real behavior has never been observed | `VERIFIED` (deliberate non-implementation, not an oversight) | Decision report §5; `AGGREGATED_PROVIDER_IMPLEMENTED=NO` |
| OS-1G-6 | Zero backend/frontend production source files were changed this slice | `VERIFIED` | `git diff --stat -- backend/src/main/java frontend/src` against `main` — empty |
| OS-1G-7 | No OS-1A..1F OpenShift Direct behavior, and no existing Loki behavior, was touched — `OpenShiftLogSource`/`DirectPodLogProvider`, just proven correct against the real Sandbox in OS-1F, were not modified | `VERIFIED` | Decision report §10; existing Loki mock-backed test suite unchanged and still green |

**OS-1G pass.** A decision/documentation-only slice. `OS-12` (§12a)
updated with the interim outcome, not silently closed — final
consolidation remains `OPEN_UNDECIDED`, gated on the exact real-Loki
evidence checklist in the decision report §6. No OS-A/OS-1A..1F/OS-1G's-
own-prior-state historical finding was rewritten; this section is
additive. `HISTORICAL_DECISIONS_PRESERVED=YES`.
`UNTRACKED_OWNER_REQUIREMENTS=0`.

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

**OS-1A pass.** Implementation of the first OpenShift slice, tracked in
§12b. Two owner/reviewer corrections were persisted as explicit,
separately-tested requirements rather than folded into prose: **unknown
`oc login` flags are rejected, not ignored** (OS-1A-3), and **a 403 on
project discovery is a different truth from an empty project list**
(OS-1A-11) — the latter is enforced by modelling them as different
*types*, so they cannot be accidentally collapsed by a future change. One
OS-A assumption was **resolved into fact**: Reactor Netty reads only JVM
system properties and has no `HTTP_PROXY`/`NO_PROXY` support, so explicit
scoped proxy handling was implemented (OS-1A-9). One item is honestly
`BLOCKED_CREDENTIALS`: real Developer Sandbox verification, whose test
exists and skips cleanly until the owner supplies credentials (OS-1A-17).

**OS-1A review recovery #1 (project-API-fallback truthfulness).** A
post-merge review found that the namespaces fallback (OS-1A-12) guarded on
`kind != Kind.MALFORMED_RESPONSE`, and every HTTP status other than
401/403 fell into that one bucket — including 429 (rate limited) and
500/502/503 (real upstream failures). A busy or failing cluster could
therefore be silently reinterpreted as "this cluster has no OpenShift
Projects API" and retried against namespaces instead of surfacing the
real failure. The fix added `Kind.NOT_FOUND` (HTTP 404 only) as its own
exception kind and re-scoped the fallback guard to check for it
exclusively. This is recorded here, rather than silently folded into
OS-1A-12's evidence, because the requirement's *shape* did not change —
"fallback only when the Projects API is genuinely absent" was always the
intent — but its *enforcement* had a real gap that shipped as `VERIFIED`.
Do not read the original OS-1A-12 evidence text (superseded above) as
ever having meant "fall back on any non-401/403 status" being correct;
it was the defect this recovery closed.

**OS-1A review recovery #2 (discovery-mode preservation & refresh
consistency).** A second post-merge review found two related defects,
both stemming from the same root cause: the project list and *which API
produced it* were treated as separable facts when they are not. **Defect
A** — `OpenShiftSession` stored only the resulting project list, never
the `ProjectDiscovery.Api` that answered it, and
`OpenShiftConnectionController` always summarised with `discovery=null`,
so a connection that succeeded via the namespaces fallback would report
`projectApi: null` on every later `GET /connection` — the mode chosen at
connect time was true for exactly one HTTP response and forgotten
immediately after. **Defect B** — `refreshProjects()` called
`client.fetchProjects(...)` directly, bypassing the 404-only fallback
entirely, so a connection that had legitimately reached `CONNECTED`
through the namespaces fallback would fail outright the first time the
user clicked Refresh. The fix (OS-1A-18, OS-1A-19) makes the discovery
mode an explicit, stored field on the session's snapshot — never inferred
from list contents, since a `NAMESPACES` result and a `PROJECTS` result
are not structurally distinguishable from their names alone — and unifies
connect and refresh onto one shared `discoverProjectsOrNamespaces` policy
method, so the 404-only invariant OS-1A-12 established cannot drift
between the two call sites the way it previously did. The frontend's
"Project" vs "Namespace" labelling (OS-1A-16) had the same class of gap in
its selection control specifically (the summary row was already correct)
and was corrected in the same pass. The 404-only fallback invariant
itself (review recovery #1) is unchanged by this recovery; only the call
sites that reach it were unified. `REAL_OPENSHIFT_1A` remains
`BLOCKED_CREDENTIALS` — this recovery did not touch, and could not
convert, that status.

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

**OS-1A review recovery #2 pass.** No new owner requirement surfaced.
Both defects found (discovery mode not persisted past the initial connect
response; refresh not sharing connect's namespaces-fallback policy) are
corrections to the enforcement of requirements already tracked above
(OS-1A-12/OS-1A-16), and are recorded as two new, separately-tested rows
(OS-1A-18, OS-1A-19) plus a correction note on OS-1A-12 rather than a
silent code fix — consistent with how review recovery #1 was handled.
`REAL_OPENSHIFT_1A` remains `BLOCKED_CREDENTIALS`; this recovery neither
touched nor could convert that status. OS-1B, REL-1 and Phase M remain
`NOT_STARTED`/`TRACKED_NOT_STARTED` — this recovery is scoped entirely to
already-implemented OS-1A code, and PR #39 remains unmerged pending this
recovery's own review.

**OS-1B pass.** PR #39 was merged at its approved SHA
(`892b06b7960542c27b0666cd2ed1166ec7a26181`) before this slice began; post-
main CI and Windows Desktop were both confirmed green first (§0 of
`OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md`). Twenty-three new,
separately-tested requirements were added (§12c, OS-1B-1 through OS-1B-23)
covering workload/pod/container discovery, selection validation, cascading
resets and one level deeper of stale-response protection than OS-1A had.
One genuinely new owner requirement was **registered but explicitly not
implemented**, per the mission's own instruction: **Local Reproducible
Desktop Packaging** (§7b, a REL-1 addendum approved after the OS-1A
review-recovery-#2 prompt was sent) — `APPROVED_PENDING`, tracked, no
code written. One real defect was found and fixed *during* this slice
(a double URL-encoding bug that silently broke every pod label-selector
filter, OS-1B-12) — recorded as a `VERIFIED (fixed)` requirement rather
than a silent patch, consistent with how OS-1A's own two review
recoveries were handled. `REAL_OPENSHIFT_1A` and the new
`REAL_OPENSHIFT_1B` both remain `BLOCKED_CREDENTIALS` — no credentials
were supplied, and neither status is fabricated as `PASS`. OS-1C, OS-1D,
OS-1E, OS-1F, OS-1G, REL-1 and Phase M all remain
`NOT_STARTED`/`TRACKED_NOT_STARTED` — this slice implemented discovery
only, per its own explicit no-scope-creep list (§35 of the mission).

**OS-1B review recovery pass (`OS_1B_REVIEW_RECOVERY_ALL_WORKLOADS_SCOPE`).**
PR #40 (HEAD `ad8bdeb70f25345172f7ed1b380b23f751d0b3e5`, all CI green) was
found on review to have widened "Workload = All" into "every pod in the
namespace" — a real, evidence-backed scope defect, not a build/test
failure (§20 of `OS_1B_OPENSHIFT_SCOPE_DISCOVERY_REPORT.md` has the full
writeup). Fixed by resolving "All workloads" as the union of each
discovered supported workload's own selector-filtered pods, never an
unfiltered listing. A second, independent defect was found and fixed in
the same pass: `OpenShiftSession#updatePods` did not check the expected
*project*, only the expected workload, so a stale "All workloads" pod
result could survive a project switch undetected. Four new/corrected
requirements were recorded (OS-1B-13 corrected in place and marked with
its historical-correction note; OS-1B-24 through OS-1B-27 added) rather
than silently patched. No new owner requirement surfaced beyond the
already-registered REL-1 addendum, which remains untouched and
`APPROVED_PENDING`. `REAL_OPENSHIFT_1A`/`REAL_OPENSHIFT_1B` remain
`BLOCKED_CREDENTIALS` — this recovery neither touched nor could convert
either status. OS-1C, REL-1 and Phase M remain
`NOT_STARTED`/`TRACKED_NOT_STARTED`; PR #40 remains unmerged pending this
recovery's own review.

**OS-1C pass (`OS_1C_OPENSHIFT_DIRECT_SEARCH`).** PR #40 was confirmed
merged (`4fc57bafbd9162de2fb630170be92e124d0a0ced`) with post-main CI and
Windows Desktop both green *before* this branch was cut (§0 of
`OS_1C_OPENSHIFT_DIRECT_SEARCH_REPORT.md`). Twenty-one new, separately-
tested requirements were added (§12d, OS-1C-1 through OS-1C-21) covering
bounded direct pod-log search, deterministic multi-pod merge, truthful
truncation/sorting/pagination-absence, and capability/health honesty. One
real gap was found and fixed *during* implementation, before any test was
written against the buggy state: `DirectPodLogProperties#maxPods` was
defined but never enforced anywhere - fixed by capping distinct pods
before per-pod container expansion, independently of the existing
`maxTargets` fan-out cap (OS-1C-21). A LERUX-1 diagnosis of the existing
Search UI found **zero frontend changes required** - no code anywhere
gates Search on `capabilities.historicalSearch`, and the generic
`QueryPlan.notes`/`SourceHealth.warnings`/`counts.truncated` rendering
paths already pick up OS-1C's new disclosures with no source-specific
frontend branch to write; the one stale E2E assertion this uncovered
(`os-1a-openshift-connection.spec.ts` asserting `historicalSearch=false`)
was corrected, not deleted, and re-verified green. One known, disclosed
limitation was carried forward rather than silently left implicit: a
specific target's own runtime failure (one pod 403s/404s/times out) is
not yet individually named in `describeScopeWarnings`, only the
proactively-knowable scope/cap conditions are (see the report's §13).
`REAL_OPENSHIFT_1A`/`REAL_OPENSHIFT_1B`/`REAL_OPENSHIFT_1C` all remain
`BLOCKED_CREDENTIALS` - no credentials were supplied, and no skipped test
was converted to `PASS`. OS-1D, OS-1E, OS-1F, OS-1G, REL-1 and Phase M all
remain `NOT_STARTED`/`TRACKED_NOT_STARTED` - this slice implemented
bounded direct search only, per its own explicit no-scope-creep list
(§46 of the mission).

**OS-1C REVIEW RECOVERY pass (§12e above).** The one known, disclosed
limitation this section previously carried forward — "a specific target's
own runtime failure... is not yet individually named" — is now `VERIFIED`
resolved (OS-1C-24). A second, independently evidence-backed defect (the
`maxBytesPerTarget` cap was never a true streaming byte bound - OS-1C-22)
was found and fixed in the same recovery pass, not previously tracked as
its own row anywhere before this pass added it. Both are now closed with
real test/rendered-browser evidence, not merely re-labeled. `REL_1` (local
reproducible desktop packaging) remains confirmed `APPROVED_PENDING`,
untouched. `Kind.TIMEOUT`/`Kind.UPSTREAM_UNAVAILABLE` are genuinely new
`OpenShiftApiException` categories this pass added — both are additive
(no existing `Kind` value's meaning changed) and are reflected in
`GlobalExceptionHandler`'s own exhaustive status-code mapping.

**OS-1C FINAL REVIEW RECOVERY pass (§12f above).** A second review round on
the same PR found a real, previously-untracked gap in §21's own byte-bound
work: downstream cancellation of `readBounded`'s `Mono` was never bridged
to the underlying `BaseSubscriber`, so a timeout or an aborted overall
search could leave the raw HTTP body subscription still being consumed.
Fixed and closed as OS-1C-31 through OS-1C-35, with executable cancellation
tests (not merely a claim that the composition "should" propagate
cancellation). A second, unrelated issue - 188 historical evidence PNGs
unintentionally re-saved by the §21 commit - was found and restored
byte-identical to their pre-recovery content (OS-1C-36); this was a
repository-hygiene defect in how that commit was assembled, not a defect
in OS-1C's own design or test coverage. No existing OS-1C requirement's
status changed as a result of this pass; none of §12a-§12e's `VERIFIED`
rows were reopened.

**Windows Desktop CI/toolchain hardening pass (§7c above,
`platform/windows-dotnet-nuget-restore-hardening`, PR #44).** A narrowly-
scoped CI/toolchain hardening prerequisite, not REL-1 implementation and
not OS-1F — created directly from `main` (not from PR #42 or PR #43;
neither was modified) specifically to unblock PR #42's repeatedly-failing
Windows Desktop gate. Root cause: no `global.json` existed, so `dotnet`
resolved to the highest SDK installed on the `windows-latest` runner
image (a preinstalled .NET 10 SDK) rather than the 8.0.x SDK
`actions/setup-dotnet@v4` explicitly installs — confirmed directly via a
CI diagnostic step (`dotnet --version` printed `10.0.400` before the fix,
`8.0.425` after). Fixed with `global.json` (`rollForward=latestFeature`,
locked to major.minor `8.0`), an exact (never-guessed, NuGet-API-verified)
WebView2 version replacing a floating wildcard, a committed
`packages.lock.json` with `--locked-mode` restore, explicit restore/
publish separation (catching a second, distinct RID-matching defect:
restoring without `-r win-x64` produces no RID-specific restore target,
so `publish --no-restore -r win-x64` fails with `NETSDK1047`), a bounded
narrowly-classified retry for transient network/feed failures only, and a
NuGet packages cache keyed on the lock file's hash (optimization only).
Reproducibility was proven, not merely asserted: two independent clean-
runner CI runs on the identical commit both passed fully end to end
(including the packaged install→launch→health→UI→API→shutdown→uninstall
smoke test), and the second run's generated lock file was diffed byte-
for-byte identical against the committed one. §7b ("Local Reproducible
Desktop Packaging") remains `APPROVED_PENDING`, untouched — this pass
fixes the existing CI-driven path's restore determinism, it does not
implement REL-1's own local-script requirement. See §7c's own note above
for how this reconciles with the still-open `os/1e-openshift-live-tail`
branch's separately-registered (tracking-only, no evidence yet)
"Reproducible Windows .NET / NuGet Toolchain" row once that branch
rebases onto this now-hardened `main`.

**OS-1D pass (§12g above).** Reconciled against `docs/verification/OS_1D_OPENSHIFT_CONTEXT_CORRELATION_REPORT.md`.
Confirmed that context, correlation, trace, and journey search for
OpenShift are almost entirely reuse of pre-existing generic machinery
(`/api/v1/logs/context`/`/journey`, `EventFilters`) — the only genuinely
new backend surface is the `containerName` generic scope-hint field and
`DirectPodLogProvider`'s narrow-context target-resolution override, both
tracked as OS-1D-1 above. `contextView` capability truthfully flips to
`true` only after real end-to-end verification (backend + rendered
frontend), never merely because an endpoint now technically accepts the
request. A new test-infrastructure defect (`TEST-INFRA-1`, historical
evidence PNGs mutated by ordinary E2E execution) was independently
re-observed during this pass's own validation and is registered as a
deferred, tracked hardening item per mission §46 — explicitly not fixed
opportunistically inside OS-1D, since doing so risked distracting from
this slice's own actual scope. `REL_1` remains confirmed
`APPROVED_PENDING`, untouched. `OS_1E`/`OS_1F`/`OS_1G`/`Phase M` remain
`NOT_STARTED`.

**OS-1D REVIEW RECOVERY pass (§12h above).** Reconciled against
`docs/verification/OS_1D_OPENSHIFT_CONTEXT_CORRELATION_REPORT.md` §14. A
real, previously-untracked server-side scope-integrity defect was found in
§12g's own narrow-context work: a client-supplied `pod`/`containerName`
pair alone could authorize direct pod-log retrieval for a target that was
never part of any OS-1B-resolved scope (a Job/CronJob/standalone/operator
pod, or any arbitrary name). Fixed and closed as OS-1D-14 through OS-1D-25
with a new, independently-keyed HMAC proof codec
(`core.search.ContextTargetProofCodec`, modeled on the existing
`PageCursorCodec`) and 25 new executable tests (13 integration-level in
`DirectPodLogProviderTest`, 12 codec-level in `ContextTargetProofCodecTest`)
proving zero cluster calls for every unauthorized-target case. The valid
"disappeared pod" requirement this mechanism exists to satisfy is
unaffected and re-verified working through the corrected path. `TEST-INFRA-1`
remains `APPROVED_PENDING_HARDENING`, untouched. `REL_1` remains confirmed
`APPROVED_PENDING`, untouched.

**OS-1D FINAL REVIEW RECOVERY pass (§12i above).** Reconciled against
`docs/verification/OS_1D_OPENSHIFT_CONTEXT_CORRELATION_REPORT.md` §15. A
narrower time-of-check/time-of-use defect was found in §12h's own
authorization gate: `authorizeNarrowContextTarget` verified the context
proof against a live `session.generation()` read instead of the
`generation` value `searchWithOutcome` already captures as part of its own
immutable operation snapshot (the same snapshot that governs `server`/
`token`/`caPath`/`scope`) — a real, if narrow, inconsistency in an
otherwise-correct authorization gate, not a reopening of §12h's own
threat model. Fixed by threading the captured `generation` down through
`resolveTargetPlan`/`authorizeNarrowContextTarget` and capturing
`describeScopeWarnings`' own generation/namespace/scope once, together, at
its top. Closed as OS-1D-26 through OS-1D-30, with 3 new tests proving
real interleaving (an actual reconnect to an independent second mock
cluster, landing strictly after an operation's own snapshot was captured,
never causes that operation to touch the new connection). No
`ContextTargetProofCodec` design, HMAC format, or field-binding rule
changed. `TEST-INFRA-1` remains `APPROVED_PENDING_HARDENING`, untouched.
`REL_1` remains confirmed `APPROVED_PENDING`, untouched.

**OS-1D FINAL SNAPSHOT ATOMICITY RECOVERY pass (§12j above).** Reconciled
against `docs/verification/OS_1D_OPENSHIFT_CONTEXT_CORRELATION_REPORT.md`
§16. The deepest layer of this same class of defect: §12i correctly
threaded the *value* of `generation` through authorization, but that
value - and `server`/`token`/`caPath`/`scope` alongside it - was still
obtained through several independent `OpenShiftSession` getter calls
(each its own atomic read), not one atomic read of the session as a
whole. A reconnect landing between two of those getter calls could still
produce a hybrid pre-/post-reconnect operation state. Fixed with a new
`OpenShiftSession#operationSnapshot()` (one `current.get()`, projected
into a new package-private `ConnectionOperationSnapshot` record) and
applied to all three classes in `source.openshift` that make
authenticated cluster calls from multiple session fields:
`DirectPodLogProvider` (`searchWithOutcome`, `describeScopeWarnings`),
`OpenShiftScopeService` (`discoverWorkloads`, `discoverPods`), and
`OpenShiftConnectionService` (`refreshProjects`) - confirmed to be the
complete set via a repository-wide search, not assumed. 9 new
session-level unit tests plus 1 new integration-level test close this;
the pre-existing §14/§15 race tests were re-verified passing unchanged
under the new mechanism (3 consecutive full-suite runs of both
`DirectPodLogProviderTest` and the whole `source.openshift` package, no
change in outcome). Intentionally-unchanged remaining independent reads
(the generation guard, single-expression CAS-guard reads, local-cache-
only reads, the display-only health badge) are documented explicitly,
not silently left unexplained. `TEST-INFRA-1` remains
`APPROVED_PENDING_HARDENING`, untouched. `REL_1` remains confirmed
`APPROVED_PENDING`, untouched.

**OS-1E pass (§12k above).** Reconciled against
`docs/verification/OS_1E_OPENSHIFT_LIVE_REPORT.md`. Executed as a stacked
continuation on PR #42's approved HEAD while that PR remained externally
blocked on the Windows Desktop CI gate — zero commits on
`os/1d-openshift-context-correlation`, zero changes to PR #42's own diff.
Confirmed the entire existing generic Live architecture (transport,
reconnect, lifecycle, masking, buffering) needed no redesign — OS-1E's
real new work is a genuinely streaming `follow=true` line decoder reusing
OS-1C's own hardened cancellation-bridge pattern, and a multi-target
orchestration layer reusing OS-1B's scope resolution and OS-1D's atomic
snapshot verbatim. A new, previously-untracked requirement surfaced and
was registered (not implemented), per this slice's own mission: `REL-1`
addendum "Reproducible Windows .NET / NuGet Toolchain" (§7c), tracking the
real, observed PR #42 Windows Desktop CI infrastructure failure so a
transient NuGet restore issue cannot silently block a future merge the
same way again. `liveTail` flips `true` only after full implementation
and its full test matrix passed. `TEST-INFRA-1` remains
`APPROVED_PENDING_HARDENING`, untouched. `REL_1`'s existing rows (§7, §7b)
remain confirmed `APPROVED_PENDING`, untouched — this pass adds §7c
alongside them, not in place of them. `REAL_OPENSHIFT_1E=BLOCKED_CREDENTIALS`.

**OS-1E REVIEW RECOVERY pass (§12l above).** Reconciled against
`docs/verification/OS_1E_OPENSHIFT_LIVE_REPORT.md`'s own review-recovery
section. An independent review of §12k's own implementation found six
real defects, all closed as OS-1E-14 through OS-1E-22: (1) the reconnect
budget could be reset forever by replayed historical initial-tail data,
because every reconnect wrongly reused the configured `initialTailLines`
instead of `tailLines=0` — fixed by making `tailLines` a genuine per-
attempt parameter and defining `REAL_RECOVERY` explicitly as "a reconnect
delivered a genuine, non-replayable event"; (2) one physical overlong log
line could fragment into several fake `CanonicalLogEvent`s — fixed by a
`DecodedLine(content, truncated)` shape and a decoder `discardingOverlong`
mode guaranteeing at most one event per physical line; (3) `maxConcurrency`
was claimed reused from `DirectPodLogProperties` but never actually
enforced for live connect/reconnect — fixed with a non-blocking, per-
session connect-admission permit gate, deliberately distinct from
`maxTargets` and deliberately not `flatMap(..., maxConcurrency)` (which
would starve every target past the first `maxConcurrency`, since each
stream is intentionally infinite); (4) a session with zero active targets
could remain visually labeled plain LIVE, since the generic SSE heartbeat
correctly keeps the transport connection open — fixed with a frontend
badge override driven by the new backend-reported `LiveSourceStatus.state`,
never by inferring health from warning text; (5) the original single-slot
warnings channel reported only the most-recently-changed target, silently
losing an earlier still-true condition — fixed by a new request-scoped
`LiveSourceStatus` (state + live target counts + CURRENT warnings) pushed
as a full snapshot on every change; (6) a connection-generation change or
a scope (project/workload/pod/container) change during an already-running
immutable live-target snapshot was never actively surfaced — fixed with a
bounded, in-memory-only (never a cluster/Watch call) periodic staleness
check that terminates the old session's own target streams and reports
`STALE`, never migrating it onto new credentials or a new scope. No
`ContextTargetProofCodec`/`ConnectionOperationSnapshot`/`resolveTargetPlan`
design touched; no OS-1B/OS-1C/OS-1D `VERIFIED` row reopened. `TEST-INFRA-1`
remains `APPROVED_PENDING_HARDENING`, untouched. `REL_1` (§7, §7b, §7c)
remains confirmed `APPROVED_PENDING`, untouched. `REAL_OPENSHIFT_1E=BLOCKED_CREDENTIALS`.

**OS-1E FINAL IMPLEMENTATION pass (§12m above).** Reconciled against
`docs/verification/OS_1E_OPENSHIFT_LIVE_REPORT.md`'s own §14. A separate,
text-only design-closure pass (no code) treated §12l's own implementation
as input, not authority, and found one real defect the review-recovery
pass had not caught, plus five genuine design gaps, all closed as
OS-1E-23 through OS-1E-32: (1) a target was marked `ACTIVE` at
`followTarget()` entry, before any HTTP response — fixed by switching
`OpenShiftApiClient#followPodLog` to WebClient `exchangeToFlux`, so an
HTTP `2xx` response (not connection-attempt start, not the first log
line) is the sole evidence of establishment, via a caller-supplied
`onEstablished` callback invoked exactly once; (2) a physical line of
exactly `maxLineBytes` bytes followed by a real newline was falsely
truncated — fixed by reordering `LiveLineDecoder`'s overflow check so the
newline is always checked before the `buffer.size() == maxLineBytes`
branch; (3) no final-partial-line flush existed for any termination cause
— fixed with three distinct, tested outcomes: clean EOF flushes one
`unterminated=true` event (bounded `UNTERMINATED_LIVE_LINE` count), an
error discards the fragment silently (bounded `PARTIAL_LINE_DROPPED`
count), and an explicit Stop/cancellation discards it with no warning at
all; (4) no `connectingTargets` count/state existed — fixed by adding
`LiveSourceStatus.State.CONNECTING` and a `connectingTargets` count
satisfying `resolvedTargets = connecting + active + reconnecting +
stopped` for every snapshot, derived by exact priority `STALE > EXPIRED >
RUNNING > CONNECTING > DEGRADED > RECONNECTING > NO_ACTIVE_TARGETS`, with
one documented, tested completion of a genuine gap in the literal owner
formula; every resolved target's phase is now seeded to `CONNECTING`
before the session's first status push, closing a false initial
`NO_ACTIVE_TARGETS` reading; (5) becoming a distinct establishment signal
created a risk of conflating `STREAM_ACTIVE` with
`OUTAGE_RECOVERY_BUDGET_RESET` — resolved by an explicit separation: only
a genuine post-reconnect `DecodedLine` (via `.doOnNext`, never via
`onEstablished`) resets the bounded reconnect budget, since `tailLines=0`
on every reconnect makes such data provably non-replayed; (6) a terminal
SSE session rode the full `connectionTimeout` and the frontend's generic
`EventSource` auto-reconnect could not distinguish a deliberate terminal
server-close from an ordinary transport failure — fixed with a generic,
bounded, one-shot server-side grace-close (`min(2×heartbeatInterval,
10s)`) via `LiveSourceStatus.State#isTerminal()`, and a frontend
`sourceStatusRef` consulted inside `onerror` to suppress the generic
reconnect specifically (and only) when the last-known source state was
terminal, transitioning instead to a stopped/restart-required UI state
that retains visible events and preserves the specific terminal badge
reason. `maxConcurrency`'s permit-release-on-timeout path is unchanged in
effect but now explicitly never calls `onEstablished`. No
`ContextTargetProofCodec`/`ConnectionOperationSnapshot`/`resolveTargetPlan`
design touched; no OS-1B/OS-1C/OS-1D/§12l `VERIFIED` row reopened (only
OS-1E-19's evidence annotated in place). `TEST-INFRA-1` remains
`APPROVED_PENDING_HARDENING`, untouched. `REL_1` (§7, §7b, §7c) remains
confirmed `APPROVED_PENDING`, untouched. `REAL_OPENSHIFT_1E=BLOCKED_CREDENTIALS`.

**OS-1E FINAL TERMINAL STATUS DELIVERY FIX pass (§12n above).**
Reconciled against `docs/verification/OS_1E_OPENSHIFT_LIVE_REPORT.md`'s
own §15. An independent review of §12m's own terminal-SSE grace-close
found the periodic heartbeat alone could not guarantee terminal-state
delivery before SSE close: with the DEFAULT properties
(`heartbeatInterval=15s`), `terminalGrace = min(2×15s, 10s) = 10s` is
strictly less than the heartbeat interval, so the connection could close
up to 5 seconds before the next heartbeat would ever have carried the
terminal status — `LiveTailService`'s `statusTracker` only updated an
in-memory reference and emitted no SSE event of its own. **Fix:** the
first time a terminal status is observed, `statusTracker` now emits ONE
immediate `"status"` SSE event carrying that exact terminal snapshot
before starting the grace timer, closed as OS-1E-33. The grace timer
itself was also a detached `Mono.delay(...).subscribe(...)` with its own
lifecycle, independent of the SSE connection's own cancellation — **fix:**
folded into `statusTracker`'s own `Flux`, subscribed only as one arm of
the top-level merge, so it is now automatically disposed on client
disconnect/Stop/`connectionTimeout`, closed as OS-1E-34. Both fixes are
narrow and additional — §12m's own terminal-SSE grace-close and frontend
terminal-reconnect-suppression mechanisms are unchanged and correct; no
`OpenShiftLiveTailProvider` state/reconnect/decoder semantics touched
(explicitly out of scope for this pass); no frontend production code
changed. `TEST-INFRA-1` remains `APPROVED_PENDING_HARDENING`, untouched.
`REL_1` (§7, §7b, §7c) remains confirmed `APPROVED_PENDING`, untouched.
`REAL_OPENSHIFT_1E=BLOCKED_CREDENTIALS`, unchanged.

**OS-1F pass (§12o above).** Reconciled against
`docs/verification/OS_1F_OPENSHIFT_PROFESSIONAL_UX_REPORT.md`. A product/
UX/integration slice, explicitly not another backend retrieval rewrite —
OS-1A through OS-1E's connection/discovery/search/context/live semantics
are byte-for-byte unchanged (confirmed via targeted diff, not assumed). A
real, evidence-backed LERUX-1 audit preceded implementation: most of the
checklist (Settings source labelling, token safety, 403-vs-empty
discovery, Results/Inspector WHERE fields, every OS-1E Live badge state)
was already `SAME_CORRECT`/`NEW_BETTER`, verified by direct source
reading rather than redesigned on assumption. Three genuine gaps were
found and closed: (1) the generic header `ScopeTrail` had zero OpenShift
awareness, so an investigator had no persistent "WHERE am I searching?"
truth without reopening Settings — fixed with a new non-mutating `GET
/scope` endpoint and a shared `useOpenShiftScopeSummary` hook feeding a
truthful, non-redundant Project/Namespace → Workload → Pod → Container
breadcrumb, correctly labelling "Namespace:" only for a Kubernetes-
fallback cluster; (2) the connection-status badge had no "Connecting…"
state during the real async gap after submitting `oc login`, reading
"Not connected" as if nothing were happening — fixed with a narrowly-
scoped `connecting` state, distinct from every other busy scope-selection
action; (3) Search/Live remained clickable with no Project/Namespace
selected, reaching the backend only as an opaque, uncaught
`IllegalStateException` — fixed with a frontend-only truthful gate and
visible hint, no backend semantic touched. All evidence in
`docs/verification/OS_1F_EVIDENCE/` is explicitly, honestly labelled
MOCKED (Playwright route interception) rather than presented as real-
cluster evidence — at the time of that pass, `REAL_OPENSHIFT_1F` was
`BLOCKED_CREDENTIALS`, consistent with every prior OS-1x slice; that
pass neither touched nor could convert that status. `openshift-loki`
untouched, not removed. `TEST-INFRA-1` remains
`APPROVED_PENDING_HARDENING`, untouched. `REL_1` (§7, §7b, §7c) remains
confirmed `APPROVED_PENDING`, untouched.

**OS-1F real-Sandbox validation pass (§12o.2 above).** A fresh
credential was supplied; connection, discovery, search, context,
cross-service correlation, Live (single pod, multi-replica, and All
Workloads), Live target-snapshot immutability under a real rolling
update, and two partial/failure-truthfulness scenarios were all
verified for real against the Red Hat Developer Sandbox — full evidence
in `docs/verification/OS_1F_REAL_OPENSHIFT_EVIDENCE/`.
`REAL_OPENSHIFT_1F=PASS`, superseding the `BLOCKED_CREDENTIALS` status
above now that credentials exist; no OS-1A..1E backend semantic was
touched to obtain it. A separate mission renamed the testbed away from
banking-flavored naming to a generic `logexp-test-<noun>` scheme
(`BANKING_TERMS_IN_TESTBED=0`, `PRODUCT_CODE_CHANGED=NO`); two
real-Sandbox-only testbed defects (probe timing under CPU throttling,
sidecar memory sizing) were found and fixed, classified `HARDENING`
to test infrastructure, not product code. Token never printed or
persisted throughout — full audit in the verification report §8.3.

**OS-1G pass (§12p above).** A decision-gate mission resolving OS-12:
whether Loki should become an aggregated/historical provider behind the
first-class OpenShift source. `REAL_LOKI` was checked directly in this
session's own environment (no `LOKI_*` env vars, no Loki route/service in
either real Sandbox project) and confirmed
`REAL_LOKI=BLOCKED_EXTERNAL_ENVIRONMENT`, not fabricated as `PASS`. Per
the mission's own default-safety rule, this triggered the most
conservative of three compared options: `openshift-loki` stays exactly
as-is, and — beyond that rule's own minimum — the `AggregatedLogProvider`
interface itself was deliberately not implemented this slice either,
judged as premature abstraction for a single candidate implementation
never observed against real data (full rationale in
`docs/verification/OS_1G_AGGREGATED_PROVIDER_DECISION_REPORT.md` §5).
Zero backend/frontend production source changed. `OS-12` remains
`OPEN_UNDECIDED`, not silently closed. `openshift-loki` untouched, not
removed. `OpenShiftLogSource`/`DirectPodLogProvider` (OS-1A..1F)
untouched. `TEST-INFRA-1` remains `APPROVED_PENDING_HARDENING`,
untouched. `REL_1` (§7, §7b, §7c) remains confirmed `APPROVED_PENDING`,
untouched.

**REL-1 pass (§7b.1 above).** Implements the long-tracked, never-
previously-implemented §7b addendum: a developer cloning the repository
can now build the native desktop package for their own host OS without
GitHub Actions, and CI (`windows-desktop.yml`, and the new
`macos-desktop.yml`) calls the exact same repository-owned scripts
rather than duplicating packaging logic in YAML. Windows:
`scripts/build-desktop-windows.ps1` extracted from the pre-existing CI
logic, unchanged behavior, now with an explicit preflight. macOS:
genuinely new — `scripts/build-desktop-macos.sh`, a new
`desktop/launcher-macos` plain-Java launcher (zero dependencies beyond
the JDK, deliberately opens the system browser with a menu-bar tray icon
rather than an embedded native window, a documented v1 design choice),
and `desktop/packaging-macos/`. Both platforms verified for real on
real GitHub-hosted `windows-latest`/`macos-latest` CI runners — real
installer/DMG produced, real install→launch→health→UI→API→shutdown→
uninstall lifecycle confirmed on both
(`WINDOWS_PACKAGED_SMOKE=PASS`, `MACOS_PACKAGED_SMOKE=PASS`), never
claimed from this (Linux) session directly. Two real macOS-only defects
(a bash 3.2 empty-array-expansion incompatibility, and jpackage's own
rejection of this project's pre-1.0 leading-zero version) were found via
the real macOS runner and fixed, each confirmed by a subsequent green
real CI run. `PRODUCT_BEHAVIOR_CHANGED=NO` — zero backend/frontend
production source changed. GitHub Releases publication and
`RELEASE_GRADE_MODE` with real Apple signing credentials remain
explicitly deferred, not fabricated as done — full detail in
`docs/verification/REL_1_DESKTOP_RELEASE_READINESS_REPORT.md`.

**`v0.1.0` release pass (§7d above).** The owner explicitly authorized
publishing the first GitHub Release. Set the required publisher/author
identity ("Ahmed Fawzy elrifaye") in Windows installer/executable and
macOS app bundle metadata, verified for real via new CI assertions
against the real installed product on real `windows-latest`/
`macos-latest` runners — not source review alone. Tagged `v0.1.0`
(annotated, pointing exactly at the release-prep merge commit), built
both platform artifacts from that exact tag via `workflow_dispatch`
(resolving to exactly `0.1.0`, no dev-SHA suffix), re-ran both packaged
smoke tests against the release build, swept both real downloaded
artifacts for secrets (`SECRETS_IN_RELEASE_ARTIFACTS=NO`), and published
the GitHub Release (not draft, not prerelease) with both artifacts and
their SHA-256 checksums attached. **Icon branding was explicitly NOT
resolved** — a real audit found no official Log Explorer product mark
anywhere in the repository, and no branding was fabricated to fill the
gap (`CANONICAL_ICON_SOURCE=MISSING`); `v0.1.0` ships with the same
pre-existing generic placeholder icon Slice 9 already used, a genuine,
owner-visible gap now explicit in §8 rather than silently resolved or
hidden. `PRODUCT_BEHAVIOR_CHANGED=NO`. The
`functional-baseline-pre-ux-redesign` tag was deliberately **not**
created in this mission — that belongs to the separate, still-pending
Final Functional Closure mission.

**Automated tag-driven release pipeline pass (§7e above).** Added
`.github/workflows/release.yml` — every release after `v0.1.0` now
publishes automatically on `git push origin vX.Y.Z`, gated by a strict
tag-vs-`VERSION` match, real Windows/macOS release builds (reusing
`windows-desktop.yml`/`macos-desktop.yml` via `workflow_call` — the
exact same jobs every PR runs, not copied steps), their real packaged
smoke tests, and a new automated secret/developer-path scan of each
built artifact — publication is structurally impossible unless every
one of those succeeds. `v0.1.0`'s own tag, release, and all four assets
were verified byte-for-byte unchanged before and after this pass
(`V0_1_0_TAG_UNCHANGED=YES`, `V0_1_0_RELEASE_UNCHANGED=YES`,
`V0_1_0_ASSETS_UNCHANGED=YES`) — this pipeline was never exercised
against it. No real tag was created to test the new pipeline (per
explicit instruction not to publish a fake production release);
validated instead via YAML syntax checks, local testing of the
version-gate and release-notes-assembly logic, and code review of
permissions (`contents: write` scoped to only the one job that needs
it, `EXCESS_PERMISSIONS=NO`) — the reused build/smoke-test logic itself
already has real CI evidence from REL-1 and the `v0.1.0` branding pass.
`CANONICAL_ICON_SOURCE=MISSING`, unchanged, no icon work attempted.
`PRODUCT_BEHAVIOR_CHANGED=NO`.

```
UNTRACKED_OWNER_REQUIREMENTS=0
```

## 15. Pre-Closure Functional Recovery

Owner-confirmed functional/workflow regressions found during real use of
the shipped application, reported as a single mission distinct from the
still-pending UI/UX redesign ("Impeccable") and Final Functional Closure.
Every row below either fixes a genuine defect or **names an explicit
conflict with an earlier decision and applies the later one** (CLAUDE.md
§5) — no earlier requirement was silently dropped; see the UX-6/UX-8/
UX-11/UX-18/UX-19/UX-21/OS-1A-9 rows above, each updated with a forward
cross-reference to the specific PCFR row that superseded or extended it.

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| PCFR-1 | Inspector content accessibility — restore grouped/tabbed presentation (Overview / Actor & client / Request flow / Business & error / Technical & all fields) | `SUPERSEDED` (tab-visibility rule only) — see PCFR2-1 | `frontend/src/features/inspector/InspectorTabs.tsx` (new, WAI-ARIA tabs pattern: roving tabindex, Left/Right/Home/End); `EventInspector.tsx` (tab list computed via `useMemo`); `EventInspector.test.tsx` (87 tests in `src/features/inspector/`) | **Named conflict (CLAUDE.md §5), recorded here rather than silently overwritten.** This row's own original decision — hide a tab entirely when its section's field-builder returns empty ("data-driven, never a fixed tab list") — was itself superseded by Pre-Closure Functional Recovery 2 (PCFR2-1): the owner explicitly rejected the hidden-tab behavior once it shipped, because the ABSENCE of data is itself diagnostically meaningful and a disappearing tab is indistinguishable from "the UI hid something." The tabbed WAI-ARIA PRESENTATION itself (this row's actual headline fix) is unaffected and remains `VERIFIED` — only the tab-VISIBILITY rule changed, from conditional to structurally fixed. Never fabricates causality, never drops unknown fields (unchanged), no `dangerouslySetInnerHTML` (unchanged) |
| PCFR-2 | Protected field masking — move out of Docker Settings into a global, source-independent Settings area | `VERIFIED` | `frontend/src/features/settings/PrivacyMaskingSettingsPanel.tsx` (new, rendered in `Shell.tsx` before/independent of `DockerSettingsPanel`/`OpenShiftSettingsPanel`); `DockerSettingsPanel.tsx` (old "Protected field masking" informational block removed) | Enforcement stays server-side and source-independent regardless of settings-panel location — see PCFR-3; this row is the information-architecture fix only |
| PCFR-3 | Protected field masking policy — individually configurable per field (CIF/Username/CustomerId/DeviceId/DeviceIp), default masked, checkbox-based (never a per-row reveal action), never client-side-reconstructed | `VERIFIED` — **default-masked part `SUPERSEDED`, see SSMP-2** | `backend/src/main/java/com/logexplorer/core/mask/ProtectedField.java`, `MaskingPolicyService.java` (new; `ConcurrentHashMap`, defaults every field `true`/masked at construction and via `resetToDefaults()`, deliberately **not** persisted to disk — a backend restart resets to fully-masked, the maximally safe failure mode); `MaskingService.java` (constructor now takes `MaskingPolicyService`, consults it per field before masking); `MaskingSettingsController.java` (new, `GET`/`PUT /api/v1/settings/masking`); `MaskingServiceTest` (+7 tests incl. `aFreshMaskingPolicyServiceAlwaysStartsFullyMaskedTheSafeDefault`); `MaskingSettingsControllerIntegrationTest` (new, 7 tests over real HTTP); `PrivacyMaskingSettingsPanel.tsx`/`.test.tsx` (10 tests: fetch-on-open, toggle applies the **server-returned** policy — never optimistic, warning shown while any field unmasked, no reveal button, axe a11y) | **Named conflict, applied per CLAUDE.md §5** — see the UX-8 row above for the full boundary: this supersedes the earlier absolute "a protected field can never be sent unmasked" reading, but CLAUDE.md §2 rule 5's literal "no reveal action" is still fully honored — no button reveals an already-rendered masked cell, no raw value is cached/reconstructed client-side (`MaskingSettingsController`'s own doc comment explains why this unauthenticated-local endpoint carries the same trust model as `DockerSettingsController`/`OpenShiftConnectionController`, no SSRF-shaped risk). `MaskingService.mask()` remains the sole place raw sensitive values are read (ArchUnit `onlyMaskingServiceMayTouchRawSensitiveFields`, unchanged). **STATUS UPDATE (§20, SSMP-2):** the owner later explicitly superseded the "default masked" half of this row — a fresh/default installation now starts fully UNMASKED for all five fields; this row's text is preserved verbatim above as the historical decision, not deleted. Every other guarantee this row records (per-field configurability, checkbox-only, never a per-row reveal, never client-side-reconstructed, server-side enforcement) remains unchanged and still fully in force — see SSMP-2 for the exact new default and what stayed the same |
| PCFR-4 | Results table — real per-column sorting (first click ascending, second descending, clear non-color indicator, deterministic), compatible with the existing Newest/Oldest control (single authoritative sort state, never two competing ones) | `VERIFIED` | `frontend/src/features/results/columnSort.ts` (new: `compareSortValues` nulls-last direction-independent, `IndexedEvent{event,originalIndex}` pairing created BEFORE sorting, `nextColumnSort` asc↔desc toggle); `columnRegistry.tsx` (`sortAccessor` added per sortable column; `time`/`whatHappened` deliberately have none); `ResultsTable.tsx` (Time column header click aliases the exact same `sortDirection`/`setSortDirection` state `SortControl` uses — never a second sort state; column sort suppresses gap markers, which are keyed to original fetch order); `ResultsTable.test.tsx` (13 new tests incl. missing-values-sort-last-both-directions, selection-stays-correct-against-original-index-during-a-sort, axe a11y); `columnSort.test.ts` (13 tests) | **Named conflict, applied per CLAUDE.md §5**: `SortControl.tsx`'s own Slice-4 doc comment recorded a deliberate decision against a clickable Time header; that rationale is preserved verbatim in the file, marked SUPERSEDED, not deleted, followed by this mission's owner decision. Two real product bugs were found and fixed by this row's own new tests before merge — see the recovery's session notes: (1) resolving original row index by content-identity after sorting caused duplicate React keys/wrong selection when two events shared identity but differed only in the sorted field, fixed by pairing `{event, originalIndex}` before sorting; (2) naively negating the whole comparator for descending sort also flipped missing-value placement, fixed by checking missing-ness before the direction flip |
| PCFR-5 | Column management — discoverable Columns control with drag-and-drop reorder (priority 1), existing keyboard Move up/down kept as fallback (priority 2/3), obvious Reset to default; table state (columns/sort/density/selection) never resets itself on an unrelated change | `VERIFIED` | `frontend/src/features/results/tablePreferences.ts` (`moveColumnToIndex`, clamps out-of-range, no-op on own position); `TableSettingsControl.tsx` (native HTML5 drag-and-drop: `draggable`/`onDragStart`/`onDragOver`/`onDrop`/`onDragEnd`, `⠿` drag handle, additive to unchanged Move up/down buttons); `tablePreferences.test.ts` (+4 tests); `TableSettingsControl.test.tsx` (+5 tests: draggable rows, drag-last-drop-on-first moves to front, drop-on-self no-op, Move up/down unchanged, drag-and-drop persists to `localStorage`) | **Named conflict, applied per CLAUDE.md §5**: `TableSettingsControl.tsx`'s own Slice-4 doc comment recorded "deliberately not drag-and-drop"; preserved verbatim, marked SUPERSEDED. Local component state for column sort (PCFR-4) plus this row's `moveColumnToIndex` being a pure reorder of `columnOrder` (never touching `hiddenColumnIds`/density/selection) is why reorder-then-sort-survives and density-change-preserves-columns hold structurally, not by extra bookkeeping — re-verified by the combined 406-test run across `results/`+`settings/`+`inspector/` |
| PCFR-6 | OpenShift connectivity — honor `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` (+lowercase) consistently, classify a proxy-connect failure distinctly (`Kind.PROXY`) rather than the generic `Kind.NETWORK` | `VERIFIED` | `backend/src/main/java/com/logexplorer/source/openshift/OpenShiftApiClient.java` (`classify(Throwable, boolean proxyConfigured)` — `proxyConfigured` computed via `ProxyRoute.resolve(environment, server.getHost())` at all 3 call sites: `get()`, `fetchPodLog()`, `followPodLog()`, mirroring what `build()` already did); `OpenShiftApiClientTest` (`aConfiguredProxyThatCannotBeReachedIsClassifiedAsAProxyFailure_notGenericNetwork` — real deliberately-broken-proxy test against a real live `MockOpenShiftServer`, proving the same generic client reaching the same server succeeds); `ProxyRouteTest` (24 pre-existing tests, unchanged, already covered `HTTPS_PROXY`/`https_proxy`/`HTTP_PROXY`/`http_proxy`/`NO_PROXY`/`no_proxy`, domain-boundary matching, credentials never printed) | Audit-first, per CLAUDE.md §5's "audit before editing": `ProxyRoute`/`build()` were already fully correct and wired into every OpenShift network call (`OpenShiftConnectionService`, `OpenShiftScopeService`, `OpenShiftLiveTailProvider`, `DirectPodLogProvider` — all consume `OpenShiftApiClient`, whose `build()` runs fresh per request/reconnect, so a reconnect always re-resolves the proxy, never a stale route). The one real gap: `Kind.PROXY` existed in the enum but was never thrown. Root cause (confirmed via a standalone empirical diagnostic against reactor-netty's actual jars): Netty's `ProxyConnectException` fires only when the proxy's TCP port is reachable but its CONNECT response is rejected — not when the proxy's own port is unreachable, which surfaces as a plain `ConnectException` structurally identical to a direct-to-cluster failure. Fix: when a proxy is configured for the request's host, ANY low-level `WebClientRequestException` connect failure is `Kind.PROXY`, not just the narrower `ProxyConnectException` case — reasoned, not guessed, from Reactor Netty's own `HttpClient.proxy(...)` contract (the TCP attempt necessarily targets the proxy first whenever one is configured) |
| PCFR-7 | Loki (`openshift-loki`, the live, retained LokiStack-behind-OpenShift source — see OS-1G, "why openshift-loki is retained") — same `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` support, same distinct proxy-failure classification | `VERIFIED` | `backend/src/main/java/com/logexplorer/source/loki/LokiWebClientFactory.java` (new `Map<String,String> environment` constructor param, `proxyFor(LokiProperties)` resolves once at construction — Loki has one fixed `baseUrl` per deployment, unlike OpenShift's per-connection server, so there is nothing to re-resolve per-request); `LokiErrorClassifier.classifyThrowable(Throwable, boolean proxyConfigured)` (new `Reason.PROXY`); `LokiQueryClient` (computes `proxyConfigured` once in its constructor via the same `proxyFor`, threads it into every `classifyThrowable` call); `LokiWebClientFactoryTest` (+4 tests incl. a real deliberately-broken-proxy test against a real HTTPS server, proving `Reason.PROXY` not `Reason.UNKNOWN`, and that the same server reached directly still succeeds); `LokiErrorClassifierTest` (+1 test, proxy-vs-no-proxy classification of the identical exception) | **Genuinely new finding, not previously tracked anywhere** — a dedicated audit fork (grepping every `HttpClient.create()`/`WebClient.builder()`/`.proxy(` in the backend) found `LokiWebClientFactory` was the one OpenShift-cluster-adjacent network call site with **zero** proxy support at all, structurally unable to reach the LokiStack gateway through a configured corporate proxy. Fixed by reusing `ProxyRoute` exactly as `OpenShiftApiClient.build()` does, plus a minimal, proportional `Reason.PROXY` addition to Loki's own (much coarser, pre-existing) error taxonomy — not a full rebuild of Loki's classifier, which was already out of this row's scope |
| PCFR-8 | "Show surrounding logs" — root/selected event clearly, visibly identified: auto-scrolled into view (not just marked) | `VERIFIED` | `frontend/src/features/results/ResultsTable.tsx` (`contextRootRowRef`, `useEffect` keyed on `contextRootIdentity` — a stable string, not the `events` array reference, so this fires exactly once per context view opening, never on every re-render while one stays open — calls `scrollIntoView({block:'center', behavior:'smooth'})` on the actual root `<tr>` DOM node); `ResultsTable.test.tsx` (+3 tests: scrolls the correct row's own DOM node on open, does not re-scroll on a density change while the same view stays open, never scrolls when no context view is open) | Audit-first: the root/selected-event marking itself (visible `contextRootRow` class + `aria-current="location"` + a visually-hidden "Original event you were investigating" label — never color-only) and the narrow same-execution-context scoping (`OS-1D §9`'s existing sibling-container/different-namespace disambiguation tests) were already correct and already tested; the auto-scroll was the one real gap an audit found. Distinct from Correlation/Journey (unchanged — this view remains `sortable={false}`, its own true chronological order independent of the global Newest/Oldest setting, per the existing `sortable` prop doc comment) |

**Pre-Closure Functional Recovery pass (this section).** Fixed eight
owner-confirmed functional/workflow regressions across Inspector
accessibility, masking information architecture and policy, results-table
sorting and column management, OpenShift/Loki enterprise proxy support,
and surrounding-logs root visibility — explicitly **not** the pending
Impeccable UI/UX redesign, not Phase M, and does not resume Final
Functional Closure. Backend: 1046/1046 tests pass (6 new). Frontend:
851/851 tests pass. Full detail, including the exact
`E2E`/security-revalidation/`V0_1_0_UNCHANGED` results, is in
`docs/verification/PRE_CLOSURE_FUNCTIONAL_RECOVERY_REPORT.md`.
`HISTORICAL_DECISIONS_PRESERVED=YES` — every superseded decision named
above is preserved in this register and in the source file it originated
in, never silently deleted. `UNTRACKED_OWNER_REQUIREMENTS=0`.

---

## 16. Pre-Closure Functional Recovery 2

Two further owner corrections found during real use of PR #51's own
changes — narrower in scope than the first recovery, and explicitly not
the pending Impeccable redesign, Phase M, or Final Functional Closure.

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| PCFR2-1 | Event Inspector primary tabs are structurally stable and remain visible even when the selected event has no data for a category — a tab must never be conditionally removed; missing data is diagnostically meaningful and must be shown as an honest empty state, not hidden by removing the tab | `VERIFIED` | `frontend/src/features/inspector/EventInspector.tsx` (`tabs` is now a fixed five-entry array, no conditional `.push`); `EventInspector.test.tsx` (new `describe` block: all five tabs present for a minimal/sparse event, for a malformed/raw-fallback event, and across a fully-populated vs. sparse event switch; each empty tab's own honest note asserted individually); `frontend/e2e/ux-r5-inspector-context.spec.ts` (rewritten "I:" test); `frontend/e2e/pre-closure-functional-recovery-2.spec.ts` (new, 4 real-browser tests against the Fixture source) | **Named conflict, applied per CLAUDE.md §5** — see the updated PCFR-1/UX-18 rows above, both marked `SUPERSEDED` for this one specific rule (tab visibility), not for the tabbed presentation itself. The three per-section empty-state messages (`ActorClientSection`/`RequestFlowSection`/`BusinessErrorSection`) already existed, unused, from before PCFR-1 ever hid the tabs — this fix is a pure removal of the conditional-inclusion logic in `EventInspector.tsx`, not a new empty-state UI |
| PCFR2-2 | User-configurable OpenShift/Loki proxy — System / Direct / Custom modes, selectable from the application itself, never requiring OS environment-variable setup | `VERIFIED` | `backend/src/main/java/com/logexplorer/source/openshift/ProxyMode.java`, `ProxyConfig.java` (new; `validate()` — blank host, blank/non-numeric port, port outside 1..65535, all rejected with a specific message), `OpenShiftProxyConfigService.java` (new; in-memory only, defaults to `SYSTEM`, deliberately not persisted to disk — the same "safe default on restart" design `core.mask.MaskingPolicyService` already established); `ProxyRoute.resolve(ProxyConfig, Map, String)` (new — the one authoritative resolver path: `SYSTEM` delegates unchanged to the pre-existing environment-only `resolve(Map, String)`, `DIRECT`/`CUSTOM` never consult the environment at all); `OpenShiftConnectionController` (`GET`/`PUT /api/v1/sources/openshift/proxy`, new); `frontend/src/features/settings/OpenShiftSettingsPanel.tsx` (`OpenShiftProxyFieldset` — a `<fieldset>`/`<legend>` radio group, Custom host/port fields appear only when Custom is selected, client-side validation before any request, "Apply proxy" commits only the server-confirmed value — never optimistic) | Additive to the existing `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` environment-variable support (OS-1A-9/PCFR-6/PCFR-7), which remains exactly what `SYSTEM` mode does. No proxy username/password/NTLM/Kerberos/PAC/SOCKS/multiple-profiles — explicit non-goals per the mission, deferred, not silently dropped |
| PCFR2-3 | One authoritative proxy configuration shared by OpenShift API and Loki — never independently drifting | `VERIFIED` | `OpenShiftApiClient`/`LokiWebClientFactory` both constructor-injected with the SAME `OpenShiftProxyConfigService` singleton bean (`@Autowired` required on each — see each class's own constructor doc comment for why, once the plain no-arg constructor was replaced); `LokiWebClientFactoryTest.openShiftApiAndLokiShareTheExactSameProxyConfigService_oneModeChangeAffectsBoth` (proves byte-identical resolved routes from one shared instance); `OpenShiftApiClientTest`/`LokiWebClientFactoryTest` each independently prove `DIRECT` bypasses even a configured environment proxy, and `CUSTOM` ignores `NO_PROXY` and routes through the configured host/port regardless of environment (real deliberately-broken-proxy tests, `Kind.PROXY`/`Reason.PROXY`) | `OPENSHIFT_API_PROXY_CONFIGURATION_SHARED=YES`, `LOKI_PROXY_CONFIGURATION_SHARED=YES` |

**Pre-Closure Functional Recovery 2 pass (this section).** Backend:
1078/1078 tests pass (32 new — `ProxyMode`/`ProxyConfig`/
`OpenShiftProxyConfigService`, the `ProxyConfig`-aware `ProxyRoute`
resolver, DIRECT/CUSTOM-mode `OpenShiftApiClient`/`LokiWebClientFactory`
tests, the new `/proxy` settings endpoint's own integration test).
Frontend: 871/871 tests pass (28 new). Typecheck and production build
clean. E2E: 306/306 pass, 1 deliberately skipped and marked
`NOT_AVAILABLE` (a real Test-Connection-through-a-broken-CUSTOM-proxy
round trip from the browser to a real cluster — no real OpenShift
credentials suitable for that specific scenario exist in this
environment; the equivalent behavior is deterministically proven at the
backend level instead). A genuine E2E test-isolation defect was found and
fixed during this pass — not a product regression: `OpenShiftProxyConfigService`
is a real, shared, in-memory singleton in the running dev backend with no
per-test reset, so the new proxy E2E tests needed `test.describe.configure({mode:
'serial'})` plus an explicit reset-to-`SYSTEM` in `beforeEach` (mirroring
the backend's own `@AfterEach resetProxyConfig()` pattern) to avoid
cross-test interference — confirmed by two full-suite reruns, both green.
Full method, evidence, and security re-validation:
`docs/verification/PRE_CLOSURE_FUNCTIONAL_RECOVERY_2_REPORT.md`.
`HISTORICAL_DECISIONS_PRESERVED=YES`. `UNTRACKED_OWNER_REQUIREMENTS=0`.

---

## 17. Final Pre-UX Baseline and User Guides

`FINAL_PRE_UX_BASELINE_AND_USER_GUIDES` mission: merged Final Functional
Closure (PR #52), cleaned the repository of every fully-merged branch,
froze an immutable pre-redesign functional baseline, and produced
bilingual (English/Arabic) user-facing documentation. No product
behavior changed in this mission — it is merge, cleanup, and
documentation only.

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| FPUB-1 | Final Functional Closure (PR #52) merged to `main`; post-merge `main` re-verified green | `VERIFIED` | `gh pr merge 52 --squash --match-head-commit 549544cd894916cd20eeb58053b237df63ba8340`; `docs/verification/FINAL_PRE_UX_BASELINE_REPORT.md` §1–2 | Merge SHA `9a574c2644f11a0fc6a9d0175494b1620318fa74`. Backend 1078/1078, frontend 871/871, typecheck/build clean, CI/Windows/macOS PASS, E2E 307/307 (clean low-concurrency run; two prior full-parallel runs each showed one already-known Live-timing flake, re-run and confirmed non-regression) |
| FPUB-2 | Repository branch cleanup — every non-`main` branch classified and, where proven fully merged, deleted; no approved work lost | `VERIFIED` | `docs/verification/FINAL_PRE_UX_BASELINE_REPORT.md` §4 | Squash-merge-only convention makes `git merge-base --is-ancestor` structurally wrong for this audit; tip-SHA-vs-merged-PR-`headRefOid` comparison used instead. 48 remote + 15 local branches deleted, all proven `SAFE_TO_DELETE`. One apparent divergence (`os/1e-openshift-live-tail`, a pre-merge rebase the local copy never saw) resolved by direct content-diff proof, not assumption, before deleting. `EVERYTHING_APPROVED_ON_MAIN=YES`, `APPROVED_WORK_MISSING_FROM_MAIN=0` |
| FPUB-3 | Immutable annotated tag `functional-baseline-pre-ux-redesign` created at the final, fully-verified main commit | `VERIFIED` | `docs/verification/FINAL_PRE_UX_BASELINE_REPORT.md` §10; tag itself (`git show functional-baseline-pre-ux-redesign`) | Created only after this mission's own closure/guide/cleanup changes were merged and `main` re-verified green a second time — never frozen early. This tag must not be moved by any future mission |
| FPUB-4 | Bilingual (English/Arabic) user documentation — User Guide, Quick Start, Troubleshooting, Capability Matrix | `VERIFIED` | `docs/user-guide/USER_GUIDE_EN.md`, `USER_GUIDE_AR.md`, `QUICK_START_EN.md`, `QUICK_START_AR.md`, `TROUBLESHOOTING_EN.md`, `TROUBLESHOOTING_AR.md`, `CAPABILITY_MATRIX.md` | Arabic guides are natural, independently-composed Arabic conveying the same substance as their English counterparts — not literal machine translations. Every capability claim cross-checked directly against current source (`SourceCapabilities`, `EventInspector.tsx`, `ContextAction.tsx`, `PrivacyMaskingSettingsPanel.tsx`, `LiveTailPanel.tsx`, settings panels, column/filter registries) — see `docs/verification/FINAL_PRE_UX_BASELINE_REPORT.md` §7 for the full list. `USER_GUIDE_CODE_CONSISTENCY=PASS`, `EN_AR_CAPABILITY_PARITY=PASS`, `CAPABILITY_MATRIX_ACCURATE=YES`, `QUICK_START_VERIFIED=YES` |
| FPUB-5 | Fresh baseline screenshots, Fixture source only, safe generic data, embedded in both language guides | `VERIFIED` | `docs/user-guide/screenshots/01-06*.png` | Captured via a one-off Playwright script run once against the running dev app, then deleted (not added to the permanent regression suite). Each image individually reviewed before embedding — no tokens/credentials/real protected data/private infrastructure addresses; masked fields render exactly as the product renders them (`fi***NN`). Every guide states current-UI screenshots document the functional baseline only and are not the redesign's visual target |
| FPUB-6 | `docs/ux-reference/old-ui/` and `docs/verification/OLD_UX_RESTORATION_AUDIT.md` preserved untouched; redesign handoff rule recorded | `VERIFIED` | `docs/verification/FINAL_PRE_UX_BASELINE_REPORT.md` §9 | OLD UI authoritative for information hierarchy/workflow/grouping/density/discoverability/professional feel; current frozen baseline authoritative for functionality/architecture/security/correctness/accessibility/reliability/capabilities; the future redesign must exceed both |
| FPUB-7 | TEST-INFRA-1 (E2E-mutated tracked evidence PNGs) contained, not opportunistically fixed | `VERIFIED` | `docs/verification/FINAL_PRE_UX_BASELINE_REPORT.md` §6 | `git status --porcelain \| grep '\.png$' \| xargs git checkout --` applied after every E2E run and after the screenshot capture in this mission. `UNRELATED_BINARY_CHANGES=0` confirmed immediately before commit |

**Final Pre-UX Baseline and User Guides pass (this section).** Closes the
loop opened by Final Functional Closure: PR #52 is merged, the repository
is free of stale branches, a named and immutable tag now marks the exact
pre-redesign functional state, and both English and Arabic users have
complete, code-verified guides to actually operate the product. This is
explicitly **not** the start of the Impeccable UI/UX redesign, not Phase
M, and does not change any product behavior — see
`docs/verification/FINAL_PRE_UX_BASELINE_REPORT.md` for the full record,
including the exact final `main` SHA the baseline tag points to.
`HISTORICAL_DECISIONS_PRESERVED=YES`. `UNTRACKED_OWNER_REQUIREMENTS=0`.

---

## 19. Configurable Log Field Mapping + Original JSON Sampling

`CONFIGURABLE_LOG_FIELD_MAPPING` mission — a **functional architecture**
mission, completely separate from and never merged into the UI/UX v2
redesign branch (`ux/v2-professional-redesign`, PR #54, untouched by this
mission). Branch: `feature/configurable-log-field-mapping`, based on
`main`.

**Owner-discovered defect:** filtering by CIF returned no results even
though the original log event genuinely contained a CIF value — because
`core.parse.LogLineParser` extracted every sensitive/business canonical
field via a single, hard-coded literal path (always `mdc.<exact-key>`),
with no fallback to any other JSON location. Confirmed by full pipeline
trace (source raw event → parser → canonical event → filtering → API DTO)
— see `docs/verification/CONFIGURABLE_FIELD_MAPPING_REPORT.md` §1.

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| CFM-1 | Fixed-schema parser limitation — root cause confirmed and fixed via a genuine configurable mapping layer, not a point patch | `VERIFIED` | `backend/src/main/java/com/logexplorer/core/mapping/` (new package: `CanonicalField`, `JsonPath`, `JsonPathResolver`, `FieldMappingProfile`, `DefaultFieldMappingProfile`, `FieldMappingResolver`, `FieldMappingProfileService`, `FieldMappingValidationService`, `sample/FieldMappingSampleService`); `core/parse/LogLineParser.java` refactored to the single authoritative field-resolution mechanism (mission §24 — the old hard-coded block is gone, not duplicated) | `docs/verification/CONFIGURABLE_FIELD_MAPPING_REPORT.md` §1-2. `ROOT_CAUSE_CONFIRMED=YES` |
| CFM-2 | Original Source JSON sampling — true, unmodified source event, source-neutral across all four sources, never conflated with the Inspector's own already-parsed "Canonical Event JSON" | `VERIFIED` | `CanonicalLogEvent#originalRawJson` (always populated, structurally excluded from `EventDto`/`api.EventMapper`); `POST /api/v1/sources/{id}/field-mapping/samples`; `SourceCapabilities#originalSchemaSampling` (truthfully `true` for Fixture/Docker/OpenShift/Loki — a real, uniform architectural property, not fabricated) | Frontend: `features/settings/fieldMapping/FieldMappingSettingsPanel.tsx` — samples held only in component `useState`, never `localStorage`/`sessionStorage`/a URL, discarded on close/reload |
| CFM-3 | Multiple candidate paths with ordered precedence, nested and literal-dotted-key JSON path syntax, no eval/scripting | `VERIFIED` | `core/mapping/JsonPath.java` (deterministic hand-written tokenizer; bracket syntax `mdc["event.correlationId"]` for a literal key containing a dot, distinct from nested `mdc.event.correlationId`); `FieldMappingResolver` ("first usable non-null/non-empty candidate wins; last candidate returned as-is" — proven exactly equivalent to the OLD parser's single-path and two-candidate correlationId behaviors) | `JsonPathTest` (17 tests, incl. explicit no-eval proof), `JsonPathResolverTest` (15), `FieldMappingResolverTest` (20) |
| CFM-4 | Built-in default profile preserves current verified mappings exactly; no invented defaults beyond what was already known-correct | `VERIFIED` | `core/mapping/DefaultFieldMappingProfile.java` — every field's default candidate(s) matches the old hard-coded parser path-for-path; `DefaultFieldMappingProfileTest` asserts this field by field | Full pre-existing backend suite (1078 tests) passes unchanged after the refactor — zero behavior drift for the default profile |
| CFM-5 | Journey Name — audited, found genuinely absent, added as a new canonical field distinct from Journey ID, no invented default mapping | `VERIFIED` | `CanonicalField.JOURNEY_NAME`; wired through `CanonicalLogEvent`, `EventDto`, `EventMapper`, `SearchRequest`/`SearchRequestDto`/`RequestMapper` (plain filter field, deliberately NOT added to the narrower `JOURNEY_FIELDS` "Find this…" correlation-click set), `EventFilters`, `QueryFields` (`journeyname` DSL alias) | `docs/verification/CONFIGURABLE_FIELD_MAPPING_REPORT.md` §4. `JOURNEY_NAME_CANONICAL_DECISION=ADDED_AS_NEW_DISTINCT_FIELD_NO_DEFAULT_MAPPING_YET` — owner input on a real default path still pending |
| CFM-6 | Search readiness gate — Search structurally blocked (never silent zero results) while a mapping edit is unvalidated/unsaved | `VERIFIED` | Backend: `FieldMappingProfileService.isSearchReady()`, `SearchService.rejectIfMappingNotReady()` → `GuardrailViolationException.Reason.MAPPING_NOT_READY` (HTTP 400). Frontend: `Toolbar.tsx` disables Search proactively and shows the identical message, re-enabling automatically (no reload) once a save succeeds | `FieldMappingReadinessGateTest` (5), `FieldMappingSettingsControllerIntegrationTest` (7), `Toolbar.test.tsx` (+5) |
| CFM-7 | Mapping cannot bypass masking — filtering/masking remain entirely downstream of, and blind to, which JSON path supplied a value | `VERIFIED` | `core.search.EventFilters`/`core.mask.MaskingService` both read `CanonicalLogEvent.sensitive()` only — untouched by this mission; `CifFilteringRegressionTest.maskingStillAppliesRegardlessOfWhichPathSuppliedTheValue_mappingCannotBypassMasking` | `MAPPING_CANNOT_BYPASS_MASKING=YES` — structural, not a bolted-on check |
| CFM-8 | "Raw JSON" mislabeling corrected — truthful terminology split between Log Explorer's own normalized representation and the genuinely original source event | `VERIFIED` | `frontend/src/features/inspector/AllFieldsSection.tsx` — disclosure renamed "Raw JSON" → **"Canonical Event JSON"**; the Field Mapping panel's own sample view is separately, correctly labeled **"Original Source JSON"** | `RAW_JSON_LABEL_CORRECTED=YES`. Both `USER_GUIDE_EN/AR.md` updated to explain the distinction (§19) |
| CFM-9 | Security review — original samples/validation values never logged, bounded, never bypass masking, no code execution from a user-supplied path | `VERIFIED` | `FieldMappingSettingsLeakTest` (3 tests, real Logback capture at the same DEBUG ceiling `LogLeakTest` already established) | **Genuine finding surfaced and fixed during this verification** (not merely confirmed): Spring's own codec logging (`org.springframework.core.codec`, and the shared `org.springframework.web.HttpLogging` marker logger) logs raw pre-parse request/response body bytes at DEBUG, truncated — independent of any DTO's redacted `toString()`. The pre-existing `LogLeakTest` never caught this because its own sentinel values happened to sit past the truncation point in that test's specific request shape; this mission's shorter-bodied endpoints are not. Fixed by pinning both logger categories to `INFO` in `backend/src/main/resources/application.yml`, the same discipline already applied to `reactor.netty`/`io.netty` — a real, narrowly-scoped fix, not a logging redesign. `MAPPING_SECURITY_REVIEW=PASS` |
| CFM-10 | Unknown-field preservation — configurable mapping does not delete unknown source data | `VERIFIED` | `LogLineParser`'s "known keys" for `unknownTopLevelFields`/`unknownMdcFields` are now derived dynamically from the ACTIVE profile's own flat top-level/`mdc.<key>` candidate paths (never a stale hard-coded constant set), so unknown-field display never drifts out of sync with a changed mapping | Existing `LogLineParserTest` unknown-field-preservation tests pass unchanged |

**Configurable Log Field Mapping pass (this section).** Backend:
1180/1180 tests pass (1078 pre-existing + 102 new — the mapping engine,
the owner-reported filtering regression fixed end to end, sample fetch,
the readiness gate, and the security leak test that found and closed a
real, narrowly-scoped logging gap). Frontend: 910/910 tests pass (871
pre-existing + 39 new), typecheck clean, production build succeeds. Full
method, evidence, and security re-validation:
`docs/verification/CONFIGURABLE_FIELD_MAPPING_REPORT.md`.
`HISTORICAL_DECISIONS_PRESERVED=YES`. `UNTRACKED_OWNER_REQUIREMENTS=0`.

**Gate recorded here for the next mission to read:** the built-in default
mapping profile is deliberately unchanged from the OLD hard-coded parser
— per the owner's own explicit instruction (mission §11), no new default
candidate paths (e.g. a top-level `cif` fallback) were added speculatively.
**The owner's confirmed, correct default mappings — based on real source
JSON the owner supplies — remain an open input this project is waiting
on.** Journey Name in particular has zero default mapping today. A future
mission should not treat the current default profile as "the fix" in
isolation — the fix is the *mechanism*; the owner's own environment still
needs its real field paths configured (or confirmed as defaults) via the
Log Schema & Field Mapping settings screen this mission built.

---

## 20. Field Mapping Schema Scan + Masking Policy Extension

`FIELD_MAPPING_SCHEMA_SCAN_AND_MASKING_POLICY_EXTENSION` mission — two
owner clarifications received after section 19's mapping engine shipped,
implemented on the SAME branch (`feature/configurable-log-field-mapping`)
and SAME PR (#55), never merged into `ux/v2-professional-redesign` (PR
#54, untouched). Part A extends mapping *setup* (discovery); Part B is a
standing security-policy default change, independent of Part A.

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| SSMP-1 | Quick Schema Scan — bounded, severity- and structure-diverse source scan producing a "Discovered Source Schema" path union (occurrence count/coverage %, observed type(s)), distinct from a bounded set of real, unmodified "Original Event Samples" | `VERIFIED` | New backend package `backend/src/main/java/com/logexplorer/core/mapping/scan/` (`SchemaScanService`, `SchemaScanBounds`, `JsonSchemaWalker`, `StructuralSignature`, `DiscoveredPathEntry`, `OriginalEventSample`, `SchemaScanResult`); new endpoint `POST /api/v1/sources/{sourceId}/field-mapping/schema-scan` (`FieldMappingSchemaScanController`, `SchemaScanResponseDto`); frontend `features/settings/fieldMapping/FieldMappingSettingsPanel.tsx` rebuilt around the scan (Original Event Samples + Discovered Source Schema table replace the old bare sample list; `discoverPaths.ts` client-side path discovery removed as superseded/dead code now that the backend computes the richer union) | `core.mapping.JsonPath` has no array-index syntax, so `JsonSchemaWalker` treats a JSON array as one leaf value (type `ARRAY`) rather than descending into elements — every path this scan reports is guaranteed directly usable as a real mapping candidate. `STRUCTURAL_VARIANT_DETECTION` uses a deterministic bounded structural signature (the sorted, deduplicated set of an event's own discovered paths, bounded to `MAX_PATHS_PER_EVENT`), not an opaque hash — inspectable, not just deterministic. Coverage percentage is computed against ALL events inspected (not just the successfully-parsed subset), a deliberately conservative choice so a source with malformed events never shows an inflated percentage — see the class's own javadoc for this explicit judgment call |
| SSMP-2 | Explicit, documented, bounded scan limits — reviewed and deliberately widened beyond the existing sample-fetch limits for this broader discovery purpose | `VERIFIED` | `SchemaScanBounds`: `DEFAULT_MAX_EVENTS_INSPECTED=200` (ceiling `500`), `MAX_BYTES_INSPECTED=2_000_000` (2 MB), `MAX_SCAN_DURATION=5s`, `MAX_REPRESENTATIVE_EVENTS=20`, `MAX_WALK_DEPTH=8`, `MAX_PATHS_PER_EVENT=300` | A scan may legitimately *inspect* more events (up to 200/500) than it *retains* as raw representative samples (capped at 20, tighter than `FieldMappingSampleService`'s own `MAX_LIMIT=50`) — occurrence/coverage statistics accumulate over every inspected event, while only one deduplicated (severity + structural-signature) sample per distinct shape is ever held as raw text. `SchemaScanServiceTest` proves each bound independently, including a deterministic (fake-`Clock`-driven, no real sleeping) duration-bound test and a byte-bound test |
| SSMP-3 | Rescan safety — a rescan never silently overwrites the saved field-mapping profile; surfaces newly-discovered/disappeared paths and saved-but-now-unobserved mapped paths | `VERIFIED` | `SchemaScanService.scan()` is read-only — it only reads `FieldMappingProfileService.activeProfile()` for the `mappedPathsNotObserved` cross-reference field on its response, never calls `updateCandidates`/`confirmSave`/`resetToDefault`; `SchemaScanServiceTest.rescanningNeverMutatesTheSavedFieldMappingProfile` proves the active profile object identity and search-readiness are both unchanged across two scans. The newly-discovered/disappeared-path diff itself is computed **client-side** in `FieldMappingSettingsPanel.tsx` (the previous scan's own discovered paths, held only in a `useRef`, diffed against the new scan) — the same "frontend is the only place ephemeral scan state is held across calls" precedent CFM-2's sample service already established; the backend stays fully stateless | `frontend/e2e/phase-n-schema-scan-field-mapping.spec.ts` — real browser, real backend, real `fixture` source: "rescan highlights newly discovered and no-longer-observed paths without silently changing the saved mapping" |
| SSMP-4 | Discovered-paths picker for mapping setup — a canonical field's candidate paths can be selected directly from what the scan discovered, not only typed; manual entry retained as an explicit advanced fallback | `VERIFIED` | `FieldMappingSettingsPanel.tsx`'s `FieldEditorRow` — a `<select>` populated from the current scan's `discoveredSchema` (excluding paths already mapped for that field), plus a collapsed `<details>`/`<summary>` "Advanced: enter a path manually" section preserving the original free-text input | `FieldMappingSettingsPanel.test.tsx` ("the discovered-paths picker offers scanned paths as candidate options...", "manual advanced path entry still works as a fallback"); `phase-n-schema-scan-field-mapping.spec.ts` ("the discovered-paths picker lets a user map a canonical field without typing, and the mapping validates and saves") — real browser, picks whichever real path the picker actually offers, never a hardcoded guess |
| SSMP-5 | Terminology discipline — "Original Event Samples" (real, unmodified source events) vs. "Discovered Source Schema" (the generated path union) kept strictly distinct; the union is never labeled "Original JSON"; the schema is always presented as observed, never complete/guaranteed | `VERIFIED` | UI copy in `FieldMappingSettingsPanel.tsx`: scan stats read "This is the **observed** schema from this scan, not a guaranteed-complete one — a source may still emit shapes this scan didn't happen to see"; sample selector reads "representative Original Event Sample(s)"; schema section reads "Discovered Source Schema" / "The observed union of JSON paths seen across this scan — not the original event content" | `FieldMappingSettingsPanel.test.tsx` (`'lists the Discovered Source Schema union from the scan, labeled as observed metadata, never "Original JSON"'`); `SchemaScanServiceTest.theDiscoveredSchemaUnionIsMetadataOnly_neverRawEventContent` |
| SSMP-6 | **Owner clarification — fresh/default installation masking state changed to DISABLED for all five protected fields** (CIF, Username, Customer ID, Device ID, Device IP); explicitly supersedes the "default masked" half of PCFR-3 (CLAUDE.md §5 named-conflict discipline) | `VERIFIED` | `backend/src/main/java/com/logexplorer/core/mask/MaskingPolicyService.java` — `isMasked()`'s `getOrDefault` and `resetToDefaults()` both flipped from `Boolean.TRUE` to `Boolean.FALSE`; the class's javadoc carries an explicit "SUPERSEDES" statement plus the original "Historical (SUPERSEDED)" block preserved **verbatim**, never deleted, plus a "What has NOT changed" section and a "Migration note (mission §B1)" | PCFR-3's row above carries the forward cross-reference; this row is the authoritative record of the change itself. A user may still explicitly enable masking per field from the same global Privacy & Masking settings screen PCFR-2/PCFR-3 already built — no UI/API surface changed, only the starting value |
| SSMP-7 | Migration rule (§B1) — an existing user's stored masking preferences are never silently overwritten by this default change; applies to fresh/default state only | `VERIFIED` | `MaskingPolicyService`'s own javadoc "Migration note" — this service (like `FieldMappingProfileService` and `OpenShiftProxyConfigService`) is deliberately in-memory-only with no disk persistence, so "fresh install" and "any backend restart" are architecturally identical states; the actual guarantee is that only an explicit `setMasked()` call (a real user action through the settings UI) ever changes the policy, never a background/unrelated code path | `MappingMaskingInteractionTest.anExplicitlySetMaskingPreferenceIsNeverSilentlyResetByAnUnrelatedOperation` — simulates a realistic sequence of unrelated mapping operations around an explicit masking choice and proves it survives all of them |
| SSMP-8 | Architecture intact — masking-off-by-default does not weaken the masking boundary; sensitive classification, server-side enforcement, and mapping/masking independence are all unchanged | `VERIFIED` | `MappingMaskingInteractionTest` (10 tests: CIF mapped from top-level `cif`/`cifId`/`mdc.cif`/nested `customer.cif` all still obey only the CIF toggle regardless of source path; masking state never affects filter correctness — `EventFilters` reads the raw `CanonicalLogEvent.sensitive()` before `EventMapper` ever calls `MaskingService`; a mapping edit/reset never resets masking policy, and vice versa); `SerializationLeakTest.withTheFreshDefaultPolicy_sensitiveValuesAreVisibleByOwnerDesign_notALeak` (proves the new unmasked-by-default state is an intentional owner-approved policy, not an accidental leak, by asserting it against a genuinely fresh policy object rather than weakening the existing masked-policy leak tests) | `MAPPING_CANNOT_BYPASS_MASKING` (CFM-7) and `onlyMaskingServiceMayTouchRawSensitiveFields` (ArchUnit, PCFR-3) both remain unchanged and re-verified passing. No per-row reveal shortcut was added anywhere |
| SSMP-9 | Full regression re-verified after both parts | `VERIFIED` | Backend: 1227/1227 tests pass (1204 pre-existing this branch + 23 new — `SchemaScanServiceTest` 20, `FieldMappingSchemaScanControllerIntegrationTest` 3). Frontend: 899/899 unit tests pass, typecheck clean, production build succeeds. E2E: `phase-n-schema-scan-field-mapping.spec.ts` (4 new tests, real browser + real `fixture`-profile backend) plus the 5 pre-existing masking-adjacent specs updated for the new unmasked default (`phase-m-ux-acceptance.spec.ts`, `ux-r4-results-workstation.spec.ts`, `ux-r5-inspector-context.spec.ts`, `ux-r6-final-polish.spec.ts`, `phase-j-live-tail.spec.ts`, each now explicitly enabling the masking it needs before asserting and disabling it again afterward — the established shared-singleton-backend-state E2E discipline) | See `docs/verification/` for this mission's own report once filed. `DESIGN_BRANCH_TOUCHED=NO`, `PR54_TOUCHED=NO` — re-verified: `ux/v2-professional-redesign` and PR #54 SHA unchanged throughout |

**Field Mapping Schema Scan + Masking Policy Extension pass (this
section).** Part A gives mapping setup a real discovery step ahead of
manual configuration — a Quick Schema Scan that surfaces the broadest
useful observed shape of a source's JSON, backed by bounded, documented
limits, safe rescanning, and a picker that removes the need to hand-type
every candidate path. Part B is a standing security-default change: a
fresh Log Explorer installation now starts with every protected field
UNMASKED, on explicit, recorded owner instruction — the full masking
*architecture* (server-side enforcement, per-field configurability, no
reveal action, mapping/masking independence) is completely unchanged;
only the starting value moved. The prior masked-by-default decision
(PCFR-3) is preserved above, not erased, and explicitly marked
superseded. `HISTORICAL_DECISIONS_PRESERVED=YES`.
`UNTRACKED_OWNER_REQUIREMENTS=0`. `MERGE_AUTHORIZED=NO` — owner review of
PR #55 required before merge.

---

## 21. Project-Scoped Schema Scan

`PROJECT_SCOPED_SCHEMA_SCAN` mission — owner clarification received after
section 20 shipped: the Quick Schema Scan and its saved field-mapping
profile must never operate on "a whole source" indiscriminately — both
must be scoped to the exact logical project/namespace/workload the
investigator selected, on the SAME branch
(`feature/configurable-log-field-mapping`) and SAME PR (#55), never
merged into `ux/v2-professional-redesign` (PR #54, untouched).

**Named conflict, applied per CLAUDE.md §5:** SSMP-1's original
description ("malformed events... excluded from the schema union") is
refined by this section — a malformed/non-JSON event was still eligible
to become a `representativeEvents` entry in section 20's design (only
excluded from `discoveredSchema` itself). This mission tightens that:
malformed/non-JSON events now belong to their own, separate, diagnostics-
only list (`diagnosticNonJsonSamples`) and can never appear in
`representativeEvents` at all (mission §5, PSSS-4 below) — SSMP-1's core
claim (never pollutes the schema union) remains true and unchanged; only
the representative-sample eligibility rule tightened.

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| PSSS-1 | Explicit scan scope — the backend scan request carries/resolves the selected project/workload scope explicitly; never a silent whole-source scan | `VERIFIED` | `core.mapping.MappingScopeKey` (new, `(sourceId, scopeId)` value object, `UNSCOPED`/`UNSPECIFIED` sentinels); `LogSource#resolveMappingScopeLabel(SearchRequest)` (new default interface method — echoes `composeProject` for a request-scoped source, overridden by `OpenShiftLogSource` to defer to the session's own `selectedProject()` instead); `SchemaScanService.scan(sourceId, composeProject, maxEvents)` (new `composeProject` parameter, threaded onto the built `SearchRequest` exactly like a normal search); `FieldMappingSchemaScanController` accepts a new `project` query parameter | `SchemaScanServiceTest.theScanRequestCarriesTheExplicitlySelectedProjectScope`; `FieldMappingSchemaScanControllerIntegrationTest.theProjectQueryParamScopesTheScanAndIsEchoedBackAsTheScopeLabel` |
| PSSS-2 | Docker project scope — scanning a selected Compose project inspects only that project's own containers/events; other projects are never mixed in | `VERIFIED` | `source.docker.DockerLogSource`'s existing `relevantContainers` filtering (pre-existing, unchanged) already enforces this for real search; `emitFollowedLine`/`searchBlocking` now additionally resolve each event's own `MappingScopeKey` from that CONTAINER's real Compose-project label (`ComposeLabels.project(labels)`), not the request's filter value alone — so even an unfiltered ("all projects") search correctly attributes each event to its own real project's mapping profile, never one global profile | `DockerLogSourceTest.eachContainersOwnRealComposeProjectDrivesWhichFieldMappingProfileParsesItsEvents` (a saved mapping edit for project-a's own scope applies ONLY to project-a's events, even when project-b's events are read in the same unfiltered search); `SchemaScanServiceTest.twoDockerComposeProjectsWithDifferentSchemasDoNotMix`/`.representativeEventsBelongOnlyToTheSelectedScope`; ad hoc real-Docker verification against this sandbox's own live Docker daemon (`POST .../local-docker/field-mapping/schema-scan?project=sofra` returned a real, correctly-scoped result) — see NOTES below on why this is not a committed CI test |
| PSSS-3 | OpenShift project/namespace scope — scanning uses only the selected project/namespace; namespaces are never mixed | `VERIFIED` | `OpenShiftLogSource#resolveMappingScopeLabel` always defers to `OpenShiftSession#selectedProject()` — server-side session truth, ignoring any client-supplied value entirely (mirrors the pre-existing "session is authoritative, never the request" contract `DirectPodLogProvider`/`OpenShiftLiveTailProvider` already had for real target resolution); both providers now also resolve each parsed event's own `MappingScopeKey` from the real per-target `namespace`, not a single fixed value | `OpenShiftLogSourceTest` (2 tests: resolves the session's real selected project, ignoring a client-supplied `composeProject`; no connection resolves a null scope); `SchemaScanServiceTest.twoOpenShiftNamespacesDoNotMix` (simulated session-scope switch via `StubLogSource#withResolveMappingScopeLabelFn`) |
| PSSS-4 | Structured vs. noise classification — every scanned event is classified `STRUCTURED_JSON_APPLICATION_EVENT` or `NON_JSON_OR_MALFORMED_EVENT`; only structured events reach the Discovered Source Schema or become a representative mapping sample; non-JSON/infrastructure lines are diagnostics-only and can never become "the" representative sample | `VERIFIED` | `core.mapping.scan.EventClassification` (new enum); `SchemaScanResult`/`SchemaScanResponseDto` now carry TWO separate sample lists — `representativeEvents` (structured only) and `diagnosticNonJsonSamples` (non-JSON/malformed only, capped at `SchemaScanBounds.MAX_DIAGNOSTIC_NON_JSON_SAMPLES=5`) — never merged | `SchemaScanServiceTest.nonJsonLinesNeverBecomeTheRepresentativeMappingSample_onlyDiagnostics`, `.nonJsonMalformedLinesNeverAddFieldsToTheDiscoveredSchema`, `.structuredAndNonJsonLinesInTheSameProjectAreClassifiedAndSeparated`; `FieldMappingSettingsPanel.test.tsx` ("never lets a diagnostic non-JSON sample become a representative mapping sample") |
| PSSS-5 | Service diversity within the selected project — services observed strictly inside the selected project, never crossing project boundaries | `VERIFIED` | `SchemaScanResult#servicesObserved` — the distinct, sorted set of `CanonicalLogEvent#service()` values among structured events only, accumulated per-scan (naturally bounded to the selected scope, since the scan never reads outside it) | `SchemaScanServiceTest.multipleServicesInsideTheSameProjectAreAllIncluded` |
| PSSS-6 | Scan summary — selected scope, services observed, events inspected, structured/non-JSON counts, structural variants, discovered paths, all shown clearly | `VERIFIED` | `FieldMappingSettingsPanel.tsx` scan-stats section: "Selected scope: X. Services observed: a, b, c." / "Observed N events (M structured JSON, K non-JSON/malformed excluded..., V structural variants)." | `FieldMappingSettingsPanel.test.tsx` ("shows the selected scope and services observed in the scan summary"); `phase-n-schema-scan-field-mapping.spec.ts` ("the scan summary reports the selected scope truthfully for a source with no project concept") — real browser |
| PSSS-7 | Project-scoped mapping profile — profiles are associated with `(source, project/namespace)`, never one global mapping forced across unrelated projects | `VERIFIED` | `FieldMappingProfileService` rewritten from a single `AtomicReference<FieldMappingProfile>` to a `ConcurrentHashMap<MappingScopeKey, ScopeState>` — every method (`activeProfile`, `updateCandidates`, `confirmSave`, `resetToDefault`, `isModifiedFromDefault`, `isSearchReady`) now takes a `MappingScopeKey`; no-arg convenience overloads kept, operating on `MappingScopeKey.UNSPECIFIED` only, for the ~15 pre-existing unit tests that exercise mapping mechanics independent of scoping (never used by real production traffic); `FieldMappingSettingsController`'s five endpoints (`GET`/`PUT fields/{field}`/`POST reset`/`POST validate`/`POST save`) all accept optional `sourceId`/`project` query params, resolved via the new `core.mapping.MappingScopeResolver` (defers to `LogSource#resolveMappingScopeLabel`, never a bare client-trusted label) | `FieldMappingProfileServiceTest` (+5 scope-isolation tests); `FieldMappingSettingsControllerIntegrationTest` (+2: scope params echoed back and isolate correctly; omitting both falls back to the legacy scope); `SchemaScanServiceTest.mappingSavedForProjectAIsNotSilentlyReusedForProjectB`/`.mappedPathsNotObservedIsCrossReferencedAgainstTheScannedScopeOwnProfile_notAnotherScope` |
| PSSS-8 | Search readiness recalculates on project/namespace change; never silently reuses another project's readiness | `VERIFIED` | `api.SearchService#resolveScopeKey` (new) resolves the request's real `MappingScopeKey` (source resolution moved ahead of the readiness check — a deliberate, named-conflict reordering of the old "before the source is even resolved" comment, needed so an OpenShift-style source's session scope can be read) and gates on `isSearchReady(scope)`, not a global flag; frontend `useSearchState#refreshFieldMappingProfile` now scopes to `(selectedSourceId, selectedComposeProject)` and re-fires on either changing; `App.tsx` additionally re-fires it with the resolved OpenShift project whenever `useOpenShiftScopeSummary`'s own scope changes (that hook is lifted above `useSearchState` and owns no field-mapping knowledge of its own) | `FieldMappingReadinessGateTest` (rewritten to resolve real per-source scope, +1 new cross-project-isolation test); `SchemaScanServiceTest.projectChangeChangesActiveMappingAndReadiness` |
| PSSS-9 | Full regression re-verified after this mission | `VERIFIED` | Backend: 1257/1257 tests pass (1227 pre-existing this branch + 30 new — `MappingScopeKeyTest` 7, `OpenShiftLogSourceTest` 2, `FieldMappingProfileServiceTest` +5, `FieldMappingReadinessGateTest` +1, `SchemaScanServiceTest` +9 net, `FieldMappingSettingsControllerIntegrationTest` +2, `FieldMappingSchemaScanControllerIntegrationTest` +1, `DockerLogSourceTest` +1, plus fixes to 2 pre-existing frontend network-mock tests whose fetch stubs used a now-too-strict `endsWith` match against a URL that legitimately grew query params). Frontend: 901/901 unit tests pass, typecheck clean, production build succeeds. E2E: `phase-n-schema-scan-field-mapping.spec.ts` re-verified (5 tests, one new: scope-truthfulness for an unscoped source) against the real backend `fixture` source | `DESIGN_BRANCH_TOUCHED=NO`, `PR54_TOUCHED=NO` — re-verified: `ux/v2-professional-redesign` and PR #54 SHA unchanged throughout |

**Deferred/blocked, named explicitly (CLAUDE.md §3):** a real, committed
CI end-to-end test proving "two Docker Compose projects on a live daemon
never mix" was **not** added — this sandbox's own Docker daemon happens
to have exactly one real, unrelated Compose project (`sofra`) running,
which is incidental host state, not a portable fixture; a permanent test
hardcoded to it would fail in CI or any other environment. The ad hoc
manual verification against it (recorded under PSSS-2 above) confirms the
real wiring works end to end, but the durable, portable proof of Docker/
OpenShift project isolation is the mocked-adapter-level tests
(`DockerLogSourceTest`, `SchemaScanServiceTest`'s simulated-adapter tests,
`OpenShiftLogSourceTest`) — exactly the same "real live-cluster
verification is BLOCKED, mocked-adapter verification is the durable
evidence" pattern this project's earlier OpenShift missions already
established.

**Project-Scoped Schema Scan pass (this section).** The Quick Schema Scan
and the field-mapping profile it feeds are now both scoped to the exact
project/namespace the investigator selected — never an indiscriminate
whole-source scan, never one mapping silently shared across unrelated
projects. `PROJECT_SCOPED_SCHEMA_SCAN=PASS`, `DOCKER_PROJECT_ISOLATION=PASS`,
`OPENSHIFT_NAMESPACE_ISOLATION=PASS`, `CROSS_PROJECT_SCHEMA_MIXING=NO`,
`NON_JSON_NOISE_EXCLUDED_FROM_MAPPING_SCHEMA=YES`,
`PROJECT_SCOPED_MAPPING_PROFILE=PASS`,
`PROJECT_CHANGE_RECALCULATES_READINESS=YES`.
`HISTORICAL_DECISIONS_PRESERVED=YES`. `UNTRACKED_OWNER_REQUIREMENTS=0`.
`MERGE_AUTHORIZED=NO` — owner review of PR #55 required before merge.

---

## 22. Mapping Verification and Investigation Workspace

`MAPPING_VERIFICATION_AND_INVESTIGATION_WORKSPACE` mission — owner
clarification received after section 21 shipped, continuing on the SAME
branch (`feature/configurable-log-field-mapping`) and SAME PR (#55),
never merged into `ux/v2-professional-redesign` (PR #54, untouched). Two
independent parts building directly on sections 19–21's foundation: Part
A turns configurable mapping into a genuine **verification** workflow
(candidate ≠ verified); Part B restores and formalizes a dedicated
**Investigation Workspace** distinct from Search/Results and the
Inspector.

**Named conflicts, applied per CLAUDE.md §5 (later decision wins, earlier
rationale preserved, never deleted):**

1. **UX-R5 §15's "one name everywhere" decision is upheld, but the name
   itself changes.** UX-R5 §15 established that "Show surrounding logs"
   must be the one label used at every invocation site (row Actions menu,
   inspector header) rather than the "Show ±30 seconds" wording an
   earlier phase used in one place. This mission keeps that "one name
   everywhere" reasoning intact and renames the shared label to **"Show
   Surroundings"** (this mission's own explicit, exact required wording)
   — applied identically to every existing invocation site
   (`ActionsCell.tsx`'s row menu, `ContextAction.tsx`'s inspector header
   action) plus the new one this mission adds (`JourneyEntryRow.tsx`'s
   in-timeline action, which reuses `ContextAction` directly rather than
   a second implementation). UX-R5 §15's own rationale (recorded in
   section 16/17 above and in `ContextAction.tsx`'s own doc comment) is
   preserved verbatim alongside the supersession note, not deleted.
2. **IMPLEMENTATION_PLAN.md "Phase I" scope item 1's "never spanId" rule
   is superseded.** Phase I deliberately excluded `spanId` from the
   journey click-actions ("Find this trace / correlation / journey /
   event... never spanId, which has no 'Find this Span' action in the
   plan's own scope"). This mission adds **View Span** as a first-class
   fifth investigation action, reusing the exact same generic `/journey`
   endpoint (one-line backend extension — `spanId` added to the closed
   `JOURNEY_FIELDS` set — never a duplicate endpoint). The historical
   comment recording the old exclusion is updated in place to point at
   this section rather than silently left to assert something no longer
   true.
3. **The Log Schema & Field Mapping popover (`FieldMappingSettingsPanel`,
   sections 19–21's UI home) is retired in favor of a dedicated full page
   (`FieldMappingWorkspace`).** This mission's own explicit requirement:
   "a dedicated Settings page/workspace... not a hidden popover/
   implementation detail." All of sections 19–21's scan/candidate-editor/
   validate/save/reset mechanics move unchanged into the new component;
   only the verification layer (below) and the outer page/popover
   structure change. `Shell.tsx` keeps a same-styled trigger button
   (`state.openMappingWorkspace()`), now rendering the workspace as a
   mutually-exclusive `App.tsx` overlay — the exact same pattern
   `JourneyView`/`LiveTailPanel` already establish — rather than a
   `role="dialog"` popover. The five prior sections' `VERIFIED` rows
   remain `VERIFIED`: their underlying mechanics are unchanged, only
   relocated.

### Part A — Mapping Verification

**Core rule, restated as the mission's own required invariant:**
`DEFAULT_MAPPING != VERIFIED_MAPPING`. A canonical field's built-in
default candidate — or any candidate inherited from a prior mission —
never becomes `VERIFIED` merely by existing; it starts and stays
`UNVERIFIED` until an owner explicitly verifies it against real evidence.

**STATUS UPDATE (§24, SFDPDM-8) — this core rule is `SUPERSEDED` for the
built-in default profile only, preserved verbatim above as the historical
decision, not deleted.** The owner later explicitly approved a specific,
named default field-mapping table (§24) as authoritative, product-level
configuration — its own approval IS the evidence, so every field on that
approved table now starts `VERIFIED` on a fresh profile, with no scan/
edit/save/verify cycle required. This applies ONLY to the built-in
default's own candidates; every other guarantee this section records is
unchanged and still fully in force: a USER-EDITED or otherwise non-default
candidate still starts/reverts to `UNVERIFIED` and still requires real
evidence to become `VERIFIED` (MVER-2/MVER-4 below, unchanged), `NEEDS_CHANGE`
is still explicit and never inferred (MVER-3, unchanged), and verification
status is still fully scope-isolated (MVER-5, unchanged). See §24 for the
full new rule and its own regression evidence.

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| MVER-1 | Exactly three verification statuses — `UNVERIFIED` / `VERIFIED` / `NEEDS_CHANGE`, no invented extra complexity; every field (including the built-in default) starts `UNVERIFIED` | `VERIFIED` — **"every field including the built-in default starts UNVERIFIED" half `SUPERSEDED`, see SFDPDM-8 (§24)**; the three-status enum itself is unaffected and remains `VERIFIED` | New backend enum `core.mapping.FieldVerificationStatus`; `FieldMappingProfileService`'s per-scope `ScopeState` gained `ConcurrentHashMap<CanonicalField, FieldVerificationStatus> verificationStatuses`, freshly initialized to `UNVERIFIED` for every field on scope creation; `FieldMappingProfileDto.CanonicalFieldMappingDto` gained a `verificationStatus` string; frontend `CanonicalFieldMapping.verificationStatus: FieldVerificationStatus` (`'UNVERIFIED' \| 'VERIFIED' \| 'NEEDS_CHANGE'`) | `FieldMappingProfileServiceTest.everyFieldStartsUnverified_evenTheBuiltInDefault`; `FieldMappingSettingsControllerIntegrationTest.aFreshFieldStartsUnverifiedEvenOnTheBuiltInDefault`; `FieldMappingWorkspace.test.tsx` ("every field starts UNVERIFIED, even a built-in default candidate - DEFAULT_MAPPING != VERIFIED_MAPPING") |
| MVER-2 | Verify is evidence-gated server-side — re-validates the field's CURRENT (saved) candidate against caller-supplied real samples using the same `FieldMappingValidationService` `/validate` already uses (never a duplicate check); rejects with 400 if unmapped or not found in any sample, never silently marks verified | `VERIFIED` | New endpoint `POST /api/v1/settings/field-mapping/fields/{field}/verify` (`FieldMappingSettingsController#verifyField`); new DTO `FieldMappingVerifyRequestDto(samples)`; new frontend client fn `verifyFieldMapping` | `FieldMappingSettingsControllerIntegrationTest.verifyingWithRealEvidenceSucceedsAndPersistsTheStatus`, `.verifyingWithoutEvidenceIsRejected_neverSilentlyMarkedVerified`, `.verifyingAnUnmappedFieldIsRejected`; `FieldMappingWorkspace.test.tsx` ("a successful Verify calls the real endpoint...", "a rejected Verify (no evidence found) shows the real server reason, never a silent 'verified'"); `frontend/e2e/phase-n-schema-scan-field-mapping.spec.ts` ("the built-in default mapping starts Unverified, and Verify against real evidence marks it Verified") — real browser, real backend, real `fixture` source |
| MVER-3 | `NEEDS_CHANGE` is an explicit, no-evidence-required owner flag — never inferred, never silently promoted back to `VERIFIED` by a later save alone | `VERIFIED` | New endpoint `POST /api/v1/settings/field-mapping/fields/{field}/needs-change` (`FieldMappingSettingsController#markFieldNeedsChange`); `FieldMappingProfileService#markNeedsChange`; frontend `markFieldMappingNeedsChange` client fn, `FieldMappingWorkspace`'s "Mark needs change" button (hidden once already in that state, so it is never fired redundantly) | `FieldMappingProfileServiceTest.markVerifiedAndMarkNeedsChangeSetTheExpectedStatus`; `FieldMappingSettingsControllerIntegrationTest.markingNeedsChangeSetsTheStatusWithNoEvidenceRequired`; `FieldMappingWorkspace.test.tsx` ("Mark needs change calls the real endpoint...", "hides the 'Mark needs change' action for a field already in that state"); `frontend/e2e/phase-n-schema-scan-field-mapping.spec.ts` ("Mark needs change flags a field explicitly, and editing its candidate never silently promotes it back to Verified") |
| MVER-4 | Editing a `VERIFIED` field's candidates reverts it to `UNVERIFIED` (never a silent keep); editing a `NEEDS_CHANGE` field leaves it `NEEDS_CHANGE` (not silently promoted to `VERIFIED` by the edit/save itself — a later, separate Verify remains required); a whole-profile reset clears every field's status back to `UNVERIFIED` | `VERIFIED` | `FieldMappingProfileService#updateCandidates` — reverts `VERIFIED`→`UNVERIFIED` on any candidate edit via `computeIfPresent`, leaves any other status untouched; `#resetToDefault` also resets every field's verification status | `FieldMappingProfileServiceTest.editingAVerifiedFieldsCandidatesRevertsItToUnverified`, `.editingANeedsChangeFieldsCandidatesDoesNotSilentlyPromoteItToVerified`, `.resettingTheProfileResetsEveryFieldsVerificationStatusToo`; `FieldMappingSettingsControllerIntegrationTest.editingAVerifiedFieldRevertsItToUnverified_viaTheRealHttpEndpoints` |
| MVER-5 | Verification status is scoped identically to the mapping profile itself (same `MappingScopeKey`) — Docker: Compose-project-scoped; OpenShift: session-authoritative selected namespace/project-scoped; changing project/namespace reloads the correct statuses, never reuses another project's silently | `VERIFIED` | `verificationStatuses` lives inside the SAME per-scope `ScopeState` the candidates themselves live in — one map, one scope key, no separate scoping mechanism to drift out of sync; `FieldMappingWorkspace`'s `useEffect` on `[sourceId, project]` clears all local scan/draft/verify-error state on scope change (mirroring PSSS-7/PSSS-8's existing profile-reload discipline, unchanged) | `FieldMappingProfileServiceTest.verificationStatusIsFullyScopedAcrossProjects`; `FieldMappingSettingsControllerIntegrationTest.verificationStatusIsProjectScoped_neverLeaksAcrossProjects` |
| MVER-6 | The Mapping Verification workspace is a real, dedicated full page — `FieldMappingWorkspace.tsx` — not a hidden popover; a mutually-exclusive `App.tsx` overlay slot (same pattern as `JourneyView`/`LiveTailPanel`), reached via a `Shell.tsx` trigger button (`state.openMappingWorkspace()`) | `VERIFIED` | New `useSearchState` state: `mappingWorkspaceOpen`/`openMappingWorkspace`/`closeMappingWorkspace`; `App.tsx` renders `<FieldMappingWorkspace>` (lazy-loaded, code-split — confirmed by its own production build chunk) with top priority in the main-slot conditional when open; old `FieldMappingSettingsPanel.tsx`/`.module.css`/its test file deleted, fully superseded | `FieldMappingWorkspace.test.tsx` ("is a real dedicated page, not a popover..."); `Shell.test.tsx` ("offers a trigger that opens the real dedicated workspace, never a popover of its own"); `App.mappingWorkspace.test.tsx` (real `<App/>` integration: opens as a full-page overlay replacing the results workspace, closes back to it); `frontend/e2e/phase-n-schema-scan-field-mapping.spec.ts` updated end to end for the new page shape |
| MVER-7 | Per canonical field, the workspace shows: candidate path(s), whether each candidate was observed in the latest schema scan, verification status badge, Verify/Mark-needs-change actions, validation result, saved state | `VERIFIED` | `FieldMappingWorkspace.tsx`'s `FieldEditorRow`/`VerificationBadge` — `(observed in latest scan)`/`(not observed in latest scan)` note per candidate path (cross-referenced against the same scan's `discoveredSchema`, entirely client-side, no new backend endpoint needed); three visually AND textually distinct badges (never color alone, CLAUDE.md §7) | `FieldMappingWorkspace.test.tsx` ("marks a candidate path as observed or not observed in the latest scan", "shows a distinct VERIFIED/NEEDS_CHANGE badge...") |
| MVER-8 | Discovered-but-unmapped fields remain visible (carried forward from PSSS-4/SSMP-4/5, re-confirmed unchanged); non-JSON/malformed noise stays diagnostics-only, never offered as a mapping OR verification candidate | `VERIFIED` | Unchanged from section 20/21 — `diagnosticNonJsonSamples` never contributes to `discoveredSchema`; the picker in `FieldMappingWorkspace` only ever offers `discoveredSchema` paths | Re-verified passing: `SchemaScanServiceTest.nonJsonLinesNeverBecomeTheRepresentativeMappingSample_onlyDiagnostics` et al. (section 21), `FieldMappingWorkspace.test.tsx` ("lists the Discovered Source Schema union..., never 'Original JSON'") |
| MVER-9 | `SEARCH_READY` and `MAPPING_VERIFIED` are related but distinct concepts — a saved, technically-parseable default mapping can be `searchReady: true` while every field on it is still `UNVERIFIED` | `VERIFIED` | `FieldMappingProfileDto`'s own updated javadoc states this explicitly; `FieldMappingWorkspace.tsx`'s hint copy: "A saved mapping being search-ready is not the same as it being **verified**"; the two states are computed and stored completely independently (`isSearchReady(scope)` vs. `verificationStatus(scope, field)`) | `FieldMappingProfileServiceTest`/`FieldMappingSettingsControllerIntegrationTest` — every readiness test and every verification test exercises its own concept only, never conflated |
| MVER-10 | Full regression for Part A | `VERIFIED` | Backend: `FieldVerificationStatus`/`FieldMappingProfileService`/`FieldMappingSettingsController` changes — 18/18 `FieldMappingProfileServiceTest` pass (6 new), 17/17 `FieldMappingSettingsControllerIntegrationTest` pass (7 new). Frontend: `FieldMappingWorkspace.test.tsx` 25/25 new tests pass, typecheck clean, production build succeeds (`FieldMappingWorkspace` its own lazy chunk) | See §"Full regression" below for the combined Part A + Part B totals |

### Part B — Investigation Workspace

**Product split, restated as the mission's own required invariant:**
SEARCH/RESULTS finds events; INSPECTOR explains one selected event;
INVESTIGATION WORKSPACE investigates relationships/context across
multiple events. The Investigation Workspace is `JourneyView.tsx`
(unchanged component identity from IMPLEMENTATION_PLAN.md "Phase I" —
this mission extends it, never replaces it with something unrelated, per
the mission's own "restore the intended capability" instruction and the
precedent recorded in `legacy-app-docs/UX_SPEC.md` §Phase 6's
`EventTimeline.tsx`/root anchoring/gap markers, already `WORKING` per
`legacy-app-docs/audit/AUDIT-03-WORKFLOWS.md`).

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| INVW-1 | The one generic `/api/v1/logs/journey` endpoint now serves all five investigation relationships (journeyId/correlationId/traceId/spanId/eventId) — never a duplicate source-specific endpoint | `VERIFIED` | `RequestMapper.JOURNEY_FIELDS` extended `{journeyId, correlationId, traceId, eventId}` → `{..., spanId}`; `toJourneyDomain`'s switch gained `case "spanId"`; frontend `JourneyField` type/`journeyFields.ts` extended identically | `RequestMapperTest.spanIdFieldMapsToTheSpanIdFilterOnly`; `JourneyApiIntegrationTest.filtersByCorrelationTraceSpanAndEventIdToo` |
| INVW-2 | Five investigation entry actions with the mission's own exact required labels — "View Trace" / "View Span" / "Find same Correlation" / "Find same Journey" / "Find same Event" — available wherever the required identifier is present, never for a raw protected identifier | `VERIFIED` | New `journeyFields.ts` export `JOURNEY_ACTION_LABELS`; `RequestFlowSection.tsx`'s `JOURNEY_CLICKABLE_FIELDS` extended to include `spanId`; each action passes the launching event as the new optional root-event argument to `onOpenJourney`; `columnRegistry.tsx`'s Correlation/Trace cell button tooltip updated to the same labels and now also passes the root event | `journeyFields.test.ts` (`JOURNEY_ACTION_LABELS` exact-label test); `RequestFlowSection.test.tsx` ("lists all 5 identifiers... with an investigation action for each, including spanId", "'View Span' calls onOpenJourney with spanId and this event as root"); `ResultsTable.test.tsx` (root-event threading); real browser: `frontend/e2e/phase-investigation-workspace.spec.ts` ("View Span opens a real bounded span timeline...", "Find same Correlation opens a real bounded correlation timeline...") |
| INVW-3 | Root event anchoring — the event that launched Trace/Span/Correlation/Journey never visually disappears: highlighted (`aria-current="location"` + a "Selected event" text badge, never color alone), auto-scrolled into view, with an explicit "Selected event: N of M" position; if the root event is genuinely absent from a bounded result, an honest notice is shown — never a silently-substituted highlight on a different event | `VERIFIED` | New `useSearchState` state `journeyRootEvent` (captured at `openJourney(field, value, rootEvent)` call time); `JourneyEntryRow.tsx`'s `isRoot`/`rootRef`/`.rootEntry` (mirrors `ResultsTable`'s pre-existing `contextRootIdentity`/`.contextRootRow` pattern exactly — same `eventIdentity()` content-based matching, never a second, differently-behaved mechanism); `JourneyView.tsx` computes `rootIndex` via `eventIdentity`, renders "Selected event: N of M" or the honest not-found notice | `JourneyView.test.tsx` ("highlights the root event, shows its position...", "honestly reports when the root event is not present..."); `JourneyEntryRow.test.tsx` ("a root entry gets aria-current=\"location\" and a visible 'Selected event' badge..."); real browser: `phase-investigation-workspace.spec.ts` (position text + `[aria-current="location"]` both asserted against real fixture data for View Span and Find same Correlation) |
| INVW-4 | "Show Surroundings" is a separate concept from Trace/Span/Correlation/Journey — temporal/source-context only, exact required label, available in-timeline (from any Journey entry) as well as from Results/Inspector; never implies the nearby events caused the selected one | `VERIFIED` | `JourneyEntryRow.tsx` renders the SAME `ContextAction` component the Inspector header already uses (never a second, parallel confirm-and-run implementation) per entry, wired to `state.showContext`; label renamed everywhere per the named-conflict note above | `JourneyEntryRow.test.tsx`/`JourneyView.test.tsx` (Show-Surroundings wiring, omitted for a timestamp-less entry); real browser: `phase-investigation-workspace.spec.ts` ("Show Surroundings launched from inside a Trace view, then Back to Trace, restores that same trace timeline") |
| INVW-5 | Investigation navigation/continuity — Surroundings launched from WITHIN a Trace/Span/Correlation/Journey view returns to THAT same view ("Back to Trace"/"Back to Span"/"Back to Correlation"/"Back to Journey") on close, preserving the original search underneath throughout; the Back button's own label says where it is actually going, never a generic claim | `VERIFIED` | New `useSearchState` state `journeySnapshotForSurroundings` — a second, deliberately single-level snapshot layered on top of the pre-existing `originalSnapshot` mechanism (UX-R5 §16/§24-26); `showContext` snapshots-and-clears the active journey view before running; `restoreOriginalSearch` always restores the underlying plain-search state first, then branches — restores the journey snapshot (`closeJourney` remains the one true exit that clears everything, including `originalSnapshot`); new derived value `restoreOriginalSearchLabel` (`"Back to Trace"` etc. vs. `"Back to original search"`), surfaced in `ResultsPanel`'s `Breadcrumb` | `useSearchState.contextReturn.test.ts` (new describe block: "the Back label says 'Back to Trace' while inside a trace...", "Show Surroundings launched from within a Trace view, then Back, restores that same Trace view (root event included)", "a genuine 'Back to original search' after that restored Trace view still works", "never silently switches source..."); real browser: `phase-investigation-workspace.spec.ts` (the full nested flow, against the real backend) |
| INVW-6 | No silent source switch — every investigation mode queries only the currently active source | `VERIFIED` | `openJourney`/`showContext` both read `selectedSourceId` unconditionally, unchanged by this mission — no new source-selection code path was introduced anywhere in Part B | `useSearchState.contextReturn.test.ts.neverSilentlySwitchesSourceWhileResolvingSurroundingsLaunchedFromAJourneyView` |
| INVW-7 | No fabricated causality — "Same Trace"/"Same Span"/"Same Correlation"/"Same Journey" mean exactly that relationship; "Surroundings" means nearby actual source/time context; chronological order is stated as timestamp order, never proof of cause | `VERIFIED` | `JourneyView.tsx`'s pre-existing causality disclaimer (Legacy Remediation Slice 6, unchanged: "Ordered by timestamp — this does not indicate causality between events") now also governs the new root-anchored/position-indicator copy, which was written to describe position/order only, never cause; `ContextAction.tsx`'s existing "Nearby chronological evidence... not a cause" copy, unchanged, now also governs its new in-timeline invocation site | Re-verified passing: `JourneyView.test.tsx`'s pre-existing causality-disclaimer tests; no new UI string anywhere in this mission's diff contains "caused by"/"because of"/"root cause" (checked by hand across every new/changed `.tsx` file) |
| INVW-8 | Results workflow preservation — every row still inspectable, selected row still obvious, View Details/Show Surroundings still clear, sorting still truthful, no filter/column regression | `VERIFIED` | No behavioral change to `ResultsTable.tsx`'s selection/sort/column mechanics; `ActionsCell.tsx` only had its Show-Surroundings label renamed (behavior identical); `columnRegistry.tsx`'s Correlation/Trace cell gained a root-event argument and an updated tooltip, its click/filter behavior otherwise unchanged | Full pre-existing `ResultsTable.test.tsx`/`ActionsCell.test.tsx` suites re-verified passing unchanged (only the one test asserting the exact `onOpenJourney` call signature was updated for the new third argument); no filter/field was added, removed, or renamed |
| INVW-9 | Full regression for Part B | `VERIFIED` | Frontend: `useSearchState.contextReturn.test.ts` 16/16 (5 new), `JourneyView.test.tsx` 19/19 (7 new), `JourneyEntryRow.test.tsx` 11/11 (6 new), `journeyFields.test.ts` 6/6 (2 new), `RequestFlowSection.test.tsx` 9/9 (3 new), `ResultsTable.test.tsx`/`ContextAction.test.tsx`/`ActionsCell.test.tsx` re-verified passing with updated labels/signatures. Backend: `RequestMapperTest` 16/16 (1 new), `JourneyApiIntegrationTest` 8/8 (extended, not net-new). E2E (real backend, real `fixture` source): `phase-i-journey-investigation.spec.ts` (13/13, 1 label fix), `phase-investigation-workspace.spec.ts` (new file, 3/3), plus 6 more pre-existing specs touched only for the "Show Surroundings" rename, all re-verified passing (157 tests total across those 6 files) | See §"Full regression" below for the combined Part A + Part B totals |

**Full regression (both parts, this mission's own diff).** Backend:
1277/1277 tests pass (full `./mvnw test`, 0 failures/errors/skipped —
`FieldVerificationStatus`/`FieldMappingProfileService`/
`FieldMappingSettingsController`/`RequestMapper`/`JourneyApiIntegrationTest`
changes all included). Frontend: 922/922 unit tests pass (901 pre-existing
this branch, net +21 after the new/updated test counts above and the
deletion of `FieldMappingSettingsPanel.test.tsx`, fully superseded by
`FieldMappingWorkspace.test.tsx`), typecheck clean,
production build succeeds (`FieldMappingWorkspace`/`JourneyEntryRow`/
`JourneyView` each their own lazy-loaded chunk). E2E: 180 tests across
the 10 spec files this mission touched or added, all passing against the
real backend (`SPRING_PROFILES_ACTIVE=dev`) and real frontend dev
server — real rendered evidence, not inferred from source (CLAUDE.md §6).

**Deferred/not re-run this pass (named explicitly, CLAUDE.md §3):** the
full E2E suite (every spec file in `frontend/e2e/`, including the
Windows/macOS desktop CI jobs and the OpenShift-specific specs with no
behavioral overlap with this mission's diff) was not re-run in full
locally — BLOCKED on local wall-clock/compute budget for a mission this
size, not on any known failure. The 10 spec files actually touched by
this mission's diff (renamed labels, extended `JourneyField`, the new
Mapping Verification workspace, the two new investigation-workspace
specs) were all re-run and pass; PR #55's own CI (Backend/Frontend/E2E/
Windows/macOS, all required to be green before merge per this project's
established discipline) remains the authoritative final gate before
owner review, exactly as it has been for every prior section in this
register.

**Mapping Verification and Investigation Workspace pass (this section).**
Part A turns the existing configurable-mapping foundation into a genuine
verification workflow: every candidate — including the built-in default —
starts `UNVERIFIED`, becomes `VERIFIED` only through an evidence-gated,
server-checked action, and is never silently promoted by an edit or a
save alone. Part B restores and formalizes the Investigation Workspace as
its own product surface, distinct from Search/Results and the Inspector:
five root-anchored, position-indicated relationship views (Trace/Span/
Correlation/Journey/Event), plus a temporally-scoped Show Surroundings
action available from within any of them, with navigation continuity
("Back to Trace" etc.) layered on top of the pre-existing single-level
detour mechanism rather than a second, parallel one.
`MAPPING_VERIFICATION_PAGE_PRESENT=YES`,
`DEFAULT_MAPPING_NOT_AUTO_VERIFIED=YES`, `PROJECT_SCOPED_VERIFICATION=PASS`,
`CROSS_PROJECT_VERIFICATION_LEAK=NO`,
`SEARCH_READY_DISTINCT_FROM_VERIFIED=PASS`,
`TRACE_ACTION_PRESENT=YES`, `SPAN_ACTION_PRESENT=YES`,
`CORRELATION_ACTION_PRESENT=YES`, `JOURNEY_ACTION_PRESENT=YES`,
`SHOW_SURROUNDINGS_ACTION_PRESENT=YES`, `ROOT_ANCHORING=PASS`,
`POSITION_INDICATOR_VISIBLE=YES`, `NO_SILENT_SOURCE_SWITCH=PASS`,
`FABRICATED_CAUSALITY=NO`. `HISTORICAL_DECISIONS_PRESERVED=YES`.
`UNTRACKED_OWNER_REQUIREMENTS=0`. `MERGE_AUTHORIZED=NO` — owner review of
PR #55 required before merge.

**Post-merge note:** PR #55 (sections 19–22) merged into `main` at
`399fe2b200d3ea7404e5043b6e3415590ca51934` after owner review and all CI
green (Backend/Frontend/E2E/Windows/macOS), confirmed by the
`MERGE_PR55_AND_POST_MERGE_VALIDATE` closure mission. See section 23
below for a real functional defect the owner found in the merged Mapping
Verification workflow, and its recovery.

---

## 23. Field Mapping Verification Workflow Recovery

`FIELD_MAPPING_VERIFICATION_WORKFLOW_RECOVERY` mission — a real,
owner-reported functional defect found in the Mapping Verification
Workspace (section 22) after PR #55 merged to `main`, tested against real
logs. A narrow recovery mission on a NEW branch
(`fix/field-mapping-verification-workflow`) and a SEPARATE PR from `main`
— never a reuse of the already-merged PR #55 branch — never touching PR
#54 / `ux/v2-professional-redesign`.

**Owner-observed defect.** Quick Schema Scan finds real paths; the UI
shows a path as "observed in latest scan" with a real sample value
("Found: `<value>`"); the owner selects that exact discovered path from
the picker; despite this, the field stays `UNVERIFIED`, and clicking
Verify still returns "Cannot verify … candidate path was not found in any
of the given samples." For Exception specifically: `stack_trace` is
observed with a real sample shown; the unobserved fallback `exception`
alone caused verification to fail.

**Named conflict, applied per CLAUDE.md §5.** Section 19's original
`FieldMappingSettingsPanel.tsx` "Save mapping" action (row CFM-*, carried
into section 22's `FieldMappingWorkspace.tsx` unchanged) was described
and tested as persisting the owner's edited candidate. **It never
actually did.** This is not a design change superseding a prior decision
— it is the correction of a real defect that existed, undetected, from
section 19 onward: no test at any layer ever asserted that a field's
candidate paths, as returned by a **subsequent** `GET`, actually reflect
what a preceding edit-then-save round trip submitted. Every existing
`VERIFIED` row in sections 19–22 whose evidence chain went through the
UI's "Save mapping" button (not the raw `PUT /fields/{field}` HTTP calls
used directly in backend integration tests) is corrected here, not
re-litigated: the backend contract those rows describe (`PUT` persists,
`/validate` is stateless, `/save` only confirms readiness) was always
correct and needed no change; only the frontend's use of that contract
was wrong.

**Root cause (confirmed by inspection before editing, per CLAUDE.md §5
"audit before editing").** `FieldMappingWorkspace.tsx`'s `runSave()`
called only `POST /save` (`FieldMappingProfileService#confirmSave`, which
is a pure boolean-flag flip — it never touches the active profile's
candidates, by design; see its own javadoc) after `POST /validate`
(stateless — it validates the caller-supplied draft directly, without
requiring it to be persisted first, also by design). The ONLY endpoint
that ever mutates a scope's active profile candidates is `PUT
/fields/{field}` (`FieldMappingProfileService#updateCandidates`) — and
`runSave()` never called it. The owner's newly-picked discovered path was
therefore validated and shown as "Found: `<value>`" but never actually
persisted to the backend's saved profile; the saved profile silently kept
its old candidate. Verify (which by design reads the saved/active profile
— see `runVerify`'s own doc comment, unchanged and correct) then correctly
rejected the still-old, unobserved candidate — producing the exact
contradiction the owner saw. The backend's own ordered-candidate
resolution (`FieldMappingResolver`/`FieldMappingValidationService`,
"first usable non-null value wins") was **already correct** the whole
time, already covered by `FieldMappingResolverTest`/
`FieldMappingValidationServiceTest`, and required no logic change — only
new regression coverage proving it end to end through the real `/verify`
HTTP endpoint the owner's browser actually calls.

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| FMVR-1 | Save actually persists the draft it just validated — `runSave` now calls `PUT /fields/{field}` for every edited field (the exact draft that was validated, unchanged) BEFORE confirming, so what Verify later checks is genuinely what the owner reviewed and saved | `VERIFIED` | `frontend/src/features/settings/fieldMapping/FieldMappingWorkspace.tsx#runSave` — `Promise.all` over every `drafts` entry calling `updateFieldMappingCandidates`, then `saveFieldMappingProfile`; drafts/validation report are cleared only after the whole sequence succeeds — a failed persist leaves the draft intact for retry, never silently discarded | `FieldMappingWorkspace.test.tsx` ("save persists every edited field's draft via PUT /fields/{field} BEFORE confirming — the owner-reported root cause fix", "save never confirms if persisting an edited field fails…"); the same test file's full owner-scenario test (`SELECT_DISCOVERED_PATH_THEN_VALIDATE_SAVE_VERIFY` / `VERIFY_USES_CURRENT_SAVED_MAPPING_AFTER_SAVE` / `VISIBLE_DRAFT_AND_VERIFIED_VALUE_CANNOT_DIVERGE`) |
| FMVR-2 | Save is enabled only when there are unsaved edits AND the current draft's validation actually passed — not merely "a validation ran" | `VERIFIED` | `FieldMappingWorkspace.tsx`'s `canSave` now also requires `validationReport.passed` | `FieldMappingWorkspace.test.tsx` ("Save stays disabled when the draft's validation fails, never silently saveable with an invalid path") |
| FMVR-3 | First-usable-candidate-wins verification semantics — a fallback candidate that is never observed does not fail the field when an earlier (or any other) candidate resolves; confirmed ALREADY CORRECT in the backend, no logic change needed, only new coverage against the real HTTP endpoint | `VERIFIED` | `core.mapping.FieldMappingResolver#resolve`/`resolveWithProvenance` (unchanged); `core.mapping.FieldMappingValidationService#validateField`'s `foundCount` (unchanged) | `FieldMappingResolverTest` (pre-existing, e.g. `nullFirstCandidate_populatedSecondCandidate_secondWins`); new: `FieldMappingValidationServiceTest.multiCandidate_firstCandidatePresentSecondNeverObserved_stillFoundInAnySample`, `.multiCandidate_firstCandidateAbsentSecondPresent_stillFoundInAnySample`, `.multiCandidate_neitherCandidateObservedInAnySample_notFound`, `.multiCandidate_foundInAtLeastOneOfSeveralSamplesIsEnough_notEverySampleRequired`; new: `FieldMappingSettingsControllerIntegrationTest.firstUsableCandidateWinsVerification_stackTracePresentExceptionFallbackAbsent`, `.firstCandidateAbsentSecondCandidatePresent_verifiesAgainstTheDefaultCorrelationIdFallback`, `.allCandidatesAbsent_verifyFails`, `.invalidJsonPathSyntaxIsRejectedAtThePutStep_neverSilentlyReachesTheSavedProfile` |
| FMVR-4 | The exact owner scenario (Exception: `stack_trace` observed, `exception` fallback absent) verifies successfully end to end, at the real HTTP layer, in a real project scope, with no scan/validate/verify scope or sample mismatch | `VERIFIED` | New `FieldMappingSettingsControllerIntegrationTest.foundSampleAndVerifyNeverContradict_theOwnerScenarioEndToEnd` — PUT → validate (asserts `foundInAnySample()==true`, matching what the UI would show as "Found") → save → verify, all against the SAME `sourceId`/`project` scope and the SAME sample string | `PROJECT_SCOPE_PRESERVED`, `NO_CROSS_PROJECT_SAMPLE_MISMATCH`, `FOUND_SAMPLE_VERIFY_CONTRADICTION=NO` — all proven by this one test; scan/validate/verify were already confirmed (section 21/22) to resolve the identical `MappingScopeKey` via the same `MappingScopeResolver`, so no separate scope-mismatch defect existed once the persistence bug above was fixed |
| FMVR-5 | A valid mapping can be saved with unverified fields — verification state never gates Save; an optional/absent field (not observed in the current sample window) does not block saving a mapping that is otherwise technically valid | `VERIFIED` | Unchanged by design (`canSave`/backend `confirmSave` never read `verificationStatuses`) — re-confirmed, not newly built | New `FieldMappingSettingsControllerIntegrationTest.validMappingCanBeSavedWithUnverifiedFields_verificationNeverGatesSave` — `VALID_MAPPING_CAN_BE_SAVED_WITH_UNVERIFIED_FIELDS=YES`, `OPTIONAL_FIELD_NOT_OBSERVED_DOES_NOT_BLOCK_SAVE=YES` |
| FMVR-6 | The owner should never have to guess which version (draft vs. saved) Verify is checking — a visible, textual "Unsaved changes" marker appears next to the verification badge itself, and the existing Verify-disabled-while-a-draft-is-pending behavior (pattern A: disable + a very clear, actionable reason pointing at the Save button) is kept and its copy strengthened | `VERIFIED` | `FieldMappingWorkspace.tsx`'s new `.unsavedBadge` next to `VerificationBadge`; hint copy rewritten to explicitly name "6. Save mapping" | `FieldMappingWorkspace.test.tsx` ("Verify is disabled while this field has a pending unsaved draft edit, and says why") |
| FMVR-7 | Full regression re-verified after this recovery | `VERIFIED` | Backend: see this mission's final structured response for the exact pass count (full `./mvnw test` re-run). Frontend: see the same for the exact pass count (full `npx vitest run` re-run), typecheck clean, production build succeeds | `DESIGN_BRANCH_TOUCHED=NO`, `PR54_TOUCHED=NO` |

**Field Mapping Verification Workflow Recovery pass (this section).** A
mapping visibly proven by real discovered-path/sample evidence — shown as
"observed in latest scan" with a real "Found: `<value>`" — is now
genuinely saveable and verifiable, because Save finally persists the
exact draft that evidence was computed against. Verification correctly
follows first-usable-candidate-wins semantics (already true in the
backend before this mission; now proven end to end, not just at the unit
level). Save remains gated on technical validity only, never on every
field being verified, so an optional field absent from the current
sample window never blocks saving an otherwise-valid mapping.
`HISTORICAL_DECISIONS_PRESERVED=YES`. `UNTRACKED_OWNER_REQUIREMENTS=0`.
`MERGE_AUTHORIZED=NO` — owner review of this recovery PR required before
merge.

---

## 24. Service Filter, Docker Performance, and Verified Default Mapping

`SERVICE_FILTER_DOCKER_PERFORMANCE_AND_VERIFIED_DEFAULT_MAPPING` mission —
three owner-approved goals on one branch/PR
(`feature/service-filter-docker-performance-default-mapping`, from latest
`main`, never reusing or touching PR #54 / `ux/v2-professional-redesign`):
(A) service Include/Exclude search filtering, (B) Docker historical-search
performance (bounded parallelism), (C) a new owner-approved default field
mapping that starts `VERIFIED`. Nine numbered requirement categories below.

| ID | NAME | STATUS | EVIDENCE | NOTES |
|---|---|---|---|---|
| SFDPDM-1 | Service filter contract — `serviceFilterMode` (`INCLUDE`/`EXCLUDE`) added to the canonical search request; INCLUDE+non-empty is an allow-list (unchanged prior behavior); EXCLUDE+non-empty is a deny-list; EXCLUDE+empty means no restriction, identical to INCLUDE+empty; every existing caller that never sets the field keeps exact current (INCLUDE) behavior | `VERIFIED` | `core.model.SearchRequest` — new `ServiceFilterMode` enum + `serviceFilterMode` record field (compact constructor defaults `null`→`INCLUDE`), carried through `withPageBoundary`/`Builder`/`toString`; `core.search.EventFilters#matches` — single shared service-check block branches on mode (`exclude ? inList : !inList`), the one fallback layer every `LogSource` uses when a source cannot push filtering down natively | `SearchRequestTest` (5 tests: default, explicit-null default, builder round-trip, `withPageBoundary` carry-through, `toString`); `EventFiltersTest` (6 new: INCLUDE unchanged, EXCLUDE deny-list, EXCLUDE-empty==no-restriction, backward-compat default, null-service-under-EXCLUDE-never-throws) |
| SFDPDM-2 | Docker — excluded services' containers are never read at all, not merely filtered out after the fact; required proof `DOCKER_EXCLUDED_SERVICES_READ_COUNT=0` | `VERIFIED` | `source.docker.DockerLogSource#relevantContainers` — new `serviceFilterMode` parameter narrows the container `.filter(...)` predicate itself, applied BEFORE `targets` is built and therefore structurally before any `readContainerLogs` call; `#searchBlocking` passes `request.serviceFilterMode()` through | `DockerLogSourceTest.excludeModeNeverReadsTheExcludedServicesContainersAtAll_dockerExcludedServicesReadCountIsZero` (`verify(mockClient, never()).readLogs(...)` on both excluded containers), `.excludeModeWithAnEmptyListAppliesNoRestriction_readsEveryEligibleContainer`, `.excludeModeRespectsTheComposeProjectBoundary_neverExcludesAcrossProjects`, `.switchingFromExcludeBackToIncludeOnANewRequestNeverLeaksThePriorModesRestriction` — `DOCKER_EXCLUDED_SERVICES_READ_COUNT=0` |
| SFDPDM-3 | Truthful (never invented) source-side semantics for Loki/OpenShift/Fixture — Loki only pushes a positive `service=` selector match under INCLUDE (pushing it under EXCLUDE would invert the request's own meaning), relying on the shared `EventFilters` fallback for EXCLUDE; OpenShift has no native service pushdown at all and already routes 100% through `EventFilters`, so it requires zero source-specific code; Fixture's historical `search()` likewise already routes through `EventFilters` | `VERIFIED` | `source.loki.LokiLogSource#resolvePushedDownServices` — gated `request.serviceFilterMode() == INCLUDE` before ever returning `request.services()` for pushdown; `source.openshift.DirectPodLogProvider`/`source.fixture.FixtureLogSource#search` — confirmed via inspection (no changes needed, `EventFilters.matches` already the sole service-filtering path) | `LokiLogSourceTest.excludeModeNeverPushesDownTheExcludedServicesAsAPositiveSelectorMatch` — asserts the wire selector stays `{namespace="..."}` only (no `app=` clause) under EXCLUDE, while the response is still correctly narrowed by `EventFilters` afterward. OpenShift/Fixture: no dedicated new tests needed since no code changed — their existing full test suites (`DirectPodLogProviderTest` 74/74, `FixtureLogSourceTest`) continue to pass unchanged, and `EventFiltersTest`'s own coverage (SFDPDM-1) is what actually governs their behavior |
| SFDPDM-4 | Frontend — existing Services control preserved; a clear, adjacent mode control ("Include selected"/"Exclude selected", never color-only); summary communicates exclude mode clearly ("Excluding: a, b, c" for ≤3, "All services except N" beyond that); service discovery/session-only state unchanged, no new persistence | `VERIFIED` | `features/search/ServiceMultiSelect.tsx` — new optional `mode`/`onModeChange` props, an `aria-pressed` two-button segmented toggle inside the existing popover (backward-compatible: omitted `onModeChange` renders no toggle at all), mode-aware `triggerLabel`; `features/search/ActiveFilters.tsx` — new optional `serviceFilterMode`/`onClearServices` props, one combined summary chip under EXCLUDE (never per-service "Service:" chips, which could be misread as an allow-list) instead of N separate chips; `app/useSearchState.ts` — new `serviceFilterMode` state alongside `selectedServices`, included in `buildRequestBody`/the snapshot-restore mechanism/`clearAllFilters` (resets to `INCLUDE`) | `ServiceMultiSelect.test.tsx` (+6: EXCLUDE labels for 1/N services, EXCLUDE-empty unaffected, toggle renders + `aria-pressed` state, click calls `onModeChange`, omitted-prop backward compatibility); `ActiveFilters.test.tsx` (+5: `Excluding:` wording ≤3, `All services except N` wording >3, INCLUDE unaffected, single remove button calls `onClearServices` not `onRemoveService`, EXCLUDE+empty renders no service chip); `useSearchState.test.ts` (+4: default INCLUDE, wire body carries the field, Clear all resets it, a Show-Surroundings detour + Back restores the exact mode/services that were active before it) |
| SFDPDM-5 | Docker performance — sequential per-container reads replaced with BOUNDED parallelism (never unbounded); new configurable `logexplorer.docker.historical-search-concurrency` (default 6, following the existing plain getter/setter `@ConfigurationProperties` convention); deterministic final ordering, pagination, filter correctness, per-container/service/Compose-project attribution, and malformed/large-message preservation all unchanged | `VERIFIED` | `config.DockerProperties` — new `historicalSearchConcurrency` field/getter/setter, `application.yml` default `6`; `source.docker.DockerLogSource#searchBlocking` — the old `for (Container : targets) { readContainerLogs(...) }` loop replaced by `#readAllContainersInParallel`, using Reactor `Flux.fromIterable(targets).flatMap(mapper, concurrency)` on `Schedulers.boundedElastic()` (safe to nest inside the already-boundedElastic-scheduled outer call — its own dynamic thread cap, far exceeding the small configured concurrency); the full merged result is still explicitly re-sorted deterministically afterward exactly as before, so `flatMap`'s unordered completion can never affect final order | `DockerLogSourceTest` — `oneContainerReadsSuccessfullyAndTimingIsRecorded` (default-6 proof against a fresh `DockerProperties`), `fiveContainersAllReadSimultaneously_dockerReadsAreParallel` (5-party `CyclicBarrier` — sequential execution would deterministically time out, not merely run slow), `twentyContainersNeverExceedTheConfiguredConcurrencyBound` (max-active-read `AtomicInteger` counter, concurrency=4, 20 containers), `oneSlowContainerNeverSerializesTheIndependentFastContainers` (1×300ms + 9×50ms, concurrency=6, generous <550ms ceiling vs. the 750ms sequential sum), `maxContainersCapIsAppliedBeforeTheParallelReadFanOut`, `multipleSimultaneousTimeoutsAreEachHandledSafelyWithoutHangingOrThrowing` — `DOCKER_READS_ARE_PARALLEL=YES`, `DOCKER_PARALLELISM_IS_BOUNDED=YES`, `MAX_ACTIVE_READS_NEVER_EXCEEDS_CONFIG=YES`. Pre-existing suites (structured-filter, ordering, pagination, malformed/large-message, attribution) re-run unchanged and still pass, confirming no correctness regression from parallelizing the read |
| SFDPDM-6 | Docker read safety — `readContainerLogs`'s `awaitCompletion(...)` boolean return value (a real, previously-unreported defect: silently discarded) now captured; a genuine timeout logs a truthful `log.warn` diagnostic (no sensitive content) and still returns whatever partial lines already arrived — never fabricates zero, never silently claims completeness | `VERIFIED` | `source.docker.DockerLogSource#readContainerLogs` — `boolean completed = callback.awaitCompletion(...)`, `if (!completed) log.warn(...)`, `return callback.lines()` unchanged (partial data preserved either way) | `DockerLogSourceTest.aReadThatNeverCompletesWithinTheTimeoutStillReturnsItsPartialLines_neverFabricatesZero` — a read that delivers one full line via `onNext` but never calls `onComplete()` within a 100ms timeout still returns that one event, and the whole search still completes promptly (bounded, not hung) |
| SFDPDM-7 | Docker performance observability and constraints — low-cost timing (total duration, target container count, containers actually read, effective concurrency, slowest single-container read) recorded for tests/diagnostics, with zero raw log/query/identifier content ever logged; immediate visible feedback already exists (the Search button flips to "Searching…" and disables synchronously on click, before any network latency — confirmed sufficient, no change needed); no progressive/streamed result delivery added; no persistent retention/database/cache added | `VERIFIED` | `source.docker.DockerLogSource` — new package-private `HistoricalSearchTiming` record + `lastHistoricalSearchTiming()` test-visibility getter, populated by `#readAllContainersInParallel`, logged at `log.debug` with only counts/durations (never message/query/token/CIF/username/customerId/deviceId content) | Timing fields directly asserted across every `DockerLogSourceTest` concurrency test above (`targetContainerCount`/`containersActuallyRead`/`effectiveConcurrency`). `PROGRESSIVE_RESULTS_IMPLEMENTED=NO` (confirmed — no streaming/SSE/chunked-delivery code added anywhere in this mission). `PERSISTENT_LOG_RETENTION=NO`, `LOCAL_LOG_DATABASE=NO`, `TWO_DAY_CACHE=NO` (confirmed — no SQLite/Postgres/embedded index/filesystem archive/background ingestion added; the source remains the sole authority, `lastHistoricalSearchTiming` is in-memory, single-value, overwritten per search, never persisted) |
| SFDPDM-8 | **Owner-approved default field mapping starts `VERIFIED` with no Quick Schema Scan required** — the exact 23-field table below is the new authoritative built-in DEFAULT profile (product-level, immutable, not merely historical candidates); Journey ID and UI Identifier are deliberately, permanently unmapped by default (`NONE`) — no auto-populated candidate, no auto-VERIFIED, no inference from historical mappings or schema-scan results; a Quick Schema Scan may report observed/not-observed/possible-drift but never auto-downgrades an owner-approved `VERIFIED` default merely for being unobserved in one bounded sample (this combined state is explicitly valid); this **explicitly supersedes** MVER-1's original "every field including the built-in default starts UNVERIFIED" rule for the default profile only (CLAUDE.md §5 named-conflict discipline — historical text preserved verbatim, not deleted, see the §23 header's STATUS UPDATE and MVER-1's row above) | `VERIFIED` | `core.mapping.DefaultFieldMappingProfile#build` — rewritten to the owner-approved table (`Timestamp→@timestamp`, `Service→application`, `Severity→level`, `Message→message`, `Logger→logger_name`, `Thread→thread_name`, `Exception→stack_trace`, `CIF→cif`, `Username→userName`, `Customer ID→customerId`, `Device ID→deviceId`, `Device IP→deviceIp`, `Correlation ID→X-Correlation-id`, `Trace ID→traceId`, `Span ID→spanId`, `Journey Name→journeyName`, `Event ID→mdc.eventId`, `Business Step→stepName`, `Error Code→mdc.ERROR_CODE`, `Device Platform Type→devicePlatformType`, `Language→language`, `Server IP→serverIp`, `Server Host→serverHost`; `Journey ID`/`UI Identifier`→`List.of()`, permanently unmapped); `core.mapping.FieldMappingProfileService` — new `freshDefaultVerificationMap()` derives VERIFIED/UNVERIFIED purely from `!builtInDefault.candidates(field).isEmpty()` (single source of truth, no second hand-maintained list to drift), used both for a fresh scope's initial `verificationStatuses` AND for `resetToDefault`; `updateCandidates` unchanged (still reverts `VERIFIED`→`UNVERIFIED` on any edit — a USER-edited field is never auto-verified, MVER-2/MVER-4 fully preserved); `FieldMappingWorkspace.tsx` — real, previously-unreported defect found and fixed: the "run a scan first" hint was gated only on `!hasScanEvidence`, so it would have misleadingly shown for an untouched, already-`VERIFIED` owner-approved default field with no scan run yet; now also gated on `field.verificationStatus !== 'VERIFIED'` | `DefaultFieldMappingProfileTest.matchesTheOwnerApprovedDefaultMappingTableExactly` (`DEFAULT_MAPPING_MATCHES_OWNER_APPROVED_TABLE=PASS`), `.journeyIdHasNoDefaultCandidate_ownerDeclinedToGuess`, `.uiIdentifierHasNoDefaultCandidate_ownerDeclinedToGuess`; `FieldMappingProfileServiceTest.freshProfileOwnerApprovedDefaultsStartVerified_unmappedFieldsStartUnverified` (full-enum loop, `hasDefault ? VERIFIED : UNVERIFIED`), `.ownerApprovedDefaultIsVerifiedWithNoScanNoEditNoSave`, `.resettingTheProfileRestoresExactlyTheFreshScopeVerificationState`; `FieldMappingSettingsControllerIntegrationTest` (24/24 passing, incl. `freshOwnerApprovedDefaultStartsVerified_unmappedFieldStartsUnverified`, `aRejectedVerifyAttemptNeverChangesAnAlreadyVerifiedFieldsStatus`); `FieldMappingWorkspace.test.tsx` (+2: `never shows "Run a Quick Schema Scan first" for an already-VERIFIED field with no scan run yet...`, `still shows "Run a Quick Schema Scan first" for a non-VERIFIED field with no scan run yet, even alongside an unrelated VERIFIED field`) — `BUILT_IN_DEFAULT_PROFILE_STATUS=VERIFIED`, `QUICK_SCAN_NOT_REQUIRED_FOR_DEFAULT_VERIFICATION=PASS`, `DEFAULT_NOT_OBSERVED_DOES_NOT_AUTO_DOWNGRADE_VERIFIED=PASS`, `SCHEMA_SCAN_DOES_NOT_AUTO_ASSIGN_UNMAPPED_FIELDS=PASS`, `JOURNEY_ID_HAS_NO_DEFAULT_MAPPING=PASS` |
| SFDPDM-9 | Reset to Defaults restores exactly the approved mappings with `VERIFIED` status, Journey ID/UI Identifier with no mapping; project/source scope is preserved unchanged — the built-in default is product-level immutable config, user modifications remain project/source-scoped per the existing `MappingScopeKey` model, a fresh scope inherits the verified built-in default, and one project's edit never mutates the defaults or another project's own profile | `VERIFIED` | `FieldMappingProfileService#resetToDefault` — `freshDefaultVerificationMap().forEach(state.verificationStatuses::put)` replaces the old blanket-UNVERIFIED loop, restoring the same VERIFIED/UNVERIFIED split a fresh scope gets; scope isolation itself unchanged (one `ScopeState` per `MappingScopeKey`, unaffected by this mission) | `FieldMappingProfileServiceTest.resettingTheProfileRestoresExactlyTheFreshScopeVerificationState` (CIF edited+verified→reset→VERIFIED with default candidate `cif`; JOURNEY_ID edited+needs-change→reset→UNVERIFIED with empty candidates), `.oneProjectEditingAFieldNeverMutatesAnotherProjectsOwnVerifiedDefaultState`; `FieldMappingSettingsControllerIntegrationTest.resetRestoresTheBuiltInDefaultAndSearchReadiness` (asserts `cif.verificationStatus()=="VERIFIED"` via real HTTP) — `DEFAULT_MAPPING_RESTORED=YES`, `DEFAULT_MAPPING_VERIFIED=YES`, `JOURNEY_ID_DEFAULT_MAPPING=NONE`, `UI_IDENTIFIER_DEFAULT_MAPPING=NONE` |

**Service Filter, Docker Performance, and Verified Default Mapping pass
(this section).** Service filtering gained explicit, truthful INCLUDE/
EXCLUDE semantics at the one shared filtering layer every source already
funnels through, with Docker additionally guaranteed to never read an
excluded service's containers at all — not a frontend-only or
after-the-fact filter. Docker historical search is now bounded-parallel
(default concurrency 6) instead of summing every container's own read
latency sequentially, with a real, previously-unreported timeout-handling
defect fixed alongside it (truthful partial-data-on-timeout, never
fabricated completeness or a silent zero). No progressive delivery, no
retention/database/cache was added — the source remains sole authority.
The owner-approved default field-mapping table now starts fully
`VERIFIED` with zero scan/edit/save/verify effort required, while every
other verification guarantee (evidence-gated USER edits, explicit
`NEEDS_CHANGE`, full project-scope isolation) remains completely
unchanged — the historical "default != verified" rule is named as
superseded for this one profile, not silently dropped.
`HISTORICAL_DECISIONS_PRESERVED=YES`. `UNTRACKED_OWNER_REQUIREMENTS=0`.
`PR54_TOUCHED=NO`. `DESIGN_BRANCH_TOUCHED=NO`. `MERGE_AUTHORIZED=NO` —
owner review of this implementation PR required before merge.

---
