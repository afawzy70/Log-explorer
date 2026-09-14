# Direction A — Dense Observability Workstation

## Concept

Direction A is the most direct philosophical descendant of the OLD UI:
a compact, high-density, keyboard-first investigation surface that reads
like a professional developer tool (Seq, k9s, a terminal-adjacent
console) rather than an admin dashboard. The Inspector is a permanent
split pane welded to the results table, never a modal that steals the
whole screen; rows are 28px tall; typography sits at an 11-13px working
scale; color exists almost entirely to carry severity and selection
state, not decoration. Every screen answers "how much can an
investigator see and act on without leaving this view."

## Strengths

- Highest information density of the three directions — the search
  results view shows the full toolbar, active-filter strip, meta line,
  and results table with zero scrolling at 1440×900, something the OLD
  UI also prioritized and the current baseline does reasonably well but
  with a slightly less refined visual system.
- The Inspector-as-split-pane (rather than a floating dialog) keeps the
  result list visible at all times during inspection — an investigator
  never loses their place in the result set, directly serving Design
  Principle 6 (the Search → Scan → Select → Inspect loop).
- Settings cleanly separates Privacy & Masking (global) from Docker and
  OpenShift (source-specific) as three visually distinct cards, not one
  form — directly satisfies the Functional Preservation Contract §9.
- Context (surrounding logs) is unmistakably distinct from Correlation
  in both layout and language — full-width banner + stat strip + a
  visually dominant "ORIGINAL EVENT" badge on the root row, versus
  Correlation's inline "Find this…" affordance inside the Request Flow
  tab. No risk of the two concepts blurring together.
- More Filters opens as a right-hand drawer that never covers or
  competes with the primary toolbar — Search/Time/Severity/Live stay
  fully visible and usable with the drawer open.

## Weaknesses

- Density has a real cost: at 12px/11px body text, a user with degraded
  vision or working at 150%+ OS-level zoom (not just in-browser zoom)
  will find this the least comfortable of the three directions. It
  passes WCAG contrast/size checks as built, but it is closest to the
  floor, not comfortably above it.
- The split-pane Inspector reduces the table's own visible width by
  ~420px whenever a row is selected — the "Correlation/Trace" and
  "User/Customer" columns already start eliding at 1366×768 with a row
  selected (visible in the screenshots). A real implementation would
  need either a collapsible/resizable pane or a documented minimum
  supported width.
- This direction leans hardest into "developer tool" identity, which
  carries the most risk of feeling unapproachable to a support engineer
  who is less comfortable with dense terminal-like interfaces than a
  backend developer is — the persona split named in PRODUCT.md.
- Because almost every affordance is always visible (no progressive
  hiding beyond the More Filters drawer), first-time discoverability is
  weaker than Direction C's more guided approach — an investigator's
  first five minutes are busier here than in a calmer direction.

## Inherited from OLD

Row density, a toolbar that stays compact rather than expanding to fill
space, and treating the result table as the permanent center of gravity
that other panels attach to rather than replace.

## Improves over OLD

Real fixed-column table geometry (no layout shift under long messages or
missing values), an honest masked-by-default privacy model surfaced
directly in Settings rather than buried in a connection panel, and a
Context view that explicitly discloses detected gaps instead of
implying a complete picture.

## Improves over CURRENT baseline

A split-pane Inspector instead of the current dialog-style Inspector —
this removes the current baseline's implicit "table hidden while
Inspector is open" state (the current baseline's `02-inspector-overview.png`
shows the table on the left and Inspector on the right already, so this
direction sharpens rather than invents this — the improvement is
density: less padding, more visible rows per screen, and a table/panel
divider that reads as one workstation rather than two adjacent apps.
Settings goes from a single-purpose dialog per source to three
side-by-side cards visible at once, letting an admin compare
Docker/OpenShift/masking state in one glance instead of switching
dialogs.

## Implementation risk

**Medium.** Nothing here requires a new interaction paradigm the current
baseline doesn't already have (split-pane inspector, drawer-based
filters, and card-based settings are all common, well-understood React
patterns) — the real cost is in the type/spacing system rewrite (every
component's padding and font-size shrinks) and in re-validating table
geometry invariants (CLAUDE.md §4's 2px header/cell alignment tolerance)
against the new denser row height and Inspector-narrowed table width.
The functional surface itself (every control in the Functional
Preservation Contract) maps directly onto existing backend
capabilities — no backend change implied by this direction.
