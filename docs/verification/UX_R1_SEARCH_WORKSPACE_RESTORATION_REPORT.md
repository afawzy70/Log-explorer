# UX-R1 — Search Workspace Restoration — Report

Using `log-explorer-professional-ux-reviewer` [LERUX-1]. The `Skill` tool
still reports "Unknown skill" for this project-local skill (tried again at
the start of this slice) - this is a recurring, real tooling limitation
across this whole mission, not a one-off. Per the skill's own committed
fallback instruction, its `SKILL.md` was read directly and its protocol
(rendered-browser evidence first, five-layer trace, old-vs-new
classification) followed manually throughout this slice.

## Scope

UX-R1 only, per the owner's exact scope list:

1. Application shell/navigation - audited, no gap found (§7 below), no change made.
2. Search workspace visual/workflow restoration.
3. Active-filter chips: individually removable.
4. "Clear all" filter action.
5. OLD-style match-type semantic labels (Exact match / Contains).
6. Active investigation scope visibility (Time range chip, always shown).
7. Search control hierarchy and spacing - audited, no change needed.
8. Advanced Query information-architecture positioning (moved under More filters).

Explicitly **not** in this PR: the Docker Compose runtime selector (UX-R3),
row-click/sorting (UX-R4), the exhaustive filter matrix (UX-R2), UX-R5/R6,
or Phase M.

## OLD reference used

`docs/ux-reference/old-ui/old-01.jpg` (empty state, individually-removable
chips + "Clear all"), `old-05.jpg`/`old-06.jpg` (More Filters grouping +
EXACT MATCH/SUBSTRING labels), `old-07.jpg`-`old-09.jpg` (Advanced query
nested inside filters, not a separate toolbar peer) - all previously
catalogued in `OLD_UX_RESTORATION_AUDIT.md` (PR #31).

## Method

Real rendered app only (`npm run dev`, port 3435; real backend,
`SPRING_PROFILES_ACTIVE=dev`, port 3434, Fixture source) - every claim
below is backed by a real Playwright run against that app
(`frontend/e2e/ux-r1-evidence.spec.ts`, kept in the repo as a permanent
regression spec, not a throwaway script) or an existing/updated automated
test, never a source-only read. Screenshots stored at
`docs/verification/UX_R1_EVIDENCE/` (16 PNGs - the 10 mandatory §14 states
A-J, plus one screenshot per required responsive width).

## Restored interactions

### Active filter chips (§3/§9/§10)

Every committed investigation criterion is now its own chip, each with a
visible ✕ and an accessible name (e.g. "Remove severity filter ERROR",
"Remove Trace ID filter fixture-trace-000340", "Remove Customer ID filter
(protected value)" for sensitive fields - never the raw value, even in the
button's own accessible name):

- **Time range** - always shown (unchanged from before); ✕ resets to a
  fresh default range (`useSearchState.ts`'s own `defaultTimeRange()`,
  exported so this and "Clear all" share one definition).
- **Severity** - shown only when it differs from the default
  (INFO/WARN/ERROR), to keep the healthy/default state visually quiet per
  the mission's own restraint instruction; ✕ resets to the default set.
- **Service** - one chip per selected service; ✕ removes exactly that one.
- **Every active advanced filter field** (unchanged behavior from before,
  now with a ✕): ✕ clears exactly that field via `applyAdvancedFilters`
  with only that key blanked, round-tripping `searchText` unchanged - no
  other field is touched.

Removal never auto-runs a search (CLAUDE.md's existing "no unexpected
background searches" pattern, extended consistently to chip removal) - it
only updates committed state, exactly like every other filter mutation in
this app; the next Search click reflects it.

### "Clear all" (§4)

New `clearAllFilters()` in `useSearchState.ts`: clears search text,
selected services, severity (back to default), every advanced filter, the
query (guided/text/rawLogQl all reset), and the time range (back to a
fresh default) - and never touches `selectedSourceId` (or anything table-
preference/Settings-related, which this hook never owned to begin with).
Matches the mission's explicit "source/project is SCOPE, not a disposable
filter" instruction. Always rendered, even in the empty state, matching
`old-01.jpg`.

### Match-type labels (§5/§6)

`advancedFilterFields.ts` now carries a `matchType: 'exact' | 'contains'`
per field, taken directly from `backend/.../core/search/EventFilters.java`
(grepped, not guessed): every field is `exact` except `loggerContains` and
`text`, which are `contains`. Rendered as a small "Exact match"/"Contains"
hint beside each field's label in the More Filters drawer - a sibling of
`<label>`, not nested inside it, so the hint text never gets folded into
the field's own accessible name.

### Advanced Query IA move (§2/§8)

`QueryBuilder` (unchanged internally - still its own draft/apply/cancel
state, guided/text/rawLogQl modes) now renders from inside
`AdvancedFilters`' own drawer, under a new "Advanced query" section, in
place of its former standalone toolbar trigger. `Toolbar.tsx` no longer
renders `<QueryBuilder>` directly. This was evaluated against two options
(relocate the existing self-contained popover vs. decompose it into
content-only for true inline embedding); the relocation option was chosen
as the smaller, "controlled restoration, not churn" change, with two real
issues it exposed fixed rather than left as known limitations (both
below).

## Two regressions this slice found and fixed (via real rendered-app verification, not source review)

Both were caught only because the app was actually run and clicked through
(and, for the second, because the E2E suite was run for real) - exactly
what LERUX-1's "rendered-browser evidence first" principle is for.

1. **Nested-Escape double-dismiss.** `useDismissableLayer.ts` had no
   concept of "topmost layer" - a single Escape while Query's popover was
   open (now nested inside the drawer) closed both at once. Fixed with a
   small module-level open-layer stack; only the most-recently-opened
   layer reacts to Escape. Also fixed a related bug in the same pass: the
   stack must not depend on `onDismiss`'s identity (callers never memoize
   it), or an unrelated re-render mid-session would silently reshuffle
   stacking order - now read via a ref, so the effect only re-registers on
   real open/close transitions. New test file:
   `useDismissableLayer.test.tsx`.
2. **Drawer overlapping the header/toolbar, blocking clicks.** The More
   Filters drawer (`position: fixed; top: 0`) has always visually spanned
   the full viewport height on its own 420px-wide right-hand strip -
   before this slice, no real flow ever needed to click something *behind*
   it while it stayed open. Nesting Query inside it created exactly that
   flow (apply the nested Query, drawer stays open, then click the
   toolbar's own Search) - caught by
   `phase-legacy-slice2-query-transparency.spec.ts` test 6 failing for
   real (`<input>... intercepts pointer events`), not by a screenshot. A
   z-index fix was tried first and rejected: raising the toolbar's own
   z-index traps the drawer (its descendant) inside a new local stacking
   context and elevates the *whole toolbar, drawer included* as one unit -
   confirmed by reproducing the header now being covered too. Fixed by
   measuring `[data-app-chrome]` (`App.tsx`, a new wrapper around
   `Shell`+`Toolbar`) via `ResizeObserver` and offsetting the drawer's
   `top` below it, so the two never physically occupy the same region
   regardless of stacking order. `ResizeObserver` is guarded (absent under
   jsdom, matching `MessageCell.tsx`'s own documented reason for avoiding
   it) - harmless to skip in component tests, which never assert real
   pixel layout.

## Intentional deviations from OLD

None beyond what `OLD_UX_RESTORATION_AUDIT.md` already documented as
intentional (no raw-value reveal action, etc.) - nothing new introduced
this slice.

## Screenshots / evidence

`docs/verification/UX_R1_EVIDENCE/`: `A`-`J` (the ten §14-mandated states)
plus `responsive-{1920,1440,1280,1024,768,390}px.png` (§13). Visually
confirmed: Search stays the strongest primary action (filled/blue) with
Live secondary and More filters a tertiary trigger; the drawer starts
cleanly below the header/toolbar/active-filters block at every width, no
overlap; Query's popover renders centered, on top of the drawer, with the
drawer still visible/legible behind it; the protected chip shows
"Protected" with no raw value anywhere in the rendered HTML; 390px has no
horizontal overflow with three chips + Clear all wrapping cleanly.

## Performance (§11)

Production build before/after (`npm run build`):

| | JS | JS gzip | CSS | CSS gzip |
|---|---|---|---|---|
| Before (PR #31 HEAD) | 283.90 kB | 85.49 kB | 37.62 kB | 6.14 kB |
| After (this PR) | 287.44 kB | 86.39 kB | 38.53 kB | 6.30 kB |
| Delta | +3.54 kB | +0.90 kB | +0.91 kB | +0.16 kB |

No new startup API calls (the `ResizeObserver` only ever attaches while
the drawer is open, and only measures a DOM element already on the page -
no network). Chip removal/Clear all are synchronous local state updates,
no unnecessary Results table rerenders (unrelated to `searchResult`).
Slice 8's code splitting (`JourneyEntryRow`/`JourneyView`/`LiveTailPanel`
as separate chunks) is untouched - visible in the build output above.

## Accessibility (§12)

`jest-axe` checks (`AdvancedFilters.test.tsx`, `ActiveFilters.test.tsx`,
`Toolbar.test.tsx`, `QueryBuilder.test.tsx`) pass with the new chips/
Advanced-Query-in-drawer nesting. Chip remove buttons are real
`<button type="button">` elements with descriptive `aria-label`s
(never color-only), keyboard-operable (native buttons). Clear all is a
native button, keyboard-reachable. Focus-move-into-drawer-on-open and
focus-return-to-trigger-on-close (pre-existing behavior) are unchanged and
still covered by `phase-ui-gap-closure.spec.ts`. Match-type hints are
plain visible text, not color-only.

## Tests (§15)

- Frontend unit/component suite: **625/625 passed** (`npx vitest run`),
  including new/updated coverage for: chip removal (each kind, and that
  unrelated chips survive), Clear all (and that source survives it, at
  the hook level in `useSearchState.test.ts`), protected values never
  appearing raw (including inside a remove button's own accessible name),
  the nested-Escape-dismiss fix (`useDismissableLayer.test.tsx`, both the
  regression and the "second Escape then dismisses the next layer" case),
  Advanced Query still functional after the move (including that its
  Apply/Cancel stay a fully separate surface from the drawer's own
  field-level draft), match-type hints reflecting real backend semantics.
- TypeScript: **clean** (`npm run typecheck`).
- Production build: **succeeds** (`npm run build`).
- Full E2E suite: **176/176 passed** (`npx playwright test`), including
  two real regressions found and fixed during this slice (both described
  above) and one pre-existing, unrelated flaky test
  (`phase-legacy-slice5-live-resilience.spec.ts` test 14, a timing-
  sensitive retry-backoff assertion - reproduced failing once under full-
  suite parallel load, passed 3/3 in isolation both before and after this
  slice's changes; not touched by anything in this PR).
- Backend: **not run** - no backend files were touched by this PR.
- No test was disabled, skipped, or weakened to obtain this result;
  several were *tightened* (e.g. `ResultsPanel.test.tsx`'s "Search last 1
  day" test previously only asserted `setTimeRange` was called, which is
  exactly why a real bug in that button went unnoticed until this slice's
  own full-suite run surfaced it - see "Incidental bug fix" below).

## Incidental bug fix (found verifying this slice's own E2E suite, not part of UX-R1's scope, but blocking a real regression gate)

`ResultsPanel.tsx`'s "Search last 1 day" zero-results recovery button
(CLAUDE.md §4: "zero results offers one-click 'Search last 1 day'") only
ever called `setTimeRange(...)` - never re-ran the search - so the
"one-click" affordance silently left the stale, still-empty result set on
screen. This is pre-existing (not introduced by this PR) and was exposed
only because `phase-m-ux-acceptance.spec.ts`'s Task 1 test's real 30-
minute fixture window happened to return zero results during this run,
triggering the dormant path. Fixed with a minimal, targeted change:
`runSearch` now accepts an optional time-range override (used because
`setTimeRange` + `runSearch()` back-to-back would still read the *stale*
`timeRange` closure - React state updates are not synchronous); the
recovery button passes the same range it just committed. Two new
regression tests added (`ResultsPanel.test.tsx`, `useSearchState.test.ts`)
proving the override actually reaches the wire request, not just the
committed state.

## Navigation / Live / Results table / Inspector (§7/§8)

No changes. The audit found no shell-navigation gap, and this slice did
not touch Live's architecture, the Results table, or the Inspector -
confirmed unaffected by the full E2E suite passing.

## Remaining UX-R2 through UX-R6

Unchanged from `OLD_UX_RESTORATION_AUDIT.md`'s own slice plan:

- **UX-R2** - exhaustive per-field/per-source filter functional matrix
  (the ~10 advanced fields not empirically tested in
  `FILTER_FUNCTIONAL_AUDIT.md`, Docker/Loki push-down behavior,
  combinations).
- **UX-R3** - Docker Compose runtime project selector (server-enforced
  hard boundary, isolation test with overlapping service names).
- **UX-R4** - row-click (mandatory), truthful sorting.
- **UX-R5/UX-R6** - remaining restoration items per that report (Settings
  masking-policy panel, Remote Docker "Connection name" field, etc.).

---

MISSION: UX-R1 — OLD UX Foundation Restoration
STATUS: COMPLETE, PENDING REVIEW
PR_31_MERGE_STATUS: MERGED
PR_31_MERGE_SHA: 78cf648ac594c9c1403d61406d02251686b552ce
POST_PR31_MAIN_CI: PASS (Backend/Frontend/E2E all success; Windows Desktop correctly did not trigger, docs-only merge)
BASE_SHA: 78cf648ac594c9c1403d61406d02251686b552ce
HEAD_SHA: (recorded at push time, see PR)
PR: (opened after this report, see final message)
UX_SKILL_LOADED: NO (tool reports "Unknown skill" - recurring environment limitation)
UX_SKILL_PROTOCOL: LERUX-1 (followed manually via committed SKILL.md)
OLD_REFERENCE_USED: YES (old-01, old-05/06, old-07-09)
CURRENT_RENDERED_APP_REVIEWED: YES (real dev server + real backend, Playwright, screenshots below)
SEARCH_WORKSPACE_RESTORED: YES
ADVANCED_QUERY_MOVED_UNDER_MORE_FILTERS: YES
QUERY_CAPABILITY_REGRESSION: NONE
INDIVIDUAL_FILTER_CHIP_REMOVAL: PASS
CLEAR_ALL: PASS
CLEAR_ALL_PRESERVES_SOURCE: PASS
SENSITIVE_CHIP_SAFETY: PASS
MATCH_TYPE_LABELS: PASS
DRAFT_COMMITTED_STATE_VERIFIED: PASS
GHOST_FILTER_REGRESSION: NONE
NAVIGATION_REGRESSION: NONE
LIVE_REGRESSION: NONE
PERFORMANCE_REGRESSION: NONE (see table above)
SECURITY_REGRESSION: NONE
ACCESSIBILITY_REGRESSION: NONE
FRONTEND_TESTS: PASS (625/625)
BACKEND_TESTS: NOT_RUN (no backend changes)
E2E_TESTS: PASS (176/176; 1 pre-existing unrelated flaky test noted above, reproduced independent of this PR)
TYPECHECK: PASS
PRODUCTION_BUILD: PASS
VIEWPORTS_VERIFIED: 1920, 1440, 1280, 1024, 768, 390
VISUAL_EVIDENCE: docs/verification/UX_R1_EVIDENCE/ (16 screenshots)
REMAINING_UX_R2_R6: UX-R2 (filter matrix), UX-R3 (Compose selector), UX-R4 (row-click/sorting), UX-R5, UX-R6 - unchanged, not started
OWNER_ACTION_REQUIRED: YES

Do not merge the UX-R1 PR. Do not begin UX-R2. Do not begin Phase M. Wait
for reviewer approval.
