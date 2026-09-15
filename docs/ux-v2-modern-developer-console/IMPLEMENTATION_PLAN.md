# Implementation Plan — Modern Developer Console (V2-B1 … V2-B7)

**This is a plan only. Nothing here is implemented.**

Production work starts only after the owner:
1. approves this visual package and one B treatment (the recommendation is B1 Instrument Neutral), and
2. decides the flagged items in §3.

Starting points:
- **Functional baseline**: latest `main` `3f6b1b4bc30c282e0cd1e65510697ff128d79d73`. Re-verify it is still the tip
  before branching. If `main` has moved, refresh `CURRENT_BASELINE_INVENTORY.md` first.
- **Recommended production branch**: `ux/v2-modern-developer-console`. Create it from latest `main` **after owner
  approval**; it does not exist yet.
- **PR #54** (`ux/v2-professional-redesign`) is design history only. Nothing is merged or cherry-picked from it except
  the Impeccable tooling, which is already imported on the design branch.
- **Rule**: `FUNCTIONAL_BEHAVIOR_LOSS_ALLOWED=NO`. Every row of `CURRENT_BASELINE_INVENTORY.md` must still be reachable
  and behave the same after each slice, unless the owner approved a change in §3.

## 1. Delivery model

- **One slice = one PR** into `ux/v2-modern-developer-console`. The branch reaches `main` only by owner decision after
  V2-B7.
- **Order**: B1 → B2 → B3 → B4 → B5 → B6 → B7. Each slice depends on B1 tokens. After B1, slices B5 and B6 can run in
  parallel if they are reviewed separately.
- **Every slice must pass these gates** before merge into the design-implementation branch:
  1. `npm run typecheck`, `npm test`, `npm run build` (frontend) — PASS.
  2. The full Playwright E2E suite — PASS, including `geometry.spec.ts`: header/cell alignment ≤ 2 px, 7 columns, no
     page overflow at 1920/1440/1366/1280/1024/768/390.
  3. `git diff --stat main -- backend/` is empty. No slice touches the backend.
  4. Before/after screenshots of the slice's states at 1440×900, plus the responsive widths listed per slice. They are
     captured from the real app with the Fixture source and compared against the prototype state.
  5. **LERUX-1** rendered-browser acceptance of the slice (independent reviewer, not the implementer).
  6. `impeccable detect` on changed files. Each flag is triaged individually; no blanket suppression.
  7. axe-core: no new violations versus the slice's pre-change run. Keyboard walk-through of the slice's workflow.
  8. TEST-INFRA-1 containment: tracked evidence PNGs mutated by E2E are restored before commit
     (`UNRELATED_BINARY_CHANGES=0`).
- **Rollback**: each slice is independently revertable (`git revert` of its squash commit). B1 keeps legacy token names
  as aliases, so untouched components keep rendering; B7 removes the aliases last.

## 2. Slices

### V2-B1 — Foundations: tokens, type, icons, primitives

| Field | Content |
|---|---|
| **Affected components** | `shared/tokens.css` (REPLACE_VISUALLY), new `shared/ui/Icon.tsx` (Lucide), `shared/ui/Button.tsx` (RESTYLE: `danger`, `sm`, icon slot), font assets (Inter, JetBrains Mono, OFL; self-hosted, no CDN), global focus-visible and reduced-motion rules. |
| **Visual changes** | The new semantic token set (B1 light), with legacy tokens aliased to it. Inter and JetBrains Mono replace the system stacks. Focus ring. No layout change. |
| **Interaction changes** | None. |
| **Invariants** | Every component still renders with aliased tokens. The reduced-motion rules still apply. No component markup changes. |
| **Risks** | The font swap changes text metrics, which can move table geometry: widths and row height feed `geometry.spec.ts`. New dependency: `lucide-react` (ISC). Owner/dependency approval is D14. |
| **Screenshot states** | 01, 04, 13, 16, 18 at 1440; 01 at 390. Before and after should look nearly the same apart from type. |
| **Test impact** | Geometry E2E re-baselined only if widths legitimately change (the change must be named). No unit test changes expected. |
| **Accessibility checks** | Contrast of every aliased pair (§2.5 of `DESIGN_SYSTEM.md`); focus ring visible on every control type; reduced-motion mode. |
| **Rollback boundary** | Revert restores the old tokens and fonts. Nothing else depends on B1 until B2 lands. |

### V2-B2 — Shell, query bar and scope strip (Search mode chrome)

| Field | Content |
|---|---|
| **Affected components** | `app/Shell.tsx`, `app/Toolbar.tsx`, `SourceSelect`, `ComposeProjectSelect`, `SourceHealthBadge`, `ServiceMultiSelect`, `SeverityFilter`, `UniversalSearch`, `TimeRangeControl` / `CustomRangePopover`, `ActiveFilters`, `AdvancedFilters`, `QueryBuilder`, `SortControl`, `QueryPlanDisclosure`, `KeyboardShortcutsHelp`. |
| **Visual changes** | 44 px shell with workspace trail; one 44 px query bar with field buttons (Source+health, Project, Time, Services, Severity); a 32 px scope strip with chips, readout, sort toggle, Columns, Query details and Refresh; More filters as a full-width panel; Lucide icons. |
| **Interaction changes** | Severity chips move into a Severity popover (D16). Sort becomes a toggle in the strip. Query details becomes a popover. The three settings buttons become **Settings** (D3). All behaviour stays the same. |
| **Invariants** | Search-disabled reasons stay visible (loading, OpenShift scope, mapping gate). Live renders only with `liveTail`. Raw LogQL only with `rawLogQL`. EXCLUDE is worded ("Excluding: …" / "All services except N"). The Time label shows the actual interval and zone. The custom range popover keeps all validation. Clear all never touches source or scope. `/` focuses search. No sensitive values in chips or URLs. |
| **Risks** | Popover placement depends on `[data-app-chrome]` plus ResizeObserver (inventory risk 11). Toolbar wrapping has pushed the page sideways at 390 px before (risk 12). E2E selectors use the button texts "Privacy & masking", "Docker settings" and "OpenShift". |
| **Screenshot states** | 01, 02, 12, 21, 23, 26, 27, 28, 29, 30, 32, 33, 34, 36 at 1440; 01 at 1920/1366/1024/768/390. |
| **Test impact** | Update unit tests for `SeverityFilter` (popover), `SortControl` (button instead of select) and shell navigation. Migrate E2E selectors for settings entry points and severity chips. Keep all assertions about behaviour. |
| **Accessibility checks** | Every field has an accessible name that includes its value; popovers have Esc, outside click and focus return; `aria-pressed` on Include/Exclude; the gate reason is announced (`role="status"`). |
| **Rollback boundary** | Revert restores the old Shell and Toolbar. Results and Inspector (B3/B4) are unaffected because they consume state, not chrome. |

### V2-B3 — Results workstation

| Field | Content |
|---|---|
| **Affected components** | `ResultsTable.tsx` (+ module CSS), `columnRegistry.tsx`, `MessageCell`, `ActionsCell`, `TableSettingsControl`, `ResultsPanel` (state panels, load more), `ContextSummary` (stat row only; the plot comes in B5). |
| **Visual changes** | 28 px compact rows (D1); a signal gutter with severity shape marks; neutral INFO/DEBUG/TRACE words; ERROR row wash; sticky header and sticky Time column; sentence-case headers; mono middle-ellipsis IDs in ink (accent on hover); selection tint plus hairlines; trigger ring; new loading, empty, error, load-more-failure and invalid-query panels; skeleton for the first search. |
| **Interaction changes** | Previous rows stay visible in tertiary ink during re-search (D2). "Search last 1 day" appears only when it widens the range, and the orphan Refresh is removed (D7). |
| **Invariants** | All of CLAUDE.md §4 "Results table": one table and colgroup, `table-layout: fixed`, 7 columns in order, message only, `—`, one row per event, alignment ≤ 2 px, newest first (Context oldest first, existing), one pagination model, distinct counts, contained horizontal scroll. Row-state precedence (inventory risk 2). Roving tabindex, `aria-selected`, `aria-current`. Gap rows. Density preference stays presentation-only. |
| **Risks** | A sticky left Time cell must not break header/cell geometry or the box-shadow row states. It needs an opaque cell background per state. The selection rule has already erased the root marker once. |
| **Screenshot states** | 01, 02, 03, 20, 21, 22, 24, 25, 28, 30, 35 at 1440; 01 at 1920/1366/1024/768/390; 01 in comfortable density. |
| **Test impact** | `geometry.spec.ts` must pass unchanged (new widths are asserted as design values). Update unit tests for text changes in panels. Add tests: "Search last 1 day" hidden when range ≥ 1 day; trigger row keeps its ring while selected; sticky Time alignment at scroll position > 0. |
| **Accessibility checks** | Severity understandable in greyscale (screenshot check); `aria-sort`; `aria-busy` during re-search; count announcements; load-more retry is reachable by keyboard. |
| **Rollback boundary** | Revert restores the old table CSS and panels; column ids and data are untouched. |

### V2-B4 — Inspector

| Field | Content |
|---|---|
| **Affected components** | `EventInspector`, `InspectorHeader`, `InspectorTabs`, `OverviewSection`, `ActorClientSection`, `RequestFlowSection`, `BusinessErrorSection`, `AllFieldsSection`, `ContextAction`, `shared/ui/FieldList`. |
| **Visual changes** | 500 px docked at ≥ 1366 px; overlay sheet below 1366 px; meta row (level · service · time · Close); two-line title with trigger crosshair; action row (Show surroundings, View trace, position, prev/next); five one-row underline tabs; grouped key/value lists; identifiers with grouped actions; wrapped stack traces; mapped vs unrecognised field groups with JSON highlighting. |
| **Interaction changes** | Overlay threshold moves 1024 → 1366 px (D12). Header shortcut buttons call the existing Request flow handlers. The Actor & client masking note reflects the actual policy (D5, copy). **Show Surroundings gated by `contextView`** is a functional fix done as a separate, separately reviewable commit, only if the owner approves (D4). |
| **Invariants** | Exactly five tabs, never hidden, reset to Overview on selection; non-modal dialog; resizable 320–720 px with keyboard; focus to Close on open; Esc precedence; `[`/`]` with an `aria-live` position; every Request flow action (Find same Correlation, View Trace, View Span, Find same journey, Find same Event, Copy); ±30 s confirm dialog; no reveal of masked values; malformed-event title. |
| **Risks** | Width change affects table column widths while open (B3 dependency). Tests match the text "Protected / masked - never revealed". |
| **Screenshot states** | 04, 05, 06, 07, 08, 25 at 1440; 04 at 1920/1366/1024/768/390; 27 (Loki source fields). |
| **Test impact** | Update the masking-note text assertion (D5). Add tests: tabs on one row at 500 px (no wrap); stack trace wraps; if D4 is approved, Show Surroundings is absent when `contextView` is false (Inspector, row actions, capture rows). |
| **Accessibility checks** | Tablist keyboard; focus trap only in overlay mode; resize handle has a name and keyboard steps; position announcements. |
| **Rollback boundary** | Revert restores the old Inspector. D4 is its own commit, so it can be reverted independently. |

### V2-B5 — Investigation (Trace, Span, Correlation, Journey, Event) and Context capture

| Field | Content |
|---|---|
| **Affected components** | `JourneyView` (REPLACE_VISUALLY), `JourneyEntryRow` (REPLACE_VISUALLY), `journeyFields`, `serviceColor` → lane tokens, `ContextSummary` (window plot), `App.tsx` compact scope bar for non-search workspaces. |
| **Visual changes** | Mode bar (Back, relation, ID, Copy); stat row (Events, Services, Errors, Warnings, First→last, Observed span, Gaps, Selected event i of N); timeline plot with service lanes, trace brackets (Journey), hatched gap bands, the selected-event line and flag; sequence table (time, offset, service swatch + name, level, step, message, span/trace, Surroundings); Context window ruler ±30 s. |
| **Interaction changes** | The trigger travel view transition (MOTION_SYSTEM, progressive enhancement). Surroundings no longer scrolls the page: only the table body scrolls, with instant scroll to the root. The compact scope bar with Edit search replaces the always-visible query bar (D15). |
| **Invariants** | Relation types and the root anchoring; truncation notices; **non-causality copy in every capture**; per-entry Show Surroundings with a contextual `Back to <Trace|…>` restoring the investigation; snapshot/restore mechanics and takeover order (Mapping > Live > Journey > Results; risk 4); the plot draws no arrows or connectors (risk 9); service colour is always next to its name; malformed rows. |
| **Risks** | Plot positioning for very long captures (bounded: server truncation is already applied; lanes are capped with "+N more services"); lane colour sameness for more than 7 services (the name is always present). View Transitions support differs by browser; the cross-fade fallback must be complete. |
| **Screenshot states** | 09, 10, 11, 37 at 1440; 09 at 1920/1366/1024/768/390; Span, Correlation and Event variants; a truncated capture; Context with root aged out. |
| **Test impact** | Replace card-structure unit tests with sequence-table tests that assert the same data. Keep Back and root-position E2E. Add a no-page-scroll assertion when opening Surroundings. |
| **Accessibility checks** | The plot is `aria-hidden` with its information duplicated in the stat row and table; the root row has `aria-current`; Back focus returns to the originating row; reduced-motion removes the morph. |
| **Rollback boundary** | Revert restores card views. B3 and B4 are unaffected. |

### V2-B6 — Field mapping workspace and Settings workspace

| Field | Content |
|---|---|
| **Affected components** | `FieldMappingWorkspace` (REPLACE_VISUALLY), `DockerSettingsPanel`, `OpenShiftSettingsPanel`, `PrivacyMaskingSettingsPanel` (RECOMPOSE into a Settings workspace), `App.tsx` (Settings takeover), `KeyboardShortcutsHelp` (also listed in Settings). |
| **Visual changes** | Mapping: header with readiness tag, process strip (Scan · Map & verify · Validate · Save), filter segmented control (All / Needs attention / Unsaved), a field table (canonical field · mapped path · evidence bar · status · action) with an inline editor row, an evidence side panel (Original event sample + Discovered schema), and a sticky action bar. Settings: left nav (no single-item group labels), panels with scope tags, switches with Masked/Unmasked words, proxy radios, read-only markers. |
| **Interaction changes** | The three settings popovers become one workspace takeover (D3). The mapping stale intro copy is replaced (D6). No change to the verify / save order. |
| **Invariants** | Mapping: scan gated by `originalSchemaSampling`; draft → validate → save → verify; Verify disabled while a draft is pending; Needs change semantics; owner-approved defaults Verified with no scan; Journey ID and UI Identifier unmapped with no auto-assignment; reset; scope isolation per source and project; search gate; first-usable-candidate-wins; "not observed" never downgrades Verified. Settings: Docker read-only summary plus Test connection that never changes config; every OpenShift state and error copy; network-exposed sign-in block; scope selectors; proxy fieldset; Disconnect; masking is five fields, server-side, "applies to new requests only", no reveal. TLS verification copy. |
| **Risks** | Many E2E specs open settings through shell popovers. Mapping has the richest state machine (#55/#56/#57 regressions). OpenShift connection error-copy coverage. |
| **Screenshot states** | 13, 14, 15, 16, 17, 26, 39 at 1440; 13 and 16 at 1920/1366/1024/768/390; mapping after scan, with drift, with a validation failure; OpenShift connected, not connected and session expired. |
| **Test impact** | Migrate settings-opening helpers in E2E. Keep every mapping behaviour test and re-point its selectors. Add a test that the intro copy matches the verified-defaults rule. |
| **Accessibility checks** | Table semantics for fields; the editor row is announced; `role="switch"` with state words; radio group; horizontal settings nav is keyboard operable at ≤ 1023 px. |
| **Rollback boundary** | Revert restores the popovers and the card column. Search, Results and Inspector are unaffected. |

### V2-B7 — Live, global states, responsive and accessibility hardening, dark companion, deprecation cleanup

| Field | Content |
|---|---|
| **Affected components** | `LiveTailPanel` (RECOMPOSE); global state panels (startup, no sources, source unavailable, no services, no projects); responsive CSS across the app; theme preference (only if D9 is approved); removal of legacy token aliases, Unicode glyphs and superseded markup (inventory "Deprecated after implementation"). |
| **Visual changes** | Live mode bar with acquisition-state badge (LIVE success, not red), a counts bar (Received · Visible · Buffered · Evicted · Dropped), the retention notice (2,000 cap, existing), a display filter row, and an event table that reuses the results row grammar; "Jump to newest · N new". Global state panels. The dark companion theme, if approved. |
| **Interaction changes** | None to Live controls. The theme preference is new UI (D9) and stores only a non-sensitive preference. |
| **Invariants** | Live: every connection and source state string; controls by state (Start, Retry, Pause, Resume, Stop, Clear, Follow newest with `aria-pressed`); distinct counts; the 2,000 retention cap; partial `(a/r active)`; reconnect notice; 100 ms batching; bounded DOM; Live only with `liveTail`. Global: capability-driven rendering (hidden, not disabled). |
| **Risks** | Live row reuse must not reintroduce unbounded DOM. **G4:** on `main`, Live is started with `state.selectedServices` and no service filter mode (`App.tsx:163`, `App.tsx:189`), so under EXCLUDE the excluded names are sent as Live's `services` parameter. That is a functional defect outside a visual slice (D8). The design shows Live's own effective scope rather than implying the search's Include/Exclude applies. Dark theme must pass every gate independently. |
| **Screenshot states** | 18, 19, 19b, 38, 22, 23, 31 at 1440; 18 at 1920/1366/1024/768/390; STOPPED, CONNECTION FAILED, SESSION EXPIRED, NO ACTIVE STREAMS; with D9 approved, the full B1-dark set for all 32 states. |
| **Test impact** | Live unit tests re-pointed from card rows to table rows. Axe run across all states. Full responsive E2E sweep. Removal of deprecated components only after their replacements' tests are green. |
| **Accessibility checks** | Live state changes announced; pulse static under reduced motion; 200 % zoom reflow; dark contrast table re-verified in the rendered app. |
| **Rollback boundary** | Live and theme are separate commits. Alias removal is the last commit and reverts cleanly. |

## 3. Owner decisions required before or during implementation

| ID | Decision | Type | Proposed | Slice |
|---|---|---|---|---|
| D0 | Approve the visual package and choose B1 / B2 / B3 | Visual approval | B1 Instrument Neutral | all |
| D1 | Compact (28 px) as the default density; comfortable stays available | Presentation default change | Approve | B3 |
| D2 | Keep previous rows visible in tertiary ink (contrast kept) during a re-search, instead of clearing to "Searching…" | Interaction change | Approve | B3 |
| D3 | Replace the three shell settings popovers with one Settings workspace | Interaction and IA change | Approve | B2, B6 |
| D4 | Gate Show Surroundings by the source's `contextView` capability (currently only timestamp-gated) | **Functional fix** | Approve as a separate commit | B4 |
| D5 | Actor & client note reflects the actual masking policy instead of always "never revealed" | Copy fix | Approve | B4 |
| D6 | Replace the stale mapping intro copy ("defaults start Unverified") | Copy fix | Approve | B6 |
| D7 | Offer "Search last 1 day" only when it widens the range; remove the orphan Refresh | Copy and interaction fix | Approve | B3 |
| D8 | Live under Service EXCLUDE (G4): decide intended semantics and fix in a functional lane, not a visual slice | **Functional defect** | Track separately | B7 (blocked on decision) |
| D9 | Ship the B1 dark companion in B7 or later | Scope | After light is accepted | B7 |
| D10 | Split "no services discovered" from "no service matches the filter" (G2) | Copy fix | Approve | B2 |
| D11 | Empty source list message (G3) | Copy fix | Approve | B7 |
| D12 | Inspector default 500 px and overlay below 1366 px | Layout change | Approve | B4 |
| D13 | Keyboard shortcuts listed inside Settings as well as the shell button | IA | Approve | B6 |
| D14 | New dependencies: `lucide-react` (ISC), self-hosted Inter and JetBrains Mono (OFL) | Dependency | Approve | B1 |
| D15 | Investigation, Surroundings and Live show a compact scope bar with **Edit search** instead of the always-visible full query bar (refining takes one extra click) | Interaction change | Approve | B5, B7 |
| D16 | The five level chips move into the Severity popover. The **All levels** and **Errors only** quick actions stay one click, as a small segmented control at the start of the scope strip (`01`) | Presentation change (no loss of one-click behaviour) | Approve | B2 |

## 4. Deferred lanes (explicitly not part of this plan)

- **`SEARCH_PERFORMANCE_ROOT_CAUSE`**: search latency is not investigated or fixed by any slice. The loading visuals
  (progress hairline, held rows, skeleton) are truthful state feedback and **do not pretend to fix latency**. A
  separate owner-approved mission owns the root cause.
- **Surfacing partial Docker timeout results in the UI**: noted after PR #57; separate functional lane.
- **G4 Live under EXCLUDE** (D8): functional lane.
- Everything in CLAUDE.md §8 stays out of scope.

## 5. Definition of done for the whole implementation

- All seven slices merged into `ux/v2-modern-developer-console` with every gate in §1 PASS.
- LERUX-1 full-workflow acceptance on the rendered app across the investigation loop (Search → select → inspect →
  prev/next → surroundings → trace/journey → back → refine → search), with evidence.
- Root `DESIGN.md` replaced by the approved system (Impeccable documenter), and `PRODUCT.md` updated.
- The owner requirements register updated per slice; `UNTRACKED_OWNER_REQUIREMENTS=0`.
- A merge to `main` only by explicit owner decision.
