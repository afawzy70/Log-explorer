# UX v2 Design Principles

These are the durable design rules the three redesign directions
(`docs/ux-v2/prototypes/direction-a|b|c/`) and every later implementation
phase must follow. They are not aesthetic preferences — each one exists
because of a specific, evidenced failure mode this project has already
hit once (in the original UI, in the current baseline, or in this
mission's own design-authority split), and each is checkable against a
concrete screen.

They apply on top of, never in place of, `docs/ux-v2/FUNCTIONAL_PRESERVATION_CONTRACT.md`
(what must never break) and CLAUDE.md §7 (design direction, accessibility
target).

---

## 1. Investigation-first, not dashboard-first

The default view of the product is a search-and-results workspace, never
a summary/KPI/landing screen. There is no "home" screen an investigator
has to click through before they can search. Every screen's job is to
move an investigation forward, not to summarize system health for a
passive viewer.

**Check:** Can a returning user start typing a search within one click
of opening the app? If a screen doesn't directly serve search, scan,
select, inspect, correlate, or adjust, it doesn't belong in the primary
flow.

## 2. Dense but calm

Information density matches a professional data tool (a terminal, an
IDE, Seq, a spreadsheet) — not a marketing page's generous whitespace,
but also not visual noise. Density serves scanability; it is never an
excuse for clutter, and whitespace is never added merely to "look clean"
at the cost of showing less per screen.

**Check:** Compare rows-of-useful-data visible per 900px of vertical
space against the OLD UI (`docs/ux-reference/old-ui/`) and the CURRENT
baseline (`docs/user-guide/screenshots/01-search-results.png`) — a
redesign screen showing meaningfully fewer rows without a stated reason
has failed this principle.

## 3. Strong hierarchy without excessive whitespace

Primary actions (Search, selecting a row, the Inspector's Overview) are
visually dominant through weight, contrast, and position — never through
empty space alone. Secondary/tertiary information (metadata, counts,
footnotes) is visually quieter but never hidden.

**Check:** Squint-test: with the screen blurred, can you still tell what
the primary action is? If hierarchy only shows up in a fully-focused
read, it's too flat.

## 4. Recognition over recall

Controls show their own current state in place — active filters as
visible chips, the current sort direction on the column header, the
selected row visibly marked, the current source named in the shell —
so the investigator never has to remember a setting they configured two
minutes ago. Never require memorizing a keyboard shortcut, an implicit
mode, or a setting that isn't visible somewhere on screen.

**Check:** Screenshot the app mid-investigation (filters applied, a row
selected, a tab open) — every active piece of state must be legible
from that one screenshot alone.

## 5. Progressive disclosure

Advanced/rare capability (Raw LogQL, the full advanced-filter set, proxy
configuration, TLS certificate paths) is reachable in one or two
deliberate actions, never hidden behind more than that, and never
competing visually with the default workflow's primary controls. The
80%-of-the-time path (quick filters, Search, select, inspect) stays
uncluttered by the 20%-of-the-time path.

**Check:** Count the controls visible with zero drawers/dialogs open. If
an advanced/rare control is among them and dominates the toolbar's
visual weight, disclosure has failed; if a commonly-used control is
hidden behind an extra click, disclosure has also failed the other way.

## 6. Search → Scan → Select → Inspect → Correlate → Adjust → Repeat

This is the one true loop the whole product exists to make fast. Every
screen must make it obvious what step of this loop the user is on and
what the next step is. A design that optimizes one step (e.g. a
beautiful Inspector) at the cost of another (losing your place in the
result list) has not actually improved investigation speed.

**Check:** Trace a real investigation end to end through the prototype's
states (§13 of the mission) — search, scan the table, select a row,
read the Inspector, follow a correlation, come back, adjust a filter.
Every transition must have an obvious "you are here" and an obvious way
back.

## 7. Selected event is always obvious

There is never a moment where more than one row looks selected, and
never a moment where the selection is ambiguous or invisible. Selection
is marked by more than color alone (a border, an indicator column, a
label) so it survives color-vision differences and print/grayscale.

**Check:** Any state showing a selected row must pass a "look away and
look back" test — the selected row is identifiable in under a second.

## 8. Context and correlation remain distinct

"Show surrounding logs" (same execution scope, strictly chronological,
±30s window, root event visually dominant) and "Correlation / Trace /
Journey" (same request, possibly different services, order-only) are
never merged into one control, one visual treatment, or one mental
model, no matter how tempting the visual simplification. This is a
functional-preservation item (see the contract) as much as a design
principle — see §20 of the mission and `ContextAction.tsx`'s `WINDOW_MS`
vs. the Request Flow tab's "Find this…" actions in the current baseline.

**Check:** Could a user open Correlation and mistake it for Context, or
vice versa, from layout alone? If yes, this principle has failed.

## 9. No fabricated causality

Nothing in the UI — copy, iconography, animation, layout adjacency —
implies that one event *caused* another when the data only shows
temporal or identifier-based association. "Sequence gaps detected" is
factual; "this caused that" is never asserted. This mirrors the current
baseline's own explicit language (`docs/user-guide/screenshots/04-surrounding-logs.png`:
"this order does not indicate causality between events").

**Check:** Read every piece of UI copy touching Context/Correlation
aloud — if it reads as a causal claim, rewrite it as an observational
one.

## 10. Keyboard workflows are first-class

Every primary and secondary action reachable by mouse is also reachable
by keyboard, with visible focus, in a sane tab order, documented in a
discoverable shortcuts reference. This is not an accessibility
afterthought bolted on after the visuals are set — it is designed
alongside every control from the start (CLAUDE.md §7's WCAG 2.2 AA
target, already achieved in the current baseline's `[`/`]` Inspector
navigation, roving-tabindex tab lists, and real, Tab-reachable "← Back to
search results" button).

**Check:** Can the entire Search → Select → Inspect → Context loop be
completed with a keyboard alone, no mouse, in the prototype's design
(even if not yet wired to real interactivity)?

## 11. Tables behave like professional data tools

The results table is not a card list, not a chat-style feed, and not a
generic "data grid" template. It behaves like Seq, a spreadsheet, or a
terminal `less` view: fixed-geometry columns, real per-column sort, real
column visibility/reorder/density control, monospace for timestamps/IDs,
horizontal overflow contained to the table itself (never the page), and
no dropped or duplicated rows under any state.

**Check:** Every requirement in §18 of the mission (sortable headers,
column width handling, reorder, visibility, density, selected row, row
actions, horizontal overflow, long messages, correlation IDs, timestamp
precision) must be visibly accounted for in each direction's prototype.

## 12. Common actions are immediately discoverable

Search, selecting a result, opening the Inspector, and starting Live (on
a source that supports it) require no explanation, no tooltip-hunting,
and no hidden menu. Discoverability is measured by a first-time user's
ability to find the action unaided, not by an expert's muscle memory.

**Check:** Could someone who has only read the Quick Start guide
(`docs/user-guide/QUICK_START_EN.md`) complete its 10 steps using only
what's visible on screen, without hunting?

## 13. Advanced capability does not dominate default workflow

Raw LogQL, the full advanced-filter drawer, and source-specific
configuration (Docker TLS, OpenShift proxy modes) are real, necessary,
and must remain fully capable — but never occupy the primary toolbar's
visual weight by default. This is the same rule as progressive
disclosure (§5) applied specifically to the search/filter surface,
called out separately because it was a named risk area in the mission
brief.

**Check:** In the default (no drawer open) search toolbar, is any
advanced-only control competing visually with Search/Time
range/Severity/Live?

## 14. Source differences are truthful

The UI never implies a source supports something it doesn't. Every
control's presence is driven by the backend's declared
`SourceCapabilities` (`docs/user-guide/CAPABILITY_MATRIX.md`), never
inferred from source *name* or type. A redesign may present this more
elegantly than the current baseline's simple show/hide, but it may never
show a control for an unsupported capability, even temporarily disabled
with an explanation, unless that pattern is deliberately chosen and
consistently applied everywhere (not ad hoc per screen).

**Check:** For each of the four sources, does the prototype's toolbar
match exactly what `CAPABILITY_MATRIX.md` says that source supports?

## 15. Security behavior remains visible but not obstructive

Masking status (which fields are masked, that disabling one is a
conscious, global, reversible choice) stays visible and honest — never
hidden in a way that lets a user forget they've unmasked something,
but also never so loud that it interrupts investigation on every screen.
The current baseline's persistent but calm "masked" convention
(`fi***NN` inline, no separate warning banner on every table row) is the
right shape; a redesign may refine its presentation but must not remove
the visibility or add friction to routine masked search.

**Check:** With masking in its default (fully masked) state, is there
zero extra friction to search and scan? With any field unmasked, is that
fact visible without opening a settings panel?
