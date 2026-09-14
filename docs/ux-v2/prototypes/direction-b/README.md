# Direction B — Modern Developer Console

**Concept.** A calmer, more polished evolution of the current baseline's
shell: the same information-dense investigation loop (Search → Table →
Inspector → Context → Correlate), but composed with more deliberate
typographic hierarchy, restrained color (one accent — a calm dark blue —
used sparingly for state, links, and the primary action), and an
Inspector that visually *attaches* to the selected row (a 3px accent bar
across its header, a breadcrumb line naming the selected service) rather
than reading as a detached dialog. Context ("Show surrounding logs")
breaks from the Inspector's tabbed layout entirely into a vertical
timeline with the root event structurally distinct (thicker border,
tinted background, an explicit "Root event you selected" tag) — so it
can never be visually confused with the Trace/Correlation "Find this…"
mechanism, which stays inside Inspector's Request Flow tab.

## Strengths

- Genuinely calmer than a dense terminal-style grid while **not**
  sacrificing row count — the 1440-wide search-results screenshot still
  shows every column the current baseline has (Time, Level, Service,
  What happened, User/Customer, Correlation/Trace, Actions) at a
  comparable row height to the real app's own
  `docs/user-guide/screenshots/01-search-results.png`.
- The Inspector-attaches-to-selected-row treatment (accent bar continuing
  from the row into the panel header) makes "what am I looking at and
  why" immediately legible — stronger recognition-over-recall (Design
  Principle 4) than a plain modal.
- Context's timeline composition is unambiguously different from every
  other screen in the app — nobody could mistake it for Correlation or
  for the plain results table, satisfying Design Principle 8 by
  construction, not just by copy.
- Settings' global/source-specific split is visually loud on purpose (a
  colored "GLOBAL" pill vs. a neutral "SOURCE-SPECIFIC" pill) — harder to
  miss than the current baseline's separate-panels-but-same-styling
  approach.
- More Filters expands inline below the toolbar rather than as a
  right-side drawer, so it never visually competes with, or gets
  confused with, the Inspector panel that also lives on the right.

## Weaknesses (owner should know these before choosing)

- The results table in `01-search-results.html` leaves a large empty
  gray area below 9 rows at 1440×900 — real usage would show more rows,
  but this prototype's fixed row count makes the screen look sparser
  than intended; a real implementation must confirm the table actually
  fills available height with real data before this reads as "dense."
- `notification-worker` wraps to two lines in the Service column at its
  current fixed width — a minor column-width tuning issue, not
  structural, but a reminder that column widths need real-data testing,
  not just one sample string.
- This direction's calm restraint is the easiest of the three to
  accidentally drift toward "just a nicer version of the current
  baseline" rather than a genuine rethink — the owner should judge
  whether "modern console, same bones" is the right ambition level or
  whether Direction A or C's more distinct compositions are preferred.
- The Inspector-attached-to-row concept depends on the selected row
  staying visible near the panel; with a very long result list and the
  selected row scrolled out of view, the visual connection (accent bar
  continuity) breaks down — needs a real interaction-design answer
  (e.g. re-affix or re-highlight) before implementation, not solved by
  this static prototype.

## What's inherited from OLD

- Multi-column, monospace-timestamp, information-dense table as the
  primary surface (not cards) — the same core commitment the old UI made
  and the current baseline still honors.
- Grouped, labeled filter sections (Who/Flow/What/Client) echo the old
  UI's grouped-filter instinct rather than one flat alphabetical list.

## What improves over OLD

- Explicit sort/direction affordance on the Time column header (a real
  current-baseline capability the old UI's screenshots don't show as
  clearly), truthful masking indicators, and an honest partial-Live-
  connectivity state ("LIVE (3/4 active)") — all things the old UI
  either didn't have or didn't surface as clearly.

## What improves over CURRENT baseline

- Inspector reads as an extension of the selected row instead of a
  disconnected panel; Context's timeline is far more visually distinct
  from Correlation than the current baseline's shared card-list styling
  for both; Settings' global-vs-source-specific split is unmistakable at
  a glance instead of requiring the user to notice which panel they
  opened.

## Implementation risk

**Low–medium.** Nothing here requires a new interaction paradigm — it's
mostly a refinement of the current baseline's actual DOM structure
(table, side panel, drawer, dialog) with a tighter, more consistent
token system. The main real risk is the Inspector's "attached to row"
visual metaphor breaking on scroll (see weaknesses above) and needs a
concrete answer before implementation, not a hard blocker to choosing
this direction.
