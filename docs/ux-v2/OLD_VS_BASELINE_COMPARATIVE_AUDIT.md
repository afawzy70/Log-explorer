# OLD UI vs. CURRENT Baseline — Comparative UX Audit

**Method.** All 19 OLD UI screenshots (`docs/ux-reference/old-ui/old-01.jpg`
through `old-19.jpg`) were individually viewed in full for this audit —
no sampling. All 6 CURRENT-baseline screenshots
(`docs/user-guide/screenshots/01-06*.png`) were also individually
viewed. Areas the current-baseline screenshot set doesn't cover (Docker/
OpenShift settings dialogs, error/loading/empty states, column
management, advanced query builder) were grounded directly in current
frontend source (`ResultsPanel.tsx`, `ResultsTable.tsx`,
`TableSettingsControl.tsx`, `DockerSettingsPanel.tsx`,
`OpenShiftSettingsPanel.tsx`, `advancedFilterFields.ts`) rather than
guessed. The existing textual audit
(`docs/verification/OLD_UX_RESTORATION_AUDIT.md`) was read as prior
evidence of intent, not substituted for this independent visual review.

**Design authority rule** (from `PRODUCT.md` and
`docs/verification/FINAL_PRE_UX_BASELINE_REPORT.md` §9): OLD UI is
authoritative for information hierarchy, investigation workflow,
grouping, density, and discoverability. CURRENT baseline is authoritative
for functionality, architecture, security, correctness, accessibility,
reliability, and source capabilities. **The redesign must exceed both —
this audit exists to say precisely where each one currently wins, so
neither strength gets lost by accident.**

`OLD_SCREENSHOT_COUNT=19`, `ALL_OLD_SCREENSHOTS_REVIEWED=YES`,
`CURRENT_BASELINE_REVIEWED=YES`.

---

## Global shell

**Old:** `old-01.jpg` — a single-line header ("Log Explorer" + source
name + LOCAL badge), a compact one-row toolbar (Service, Time Range,
Severity, Search box with inline Search button), then immediately the
ACTIVE FILTERS chip row with a "Clear all." Everything above the fold.

**Current:** `01-search-results.png` — near-identical composition:
header with app name, DEV badge, source name, three right-aligned entry
points (Privacy & masking, Docker settings, OpenShift), a health
indicator; toolbar row (source, service, time range, severity buttons,
search box, Search/Live/More filters); active-filter chip row below.

**Classification: EQUIVALENT.**
**Why:** The current baseline is a faithful continuation of the OLD
shell's structure (confirmed by `docs/verification/OLD_UX_RESTORATION_AUDIT.md`'s
own restoration work) — same one-row toolbar discipline, same
chip-based active-filter display. The only material difference is the
current baseline surfaces Privacy/Docker/OpenShift settings as named
top-right buttons instead of a single gear/Settings entry (`old-01.jpg`
shows a single "Settings" button) — a wash: current is more discoverable
per-destination, OLD was more compact. Neither wins outright.

## Source selection

**Old:** `old-01.jpg` shows "Log Source: Local Docker Compose" with a
"○ LOCAL" badge next to it, inline in the header — a labeled, always
visible field, not a dropdown shown mid-interaction.

**Current:** A `<select>` combobox in the toolbar itself
(`01-search-results.png`, top-left of the toolbar row), showing
"Fixture (dev/test only)."

**Classification: EQUIVALENT.**
**Why:** Both keep source selection permanently visible and one action
away; OLD put it in the header (more prominent, reads as identity), the
current baseline puts it in the toolbar (reads as a search parameter).
Both are defensible; source choice materially changes what capabilities
are even available (Principle 14), so its prominence matters — a
redesign should keep it unmistakably visible in either position.

## Search toolbar

**Old:** `old-01.jpg` — one compact row: Service dropdown ("All
services", "0 of 24 selected"), Time Range button, Severity buttons
(All/Errors only/TRACE/DEBUG/×ERROR/WARN/INFO as separate toggle pills),
search box with a paste-icon, Run Search + Start Live as two distinct
blue buttons, "More filters" as its own button.

**Current:** `01-search-results.png` — Source, "All services", Time
range button, All/Errors only, Trace/Debug toggles, Info/Warn/Error
severity pills, search box, Search/Live/More filters buttons.

**Classification: EQUIVALENT.**
**Why:** Structurally almost identical; OLD's severity row exposes six
separate pills including a distinct ERROR toggle with an "×" glyph
(unclear semantic from the photo alone), current baseline consolidates
to All/Errors-only plus three color-coded level pills (Info/Warn/Error)
plus a Trace/Debug reveal toggle — current's version is slightly more
consolidated and its pills carry non-color-only labels, a small
accessibility edge. Neither is dramatically denser or clearer than the
other.

## Active filters

**Old:** `old-01.jpg` — chip row directly under the toolbar: "Source:
Local Docker Compose," "Time: Last 30 minutes ×," "Severity: INFO, WARN,
ERROR ×," "Clear all" — chips are removable individually.

**Current:** `01-search-results.png` — "Time range: Last 1 day ×,"
"Clear all" directly beneath the toolbar, same pattern.

**Classification: EQUIVALENT.**
**Why:** Same mechanism, same removability. OLD shows more filters as
chips simultaneously in the one screenshot available (Source, Time,
Severity); current baseline's screenshot only had a Time filter active
so a full side-by-side isn't possible from images alone, but the chip
mechanism itself is unchanged (confirmed structurally identical by
`docs/verification/OLD_UX_RESTORATION_AUDIT.md`).

## Advanced filters (More Filters panel)

**Old:** `old-05.jpg`, `old-06.jpg`, `old-07.jpg` — a wide side panel
(roughly 40% of viewport) grouped under bold section headers ("WHO /
CUSTOMER," "REQUEST FLOW," "WHAT HAPPENED," "CLIENT CONTEXT"), each
field labeled with its match-type ("EXACT MATCH," "SUBSTRING") **and** a
one-line descriptive helper text under nearly every field (e.g. Trace
ID: "spans...", Correlation ID: "Results are masked; the raw value is
never shown," Journey ID: "A customer journey across steps," Event ID:
"A single emitted event"). Apply filters / Cancel / "Reset advanced
filters" at top.

**Current:** grounded in `advancedFilterFields.ts` — the same four
groups (who/client, request flow, what-happened, client context) with
the same fields and match-type labels, per
`docs/user-guide/USER_GUIDE_EN.md` §9's confirmation against source.

**Classification: OLD_BETTER.**
**Why:** OLD's per-field descriptive helper text ("A single opaque
identifier for a trace," "A customer journey across steps") is a real,
concrete discoverability win the current-baseline screenshots and User
Guide description don't show evidence of preserving — a first-time
investigator in OLD UI could learn what each ID field *means* without
leaving the panel. This is exactly the kind of OLD-UI strength
(discoverability, Principle 4/12) a redesign must not lose.

## Advanced query

**Old:** `old-07.jpg`–`old-09.jpg` — a toggle between "No-code builder"
(FIND/AND/OR/GROUP condition rows with Add condition/Add group, a live
"Generated query" preview shown as code) and "Text query" (a raw
query-string box with inline syntax help: "Use field = 'value', >,
contains, and/or operators" plus a worked example).

**Current:** grounded in `docs/user-guide/USER_GUIDE_EN.md` §9 — "an
advanced query builder... Raw LogQL... only Loki, and only when
enabled."

**Classification: OLD_BETTER.**
**Why:** OLD UI's no-code builder with a *live generated-query preview*
and inline worked examples is materially more discoverable than what
the current guide describes. The current baseline's advanced query
capability exists but there is no visual evidence in the baseline
screenshots of an equivalent live-preview/worked-example treatment —
this is a genuine gap, not just an unphotographed feature (no source
file docs-checked in this audit described a generated-query preview).
Also note: OLD's builder was source-agnostic (Docker in the screenshot),
whereas current-baseline Raw LogQL is deliberately Loki-only/gated — that
narrowing is a **correctness improvement** (truthful source capability,
Principle 14) that must be kept even while restoring the no-code
builder's discoverability.

## Result table

**Old:** `old-10.jpg` — columns TIME/DATE/WHAT HAPPENED/LEVEL/SERVICE/
USER-CUSTOMER, dense rows (~14 visible per 900px-equivalent viewport in
the photo), "Newest first"/"Comfortable density" controls, a results
count + timing + truncation banner ("100 events in 456ms... Showing
first 100... results truncated"), selected row shown with a left accent
bar plus full-row highlight.

**Current:** `01-search-results.png` — TIME/LEVEL/SERVICE/WHAT
HAPPENED/USER-CUSTOMER/CORRELATION-TRACE/ACTIONS, similar density
(~12-13 rows visible), "Showing 200 events loaded — total unknown...",
sort control, Columns button, Refresh.

**Classification: CURRENT_BETTER.**
**Why:** Current baseline adds a dedicated Correlation/Trace column and
an explicit Actions column (`old-10.jpg` has no equivalent — row actions
in OLD only appear via a separate context menu, `old-19.jpg`) directly
in the row, and shows missing values as an explicit `—` rather than a
blank cell (visible in `01-search-results.png`'s malformed-line row) —
a concrete correctness win (CLAUDE.md §4 "never omit a cell"). Density
is comparable between the two; current baseline is not denser but is not
meaningfully worse either.

## Sorting

**Old:** `old-10.jpg` shows a "Newest first" dropdown as the only visible
sort control; column headers show small icons but no visible evidence in
any of the 19 photos of an actual per-column sort interaction (no
before/after showing a re-sorted table by another column).

**Current:** Per-column sort (first click ascending, second descending),
sharing one state with the Newest/Oldest toggle — verified in source
(`ResultsTable.tsx`, per `docs/user-guide/USER_GUIDE_EN.md` §10) and CI
tests (`docs/governance/OWNER_REQUIREMENTS_REGISTER.md` PCFR-4).

**Classification: CURRENT_BETTER.**
**Why:** This is a directly evidenced, owner-confirmed regression fix
(PCFR-4) — OLD UI's own Slice-4 code comment (per the register) recorded
a *deliberate decision against* a clickable Time header, later reversed.
The current baseline's compatible-single-sort-state model is a genuine,
verified improvement no OLD screenshot shows OLD UI ever having.

## Column management

**Old:** `old-18.jpg` — a "Column order" panel: "Requested columns (in
order shown)" as a simple checklist with reorder affordance, offering
far more optional columns than the default set (Duration,
Container/Pod, Error code, Business step, Journey ID, Logger).

**Current:** Columns button opens visibility/reorder(drag-and-drop
+keyboard)/density/reset controls (`docs/user-guide/USER_GUIDE_EN.md`
§10, PCFR-5).

**Classification: EQUIVALENT.**
**Why:** OLD exposed a richer *set* of optional columns (Duration,
Container/Pod, Error code, Business step, Journey ID visible as
column options in `old-18.jpg`) than the current baseline's documented
seven-column model appears to offer as toggleable extras — this is a
real discoverability item worth the redesign reconsidering. Current
baseline wins on *interaction quality* (real drag-and-drop plus a
keyboard fallback, explicit Reset, verified persistence — PCFR-5) which
OLD's photo doesn't evidence having. Net: a wash, but for different
reasons on each side — the redesign should aim to combine OLD's richer
column vocabulary with current's better reorder interaction.

## Selected row state

**Old:** `old-10.jpg`/`old-11.jpg` — a full-row light-blue highlight
plus a left-edge accent bar on the selected row.

**Current:** `01-search-results.png`/`02-inspector-overview.png` — a
left-edge accent bar plus a light background tint on the selected row,
consistent across states, and `aria-current`-shaped semantics implied by
the User Guide's "the selected row stays visually marked" claim
(§10, code-verified).

**Classification: EQUIVALENT.**
**Why:** Visually near-identical treatment; both use a left-bar plus
background-tint combination (non-color-only per Principle 7). No
material difference observed.

## Row actions

**Old:** `old-19.jpg` — a right-click/dropdown context menu with "View
details" and "Show surrounding logs" as the two actions.

**Current:** `01-search-results.png` — a dedicated "…" Actions column
cell per row, always visible (not requiring a right-click to discover).

**Classification: CURRENT_BETTER.**
**Why:** A persistently visible "…" affordance is more discoverable
than a context menu that only OLD's screenshot happens to show already
open (Principle 12, "common actions are immediately discoverable" —
right-click menus are a known discoverability weak point for new users).

## Inspector

**Old:** `old-10.jpg`–`old-15.jpg` — a docked right-side panel with tabs
"Overview | Actor & client | Request flow | Business & error" plus a
separate "All fields" button; each tab shown with real content across
several screenshots, and — critically — `old-11.jpg`/`old-12.jpg` show
**honest empty states already**: "No actor or client attributes present
on this event," "No exception present," dashes for Error code/Business
step/UI identifier when absent.

**Current:** `02-inspector-overview.png`/`03-inspector-request-flow.png` —
five always-present tabs (Overview/Actor & client/Request flow/Business
& error/Technical-all-fields), same honest-empty-state discipline
(code-verified, PCFR2-1).

**Classification: EQUIVALENT.**
**Why:** This is the strongest continuity finding in the whole audit:
the current baseline's five-tab, never-conditionally-hidden model is
directly descended from OLD UI's own already-correct behavior — OLD UI
never hid these tabs either, per the honest-empty-state evidence in
`old-11.jpg`/`old-12.jpg`. (Note: the current baseline's own history
shows this got *broken* once — PCFR-1 hid tabs conditionally — and
PCFR2-1 restored the OLD behavior. A redesign must not reintroduce that
regression a third time.)

## Context / surrounding logs

**Old:** `old-16.jpg` — "Context around audit-tracker — ±30s," a stats
row (Events/Services/Errors/Duration/Window), and explicit language:
**"OBSERVED SEQUENCE SUMMARY — Derived only from the ordered event
stream. That is an observed sequence, not a guaranteed causal graph."**

**Current:** `04-surrounding-logs.png` — stats row (Events/Services/
Errors/Warnings/Window/Observed span/Range/Source/Gaps), explicit gap
disclosure, and: **"this order does not indicate causality between
events... A detected gap means no event was observed in that interval —
it is not evidence that anything failed."**

**Classification: EQUIVALENT.**
**Why:** This is the second-strongest continuity finding: the
no-fabricated-causality discipline (Design Principle 9) already existed,
nearly verbatim, in OLD UI. Current baseline adds explicit gap-duration
disclosure ("6s with no observed events between...") which OLD's stats
row doesn't show evidence of — a small current-baseline edge — but the
core honesty language is a preserved OLD-UI strength, not a
current-baseline invention.

## Correlation / journey

**Old:** `old-05.jpg`/`old-06.jpg` show Trace ID/Span ID/Correlation
ID/Journey ID/Event ID as *filter* fields with descriptive helper text,
but none of the 19 photos show a "Find this Trace/Correlation/Journey"
follow-up action actually being triggered from within the Inspector.

**Current:** `03-inspector-request-flow.png` — explicit "Find this
Journey ID / Find this Correlation ID / Find this Trace ID / Find this
Event ID" buttons directly in the Request Flow tab, one click from any
event that carries the identifier.

**Classification: CURRENT_BETTER.**
**Why:** This is a concrete, photo-evidenced current-baseline advance:
turning a static identifier field into a one-click "follow this
request" action closes real distance in the Search → Scan → Select →
Inspect → **Correlate** loop (Principle 6) that OLD's screenshots show
no equivalent for.

## Live

**Old:** `old-01.jpg`/`old-17.jpg` show a "Start Live" button and a
"● Live" indicator, but no screenshot shows the Live panel actually
open/streaming, so OLD's in-Live experience (Pause/Resume/Clear,
Received/Visible counts, multi-replica honesty) cannot be evaluated from
the photos.

**Current:** `05-live-tail.png` — full Live panel: Start/Pause/Stop/
Clear, "Received: 21 · Visible: 21," per-event Trace/Span/Correlation/
Event IDs inline, a persistent "this is not a complete historical
record" disclaimer, "← Back to search results."

**Classification: BOTH_NEED_IMPROVEMENT.**
**Why:** Not a fair current-vs-old comparison — genuine visual-evidence
gap on the OLD side (no in-session Live screenshot exists to compare
against). Current baseline's Live view is real and well-documented, but
this audit can't credit it as "better than OLD" when OLD's actual
in-session Live UX was never captured; flagged as needing improvement on
both sides purely for evidence-completeness, not a specific defect
found in current baseline.

## Settings

**Old:** `old-02.jpg`–`old-04.jpg` — a single "Settings" screen
containing Docker connection AND sensitive-data-masking configuration
together, one scrollable page, sensitive-data masking further split into
"Protected categories" chips and a prominent **"Show sensitive values
(unmask)"** control with an explicit, multi-sentence warning
paragraph directly beside it (RBAC caveat, deployment recommendation).

**Current:** grounded in `docs/user-guide/USER_GUIDE_EN.md` §16 and
PCFR-2 — Privacy & Masking is its own explicitly separate global panel,
independent of Docker/OpenShift settings (moved out specifically
*because* OLD UI's combined-page model was an owner-confirmed problem).

**Classification: CURRENT_BETTER.**
**Why:** This is a directly evidenced, owner-confirmed information-
architecture fix (PCFR-2, "move masking out of Docker Settings into a
global, source-independent Settings area") — `old-02.jpg` is the literal
before-picture of the problem the current baseline already fixed. A
redesign must keep masking global and separate (Functional Preservation
Contract §9), never fold it back into a combined settings page.

## Masking / privacy

**Old:** `old-02.jpg`/`old-03.jpg` — ten+ "Protected categories" chips
(Device IP, CIF/customer ID, Username, Email address, Customer ID,
Device ID, Account number, Phone number, Credential/secret, Session
token, Authorization header) and a global, explicit **"Show sensitive
values (unmask)"** toggle with a long inline warning.

**Current:** `06-privacy-masking.png` — exactly five protected fields
(CIF, Username, Customer ID, Device ID, Device IP), each individually
toggleable, with a shorter, single explanatory paragraph.

**Classification: BOTH_NEED_IMPROVEMENT.**
**Why:** OLD UI protected a materially larger field set (ten-plus
categories including account numbers, phone numbers, credentials,
session tokens, authorization headers) than the current baseline's
five. This is a real scope question, not a visual-design one — the
redesign's own scope (Functional Preservation Contract §5) freezes
today's five fields, so this audit flags the gap for the *owner's*
attention (a possible future backend scope change, not something this
UX-only mission can decide) rather than resolving it silently. On pure
UX terms, current baseline's per-field individual checkboxes (vs. OLD's
category chips plus one global unmask toggle) is arguably clearer about
exactly what's affected — but OLD's field coverage was broader, so
neither side is unambiguously better.

## Docker settings

**Old:** `old-02.jpg`/`old-04.jpg` — Local/Remote Docker Engine radio
choice, then (Remote) Connection name, Host/IP, Port (default 2375,
shown as "Auto (2375)" vs. "Custom"), a TLS toggle with explicit "Not
encrypted: an insecure (non-TLS) connection is only permitted to
administrator-approved hosts" warning, Save/"Reset to Local."

**Current:** grounded in `DockerSettingsPanel.tsx` /
`docs/user-guide/USER_GUIDE_EN.md` §4 — Mode (Local/Remote), Host, Port
(default 2375), "Use TLS"+certificate directory path, "Test Connection."

**Classification: EQUIVALENT.**
**Why:** Functionally identical field set and flow. OLD's explicit
inline non-TLS warning copy ("only permitted to administrator-approved
hosts") is slightly more informative in-context than a bare TLS
checkbox; current baseline's "Test Connection" affordance (not
evidenced in any OLD screenshot) is a concrete usability edge OLD
doesn't show. Roughly a wash.

## OpenShift settings

**Old:** No OLD screenshot shows an OpenShift/Kubernetes-specific
settings screen at all — none of the 19 images reference OpenShift,
Loki, `oc login`, projects, or proxy configuration.

**Current:** `oc login`-paste connection flow, Project/Workload/Pod/
Container scoping, System/Direct/Custom proxy modes
(`docs/user-guide/USER_GUIDE_EN.md` §5, PCFR2-2/PCFR2-3).

**Classification: CURRENT_BETTER (by default — no OLD baseline exists).**
**Why:** OLD UI predates OpenShift support entirely, per the visual
evidence (and consistent with `docs/verification/OLD_UX_RESTORATION_AUDIT.md`'s
own scope). There is nothing to compare against; current baseline's
OpenShift settings are real, verified-against-a-real-cluster
functionality with no OLD-UI equivalent to preserve or improve on.

## Error states

**Old:** No OLD screenshot shows a search-failure or connection-error
state — none of the 19 images capture an error condition.

**Current:** `ResultsPanel.tsx` — a distinct `role="alert"` error state:
"Search failed" title, the backend's sanitized error detail verbatim
(never a search value/identifier/secret — enforced by
`GlobalExceptionHandler`), and an inline "Retry search" button; the
breadcrumb ("← Back to original search") stays visible even in this
state.

**Classification: BOTH_NEED_IMPROVEMENT.**
**Why:** No OLD-UI visual evidence exists to compare against (evidence
gap, not a specific defect on the OLD side). Current baseline's error
state is real, tested, and reasonably good (explicit retry, sanitized
detail, breadcrumb preserved) — flagged for improvement only because a
redesign should not treat "we have no OLD reference" as license to skip
deliberate attention to this state; it's exactly the kind of state that
degrades fastest under visual-only design review (CLAUDE.md §6).

## Loading / empty states

**Old:** No OLD screenshot shows a loading spinner or the true "before
any search has run" first-load state (all 19 photos show either an
empty-but-configured toolbar with no results yet, e.g. `old-01.jpg`'s
"Configure your search and click Run Search," or a populated table).

**Current:** `ResultsPanel.tsx` / `06-privacy-masking.png`'s background —
"Run a search to see results" (initial), "Searching…" with
`role="status"` (loading), "No results for this range." plus a one-click
"Search last 1 day" (zero-results) — three distinct, honestly-labeled
states.

**Classification: EQUIVALENT.**
**Why:** OLD's `old-01.jpg` initial-state copy ("Configure your search
and click Run Search, or press Ctrl+Enter") is functionally identical in
spirit to current baseline's "Run a search to see results" — both give a
clear next action. Current baseline's additional "Search last 1 day"
one-click zero-results affordance is real and code-verified but not
something OLD's photos show being absent either way (no OLD zero-results
screenshot exists) — treated as equivalent rather than a clean win absent
a true side-by-side.

## Responsive behavior

**Old:** All 19 photos are desktop-monitor photographs at what appears
to be a single large viewport (~1728px-equivalent based on visible
content density) — no OLD evidence exists at any narrower width.

**Current:** `CLAUDE.md` §7 requires usability down to 1024/768; no
current-baseline screenshot in this evidence set was captured at a
narrow width either (`docs/user-guide/screenshots/` are all standard
desktop-width captures).

**Classification: BOTH_NEED_IMPROVEMENT.**
**Why:** Genuine evidence gap on both sides — this audit cannot claim
either UI is visually proven responsive from the available screenshots.
This is exactly why the mission requires every prototype direction to
be captured at both 1440×900 and 1366×768 (§15) rather than relying on
this audit alone.

## Keyboard workflow

**Old:** `old-03.jpg`/`old-04.jpg` show an explicit, always-visible
keyboard-shortcuts panel docked to the screen's right edge: Enter (Run
the search), Ctrl+Enter (Run the search / details), Escape (Close
pickers/details), Tab (Move between input and filters), ↑/↓ (Navigate
picker options) — shown unprompted, not behind a help icon.

**Current:** `docs/user-guide/USER_GUIDE_EN.md` §17 documents `[`/`]`
Inspector navigation, roving-tabindex tab lists, Escape-closes-top-layer,
a keyboard-shortcuts button in the header (`01-search-results.png`,
top-right) — but reachable via a click, not shown by default.

**Classification: OLD_BETTER.**
**Why:** OLD UI's always-visible shortcuts panel is a genuine
discoverability advantage (Principle 10) current baseline's
click-to-reveal button doesn't match — an investigator in OLD UI learns
the keyboard model passively, by proximity, without any action. This is
a concrete, low-risk restoration candidate for the redesign.

## Visual density

**Old:** Consistently ~13-14 data rows visible per screenshot at the
photographed viewport, minimal vertical padding between rows, compact
toolbar.

**Current:** ~12-13 rows visible in `01-search-results.png` at
1440-class width — comparable.

**Classification: EQUIVALENT.**
**Why:** Row density is close enough between the two (within one row's
difference) that neither has a decisive density advantage today. This
matters because it sets the floor Direction A/B/C must not fall below
(Design Principle 2's density check).

## Typography

**Old:** Sans-serif throughout, including timestamps and IDs (visible in
`old-10.jpg`'s monospace-looking but actually proportional-width time
column — hard to confirm monospace from a photo at this resolution;
treated as inconclusive).

**Current:** `CLAUDE.md` §7 mandates monospace specifically for
timestamps/IDs/query syntax/stack traces; `03-inspector-request-flow.png`
shows genuinely monospaced Trace/Correlation/Journey/Event ID values.

**Classification: CURRENT_BETTER.**
**Why:** Current baseline's deliberate monospace-for-IDs discipline is
directly confirmed in `03-inspector-request-flow.png` (the ID values are
visibly fixed-width); OLD's photos are inconclusive on this point at
best, and where legible appear to use the same proportional font
throughout, which is a real scanability disadvantage for ID comparison
(a professional data tool convention current baseline already follows,
Principle 11).

## Hierarchy

**Old:** Hierarchy comes primarily from bold section labels (ALL CAPS
group headers: "WHO / CUSTOMER," "REQUEST FLOW") and font-weight, with
very little color used for structure.

**Current:** Hierarchy uses a combination of weight, one accent color
(blue, for primary actions and the selected-row/active-tab indicator),
and semantic severity colors paired with text labels (never color
alone, per `01-search-results.png`'s "● INFO"/"● WARN"/"● ERROR" pattern).

**Classification: EQUIVALENT.**
**Why:** Both achieve clear hierarchy through legitimate, different
means — OLD leans on typographic weight and labeling discipline, current
leans on a restrained single-accent-color system with non-color-only
severity semantics (a real accessibility improvement, Principle 15/16)
layered on top of similar typographic discipline. Neither is flatter or
noisier than the other.

## Action prominence

**Old:** `old-01.jpg` — "Run Search" and "Start Live" are both solid
blue, equally prominent, side by side.

**Current:** `01-search-results.png` — "Search" is solid blue
(primary), "Live" is outlined/secondary — visually subordinate to
Search.

**Classification: CURRENT_BETTER.**
**Why:** Search is the primary, far-more-frequent action in the
Search → Scan → Select → Inspect loop (Principle 1/6); giving it
unambiguous primary-button weight while Live (a less frequent,
mode-switching action) gets secondary treatment is a small but real
hierarchy improvement current baseline makes over OLD's equal-weight
treatment of the two.

---

## Synthesis

### OLD-UI strengths a redesign must not lose (ranked)

1. **Always-visible keyboard-shortcuts panel** — passive discoverability
   of the entire keyboard model, not hidden behind a button
   (*Keyboard workflow*, `old-03.jpg`/`old-04.jpg`).
2. **Per-field descriptive helper text in More Filters** — every
   ID/identifier field explains what it means in one line, in place
   (*Advanced filters*, `old-05.jpg`–`old-07.jpg`).
3. **No-code query builder with a live generated-query preview** — makes
   advanced query construction legible even to someone who doesn't know
   the query syntax (*Advanced query*, `old-08.jpg`).
4. **The "observed sequence, not a guaranteed causal graph" honesty
   language in Context** — already established practice, must persist
   verbatim in spirit (*Context*, `old-16.jpg`).
5. **The Inspector's five-groups-always-present, honest-empty-state
   model** — already correct in OLD UI; the redesign's job is to not
   regress it a third time (*Inspector*, `old-11.jpg`/`old-12.jpg`).
6. **Richer optional-column vocabulary** in column management (Duration,
   Container/Pod, Error code, Business step, Journey ID) — worth
   restoring alongside current's better reorder mechanics
   (*Column management*, `old-18.jpg`).

### CURRENT-baseline guarantees a redesign must not weaken (ranked)

1. **Masking is global and source-independent, never folded back into
   Docker/combined settings** — a directly owner-confirmed fix over
   OLD's combined page (*Settings*, PCFR-2).
2. **Per-column sort compatible with a single Newest/Oldest state** — a
   directly owner-confirmed fix over an OLD-UI regression
   (*Sorting*, PCFR-4).
3. **"Find this Trace/Correlation/Journey/Event ID" one-click follow-up
   actions** — no OLD-UI equivalent exists; this closes real
   investigation-loop distance (*Correlation*, Principle 6).
4. **Non-color-only severity/status semantics everywhere** (text labels
   alongside color, monospace for IDs) — a real accessibility guarantee
   OLD's photos don't evidence having (*Typography*, *Hierarchy*).
5. **Truthful, source-declared capability** (never showing a control a
   connected source doesn't support) — has no OLD-UI equivalent to
   compare against (OLD predates OpenShift/Loki entirely) and is a
   correctness invariant, not a visual choice (*OpenShift settings*,
   Principle 14).
6. **Sanitized, actionable error/loading/empty states** with a
   preserved breadcrumb back to the original search in every state —
   evidenced in source (`ResultsPanel.tsx`), no OLD equivalent to
   compare against (*Error states*).
7. **Honest partial-context and gap-duration disclosure** in
   surrounding logs, an elaboration on OLD's already-good foundation
   (*Context*, `04-surrounding-logs.png`).

### Classification tally

OLD_BETTER: 3 (Advanced filters, Advanced query, Keyboard workflow) ·
CURRENT_BETTER: 9 (Result table, Sorting, Row actions, Correlation/
journey, Settings, OpenShift settings, Typography, Action prominence,
plus Masking/privacy noted as a scope question rather than a clean OLD
win) · EQUIVALENT: 11 (Global shell, Source selection, Search toolbar,
Active filters, Column management, Selected row state, Inspector,
Context/surrounding logs, Docker settings, Visual density, Hierarchy) ·
BOTH_NEED_IMPROVEMENT: 5 (Live, Error states, Loading/empty states,
Responsive behavior, Masking/privacy field-coverage question).
