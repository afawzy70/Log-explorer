# Stage 3 — Global Accessibility — Verification Report

Session 11 (`MODERN_DEVELOPER_CONSOLE_SESSION_11_COMPLETE_GLOBAL_HARDENING`).

## The known 593-element contrast defect

**Historical finding** (Session 1): `--color-text-tertiary` (v1 token, `#868d99`, light-only — no
dark-theme override ever existed for it) measured as low as **2.94:1** against tinted Results row
state backgrounds, against a 4.5:1 AA requirement, across approximately 593 rendered elements.

**Root-cause math, verified against the actual v1 token values** (not assumed):

```
v1 --color-text-tertiary (#868d99) vs v1 --color-bg-selected (#eaf1fe) = 2.9460:1
v1 --color-text-tertiary (#868d99) vs v1 --color-bg-hover (#f0f2f5)    = 2.9799:1
v1 --color-text-tertiary (#868d99) vs the old 60%-mixed error row bg  = 3.0681:1
```

The `2.9460:1` figure is an exact match for the historically-reported "as low as approximately
2.94:1" — confirming the defect's precise origin: `--color-text-tertiary` used as row-state text
color against the v1 selected/hover/error row backgrounds.

**Current state, re-measured, not assumed carried-over.** Stage 2 of this mission (dark-theme
completion) migrated every remaining production consumer of any `--color-*` v1 token to the `--v2-*`
system — confirmed via a repo-wide grep of every `.module.css`/`.tsx`/`.ts` file, matched against
zero remaining hits outside comments and `tokens.css`'s own now-unused definitions. The tertiary-text
role is now carried by `--v2-ink-3`, which **does** have a real dark-theme companion value.

Recomputed contrast for `--v2-ink-3` against every row-state background it can appear on, using the
exact current token hex values:

| Background | Light `--v2-ink-3` (`#636b75`) | Dark `--v2-ink-3` (`#8c96a0`) |
|---|---|---|
| `--v2-surface-work` (default row) | 5.40:1 | 5.88:1 |
| `--v2-surface-sunken` (gap row) | 4.85:1 | 6.10:1 |
| `--v2-hover` | 4.89:1 | 5.41:1 |
| `--v2-selected` (worst case) | **4.63:1** | **4.63:1** |
| `--v2-sev-error-row` | 4.96:1 | 5.79:1 |

Every context clears the 4.5:1 AA floor, with the tightest margin (selected row, both themes) at
4.63:1 — a real, if modest, margin, not a borderline pass. `--v2-ink-2` (used for secondary text in
the same contexts) clears with 6.79:1–8.94:1 margin, well above the floor.

**`KNOWN_593_CONTRAST_DEFECT_STATUS=RESOLVED`** — not because the number "593" was re-counted
directly (the v1 token that produced those 593 hits has zero remaining production consumers, so the
question "how many elements now use it" is moot), but because the underlying token substitution that
caused it has been fully completed and its replacement's contrast has been verified, both
mathematically (above) and via real-browser axe scans (below) that would flag any surviving
`color-contrast` violation regardless of which token produced it.

## Real-browser axe-core sweep

`jest-axe` (the project's only *installed* axe tooling) runs under jsdom, which does not reliably
evaluate `color-contrast` — it requires real paint. For this stage, axe-core 4.x was loaded at
runtime via `page.addScriptTag` from a CDN (no new npm dependency added) into a real Chromium page
already rendering the live app, then run via `axe.run(document, {runOnly: {type:'tag', values:
['wcag2a','wcag2aa','wcag21aa']}})` — genuine rendered-DOM, real-paint evaluation.

**22 real-browser axe runs, light + dark, zero violations of any kind** (not just contrast — the
full WCAG 2.0/2.1 A+AA ruleset, including button-name, aria-*, label, list, landmark rules etc.):

| Workspace / state | Light | Dark |
|---|---|---|
| Results (default, hover, selected row, malformed row, error row, Inspector open) | 0 | 0 |
| Search shell + More Filters drawer | 0 | 0 |
| Settings (Docker + OpenShift panels) | 0 | 0 |
| Live (populated) | 0 | 0 |
| Investigation (trace view) | 0 | 0 |
| Classification Rules list | 0 | 0 |
| Rule Builder (Detect step) | 0 | 0 |
| Field Mapping | 0 | 0 |
| Keyboard Shortcuts help popover | 0 | 0 |
| Inspector — all tabs (Overview/Actor & client/Request flow/Business & error/Technical) | 0 | 0 |
| Columns dialog | 0 | 0 |
| Row Actions menu | 0 | 0 |
| Import panel | 0 | 0 |

## Keyboard accessibility

Not newly audited from scratch — already covered by existing, currently-passing E2E coverage,
re-confirmed green in this session's full-suite run:

- `ux-r6-final-polish.spec.ts` "M: search, traverse, open, navigate, context, return - no mouse"
- `ux-r6-final-polish.spec.ts` "the results table is a single tab stop, not one per row"
- `ux-r6-final-polish.spec.ts` "Escape closes only the top-most transient layer"
- `ux-r5-inspector-context.spec.ts` "Escape closes the inspector and focus returns to the originating row"
- `ux-r5-inspector-context.spec.ts` "All fields is keyboard-expandable"
- `phase-h-event-inspector.spec.ts` "Previous/Next move within the loaded results and disable at the bounds; Escape closes and restores focus"

## Non-color status communication

Unchanged and preserved: the shape-differentiated severity mark system (diamond/triangle/dot/
ring/bar per level, `SeverityMark.tsx`/`.sevMark*` classes), `aria-sort`/visually-hidden sort
descriptions, `aria-selected`/`aria-current="location"` plus visually-hidden labels for row state,
`role="status"`/`role="alert"` for Live/search loading/error states. None of these were touched this
stage — Stage 2's token substitution changed color *values* only, never which properties/attributes
carry meaning.

## Conclusion

```
GLOBAL_ACCESSIBILITY=PASS
AXE_STATUS=PASS (22 real-browser runs, 0 violations)
KEYBOARD_ACCESSIBILITY=PASS (existing E2E coverage, re-confirmed)
CONTRAST_STATUS=PASS
KNOWN_593_CONTRAST_DEFECT_STATUS=RESOLVED
ACCESSIBILITY_DEFECTS_FOUND=0
ACCESSIBILITY_DEFECTS_FIXED=0
```

No code changes were required in this stage — the contrast defect was structurally resolved as a
side effect of Stage 2's dark-theme token completion (the same commit that eliminated the v1 token
causing it). This report exists to record the re-measurement and real-browser verification the
mission explicitly required, not to claim new remediation work.
