# UI Parity Acceleration Pass

Verification report for the owner-authorized **UI PARITY ACCELERATION PASS** mission
(no dedicated slice number — explicitly *not* Slice 5). Base SHA `8c81f7d` /
`8c81f7de3d38c1da22881f4998d1f7854ddeaa96` (`main`, PR #22 merged — Legacy Remediation
Slice 4). Branch `phase/ui-parity-acceleration`.

This pass evaluates the **complete investigation workspace from the user's point of
view** — not isolated features — against the OLD Log Explorer's real, documented
UI capability, and restores the highest-value, lowest-risk gaps. It is scoped to
frontend-only, additive, non-destructive changes; it does **not** implement Slice 5's
live-reconnect resilience engine, and does **not** claim the overall legacy
remediation effort complete.

---

## 1. Method

Per the mission's own instruction, this was **not** a documentation-only exercise —
every claim below was checked against the actual current source (`frontend/src`) and,
for the higher-risk items, a real browser (`SPRING_PROFILES_ACTIVE=dev`, Fixture
source, Playwright/Chromium). No legacy screenshots exist in this repository
(`legacy-app-docs/` is documentation-only, verified: `find . -iname "*.png" -path
"*legacy*"` → 0 matches) — the OLD baseline is `legacy-app-docs/audit/AUDIT-*.md`,
`legacy-app-docs/UX_SPEC.md`, and the pre-existing
`docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md` (itself built from those same
documents in an earlier session, cross-checked again here against current `main`
rather than trusted as still-accurate).

A significant fraction of the mission's own "MANDATORY P0/P1 CANDIDATES" list turned
out to **already be present and correct** on `main` before this pass touched
anything (dense unified toolbar, active filter chips, a non-blocking More Filters
panel, a richer-than-OLD always-visible inspector, Show ±30 seconds, Slice 4's table
controls) — confirmed by reading the actual components (`Toolbar.tsx`,
`ActiveFilters.tsx`, `AdvancedFilters.tsx`, `EventInspector.tsx` + its five section
components, `ContextAction.tsx`, `TableSettingsControl.tsx`) rather than assumed from
the older matrix's own summaries. The real, verified gaps this pass closed were
narrower and more specific than "the whole workspace is behind": a missing Reset
action (and, found while fixing it, a real layout bug that could make Reset
unreachable), no richer context summary, and no keyboard productivity layer at all.

---

## 2. Forensic audit matrix (visible UI/UX capabilities only)

Per the mission's own instruction, this matrix counts **only user-visible UI/UX
capability** — invisible backend/architecture parity (already covered exhaustively
in `docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md`) is excluded from these totals.

| # | Area | OLD_CAPABILITY | CURRENT_BEFORE | CURRENT_AFTER | STATUS | EVIDENCE | DEFERRED_TO |
|---|---|---|---|---|---|---|---|
| 1 | Header | Product identity + active source shown | Present (`Shell.tsx`) | Unchanged | FULL | `Shell.tsx` | — |
| 2 | Header | Environment indicator | Absent | Absent | MISSING | `grep -rn "environment\|profile" frontend/src/app` → 0 UI matches | Later (no env/profile signal currently reaches the frontend at all - a backend contract change, not a UI-only fix) |
| 3 | Header | Settings entry point | Present (`DockerSettingsPanel`, Slice 3) | Unchanged | NEW_BETTER | Slice 3 report §1 (safe read-only + Test Connection model, no unauth mutation) | — |
| 4 | Header | Live/source health status | Present (`SourceHealthBadge`) | Unchanged | FULL | `SourceHealthBadge.tsx` | — |
| 5 | Header | Keyboard shortcuts/help entry point | Absent (`SEARCH-19` `NEW_MISSING`) | `KeyboardShortcutsHelp.tsx` added, "?" key + header button | FULL | `KeyboardShortcutsHelp.test.tsx`, E2E item 10 | — |
| 6 | Toolbar | Single dense investigation toolbar (source/service/time/severity/search/Run/Live/more) | Already present, one row (`Toolbar.tsx`) | Unchanged (verified, not assumed) | FULL | Direct source read; E2E item 12 screenshot | — |
| 7 | Toolbar | Run Search / Start Live reachable without scrolling | Already true | Unchanged | FULL | E2E item 12 | — |
| 8 | Active filters | Chips for time range + every applied advanced filter, Clear-equivalent per chip | Already present (`ActiveFilters.tsx`, `SEARCH-14` `NEW_FULL`) | Unchanged | FULL | E2E items 4-5 | — |
| 9 | More Filters | Right-side panel, results stay visible | Popover-anchored panel (not a literal slide-in drawer), results already visible underneath | Unchanged visual metaphor - deliberate decision, see §4 | PARTIAL | E2E item 6 | Later (visual-metaphor-only difference; functional continuity is already equivalent) |
| 10 | More Filters | Apply / Cancel / **Reset** trio | Apply + Cancel only, no Reset | Reset added | FULL | `AdvancedFilters.test.tsx` (3 new tests), E2E item 3 | — |
| 11 | More Filters | Draft never fires a search; committed state untouched until Apply | Already true | Unchanged, re-verified | FULL | E2E items 3, 6 | — |
| 12 | Results workspace | Counts, duration, truncation, ordering, density, Columns, Reset order, Refresh, Load next page | Already complete (Slices 1 + 4) | Unchanged - confirmed integrated, not duplicated | FULL | E2E item 9 | — |
| 13 | Row interaction | Row click opens the inspector | OLD: row click. CURRENT: Actions-menu only (`TABLE-09`/Slice 4's own documented "Actions is the only inspection entry point" decision) | Unchanged (see §6 below for why this was not touched) | PARTIAL | `ResultsTable.tsx`'s own doc comment | Later (would mean revisiting Slice 4's own mandatory-Actions decision, out of this pass's low-risk scope) |
| 14 | Row interaction | Keyboard row-to-row navigation (`TABLE-06` `NEW_PARTIAL`) | Tab-only | ArrowUp/ArrowDown moves focus row-to-row (activation is still via the focused Actions button, not a bare Enter-on-row - see row 13) | FULL | `ResultsTable.test.tsx` (4 new tests), E2E item 10 | — |
| 15 | Row interaction | Selected-row visual clarity | Already present (`.selectedRow`) | Unchanged | FULL | Pre-existing `phase-h` spec | — |
| 16 | Inspector | Previous/Next/Close, 5 content groupings, no empty sections | Already `NEW_FULL`/`NEW_CHANGED_BETTER` across `INSP-01..09` | Unchanged | FULL | Pre-existing `phase-h` spec | — |
| 17 | Inspector | Keyboard Previous/Next (not just buttons) | Buttons only | `[` / `]` keys added, guarded against text-entry targets | FULL | `EventInspector.test.tsx` (2 new tests), E2E item 10 | — |
| 18 | Inspector | Show ±30 seconds confirm-then-run | Already present (`ContextAction.tsx`) | Unchanged | FULL | Pre-existing `phase-h` spec | — |
| 19 | Context | Event/service/error counts, duration, window, timezone shown | Breadcrumb text only (`Context — ±30s around <time>`) | `ContextSummary.tsx` - Events/Services/Errors/Window(60s)/Range+timezone | FULL | `ContextSummary.test.tsx` (6 tests), E2E items 7-8 | — |
| 20 | Context | Chronological (ascending) presentation | Newest-first (same as the main table) | Unchanged - deliberately not reordered | PARTIAL | ContextSummary's own doc comment | Later (reordering risks a silent order/cursor mismatch with Load More's own cursor pagination - real risk, not laziness; needs its own dedicated design, not a same-pass bolt-on) |
| 21 | Context | Non-causality disclaimer | Absent for context (present for Journey only) | Added to `ContextSummary` | FULL | E2E item 8 | — |
| 22 | Context | Return to original search | Already present (breadcrumb) | Unchanged | FULL | E2E item 8 | — |
| 23 | Live | Start / Pause / Resume / Stop | Already `NEW_FULL` | Unchanged | FULL | Pre-existing `phase-j` spec | — |
| 24 | Live | Clear (`LIVE-07` `NEW_MISSING`) | Absent | `useLiveTail.ts#clear` + button, connection stays open | FULL | `useLiveTail.test.ts` (2 new tests), `LiveTailPanel.test.tsx` (3 new tests), E2E item 11 | — |
| 25 | Live | Pre-start confirmation dialog | Present in OLD | Absent - **owner-confirmed decision**: "NO pre-start confirmation dialog. Current one-click Start is preferred." | SUPERSEDED_BY_OWNER_DECISION | This mission's own text | — |
| 26 | Live | Reconnect with visible/bounded backoff (`LIVE-06` `NEW_MISSING`, deliberate) | Present in OLD | Still absent - a real resilience-engine change | MISSING | `useLiveTail.ts`'s own comment | Slice 5 |
| 27 | Live | Follow-newest toggle (`LIVE-05` `NEW_MISSING`) | Present in OLD | Still absent | MISSING | — | Later (a genuine new state model - freeze/unseen-count/jump-to-latest - not a same-pass bolt-on) |
| 28 | Keyboard | Run search from anywhere (`SEARCH-18` `NEW_MISSING`) | Absent | `Ctrl/Cmd+Enter` via `useGlobalShortcuts.ts` | FULL | `useGlobalShortcuts.test.ts` (5 tests), E2E item 10 | — |
| 29 | Keyboard | Focus search box | Absent | `/` (guarded against hijacking typed text) | FULL | `useGlobalShortcuts.test.ts` | — |
| 30 | Keyboard | Shortcuts help | Absent | `?` + header button | FULL | `KeyboardShortcutsHelp.test.tsx` | — |
| 31 | Keyboard | Live control shortcuts (Start/Stop/Pause key bindings) | Present in OLD | Still absent - every Live control remains one click away, just with no dedicated key | MISSING | — | Later (lower value than the rest of this list - buttons are already fast to reach) |
| 32 | Density | Whole workspace fits usefully on one screen (1440px) | Baseline claim | Re-verified, not assumed | FULL | E2E item 12 screenshot, `assertTableGeometry` | — |
| 33 | Mobile | No regression at 390px with every new control added | N/A (new controls didn't exist before) | Verified clean | FULL | E2E item 13; full existing `f`/`g`/`h`/`i`/`j`/`m` narrow-width suites still green | — |

### Totals (visible UI/UX rows only, 33 total, scored against `CURRENT_AFTER`)

```
FULL         = 24   (rows 1, 4-8, 10-12, 14-19, 21-24, 28-30, 32-33)
PARTIAL      = 3    (rows 9, 13, 20)
MISSING      = 4    (rows 2, 26, 27, 31)
NEW_BETTER   = 1    (row 3)
SUPERSEDED_BY_OWNER_DECISION = 1 (row 25 - excluded from the four counts above, per that status's own definition)
```

24 + 3 + 4 + 1 + 1 = 33.

**`VISIBLE_UI_PARITY_BEFORE_PERCENT`** — the same 33-row rubric scored against
`CURRENT_BEFORE` instead: 14 rows were already `FULL`, 1 already `NEW_BETTER`, 1
already `SUPERSEDED_BY_OWNER_DECISION` (16 of 33 needed no further work) ≈ **48%**.

**`VISIBLE_UI_PARITY_AFTER_PERCENT`** (FULL + NEW_BETTER + SUPERSEDED, scored against
`CURRENT_AFTER`): 24 + 1 + 1 = 26 of 33 ≈ **79%**.

---

## 3. What is now restored

- **More Filters Reset** (`AdvancedFilters.tsx`) - clears the draft only, never
  applies on its own, matching the mission's own explicit Apply/Cancel/Reset trio.
- **A real layout bug found and fixed while adding it**: the first draft placed
  Reset on the panel's own left edge via `justify-content: space-between`. Because
  this panel is `position: absolute; right: 0` relative to its trigger, if the
  toolbar wraps and the trigger ends up near the page's *left* edge, the panel's own
  left edge can land at a deeply negative page X-coordinate - making anything
  anchored there genuinely unreachable, with no scroll able to bring it back. Found
  via this pass's own real-browser E2E run (a `locator.click` timeout with "element
  is outside of the viewport" after 50+ scroll retries), not a code read. Fixed by
  keeping every More Filters action (`Reset`, `Cancel`, `Apply`) anchored together
  at the panel's own right edge (`justify-content: flex-end`), matching the original,
  already-safe Cancel/Apply anchoring.
- **`ContextSummary.tsx`** - Events/Services/Errors counts, the 60-second (±30s)
  window, the actual range with its timezone label, and an explicit
  "does not indicate causality" note, shown above the results whenever a "Show ±30
  seconds" context view is active.
- **`KeyboardShortcutsHelp.tsx`** - a header-mounted popover, opened either by
  clicking it or pressing `?` (guarded against hijacking a literal `?` typed into a
  text field), listing every shortcut below.
- **`useGlobalShortcuts.ts`** - `Ctrl/Cmd+Enter` runs the current committed search
  from anywhere on the page (including while typing, like Slack/Linear); `/` focuses
  Universal Search unless focus is already in a text field.
- **Row arrow-key navigation** (`ResultsTable.tsx`) - `ArrowDown`/`ArrowUp` inside
  the table body move focus to the next/previous row's Actions button.
- **Inspector `[` / `]`** (`EventInspector.tsx`) - previous/next by keyboard, bounded
  the same way the existing Previous/Next buttons are, guarded against text-entry
  targets (deliberately not `ArrowLeft`/`ArrowRight`, which the resize handle already
  binds locally - a global listener there would double-fire).
- **Live "Clear"** (`useLiveTail.ts`, `LiveTailPanel.tsx`) - empties the displayed/
  buffered view and resets every count without touching the connection; a live or
  paused stream keeps streaming (or stays paused) straight through a Clear.

## 4. What remains different (deliberate, documented)

- **More Filters is a popover-anchored panel, not a literal slide-in drawer.**
  Functionally equivalent to OLD's drawer for every *mandatory* requirement this
  mission actually lists (results stay visible, Apply/Cancel/Reset, draft never
  fires a search, committed state untouched until Apply) - all verified true, all
  E2E-tested. Converting the visual chrome itself to a real drawer was judged lower
  value than the rest of this pass's list and was not attempted.
- **Row click still does not open the inspector; only the Actions menu does.**
  This is Slice 4's own deliberate, documented decision (`ResultsTable.tsx`'s own
  comment): Actions is the *only* inspection entry point in this codebase, kept
  structurally mandatory specifically so column customization can never make the
  inspector unreachable. Revisiting that decision (e.g. adding a bare row click) is
  a real design question about Slice 4's own contract, not a low-risk addition, and
  was left untouched here.
- **Context results stay newest-first, not chronological/ascending like OLD's own
  context/timeline views.** Reordering risks a real, silent bug: context results
  come from the same cursor-based pagination every other search result uses, and
  reversing display order without touching the underlying cursor semantics could
  make a future "Load more" on a context view append in the wrong visual position.
  `ContextSummary.tsx`'s own copy is honest about this ("Sorted newest first, same
  as the main results table") rather than claiming a chronological presentation
  that does not actually exist.
- **Live reconnect (bounded/visible backoff) and the follow-newest toggle remain
  absent**, exactly as before this pass - both are real state-model additions, not
  UI-only bolt-ons, and the mission explicitly says not to build the Slice 5
  resilience engine here.
- **No environment/profile indicator in the header** - there is currently no
  profile/environment signal in any API response the frontend reads at all; adding
  one is a backend contract change, out of this pass's frontend-only scope.

## 5. Deferred

- **Slice 5** (as explicitly named by the mission): Live reconnect with bounded,
  visible, cancellable exponential backoff; the follow-newest toggle's frozen-view/
  unseen-count/jump-to-latest state model.
- **Later** (no committed slice yet): environment/profile header indicator (needs a
  backend contract change first); converting More Filters' visual chrome to a
  literal right-side drawer; revisiting row-click-to-inspect against Slice 4's own
  mandatory-Actions decision; chronological (ascending) context ordering (needs its
  own pagination-safety design); dedicated Live control keyboard shortcuts.

---

## 6. Tests

### Backend — `./mvnw --batch-mode verify`

This pass made **zero backend code changes** (purely frontend/UI). Full regression
run anyway:

```
[INFO] Tests run: 494, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

Unchanged from the Slice 4 merge baseline (494) - confirming no regression.

### Frontend — `npm run typecheck && npm run test && npm run build`

```
tsc -b --noEmit             -> clean
Test Files  57 passed (57)
Tests       473 passed (473)
vite build                  -> ✓ built in 424ms
```

35 new tests this pass: `isTypingTarget.test.ts` (new, 3), `useGlobalShortcuts.test.ts`
(new, 5), `KeyboardShortcutsHelp.test.tsx` (new, 5), `ContextSummary.test.tsx` (new,
6), `AdvancedFilters.test.tsx` (+3 - Reset semantics), `ResultsTable.test.tsx` (+4 -
arrow-key row navigation), `EventInspector.test.tsx` (+2 - `[`/`]` shortcuts,
guarded), `useLiveTail.test.ts` (+2 - `clear()`), `LiveTailPanel.test.tsx` (+3 -
Clear button visibility/behavior), `ResultsPanel.test.tsx` (+2 - `ContextSummary`
integration). Baseline (Slice 4 merge) was 438; 438 + 35 = 473.

### E2E — `npx playwright test`

```
116 passed (4.3m)
```

New file `frontend/e2e/phase-ui-parity-acceleration.spec.ts` (10 tests, covering all
13 mission-listed browser-verification items - several combined into one continuous
flow test where they naturally chain, e.g. items 7-8). Run against the real backend
(`SPRING_PROFILES_ACTIVE=dev`, Fixture source). Baseline (Slice 4 merge) was 106;
106 + 10 = 116 - every pre-existing spec passes unmodified, including the narrow/
zoom regression suites in `f`/`g`/`h`/`i`/`j`/`legacy-slice1..4`/`m`.

Screenshots: `docs/verification/ui-parity/inspector-open.png`,
`more-filters-open.png`, `context-summary.png`, `keyboard-shortcuts-help.png`,
`live-state.png`, `desktop-workspace-1440px.png`, `narrow-390px.png`.

---

## 7. Commands run

```
cd backend && ./mvnw --batch-mode verify           # 494 passed, BUILD SUCCESS (unchanged - no backend edits)
cd frontend && npm run typecheck                    # clean
cd frontend && npm run test -- --run                # 473 passed
cd frontend && npm run build                        # succeeded
SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run    # real backend for E2E
cd frontend && npx playwright test                   # 116 passed
```

---

## 8. Regressions

None. Every pre-existing backend test (494), frontend test (438 baseline, all still
passing unmodified), and Playwright spec (106 baseline, all still passing unmodified)
continues to pass exactly as before this pass. Slice 1-4 behavior was not touched
except where this report explicitly says so (AdvancedFilters gained a Reset button
and a real layout-safety fix; nothing else in Slices 1-4 was edited).

## 9. Scope discipline

Not touched: Issue #19, Slice 5's actual reconnect/resilience engine, any backend
API contract, search/query DSL semantics, the Compose project boundary, Docker/TLS
security model, masking rules, any unrelated refactoring. This report does not claim
the overall legacy remediation effort complete - materially different areas remain
(§5 above), and this pass's own honest 79% (not 100%) visible-parity figure reflects
that directly.
