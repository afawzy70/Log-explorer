# UI Gap Closure Pass

Verification report for the owner-authorized **UI GAP CLOSURE PASS — FINAL VISIBLE
PARITY CLEANUP BEFORE SLICE 6** mission. Base SHA `c5acc74` /
`c5acc742248341a2496b1d23779a0f9a1f749fe6` (`main`, PR #24 merged — Legacy
Remediation Slice 5), resolved via `git fetch origin main --quiet && git rev-parse
origin/main` per the mission's own preliminary requirement (never an abbreviated SHA
from chat/screenshots). Branch `phase/ui-gap-closure`.

This pass closes the highest-value remaining **visible** UI gaps between CURRENT and
OLD identified in `docs/verification/UI_PARITY_ACCELERATION_REPORT.md`'s own
35-row rubric, before Slice 6 begins. It is explicitly **not** another broad
redesign, **not** the start of Slice 6, and does not auto-merge.

---

## 1. Method — the exact starting gap list

Per the mission's own instruction, this was not worked from memory: the starting
gap list was extracted directly from `docs/verification/UI_PARITY_ACCELERATION_REPORT.md`'s
own forensic audit matrix (post-Slice-5 state, 30/35 ≈ 86%), read before any
implementation began. The remaining `MISSING`/`PARTIAL` rows at that point were:

| Row | Area | Status (pre-Gap-Closure) | This pass's decision |
|---|---|---|---|
| 2 | Environment/profile header indicator | `MISSING` | **IMPLEMENT NOW** |
| 9 | More Filters: right-side panel vs. drawer | `PARTIAL` | **IMPLEMENT NOW** |
| 13 | Row click opens the inspector | `PARTIAL` | **KEEP PARTIAL** (reassessed, not implemented) |
| 20 | Context chronological (ascending) ordering | `PARTIAL` | **IMPLEMENT NOW** |
| 31 | Live control keyboard shortcuts | `MISSING` | **IMPLEMENT NOW** |

Every other row in the 35-row rubric was already `FULL`, `NEW_BETTER`, or
`SUPERSEDED_BY_OWNER_DECISION` and out of scope for this pass.

---

## 2. Action taken per gap

### Gap 1 — Environment/profile indicator

**Decision: IMPLEMENT NOW.**

- Backend: `EnvironmentInfoContributor.java` (new) implements Spring Boot's
  `InfoContributor`, adding an `environment` detail to the already-exposed
  `/actuator/info` endpoint (`management.endpoints.web.exposure.include:
  health,info` was already configured; no new endpoint exposure). The value is
  `Environment.getActiveProfiles()` joined verbatim, or the literal string
  `"default"` when no profile is active — **never** an inferred value like
  "production". `EnvironmentInfoContributorTest.java` (3 tests) asserts this,
  including an explicit assertion that the no-profile case is never mislabeled
  "production".
- Frontend: `EnvironmentBadge.tsx` (new) fetches `/actuator/info` once on mount
  (the active profile cannot change mid-session) and renders `environment.label`
  uppercased in a small, bordered, monospace badge — visually distinct from the
  adjacent source-name span so environment and source are never confused (mission
  requirement: "source and environment must not be confused"). Renders **nothing**
  (not a fallback label) if the fetch fails or the field is genuinely absent —
  never a guessed deployment environment. Mounted in `Shell.tsx`, right after the
  product title.
- Verified truthful against the real running dev-profile backend: `curl
  localhost:8080/actuator/info` → `{"environment":{"label":"dev","activeProfiles":["dev"]}}`;
  the E2E suite's own environment-badge test fetches the same endpoint independently
  and asserts the rendered badge text matches it exactly, never a hardcoded string.

### Gap 2 — More Filters drawer

**Decision: IMPLEMENT NOW** (upgrade from popover to a genuine right-side drawer).

Reassessed per the mission's own instruction: the existing popover was already
functionally complete (Apply/Cancel/Reset, draft/committed separation, results
visible underneath), but a real `position: fixed` right-side panel gives more
available filter space, is a more standard "workspace" affordance for a dense
investigation tool, and — found while making the change — **structurally
eliminates** (not just re-fixes) the left-edge-reachability bug class the UI Parity
Acceleration Pass had to patch in the old popover (that panel was `position:
absolute` relative to its own trigger, which lives inside a wrappable toolbar; a
`position: fixed` drawer anchored to the viewport can never inherit that failure
mode regardless of any future toolbar layout change).

- `AdvancedFilters.module.css`: `.panel` converted to `position: fixed; top: 0;
  right: 0; bottom: 0`, full viewport height, `width: 420px` (`100vw` under
  640px — full-width on mobile, per the mission's own allowance), a lightweight
  `slideIn` animation (`prefers-reduced-motion` gets an instant appearance, never
  a slide). Deliberately **no dimming backdrop** — results stay visible beside it,
  per the mission's mandatory requirement. Only the `.groups` field-list region
  scrolls now (`overflow-y: auto; min-height: 0`), not the whole panel — so
  Apply/Cancel/Reset (`.actions`, a non-scrolling sibling) are always reachable
  regardless of content length.
- `AdvancedFilters.tsx`: the heading (`"More filters"`) is now visually shown, not
  just an accessible name (`VisuallyHidden` removed from it); focus moves to the
  heading when the drawer opens (`headingRef.current?.focus()` in a `useEffect`
  keyed on `popover.isOpen`) and `usePopoverTrigger`'s own existing focus-return
  behavior returns focus to the trigger on close — completing the accessibility
  round trip the mission requires ("focus returns to trigger"). Draft/Apply/
  Cancel/Reset logic itself is **byte-for-byte unchanged** — opening the drawer
  never fires a search, closing/cancelling never mutates committed filters, same
  as before.
- WHO/CUSTOMER, REQUEST FLOW, WHAT HAPPENED (business/error), CLIENT CONTEXT
  groupings (`ADVANCED_FILTER_GROUPS`) were **not** touched — no group was added,
  removed, or emptied by this change.

### Gap 3 — Context chronological ordering

**Decision: IMPLEMENT NOW.**

The UI Parity Acceleration Pass had explicitly deferred this one on a real,
named risk: "reordering risks a silent order/cursor mismatch with Load More's own
cursor pagination." That risk is real — `showContext`'s context view can genuinely
page further via the same `/search` endpoint and cursor mechanism as an ordinary
search, if a ±30s window holds more than the default page limit — so this pass
designed around it explicitly rather than ignoring it:

- `useSearchState.ts#sortByTimestampAscending` sorts a **copy** of an events array
  by parsed timestamp ascending (missing/unparseable timestamps sort last, stably —
  never `NaN`-order chaos).
- The STORED `searchResult.events` array itself is sorted at the exact two points
  it is ever set for a context view: `showContext`'s fetch resolution, and
  `loadMore`'s merge when `breadcrumbLabel !== null` (i.e. still in context mode).
  Because there is only ever one array (never a parallel "sorted for display, raw
  for indexing" pair), `selectedIndex`/`selectedEvent` stay correct automatically —
  the exact class of bug a display-only reorder would have risked is structurally
  avoided. An ordinary (non-context) search's `loadMore` path is **completely
  unchanged** — verified by a dedicated regression test asserting ordinary
  `loadMore` still preserves exact append order.
- The main results table's own newest-first invariant (CLAUDE.md §4) is
  **untouched** — this ordering change is scoped exclusively to the context view,
  never applied to ordinary search results or search pagination.
- The original event under investigation stays visually identifiable independent
  of ordinary row-selection/inspector state: a new `contextRootIdentity` piece of
  state (matched via the existing, now-exported `eventIdentity()` content-identity
  function) drives a distinct `.contextRootRow` CSS class (a dashed accent outline,
  non-color-alone) plus `aria-current="location"` plus a visually-hidden "Original
  event you were investigating" label on the matching `<tr>` — deliberately
  independent of `selectedIndex`/`.selectedRow` so it is never conflated with, and
  can coexist with, ordinary row selection.
- Returning to the original search (`restoreOriginalSearch`) restores the
  pristine, never-sorted original result and clears `contextRootIdentity` — the
  root marker never lingers into an ordinary search view.
- `ContextSummary.tsx`'s disclaimer copy was updated to state the actual behavior
  honestly ("Sorted chronologically, oldest first — this order does not indicate
  causality between events. The highlighted row below is the original event you
  were investigating.") — the "does not indicate causality" language is preserved,
  not just the chronology claim.

### Gap 4 — Live keyboard productivity

**Decision: IMPLEMENT NOW.**

- `useLiveKeyboardShortcuts.ts` (new) adds `P` (pause/resume, state-aware), `S`
  (stop, from every active state), `C` (clear, only when there are visible
  events), `F` (toggle follow-newest) while Live is the active view
  (`isActive === liveModeActive` in `App.tsx`, the same boolean that already gates
  whether `LiveTailPanel` renders at all — these bindings can never fire from the
  historical search screen).
- Guarded against modifier keys (`ctrlKey`/`metaKey`/`altKey` — never fights a
  browser/system shortcut) and text-entry targets (`isTypingTarget`, the same
  guard the pre-existing `?`/`/`/`Ctrl+Enter` shortcuts already use) — typing
  "p"/"s"/"c"/"f" anywhere is never hijacked.
- A `liveRef` pattern (`const liveRef = useRef(live); liveRef.current = live;`)
  keeps the effect's own dependency array to just `[isActive]`, so the single
  `document` listener is registered once per Live session and never torn down/
  re-added on every render (`useLiveTail()`'s returned object is a fresh literal
  every render) — verified by a dedicated test spying on
  `document.addEventListener`.
- Every control this hook drives remains **fully reachable by click alone** — the
  mission's own "keyboard shortcut availability must not be required for using the
  feature" requirement — this hook is purely additive, no existing button was
  changed or removed.
- `KeyboardShortcutsHelp.tsx`'s `SHORTCUTS` list gained the four new entries, each
  noting "while Live is the active view".

### Gap 5 — Row-click-to-inspect (reassessed, not implemented)

**Decision: KEEP PARTIAL.** Reassessed as the mission required, deliberately left
unimplemented. Row click still does not open the inspector; only the Actions menu
does — Slice 4's own deliberate, documented decision
(`ResultsTable.tsx`'s own comment: Actions is the *only* inspection entry point,
kept structurally mandatory so column customization can never make the inspector
unreachable).

Adding a bare row click was judged **not clearly safe enough** for this pass,
specifically because it would need to coexist correctly with three things at once,
none of which is unsolvable but none of which is a low-risk bolt-on either:

1. **Text selection** — a click that starts or ends a text selection inside a cell
   (e.g. selecting part of a long message to copy it) must not also fire row
   navigation; this needs an explicit "was this click part of a selection"
   check, not just a plain `onClick`.
2. **Keyboard semantics** — arrow-key row navigation (UI Parity Acceleration Pass)
   already lands focus on the row's Actions button, not the row itself. A bare
   click handler on the `<tr>` would create two different activation models for
   the same row (click-anywhere vs. focus-then-activate-Actions) rather than one
   consistent one.
3. **Screen-reader semantics** — a data-table row that becomes a native
   interactive element changes its accessible role/expectations; this needs
   verification, not an assumption that it is harmless.

**Recommendation, if revisited later**: a row click handler that explicitly
ignores clicks originating inside an active text selection, and that treats
Actions as the authoritative keyboard entry point rather than a replacement for
it — but that is a real design change to Slice 4's own contract, not a same-pass
addition, matching this pass's own "do not implement unless clearly safe" bar.

---

## 3. Owner decisions — explicitly verified untouched

- **Live pre-start confirmation dialog** — still absent. `LiveTailPanel.tsx`'s
  `Start` button still starts immediately (`onStartLive`/`live.start` unchanged);
  no dialog was added.
- **Table density / seven-column default** — `COLUMN_REGISTRY`'s default-visible
  set and `ResultsTable`'s seven-column invariant are unchanged; Slice 4's table
  customization is fully intact (unmodified in this pass).
- **No raw sensitive values exposed** — this pass touched no masking code; the
  environment badge, drawer, context ordering, and Live shortcuts carry no
  sensitive-field data at all (`environment.label` is a Spring profile name, never
  user data).
- **Frontend-only Docker project filtering** — not reintroduced; this pass made no
  Docker-related change.
- **Fake Loki Live capability** — not reintroduced; this pass made no
  capability-gating change.

---

## 4. Performance

- No expensive render loops, unbounded lists, or heavy animation library added.
  The drawer's `slideIn` is a plain CSS `transform` keyframe (GPU-composited, no
  JS animation loop), and is skipped entirely under `prefers-reduced-motion`.
- Context sorting (`sortByTimestampAscending`) operates only on the already-bounded
  context result set (the same `/context`/`/search` page-size bounds every other
  search result already respects) — never an unbounded scan.
- `useLiveKeyboardShortcuts` registers exactly one `document` `keydown` listener
  for the life of an active Live session (verified by a dedicated no-duplicate-
  listener test spying on `addEventListener`/`removeEventListener` across
  re-renders and `isActive` transitions), not per-render.
- `EnvironmentBadge` fetches `/actuator/info` exactly once on mount, never polls.
- **PERFORMANCE_REGRESSION: NO.**

## 5. Accessibility

- Drawer: focus moves to the (now-visible) heading on open; Escape and outside
  click still close it via the pre-existing `useDismissableLayer`; focus returns
  to the trigger button on close (verified by a dedicated E2E assertion and a
  unit test).
- Context ordering: the results table remains one semantic `<table>`; row order
  changing does not alter table semantics. The root-event marker uses
  `aria-current="location"` (never color-alone) plus a real (if visually-hidden)
  text label, satisfying the mission's "not color-only" requirement.
- Live shortcuts: purely additive; no existing accessible name or role was
  changed. Documented in `KeyboardShortcutsHelp.tsx` so they are discoverable, not
  just implemented.
- Environment badge: not color-only — the label text itself (e.g. "DEV") is the
  signal, plus a `title` tooltip; no reliance on badge color alone.
- **ACCESSIBILITY: PASS** (see §7 for the automated `jest-axe` coverage this
  relies on — every touched component's existing axe test still passes with zero
  violations, closed or open).

## 6. Responsiveness

Verified at 1440px (desktop), 390px (narrow/mobile), and via the full pre-existing
narrow/zoom regression suites (`f`/`g`/`h`/`i`/`j`/`legacy-slice1..5`/`m`), all of
which remain green. The drawer becomes full-width (`100vw`) under 640px, matching
the mission's own allowance ("may become full-width... if more usable"); its action
row stays reachable at every width because only the field-list region scrolls.
**MOBILE_REGRESSION: NO.**

---

## 7. Tests

### Backend — `./mvnw --batch-mode verify`

```
[INFO] Tests run: 500, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

Baseline (Slice 5 merge, `docs/verification/LEGACY_REMEDIATION_SLICE_5_REPORT.md`)
was 497; 497 + 3 (`EnvironmentInfoContributorTest`) = 500.

### Frontend — `npm run typecheck && npm run test -- --run && npm run build`

```
tsc -b --noEmit             -> clean
Test Files  61 passed (61)
Tests       550 passed (550)
vite build                  -> ✓ built in 368ms (dist/assets/index-8r_uHYY7.js 280.83 kB / gzip 84.26 kB)
```

39 new tests this pass: `EnvironmentBadge.test.tsx` (new, 8), `useLiveKeyboardShortcuts.test.ts`
(new, 14), `useSearchState.test.ts` (+7 — context ordering: ascending sort,
null-timestamp-last, root-identity tracking, clears on fresh search/restore,
`loadMore` re-sorts a context view but never reorders an ordinary search),
`ResultsTable.test.tsx` (+4 — `contextRootIdentity` marking, no-false-positive,
visually-hidden label, combines with `.selectedRow`), `AdvancedFilters.test.tsx`
(+5 — drawer heading visibility, focus-to-heading on open, focus-return-to-trigger
on close, opening never applies, results stay visible), `KeyboardShortcutsHelp.test.tsx`
(+1 — the four new Live shortcut entries are documented). Baseline was 511; 511 +
39 = 550.

### E2E — `npx playwright test`

```
130 passed (4.9m)
```

New file `frontend/e2e/phase-ui-gap-closure.spec.ts` (6 tests, covering all 17
mission-listed browser-verification items — several combined into one continuous
flow test where they naturally chain, matching this project's existing convention,
e.g. items 8-12 chain through inspector → context → chronological order → root
marker → restore). Run against the real backend (`SPRING_PROFILES_ACTIVE=dev`,
Fixture source). Baseline (Slice 5 merge) was 124; 124 + 6 = 130 — every
pre-existing spec passes unmodified, including the narrow/zoom regression suites.

Item 10 (chronological ascending) is verified against **real backend data**, not
a synthetic fixture in the test itself: the test captures the actual
`/api/v1/logs/context` network response, sorts a copy of it ascending independently
in the test's own code, and asserts that computed order equals the actual rendered
`tbody` row order.

Screenshots: `docs/verification/ui-gap-closure/more-filters-drawer-open.png`,
`context-chronological-with-root-marker.png`, `environment-badge.png`,
`desktop-workspace-1440px.png`, `narrow-390px-drawer.png`.

---

## 8. Commands run

```
cd backend && ./mvnw --batch-mode verify                          # 500 passed, BUILD SUCCESS
cd frontend && npm run typecheck                                   # clean
cd frontend && npm run test -- --run                                # 550 passed
cd frontend && npm run build                                        # succeeded
SPRING_PROFILES_ACTIVE=dev ./mvnw --batch-mode --quiet spring-boot:run &   # real backend for E2E
cd frontend && npx playwright test                                  # 130 passed
```

---

## 9. Regressions

None. Every pre-existing backend test (497 baseline), frontend test (511 baseline,
all still passing unmodified except one intentional, documented text-assertion
update in `ContextSummary.test.tsx` matching this pass's own honest copy change),
and Playwright spec (124 baseline, all still passing unmodified) continues to pass.
Slices 1-5 and the UI Parity Acceleration Pass's own behavior were not touched
except where this report explicitly says so.

## 10. Scope discipline

Not touched: Slice 6, Slice 7 redaction, Docker security architecture, pagination
semantics, the Query DSL, the overall application layout/redesign, Live buffering/
reconnect architecture (Slice 5's own engine — untouched; the new keyboard
shortcuts call its existing `pause`/`resume`/`stop`/`clear`/`setFollowNewest`
functions, they do not change how any of them work). No auto-merge was performed.

---

## 11. Visible UI parity re-measurement

See `docs/verification/UI_PARITY_ACCELERATION_REPORT.md` §2 (updated in place, the
same way it was already updated in place for Legacy Remediation Slice 5's own
closures) for the full recalculated 35-row matrix.

```
FULL         = 32
PARTIAL      = 1   (row 13 — row-click-to-inspect, reassessed, kept PARTIAL)
MISSING      = 0
NEW_BETTER   = 1
SUPERSEDED_BY_OWNER_DECISION = 1
```

`VISIBLE_UI_PARITY_BEFORE_PERCENT` (this pass's own before, post-Slice-5): **86%**
(30/35).

`VISIBLE_UI_PARITY_AFTER_PERCENT` (this pass's own after): **97%** (34/35 — FULL +
NEW_BETTER + SUPERSEDED). This is not a forced number: it is what the honest
recalculation produces once the four real, tested gap closures above are counted
against the same 35-row rubric — reported as 97%, not rounded up to a clean 100%,
because row 13 remains genuinely `PARTIAL` by this pass's own deliberate decision.

---

## 12. Remaining visible gaps

- **Row-click-to-inspect** (row 13) — reassessed, deliberately kept `PARTIAL`. See
  §2's "Gap 5" above for the full reasoning and the recommended approach if
  revisited later.

No other `MISSING`/`PARTIAL` rows remain in the 35-row visible-UI rubric.

---

## 13. Owner action required

`OWNER_ACTION_REQUIRED: NO` for merging this branch — GitHub-hosted CI evidence is
in the final report message. The only open item is the row-13 recommendation
above, which is informational (a documented recommendation for a future pass),
not a decision this branch is blocked on.
