# Design Direction Comparison — UX v2

Scoring method: each criterion scored 1–5 per direction (5 = strongest)
by the mission coordinator, independently reviewing a representative
set of screenshots from all three directions (Search results, Inspector,
Context, Settings, Live — at 1440×900) plus each direction's own
candid README self-assessment and the Impeccable design-detector's
automated findings (fixed vs. disclosed-and-accepted). Scores are not
massaged to force a winner — several criteria are close or tied, and
each direction has at least one criterion where it is the clear leader
and at least one where it is the clear laggard, which is the expected,
honest shape of three genuinely different directions rather than one
direction dominating on paper.

| Criterion | A — Dense Observability Workstation | B — Modern Developer Console | C — Investigation-First Minimal |
|---|:---:|:---:|:---:|
| Investigation speed | **5** | 4 | 4 |
| Information density | **5** | 3 | 4 |
| Clarity (recognition over recall) | 4 | **5** | **5** |
| Discoverability (core loop) | 4 | 4 | 4 |
| Professional feel | **5** | 4 | 4 |
| Table usability | **5** | 4 | 4 |
| Inspector usability | 4 | 4 | 4 |
| Context usability | 4 | **5** | **5** |
| Advanced filtering usability | 4 | 4 | 4 |
| Keyboard workflow* | 3 | 3 | 3 |
| Accessibility (post-fix) | 4 | 4 | **5** |
| Responsive behavior (1366×768) | 3 | 4 | 4 |
| Implementation complexity (5 = lowest effort) | 3 | **5** | 3 |
| Functional-preservation risk (5 = lowest risk) | 4 | **5** | 4 |
| **Total (of 70)** | **57** | **58** | **57** |

\* All three are static HTML mockups with no real interactivity — none
of them can be verified for actual keyboard/focus behavior from a
screenshot alone. This score reflects structural layout compatibility
with keyboard navigation (logical grouping, no obviously keyboard-hostile
pattern), not a real tab-order/focus-ring test, and is intentionally the
same across all three rather than a fabricated distinction. **Real
keyboard/focus verification is required in whichever direction is
chosen, during implementation** — this is unfinished evidence, not a
tie by design.

**The totals are close by design, not by accident** — the point of
building three genuinely distinct, fully-realized directions was to
make the real tradeoffs visible, not to produce one obvious winner on a
spreadsheet. Read the per-criterion detail below; the totals column is
the least useful row in this table.

---

## Where each direction wins outright

**A — Dense Observability Workstation** wins decisively on raw
investigation speed, information density, professional/developer-tool
feel, and table usability — it shows the most data with the least
scrolling and the tightest fidelity to a terminal/Seq-like tool. This is
the most literal execution of CLAUDE.md §7's existing "information-dense,
fast" design direction and the closest philosophical descendant of the
OLD UI's own density discipline.

**B — Modern Developer Console** wins decisively on clarity (the
Inspector's accent-bar-continuity-from-row and Settings' loud
GLOBAL/SOURCE-SPECIFIC pills are the most legible "what am I looking at
and why" treatments of the three), Context usability (tied with C), and
is unambiguously the lowest-risk, lowest-complexity direction to
actually build — it is the closest to a refinement of the current
baseline's real DOM structure rather than a new interaction paradigm.

**C — Investigation-First Minimal** wins decisively on accessibility
(the only direction with a fully clean final detector pass: 0
anti-patterns, 0 low-contrast, 0 tiny-text, 0 cramped-padding, and a
real overflow bug found and fixed rather than just avoided) and ties B
on Context usability and clarity — its Context screen is the only one
of the three with explicit UI copy distinguishing itself from
Correlation ("This view shows the same execution scope only — to follow
this request across other services, use Correlation/Trace/Journey
instead"), which is the single strongest satisfaction of Design
Principle 8 anywhere across all three directions.

## Where each direction is weakest

**A** sits closest to the accessibility floor rather than comfortably
above it (its own README's words), and its split-pane Inspector already
visibly elides the Correlation/Trace and User/Customer columns at
1366×768 with a row selected — a real, disclosed, unresolved risk to
table usability at the "usable down to 1024/768" end of the responsive
range the Functional Preservation Contract requires.

**B** is, by its own author's own admission, the direction most at risk
of reading as "just a nicer current baseline" rather than a genuine
rethink — real, but the most benign of the three disclosed weaknesses,
since it's a question of ambition rather than a structural technical or
accessibility problem. Its Inspector-attached-to-row concept also has a
genuine unanswered interaction-design question (what happens when the
selected row scrolls out of view) that a real implementation must
resolve.

**C** required a wider Inspector panel (580px, not the 420px a
"minimal" instinct would have first reached for) to avoid clipping its
own five section tabs — a real, measured cost to available table width
at narrower desktop widths that the direction's own README states
plainly still needs a responsive answer before implementation. Its
default search screen and Settings screen also show a real, disclosed
empty-canvas stretch at 1440×900 that the direction's own honest
self-assessment names as the one place a reviewer could fairly push
back on "did this avoid the sparse-consumer-app trap."

## A note on convergence

Directions B and C independently arrived at a similar solution for
Context (a vertical timeline with the root event boxed/highlighted, as
opposed to Direction A's inline-table-with-badge approach) — this is
read as evidence that a boxed, timeline-structured root-event treatment
is close to the right answer for this specific screen regardless of a
direction's overall visual language, not as a sign the three directions
are insufficiently distinct. The three directions remain materially
different across every other screen (toolbar composition, Inspector
attachment model, Settings layout, default chrome density).
