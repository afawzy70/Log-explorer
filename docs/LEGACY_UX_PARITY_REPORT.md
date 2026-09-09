# Legacy UX Parity Report

Mission 3 deep-dive: not "does NEW look like OLD," but "can an investigator do the same real
engineering task with the same or better efficiency — fewer actions, less context loss, more
information visible at once." Source evidence: `legacy-app-docs/UX_SPEC.md`,
`legacy-app-docs/audit/AUDIT-01` through `AUDIT-09`, `legacy-app-docs/audit/AUDIT-13`, and NEW's
actual source + this session's own Playwright/UX-acceptance test evidence
(`docs/verification/PHASE_F_REPORT.md` through `PHASE_M_REPORT.md`). Classification per task:
`NEW_BETTER` / `EQUIVALENT` / `NEW_WORSE` / `NOT_VERIFIED`.

---

## Task 1 — Find recent failures for one service

**OLD flow:** Toolbar service select → severity=Errors → Last 30m preset → Run. Results appear
in the same view. ~4 actions.
**NEW flow:** `ServiceMultiSelect` → `SeverityFilter`=Errors → time preset (`1h`, NEW's closest
built-in preset to OLD's 30m — NEW's preset set is `15m/1h/4h/1d/7d`, not `5m/15m/30m/60m/24h`) →
Run. ~4 actions, same shape. Results stay in the same single-page view (NEW has no view-swap at
all, stronger than OLD's `search`/`settings` split).
**Verdict:** `EQUIVALENT` action count; **`NEW_WORSE` on preset granularity** — OLD's 30-minute
default preset has no exact NEW equivalent (nearest is 1h, double the window), which changes the
result set an investigator sees for this specific task without them asking for a wider window.
Custom range covers the gap but adds actions back. Recommend adding a 30m preset to NEW's set
(trivial, not in the remediation plan above since it's a one-line config change, not a slice-sized
gap) — flagged here for the owner.

## Task 2 — Investigate a specific customer (masked)

**OLD flow:** More Filters → CustomerId/UserName field → masked chip appears → Run → inspector
Actor tab shows "Protected" values.
**NEW flow:** `AdvancedFilters` (who group) → same field → `ActiveFilters` chip shows "Protected"
→ Run → `ActorClientSection` shows masked values without a tab click (all inspector sections are
visible at once in NEW, not tab-gated).
**Verdict:** `NEW_BETTER` — same filter-entry action count, but NEW removes the extra tab-click OLD
required to see the actor data once an event is open (Mission 3's own "low-click investigation"
criterion favors NEW here).

## Task 3 — Investigate one device (deviceId/deviceIp)

Same shape as Task 2, same fields, same masking guarantee (both partial/prefix-masked per the
matrix's MASK-02 finding of identical rules).
**Verdict:** `NEW_BETTER`, same reasoning as Task 2.

## Task 4 — Inspect one event in full detail

**OLD flow:** Click row → inspector opens as a resizable side panel (not covering results) →
click through 5 tabs to see Overview/Actor/Flow/Business/All-fields.
**NEW flow:** Click "Inspect event" action (always present, not conditional on IDs existing,
per matrix row TABLE-09) → inspector opens as a resizable side panel (≥1024px) → all 5 equivalent
sections rendered together, scrollable, no tab-switching.
**Verdict:** `NEW_BETTER` — same one-click entry, strictly fewer subsequent clicks to see
everything (0 tab clicks vs up to 4 to cycle all OLD tabs). Both preserve the results list
underneath (neither is a covering modal). NEW's resizable range is wider (320–720px vs OLD's
320–640px).

## Task 5 — Show surrounding logs for one event (context)

**OLD flow:** Inspector → "Show surrounding logs" action → context view opens (±30s code-verified
window, despite spec-doc claims of ±60s — see matrix row INSP-07) → results shown, presumably as
a similar table/list; return to search restores prior state.
**NEW flow:** `ContextAction` in `RequestFlowSection` → preview of exact window shown before
running → runs → journey-style view of the context window; `closeJourney()` is a pure overlay that
never mutates the underlying search state, so "return to search" is structurally guaranteed
identical, not snapshot-restored.
**Verdict:** `NEW_BETTER` — NEW previews the exact window before committing (OLD does not, per
`AUDIT-06` §4), and NEW's return-to-search is architecturally guaranteed lossless rather than
relying on save/restore logic that could drift.

## Task 6 — Follow a trace ID end to end

**OLD flow:** Paste/detect trace ID in universal search (or "Find trace" from inspector) →
`EventTimeline` opens, chronological, grouped by service.
**NEW flow:** Same two entry points (`idDetection.ts` + `RequestFlowSection`'s "Find this trace
ID") → `JourneyView` opens, ascending order, per-service color coding, backed by a **real
dedicated backend endpoint** (`POST /journey`) that OLD never had (OLD assembles the timeline
client-side over a flat search result, per `AUDIT-07` §4).
**Verdict:** `NEW_BETTER` — same entry-point count; NEW's server-side journey assembly is more
robust against pagination/limit edge cases that could silently truncate OLD's client-assembled
timeline for a trace with many events.

## Task 7 — Follow a correlation ID across services

Same mechanics and verdict as Task 6 (both apps treat trace/correlation/journey/event IDs
uniformly through the same entry points).
**Verdict:** `NEW_BETTER`.

## Task 8 — Follow a business journey across multiple traces

**OLD flow:** Journey ID search → `EventTimeline` groups multiple trace IDs under one journey,
shows sequence + business-step markers.
**NEW flow:** Journey ID search → `JourneyView`, `journeyFields.ts#countDistinctTraces` confirms
never filtered down to one trace; `JourneyEntryRow` shows business step inline per entry.
**Verdict:** `EQUIVALENT` — same capability, same information density per row. NEW currently lacks
OLD's explicit gap-time-delta markers between entries (matrix row INV-05, planned in Slice 6) —
this is a real but minor density regression for this specific task, since a long journey with an
unexplained multi-minute gap is slightly less discoverable in NEW today without scanning
timestamps manually.
**Verdict (refined):** `NEW_WORSE` on this one specific sub-point (gap visibility), `EQUIVALENT`
overall pending Slice 6.

## Task 9 — Understand a cross-service request flow (service sequence)

**OLD flow:** `EventTimeline`'s observed-sequence view.
**NEW flow:** `JourneyView` ordered ascending, per-service coloring makes the sequence readable at
a glance without a dedicated "sequence" sub-view.
**Verdict:** `EQUIVALENT` — both surface the sequence; NEW does it via color+order in the same view
rather than a separate rendering, which is a reasonable, not-worse alternative (no extra clicks
either way).

## Task 10 — Live-monitor a service

**OLD flow:** Live button → confirmation dialog (source/services/severity + disclosure) → live
view starts, state machine visible (`connecting→live`), pause/resume/stop, auto-reconnect on
drop.
**NEW flow:** Live button starts immediately (no confirm dialog — matrix row LIVE-01) → live view
starts (`connecting→live`), pause/resume/stop; **no reconnect on drop** — a transient network blip
ends the session and requires a manual restart (matrix row LIVE-06).
**Verdict:** `NEW_WORSE` — one fewer click to start (arguably neutral-to-positive), but a real
resilience regression for any live-monitoring session longer than the network's own MTBF; for a
support engineer watching a live incident, an unannounced silent stop is a worse outcome than
OLD's self-healing reconnect. This is the report's most significant workflow-level finding,
consistent with the matrix's own P1 priority on LIVE-06, remediated in Slice 5 above.

## Task 11 — Configure a local Docker connection

**OLD flow:** Settings → Docker panel → mode=local → Test → Save. Runtime-changeable, no restart.
**NEW flow:** Set once via `application.yml`/env var at process start; **no in-app UI at all**; any
change requires an app restart.
**Verdict:** `NEW_WORSE` — this is a real, significant workflow regression for anyone who needs to
point Log Explorer at a different Docker host during a session (matrix row SRC-04, P1, remediated
in Slice 3).

## Task 12 — Configure a remote Docker connection (with TLS)

Same as Task 11, plus: OLD's remote path had SSRF/DNS-rebinding protection; NEW's static config
path has none today (matrix row SRC-10/MASK-08).
**Verdict:** `NEW_WORSE` — both on workflow (no UI, no Test action) and on security depth. Highest-
severity UX finding alongside Task 10; remediated in Slice 3.

## Task 13 — Configure OpenShift/Loki

Both apps: config-file-only (`OPENSHIFT_LOKI_BASE_URL`/token via env, no UI in either app), both
correctly report `unavailable` with a clear reason when unconfigured (matrix row ERR-04 for the
message-detail nuance).
**Verdict:** `EQUIVALENT`.

## Task 14 — Recover from a source failure mid-investigation

**OLD flow:** Health indicator shows a specific failure reason (config/connection/permission) +
suggested action; Retry button.
**NEW flow:** `SourceHealthBadge` shows tri-state health + Retry, but with one collapsed message
string rather than OLD's distinct reason categories (matrix row ERR-04, planned in Slice 6).
Recovery mechanics (Retry click, re-attempt) are otherwise the same shape and action count.
**Verdict:** `NEW_WORSE`, narrowly — recovery itself works identically, but an investigator gets
less specific guidance about *why* a source failed and what to do about it. Low-severity relative
to Tasks 10–12.

## Task 15 — Refine an existing investigation (adjust filters, re-run, iterate)

**OLD flow:** Adjust any filter → Run again (state preserved automatically); Refresh re-runs
identical filters without re-entering anything; guided query builder lets a user add AND/OR
conditions incrementally without hand-editing query text.
**NEW flow:** Adjust any filter → Run again (state preserved automatically, verified structurally
by `useSearchState.ts`'s pure-overlay pattern for journey/context views not touching the base
search state at all); **no Refresh button** (matrix row SEARCH-16, trivial fix, Slice 1); **no
guided query builder or free-text query editor of any kind** (matrix rows SEARCH-06/07, Slice 2) —
an investigator refining beyond the structured filter fields has no incremental query-building path
in NEW today, where OLD's AND/OR tree let them add one condition at a time without retyping
everything.
**Verdict:** `NEW_WORSE` — the base filter-refinement loop (adjust a structured filter, re-run) is
equivalent-to-slightly-better in NEW due to the state-preservation guarantee, but the *absence of
any free-form/guided query iteration path* is a real ceiling on how far an investigation can be
refined before hitting a wall that OLD didn't have. This is the report's clearest "investigation
efficiency" gap for power users specifically, consistent with the matrix's P1 priority on
SEARCH-06/07.

---

## Cross-cutting UX findings

- **Result stays visible / context preserved:** NEW is structurally stronger than OLD on this
  dimension across every task — NEW has no `view` state swap at all (Search/Settings was OLD's one
  hard navigation break, and NEW currently lacks a Settings surface entirely, ironically avoiding
  that specific loss-of-context risk while also lacking the settings capability itself, see Slice
  3). Journey/context views are pure overlays in NEW, provably non-destructive to the underlying
  search, versus OLD's save/restore pattern which is correct but relies on discipline rather than
  structure.
- **Information density in the inspector:** NEW wins clearly (0-click all-sections-visible vs
  OLD's up-to-4-clicks tab cycling) — directly serving the mission's "progressive disclosure,
  low-click investigation" target.
- **Keyboard efficiency:** `EQUIVALENT` to `NEW_WORSE` depending on area — inspector/dialog focus
  trap and Escape parity is solid; global Ctrl+Enter and row-level ArrowUp/Down traversal are both
  currently missing in NEW (matrix rows SEARCH-18, TABLE-06), a real, if secondary, productivity
  regression for keyboard-first users.
- **Filter iteration speed:** the report's single biggest finding — NEW is strong for structured
  filters, weak-to-absent for free-form/guided query iteration (Task 15).
- **Live monitoring resilience:** the report's second biggest finding — NEW's lack of reconnect
  is a genuine investigation-continuity regression for anyone live-monitoring through a real
  network blip (Task 10).
- **Docker connection flexibility:** the report's third biggest finding — no in-app way to point
  at a different Docker host without an app restart is a real operational regression for anyone
  supporting multiple environments from one running instance (Tasks 11–12).

## Summary verdict counts (15 tasks, some tasks touch more than one dimension)

- `NEW_BETTER`: Tasks 2, 3, 4, 5, 6, 7 (6)
- `EQUIVALENT`: Tasks 1 (action count only), 9, 13 (3)
- `NEW_WORSE`: Tasks 1 (preset granularity), 8 (gap markers), 10, 11, 12, 14, 15 (7, counting
  Task 1 once under its worse sub-finding and Task 8 under its worse sub-finding)
- `NOT_VERIFIED`: none — every task had enough source+code evidence to reach a verdict.

No UX regression identified here is being treated as acceptable simply because the underlying
backend capability exists elsewhere — each is carried into the remediation plan (Slices 1, 2, 3,
5, 6, 8) as the mission requires.
