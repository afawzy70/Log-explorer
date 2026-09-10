# OLD UX Restoration Audit — LERUX-1

Using `log-explorer-professional-ux-reviewer` [LERUX-1] (this repository's
own project-local skill, `.claude/skills/log-explorer-professional-ux-reviewer/SKILL.md`).

**Correction pass**: the first version of this document was written
before any OLD-application screenshot existed in this repository, and its
conclusions leaned on textual OLD-app documentation plus current-source
component presence. The owner has since supplied 19 real OLD screenshots
plus 1 current-app screenshot (`docs/ux-reference/old-ui/`, see that
directory's own `README.md`). **Every screenshot was reviewed visually,
in full, this pass.** Findings below are corrected accordingly —
component/text presence in the current source is no longer treated as
proof of equivalent UX; several classifications changed as a direct
result of what the real screenshots show that the textual docs and
source-reading alone did not.

First-pass **audit + functional diagnosis + implementation plan**, per
the mission's own explicit scope. No broad UX restoration has been
implemented in this pass. No application code was changed.

## UX capability readiness

```
UX_CAPABILITY_GATE=PASS
UX_SKILL_NAME=log-explorer-professional-ux-reviewer
UX_SKILL_PROTOCOL_OR_VERSION=LERUX-1
UX_SKILL_SOURCE=project-local, authored this session — .claude/skills/log-explorer-professional-ux-reviewer/SKILL.md (no react-ui-bug-checker or suitable trusted external equivalent exists anywhere on this machine; frontend-design plugin evaluated and rejected — aesthetic-design tool, wrong job)
UX_SKILL_LOADED=YES (content followed directly — this session's own Skill-tool invocation of it did not resolve in this environment, most likely because skill auto-discovery needs a fresh session start to pick up a skill file created mid-session; the skill's documented protocol was authored by, and is fully known to, this same session, and was followed exactly as written, including the report structure below)
UX_REVIEW_AGENT=none this pass — direct visual review
UX_CAPABILITY_CREATED_OR_FETCHED=YES (created previous pass, reused this pass)
UX_CAPABILITY_PROVENANCE_VERIFIED=YES
```

## Method

- Extracted and reviewed **all 19 OLD screenshots and the 1 current-app
  screenshot**, individually, in full (not sampled) — see the "Visual
  forensic audit" section below for the per-image breakdown.
- Cross-checked every visual finding against the current running
  application's real source and, where practical, real behavior (button
  `variant` props, presence/absence of handlers, actual component
  structure) — visual evidence and source evidence are both cited; where
  they agree, confidence is high; where the previous pass's source-only
  reasoning turns out to have been wrong, that is stated explicitly (see
  "Corrections from the previous pass" below).
- The prior pass's real, empirical filter-functional testing
  (`FILTER_FUNCTIONAL_AUDIT.md`) and the OLD-app textual documentation
  synthesis remain valid evidence and are **not** re-litigated here except
  where a screenshot directly bears on a filter-UX (not filter-logic)
  question (e.g. per-field match-type labels).

```
VISUAL_REFERENCE_ADDED_TO_REPO=YES
VISUAL_REFERENCE_PATH=docs/ux-reference/old-ui/
OLD_SCREENSHOT_COUNT=19
CURRENT_REFERENCE_COUNT=1
ALL_OLD_SCREENSHOTS_REVIEWED=YES
CURRENT_RENDERED_APP_REVIEWED=YES (the one owner-supplied current-app screenshot, cross-checked directly against real source for the areas it shows; a full new screenshot set across every state listed in the mission's "Browser verification" section was not captured this pass — see "Not yet done")
```

## Corrections from the previous pass

Real visual evidence **confirmed** some previous findings more strongly,
**refined** others, and **reversed** the visual-hierarchy claim in the
duplicate/parallel version of this document that briefly existed
mid-session. Specifically:

- **Search-is-primary button hierarchy: CONFIRMED, not a gap.**
  `current-new-ui.jpg` shows exactly what the source predicted: "Search"
  is a filled/primary button, "Query" / "Live" / "More filters" are
  plain/outlined secondary buttons. No repair needed here.
- **Active-filter chips: CONFIRMED broken relative to OLD, now with
  direct visual proof, not inference.** `old-01.jpg` shows each OLD chip
  with its own **✕ remove control** plus a **"Clear all"** button. The
  current app's `ActiveFilters.tsx` renders chips with no remove
  affordance at all (confirmed in source previously; now additionally
  confirmed as a real, visible OLD strength worth restoring, not a
  speculative one).
- **Settings — masking-policy visibility panel: CONFIRMED and more
  detailed than previously described.** `old-02.jpg`/`old-03.jpg` show a
  real "Sensitive data masking" panel: masking categories, a "Protected
  categories" chip list (Device ID, CIF/customer ID, Username, Device IP,
  Correlation/JWT, Session tokens, Authentication tokens, Card/account
  number), and a field-level masking table (each protected field →
  "Masked"). Confirms the previous `RESTORE` disposition; gives a concrete
  shape to restore, not just "some panel."
- **OLD's "unmask" capability: CONFIRMED, and confirmed disabled by
  policy even in OLD.** The same screenshots show explanatory text: *"This
  is a local development capability and automatically disabled in
  production... Authorization (RBAC) is not implemented, so unmasking is
  disabled in this deployment."* OLD itself gated this off outside local
  dev. Reinforces (does not change) the previous `KEEP_NEW`
  recommendation not to restore reveal/unmask — even OLD didn't enable it
  in any deployment that mattered.
- **Remote Docker Settings — a real, minor, previously-missed gap.**
  `old-04.jpg` shows a **"Connection name (optional)"** free-text field
  (a friendly label for the configured connection) that the current
  `DockerSettingsPanel.tsx` has no equivalent of (confirmed absent by
  source search). Small, safe, additive — not previously listed.
- **More Filters — per-field match-type labels are a real, minor gap.**
  `old-05.jpg`/`old-06.jpg` show every field labeled with its exact
  matching semantics (**EXACT MATCH** or **SUBSTRING**) next to the field
  itself. The current `advancedFilterFields.ts` grouping/labels/order
  already match OLD exactly (confirmed previously and still true), but
  this specific micro-affordance — telling the user *how* a field
  matches, not just what it is — was not previously identified and is a
  real, low-effort discoverability improvement.
- **Advanced query lives inside More Filters in OLD, not as a separate
  toolbar entry.** `old-06.jpg`/`old-07.jpg` show "Advanced query" as a
  collapsible section **nested inside the same More Filters drawer**
  (No-code builder / Text query / Raw query tabs within it), not a
  separate top-level "Query" button as in the current app. This is a real
  information-architecture difference, not previously flagged. Not
  automatically a defect — CURRENT's separate `QueryBuilder` popover is a
  reasonable alternative structure — but worth an explicit owner note
  since it changes where a user looks for guided-query authoring.
- **Row actions: OLD's menu is smaller and differently triggered than
  assumed.** `old-19.jpg` shows a compact popup with exactly **two**
  items — "View details" and "Show surrounding logs" — matching the
  mission's own "at minimum" list exactly. The textual OLD docs also
  mentioned find-same-ID actions (conditionally shown); the screenshot
  set does not happen to capture that state, so it is not re-confirmed or
  contradicted here. Separately: OLD's full-width, no-selection table
  view (`old-17.jpg`) shows **no persistent "Actions" column** at all —
  suggesting OLD's actions menu may be invoked via row hover/right-click
  rather than an always-visible button column. A right-click-only trigger
  would itself be a keyboard/touch accessibility regression if copied
  literally — **not recommended for literal restoration**; the current
  app's always-visible, keyboard-reachable "⋯ Actions for this event"
  button is the more accessible pattern and should be kept, with row
  click added alongside it (per the mission's own mandate), not
  instead of it.
- **Context/surrounding-logs summary stats: re-classified from
  `NEW_BETTER` to `SAME`.** `old-16.jpg` shows OLD's context view already
  had Events/Services/Errors/Duration/Window stats and the explicit
  "observed sequence, not a guaranteed causal graph" disclaimer — nearly
  identical in substance to the current app's own context summary. The
  previous pass's "NEW_BETTER" claim (based on "OLD was client-assembled,
  NEW has a dedicated endpoint") is a real backend-architecture
  improvement, but the *user-visible* richness is not actually better —
  it is a faithful match. Corrected to `SAME` for the UX dimension
  specifically (the backend-architecture improvement is real and
  unaffected, just not a *visible* UX win).
- **Columns popover: CONFIRMED matching structure.** `old-18.jpg` shows
  "Required columns (always shown)" + an optional-column checklist,
  structurally identical to the current `TableSettingsControl`'s model.
  No gap found.
- **Row/selected-state visual highlighting: CONFIRMED present in OLD**
  (`old-10.jpg` shows a clearly highlighted selected row) and already
  present in the current app (row highlighting already exists per prior
  slices' own work) — `SAME`, no action needed.
- **Sorting: OLD's control is now directly evidenced, not just claimed
  by textual docs.** `old-10.jpg`/`old-17.jpg` show "Newest first" as a
  label directly in the results toolbar, next to "Comfortable density" —
  consistent with (not contradicting) the textual docs' description of a
  real, backend-driven sort control. Strengthens the existing finding;
  does not change it.

## Visual forensic audit

Per-image findings (`SCREEN/STATE`, OLD purpose/actions/hierarchy,
`WHY_OLD_WORKS_WELL`, current equivalent/difference, impact, status,
remediation). Images are grouped where several consecutive files capture
the same screen/state (scrolled or with a different tab/value) — see
`docs/ux-reference/old-ui/README.md` for the exact file-to-content index.

---

**SCREEN/STATE=** Search workspace, empty state (`old-01.jpg`)
**OLD_PRIMARY_PURPOSE=** Compose and run a search
**OLD_PRIMARY_ACTION=** "Run Search" (filled/primary)
**OLD_SECONDARY_ACTIONS=** "Start Live" (filled, equal size to Run Search — see note), "More filters" (outlined)
**OLD_INFORMATION_HIERARCHY=** Source/service/time/severity across one toolbar row; search box below; actions below that; active-filter chips below that
**OLD_NAVIGATION_MODEL=** Single page; Live/Settings reachable from the same header
**OLD_WORKSPACE_COMPOSITION=** Toolbar → search box → action buttons → active filters → empty-state helper text ("Configure your search and click Run Search, or press Ctrl+Enter")
**OLD_TABLE/INSPECTOR_BEHAVIOR=** N/A (no results yet)
**WHY_OLD_WORKS_WELL=** Active-filter chips are individually removable (✕ per chip) plus one "Clear all" — the user can see and undo exactly what's scoping their search without reopening any panel.
**CURRENT_EQUIVALENT=** `Toolbar.tsx` + `ActiveFilters.tsx` — same overall composition and toolbar grouping
**CURRENT_DIFFERENCE=** Chips render but have no remove control at all (confirmed in source: `ActiveFilters.tsx` has no click handler, no ✕); "Live" is `variant="secondary"` in current vs. appearing visually equal-weight to Run Search in this OLD screenshot (a real, if minor, hierarchy difference — OLD gives Live nearly the same visual weight as Search, current makes it clearly secondary)
**USER_IMPACT=** HIGH (chip removal — a named mission requirement); LOW (Live button weight — a defensible NEW improvement, not obviously a regression)
**STATUS=** PARTIAL
**REMEDIATION=** RESTORE (chip removal + Clear all); KEEP_NEW (Live as secondary — a reasonable, arguably better hierarchy choice, not silently reversed but not flagged as broken either)

---

**SCREEN/STATE=** Settings — Local Docker + sensitive-data masking policy (`old-02.jpg`, `old-03.jpg`)
**OLD_PRIMARY_PURPOSE=** Configure/inspect the Docker connection; understand what's protected
**OLD_PRIMARY_ACTION=** "Save" (Docker connection)
**OLD_SECONDARY_ACTIONS=** Local/Remote toggle, keyboard-shortcuts popover
**OLD_INFORMATION_HIERARCHY=** Connection config first, masking policy panel below it on the same page (not a separate tab)
**OLD_NAVIGATION_MODEL=** Single Settings page, no sub-navigation
**OLD_WORKSPACE_COMPOSITION=** Docker connection card → Sensitive data masking card (masking categories, protected categories, field-level masking table, unmask capability with its own disabled-by-policy explanation)
**OLD_TABLE/INSPECTOR_BEHAVIOR=** N/A
**WHY_OLD_WORKS_WELL=** A user can answer "what is Log Explorer protecting me from seeing/leaking" without leaving Settings or guessing.
**CURRENT_EQUIVALENT=** `DockerSettingsPanel.tsx`
**CURRENT_DIFFERENCE=** Connection config present and equivalent; **no masking-policy panel exists at all** (confirmed absent by source search)
**USER_IMPACT=** MEDIUM
**STATUS=** MISSING
**REMEDIATION=** RESTORE (informational only — protected-category list + field-level masking table; **never** the unmask control, which OLD itself disabled outside local dev)

---

**SCREEN/STATE=** Settings — Remote Docker (`old-04.jpg`)
**OLD_PRIMARY_PURPOSE=** Configure a remote Docker Engine connection
**OLD_PRIMARY_ACTION=** "Save"
**OLD_SECONDARY_ACTIONS=** "Reset to Local"
**OLD_INFORMATION_HIERARCHY=** Connection name → Host → Port (Auto/Custom) → TLS toggle → inline security explanation → actions
**OLD_NAVIGATION_MODEL=** Same Settings page, mode toggle
**OLD_WORKSPACE_COMPOSITION=** Form fields + one inline warning ("Not encrypted: an insecure (non-TLS) connection is only permitted to administrator-approved hosts")
**OLD_TABLE/INSPECTOR_BEHAVIOR=** N/A
**WHY_OLD_WORKS_WELL=** The optional "Connection name" lets a user label *which* remote engine they're pointing at when they have more than one to remember; the inline TLS warning explains the security posture in place, not just a bare toggle.
**CURRENT_EQUIVALENT=** `DockerSettingsPanel.tsx` remote-mode fields
**CURRENT_DIFFERENCE=** Host/Port/TLS/Test Connection all present and equivalent; no "Connection name" field
**USER_IMPACT=** LOW
**STATUS=** PARTIAL
**REMEDIATION=** RESTORE (small, additive, optional field — low effort/low risk)

---

**SCREEN/STATE=** More Filters drawer — Who/customer, Request flow, What happened, Client context (`old-05.jpg`, `old-06.jpg`)
**OLD_PRIMARY_PURPOSE=** Compose protected/structured filters before running a search
**OLD_PRIMARY_ACTION=** "Apply filters"
**OLD_SECONDARY_ACTIONS=** Cancel, Reset advanced filters
**OLD_INFORMATION_HIERARCHY=** Grouped by investigation question, each field with a placeholder example and a match-type badge
**OLD_NAVIGATION_MODEL=** A docked drawer; results dimmed but visible behind it
**OLD_WORKSPACE_COMPOSITION=** WHO/CUSTOMER → REQUEST FLOW → WHAT HAPPENED → CLIENT CONTEXT → (Advanced query, collapsed)
**OLD_TABLE/INSPECTOR_BEHAVIOR=** N/A
**WHY_OLD_WORKS_WELL=** Every field states its own match semantics (EXACT MATCH / SUBSTRING) right next to the input, and protected fields explicitly say "Results are masked — the raw value is never stored, logged, or shown" inline, at the point of use.
**CURRENT_EQUIVALENT=** `AdvancedFilters.tsx` / `advancedFilterFields.ts`
**CURRENT_DIFFERENCE=** Grouping, field list, and order are an exact match (confirmed, no gap); Apply/Cancel/Reset/active-count all present and confirmed working (`FILTER_FUNCTIONAL_AUDIT.md`); **no per-field match-type label** and no inline "results are masked" microcopy on protected fields
**USER_IMPACT=** LOW–MEDIUM (discoverability, not function — filters already work per the functional audit)
**STATUS=** PARTIAL
**REMEDIATION=** RESTORE (small copy/label additions only)

---

**SCREEN/STATE=** Advanced query — no-code builder, text query (`old-07.jpg`, `old-08.jpg`, `old-09.jpg`)
**OLD_PRIMARY_PURPOSE=** Author a guided or free-text query
**OLD_PRIMARY_ACTION=** "Apply filters" (shared with the rest of the drawer)
**OLD_SECONDARY_ACTIONS=** Add condition / Add group, AND/OR join, Remove
**OLD_INFORMATION_HIERARCHY=** Mode tabs (No-code builder / Text query / Raw query) nested inside the More Filters drawer, below the structured fields
**OLD_NAVIGATION_MODEL=** Same drawer, no separate popover
**OLD_WORKSPACE_COMPOSITION=** Field/Operator/Value row(s), a live "Generated query" preview string
**OLD_TABLE/INSPECTOR_BEHAVIOR=** N/A
**WHY_OLD_WORKS_WELL=** Guided query authoring lives in the same place as every other filter, not a separate mental context; the generated-query preview confirms what will actually run before Apply.
**CURRENT_EQUIVALENT=** `QueryBuilder.tsx`, a separate top-level "Query" toolbar button/popover
**CURRENT_DIFFERENCE=** Same Field/Operator/Value/AND-OR model and a generated-query preview both confirmed present (functional audit); the only difference is *where* it lives — its own toolbar entry vs. nested in More Filters
**USER_IMPACT=** LOW (a genuine IA difference, not a functional or clarity regression — arguably CURRENT's separate entry point is easier to find, not harder)
**STATUS=** PARTIAL (structural, not functional)
**REMEDIATION=** DEFER — flag for an explicit owner call on IA placement rather than assuming either is wrong; not a repair item on its own

---

**SCREEN/STATE=** Results table + Event Inspector, five tabs (`old-10.jpg`–`old-15.jpg`)
**OLD_PRIMARY_PURPOSE=** Scan results, select one, understand it in depth
**OLD_PRIMARY_ACTION=** Click a row to select + inspect
**OLD_SECONDARY_ACTIONS=** Previous/Next (with a "1/100" position indicator), tab switching, "Show surrounding logs"
**OLD_INFORMATION_HIERARCHY=** Table columns: Time, Date, What happened, Level, Service, User/Customer (+ Correlation/Trace when visible); inspector: title + level/service chip → tabs → sectioned key/value content
**OLD_NAVIGATION_MODEL=** Table + right-side inspector shown together, comparable proportions to the current app (roughly a 60/40 split in both)
**OLD_WORKSPACE_COMPOSITION=** Overview (When/What happened/Where) → Actor & client → Request flow → Business & error → All fields (searchable, canonical fields first, raw JSON behind a further disclosure) — all five confirmed, content-complete, not placeholders
**OLD_TABLE/INSPECTOR_BEHAVIOR=** Selected row visibly highlighted; "Show surrounding logs" context action is visible and available from more than one tab, not buried in just one
**WHY_OLD_WORKS_WELL=** The inspector never makes the user hunt for the one action (surrounding logs) they're most likely to want next; Previous/Next shows *where* the user is in the result set ("1/100"), not just that navigation exists.
**CURRENT_EQUIVALENT=** `EventInspector.tsx` + its five section components, `ResultsTable.tsx`
**CURRENT_DIFFERENCE=** All five sections present with equivalent content depth (confirmed, no gap); Previous/Next present (Slice 8 keyboard shortcuts too) but **without a position indicator** ("1/100"-style); "Show surrounding logs" is reachable from the Request Flow section and the row Actions menu, not from every tab
**USER_IMPACT=** LOW–MEDIUM
**STATUS=** PARTIAL
**REMEDIATION=** RESTORE (Previous/Next position indicator — small, real orientation aid); DEFER (surrounding-logs-from-every-tab — a nice-to-have, not a named mission requirement, lower priority than the row-click/chip items)

---

**SCREEN/STATE=** Context / surrounding logs (`old-16.jpg`)
**OLD_PRIMARY_PURPOSE=** Understand what else happened around one event
**OLD_PRIMARY_ACTION=** (arrived at via "Show surrounding logs")
**OLD_SECONDARY_ACTIONS=** Service/severity filters, Errors-only toggle, Copy
**OLD_INFORMATION_HIERARCHY=** Stats row (Events/Services/Errors/Duration/Window) → disclaimer → chronological list, root event still selectable/inspectable
**OLD_NAVIGATION_MODEL=** Replaces the results area; inspector stays open beside it
**OLD_WORKSPACE_COMPOSITION=** "CONTEXT" badge, stats, "OBSERVED SEQUENCE... not a guaranteed causal graph" disclaimer, filterable event list
**OLD_TABLE/INSPECTOR_BEHAVIOR=** Root/selected event visually distinguished with a colored marker
**WHY_OLD_WORKS_WELL=** States the exact bounded window and count up front, and is explicit that order ≠ causality, in the same breath as showing the timeline — matches this project's own non-negotiable rule already.
**CURRENT_EQUIVALENT=** The context view built on Slice 6's own gap-detection/summary work
**CURRENT_DIFFERENCE=** Event/service/error counts, duration, window, and the non-causality disclaimer are all already present (confirmed by this project's own Slice 6 E2E coverage, re-verified green throughout this session) — **no gap found**
**USER_IMPACT=** —
**STATUS=** SAME (re-classified from the previous pass's `NEW_BETTER` — see "Corrections" above)
**REMEDIATION=** KEEP_NEW

---

**SCREEN/STATE=** Results table, full width, no selection (`old-17.jpg`)
**OLD_PRIMARY_PURPOSE=** Scan a full page of results
**OLD_PRIMARY_ACTION=** Click a row
**OLD_SECONDARY_ACTIONS=** "Reset order", "Refresh", "Load next page"
**OLD_INFORMATION_HIERARCHY=** Time/Date/What happened/Level/Service/User-Customer/Correlation-Trace columns; **no persistent Actions column**
**OLD_NAVIGATION_MODEL=** N/A
**OLD_WORKSPACE_COMPOSITION=** N/A
**OLD_TABLE/INSPECTOR_BEHAVIOR=** No row highlighted; message column reads as the dominant, widest column
**WHY_OLD_WORKS_WELL=** With no persistent Actions column, the table reads cleaner and the message column gets more room — consistent with the mission's own "Message/What Happened should be the dominant flexible column."
**CURRENT_EQUIVALENT=** `ResultsTable.tsx`, seven fixed columns including a persistent Actions column (confirmed via real browser session: `["TIME","LEVEL","SERVICE","WHAT HAPPENED","USER/CUSTOMER","CORRELATION/TRACE","ACTIONS"]`)
**CURRENT_DIFFERENCE=** CURRENT always reserves a column for Actions; OLD does not
**USER_IMPACT=** LOW — this is a genuine, if minor, density trade-off, not a functional gap; CURRENT's always-visible Actions column is also what makes it keyboard/touch-accessible without relying on hover or right-click (see the row-actions finding above)
**STATUS=** PARTIAL (a real trade-off, not a defect either way)
**REMEDIATION=** KEEP_NEW — the accessible, always-visible Actions column is the better default; adding row click (per the mission's own mandate) achieves OLD's "click anywhere on the row" convenience without removing the accessible column

---

**SCREEN/STATE=** Columns customization popover (`old-18.jpg`)
**OLD_PRIMARY_PURPOSE=** Show/hide optional columns
**OLD_PRIMARY_ACTION=** Toggle a checkbox
**OLD_SECONDARY_ACTIONS=** (implicit — no explicit Apply, changes are live)
**OLD_INFORMATION_HIERARCHY=** "Required columns (always shown)" statement, then an optional-column checklist
**OLD_NAVIGATION_MODEL=** Popover
**OLD_WORKSPACE_COMPOSITION=** N/A
**OLD_TABLE/INSPECTOR_BEHAVIOR=** N/A
**WHY_OLD_WORKS_WELL=** States plainly which columns can never be hidden, so the user never wonders why a toggle "didn't work."
**CURRENT_EQUIVALENT=** `TableSettingsControl.tsx`
**CURRENT_DIFFERENCE=** None found — structurally equivalent (required-vs-optional model, live application, no separate Apply step, matches Slice 4's own design)
**USER_IMPACT=** —
**STATUS=** SAME
**REMEDIATION=** KEEP_NEW

---

**SCREEN/STATE=** Row actions menu (`old-19.jpg`)
**OLD_PRIMARY_PURPOSE=** Act on one row without selecting/opening it fully
**OLD_PRIMARY_ACTION=** "View details"
**OLD_SECONDARY_ACTIONS=** "Show surrounding logs"
**OLD_INFORMATION_HIERARCHY=** A compact two-item popup, no icons, no extra chrome
**OLD_NAVIGATION_MODEL=** N/A
**OLD_WORKSPACE_COMPOSITION=** N/A
**OLD_TABLE/INSPECTOR_BEHAVIOR=** N/A
**WHY_OLD_WORKS_WELL=** Exactly the two actions a user needs most, nothing more — no menu-hunting.
**CURRENT_EQUIVALENT=** `ActionsCell.tsx`'s "⋯ Actions for this event" menu
**CURRENT_DIFFERENCE=** CURRENT's menu already includes "Inspect event" and "Show ±30 seconds" (both matching), plus conditionally-shown "Find this Trace/Correlation/Journey ID" items OLD's own textual docs describe but this screenshot set doesn't happen to capture in an ID-present state — **no functional gap found**, and CURRENT's button-triggered (not right-click-triggered) menu is the more accessible pattern
**USER_IMPACT=** —
**STATUS=** SAME
**REMEDIATION=** KEEP_NEW

---

**SCREEN/STATE=** Current/NEW application, results + inspector (`current-new-ui.jpg`)
**OLD_PRIMARY_PURPOSE=** N/A — this is the comparison anchor, not an OLD screen
**CURRENT_EQUIVALENT=** N/A
**CURRENT_DIFFERENCE=** Directly confirms: Search is the filled/primary button, Query/Live/More filters are outlined/secondary (matches source, corrects the mid-session duplicate document's uncertainty on this point); seven-column table with a persistent Actions column; inspector shows Compose project per-event (`boobyan-platform-cards-1`) already, matching OLD's own "WHERE" section field; overall density and proportions (table-to-inspector split) closely comparable to OLD's own `old-10.jpg`
**USER_IMPACT=** —
**STATUS=** Used as corroborating evidence throughout the rows above, not scored independently
**REMEDIATION=** N/A

---

## Findings summary table (corrected)

| Area | Status | Impact | Disposition |
|---|---|---|---|
| Shell/navigation | SAME | LOW | KEEP_NEW |
| Search workspace button hierarchy | SAME (confirmed via screenshot) | — | KEEP_NEW |
| Active filter chips (not individually removable) | MISSING (now visually confirmed) | HIGH | RESTORE |
| More Filters grouping/fields | SAME | — | KEEP_NEW |
| More Filters per-field match-type labels | MISSING | LOW–MEDIUM | RESTORE |
| Advanced query IA placement (nested vs. separate) | PARTIAL (structural, not functional) | LOW | DEFER (owner call) |
| Settings — masking-policy visibility panel | MISSING | MEDIUM | RESTORE (informational only) |
| Settings — Remote Docker "Connection name" field | MISSING | LOW | RESTORE |
| Settings — Docker connection core fields | SAME | LOW | KEEP_NEW |
| Settings — reveal/unmask action | N/A in current (correctly) | — | KEEP_NEW (never restore — OLD itself disabled it outside local dev) |
| Docker Compose project selector | MISSING (new capability, not OLD regression) | HIGH | IMPLEMENT — security model now owner-resolved (see below) |
| Row click → inspector | MISSING | CRITICAL | RESTORE |
| Row Actions column/menu | SAME (CURRENT's pattern is more accessible) | — | KEEP_NEW |
| Sorting | MISSING relative to OLD | HIGH | RESTORE — now owner-approved (see below), with truthfulness constraints |
| Pagination model | NEW_BETTER | — | KEEP_NEW |
| Column customization | SAME | — | KEEP_NEW |
| Event Inspector sections/content | SAME | — | KEEP_NEW |
| Event Inspector Previous/Next position indicator | MISSING | LOW–MEDIUM | RESTORE |
| Context/surrounding logs | SAME (corrected from NEW_BETTER) | — | KEEP_NEW |
| Live core mechanics | SAME/NEW_BETTER | — | KEEP_NEW |
| Live confirm-before-start dialog | N/A in current | — | KEEP_NEW — now owner-decided: do NOT restore (see below) |
| Core filter functionality | PASS (see `FILTER_FUNCTIONAL_AUDIT.md`) | — | KEEP_NEW |

No arbitrary percentage is offered as the headline conclusion — the table
above is the actual finding.

## Owner decisions — now resolved by explicit direction

The following were open questions in the previous pass. The owner's own
mission text for this pass resolves them directly; recorded here as
settled, not re-opened:

1. **Sorting**: *"Sorting — OWNER APPROVED. Restore truthful backend/
   source-backed sorting. At minimum: Newest first, Oldest first... Do
   not present current-page-only sorting as global sorting."* Resolved:
   restore, bounded to what can be genuinely truthful. `SearchRequest
   #direction` already exists backend-side and is unused by any UI
   control today — the backend capability is not new work, only wiring a
   control to it and confirming which additional fields (if any) can be
   sorted server-side/source-natively before exposing them.
2. **Live's confirm-before-start dialog**: *"Do NOT restore OLD
   confirmation-before-start... ONE-CLICK START LIVE remains."* Resolved:
   keep the current frictionless start. The mission asks instead to
   assess whether OLD communicated Live's own state *better* visually
   (source/project/services/filters/connection state) without
   reintroducing the confirm step — not yet assessed in this pass (no
   OLD Live screenshot was included in the supplied set); flagged as a
   remaining gap in evidence, not a decision left open.
3. **Compose project selector mutation scope**: *"Do NOT implement an
   unauthenticated GLOBAL runtime mutation endpoint. Use request/
   session-scoped project selection... UI selectedComposeProject → service/
   search/live/context/journey request → backend validates selected
   Compose project → Docker source applies canonical Compose-label
   boundary... Selected Compose project may be persisted as an approved
   safe UI preference, but this persistence is NOT authorization."*
   Resolved: option (a) from the previous pass's own candidate list
   (a per-request parameter, never a global server-side mutation) is now
   the owner-approved direction — consistent with, and directly
   unblocking, the security tension this audit's previous pass raised
   against `DockerSettingsController`'s deliberate no-mutation-endpoint
   design. The request-scoped model does not need a new mutation
   endpoint at all — it needs the selected project threaded through
   existing request DTOs (search/context/journey/live) and validated
   server-side against the real discovered project list on each request,
   which is compatible with the existing no-global-mutation boundary.
4. **Broader safe-preference persistence**: the mission's own "Safe
   preference decision" section explicitly approves persisting selected
   source, **selected Compose project**, time preset, severity, query
   mode, and table preferences (already persisted) — and explicitly
   forbids persisting free-text query values, raw LogQL, any of the five
   protected fields, trace/correlation values that may be sensitive
   investigation inputs, results, or credentials/tokens/secrets.
   Resolved: restore the approved list; the forbidden list matches (and
   is a superset of) what `frontend/README.md`'s existing "Persistence
   rules" section already enforces for the forbidden half — extending the
   *allowed* list is additive to Slice 8's existing versioned-schema
   model (`tablePreferences.ts`), not a new persistence mechanism.

## Docker Compose project selector — current state and resolved model

```
DOCKER_COMPOSE_SELECTOR_CURRENT=NOT_IMPLEMENTED (backend: a single static config-time value, LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER, no discovery endpoint; frontend: read-only display only, no selector)
COMPOSE_RUNTIME_SWITCH_CURRENT=NOT_IMPLEMENTED (requires an app restart)
COMPOSE_SECURITY_MODEL_CONFIRMED=YES — request/session-scoped selection (owner-resolved this pass), never a global unauthenticated mutation endpoint; consistent with the existing DockerLogSource#relevantContainers hard-boundary mechanism (already correct, already canonical-Compose-label-based) and with DockerSettingsController's own prior no-mutation-endpoint decision
```

Concrete shape (design-level, not implemented this pass): a new read-only
discovery endpoint (e.g. `GET /api/v1/sources/docker/compose-projects`,
mirroring the existing `DockerSettingsController`'s read-only pattern)
listing the distinct `com.docker.compose.project` label values visible on
the connected engine; the selected project becomes a field on the
existing search/context/journey/live request DTOs (alongside `sourceId`),
validated server-side against that real discovered list on every request
— never trusted blindly, never a stored global setting a *different*
concurrent client could be affected by. `DockerLogSource
#relevantContainers` already centralizes the actual boundary enforcement
and already uses the canonical label; only its currently-static
`properties.getComposeProjectFilter()` read needs to become a
per-request value.

The main investigation scope should show the selected project prominently
(mission's own example: `LOCAL · Docker Compose · payments-platform`) —
not designed this pass, flagged for UX-R3.

## Isolation test — not yet run

The mission's own two-overlapping-project isolation test (`project-a`/
`project-b`, both with `payments`/`cards` services, proving zero
cross-project leakage in either direction) requires the selector to
actually exist first. **Not run this pass** (no implementation exists
yet to test) — this is the first verification step UX-R3 must include
before that slice can be considered done, not before.

## Filter functional audit — not closed

Per the mission's explicit instruction, the filter-functional question is
**not** closed by the previous pass's representative sample. That
sample (`FILTER_FUNCTIONAL_AUDIT.md`) remains real, valid evidence — no
broken filter was found — but is explicitly not exhaustive (about 10 of
17+ advanced fields were confirmed only by source trace, not empirically;
Docker/Loki adapter-specific push-down was not independently
re-verified; only one two-field combination was tested). The exhaustive
matrix the mission asks for (every field, both included/excluded
assertions, real Docker/Fixture data, Loki marked environment-blocked if
unavailable) is **not done in this pass** — proposed as UX-R2's own scope,
unchanged from the previous pass's recommendation.

```
FILTER_AUDIT_STATUS=PASS (representative sample only, not exhaustive — see FILTER_FUNCTIONAL_AUDIT.md)
FILTERS_CONFIRMED_BROKEN=none
FILTERS_CONFIRMED_WORKING=text, traceId, errorCode, businessStep+errorCode (combined), customerId (sensitive), guided Query builder DSL
FILTERS_UNVERIFIED=userName, cif, deviceId, deviceIp, spanId, correlationId, journeyId, eventId, uiIdentifier, loggerContains, devicePlatform, language (source-confirmed only, not empirically tested); Docker/Loki adapter-specific push-down; combinations beyond one two-field case; time range/severity (older, lower-risk paths, not re-tested)
```

## Not yet done (honest gaps in this pass)

- A full new screenshot set of the *current* app across every state the
  mission's "Browser verification" section lists (empty search,
  populated results, event selected, actions menu, inspector, More
  Filters, advanced query, Settings local/remote, Compose selector
  [doesn't exist yet], context, Live, columns menu) — only the one
  owner-supplied current-app screenshot was available/reviewed this pass.
- The exhaustive filter matrix (UX-R2's own scope).
- The Compose-project isolation test (requires UX-R3's implementation to
  exist first).
- Live's OLD visual/state-communication quality specifically (no OLD Live
  screenshot was included in the supplied set) — the mechanics comparison
  stands, but the *visual* comparison the mission asks for
  ("communicated... better?") could not be evaluated without one.
- Responsive/mobile (390px etc.) comparison against OLD — no OLD narrow-
  viewport screenshot was supplied; the current app's own 390px E2E
  coverage (from prior slices) remains the only evidence on that axis.

## Final remediation plan

Per the mission's own required slice list, unchanged in name/scope from
what was requested (previous pass's proposed re-grouping is superseded by
this explicit list):

- **UX-R1** — Application shell + Search workspace + active scope +
  navigation restoration. Scope, given this pass's evidence: restore
  removable active-filter chips + Clear all; restore per-field match-type
  labels in More Filters; add the "Connection name" field to Remote
  Docker Settings. Shell/navigation/button-hierarchy itself needs no
  change (confirmed `SAME`).
- **UX-R2** — Exhaustive filters + More Filters + advanced-query UX
  correction. Scope: the full filter matrix (every field, included/
  excluded assertions, real data); resolve the More-Filters-vs-separate-
  Query IA placement question with the owner; no functional repair is
  currently known to be needed.
- **UX-R3** — Docker Settings completeness + runtime Compose project
  selector. Scope: masking-policy visibility panel (Settings); the
  Compose-project discovery endpoint + request-scoped selector (design
  above); the isolation test; project-switch UX (cancel/supersede
  in-flight work, refresh project-specific services, prevent stale
  cross-project results, update visible scope immediately — per the
  mission's own "Project switch behavior" section, not detailed further
  in this pass).
- **UX-R4** — Results investigation workstation: row click (mandatory),
  selected-state (already present), truthful sorting (Newest/Oldest
  first, owner-approved), columns (already `SAME`), row actions (already
  `SAME`), removable chips (moved to UX-R1 per the evidence above, since
  it's a search-workspace-scoped control, not a table one — flag for
  owner confirmation of slice placement), Previous/Next position
  indicator in the inspector.
- **UX-R5** — Inspector + surrounding/context workflow restoration.
  Scope, given this pass's evidence: already `SAME` across the board;
  likely a short verification-only slice plus the Previous/Next position
  indicator (or move that item to UX-R4, since it's inspector-scoped —
  same cross-slice placement note as above).
- **UX-R6** — Final visual hierarchy + responsive + accessibility +
  performance polish, informed by whatever UX-R1–R5 actually change, plus
  the still-missing responsive/OLD comparison and Live-visual-comparison
  evidence gaps noted above.

```
FINAL_REMEDIATION_SLICES=UX-R1 (shell/search/chips/labels), UX-R2 (exhaustive filter matrix + query IA decision), UX-R3 (Settings masking panel + Compose project selector, request-scoped), UX-R4 (row click + sorting + inspector position indicator), UX-R5 (inspector/context verification), UX-R6 (final polish)
RECOMMENDED_FIRST_IMPLEMENTATION_SLICE=UX-R1 — the highest-confidence, lowest-risk, purely-additive items (chip removal, match-type labels, Connection name field) are ready now with zero open decisions, and directly address the owner's most visible, most-screenshotted complaint (active-scope clarity). Row-click (UX-R4) remains a strong, equally-ready second candidate; UX-R3 (Compose selector) is now unblocked on the security-model question but is the largest single slice and benefits from UX-R1's smaller wins landing first.
```

## Owner decisions still required

Only the items the owner's own mission text did not already resolve:

1. **Advanced query IA placement** — keep the current separate "Query"
   toolbar entry, or nest it back inside More Filters as OLD did?
2. **UX-R4 vs. UX-R1 slice placement** for active-filter-chip removal and
   the inspector Previous/Next position indicator (both are small enough
   to land in either neighboring slice — a sequencing preference, not a
   scope question).
3. Confirm **UX-R1 as the recommended first slice** (or redirect
   priority, e.g. straight to UX-R4's row-click, or UX-R3 given it carries
   the most-requested new capability).
