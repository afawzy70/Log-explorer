# OLD UX Restoration Audit — LERUX-1

Using `log-explorer-professional-ux-reviewer` [LERUX-1] (this repository's
own project-local skill, `.claude/skills/log-explorer-professional-ux-reviewer/SKILL.md`
— created for this mission; see "UX capability readiness" below for why).

First-pass **audit + functional diagnosis + implementation plan**, per the
mission's own explicit scope. No broad UX restoration has been implemented
in this pass.

## UX capability readiness

No `react-ui-bug-checker` skill (with or without the `RUIBC-OPENCODE-1`
marker) exists anywhere on this machine — searched `~/.claude/skills/`,
every installed plugin's `skills/` directory
(`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/*/skills/`),
and the project. The closest installed candidate, the `frontend-design`
plugin/skill, is a **visual-aesthetic** design tool (typography, color,
layout choices for building distinctive-looking new UI) — not a
diagnostic/verification tool, and explicitly out of scope for "does this
filter actually work" or "trace API → state → DOM" work. Using it would
misapply an aesthetic-design skill to a functional-diagnosis job.

Per the mission's own decision tree (search project sources → trusted
repos already referenced by the project's own tooling → never install
arbitrary code found by popularity), no trusted external source for this
exact capability is referenced anywhere in this project's own
configuration or docs, so the correct, safe path is the final fallback:
create a project-local skill. Confirmed the correct location by asking
first rather than guessing (`.claude/skills/<name>/SKILL.md` at the repo
root, auto-discovered, per current Claude Code documentation) and created
`log-explorer-professional-ux-reviewer`, encoding this mission's exact
review contract (five-layer trace for functional claims, rendered-browser
evidence first, old-vs-new comparison protocol, investigation-workflow
lens) on top of this repository's own pre-existing `CLAUDE.md` §6 visual-
bug-debugging discipline.

```
UX_CAPABILITY_GATE=PASS
UX_SKILL_NAME=log-explorer-professional-ux-reviewer
UX_SKILL_PROTOCOL_OR_VERSION=LERUX-1
UX_SKILL_SOURCE=project-local, authored this session, .claude/skills/log-explorer-professional-ux-reviewer/SKILL.md
UX_SKILL_LOADED=YES
UX_REVIEW_AGENT=one fork (subagent) used for read-heavy OLD-documentation synthesis; audit owner (this session) retained direct control of all findings/classifications
UX_AGENT_REQUIRED=NO (a research fork was used for efficiency, not because an independent review agent was structurally required)
UX_CAPABILITY_CREATED_OR_FETCHED=YES (created, not fetched)
UX_CAPABILITY_PROVENANCE_VERIFIED=YES (authored in this session against this repo's own conventions; no external code executed)
```

## Method

- Read `legacy-app-docs/UX_SPEC.md`, `UX_ACCEPTANCE_REPORT.md`,
  `MVP_SPEC.md`, and all 19 `audit/AUDIT-*.md` files in full (via a
  research fork, to keep the ~800-line synthesis out of this document's
  own drafting context — findings below are drawn directly from that
  synthesis, cross-checked against the source files' own section numbers).
- Read the current frontend/backend source directly for every area under
  review (not assumed from memory of earlier slices).
- Ran the real dev-profile backend (`SPRING_PROFILES_ACTIVE=dev`, Fixture
  source) and drove it both via direct HTTP calls and real Playwright runs
  against the real dev server, capturing actual request/response payloads
  — see the companion `FILTER_FUNCTIONAL_AUDIT.md` for the full evidence
  trail.
- **`OLD_SCREENSHOTS_REVIEWED=NO`** — stated plainly: no OLD-application
  screenshot image file exists anywhere in this repository. Every `.png`
  under `docs/verification/` is a screenshot of the *current* (NEW)
  application from earlier phases' own verification work, not the OLD
  app. The only OLD-app evidence available is the textual documentation
  above, which is itself the product of an earlier, real, code-grounded
  audit of the OLD application (not invented for this pass). Treated as
  authoritative for OLD *behavior and intent*, not as a pixel template.
- **`CURRENT_APP_RENDERED_REVIEW=YES`** — the current app was actually run
  and driven for the filter-wiring verification below; a full
  screen-by-screen rendered walkthrough of every area listed in the
  mission's "Browser verification" section was **not** completed in this
  pass (see "Not yet done" at the end) — this first pass prioritized
  establishing filter functional truth (the most severe open question)
  and the OLD-vs-current comparison table over an exhaustive new
  screenshot set, given the scope of a diagnosis-only pass.

## Critical correction to the mission's own framing

**The OLD application never had a Docker Compose project selector either.**
Confirmed independently in three OLD-app audit documents
(`AUDIT-09-SETTINGS.md`, `AUDIT-01-FRONTEND-SURFACE.md`, `AUDIT-18-SECOND-PASS-SUMMARY.md`):
*"There is no project-filter / exclusion-label field in the frontend
DockerConnectionPanel even though the backend supports
`logexplorer.docker.project-filter`..."* — this was a documented **gap in
OLD itself**, not a OLD strength to restore. Section 5 of this mission is
therefore a genuinely new capability to build, not a restoration — noted
here so the rest of this document doesn't mis-cite it as "OLD had this."

Also worth flagging: OLD had a **masking status panel with a dev-gated,
TTL-based "unmask" capability** that could reveal raw sensitive values.
This directly conflicts with this project's own non-negotiable "no
reveal action, ever" rule (`CLAUDE.md` §2 rule 5). **Recommended
disposition: `KEEP_NEW`, do not restore.** OLD's *masking-policy
visibility* (what's protected, what's always masked) is a real, safe OLD
strength worth restoring; the reveal action itself is not.

## Findings: OLD behavior vs. current behavior

| Area | OLD behavior | Current behavior | Status | User impact | Disposition |
|---|---|---|---|---|---|
| Shell/nav | Single page, `<h1>Log Explorer</h1>`, source badge, Search/Settings header buttons, compact health indicator, shortcuts-help popover; Live/Query were in-workspace modes, not separate pages | Same shape: `Shell.tsx` header (title, environment badge, source name, health badge), `KeyboardShortcutsHelp`, `DockerSettingsPanel`; Live/Query are toolbar actions within the one workspace, not separate routes | `SAME` | LOW | `KEEP_NEW` |
| Search workspace composition | Source bar → toolbar (universal search, time range, severity, Run/Cancel) → active-filter chips → More Filters panel → results | `Toolbar.tsx`: source select, service multi-select, time range trigger, severity toggle, universal search, Search/Query/Live buttons, More Filters trigger — same composition, same primary-action framing (Search is the one filled/primary button; Live/Query/More Filters are secondary) | `SAME` | LOW | `KEEP_NEW` |
| More Filters grouping | Who/customer, Request flow, What happened, Client context, Advanced query (exact, source-verified) | `advancedFilterFields.ts`'s `ADVANCED_FILTER_GROUPS`: **identical** four groups, identical field lists and order, plus a separate `QueryBuilder.tsx` for guided/text/raw-LogQL — **this is already fully restored**, not a gap | `SAME` | — | `KEEP_NEW` (already matches; no action needed) |
| More Filters draft/apply/cancel/reset | Draft state, Apply/Cancel/Reset, active-count badge, masked chips | `AdvancedFilters.tsx`: same draft/Apply/Cancel/Reset model (confirmed in code and Slice 8's own persistence tests), active-count badge on the trigger | `SAME` | — | `KEEP_NEW` |
| Docker Compose project selection | **Did not exist in OLD** (documented gap) | Does not exist in current app either — a static, deployment-time-only, single-value `LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER` env var, read-only-displayed in Settings, no discovery/selection UI, no runtime change without a restart | `MISSING` (as a genuinely new capability, not a restoration) | HIGH (explicit new owner requirement) | `RESTORE`→ build fresh, not "restore" |
| Settings — masking/security visibility | A masking-status panel (protected categories, what's always masked) | `SourceHealthBadge`/inspector show masking is happening, but there's no dedicated "what's protected and why" panel in Settings itself | `PARTIAL` | MEDIUM | `RESTORE` (visibility only — never the OLD reveal/unmask action) |
| Settings — Docker connection fields | Local/Remote, host, port, TLS, Test/Save/Reset | `DockerSettingsPanel.tsx`: Local/Remote, host, port, TLS, Test Connection — same shape, already present | `SAME` | LOW | `KEEP_NEW` |
| Results table columns | Time, Level, Service, Message (dominant), User/Customer, Correlation, + optional columns | `columnRegistry.ts`: same seven default/optional-column model (Slice 4), message ("What happened") stays the dominant flexible column | `SAME`/`NEW_BETTER` (versioned, defensively-validated persistence OLD didn't have) | — | `KEEP_NEW` |
| **Row click → inspector** | Row click selected the row AND opened the inspector directly (confirmed, `AUDIT-05` §3 + `AUDIT-02` §8) | No `onClick` on `<tr>` at all (confirmed in `ResultsTable.tsx`) — opening the inspector requires the row's "⋯" Actions menu → "Inspect event" | `MISSING` | **HIGH** (this mission's own §8 explicitly makes it mandatory, superseding the prior Slice 4 deferral) | `RESTORE` |
| Sorting | Real, backend-driven — changing sort direction re-ran the actual search (`SearchRequest#direction`) | No sort control anywhere in the frontend; table is always newest-first by construction. `SearchRequest#direction` still exists backend-side (`BACKWARD` default), unused by any UI control. This was a **prior, owner-approved decision** (capability matrix `TABLE-05`, `SUPERSEDED_BY_OWNER_DECISION`) | `MISSING` (relative to OLD) | MEDIUM | `OWNER_DECISION_REQUIRED` — restoring real (not fake/page-local) sort is feasible given the backend field already exists, but this reverses a previously-approved decision; flagging rather than silently reversing or silently keeping |
| Load more / pagination | `limit+100` re-query with client-side dedup-append; **not** true cursor pagination, `nextCursor` always null server-side | Real HMAC-signed opaque cursor pagination (`PageCursorCodec`, Legacy Remediation Slice 1) | `NEW_BETTER` | — | `KEEP_NEW` |
| Row actions menu | "⋯" menu: view details, show surrounding context, find-same-ID (only when the ID is present) | `ActionsCell.tsx`: "Inspect event", "Show ±30 seconds" (when a timestamp exists), "Find this Trace/Correlation/Journey ID" (only when present) — same shape | `SAME` | — | `KEEP_NEW` |
| Event Inspector sections | Overview, Actor & client, Request flow, Business & error, All fields — five tabs, resizable, Previous/Next/Close, focus-trapped | `EventInspector.tsx`: same five sections, same resizable-panel/Previous-Next-Close model (Slice 8 keyboard shortcuts included) | `SAME` | — | `KEEP_NEW` |
| Context / surrounding logs | `±30s`, source-scoped, client-assembled from a flat search result, "← Return to search" breadcrumb | `±30s` context via a dedicated `/context` endpoint (server-side, container/pod-scoped — a real improvement over OLD's client-side assembly), breadcrumb restore | `NEW_BETTER` | — | `KEEP_NEW` |
| Live tail | Confirm-before-start dialog, icon+text state pill, Received/Displayed/Buffered/Dropped counts, Pause/Resume/Stop/Clear/Follow-newest, severity/service/text filters (client-side only), bounded reconnect | `LiveTailPanel.tsx`: same controls and counts, same bounded reconnect (Slice 5), client-side severity/text filtering over the retained buffer (documented as intentional, matching OLD's own scope) — **no confirm-before-start dialog** | `PARTIAL` | LOW–MEDIUM | `OWNER_DECISION_REQUIRED` on the confirm dialog (a real OLD friction point that could be read as a strength or as unnecessary friction NEW deliberately removed — the OLD docs don't record why it existed beyond a near-real-time disclosure, which NEW already shows elsewhere) |
| Non-sensitive preference persistence | source, time preset, severity, query mode restored on reload (all non-sensitive) | Only table column/density persisted (Slice 8); source/time-range/severity/query never restored, by deliberate design | `MISSING` (relative to OLD) | MEDIUM | `OWNER_DECISION_REQUIRED` — same class of value CLAUDE.md §2 rule 4 already allows ("safe non-sensitive UI preferences"); a real, bounded restoration candidate, not a security question |

*(`AUDIT-16-WORKFLOW-PARITY-OLD-VS-NEW.md`/`AUDIT-18-SECOND-PASS-SUMMARY.md`
were reviewed and found to contain no actual OLD-vs-NEW comparison — every
"NEW" cell in both files is marked `UNVERIFIED`, written when the NEW app
was unreachable from that earlier audit pass's own environment. They were
not used as comparison evidence here; the table above is this session's
own fresh comparison.)*

No arbitrary percentage is offered as the headline finding — the row-by-row
table above is the actual conclusion. For reference, of the areas
reviewed: 9 `SAME`, 3 `NEW_BETTER`, 3 `PARTIAL`/`MISSING` requiring an
owner decision, 2 clear `RESTORE` items (row-click, Compose selector as a
new build), 1 `KEEP_NEW` override of an OLD pattern (the reveal/unmask
action).

## Filter functional audit — summary (full detail in `FILTER_FUNCTIONAL_AUDIT.md`)

**The owner's report that "filters appear not to work" is not reproduced
by this audit's real, empirical testing.** Every filter tested — a
sensitive field (`customerId`), a request-flow ID (`traceId`), a
what-happened field (`errorCode`), a combined AND of two fields, free
text, and the guided Query builder's generated DSL — was verified
end-to-end for real: typed in the real running UI → captured in the
actual network request body → confirmed server-side to include/exclude
the correct events → confirmed the raw sensitive value never leaks back
in the response even when used as a filter. See `FILTER_FUNCTIONAL_AUDIT.md`
for the full trace and evidence.

This is **not** exhaustive coverage of all 17+ advanced filter fields,
Live's own filters, and every combination — that level of matrix testing
is proposed as part of implementation slice UX-R2, not this diagnosis
pass. But the representative sample tested spans every layer the mission
asked about (structured field, sensitive field, combined filter, free
text, guided query) and found no defect in any of them.

## Docker Compose project selector — current state

```
DOCKER_COMPOSE_PROJECT_SELECTOR_CURRENT=NOT_IMPLEMENTED (backend: a single static config-time value, LOGEXPLORER_DOCKER_COMPOSE_PROJECT_FILTER, no discovery endpoint for available projects; frontend: read-only display of the current value in Settings, no selector control)
DOCKER_COMPOSE_RUNTIME_SWITCH_CURRENT=NOT_IMPLEMENTED (requires an app restart with a new env var to change)
COMPOSE_HARD_BOUNDARY_CURRENT=ALREADY_CORRECT_MECHANISM (DockerLogSource#relevantContainers is the one real chokepoint every caller — discoverServices/search/live/context — already routes through; canonical com.docker.compose.project label, never a container-name heuristic; the boundary logic itself is sound, it just isn't driven by a per-request/session-selectable value yet)
```

Concretely: adding runtime project selection is an architecture question
(a new discovery endpoint listing distinct `com.docker.compose.project`
label values seen on the connected engine; a decision on whether the
selected project becomes a new request-scoped parameter alongside
`sourceId` or a session-level setting; replacing the static
`properties.getComposeProjectFilter()` read in `relevantContainers` with
that request/session-scoped value), not a rewrite of the boundary
enforcement itself, which is already centralized and correct.

### Critical, load-bearing security finding for this specific slice

`DockerSettingsController.java` carries an explicit, deliberate prior
owner decision (Legacy Remediation Slice 3), documented directly in its
own class-level Javadoc: *"This application has no authenticated admin
boundary (no Spring Security, no `@PreAuthorize`, nothing gating any
endpoint by identity — confirmed by inspection before this controller was
written). Per the mission's own explicit instruction ('If this
application currently has NO authenticated admin boundary, do NOT create
an unauthenticated global configuration mutation endpoint that any user
can use to redirect the backend to arbitrary Docker hosts'), this
controller therefore exposes exactly two capabilities and nothing more"*
— a read-only effective-config summary, and an ephemeral, never-persisted
Test Connection. **There is deliberately no endpoint that mutates
`DockerProperties`.**

A naive implementation of "select a Compose project in Settings, it
becomes the server-enforced boundary" would recreate exactly the
unauthenticated-global-mutation anti-pattern that decision rejected — any
client could change what *every other concurrent client* sees, since this
app has no per-user/per-session identity concept to scope the change to.
This is a genuine, unresolved tension between the new mission requirement
and an existing, correct, already-documented security decision — it must
be resolved by an explicit owner decision before UX-R3 writes any mutation
endpoint, not silently implemented unsafely (a global mutation) and not
silently dropped (ignoring the mission's mandate). Candidate directions,
none decided here: (a) a per-request parameter alongside `sourceId`
rather than a global server-side setting — the frontend would resend the
selected project on every call, and the backend would never persist it
anywhere shared; (b) introducing a minimal session concept scoped only to
this one setting; (c) accepting that true multi-user-safe global
configuration genuinely needs the authentication boundary this project has
so far treated as out of scope (`CLAUDE.md` §8). Option (a) is the
smallest change consistent with the existing no-mutation-endpoint
decision and is the most promising starting point, but is not adopted
here — this is a diagnosis pass, not an implementation one.

## Screen-by-screen evidence not yet captured

Per this pass's own scope (diagnosis + plan, not full restoration), a
complete new screenshot set for every state the mission's "Browser
verification" section lists (empty search, populated results, event
selected, actions menu, inspector, More Filters, advanced query, Settings
local/remote, Compose project selector [does not exist yet], context,
Live, columns menu) was **not** captured in this pass. What was captured:
real network-payload evidence for the filter-wiring checks above. A
full screenshot pass is recommended as the first concrete step of
whichever implementation slice is approved to start next, so "before"
evidence exists to compare against.

## Proposed implementation slices

Per the mission's own recommended grouping, reviewed against the findings
above and adjusted only where evidence suggested a different split:

- **UX-R1** — Search workspace + shell + navigation + active scope.
  *Revised finding: this area is already `SAME`/`KEEP_NEW` throughout —
  likely a short or even empty slice once verified with real screenshots;
  do not assume work is needed here without that verification first.*
- **UX-R2** — Filter functional repairs + More Filters + advanced query.
  *Revised finding: no functional repair was found necessary by this
  audit's real testing.* Recommend re-scoping this slice to: (a) the
  exhaustive filter matrix testing the mission describes (deterministic
  fixture data, expected-included/excluded assertions, every field,
  combinations), to convert this audit's spot-check confidence into full
  regression coverage; (b) the two `OWNER_DECISION_REQUIRED` items in this
  area (broader safe-preference restoration, if approved).
- **UX-R3** — Docker Settings completeness + runtime Compose project
  selection. The one area with a genuine, well-scoped, real gap requiring
  new backend + frontend work (discovery endpoint, selector UI, the
  isolation test the mission describes, project-switch UX). Recommend
  this as the priority slice given it's an explicit new owner requirement
  with the clearest scope and highest severity if done wrong (a security
  boundary).
- **UX-R4** — Results table + row-click + sorting + columns/actions.
  Row-click is a small, well-scoped, high-value restoration. Sorting
  needs an owner decision first (reversing a prior approved decision) —
  recommend sequencing row-click ahead of sorting within this slice.
- **UX-R5** — Inspector + surrounding logs/context workflow. *Revised
  finding: already `SAME`/`NEW_BETTER` throughout — likely a short
  verification-only slice.*
- **UX-R6** — Final visual/information hierarchy/accessibility/
  performance polish, informed by whatever real screenshots come out of
  UX-R1/R3/R4/R5's own verification work.

**Recommended first slice: UX-R3** (Docker Compose project selection) —
the one area with an unambiguous, severe, well-scoped real gap and an
explicit owner mandate, versus UX-R1/UX-R2/UX-R5 where this audit's own
evidence suggests the perceived gap may not exist, and UX-R4's sorting
question needing an owner decision before work can start on that half of
the slice. Row-click (part of UX-R4) is a strong second candidate — small,
clearly scoped, no open decision blocking it.

## Owner decisions required

1. **Sorting**: restore real backend-driven sort (reversing the prior
   `TABLE-05` `SUPERSEDED_BY_OWNER_DECISION`), or keep newest-first-only?
2. **Broader safe-preference persistence** (source, time preset, severity,
   query mode) — restore to OLD's level, or keep Slice 8's stricter
   zero-persistence-beyond-table-prefs model?
3. **Live's confirm-before-start dialog** — restore, or keep NEW's
   frictionless start?
4. **Compose project selection UX shape** — a new toolbar-level selector
   (alongside source), or a Settings-only control? Does selecting a
   project persist as a safe preference, or reset each session?
5. **Compose project selector mutation scope** (see the dedicated finding
   above) — this application has no authenticated admin boundary, and a
   prior, documented Slice 3 decision deliberately avoided an
   unauthenticated global-mutation endpoint for exactly this class of
   setting. A per-request parameter (option (a) above) is the smallest
   change consistent with that decision, but needs explicit owner sign-off
   before UX-R3 writes any mutation endpoint at all.
6. Confirm **UX-R3 as the recommended first slice** (or redirect priority
   elsewhere).
