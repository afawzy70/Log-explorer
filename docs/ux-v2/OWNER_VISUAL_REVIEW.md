# Owner Visual Review — UX v2 Directions

This is the visual companion to `docs/ux-v2/OWNER_DESIGN_DECISION_PACKAGE.md`
(the full written case for each direction). Use this document with the
image files below — it does not repeat their content, it points at it.

**No direction is chosen yet.** This document does not pick a winner.

## Image files (all under `docs/ux-v2/review/`)

| File | What it shows |
|---|---|
| `01-search-results-comparison.png` | A \| B \| C, Search + Results, same data, 1440×900 |
| `02-inspector-comparison.png` | A \| B \| C, Selected Event + Inspector, same event, 1440×900 |
| `03-context-comparison.png` | A \| B \| C, Context / Surrounding Logs, same root event, 1440×900 |
| `04-more-filters-comparison.png` | A \| B \| C, More Filters open, same fields, 1440×900 |
| `05-settings-comparison.png` | A \| B \| C, Settings, same fields/connection state, 1440×900 |
| `06-live-comparison.png` | A \| B \| C, Live Mode, same partial-connectivity state, 1440×900 |
| `MASTER_DIRECTION_COMPARISON.png` | One-page overview of all 18 (6 states × 3 directions) — for orientation only, not a substitute for the full-size files above |
| `OLD_VS_DIRECTIONS_KEY_STRENGTHS.png` | 5 OLD UI reference screenshots next to the matching A/B/C example, for verifying OLD's strengths carried forward |
| `CURRENT_VS_DIRECTIONS.png` | 5 CURRENT frozen-baseline screenshots next to the matching A/B/C example, for verifying each direction is a real improvement, not just a reskin |

All A/B/C screenshots use the identical shared dataset (OpenShift ·
`payments-prod`, the same 9-row result set, the same selected ERROR
event `Payment authorization failed`, the same masked user `us***42`)
so no direction is shown with easier or sparser content than another.
Secondary validation at 1366×768 exists for all 18 base screenshots at
`docs/ux-v2/prototypes/direction-{a,b,c}/screenshots/*-1366x768.png`
(not re-composited into contact sheets, to keep this package to a
reviewable size — open them directly if narrow-viewport behavior is in
question, particularly for Direction A's column elision and Direction
C's Inspector width, both flagged below).

---

## Per-state notes

Strongest visual advantage and biggest risk/weakness only — no winner
named.

### SEARCH / RESULTS
**A:** Highest row count and least wasted space of the three — the full
toolbar, filter chips, and table fit with zero scrolling. *Risk:* the
densest type scale of the three, closest to the size/contrast floor.

**B:** Calmest, most evenly-weighted toolbar and chip row; column
layout matches the current baseline's own column set almost exactly.
*Risk:* visibly more empty space below the 9 rows than A or C at this
resolution — the direction most likely to look "sparse" if real data
doesn't fill the screen.

**C:** Quietest default toolbar (fewest persistent controls), with a
`Filters (2)` and `Load more (147 remaining)` treatment that makes total
result count obvious. *Risk:* the toolbar's reduced control count means
some capability (severity buttons, source label) is smaller/less
prominent than in A or B.

### INSPECTOR
**A:** Split-pane Inspector never covers the result list — table stays
visible at all times. *Risk:* the pane takes real width from the table;
at 1366×768 the Correlation/Trace and User/Customer columns start
eliding with a row selected (see the 1366×768 screenshots).

**B:** The accent bar visually continues from the selected table row
into the Inspector header — the clearest "what am I looking at and why"
of the three. *Risk:* that visual connection is untested against a
long result list where the selected row scrolls out of view.

**C:** Widest, most spacious Inspector (580px) with all five section
tabs fully legible, no clipping. *Risk:* that width is the most
expensive of the three in table space — visibly the narrowest results
table of the three in this comparison.

### CONTEXT
**A:** Most compact — context fits directly in the existing table
layout with an inline "ORIGINAL EVENT" badge. *Risk:* the root event is
the least visually dominant of the three treatments — a badge, not a
distinct card.

**B:** Vertical timeline with a clearly boxed, tinted "Root event you
selected" card — root event is unmistakable. *Risk:* visually close to
Direction C's own Context treatment — the one place the three
directions converge on a similar pattern.

**C:** The only direction with explicit on-screen copy distinguishing
Context from Correlation ("same execution scope only — to follow this
request across other services, use Correlation/Trace/Journey instead").
*Risk:* same convergence note as B — the timeline-with-boxed-root
pattern is nearly identical between B and C.

### MORE FILTERS
**A:** Opens as a right-hand drawer that never covers or dims the
primary toolbar — Search/Time/Severity/Live stay fully usable while it's
open. *Risk:* the drawer is narrower, so field labels wrap more
tightly than B or C's wider layouts.

**B:** Expands inline below the toolbar in four labeled columns
(Who/Customer, Request Flow, What Happened, Client Context) — the
clearest at-a-glance grouping of the three. *Risk:* pushes the results
table down/out of view while open, unlike A and C.

**C:** Widest per-field layout with visible EXACT/CONTAINS match-type
tags on every field, plus a visible "Advanced query" / Raw LogQL note.
*Risk:* dims the results table behind it (a modal-like overlay), similar
tradeoff to B.

### SETTINGS
**A:** Three settings areas (Privacy & masking / Docker / OpenShift)
visible simultaneously as side-by-side cards — nothing to switch
between. *Risk:* on a narrower window this three-column layout would
need to stack, untested here.

**B:** The only direction using a centered modal dialog rather than a
full page — a familiar, common pattern. *Risk:* the modal dims and
covers the entire results view behind it, the most disruptive-to-context
of the three approaches.

**C:** Two-column layout with an explicit orange warning banner when a
field is currently unmasked ("Device IP is currently unmasked...") —
the most proactive security-visibility treatment of the three. *Risk:*
only shows one source-specific panel (OpenShift) at a time in this
capture; Docker's equivalent panel isn't visible in the same view.

### LIVE
**A:** Densest live stream — most rows visible per screen, monospace
trace IDs aligned in a column. *Risk:* the error row's red highlight is
the only strong visual break in an otherwise uniform, dense stream.

**B:** Clear status line ("LIVE (3/4 active)"), an explicit warning
banner naming the unreachable replica by name. *Risk:* fewer visible
rows than A in the same vertical space.

**C:** Filter controls (All/Errors only/Trace-Debug) remain visible
directly in the Live view itself, not requiring a return to Search.
*Risk:* the partial-connectivity/rollout note is smaller and less
visually separated from the stream than B's banner treatment.

---

## Owner scorecard

Score each direction 1–5 per criterion (5 = strongest). Leave blank
until reviewed — nothing here is pre-filled.

| Criterion | Direction A | Direction B | Direction C |
|---|:---:|:---:|:---:|
| Professional feel | | | |
| Investigation speed | | | |
| Information density | | | |
| Clarity | | | |
| Table usability | | | |
| Inspector usability | | | |
| Context clarity | | | |
| Settings clarity | | | |
| Live clarity | | | |
| OLD-strength preservation | | | |
| Improvement over CURRENT | | | |
| **Total** | | | |

The mission coordinator's own independent scoring (14 criteria, a
superset of this scorecard) is in
`docs/ux-v2/DESIGN_DIRECTION_COMPARISON.md` for reference — this
scorecard is for the owner's own independent judgment, not to be
copied from that document.

## How to choose

Open the six `NN-*-comparison.png` files at full size (each is
4440×1094 — zoom in, this is not meant to be read at thumbnail size),
use `MASTER_DIRECTION_COMPARISON.png` only for orientation, and use the
two benchmark sheets to sanity-check "does this actually preserve OLD's
strengths and improve on CURRENT, or is it just different." Then choose
Direction A, B, or C — or describe a hybrid (e.g., "B's Settings
approach with A's density") for the next mission to scope.
