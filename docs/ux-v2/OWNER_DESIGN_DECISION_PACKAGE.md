# Owner Design Decision Package — UX v2

This is the one document to read to choose a direction. It does not
replace `docs/ux-v2/DESIGN_DIRECTION_COMPARISON.md` (the full scored
detail) or the three `docs/ux-v2/prototypes/direction-{a,b,c}/README.md`
files (each direction's own candid self-assessment) — it summarizes them
for a decision, and links back to the detail behind every claim.

**Nothing has been implemented.** These are static, self-contained HTML
prototypes only — six representative screens per direction, at two
viewport widths, built against a shared realistic dataset so the three
are directly comparable. No production code changed.
(`PRODUCTION_BEHAVIOR_CHANGED=NO` — verified separately, see the
mission's final response.)

---

## Direction A — Dense Observability Workstation

*Screenshots: `docs/ux-v2/prototypes/direction-a/screenshots/`*

**Concept.** The most direct descendant of the OLD UI's own density
discipline: a compact, high-density, keyboard-first surface that reads
like a professional developer tool (Seq, k9s) rather than an admin
dashboard. The Inspector is a permanent split pane welded to the results
table — never a modal — and the results view shows the full toolbar,
active-filter strip, and table with zero scrolling at 1440×900.

**Strengths:** Highest information density of the three. The
Inspector-as-split-pane keeps the result list visible at all times
during inspection. Settings separates Privacy & Masking from
Docker/OpenShift as three visually distinct cards. Context is
unmistakably distinct from Correlation in both layout and language.

**Weaknesses:** Sits closest to the accessibility floor (12px/11px body
text — passes WCAG as built, but with the least headroom of the three).
The split-pane Inspector already visibly elides table columns at
1366×768 with a row selected — a real, unresolved risk at narrower
desktop widths. Leans hardest into "developer tool" identity, carrying
the most risk of feeling unapproachable to a support engineer less
comfortable with dense, terminal-like interfaces than a backend
developer.

**Inherited from OLD:** Row density, a toolbar that stays compact rather
than expanding, the result table as the permanent center of gravity.

**Improves over OLD:** Real fixed-column table geometry (no layout
shift), masked-by-default privacy surfaced directly in Settings, Context
explicitly discloses detected gaps.

**Improves over CURRENT baseline:** Sharper density — less padding, more
visible rows per screen, Settings as three side-by-side cards instead of
per-source dialogs.

**Implementation risk: Medium.** No new interaction paradigm, but a real
type/spacing system rewrite and re-validation of table geometry
invariants (CLAUDE.md §4's 2px tolerance) against the denser row height.

---

## Direction B — Modern Developer Console

*Screenshots: `docs/ux-v2/prototypes/direction-b/screenshots/`*

**Concept.** A calmer, more polished evolution of the current baseline's
shell — the same investigation loop, composed with more deliberate
typographic hierarchy and one restrained accent color. The Inspector
visually *attaches* to the selected row (an accent bar continuing from
the row into the panel header) rather than reading as a detached dialog.
Context breaks into a vertical timeline with the root event structurally
distinct (thicker border, tinted background, an explicit "Root event you
selected" tag).

**Strengths:** Genuinely calmer without sacrificing row count — matches
the current baseline's own column set at a comparable row height. The
Inspector-attached-to-row treatment makes "what am I looking at and why"
immediately legible. Context's timeline is unambiguously distinct from
everything else in the app. Settings' global/source-specific split is
visually loud on purpose.

**Weaknesses:** By its own author's admission, the direction most at
risk of reading as "just a nicer version of the current baseline" rather
than a genuine rethink. The Inspector-attached-to-row concept has a
real, unanswered interaction-design question: what happens when the
selected row scrolls out of view. One sample string
(`notification-worker`) already wraps to two lines in the Service
column — a reminder real-data column-width testing is still needed.

**Inherited from OLD:** Multi-column, monospace-timestamp,
information-dense table as the primary surface; grouped, labeled filter
sections.

**Improves over OLD:** Explicit sort-direction affordance, truthful
masking indicators, an honest partial-Live-connectivity state.

**Improves over CURRENT baseline:** Inspector reads as an extension of
the selected row instead of a disconnected panel; Context's timeline is
far more visually distinct from Correlation than the current baseline's
shared card-list styling for both.

**Implementation risk: Low–medium** — the lowest of the three. Mostly a
refinement of the current baseline's actual DOM structure (table, side
panel, drawer, dialog) with a tighter token system. The one concrete
open question (Inspector-attachment-on-scroll) needs an answer, but is
not a structural blocker.

---

## Direction C — Investigation-First Minimal

*Screenshots: `docs/ux-v2/prototypes/direction-c/screenshots/`*

**Concept.** Strips persistent chrome to a single toolbar row (source,
search, time, severity, plus Filters/Columns/Settings as secondary
affordances), so the eye lands on the results table immediately, while
every other capability stays exactly one deliberate action away. The
table itself stays fully dense — minimalism here is about chrome, not
data. The Inspector opens as a wide side panel, never a modal.

**Strengths:** Fastest visual path from "open the app" to "I'm looking
at the data." The only direction with explicit UI copy distinguishing
Context from Correlation directly in the interface ("This view shows the
same execution scope only — to follow this request across other
services, use Correlation/Trace/Journey instead"). Settings' two-column
split makes the global/source-specific distinction impossible to miss.
More Filters is not under-designed despite being deferred — every
advanced field is present with its exact match semantics shown. The
cleanest final accessibility pass of the three (0 anti-patterns, 0
low-contrast, 0 tiny-text, 0 cramped-padding) — including a real overflow
bug (Inspector tabs clipping) found and fixed, not just avoided.

**Weaknesses:** The side-panel Inspector needed to be genuinely wide
(580px, measured empirically) to fit all five section tabs without
clipping — a real, disclosed cost to table width at narrower desktop
widths that still needs a responsive answer before implementation
(e.g., a compact icon-rail alternative, or shrinking optional columns
first). The default search screen and Settings screen show a real,
disclosed stretch of empty canvas at 1440×900 — named candidly in its
own README as the one place a reviewer could fairly push back.

**Inherited from OLD:** The single always-visible search bar plus
compact controls in one toolbar row; the advanced-filter drawer's
grouped-fields layout; dense, left-edge-accent selected-row treatment.

**Improves over OLD:** Makes the "you are here" investigative loop
explicit with visible Previous/Next navigation and an unmistakable
root-event treatment — neither was demonstrably present in the OLD
screenshots reviewed. Honest partial-connectivity and partial-window
disclosure with no equivalent pattern visible in OLD.

**Improves over CURRENT baseline:** Consolidates the toolbar and
filter-chip rows into one calmer composition; gives the Context root
event more deliberate visual weight than the current baseline's
screenshot shows; More Filters as a full-height side sheet scales better
to the full field set.

**Implementation risk: Medium.** The visual language is straightforward
in the existing React/CSS stack. The two real risks: genuine responsive
handling for the Inspector panel below ~1366px (found directly by this
exploration, will not disappear in a real build), and an ongoing design-
review discipline to keep "one click away" from silently becoming
"buried" as more settings/filters are added over time.

---

## Scored comparison (summary — full detail in DESIGN_DIRECTION_COMPARISON.md)

| | A | B | C |
|---|:---:|:---:|:---:|
| Total (of 70, 14 criteria × 5) | 57 | **58** | 57 |
| Wins outright on | Speed, density, professional feel, table usability | Clarity, implementation risk (lowest) | Accessibility (cleanest), Context copy clarity |
| Weakest on | Accessibility headroom, 1366px column elision | Ambition/differentiation from current baseline | Inspector width at narrow viewports, empty canvas |

The totals are close by design — three genuinely distinct, fully-built
directions were made to surface real tradeoffs, not to produce a
one-line spreadsheet winner. Read the per-criterion table and the
strengths/weaknesses above before deciding; the total alone should not
drive the choice.

---

## Recommendation

**Recommended: Direction B — Modern Developer Console.**

Reasoning, not a default: B has the lowest implementation risk and
complexity of the three, which matters concretely here — whichever
direction is chosen next must pass the exact same functional regression
this baseline already cleared (backend 1078/1078, frontend 871/871, E2E
307/307; see `docs/ux-v2/FUNCTIONAL_PRESERVATION_CONTRACT.md`'s
"Verification obligation"), and B's composition is the closest of the
three to the current baseline's actual DOM/interaction structure, which
directly lowers the risk of that regression failing for structural
reasons unrelated to the visual redesign itself. It also wins outright
on clarity and ties for the best Context treatment — the two areas where
"recognition over recall" and "context ≠ correlation" (Design Principles
4 and 8) are most safety-critical to get right, since getting them wrong
risks an investigator misreading evidence during a real incident.

B's own most serious weakness — the real risk of reading as "a nicer
current baseline" rather than a bold rethink — is a question of
ambition, answerable during implementation (the accent-attachment
concept, the timeline Context view, and the loud Settings split are
genuine, non-trivial departures from the current baseline, not a reskin)
rather than a structural technical or accessibility risk the way A's
narrow-width column elision or C's Inspector-width cost are.

**This recommendation is not a default approval.** If raw information
density and the closest fidelity to the OLD UI's own philosophy matters
more to the owner than implementation risk, **Direction A** is the
stronger choice — its density and professional-tool feel are the
strongest of the three, and its disclosed accessibility/responsive
risks, while real, are addressable engineering work, not a fundamental
flaw. If the owner's priority is the fastest possible time-to-first-data
for a support engineer who may be less comfortable with a dense tool,
and is willing to accept the responsive-width engineering work Direction
C's own README names directly, **Direction C** is the stronger choice —
it also currently has the cleanest independent accessibility result of
the three.

---

## Owner action required

**Choose Direction A, B, or C.**

No implementation begins until this choice is made. See the mission's
final structured response for `UI_UX_IMPLEMENTATION_STARTED=NO` and
`PHASE_M_STATUS=NOT_STARTED`.
