# Stage 5 — Global Visual / Interaction Consistency — Verification Report

Session 11 (`MODERN_DEVELOPER_CONSOLE_SESSION_11_COMPLETE_GLOBAL_HARDENING`).

**Explicitly not the Impeccable/PR #58 fidelity audit** (Owner Requirement §29, deliberately deferred
to a separate later mission). This stage only checks that the *production* workspaces are internally
coherent with each other — one product, not a collection of screens.

## Method

Reviewed Search, Results, Inspector, Investigation, Settings, Field Mapping, Classification Rules,
Rule Builder, and Live against each other, using the extensive real-browser evidence already gathered
across Stages 2–4 this session (light+dark screenshots at every required width) plus targeted
follow-up checks on specific grammar elements named in the mission's own audit list.

## Confirmed consistent (no change needed)

- **Workspace header/trail pattern**: every non-Search workspace (Settings, Classification Rules,
  Rule Builder, Field Mapping, Live, Investigation) uses the identical "← Back to search results" +
  workspace title pattern in the same position, confirmed across every screenshot captured this
  session in both themes.
- **Primary/secondary/ghost button grammar**: one shared `Button` component (fully v2 as of Stage 2),
  used identically everywhere — solid accent-teal primary ("Search", "Save mapping", "New rule"),
  bordered neutral secondary ("Test Connection", "Import…"), borderless ghost (toolbar icon buttons).
- **Severity iconography**: the same shape-differentiated mark family (diamond/triangle/dot/ring/bar)
  appears in Results' Time-cell gutter and Live's Time cell via the same reusable `SeverityMark`
  component — confirmed by code (both consume `shared/ui/SeverityMark.tsx`) and by screenshot.
- **Tag chip grammar**: `shared/ui/TagChip.tsx`'s tinted-pill + hue-dot + neutral-text pattern is the
  only tag rendering path in the app (Results' Tags column, Live's Tags column, Inspector's
  Classification section, Classification Rules list all route through it or `tagColorsOf`).
- **Monospace usage**: trace/span/correlation IDs, timestamps, and JSON/raw values consistently use
  `var(--font-mono)` across Results, Live, Investigation, and Inspector's Technical/All Fields tab.
- **Dialog/popover chrome**: Columns, Keyboard Shortcuts, Actions menu, and Advanced Filters/Query
  Builder popovers all share the same `--v2-surface-raised` background, `--v2-bw`/`--v2-line` border,
  `--v2-r-md`/`--v2-r-lg` radius, and `--v2-shadow-pop` elevation (confirmed by reading each module's
  CSS, not just by eye).

## Found and fixed

**Live's table row density didn't match the rest of the product's default density.** Results'
default (non-compact) table and Investigation's `SequenceTable` both use `padding: var(--space-2)
var(--space-3)` for cells. Live's table used `padding: var(--space-1) var(--space-2)` — Results' own
*compact*-density value — with no stated reason and no density toggle of its own, so Live rendered
visibly more cramped than every other table in the product by default, not as a deliberate,
documented choice (checked: no comment anywhere in `LiveTailPanel.module.css` explaining it as
intentional). Fixed by matching Live's cell padding to the shared default. Re-verified: `npm run
typecheck` clean, `LiveTailPanel` unit suite (114 tests) and both Live E2E specs (16 tests, incl. the
scroll-geometry-dependent "Follow newest" test) still green after the row-height change, and a fresh
screenshot confirms the new spacing visually matches Results/Investigation.

## Reviewed, not changed (documented reasoning)

**Empty-state layout differs between `ResultsPanel`'s `.statePanel` (icon beside text, grid layout,
solid border) and `ClassificationRulesList`'s `.emptyState` ("No classification rules yet.", icon
above text, flex-column layout, dashed border).** Investigated and left alone: these are not
unambiguously "the same pattern implemented twice" — a dashed border is a defensible, common
convention specifically for a "nothing created yet, here's how to create one" call-to-action state
(Classification's case), distinct from a solid-border "your query returned nothing" informational
state (Results' case). The design reference's own §340 State Panel definition ("centred... a 20px
icon, a title, one explanation line") doesn't literally match either production implementation
exactly, so there is no unambiguous canonical layout to enforce here without risking the "arbitrary
aesthetic churn" this stage is explicitly warned against. Recorded for whoever runs the separate
Impeccable/PR #58 fidelity audit (Owner Requirement §29) to resolve with the actual design reference
in hand, rather than guessed at here.

## Product mental model

Preserved, unaffected by this stage: Search finds events, Inspector explains one event, Investigation
shows multi-event chronological/contextual relationships, Live observes incoming events. No causal
language was found or introduced — Investigation's own copy still states "Ordered by timestamp — this
does not indicate causality between events" (confirmed via screenshot this session).

## Conclusion

```
GLOBAL_VISUAL_CONSISTENCY=PASS
VISUAL_CONSISTENCY_DEFECTS_FOUND=1 (Live table row density mismatch)
VISUAL_CONSISTENCY_DEFECTS_FIXED=1
```
