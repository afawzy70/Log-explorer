# UX-R5 — Event Inspector & Context Professional UX — LERUX-1 / LERDESIGN-1

Mission: `UX_R5_INSPECTOR_CONTEXT_PROFESSIONAL_UX`.
Base: `c2046a62b97a79083c95ac9f04b1b91206ebd84e` (post-PR #35 `main`).
Branch: `ux/r5-inspector-context-professional-ux`.

This is the first slice run under the **two-skill working method** the
owner approved as DEC-C: `LERUX-1` diagnoses and accepts, `LERDESIGN-1`
proposes. Every BEFORE claim below is a measurement of the rendered
application, not a source read — and three of them corrected assumptions
that source and prior comments would have led to.

---

## 1. Skill activation evidence

```
UX_REVIEW_SKILL_REGISTERED=YES     REACT_DESIGN_SKILL_REGISTERED=YES
UX_REVIEW_SKILL_DISCOVERABLE=YES   REACT_DESIGN_SKILL_DISCOVERABLE=YES
UX_REVIEW_SKILL_LOADED=YES         REACT_DESIGN_SKILL_LOADED=YES
UX_REVIEW_PROTOCOL=LERUX-1         REACT_DESIGN_PROTOCOL=LERDESIGN-1
MANUAL_FALLBACK_USED=NO
```

Both skills were invoked and their bodies loaded before any UX-R5
implementation. `.claude/skills/react-professional-uiux-designer/SKILL.md`
(16,955 bytes) was created this session with valid frontmatter whose
`name` matches its directory.

**Discovery note, recorded because it contradicts a previously-held
belief.** UX-R3 concluded that project-local skills are indexed only at
session startup. That is not absolute: the new skill was rejected
("Unknown skill") immediately after creation, then picked up **live**
moments later in the same process, with no restart. The mission's
restart contingency was therefore not needed and not used.

---

## 2. PR #35 merge gate

| Gate | Result |
|---|---|
| HEAD equals accepted `c4b22dd900d6730cecf7162ac9494c1595ce170c` | PASS — matched exactly |
| PR OPEN / MERGEABLE | PASS (`MERGEABLE` / `CLEAN`) |
| Backend / Frontend / E2E / Windows Desktop | PASS — all four green |
| Squash-merge | PASS — merge commit `c2046a62b97a79083c95ac9f04b1b91206ebd84e` |
| Local `main` synced | PASS — fast-forward, clean |
| Post-main CI | PASS |

---

## 3. BEFORE diagnosis (LERUX-1, measured)

Evidence: `docs/verification/UX_R5_EVIDENCE/BEFORE-*.png`; the capture
spec is preserved at `UX_R5_EVIDENCE/before-evidence.spec.ts.txt` (it
asserts the *absence* of things UX-R5 adds, so it is retired rather than
left executable against the post-change app — the same convention UX-R4
established).

### 3.1 The inspector was a ~4,000px scroll, not a panel

Measured at 1440×900 on a fully-populated ERROR event:

| Section | Offset from panel top | Height | Entries |
|---|---|---|---|
| Overview | +123px | 642px | 10 |
| Actor & client | +765px | 496px | 7 |
| Request flow | +1,261px | 430px | 5 |
| Business / error | +1,691px | 406px | 3 |
| **All fields** | +2,097px | **1,895px** | 28 |

Total ≈ **3,992px**. "All fields" alone was **47%** of the panel — more
than the four structured sections put together — and it is an *escape
hatch*, not an investigation surface.

### 3.2 The panel does not scroll independently — the page does

This corrected an assumption I had made from reading the CSS. `.body` has
`overflow-y: auto` and the panel is a flex column, which *looks* like an
independently-scrolling panel with a pinned header. It is not: the panel
has no bounded height, so it grows to fit its content and the **document**
scrolls instead.

Measured: panel height **9,224px**; scrolling to "Business / error" moved
`window.scrollY` to 1,411 and put the panel's top at **-1,205px** — the
entire header, with every navigation control, off screen.

This mattered directly: it meant simply moving the context action into
the header would have *moved* the §14 problem rather than fixed it.

### 3.3 Other measured findings

- **No position indicator.** Asserted, not assumed: no `N of M` text
  anywhere in the inspector.
- **The context action sat 1,261px down**, inside "Request flow" — an
  event-level action buried in one of five sections.
- **Overview spent 3 of its 10 rows on one fact**: "Local time", "Zone"
  and "UTC" as three peer rows of equal weight.
- **Overview duplicated the header** (message, service, level) while
  giving "Schema version" the same visual weight as the message.
- **Request flow's "Copy" moved between rows**: rendered first inside a
  trailing-aligned group, so the Span ID row — the one identifier with no
  "Find this …" action — placed its Copy ~330px right of every other
  row's.

---

## 4. Design decisions (LERDESIGN-1 proposal, verified by LERUX-1)

The framing question was §3's: turn "a place that displays fields" into an
investigation surface. Four decisions followed from the measurements
above — each names the friction it removes.

| Decision | Friction it removes |
|---|---|
| **Sticky header** carrying identity, position, navigation and the context action | The header (and every control in it) scrolled off screen entirely — measured at -1,205px |
| **One inspector-level "Show surrounding logs"**, in that header; the section-local copy removed, not duplicated | The action was 1,261px down inside one section (§14's explicit "do NOT duplicate a separate context button inside every tab") |
| **"Event N of M loaded"**, tertiary weight, trailing edge of the identity row | There was no way to know where you were in the set |
| **Overview re-weighted**: three time rows → one row with zone + UTC on a secondary line; thread/schema version demoted to All fields | Overview restated one instant three times and ranked minutiae equal to the message |
| **All fields collapsed** into a `<details>` with a field-count hint | 47% of the panel spent on the escape hatch |
| **Copy anchored last** in Request flow rows | The same control sat in a different place on each line |

Two things the design deliberately did **not** change: the five logical
areas (they map cleanly to the four questions, and the evidence showed no
problem with the grouping itself), and the ±30s window semantics.

**Label harmonisation.** The inspector action is now "Show surrounding
logs" — the exact wording UX-R4 put on the row Actions menu. One product
must not name one action two ways depending on where it is invoked. The
±30s window is not hidden: it is stated with both bounds in the confirm
popover, which now also says *"Nearby chronological evidence around this
event - not a cause"* (§15).

---

## 5. Position-indicator semantics

Renders **"Event 4 of 200 loaded"**. The word *loaded* is load-bearing:
the backend reports `total` as unknown for several sources and "more
available" is the normal case, so a bare "4 of 200" would assert a global
position the app cannot know (§5: *"Do not imply global position across
events that have not been loaded"*).

The denominator is `searchResult.events.length` — the same array the
results table renders and Previous/Next walk, so the indicator cannot
disagree with either, and it grows when "Load more" appends (asserted in
a real browser). It is a polite live region, not assertive: it changes on
every navigation step, and an assertive region would interrupt a screen
reader user each time.

---

## 6. Navigation model

Previous/Next operate on the current loaded result set — there is no
separate inspector dataset. They stay synchronised with the results table
selection (`aria-selected` asserted on the expected row after each step),
are correctly disabled at both bounds, and the `[` / `]` keyboard
shortcuts drive the same path. Navigation and the context action are
grouped on the leading edge; **Close is separated to the trailing edge**,
because before UX-R5 "leave this panel" was an equal-weight sibling of
"move through the investigation".

---

## 7. Context: transition, root, chronology, summary, gaps

Unchanged where the evidence showed no problem — the context view already
did these well, and saying so is a valid outcome:

- **Root identification**: one row with `aria-current="location"` plus a
  dashed outline. UX-R4 found a CSS-specificity regression could erase
  this; the AFTER suite now asserts the computed `outlineStyle` is still
  `dashed`, so that regression stays fixed by test, not by memory.
- **Chronology**: ascending (earlier → root → later), asserted from the
  rendered timestamps.
- **Summary/gaps**: retained. A gap still means "no observed events in
  this interval", never "the system was idle".
- **Causality**: asserted absent — the rendered page matches
  `/does not indicate causality|not a cause/` and never `/root cause/`.

---

## 8. Return-state decision (§25)

**§25 asked for A or B. The evidence says neither, as a global rule.**

Since UX-R4 there are two ways into a context view:

- from the **inspector** (its header action), where the investigator was
  reading an event when they left;
- from a **results row's Actions menu**, where they never opened the
  inspector at all.

Rule A ("always reopen the inspector") would conjure a panel the
row-menu user never opened. Rule B ("always leave it closed") would close
one the inspector user was mid-read of. So the committed behaviour is:

> **Return restores the inspector state the investigator actually left.**

That is continuity in both paths. It already worked by construction — the
state snapshot is taken *before* `closeInspector()`, so it captures the
selection as it was at the moment of the detour — but it was untested and
undocumented, i.e. correct by accident. It is now pinned by four tests
(both entry paths, at hook level and in a real browser) and recorded as
**UX-30**.

---

## 9. Four Questions assessment

Scenario run end to end: Search → click an ERROR row → Overview → Actor &
client → Request flow → Business / error → Show surrounding logs from the
header → identify the root event → observe the surrounding sequence →
return.

| Question | Change |
|---|---|
| **WHO DID WHAT?** | **Improved.** "Actor & client" is unchanged in content but is now reached at +569px instead of +765px, and an event with no actor data says so in one line instead of presenting blanks. Values remain server-masked with no reveal affordance |
| **WHY IS IT HAPPENING?** | **Materially improved.** The evidence action moved from "1,261px down inside one section" to "always visible in the header", and returning from it no longer loses your place. The exception block keeps its multiline structure and monospace. Still never presented as causation |
| **WHAT IS HAPPENING?** | **Preserved and slightly improved.** UX-R4's gains are intact; the message is no longer ranked equal to "Schema version" |
| **WHERE IS IT HAPPENING?** | **Preserved.** Time/source/service/container/logger all remain; the time is stated once instead of three times, with zone and UTC still present |

---

## 10. Accessibility

- Inspector keeps its accessible name (`dialog`, "Event details").
- Position indicator is a polite live region.
- Previous/Next/context action are all keyboard operable; `[` / `]`
  shortcuts still work.
- **All fields uses native `<details>`/`<summary>`** — keyboard
  expandable (asserted with Enter) and natively exposed as expandable, so
  no hand-rolled `aria-expanded`. Its `<h2>` is kept **inside** the
  `<summary>`, so collapsing a section does not drop it from the heading
  outline.
- Escape closes the inspector and focus returns to the originating row
  (asserted in a real browser).
- No colour-only meaning; no page-level horizontal overflow at any tested
  width; header actions remain reachable at 200% zoom.

---

## 11. Responsive & zoom

Verified in a real browser at **1920 / 1440 / 1280 / 1024 / 768 / 390**
and at **200% zoom**. At 1440 the inspector is asserted to sit *beside*
the results rather than over them (measured against the results scroll
wrapper, not the table, since the table is deliberately wider than its
viewport and scrolls inside its own wrapper). At every width the context
action stays visible and the page never scrolls horizontally.

---

## 12. Performance

| Metric | Before (main `c2046a6`) | After | Delta |
|---|---|---|---|
| `index.js` | 293.95 kB | 294.91 kB | +0.96 kB (+0.33%) |
| `index.js` gzip | 88.09 kB | 88.37 kB | +0.28 kB |
| `index.css` | 41.33 kB | 42.43 kB | +1.10 kB (+2.66%) |
| `index.css` gzip | 6.66 kB | 6.84 kB | +0.18 kB |
| **Total gzip delta** | | | **+0.46 kB** |

No new API calls, no duplicate fetches, no re-parsing: the position
indicator is derived from an array length already in state, and
collapsing "All fields" removes ~1,900px of DOM from the default render
rather than adding to it. Context requests remain bounded and
supersession-protected.

---

## 13. Security

No regression. Verified in the rendered app after exercising every new
entry point:

- Protected values remain server-masked (`***`), with the
  "Protected / masked - never revealed" badge intact.
- **No reveal/unmask/show-raw control exists anywhere in the inspector** —
  asserted by locator count, not by inspection.
- Expanding "All fields" exposes no raw protected value; the raw-JSON
  disclosure serialises an event that only ever carries masked fields.
- `localStorage`, `sessionStorage` and the URL contain no event content,
  message text or identifiers.
- Redaction markers and stack-trace structure still verified by the
  Slice 7 suite.

---

## 14. Tests

| Suite | Result |
|---|---|
| Backend `./mvnw test` | **PASS** — 610, 0 failures (unchanged; UX-R5 is frontend-only) |
| Frontend `vitest` | **PASS** — 721 (698 + 23 new) |
| Typecheck / production build | **PASS** |
| Playwright — UX-R5 suite | **PASS** — 26/26 |
| Playwright — full suite | 251 passed, 1 pre-existing failure (below) |

**New tests**: `InspectorPosition.test.tsx` (13),
`useSearchState.contextReturn.test.ts` (7), `sections.test.ts` (+3),
`allFields.test.ts` (+1), `ux-r5-inspector-context.spec.ts` (26).

**Tests changed deliberately, not weakened** (CLAUDE.md §3):

1. The "Show ±30 seconds" → "Show surrounding logs" rename touched 8
   spec/test files — label updates only.
2. `RequestFlowSection.test.tsx` lost the `onShowContext` prop (the action
   moved to the header).
3. `sections.test.ts` pinned Overview's exact field list; it now pins the
   new list, **plus two new tests proving nothing was lost** (the Time row
   still carries zone and UTC; no invented secondary line when there is no
   timestamp) and one in `allFields.test.ts` proving the demoted fields
   are still reachable.
4. `phase-legacy-slice7-redaction.spec.ts` now expands "All fields" before
   reaching the nested "Raw JSON" disclosure — one extra click, no
   capability lost, which is exactly the property §13 requires.

**Known failure, not introduced by UX-R5**: `phase-m-ux-acceptance.spec.ts`
Task 1 fails locally on the service multi-select. Proven pre-existing
during UX-R4 by stashing the working tree and re-running against
unmodified `f237ebd`, where it fails identically; it passes in CI.

**Side effect recorded again**: running the full Playwright suite rewrites
earlier phases' committed evidence PNGs. All 127 were reverted so this PR
touches only `UX_R5_EVIDENCE/`.

---

## 14b. Real-source verification (§37)

**Fixture — PASS.** Deterministic corpus, driven through the full
rendered UI by the 26-test UX-R5 Playwright suite: inspector, position
indicator, all sections, context entry from both paths, root marker,
ascending chronology, gaps, and return.

**Real Docker — PASS.** A real container (`uxr5-ctx`, Compose project
`uxr5ctx`) emitting 20 uniquely timestamped JSON events, queried through
the real `local-docker` source:

| Check | Result |
|---|---|
| Search returns the events | 20 events |
| Context around a mid-set root event | 20 events |
| Root event present in its own context result | yes |
| Every returned event within ±30s of the root | yes — the bounded window is honoured source-side, not trimmed in the client |
| Protected fields | all `null`/masked; no raw identifiers in the payload |

The container was created purely as a developer test fixture and removed
afterwards; Log Explorer's own Docker access remains strictly read-only
(CLAUDE.md §2 rule 8), and nothing in this PR adds a mutating Docker call.

**Real Loki — BLOCKED.** No reachable Loki/OpenShift environment exists in
this session: no endpoint, no credentials. Loki's context behaviour is
covered only by adapter/contract tests, which this report does **not**
report as a PASS.

```
REAL_LOKI_CONTEXT=BLOCKED
```

---

## 15. Classification

| Surface | Classification | Visible user change |
|---|---|---|
| Inspector header (identity, position, navigation, context action) | **NEW_BETTER** | YES |
| Position indicator | **RESTORED** (OLD had one) + **NEW_BETTER** (truthful "loaded" wording) | YES |
| Context action placement | **NEW_BETTER** | YES |
| Overview hierarchy | **NEW_BETTER** | YES |
| All fields (escape hatch) | **NEW_BETTER** | YES |
| Request flow affordance consistency | **NEW_BETTER** | YES |
| Context return state | **NEW_BETTER** (now deterministic and tested in both paths) | YES (row-action path unchanged; inspector path preserved) |
| Actor & client / Business & error content | **SAME** — no measured friction; deliberately left alone | NO |
| Context root / chronology / summary / gaps | **SAME** — already correct; now regression-tested | NO |

```
STILL_OLD_THINKING_COUNT=0
REGRESSION_COUNT=0
```

Two would-be regressions were caught by measurement during the work and
fixed before shipping: the header scrolling off screen (which would have
made the §14 fix cosmetic), and the collapsed section dropping its
heading from the document outline.

---

## 16. Remaining UX-R6

- **UX-R6 final polish** — not started.
- **UX-13** is now `VERIFIED` in UX-R5 rather than pending in UX-R6 (the
  mission retargeted it), so UX-R6's inspector-side scope is
  correspondingly smaller.
- **REL-1** — `TRACKED_NOT_STARTED`.
- **Real Loki context verification** — `BLOCKED` on a reachable
  environment, as is Loki's own `contextView` capability (UX-25).
- **Candidate for UX-R6, not done here**: the inspector panel still is not
  an independently-scrolling column (the page scrolls). The sticky header
  makes this a non-issue for reachability, but a bounded panel with its
  own scroll would be the more structural fix, and it touches layout
  shared with the results area — out of UX-R5's stated scope.
