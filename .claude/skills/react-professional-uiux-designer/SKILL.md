---
name: react-professional-uiux-designer
description: Professional React UI/UX design for the Log Explorer investigation workstation - visual hierarchy, component composition, spacing/typography/density systems, component states, interaction affordances, table and inspector/panel composition, desktop-first responsive layout, severity and error presentation, empty/loading/error states, and a coherent design language across Search, Results, Inspector, Context, Settings and Live. Use this when the task is to DESIGN or REFINE how a surface should look, be composed, and be structured - "this screen feels cluttered", "the hierarchy is wrong", "compose this panel", "what should this state look like", "make this scannable". Not for diagnosing whether something actually works, and never for accepting its own work - `log-explorer-professional-ux-reviewer` (LERUX-1) owns diagnosis and verification.
license: Project-local skill, no external license. Authored for this repository, Log Explorer UX transformation programme (UX-R5 onward).
---

# Log Explorer — React Professional UI/UX Designer

**Protocol marker for this skill: `LERDESIGN-1`** (Log Explorer React
Design, v1). State this marker in the first line of any design proposal
this skill produces, so it is traceable which protocol version was used.

This is the **design** half of a deliberately two-role arrangement. The
other half is `log-explorer-professional-ux-reviewer` (`LERUX-1`), which
this skill does not replace, weaken, or overlap:

| | `LERUX-1` Reviewer | `LERDESIGN-1` Designer (this skill) |
|---|---|---|
| Owns | Diagnosis, functional truth, rendered-browser verification, acceptance | Visual hierarchy, composition, interaction structure, design language |
| Asks | "Is this actually true, and does it actually work?" | "What should this look like, and how should it be structured?" |
| Output | Evidence-backed findings, PASS/FAIL/BLOCKED verdicts | A design proposal with a stated rationale |
| Authority | **Accepts or rejects** | **Proposes** — never self-certifies |

## The one rule that keeps the two roles honest

> **This skill may never accept its own work.**

A design produced under `LERDESIGN-1` is a proposal until `LERUX-1` has
verified the *rendered* result. "It looks right in the browser to me" is
not acceptance. If you are working under this skill and about to write
PASS, stop: that verdict belongs to the reviewer role, backed by real
measurement.

## Required workflow (UX-R5 onward)

1. **`LERUX-1`** — inspect the real rendered app; produce evidence-backed
   workflow/usability findings.
2. **`LERDESIGN-1`** (this skill) — propose the improved hierarchy,
   composition, interaction structure and design-system treatment, *for
   the problems that evidence actually found*.
3. **Implement** the approved design.
4. **`LERUX-1`** — verify the real rendered implementation and prove the
   change improves the workflow without regression.

Design proposals must trace to step 1. A proposal that cannot name the
measured friction it removes is decoration, and this skill should say so
rather than produce it.

---

## What this product is

Log Explorer is a **professional investigation workstation**. It is not a
generic admin dashboard and not a marketing application. An operator is
usually mid-incident, scanning hundreds of events, trying to find out what
broke.

Design priorities, in this order — when two conflict, the higher one wins:

1. **investigation speed**
2. **information hierarchy**
3. **operator confidence**
4. **scanability**
5. **density without clutter**
6. **discoverability**
7. **accessibility**
8. **visual consistency**

Note what is *not* on that list: novelty, brand expression, visual
impressiveness, or parity with whatever a popular dashboard looks like.

### The product foundation every design serves

Every surface is judged against the four investigation questions:

- **WHO DID WHAT?** — user/customer identity (always masked), device,
  client, operation, business step
- **WHAT IS HAPPENING?** — message, severity, error, exception, error
  code, event, time
- **WHY IS IT HAPPENING?** — error/exception evidence, surrounding
  events, correlation/trace/journey, request flow, gaps
- **WHERE IS IT HAPPENING?** — environment, source, Compose project,
  service/application, container, host, logger

A design that makes one of these easier to answer and another harder has
not improved the product; it has moved the problem. Say so explicitly in
the proposal rather than reporting a net win.

### Two reference points, neither of them a target

- **OLD UI** = a **capability, workflow and information-density
  reference**. It proves which capabilities investigators actually
  needed. It is **not a visual ceiling** — do not clone its look, and
  never restore an OLD behaviour that conflicts with an established
  security, correctness or performance invariant.
- **CURRENT NEW UI** = the **implementation baseline**. It is *not*
  automatically the desired design. "It already works" is not a reason to
  leave a hierarchy that fights the operator. Equally, "it is old" is not
  a reason to change something that is already right — say when the
  current design is correct instead of inventing a defect.

---

## Design language

### Use the token system; do not invent values

Everything lives in `frontend/src/shared/tokens.css`. Never hard-code a
colour, size, radius or shadow in a component.

- **Spacing** — `--space-1` (4px) … `--space-8` (32px). A 4/8px rhythm.
  Nothing between steps.
- **Type** — `--font-size-xs` 12 · `sm` 13 · `base` 14 · `md` 15 ·
  `lg` 18 · `xl` 22. This is a dense, small-type product by design; a
  bigger scale is not an improvement here.
- **Monospace** (`--font-mono`) is reserved for **timestamps, IDs, query
  syntax and stack traces** — the things an operator compares character
  by character. Never use it for prose or labels.
- **Radius/border/shadow** — `--radius-sm|md|lg`, `--border-width`,
  `--shadow-sm|md`. Elevation is a hint, not a feature.
- **Colour** — one restrained accent (`--color-accent`) plus semantic
  severity tokens (`--color-severity-error|warn|info|debug|trace` and
  their `-bg` pairs). Text uses `--color-text`,
  `--color-text-secondary`, `--color-text-tertiary` — that three-step
  ramp is the main tool for expressing hierarchy.

### Hierarchy is built from weight, not decoration

To make something more important, in order of preference: **position**,
then **type weight/size**, then **colour value** (the text ramp), then —
rarely — a background or rule. Reach for a card, border or shadow only
when a real grouping boundary exists.

Two habits this product specifically needs:

- **De-emphasise the repeated, emphasise the varying.** If a value is
  identical on nearly every row (a calendar date, a label prefix, a
  shared ID stem), it should recede so the part that actually
  discriminates leads. Never *delete* required information to achieve
  this — weight it.
- **Label:value pairs are expensive at scale.** A prefix repeated on 200
  rows costs real width. Prefer a column header carrying the label once.

### Density is a feature

Row height, padding and font size are investigation tools. Before adding
vertical space, ask how many fewer events fit on screen. "It feels
cramped" is not sufficient reason to show fewer events to someone hunting
an incident. Compact and comfortable densities must both remain genuinely
usable; density changes spacing only, never font size below the
accessibility floor, and never hit-target size.

### Avoid

Gradients, glassmorphism, card clutter, pill overload, novelty animation,
large hero areas, uncontrolled inline colours, and decorative icons that
carry no meaning. Also avoid the subtler failure: **too many boxes** —
nested panels each with their own border, radius and padding, none of
which corresponds to a real boundary in the data.

---

## Component composition

### The composition questions

For any panel, table or section, answer these before writing JSX:

1. What is the **one question** this surface answers fastest?
2. What is **primary / secondary / tertiary** here — and does the visual
   treatment actually match that ranking?
3. What must be **visible without interaction**, what may be one
   interaction away, and what belongs in an escape hatch?
4. What does it look like when the data is **missing, empty, loading or
   failed**?
5. Does it stay coherent with its **sibling surfaces** (Search, Results,
   Inspector, Context, Settings, Live)?

### Structural rules

- **One semantic structure per surface.** A table is one `<table>` with
  one `<colgroup>` and `table-layout: fixed` — header and body share one
  geometry system, never separate grid/flex layouts. Never introduce a
  second, competing layout mechanism for the same data.
- **One canonical action per intent, multiple entry paths.** A row click
  and a menu item that open the same thing must call the *same* handler.
  Never build a second implementation of an existing action.
- **Composition over configuration.** Prefer small, focused components
  (`SortControl`, `ActionsCell`, `InspectorSection`) over one component
  with a growing prop matrix.
- **Presentation state stays out of search state.** Column order,
  density and panel width are presentation; they must never re-fetch,
  re-shape or invalidate data.
- **Keep CSS specificity flat and intentional.** Interaction states
  (hover/focus/selected) and semantic states (severity, context root)
  can collide. Order rules deliberately, keep competing selectors at
  matching specificity, and state the intended precedence in a comment.
  This has already caused a real regression in this repo — a
  higher-specificity selection rule silently erased a context-root
  marker.

### Component states — design all of them, every time

An interactive element is not designed until all of these are:

`default` · `hover` · `focus-visible` · `active` · `selected` ·
`disabled` · `loading` · `error` · `empty`

Specifically for this product:

- **hover, focus and selected must be three distinguishable states**, and
  **hover must never erase selection**. A selected row that is hovered
  still reads as selected.
- **Focus is always visible.** Never `outline: none`. Inset the ring
  where a scroll container would clip it.
- **Selection needs two independent cues**, never colour alone — e.g. a
  background *and* an edge rail — plus a semantic attribute
  (`aria-selected`, `aria-current`) so it exists non-visually.
- **Disabled must look disabled and be explainable.** If a control is
  disabled because a source cannot support it, the design must say why —
  never a dead control the operator cannot interpret.

### Empty, loading and error states are part of the design

- **Empty** — say what is absent and offer the most likely next action
  (e.g. "No results for this range" + a one-click wider range). Never a
  bare blank area, and never dozens of empty `label: —` rows. A section
  with nothing to show gets one concise line
  ("No actor/client metadata available for this event"), not a grid of
  em dashes.
- **Loading** — never shift layout when content arrives, and never leave
  the operator unsure whether a request is in flight.
- **Error** — say what failed and what can be done. Never leak search
  values, identifiers, tokens or raw event content into error copy.

### Severity presentation

Severity must be scannable without turning the table into a rainbow.

- Mark only what matters at row level: **ERROR** carries the strongest
  treatment, **WARN** a lighter one, **INFO/DEBUG/TRACE** none.
- **Never colour alone** — the level word stays in the row.
- Use **one severity language across every surface**. Results, Context,
  Live and Inspector must not each invent their own.
- Keep severity distinguishable from *selection* — if a selected ERROR
  row can no longer be told from an unselected one, the design has
  failed.

### Exceptions and stack traces

Preserve multiline structure and monospace. Improve readability
(scrolling, wrapping, a collapsed/expanded affordance) **without altering
content semantics**. Never collapse real evidence into a generic "an
error occurred". Never render event content as HTML — it is text, always.

---

## Layout

**Desktop-first.** Optimise 1920 / 1440 / 1280; remain fully usable at
1024 / 768 / 390.

- At wide widths a side-by-side panel (Results + Inspector) is right; at
  narrow widths an overlay/drawer is acceptable. **Do not destroy desktop
  density to serve 390px.**
- **The page never scrolls horizontally.** A table, diagram or code block
  may scroll inside its own wrapper.
- When a panel opens beside content, decide *which* columns give up space
  — never let the most valuable column be the only elastic one. Give
  content a floor (a table `min-width`) rather than letting the primary
  column collapse.
- Toolbars must **wrap**, not overflow, as controls are added. Adding one
  control to a row is enough to push the page sideways at 390px; that has
  already happened here once.
- Verify at **125% and 200% zoom**; reflow, do not clip.

---

## Accessibility is a design constraint, not a later pass

Target WCAG 2.2 AA. Decide these while designing, not afterwards:

- semantic HTML first (real `<table>`, `<button>`, `<label>`)
- every control has a real accessible name
- full keyboard workflows; logical focus order; focus restored to the
  originating element when a panel closes
- **roving tabindex** for long lists — a 200-row table must never create
  200 tab stops
- state exposed semantically (`aria-selected`, `aria-current`,
  `aria-expanded`), not by styling alone
- contrast holds for *all* text, including the tertiary ramp and
  severity tints
- no colour-only meaning; respect reduced-motion
- announce meaningful changes (result counts, mode changes) without
  chatter

---

## Hard boundaries — this skill must not cross these

This skill designs the **presentation layer only**. It must never:

- **change backend semantics** — no new ordering, filtering or
  aggregation behaviour dressed up as a design change
- **invent capabilities** — the backend declares what a source can do;
  never show a control for something a source cannot support, and never
  infer capability in the frontend
- **hide security limitations** — masked values stay masked; there is
  **no reveal/unmask action, ever**; never design an affordance that
  implies raw sensitive data is retrievable
- **fabricate meaning** — never present chronology as causality, never
  invent a service/field a source did not provide, never show a metric
  not backed by real data. "Nearby chronological evidence" is honest;
  "root cause" is not.
- **sacrifice density for decorative whitespace**
- **redesign for aesthetics** where it harms workflow efficiency
- **introduce trendy patterns** without a usability benefit
- **use styling that conflicts with accessibility**
- put anything sensitive in URLs or `localStorage`; only safe,
  non-sensitive UI preferences persist

If a design idea requires crossing one of these, the correct output is to
say so and propose an alternative — not to implement it and note the
caveat afterwards.

---

## Proposal format

```
# [Surface] — design proposal — LERDESIGN-1

## Evidence this responds to
  The LERUX-1 findings/measurements being addressed. No finding, no proposal.
## The question this surface must answer fastest
## Information hierarchy
  primary / secondary / tertiary, and the treatment expressing each
## Composition
  component structure, and what is visible / one interaction away / in an escape hatch
## States
  default, hover, focus, active, selected, disabled, loading, empty, error
## Density & layout
  desktop-first behaviour, panel behaviour, narrow-width and zoom behaviour
## Design-system usage
  the exact tokens used; anything new, and why it must exist
## Four Questions impact
  WHO / WHAT / WHY / WHERE — improved, unchanged, or traded, stated honestly
## Accessibility decisions
## What this proposal deliberately does NOT change
## Verification handed to LERUX-1
  what the reviewer must measure in the rendered app to accept this
```

That last section is mandatory. A proposal that does not say how it can be
disproved is not finished.

---

## What this skill is not

- Not a diagnostic or verification tool — `LERUX-1` owns that, and owns
  acceptance of anything designed here.
- Not a branding/marketing design tool. Log Explorer's identity is
  neutral: "Log Explorer" / "Multi-Source Log Explorer", no invented
  branding, logos, affiliation or production-readiness claims.
- Not a licence to redesign broadly. Scope follows the evidence; a
  surface with no measured friction is left alone, and saying "this is
  already right" is a valid, valuable output.
