# Legacy Remediation Slice 4 — Results Table Configurability & Power-User Controls

Verification report for `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 4". Base
SHA `904a988` / `904a988ffb58bf4ad456e291d1a2995b806feaee` (`main`, PR #21 merged —
Legacy Remediation Slice 3). Branch `phase/legacy-slice-4-table-configurability`.

This slice adds optional, persisted, keyboard-accessible results-table
customization (show/hide columns, reorder, density, reset) on top of the
existing seven-column default, without touching search/query semantics or any
backend API. It does **not** constitute completion of the full legacy
remediation effort — Slice 5 (Live reconnect controls), Slice 6 (investigation
gaps), and Slice 7 (message redaction) remain.

---

## 1. Owner decision — the seven-column default is preserved exactly

Before writing any code, the pre-Slice-4 table (`ResultsTable.tsx`,
`columns.ts#RESULT_COLUMNS`) was read directly: seven hardcoded columns — Time,
Level, Service, What happened, User/Customer, Correlation/Trace, Actions — in
that exact order, with no show/hide/reorder/density mechanism at all
(`TABLE-02`/`TABLE-03`/`TABLE-04` in the capability matrix, all `NEW_MISSING`
or `SUPERSEDED_BY_OWNER_DECISION` before this slice).

Per the mission's own non-negotiable instruction, this default is **not**
changed. Slice 4 adds optional power-user controls entirely on top of it — the
regression proof for this is structural, not just asserted: every pre-existing
`ResultsTable`/`ResultsPanel`/`ActionsCell`/`MessageCell` test in this
repository still passes **unmodified** against the new registry-driven
implementation, because the new `columnOrder`/`hiddenColumnIds`/`density`
props are all optional and default to exactly the registry's own seven-column
default (`ResultsTable.tsx`'s own prop defaults; see §2).

---

## 2. Column registry architecture

`features/results/columnRegistry.tsx` is the single authoritative source of
every column's shape — id, label, default visibility, width, cell class, and
renderer. Nothing about a column is duplicated in `ResultsTable.tsx` or the
Columns control; both only ever read `COLUMN_REGISTRY`/`COLUMN_REGISTRY_BY_ID`.

- `id` (`ColumnId`, a closed union of 23 values) is the **only** thing ever
  persisted — stable and independent of `label`, so a future copy change can
  never invalidate a saved preference.
- `defaultVisible: true` on exactly six entries (`time`, `level`, `service`,
  `whatHappened`, `userCustomer`, `correlationTrace`), in that order —
  `columnRegistry.test.tsx#has exactly seven default-visible columns...`
  asserts this exactly.
- **`actions` is deliberately not a registry entry at all.** It is a
  structurally mandatory, position-pinned eighth cell rendered directly by
  `ResultsTable.tsx`, always last — see §5 for why.
- `cellClassName` is applied to the `<td>` itself, never an inner `<span>` — a
  real bug caught and fixed mid-implementation (§9) once it was noticed that
  `.serviceCell`/`.idCell`'s `overflow:hidden`+`text-overflow:ellipsis`
  truncation only works correctly on the element that is actually
  width-constrained by `table-layout:fixed`'s own `<col>` width, which is the
  `<td>`, not a plain inline `<span>` inside it.

`ResultsTable.tsx` computes its visible column list by filtering
`columnOrder` against `hiddenColumnIds`, mapping each surviving id through
`COLUMN_REGISTRY_BY_ID`, and dropping any id the registry no longer recognizes
(§6 covers what happens for a stale/foreign id). The `<colgroup>`, `<thead>`,
and each `<tr>`'s data `<td>`s are all generated from this one list, plus a
hardcoded final Actions `<col>`/`<th>`/`<td>` — one semantic table, one
geometry system, exactly as CLAUDE.md §4 requires.

---

## 3. Optional columns

Seventeen optional columns, hidden by default, each backed by a genuine
existing `LogEvent` field (inspected directly in `shared/api/types.ts` before
adding any of them — none were invented):

Logger, Thread, Trace ID, Span ID, Correlation ID, Journey ID, Event ID, Error
code, Business step, UI identifier, Container (name, falling back to id),
Pod, Namespace, Compose project, Compose service, Device platform, Language.

None of the five protected fields (`cif`, `userName`, `customerId`,
`deviceId`, `deviceIp`) is offered as a dedicated column — the existing masked
User/Customer column remains the only place any of them appear, unchanged by
this slice. `columnRegistry.test.tsx` asserts this directly (no registry
column id/label ever matches a protected field name, and no optional column's
renderer ever echoes a raw protected value from a fully-populated fixture
event).

**A real, previously-missed gap found and fixed this slice**: Slice 3 added
`composeService` to the backend `EventDto`/`CanonicalLogEvent`/`EventMapper`
but never added it to the frontend `LogEvent` type — so it was already a real,
safe, non-sensitive field on every API response, just invisible to the
frontend. `shared/api/types.ts#LogEvent` now includes it, and it is offered as
the "Compose service" optional column.

---

## 4. Reordering mechanism — keyboard-only, no drag-and-drop

`tablePreferences.ts#useTablePreferences.moveColumn(id, 'up' | 'down')` swaps
a column with its adjacent neighbor in `columnOrder` (refusing at either
boundary — moving the first column up, or the last down, is a no-op).
`TableSettingsControl.tsx` renders this as a plain `<ol>` of rows, each with a
label, a visibility checkbox, and a pair of Move up/Move down `<button>`s
(disabled at the boundaries, with `aria-label="Move {label} up/down"`).

This deliberately satisfies the mission's own "provide a keyboard-accessible
alternative... do not make drag-and-drop the only interaction" requirement by
**not implementing drag-and-drop at all** — every reorder interaction is a
real, natively-focusable `<button>`, reachable by Tab and activatable by
Enter/Space, with no pointer-only path. `phase-legacy-slice4-table-configurability.spec.ts`'s
item 4/6 test drives this exact path by `.focus()`-ing the Move button and
pressing `Enter` (not `.click()`), proving the keyboard path independently of
mouse interaction.

Hidden columns retain their logical position in `columnOrder` even while
hidden — showing a previously-hidden column reveals it exactly where it
already was, never at an arbitrary end position (`tablePreferences.test.ts#shows
a previously-hidden optional column, at its existing position`).

---

## 5. Column safety — Actions is mandatory

`ActionsCell.tsx`'s "Inspect event" menu item is the **only** inspection entry
point in this codebase — confirmed by reading `ResultsTable.tsx` (pre- and
post-slice) and finding no row-level `onClick`/keyboard shortcut anywhere.

Per the mission's own explicit fallback rule ("If Actions is allowed to be
hidden, row click/keyboard inspection must remain fully functional — if that
cannot be guaranteed, keep Actions mandatory"), Actions is kept mandatory —
and structurally so, not just by convention: it is not a member of
`COLUMN_REGISTRY`/`COLUMN_REGISTRY_BY_ID` at all, so no preference — saved,
malformed, or otherwise — can hide or reorder it. `ResultsTable.tsx` always
renders it as the final `<td>`, unconditionally.

Separately, `useTablePreferences.setColumnVisible` refuses to hide the last
remaining visible *data* column (`currentlyVisibleCount <= 1` check) — the
table can never end up with zero visible data columns, only Actions.
`TableSettingsControl.tsx` disables that column's checkbox and gives it an
`aria-describedby` hint ("At least one column besides Actions must stay
visible") rather than silently failing.

"Reset table" is always present in the same popover, one click away, and
restores every Slice-4 preference in one action — the user can never get
stuck in an unrecoverable configuration.

---

## 6. Safe, versioned persistence

`tablePreferences.ts` persists exactly:

```json
{ "version": 1, "columnOrder": ["time", "level", ...], "hiddenColumnIds": ["logger", ...], "density": "comfortable" }
```

under `localStorage["logexplorer.tablePreferences.v1"]` — a versioned
top-level key, never bare. `sanitizeTablePreferences(raw: unknown)` never
trusts the stored shape and never throws (wrapped end-to-end, `readFromStorage`/
`writeToStorage` are both try/catch-guarded):

| Anomaly | Behavior |
|---|---|
| Missing/non-object/wrong `version` | Falls back to the full default |
| Unknown column id (a column later removed) | Dropped |
| Duplicate column id | First occurrence kept, rest dropped |
| Non-string entry (`42`, `null`, `{}`) | Dropped |
| A known column id missing from the saved order (a column added in a later release) | Appended to `columnOrder`, and hidden **iff** the registry's own `DEFAULT_HIDDEN_COLUMN_IDS` says so — never silently promoted to visible just because an old preference predates it |
| `hiddenColumnIds` would leave zero visible data columns | Falls back to the full default, discarding the whole saved preference (not just the offending field) |
| Invalid `density` (not exactly `'compact'`) | Falls back to `'comfortable'` |

The "known column missing from saved order" rule is the preference-migration
design the mission asked for: a future column added to `COLUMN_REGISTRY` never
breaks an old saved preference, and never appears visible for a user who never
opted into it (`tablePreferences.test.ts#appends a known column missing from
the saved order, inheriting the registry default-hidden posture`).

**Sensitive-data persistence proof**: the persisted shape's only fields are
`version` (a number), `density` (one of two fixed strings), and
`columnOrder`/`hiddenColumnIds` (arrays of short, known `ColumnId` strings,
e.g. `"logger"`, `"traceId"`). Nothing here can ever hold a log value, query
text, filter value, or a protected field — there is no code path in
`tablePreferences.ts` that reads anything from a `LogEvent`, `SearchState`, or
API response at all; it only ever reads/writes its own in-memory
`TablePreferences` object. Proven three ways:
1. Unit: `tablePreferences.test.ts#never persists anything beyond column
   ids/order/hidden-state and density` parses the actual persisted JSON and
   asserts its key set and that every array entry is a member of the known
   `ALL_COLUMN_IDS` set.
2. Unit: `ResultsPanel.test.tsx`'s customization tests never touch
   `runSearch`/`refresh`/`loadMore` — proving no search/filter state is even
   reachable from this code path (see §7).
3. Real browser: `phase-legacy-slice4-table-configurability.spec.ts` item 12
   runs a real search against real fixture data, captures a real visible row's
   text and a distinctive search-text sentinel, customizes the table, and
   asserts neither ever appears anywhere in `localStorage` — while also
   asserting the persisted shape's key set matches exactly.

---

## 7. Presentation-only — never triggers a search

`ResultsPanel.tsx` calls `useTablePreferences()` as an entirely independent
hook, unconnected to `useSearchState`/`SearchState` in any way — no shared
state, no callback into `runSearch`/`refresh`/`loadMore`/`applyQuery`/etc.
`TableSettingsControl` only ever receives the `TablePreferencesHandle`, never
`SearchState`, so it is structurally incapable of firing a search.

`ResultsPanel.test.tsx#hiding/showing a column or changing density via the
Columns control never calls runSearch, refresh, or loadMore` and the real
browser tests (`phase-legacy-slice4-table-configurability.spec.ts` items 8/9,
which watch that Load More/Refresh still work correctly, and item 2-6, which
drives every column/reorder/density interaction) both confirm this — the
interaction model is deliberately "live/immediate-apply" (unlike
`AdvancedFilters`/`QueryBuilder`/`DockerSettingsPanel`'s draft/Apply/Cancel
pattern), justified because nothing here is destructive or network-triggering,
and Reset always fully recovers.

---

## 8. Density and geometry

`TableSettingsControl.tsx`'s Comfortable/Compact segmented toggle
(`aria-pressed`) maps to `ResultsTable.tsx` applying a `.compact` class
alongside `.table`; `ResultsTable.module.css`'s new rule
(`.compact th, .compact td { padding: var(--space-1) var(--space-2); }`) only
ever changes cell padding — font size is deliberately left untouched
(accessibility: readable text size, hit-target size, and focus-ring visibility
are all unaffected by density). Default density is unchanged (`'comfortable'`,
matching the pre-Slice-4 table exactly). The existing `≤2px` header/cell
geometry invariant, one `<table>`/one `<colgroup>`/`table-layout:fixed`, and
horizontal-scroll-wraps-the-table (not the page) behavior all continue to hold
with a wider, customized column set — `phase-legacy-slice4-table-configurability.spec.ts`
items 1-6/8/13 assert `assertTableGeometry`/`assertNoHorizontalOverflow` at
both the default and a 9-column customized configuration, including at 390px.

---

## 9. Bugs found and fixed during implementation (self-caught, before any test run)

1. **CSS-truncation regression risk**: the first draft of
   `columnRegistry.tsx` wrapped cell content in styled `<span>`s instead of
   applying the class to the `<td>`. Since ellipsis truncation depends on the
   element being width-constrained by `table-layout:fixed`'s own `<col>`
   width (the `<td>`, not an inner `<span>`), this would have silently broken
   truncation for Service/User-Customer/Correlation-Trace and all 17 optional
   columns. Fixed by adding `cellClassName` to `ColumnDefinition`, applied by
   `ResultsTable.tsx` directly to the `<td>`.
2. **`sanitizeTablePreferences` migration-safety bug**: the first draft
   appended missing/newly-registered column ids to `columnOrder` but left a
   dead no-op loop instead of actually computing which of them should be
   hidden — meaning a column added to the registry in a future release would
   have defaulted to *visible* for any pre-existing saved preference, directly
   violating "new optional columns remain hidden unless explicitly defaulted."
   Fixed by tracking which ids were genuinely present in the raw saved
   payload versus appended, and only marking an appended id hidden when the
   registry's own `DEFAULT_HIDDEN_COLUMN_IDS` says so.
3. **JSDoc self-closing comment**: a comment containing the literal substring
   `*default*/reset` prematurely closed its own `/** ... */` block, cascading
   into ~14 TypeScript parse errors. Fixed by rewording to avoid any `*/`
   substring in prose.

No user-reported errors occurred in this slice — all three were caught during
implementation, before the first test run.

---

## 10. Tests

### Backend — `./mvnw --batch-mode verify`

Slice 4 made **zero backend code changes** (per the mission's own "should
normally require NO backend behavioral change" instruction — the one
frontend-visible gap found, `composeService`, was already a safe, existing
backend field from Slice 3; only the frontend type was missing it). Full
regression run anyway:

```
[INFO] Tests run: 494, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

Unchanged from the Slice 3 merge baseline (494) — confirming no regression.

### Frontend — `npm run typecheck && npm run test && npm run build`

```
tsc -b --noEmit             -> clean
Test Files  48 passed (48)
Tests       438 passed (438)
vite build                  -> ✓ built in 405ms
```

63 new tests this slice, covering the mission's explicit 20-item list:

- `columnRegistry.test.tsx` (new, 10 tests) — exact seven-default shape/order/
  labels, 23 unique ids, `actions` never a registry entry, no protected field
  ever exposed as a column id/label, the full 17-item optional-column list,
  per-renderer empty/real-value/no-raw-sensitive-echo checks.
- `tablePreferences.test.ts` (new, 23 tests) — default shape, every
  `sanitizeTablePreferences` anomaly in §6's table, and the full
  `useTablePreferences` hook surface (hide/show, last-visible-column refusal,
  reorder + boundary refusal, density, reset, persistence round-trip,
  corrupted-storage fallback, and the persisted-shape sensitive-data proof).
- `TableSettingsControl.test.tsx` (new, 14 tests) — checkbox show/hide,
  keyboard-focused Move up/down reorder, boundary-disabled move buttons,
  density toggle, Reset table, last-visible-column disabled state with an
  accessible description, jest-axe, and a direct proof that every interaction
  here only ever writes the `tablePreferences` storage key.
- `ResultsTable.test.tsx` (extended, +8 tests) — optional column rendering via
  props, reordering keeps row cells aligned with headers, Actions always last
  regardless of `columnOrder` content, density class application, selection
  styling and inspector wiring survive a customized configuration.
- `ResultsPanel.test.tsx` (extended, +8 tests) — Columns control only renders
  alongside real results, no customization interaction ever calls
  `runSearch`/`refresh`/`loadMore`, configuration survives Refresh and Load
  More, Inspector still works with the control mounted, breadcrumb/context
  workflow unaffected, safe preferences read back correctly on a fresh mount.

Baseline (Slice 3 merge) was 375; 375 + 63 = 438.

### E2E — `npx playwright test`

```
106 passed (3.3m)
```

New file `frontend/e2e/phase-legacy-slice4-table-configurability.spec.ts` (8
tests, covering all 13 mission browser-verification items — several items are
combined into one continuous flow test where they naturally chain, e.g.
items 1-6). Run against the real backend (`SPRING_PROFILES_ACTIVE=dev`,
Fixture source, the same 250-event corpus Slice 1 sized for Load More
testing). Baseline (Slice 3 merge) was 98; 98 + 8 = 106 — every pre-existing
spec (including `phase-g-results-table.spec.ts`'s own seven-column/geometry
checks) passes unmodified.

Screenshots: `docs/verification/legacy-slice4/default-seven-columns.png`,
`customized-compact-columns.png`, `preferences-survive-reload.png`,
`reset-to-default.png`, `narrow-viewport-390px.png`.

---

## 11. Commands run

```
cd backend && ./mvnw --batch-mode verify           # 494 passed, BUILD SUCCESS (unchanged - no backend edits)
cd frontend && npm run typecheck                    # clean
cd frontend && npm run test -- --run                # 438 passed
cd frontend && npm run build                        # succeeded
SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run    # real backend for E2E
cd frontend && npx playwright test                   # 106 passed
```

---

## 12. Known limitations / blockers

- **No sort control** — unchanged from before this slice; the results table
  remains always-newest-first by explicit, pre-existing owner decision
  (`TABLE-05`, `SUPERSEDED_BY_OWNER_DECISION`). Sort was never in this slice's
  scope and nothing here reopens it.
- **Density has two levels only** (Comfortable/Compact) — the mission
  explicitly said a third level is optional and "only if it already fits the
  design system"; no third density token exists in this codebase's current
  design system, so none was added.
- Table preferences are stored per-browser (`localStorage`), not per-account —
  there is no user-account concept anywhere in this application to store them
  against instead; this matches every other piece of client-side state in the
  app (there is nothing comparable to compare against for precedent, since
  this is the first real `localStorage` persistence in the codebase — see
  `useResizablePanel.ts`'s own "explicitly not persisted" comment for the
  prior posture).

---

## 13. Scope discipline

Not touched: Issue #19, Slice 5 (Live reconnect controls), Slice 6
(investigation gaps), Slice 7 (message redaction), search/query semantics,
any backend API contract, any unrelated refactoring. This report does not
claim the overall legacy remediation effort is complete.
