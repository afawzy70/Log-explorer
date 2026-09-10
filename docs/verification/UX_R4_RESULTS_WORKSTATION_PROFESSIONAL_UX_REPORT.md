# UX-R4 — Results Workstation Professional UX — LERUX-1

Mission: `UX_R4_RESULTS_WORKSTATION_PROFESSIONAL_UX`.
Base: `f237ebd81792250fca40c09513e1063c685570f7` (post-PR #34 `main`).
Branch: `ux/r4-results-workstation-professional-ux`.

Protocol marker `LERUX-1` — the project-local
`log-explorer-professional-ux-reviewer` skill was registered, discoverable
and loaded in a fresh session before any implementation. No manual
fallback was used.

---

## 1. Skill activation evidence

```
UX_SKILL_REGISTERED=YES
UX_SKILL_DISCOVERABLE=YES
UX_SKILL_LOADED=YES
UX_SKILL_PROTOCOL=LERUX-1
MANUAL_FALLBACK_USED=NO
```

`.claude/skills/log-explorer-professional-ux-reviewer/SKILL.md` (8768
bytes, 159 lines) is committed to the repository — it is not a local-only
file — with frontmatter `name` matching its directory. It appeared in the
session's available-skills list and its body loaded on invocation,
declaring the marker `LERUX-1`.

Its core rule governed this whole mission: **rendered-browser evidence
first**. Every BEFORE claim below was measured in a real browser against
the real backend, not read off source. Two of them contradicted what the
source comments said, and the measurement won both times (§4.1, §6.1).

---

## 2. PR #34 merge gate

| Gate | Result |
|---|---|
| HEAD equals accepted `2b7db59a1bbb7afc3a972cd33b99d0eee7d9201e` | PASS — matched exactly, no commits after the accepted HEAD |
| PR OPEN | PASS |
| Mergeable | PASS (`MERGEABLE` / `CLEAN`) |
| Backend / Frontend / E2E / Windows Desktop checks | PASS — all four green |
| Squash-merge | PASS — merge commit `f237ebd81792250fca40c09513e1063c685570f7` |
| Local `main` synced | PASS — fast-forward, clean tree |
| Post-main CI | PASS — `CI: success`, `Windows Desktop: success` |

The merge was faithful, and independently so: PR #34's head tree and the
squashed `main` tree are byte-identical (`f305184a8b6328a5e742117ed41298d811f94581`).

**Environment note (recorded because it nearly corrupted the evidence).**
This machine has *two* checkouts — `/home/ahmedfawzy70/Log-explorer`
(this one) and `/home/ahmedfawzy70/log-explorer` (lowercase). A backend
and a Vite dev server left running by an earlier session were both
serving the **lowercase** checkout, so the first E2E runs of this session
exercised code that was not this working tree's. It was caught by
measuring behaviour that should have changed and had not. Both stale
processes were replaced with ones started from this checkout, and every
result reported below was produced against this checkout. The BEFORE
evidence remains valid: that checkout sat at `2b7db59`, whose tree is
byte-identical to the UX-R4 base commit.

---

## 3. Method

- Real backend, `SPRING_PROFILES_ACTIVE=dev` (deterministic Fixture
  corpus: 250 events, seed 42, 1-second spacing, four services, a
  deliberate malformed line, a deliberate empty-message event).
- Real Vite dev server from this checkout; real Chromium via Playwright.
- Real Docker 29.7.2 for the source-backed sort verification (§7.3).
- Computed-style and `getBoundingClientRect` measurements, not
  eyeballing, for every geometry/state claim.

---

## 4. BEFORE diagnosis (measured, not read)

Evidence: `docs/verification/UX_R4_EVIDENCE/BEFORE-*.png`. The spec that
produced them is preserved verbatim at
`docs/verification/UX_R4_EVIDENCE/before-evidence.spec.ts.txt`. It is
kept as a `.txt` record rather than as a live spec on purpose: it asserts
the *absence* of things UX-R4 adds (the sort control, the
surrounding-logs menu item) and renames, so leaving it executable would
have produced a spec that either fails or, worse, keeps passing while
claiming to show a "BEFORE" of the post-change app. To re-run it, check
out `f237ebd` and copy it back to `frontend/e2e/`.

### 4.1 Interaction — the row was inert

| Property | Measured BEFORE |
|---|---|
| Row click opens inspector | **No** — `dialog[name="Event details"]` count `0` after a real row click |
| Row hover feedback | **None** — `backgroundColor` was `rgba(0, 0, 0, 0)` both before and after `hover()` |
| Row focusable | **No** — `tabindex: null`, `role: null` |
| Cursor over a row | `auto` — the row did not even *look* clickable |
| Only inspection entry point | The 56px-wide `…` Actions trigger pinned to the far right of the row |

The source said so too: `ResultsTable.tsx`'s own doc comment stated
"Actions is structurally the only inspection entry point". So the
investigator's most common action — open the event I am reading —
required travelling from the message they were reading to a small target
at the opposite edge of the row, on every single event.

Of the three states §8 requires (HOVER / FOCUSED / SELECTED), **only
SELECTED existed**. The selected style itself was already reasonable
(`rgb(234,241,254)` + a 3px inset accent rail) — reported here as a
non-defect rather than inflated into one.

### 4.2 Scanning — the hierarchy worked against the eye

- **The message column was the only column with no width.** Under
  `table-layout: fixed` that made it the only column that could shrink.
  Opening the inspector — exactly when messages matter most — collapsed
  "What happened" to **~140px** ("Payment authorizatio…", "Journey step
  3: pay…") while Time (190px), User/Customer (160px) and
  Correlation/Trace (170px) held full width. Measured, and visible in
  `BEFORE-D-selected-row-inspector-open.png`.
- **ERROR rows had no row-level treatment at all**: `backgroundColor
  rgba(0,0,0,0)`, `borderLeft 0px`, `boxShadow none`. Severity lived
  entirely inside a small dot in the Level cell, so an ERROR row was
  visually identical to the 200 INFO rows around it.
- **The Time column spent the widest fixed column on the least
  discriminating text.** Every row read `Sep 10, 2026, 06:27:41.47` at
  uniform weight, with the calendar date — identical across essentially
  the whole result set — leading, and the part that actually varies
  (seconds, milliseconds) pushed right.

### 4.3 Missing capabilities

- **No sort control of any kind.** Asserted, not assumed: zero
  `combobox` named `/sort/i`, zero `/oldest first/i` control.
- **No "Show surrounding logs" in the row Actions menu.** Asserted:
  zero menu items matching `/surrounding/i`. The menu was "Inspect
  event" followed by five near-identical "Copy …" entries, so the one
  primary action was visually buried among utilities. The ±30s context
  action existed *only* inside the inspector's Request Flow section —
  reachable only after already opening an event.

---

## 5. UX decisions

**The framing question was not "how do we add row click" but "why does
this table make an investigator work?"** Three answers drove the design:
the fastest action was the hardest to reach; the most valuable column was
the first to be sacrificed; and the rows that matter most looked exactly
like the rows that matter least.

| Decision | Why |
|---|---|
| Row click opens the event; Actions is kept | Row click is the fast path; the menu is the discoverable, explicitly-labelled one (§17). Removing the menu would have traded discoverability for speed instead of gaining both |
| "View details" replaces "Inspect event" | Says what it does in the user's language, and pairs naturally with "Show surrounding logs". Same single semantic action as row click (§18) — one `onInspect`, two entry paths, never a second details implementation |
| A labelled `Sort` select, not a sortable Time header | A clickable header implies *column* sorting of *rows on screen*. This control commits a whole-result-set, source-side ordering that is re-queried and re-paginated from page 1. Naming the orderings in words states what the backend will actually do — truthfulness expressed in the affordance, not just the implementation |
| Sort control hidden in a context view | A ±30s context view is always chronological-ascending by design. Offering a direction control there would advertise a choice the view does not honor. The committed direction is preserved across the detour and restored on return — it is simply not editable while that view is on screen |
| ERROR gets tint + rail, WARN rail only, INFO nothing | §15's "discoverable without overwhelming INFO rows" and "not a rainbow", in one rule. Never colour alone: the Level cell still spells out the word |
| Date de-emphasised behind the time, never dropped | CLAUDE.md §4 requires date + time + milliseconds. This is weighting, not truncation — the two spans concatenate back to exactly the canonical string, asserted by test |

---

## 6. Table information hierarchy

### 6.1 The message column floor

The fix is *not* "give the message a fixed width" — that was tried,
measured, and rejected: it cost 91px in the default 1440px view (580 →
489) because the column stopped absorbing surplus.

What shipped instead keeps both properties: the message column still
declares **no** width (so it takes every surplus pixel), and the floor
moved to the table's own `min-width`, raised 900px → **1266px** (the six
fixed columns total 826px, leaving the message a guaranteed 440px).

| State | BEFORE | AFTER |
|---|---|---|
| 1440px, no inspector | 580px | **580px** (unchanged) |
| 1440px, inspector open | **~140px** | **440px** |

Both measured in a real browser. Below 1266px the *wrapper* scrolls
horizontally — explicitly allowed by CLAUDE.md §4 — and the page itself
still never overflows.

### 6.2 Columns

Default columns, order, and the seven-column default view are unchanged.
Every optional column remains in the Columns control. Nothing was removed
(§13's "do not remove old useful columns").

---

## 7. Sorting architecture

### 7.1 The key finding: the backend was already truthful

`SearchRequest.Direction` (`FORWARD`/`BACKWARD`) already existed and was
honored end-to-end — `LokiLogSource` passes `direction=forward|backward`
to Loki's own query-range API; `FixtureLogSource` and `DockerLogSource`
sort/merge in direction-of-travel order; `PageCursorCodec` binds the
direction into the cursor's request-binding HMAC, so a cursor issued for
one direction **cannot** be replayed against the other. `SearchDirection`
even existed in `frontend/src/shared/api/types.ts` — and was referenced
nowhere in the frontend.

So UX-R4 needed **no new backend sorting capability and no client-side
sorting**. It is pure wiring of a real source-side ordering.

**A stale comment nearly hid this.** `SearchController#journey`'s doc
comment claimed "only `LokiLogSource` honors direction at all;
fixture/Docker always return newest-first". That is false and has been
since the Slice 1 recovery. It was disproved by querying the real
backend, and the comment is corrected in this PR — it mattered because it
would have talked a future reader out of trusting source-side sorting and
into faking it in React, which CLAUDE.md §4 and §11 both forbid.

### 7.2 Pagination semantics

Direction is committed through one path (`setSortDirection`), which
passes it to `runSearch` as an override — the same mechanism, and the same
reason, as the existing `timeRangeOverride` (React state updates are not
synchronous, so the request built in the same tick would otherwise carry
the *previous* direction). `runSearch` drops the cursor, resets to page 1
and clears the inspector selection.

Consequently a direction switch **starts a fresh result set** and the two
directions' pages can never interleave. Re-selecting the committed
direction is a deliberate no-op.

### 7.3 Source truthfulness — verified, per source

**Fixture — PASS (real backend).** Both directions, page 1 + page 2 via
the real cursor:

| Direction | Ordering across both pages | Duplicates | Boundary |
|---|---|---|---|
| `BACKWARD` | correct descending | none | p1 ends `15:27:32`, p2 starts `15:27:31` — contiguous |
| `FORWARD` | correct ascending | none | p1 ends `15:23:41`, p2 starts `15:23:42` — contiguous |

**Real Docker — PASS.** Two real containers (`uxr4-sort-a`,
`uxr4-sort-b`) under Compose project `uxr4sort`, each emitting 12
uniquely timestamped JSON events one second apart:

| Direction | Events | Ordering | Cross-container merge |
|---|---|---|---|
| `BACKWARD` | 24 | truthful descending (`19:37:19` → `19:37:08`) | both services merged |
| `FORWARD` | 24 | truthful ascending (`19:37:08` → `19:37:19`) | both services merged |

Paginated at `limit=7`: 4 pages in each direction, **24 unique events,
zero duplicates, ordering correct across every page boundary in both
directions**. The bounded cross-container merge is therefore truthful
within the bounded search contract — not a fake global sort claim.

**Real Loki — BLOCKED.** No reachable Loki/OpenShift environment exists
in this session; no credentials, no endpoint. Loki's direction handling is
covered by adapter/unit contract tests only. Not reported as PASS.

```
REAL_LOKI_SORT_VERIFICATION=BLOCKED
```

---

## 8. Row interaction and selected-state model

- Click anywhere on a row opens **that** event. Clicks originating inside
  a control with its own semantics (Actions trigger/menu, the
  Correlation/Trace journey buttons, links, inputs) are excluded, so
  opening the menu or following a trace ID no longer risks two things
  happening from one click.
- **Roving tabindex**: exactly one row is in the tab order at a time — the
  selected row if there is one, otherwise the first. A 200-row result set
  must never put 200 tab stops between the table and "Load more". Arrow
  keys move within the table; Enter/Space opens the focused row.
- Selected state carries **two** independent cues plus a semantic one: a
  distinct background, a 4px accent rail (deliberately wider than the 3px
  severity rails, so a selected ERROR row still reads as *selected*), and
  `aria-selected` on the row.
- Hover, focus and selected are three different backgrounds — asserted as
  three distinct computed values, and `hover` on a selected row is
  asserted to leave the selected background unchanged.

A cascade regression was caught and fixed during this work: raising the
specificity of the new interaction rules would have made `.contextRootRow`
(single class) lose to `.selectedRow`, silently removing the "original
event you were investigating" marker in context views. Its selector was
raised to match.

---

## 9. Actions and context-return behaviour

The menu now leads with the two investigation actions, separated from the
copy utilities:

```
View details
Show surrounding logs
──────────────────
Copy Trace ID / Span ID / Correlation ID / Journey ID / Event ID
```

"Show surrounding logs" uses the **existing** bounded ±30s mechanism —
this table computes no window of its own — and is omitted (not disabled)
for an event with no parsed timestamp, since a malformed line has no
window to centre on. It means "show me the nearby chronological evidence",
never "explain the cause"; the context view's own summary continues to say
so explicitly.

**Context return (§20)** now restores the committed **sort direction** and
the **selected row** in addition to the result set, filters and time
range. Before UX-R4 an investigator reading oldest-first who took a
context detour landed silently back on newest-first with nothing selected.
The saved index is re-validated against the restored array rather than
trusted. The original search is not re-run.

---

## 10. Capability truthfulness — a defect found, and one deliberately left

All three sources declared `contextView = false` while the ±30s context
action was offered and worked (verified: a real context request returned
7 events). The Source health popover lists "Context" among capabilities,
so the app simultaneously offered the feature and told the user it was
unavailable — and UX-R4 makes that action far more prominent.

Nothing gates behaviour on this flag (it is display-only), so:

- **Fixture, Docker** — now declare `contextView = true`, each verified.
- **Loki** — deliberately left `false`. It cannot be verified here, and
  this project does not mark unverified things as working.

Tracked as **UX-25** in the register rather than silently changed.

---

## 11. Four Questions assessment

Scenario run end to end against the real app: choose Fixture → scan →
click an ERROR row → inspect → Show surrounding logs from row Actions →
return → switch to Oldest first → continue.

| Question | Change |
|---|---|
| **WHAT IS HAPPENING?** | **Materially improved.** The message column can no longer be crushed (~140px → 440px with the inspector open), and ERROR/WARN rows are now findable in a scan instead of being visually identical to INFO |
| **WHERE IS IT HAPPENING?** | **Materially improved.** Service identity is unchanged per event, but it is now readable *while* inspecting, because the table no longer sacrifices its content columns when the inspector opens. Active scope (source/Compose project) remains distinct from per-event service via UX-R3's ScopeTrail |
| **WHY IS IT HAPPENING?** | **Improved via access to evidence.** "Show surrounding logs" moved from "inside the inspector, after opening an event" to "one action on every row", and returning from it no longer discards where you were. Chronology is still never presented as causality |
| **WHO DID WHAT?** | **Unchanged, deliberately.** User/Customer remains masked server-side. UX-R4 adds no new identity surface — and the new entry points were tested to confirm they expose no raw protected value |

---

## 12. Accessibility

- Rows are focusable and operable by keyboard (Enter/Space), with arrow
  traversal and a roving tabindex.
- Visible focus ring on rows (`:focus-visible`, inset so the scroll
  wrapper cannot clip it on the first/last row).
- `aria-selected` on the selected row; `aria-current="location"` still
  marks the context root; `role="separator"` groups the action menu.
- Sort control has a real `<label>`; `jest-axe` finds no violations on it
  or on the extended actions menu.
- No colour-only meaning: severity rows still spell out ERROR/WARN.
- Geometry and no-page-overflow verified at 1920/1440/1280/1024/768/390
  and at 125%/200% zoom.

**A real accessibility/responsive regression was introduced and fixed
during this work**: adding the Sort control to the summary row pushed
"Refresh" 34px past the viewport at 390px, overflowing the *page* (which
CLAUDE.md §4 forbids outright). Found by measuring the rendered page at
390px, not by eye. Fixed by letting the row wrap — every control stays
reachable at every width; none were hidden.

---

## 13. Performance

| Metric | Before | After | Delta |
|---|---|---|---|
| `index.js` | 291.37 kB | 293.95 kB | +2.58 kB (+0.89%) |
| `index.js` gzip | 87.34 kB | 88.09 kB | +0.75 kB |
| `index.css` | 39.67 kB | 41.33 kB | +1.66 kB (+4.18%) |
| `index.css` gzip | 6.43 kB | 6.66 kB | +0.23 kB |
| **Total gzip delta** | | | **+0.98 kB** |

No unbounded work was added: sorting is a source-side request parameter,
never a client-side sort of the loaded set; pagination accumulation is
unchanged; the per-row additions are a class name, two DOM attributes and
two handlers. The existing `ResultsTable.performance.test.tsx` bounds
still pass.

---

## 14. Security

No regression. Verified in the real browser after using the new entry
points (row click, View details, Show surrounding logs):

- Protected fields remain server-masked on screen (`***` present).
- `localStorage` and `sessionStorage` contain no event content, message
  text, or trace identifiers.
- The URL contains no query content or identifiers.
- No `dangerouslySetInnerHTML` added (the repo-wide
  `noDangerousHtml.test.ts` guard still passes).
- The context action reuses the existing server-redacted `/context`
  endpoint; no new endpoint, no new data in responses.

---

## 15. Tests

| Suite | Result |
|---|---|
| Backend `./mvnw test` | **PASS** — 610 tests, 0 failures (606 + 4 new) |
| Frontend `vitest` | **PASS** — 698 tests (662 + 36 new); see the flake note below |
| Typecheck (`tsc -b`) | **PASS** |
| Production build | **PASS** |
| Playwright — UX-R4 suite | **PASS** — 23/23 |
| Playwright — full suite (local) | 219 passed, 2 failed — **both pre-existing**, see below |
| **CI on this PR (#35)** | **PASS — all four green: Backend, Frontend, E2E (10m14s), Windows Desktop** |

**New tests**: `ResultsTable.rowInteraction.test.tsx` (13),
`useSearchState.sorting.test.ts` (9), `SortControl.test.tsx` (5),
`ActionsCell.test.tsx` (+5), `columnMapping.test.ts` (+4),
`FixtureLogSourceTest` (+4), `ux-r4-results-workstation.spec.ts` (23).

**Tests changed deliberately, not weakened** (CLAUDE.md §3): renaming the
menu item "Inspect event" → "View details" required updating 15
test/spec files. Every change was a label update; no assertion was
removed, relaxed, or skipped.

**One test-authoring bug caught by a test, worth recording.** The
timestamp round-trip test failed because `Intl.DateTimeFormat.format()`
emits a plain space before the day period on this Node/ICU build while
`formatToParts()` emits U+202F. Rather than loosen the assertion, both
paths now derive from `formatToParts`, so the rendered cell and the
canonical string are identical **by construction**.

**Known failures, none introduced by UX-R4:**

1. `App.liveComposeProjectSwitch.test.tsx` (UX-R3) — load-sensitive
   flake. Passes in isolation, and passed in a full-suite run earlier in
   this session; failed in a later one. Not caused by UX-R4 (it touches
   Live/Compose, which this slice does not modify).
2. `phase-m-ux-acceptance.spec.ts` and
   `phase-legacy-slice2-query-transparency.spec.ts` — both fail locally
   on the service multi-select checkbox. **Confirmed pre-existing**: the
   working tree was stashed and the test re-run against unmodified
   `f237ebd`, where it fails identically. Local-environment-specific —
   and now confirmed twice over: post-merge CI on `main` is green for the
   same commit, and this PR's own CI runs the full Playwright suite and
   passes it. Neither spec is failing because of UX-R4.

**Side effect recorded**: running the full Playwright suite rewrites the
committed evidence PNGs of *earlier* phases, because those specs capture
into `docs/verification/<phase>/`. All 114 such files were reverted so
this PR touches only `UX_R4_EVIDENCE/` (CLAUDE.md §5, preserve unrelated
changes). Future slices running the full suite should expect the same and
do likewise.

---

## 16. UX transformation evidence

| Surface | Classification | VISIBLE_USER_CHANGE |
|---|---|---|
| Row interaction (click, keyboard, hover, focus) | **RESTORED** (OLD had row click) + **NEW_BETTER** (roving tabindex, `aria-selected`) | YES |
| Sorting | **RESTORED** — OLD had Newest/Oldest; NEW had none | YES |
| Row Actions (View details, Show surrounding logs) | **RESTORED** + **NEW_BETTER** (grouped ahead of copy utilities) | YES |
| Table information hierarchy (message floor, time weighting) | **NEW_BETTER** | YES |
| Severity scannability | **NEW_BETTER** | YES |
| Context return state restoration | **NEW_BETTER** | YES |
| Capability truthfulness (`contextView`) | **NEW_BETTER** (defect fix) | YES (Source health popover) |
| Column visibility / order / density | **SAME** — preserved and re-verified, incl. selection surviving each | NO (by design) |

```
STILL_OLD_THINKING_COUNT=0
REGRESSION_COUNT=0
```

No touched surface is classified `STILL_OLD_THINKING`. Two regressions
were introduced *during* the work (the 390px page overflow, the
`.contextRootRow` cascade loss); both were caught by measurement, fixed,
and are covered by tests — neither ships.

BEFORE/AFTER images: `docs/verification/UX_R4_EVIDENCE/` (38 files,
covering §28 A–R).

Two §28 rows have no true BEFORE by definition and are labelled honestly
rather than faked: **H (Oldest first)** — no sort control existed at all
(`BEFORE-GH-sort-control-absent.png` asserts its absence); and **I
(context from row Actions)** — the action did not exist on the row, so the
BEFORE captures the inspector-only path it replaced.

---

## 17. Remaining UX-R5 / UX-R6 / REL-1

Not started, and deliberately untouched by this slice:

- **UX-R5** — inspector-depth refinements, incl. UX-12 (Previous/Next
  position indicator, e.g. "1/100"). UX-R4 changed only what was needed
  to harmonise row selection with inspector opening; no inspector content
  was redesigned.
- **UX-R6** — UX-13 ("Show surrounding logs" reachable from *every*
  inspector tab). UX-R4 makes it reachable from every **row**, which is
  the higher-traffic path; the inspector-tab work remains UX-R6's.
- **REL-1** — cross-platform desktop distribution. `TRACKED_NOT_STARTED`.
- **Loki `contextView`** and **real-Loki sort verification** — both
  `BLOCKED` on a reachable environment (UX-25).

---

## 18. Cleanup

The two Docker containers created for §7.3 (`uxr4-sort-a`,
`uxr4-sort-b`) were removed after verification. They were created by the
developer as test fixtures; Log Explorer's own Docker access remains
strictly read-only (CLAUDE.md §2 rule 8) — nothing in this PR adds any
mutating Docker call.
