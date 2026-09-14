# Direction C — Investigation-First Minimal

## Concept

Direction C strips the persistent chrome down to a single toolbar row
— source, search, time, severity, and three secondary affordances
(Filters/Columns/Settings) — so the investigator's eye lands on the
results table immediately, while keeping every other capability exactly
one deliberate action away, never buried. The results table itself stays
fully dense (compact rows, monospace timestamps/IDs, seven real columns)
because minimalism here is about *chrome*, not about *data* — the
opposite mistake (hiding information to look clean) would fail the
product's own investigators. The Inspector opens as a wide side panel
next to the table rather than a modal, so an investigator can still see
where they are in the result list while reading detail — the whole
Search → Scan → Select → Inspect → Correlate loop stays visible in one
frame.

## Strengths

- Fastest visual path from "open the app" to "I'm looking at the data" —
  nothing to dismiss, nothing to configure by default.
- The Inspector-as-side-panel (not a modal) keeps the result list visible
  while reading an event, which is a genuine improvement over a
  full-screen or overlay-modal inspector: you never lose your place.
- "Show surrounding logs" reads as unmistakably distinct from the results
  table and from Correlation — a dedicated full-width chronological view
  with the root event visually dominant (bordered, tinted, labeled),
  matching the mission's explicit context quality bar.
- Settings' two-column split (global Privacy & Masking vs.
  OpenShift-specific) makes the global/source-specific distinction
  impossible to miss — arguably clearer than a tabbed or single-form
  settings surface would be.
- More Filters, despite being the "deferred" surface, is not
  under-designed: every advanced field from the current baseline is
  present, grouped, and labeled with its exact match semantics
  (EXACT/CONTAINS), so power users lose nothing by it being one click
  away instead of always-visible.

## Weaknesses

- The side-panel Inspector needed a genuinely wide panel (580px) to fit
  all five section tabs without clipping or requiring a scroll — this
  was found and fixed during this exploration (measured empirically: the
  five tab labels need ~538px, not the 420px a narrower "minimal" panel
  would have preferred). At narrower desktop widths (1366px) this leaves
  meaningfully less room for the table than Direction A/B's approaches
  likely do; a real implementation would need either a responsive
  breakpoint that shrinks the table's optional columns first, or a
  slightly different Inspector navigation (e.g. a compact icon rail)
  before this ships.
- "Minimal chrome" is a discipline that's easy to under-deliver on in
  real engineering — every control this mockup deferred to a drawer
  (More Filters, Settings) needs a genuinely obvious, well-labeled entry
  point in the always-visible toolbar, or the direction's core promise
  (investigation speed) inverts into "where did that setting go."
- Live mode's "2/4 active" partial-connectivity disclosure and the
  masking "currently unmasked" warning both rely on color + text
  together (not color alone) — correct per the accessibility contract,
  but this mockup didn't test them against a colorblind simulation; a
  real implementation should.

## Inherited from OLD

- The single always-visible search bar plus compact severity/time
  controls in one toolbar row, direct evolution of old-01/old-08's
  toolbar composition (Search / Time Range / Severity / More filters all
  in one line, Active Filters shown as a strip below it).
- The advanced-filter drawer's grouped-fields layout (who/client,
  request flow, what-happened, advanced query) mirrors old-08's More
  Filters panel structure closely, including per-field match-type tags.
- Dense, striped-free row treatment with a left-edge accent bar for the
  selected row — descended from old-14's dense audit-log table, though
  Direction C's row height is tighter still.

## Improves over OLD

- OLD's Inspector was a fixed side panel too, but this direction makes
  the "you are here" investigative loop explicit with visible
  Previous/Next navigation and an unmistakable root-event treatment in
  Context — neither was demonstrably present in the reviewed OLD
  screenshots.
- Honest partial-connectivity and partial-window disclosure (Live
  "2/4 active", Context's gap markers) — no equivalent honesty pattern
  was visible in the OLD screenshots reviewed.
- Settings' explicit global-vs-source-specific split — OLD's masking
  configuration lived inside Docker settings (a since-corrected mistake
  the current baseline itself already fixed); this direction keeps that
  fix and gives it clearer visual real estate than a single-column
  settings page would.

## Improves over CURRENT baseline

- Consolidates the current baseline's separate toolbar row + filter-chip
  row into one calmer composition, with the Inspector living beside the
  table instead of only as a floating panel — depending on the current
  baseline's actual layout (which a redesign implementation would need
  to confirm pixel-for-pixel against `docs/user-guide/screenshots/`),
  this direction's Context view gives the root event more deliberate
  visual weight (a bordered, tinted block) than the baseline's screenshot
  shows.
- More Filters is presented as a full-height side sheet rather than
  (per the current baseline's screenshots) an inline expansion, which
  scales better to the full current field set without pushing the table
  down.

## Implementation risk

**Medium.** The visual language (flat, bordered, restrained, one accent
color, monospace for data) is straightforward to implement in the
existing React/CSS stack with no new dependencies. The main real risks
are: (1) the Inspector's fixed-width side panel needs genuine responsive
handling below ~1366px — this mockup found that gap directly, it doesn't
disappear in a real build; (2) "defer secondary controls to one click
away" is a discipline that requires deliberate ongoing design review to
not silently regress into "buried" as more settings/filters get added
over time — this is a process risk more than a technical one.

## Honest self-assessment: did this avoid the "sparse consumer app" trap?

Largely yes, with one caveat. The results table, Live feed, and Context
view are all dense, monospace-forward, and information-rich — nothing
about them reads as a consumer app. The genuine risk area is the
**default (no drawer open) toolbar and the Settings screen's large empty
lower area** in the 1440×900 captures: once the visible data ends, both
screens show a meaningful stretch of empty canvas rather than filling it
with more useful density. A real implementation should treat that empty
space as a signal to either compress vertical rhythm further or use it
for something functional (e.g., recent searches, saved views if ever
in scope) rather than leaving it as intentional whitespace — in its
current mockup form this is closer to "restrained" than "sparse," but
it is the one place a reviewer could fairly push back.
