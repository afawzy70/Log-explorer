# OLD Log Explorer UI — owner-supplied visual reference

`old-01.jpg` through `old-19.jpg` are owner-supplied screenshots of the
**OLD** Log Explorer application, and `current-new-ui.jpg` is one
owner-supplied screenshot of the **current/NEW** application, provided
during the September 2026 UX restoration review as the authoritative
visual/workflow baseline for this project's Legacy Remediation UX
restoration mission.

## What these are

These are photographs of a screen (not clean digital screenshots — some
rotation/moiré is visible), supplied as-is by the product owner and kept
here unmodified (no recompression, no cropping) so future work always has
the real reference, not a paraphrase of it. A per-image forensic
breakdown (what each one shows, and how it compares to the current app)
lives in
[`docs/verification/OLD_UX_RESTORATION_AUDIT.md`](../../verification/OLD_UX_RESTORATION_AUDIT.md).

## What these are authoritative for

- Interaction model, navigation, information hierarchy, and workspace
  composition of the OLD application.
- Concrete UI text, grouping, and control layout the OLD application
  actually shipped with.

## What these are **not** permission for

- **Not permission to restore old technical defects.** NEW security,
  correctness, architecture, performance, and reliability remain the
  authoritative *technical* baseline — see `CLAUDE.md` for the
  non-negotiable rules that apply regardless of what these screenshots
  show.
- **Not a pixel-exact template.** The goal is restoring OLD's UX
  *strengths* (density, clarity, discoverability, investigation
  workflow), not literally reproducing every OLD screen unchanged.
- Any place OLD's screenshots show behavior that conflicts with a
  security or correctness invariant this project has since established
  (for example: OLD's dev-gated "unmask sensitive values" capability,
  visible in `old-02.jpg`/`old-03.jpg`/`old-04.jpg`) — the deviation from
  OLD is **intentional** and must stay documented as such, never quietly
  restored.

## Index

| File | Shows |
|---|---|
| `old-01.jpg` | Search workspace, empty state, active-filter chips with individual remove (✕) + "Clear all" |
| `old-02.jpg`, `old-03.jpg` | Settings — Local Docker connection, sensitive-data masking policy panel, "Show sensitive values (unmask)" (dev-only capability — see the "not permission" note above), keyboard-shortcuts popover |
| `old-04.jpg` | Settings — Remote Docker connection fields |
| `old-05.jpg`, `old-06.jpg` | More Filters drawer — Who/customer, Request flow, What happened, Client context groups, with per-field match-type labels (EXACT MATCH / SUBSTRING) |
| `old-07.jpg`, `old-08.jpg`, `old-09.jpg` | Advanced query — no-code condition builder, text query editor |
| `old-10.jpg`–`old-15.jpg` | Results table + selected row + Event Inspector (Overview / Actor & client / Request flow / Business & error / All fields tabs), Previous/Next navigation |
| `old-16.jpg` | Context / surrounding logs (±30s) view — event/service/error counts, duration, observed-sequence disclaimer |
| `old-17.jpg` | Results table, full width, no selection — Correlation/Trace column, Reset order/Refresh |
| `old-18.jpg` | Columns customization popover |
| `old-19.jpg` | Row actions menu (minimal: View details, Show surrounding logs) |
| `current-new-ui.jpg` | Current/NEW application, results + inspector, for direct comparison |
