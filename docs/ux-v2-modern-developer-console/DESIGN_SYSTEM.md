# Design System — Modern Developer Console

This is the design proposal for owner-approved Direction B. It was written by LERDESIGN-1 and has not been
implemented in production. **Owner visual approval is required before any production work.**

- Functional baseline: latest `main` `6e71af8d901418d65de2bebb472240db27779147` (after PR #59 **and** PR #60).
  Earlier passes used `51f06e5` and `3f6b1b4`. **§22 is the current truth for classification**; §21 is kept as the
  PR #59 record and is superseded where the two disagree (§22.10). §9 records the source-selector policy.
- Reference implementation: the isolated prototype in [`prototype/`](prototype/). Tokens are in
  `prototype/styles/tokens.css` and components in `prototype/styles/app.css`.
- Related documents: [`MOTION_SYSTEM.md`](MOTION_SYSTEM.md), [`COMPONENT_INVENTORY.md`](COMPONENT_INVENTORY.md),
  [`VISUAL_TREATMENT_COMPARISON.md`](VISUAL_TREATMENT_COMPARISON.md), [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

Root `DESIGN.md` still documents the production baseline. It is replaced only after owner visual approval, so the
repository never describes a look that is not shipped.

---

## 1. Philosophy — a calibrated investigation instrument

Log Explorer is used for long, time-pressured sessions: incident calls, screen-sharing, and comparing IDs across
services. The design treats the product as **one instrument**, not a dashboard and not a collection of screens. The
grammar comes from logic analyzers and oscilloscopes:

| Instrument idea | Log Explorer meaning | Where it shows |
|---|---|---|
| Samples on one time axis | Every event is a row keyed by a precise timestamp | Results, Live, capture sequence tables |
| **Trigger** | The event you selected. It anchors everything that follows. | A ring around the severity mark in the row, the crosshair in the Inspector title, the selected-event line and flag in every capture |
| Capture window | Trace, Journey or ±30 s Surroundings around the trigger | Investigation and Context workspaces |
| Channels / lanes | Services | Timeline lane labels with swatches (always named) |
| Gap bands | Intervals with no observed events. Not failures. | Hatched bands on the ruler plus gap rows |
| Acquisition state | Live: LIVE, PAUSED, RECONNECTING, STOPPED, FAILED | Live mode bar |

**Principles**

1. **Density with calm.** Many rows per screen, one quiet surface, hairline structure, no card clutter.
2. **One signal accent.** The accent means trigger, selection, focus and the primary action. It is not used for
   decoration, category colour or ordinary links in data cells.
3. **Severity is a calibrated mark plus a word.** It is never colour alone, and it never outshouts the message.
4. **Truth over polish.** Nothing implies capability, causality, completeness or liveness that the backend does not
   declare. Every capture says that order is not causality.
5. **Three modes that read as three modes.** Search, Inspector and Investigation have distinct composition, and the
   same trigger ties them together.
6. **Borders before shadows. Words before icons.** Shadows mark only layers above the page. Every icon-only control has
   an accessible name and a tooltip.
7. **Functional behaviour is never lost** (`FUNCTIONAL_BEHAVIOR_LOSS_ALLOWED=NO`). The inventory is the checklist.

### 1.1 The three product modes

| Mode | Job | Composition | Chrome |
|---|---|---|---|
| **Search** | Find events | Query bar → scope strip → results table (sticky header and Time column) | Full query bar (44 px) plus scope strip (32 px) |
| **Inspector** | Understand one event | 500 px docked probe on the right, the five fixed tabs on one row, a trigger mark in the title | Search chrome stays. The table narrows its identity columns first. |
| **Investigation** | Follow related events | Mode bar ("Back to search results", relation, ID, Copy) → stat row → timeline plot → sequence table | A compact scope bar replaces the query bar. The note says the search is kept for Back. |

Context (Surroundings), Field mapping, Settings and Live are **workspaces**. Each takes over the results column with
the same mode-bar grammar, and each has a contextual Back.

---

## 2. Colour

### 2.1 Semantic token vocabulary

Components read **semantic tokens only**. Four value sets implement the vocabulary: B1 light, B1 dark, B2 and B3.

| Group | Tokens | Role |
|---|---|---|
| Ground | `--bg-app` | Behind workspaces |
| Surfaces | `--surface-shell` `--surface-bar` `--surface-work` `--surface-inspector` `--surface-capture` `--surface-raised` `--surface-sunken` `--surface-code` | Shell; query bar and table header; table and panels; Inspector; capture plot area; popovers; wells and chips; JSON and stack traces |
| Lines | `--line-subtle` `--line` `--line-strong` `--ruler` | Row separators; region borders; emphasis borders; tick scales |
| Control boundary | `--control-border` | Inputs, selects, checkboxes, radios, the switch-off track, secondary buttons. ≥ 3:1 against every surface they sit on (WCAG 1.4.11). |
| Ink | `--ink-1` `--ink-2` `--ink-3` `--ink-disabled` `--ink-inverse` | Primary text; secondary; tertiary meta (still ≥ 4.5:1); disabled controls only; text on accent |
| Accent | `--accent` `--accent-hover` `--accent-ink` `--accent-tint` `--accent-tint-strong` `--focus` `--trigger-line` | Primary button, trigger, focus ring, active tab/segment indicator; accent-coloured text; selection and trigger tints |
| States | `--hover` `--selected` `--selected-hover` | Row and item states |
| Severity | `--sev-{error,warn,info,debug,trace}` (word), `--sev-*-mark` (shape), `--sev-error-row` | Level word, level mark, ERROR row wash |
| Status | `--success` `--warning` `--danger` (plus `-tint`), `--danger-line`, `--neutral-tint` | Health, readiness, banners, destructive actions |
| Privacy | `--masked` `--masked-tint` | Masked values and "Protected" tags |
| Elevation | `--shadow-pop` `--shadow-sheet` `--scrim` | Popovers; overlay sheet; scrim under the sheet |
| Lanes | `--lane-1` … `--lane-7` | Service swatches in captures. They avoid severity hues (red, orange, amber) and the accent. Always paired with the service name. |

### 2.2 B1 Instrument Neutral — light (recommended primary)

| Token | Value | Token | Value |
|---|---|---|---|
| bg-app | `#eceef1` | ink-1 | `#14181d` |
| surface-shell / bar | `#f9fafb` | ink-2 | `#48505a` |
| surface-work / raised | `#ffffff` | ink-3 | `#636b75` |
| surface-inspector | `#f7f8fa` | accent | `#0b6975` |
| surface-capture | `#f3f5f7` | accent-ink | `#0a5e69` |
| surface-sunken / code | `#f1f3f5` / `#f4f6f8` | accent-tint / strong | `#e3f0f1` / `#cfe5e7` |
| line-subtle / line / strong | `#e6e9ed` / `#d6dbe1` / `#adb5bf` | control-border | `#808993` |
| sev-error / mark / row | `#b42318` / `#d92d20` / `#fdf3f2` | sev-warn / mark | `#8a5300` / `#b06d05` |
| sev-info / mark | `#2c5d95` / `#4a7fbd` | sev-debug / mark | `#5d6670` / `#8c949c` |
| sev-trace / mark | `#6a5a8c` / `#9d8fbd` | success / warning / danger | `#1d7042` / `#8a5300` / `#b42318` |

### 2.3 B1 dark companion

This is a defined set, not an inversion.

| Token | Value | Token | Value |
|---|---|---|---|
| bg-app | `#0e1114` | ink-1 / 2 / 3 | `#e5e9ed` / `#aeb6bf` / `#8c96a0` |
| surface-work | `#15191d` | accent / accent-ink | `#4fb3bd` / `#7ccbd2` |
| surface-inspector | `#191e23` | accent-tint | `#173034` |
| line / line-strong | `#2c343c` / `#46515c` | control-border | `#707b86` |
| sev-error / mark / row | `#f28b82` / `#ef6a60` / `#231718` | sev-warn / mark | `#e2ad57` / `#d69a3a` |
| sev-info / mark | `#86ade0` / `#6d99d2` | focus | `#6cc3cb` |

### 2.4 B2 Night Bench (dark-first) and B3 Enterprise Workbench

| Token | B2 | B3 |
|---|---|---|
| bg-app / surface-work | `#0b0e10` / `#12171a` | `#efede9` / `#ffffff` |
| surface-shell | `#0f1316` | `#22262b` (dark shell, `--shell-ink #eef0f2`) |
| ink-1 / 2 / 3 | `#e3e8eb` / `#a8b3ba` / `#88949c` | `#1c1b19` / `#4c4943` / `#66625b` |
| accent / accent-ink | `#5cc7b8` / `#86d9cd` | `#3949a8` / `#34439c` |
| line / control-border | `#28323a` / `#6e7b86` | `#dcd8d1` / `#857e73` |
| sev-error / mark | `#ff8f85` / `#f46b61` | `#b3261e` / `#d13b30` |
| sev-warn / mark | `#e8b35c` / `#d99d3c` | `#875300` / `#ad6c0c` |
| radii sm / md / lg | 3 / 4 / 6 px | 4 / 6 / 8 px |

### 2.5 Computed contrast (WCAG 2.x relative luminance)

Each cell lists four backgrounds in this order: work / inspector / selected tint / ERROR row.

| Pair | B1 | B1 dark | B2 | B3 | Requirement |
|---|---|---|---|---|---|
| ink-1 | 17.8 / 16.8 / 15.3 / 16.4 | 14.5 / 13.8 / 11.4 / 14.3 | 14.6 / 13.9 / 11.4 / 14.5 | 17.2 / 16.5 / 14.9 / 15.8 | 4.5 |
| ink-2 | 8.2 / 7.7 / 7.0 / 7.5 | 8.6 / 8.2 / 6.8 / 8.5 | 8.4 / 8.0 / 6.6 / 8.4 | 9.0 / 8.6 / 7.8 / 8.2 | 4.5 |
| ink-3 | 5.4 / 5.1 / 4.6 / 5.0 | 5.9 / 5.6 / 4.6 / 5.8 | 5.8 / 5.5 / 4.5 / 5.8 | 6.1 / 5.8 / 5.2 / 5.6 | 4.5 |
| accent-ink | 7.5 / 7.0 / 6.4 / 6.8 | 9.5 / 9.1 / 7.5 / 9.4 | 11.0 / 10.5 / 8.6 / 11.0 | 8.6 / 8.3 / 7.5 / 7.9 | 4.5 |
| sev-error word | 6.6 / 6.2 / 5.6 / 6.0 | 7.4 / 7.0 / 5.8 / 7.3 | 8.2 / 7.8 / 6.4 / 8.1 | 6.5 / 6.3 / 5.7 / 6.0 | 4.5 |
| sev-warn word | 6.3 / 6.0 / 5.4 / 5.8 | 8.7 / 8.3 / 6.9 / 8.6 | 9.5 / 9.0 / 7.4 / 9.4 | 6.4 / 6.2 / 5.6 / 5.9 | 4.5 |
| sev-error mark | 4.83 / 4.55 / 4.14 / 4.44 | 5.81 / 5.51 / 4.57 / 5.72 | 6.12 / 5.83 / 4.79 / 6.09 | 4.80 / 4.60 / 4.15 / 4.40 | 3.0 (graphic) |
| sev-warn mark | 4.17 / 3.92 / 3.57 / 3.83 | 7.19 / 6.83 / 5.66 / 7.08 | 7.60 / 7.24 / 5.94 / 7.56 | 4.26 / 4.09 / 3.69 / 3.91 | 3.0 |
| sev-info mark | 4.15 / 3.90 / 3.56 / 3.81 | 6.00 / 5.70 / 4.73 / 5.91 | 6.29 / 5.99 / 4.92 / 6.26 | 4.00 / 3.83 / 3.46 / 3.67 | 3.0 |
| control-border | 3.55 / 3.34 / 3.04 / 3.26 | 4.09 / 3.89 / 3.23 / 3.67 | 4.16 / 3.96 / 3.26 / 3.75 | 4.02 / 3.85 / 3.48 / 3.68 | 3.0 (UI component) |
| focus ring | 6.38 / 6.00 / 5.47 / 5.86 | 8.67 / 8.24 / 6.83 / 8.54 | 10.36 / 9.87 / 8.11 / 10.31 | 7.80 / 7.48 / 6.75 / 7.16 | 3.0 |
| Primary button text | 6.38 | 7.16 | 8.87 | 7.80 | 4.5 |

Review fixes recorded here:
- The first pass had B1 warn mark `#c97d0a` at 2.80:1 on the selected tint. It is now `#b06d05`.
- B3 warn mark `#c47d12` was 2.89:1. It is now `#ad6c0c`.
- B2 and B1-dark control borders were 2.99–3.00:1 on the selected tint. They are now `#6e7b86` and `#707b86`.
- Before `--control-border` existed, borders used `--line` (≈ 1.4:1), which failed 1.4.11.

`--ink-disabled` is used only for disabled controls, which WCAG exempts, and never for information.

---

## 3. Typography

| Family | Use | Features |
|---|---|---|
| **Inter** (variable, self-hosted, OFL) | All UI, labels, messages | `tnum` tabular numerals, `cv11` single-storey a, `ss03` |
| **JetBrains Mono** (variable, self-hosted, OFL) | Timestamps, IDs, paths, JSON, stack traces, query syntax only (CLAUDE.md §7) | `zero` slashed zero, `calt 0` (no ligatures in data) |

Fallbacks are `Segoe UI Variable`, `Segoe UI`, system-ui for UI text and `ui-monospace`, `Cascadia Mono`, `SF Mono`,
Consolas for data.

Why Inter, even though the detector flags it as overused? Its tabular numerals and disambiguation features (I/l/1)
matter for comparing IDs. Its x-height stays legible at 12–13 px dense rows. It is familiar in engineering tools, and
the instrument character comes from the grammar, not the face. This was triaged individually (§20), not suppressed.

| Token | Spec | Use |
|---|---|---|
| `--text-title` | 600 20/26 | Workspace page title (Settings, Field mapping) |
| `--text-workspace` | 600 16/22 | Mode heading, Inspector event title (2 lines max) |
| `--text-section` | 600 13/20 | Section heading in a panel |
| `--text-body` / `--text-message` | 400 13/20 | UI text, log messages |
| `--text-body-strong` | 550 13/20 | Field names, row titles |
| `--text-label` | 500 12/16 | Control labels, chips, column headers |
| `--text-meta` | 400 12/16 | Counts, help, secondary lines |
| `--text-caps` | 600 11/16, +0.06 em, uppercase | Timeline axis labels and inline mode words only (e.g. EXCLUDING) |
| `--text-data` | 400 12/18 mono | Timestamps, IDs, paths |
| `--text-code` | 400 12/19 mono | JSON, stack traces |

The rules:
- **No text below 11 px anywhere.** 11 px is reserved for caps and severity words.
- Column headers are sentence case at 12 px/600 in `--ink-2`, so long names ("User / Customer", "Correlation /
  Trace") fit without clipping.
- Messages are never monospace.
- Long identifiers use a middle ellipsis (`4bf92f35…4736`), so both ends stay comparable. The full value is in the
  Inspector and in the accessible name.
- Dotted names (loggers, exception classes) break only after a dot (`<wbr>`), never mid-word.

---

## 4. Spacing

A 4 px base with 2 px half-steps for dense rows: `--sp-0-5 2`, `--sp-1 4`, `--sp-1-5 6`, `--sp-2 8`, `--sp-3 12`,
`--sp-4 16`, `--sp-5 20`, `--sp-6 24`, `--sp-8 32`.

- Cell padding is 8 px horizontally.
- Panel gutter is 16 px, workspace gutter 20 px.
- Section gaps are 12–16 px.
- Nothing uses arbitrary pixel values in components. Exceptions that exist for geometry (column widths, the 22 px
  signal gutter) are tokens or column classes.

## 5. Density

| Token | Value | Baseline on `main` |
|---|---|---|
| `--h-shell` | 44 px | 62 px |
| `--h-querybar` | 44 px | 62 px (+ 25 px filters row) |
| `--h-scope` | 32 px (chips, readout, sort, Columns, Query details, Refresh) | — |
| `--h-row` compact (default) | 28 px | 45 px |
| `--h-row-comfortable` | 34 px | — |
| `--h-row-header` | 30 px | 34 px |
| `--h-control` / `-sm` | 30 / 24 px | ~36 px |
| `--w-gutter` | 22 px signal gutter in the Time cell | — |
| `--w-inspector` | 500 px at every docked width (≥ 1366 px) | 420 px |

The prototype was measured with Playwright (`deviceScaleFactor 1`):
- **26 fully visible rows** at 1440×900, both with and without the Inspector. The baseline shows 13 and 12.
- 31 rows at 1920×1080.
- 22 rows at 390×844.
- No page overflow at any of these sizes.

Compact is the proposed default. **This is a presentation-default change flagged for the owner** (D1). Comfortable
stays one click away in Columns.

## 6. Radii

`--r-xs 2 px` (marks, tags, bars) · `--r-sm 3 px` (buttons, inputs, chips) · `--r-md 4 px` (menus, popovers,
segmented groups, panels) · `--r-lg 6 px` (dialogs, sheets) · `--r-full 999 px` (switch track, count badge, status
dot). B3 raises sm/md/lg to 4/6/8 px. There are no pills for filters or severity.

## 7. Border and elevation

- **Hairlines carry structure.**
  - `--line-subtle` for row separators.
  - `--line` for region borders.
  - `--ruler` for tick scales.
  - `--control-border` for interactive boundaries.
- **Elevation is only for layers above the page.**
  - Popovers: `--shadow-pop`.
  - The Inspector sheet under 1280 px and dialogs: `--shadow-sheet` plus `--scrim`.
  - The docked Inspector and panels have borders and no shadow.
- There are no side stripes, no gradients as decoration, and no glass. The hatched gap band is a data encoding (an
  interval with no observed events), not ornament.

## 8. Iconography

- **Lucide** (ISC licence): one outline set at `--icon-stroke 1.75`.
- Sizes: `--icon-sm 14`, `--icon-md 16`, `--icon-lg 20`.
- The prototype sprite has 68 symbols.
- Icons replace every Unicode glyph on `main` (`🕐 ⌨ ⓘ … ✕ ↻ ⠿ ▲ ▼ ↕ ⚠`).

Rules:
- An icon sits next to a word in navigation and primary actions.
- Icon-only buttons (Close, prev/next, Refresh, row Actions, reorder) have `aria-label` and a tooltip.
- Icons are `aria-hidden`.
- The crosshair icon is reserved for the trigger. Nothing else uses it.

## 9. Controls

| Control | Spec |
|---|---|
| **Source field** | A **native `<select>` styled as a field** (register SSEL-2: OpenShift Loki must stay a native disabled option, so the control is not replaced with a custom listbox). Options follow the fixed policy order **Local Docker → OpenShift → OpenShift Loki — Not available**; the unavailable option is `disabled`, in `--ink-3`, with no health dot, icon or “Coming soon” wording, and cannot be chosen by mouse or keyboard. Docker is selected first when available, then OpenShift. The health dot and word sit **in the field beside the value**, not inside the options, and the health segment opens **Source health details** (state 27). For OpenShift the adjacent scope field reads Namespace › workload and opens the scope selector. State 40 draws the open list as an approximation of the browser-rendered list. |
| **Field button** (Source, Project, Time, Services, Severity) | 30 px; `--surface-work`; `--control-border`; optional small key word in `--ink-3` and value in `--ink-1`; trailing chevron. Source carries a health dot and word. Loki shows a locked Namespace field. |
| **Search input** | Flexible width; leading search icon; `/` key hint; ID detection prompt below as a popover (unchanged behaviour). |
| **Primary button** | Accent fill with inverse text. **Search** is the only filled control in the query bar. While running it shows a spinner and the label "Searching…". |
| **Secondary** | `--surface-work` with `--control-border`. **Ghost**: no border; hover wash. **Danger**: danger text and line, e.g. Disconnect. |
| **Segmented** | 24 px items in a sunken group; the pressed item gets a work surface and 1 px line, with `aria-pressed`. Used for Include/Exclude and density. |
| **Checkbox / radio / switch** | `--control-border` when off, accent when on. A switch always has its state word next to it (Masked / Unmasked). |
| **Services** | The popover has **Include selected / Exclude selected**, a helper sentence, a running/total count, and Clear. Trigger labels: `All services`, `payments-api`, `3 services`, `All except 2`, and `All services except N` in summaries. The EXCLUDE chip starts with the caps word **EXCLUDING** on a warning tint. The word carries the meaning, not the colour. |
| **Severity** | A popover with All, Errors only and five level rows (mark + word + checkbox). The field value shows the active marks followed by the words (e.g. "Info, Warn, Error"). **All levels** and **Errors only** also stay one click away as a compact segmented control at the start of the scope strip, so the baseline's one-click quick actions are not lost (D16). |
| **More filters** | A full-width panel under the query bar: four group columns, an Advanced query row (Guided / Text, plus **Raw LogQL** only for a Loki source that enables it, with the expert note and bounds note), and a footer with Reset / Cancel / Apply. Values stay drafts until Apply. |
| **Time** | A preset menu plus **Custom…**, which opens a temporary dialog with Start / End (prefilled End = now, Start = End − preset), the zone `Asia/Kuwait (UTC+03:00)`, and Cancel / Apply. An applied custom range shows the **actual interval** in the field, and the chip adds the zone (states 32 and 33). |
| **Compact scope bar** (Investigation, Context, Live) | Read-only Source (with health), Project, Time and Services fields, a note on what is kept, and **Edit search**, which reopens the full query bar (D15). Live shows its own effective scope. |
| **ID detection** | A strip under the query bar: "This looks like a Trace ID. Search as Trace ID instead?", with **Search as Trace ID** and Dismiss (Esc) (state 36). |
| **Row actions menu** | View details (Enter), Show surroundings (X; hidden when the source lacks context, D4), separator, then Copy for each non-sensitive identifier present (state 35). |

## 10. Tables

These are the invariants from CLAUDE.md §4, carried unchanged:
- One `<table>` and one `<colgroup>`, with `table-layout: fixed`.
- Seven columns in order.
- `—` for missing values.
- Header and cell alignment ≤ 2 px.
- Horizontal scroll contained in `.table-wrap`.

Design rules:

| Aspect | Rule |
|---|---|
| **Header** | Sticky top; `--surface-bar`; sentence case 12 px/600 in `--ink-2`; a sort indicator icon on Time. |
| **Time column** | Sticky left, so the timestamp stays visible while scrolling horizontally. Uses `--text-data`; the date is in `--ink-3`, the clock in `--ink-1`. A 22 px signal gutter holds the severity mark and, on the trigger row, the trigger ring. |
| **Widths at 1440** | Time 178 · Level 70 · Service 140 · What happened flexible · User/Customer 150 · Correlation/Trace 146 · Actions 44. With the Inspector: Service 118 · User 116 · Correlation 128, so the message keeps the most room. |
| **Level** | The word at 11 px/600. Only WARN and ERROR words take severity colour; INFO is `--ink-2`, and DEBUG and TRACE are `--ink-3`. |
| **Severity marks** | ERROR ◆ diamond · WARN ▲ triangle · INFO ● dot · DEBUG ○ hollow dot · TRACE – dash. The shape alone distinguishes levels. |
| **ERROR row** | A faint `--sev-error-row` wash. No side stripe. |
| **User / Customer** | "User" key in `--ink-3`, then the value exactly as served. Masked values in `--masked` mono. No reveal. |
| **Correlation / Trace** | A mono middle-ellipsis ID in `--ink-1`. Accent and underline appear only on hover or focus, because the accent is not category colour. |
| **What happened** | The message only. Malformed lines show a dashed "Malformed" tag plus the raw line in mono. An empty message shows "(empty message)" in muted italics. |
| **Actions** | A ghost icon button (…), the seventh cell of the same row. |
| **Gap rows** (Context and captures, existing behaviour) | 26 px, sunken, dashed bottom border, with a timer icon and the text "Gap detected — 6.635 s with no observed events (a → b)". |
| **Load more** | A single footer row button with "Loading…" and a retry state. Rows are kept on failure. |

**Row-state precedence** (flat specificity, in this order): hover < ERROR wash < selected < selected:hover < trigger.

| State | Visual | ARIA |
|---|---|---|
| Hover | `--hover` wash | — |
| Selected (inspected) | `--selected` tint plus accent hairlines top and bottom | `aria-selected="true"` |
| Trigger | A 1.5 px accent ring around the severity mark in the gutter, plus trigger hairlines. Visually hidden text "Selected event" in the Time cell. In Search the selected row is the trigger; in captures and Context the root event is. | `aria-current="location"` |
| Keyboard focus | 2 px `--focus` hairlines top and bottom (roving tabindex) | — |
| Stale (re-search running; Live reconnecting or failed) | Row text switches to `--ink-3` (still ≥ 4.5:1 on every row surface) until results land. Opacity is not used, because it broke text contrast (**interaction change flagged**, D2) | `aria-busy` on the table |

## 11. Tabs

- The five Inspector tabs are fixed, **never hidden**, always in this order: **Overview · Actor & client · Request
  flow · Business / error · Technical / all fields**.
- Underline tabs 34 px tall at 12.5 px/500. The active tab is `--ink-1` with a 2 px accent underline.
- They fit on one row at 500 px.
- A tab whose section has no data for this event shows a hollow dot plus visually hidden text "no data". It is still
  selectable and shows an explicit empty message.
- `role="tablist"`, roving tabindex, arrow keys. Reset to Overview on a new selection (existing behaviour).

## 12. Chips and badges

| Kind | Spec |
|---|---|
| **Filter chip** | 22 px, sunken, `--line-subtle`, key in `--ink-2` and value in `--ink-1`, remove × (18 px target inside a 22 px chip; the chip row is also operable through Clear all). Ellipsis on overflow, full text in the accessible name. |
| **EXCLUDING chip** | Warning tint plus the caps word "EXCLUDING" plus the list, or "All services except N" beyond three. |
| **Protected chip** | The value is the word "Protected" in `--masked`, never the raw value. |
| **Tag** | 18 px, `--r-xs`, 11 px/600: `Malformed` (dashed), `Selected event` (accent fill, used only on capture flags), neutral, trace `T1`. |
| **Status tag** (mapping) | 22 px. Icon **and** border style differ, not just colour: Verified = shield-check icon, solid border; Unverified = dashed circle, dashed border; Needs change = triangle-alert, warning tint. "Not mapped" is derived text, not a fourth persisted status. |
| **Scope tag** (settings) | "All sources" (accent tint) vs "Docker source only" or "OpenShift API and Loki" (neutral). |
| **Count badge** | 18 px, `--r-full`, accent fill. Used only on Filters / Services triggers. |

## 13. Panels

| Kind | Spec |
|---|---|
| **Workspace panel** (Settings) | `--surface-work`, `--line`, `--r-md`, a head with an h2, scope tag and right-aligned meta; body padding 12/16. |
| **Popover** | `--surface-raised`, `--line`, `--r-md`, `--shadow-pop`, 120 ms pop-in. Esc, outside click and focus return (`usePopoverTrigger` / `useDismissableLayer`, unchanged). |
| **State panel** (empty, error, unavailable, invalid query, startup, gate) | Centred in the results column, max 520 px: a 20 px icon, a title (`--text-section`), one explanation line, at most two actions. The title and detail never repeat each other. |
| **Banner** | A full-width strip inside a panel or under the query bar (`.qb-gate` for the mapping-not-ready search gate). Warning tint, icon plus words. |

## 14. Code and JSON

- `pre.code`: `--text-code` on `--surface-code` with a `--line-subtle` border and `--r-sm`.
- JSON highlighting stays restrained:
  - keys in `--accent-ink`
  - strings in `--ink-1`
  - numbers in `--sev-info`
  - punctuation in `--ink-3`
- Stack traces in the Inspector wrap (`pre-wrap`, break after `.` or `$`) so no frame is hidden off the right edge.
- Sample JSON in the mapping evidence panel scrolls horizontally, has a max height, and shows a visible scrollbar.
- All rendering is text; there is no `dangerouslySetInnerHTML` (CLAUDE.md §2.3).

## 15. Focus

- `:focus-visible` shows a 2 px `--focus` outline with 2 px offset on every control, or inset hairlines inside table
  rows.
- Focus is never removed without a replacement.
- Focus moves with state, not after animation (MOTION_SYSTEM §5).
- The Inspector opens with focus on Close.
- Back restores focus to the originating row.
- Focus colours reach ≥ 5.4:1 on every B1 surface (§2.5).

## 16. Selected and trigger

These are defined in §10. There are two independent cues so both survive on one row:
- The **tint** means "this is the event in the Inspector".
- The **ring** means "this is the anchor of the current view".

The trigger also appears in:
- the Inspector title (crosshair icon)
- every capture: the vertical selected-event line, the flag "Selected event" under the ruler, a ring around the
  plotted point, and the stat "Selected event 7 of 9"

## 17. Status

| Status | Encoding |
|---|---|
| Source health | Dot plus word: Healthy / Degraded / Unreachable / Checking…, in the Source field and the health popover. The popover lists declared capabilities with Supported / Not supported by this source. |
| Search readiness (mapping) | "Search ready" (success tag) or "Search blocked — …" gate banner. |
| Live acquisition | Badge word plus icon: LIVE (success dot with an 1.8 s pulse, static under reduced motion), PAUSED (pause icon, buffered count), RECONNECTING · attempt n of 5 (rotating icon, dashed border), STOPPED, CONNECTION FAILED (danger, Retry). No red is used for a healthy stream. |
| Counts | `31 loaded · more available · total not reported by this source`. Loaded, visible, total/estimated, truncated and dropped are separate numbers with separate words, never merged into one sentence. |
| Progress | A 2 px indeterminate hairline under the scope strip while a request runs. It never shows a percentage and never implies the backend is faster (lane `SEARCH_PERFORMANCE_ROOT_CAUSE` is deferred). |

## 18. Responsive

| Width | Behaviour |
|---|---|
| **≥ 1440** | Reference layout. Inspector docked at 500 px. |
| **1366–1439** | The query bar wraps into two rows: scope fields, then search, More filters, Search, Live. The readout drops its third clause. The Inspector stays docked at 500 px; the table min-width is 860 px. |
| **1280–1365** | The Inspector becomes an overlay sheet (520 px max) with a scrim. The mapping evidence panel is 340 px. |
| **1024–1279** | Sort, Columns and Query details in the scope strip become icon buttons; their names stay as accessible names. |
| **768–1023** | Shell actions are icon-only, with labels kept as accessible names. Mapping evidence stacks under the table. Settings nav becomes a horizontal tab row. The filter panel uses 2 columns. |
| **≤ 767** | Scope fields collapse into one "Scope" summary field that opens the scope sheet. The search input takes a full row. The Inspector is full width with scrolling tabs. The scope strip shows only chips (ellipsis) plus sort and Columns. The table keeps all seven columns, scrolls horizontally, and keeps Time sticky. |

Verified sizes: 1920, 1440, 1366, 1024, 768 and 390, with no page-level horizontal overflow (`screenshots/responsive/`,
`capture-report.json`). The page never scrolls sideways; only tables, plots and code do, each inside its own container.

## 19. Dark / light decision

**Decision proposed: C — support both, with light as primary.**

| Option | Assessment |
|---|---|
| A light only | Meets CLAUDE.md §7 ("light theme required"), but long night incident sessions and many developers' OS preference are not served. |
| B dark only | **Not allowed**: CLAUDE.md §7 requires a light theme. |
| **C both, light primary** | Light B1 ships first and is the reference for every review. The **B1 dark companion** is a complete, separately defined token set (§2.3, contrast in §2.5). It ships only when every state passes the same visual, contrast and regression gates, as §7 requires ("dark theme only if complete and accessible"). The theme follows `prefers-color-scheme` with an explicit Light / Dark / System preference stored as a safe UI preference (no sensitive data). |

Dark is never produced by inverting light. Severity, lanes, tints and shadows are chosen per theme.

## 20. Accessibility

WCAG 2.2 AA is the target. The system guarantees the following:

| Area | Guarantee |
|---|---|
| Contrast | All text ≥ 4.5:1 and all UI boundaries and severity marks ≥ 3:1 in every treatment, computed in §2.5. |
| Non-colour meaning | Severity uses shape plus word. Mapping status uses icon plus border style plus word. Health uses dot plus word. Live uses badge word. EXCLUDE uses the caps word. Lanes are always named. Selection uses tint plus hairlines; the trigger uses ring plus hidden text. |
| Semantics | A semantic table with `aria-sort`, `aria-selected`, `aria-current`, `aria-rowcount`. Tabs use tablist/tab/tabpanel. Switches use `role="switch"` with `aria-checked`. Segmented controls use `aria-pressed`. Popovers and sheets are dialogs; the Inspector is a non-modal dialog. |
| Keyboard | Every existing shortcut is preserved (`/`, `[`, `]`, `B`, Esc precedence, Live keys). Rows use roving tabindex. The Inspector is resizable by keyboard. Reorder in Columns uses buttons plus drag. |
| Announcements | `aria-live` for the Inspector position, search completion counts, Live state changes and copy confirmation. |
| Motion | `prefers-reduced-motion` is a first-class mode (MOTION_SYSTEM §4). |
| Zoom and reflow | 200 % zoom at 1280 equals the ≤ 767 layout without page overflow; minimum text is 11 px. |
| Targets | Controls are ≥ 24×24 px (WCAG 2.5.8). Dense row actions are 24 px inside 28 px rows. |
| Privacy | Masked values are rendered as served. There is no reveal, hover-to-show or copy of masked values. |

### Impeccable detector triage (`impeccable detect --json`, prototype)

| Flag | Location | Disposition |
|---|---|---|
| `pulsing-dot` | `.acq-live .pulse` | **Kept, justified.** The pulse shows only while the stream is actually LIVE, is paired with the word "Live", and is static under reduced motion. It is the one loop tied to real activity (MOTION_SYSTEM §2). |
| `repeating-stripes-gradient` | `.gap-band` | **Kept, justified.** The hatch encodes "no events observed in this interval" on the capture ruler, and a duration label accompanies it. It is data, not decoration. |
| `border-accent-on-rounded` | `.sev-WARN` | **False positive, removed at the source.** The WARN triangle was drawn with CSS borders, not an accent stripe on a rounded box. It is now a `clip-path` triangle, which looks identical and raises no flag. |
| `design-system-radius` ×5 | 9 px switch/badge, 1–2 px marks | **Fixed.** Uses `--r-full` and `--r-xs` tokens. |
| `design-system-color` ×3 | B3 shell hard-coded colours | **Fixed.** Moved to B3 tokens (`--shell-line`, `--shell-ink-2`, `--shell-hover`, `--shell-accent`). |
| `design-system-font-size` | 11 px lane label at ≤ 767 | **Fixed.** The override is removed; lane labels stay 12 px with ellipsis. |
| `overused-font` | Inter | **Kept, justified** (§3). Persisted as a single `ignore-value overused-font inter` entry with a written reason in `.impeccable/config.json`. |

The remaining `design-system-*` flags compare against root `DESIGN.md`, which intentionally still documents production
until owner approval.

---

## 21. Event classification (PR #59 design sync)

Baseline: `main` `51f06e5`. PR #59 added generic classification rules, create-from-event, deterministic pattern
detection, rule test, structured extraction, tag filtering, JSON rule packs and the source-selector policy. This
section extends the B1 language to that capability. **No new colour tokens were needed**: every primitive reads the
existing semantic vocabulary (§2), so B1 dark, B2 and B3 inherit it. Prototype states **40–81**
(`prototype/scripts/classification.js`, `prototype/styles/classification.css`).

### 21.1 The three modes, applied to classification

| Mode | Classification job | Presentation |
|---|---|---|
| **Search** (find events) | A compact signal and a filter | Optional **Tags** column (first tag + `+N`), **Classification tags** group in More filters, one `Tag <name>` chip per selected tag |
| **Inspector** (explain one event) | Full detail of what the server concluded | **Classification** section inside the Overview tab: all tags, then one block per matching rule with its extracted values |
| **Investigation** (explore related events) | Scan classification across events | **Tags** column in the capture sequence table and a `Tagged n of N` stat; Live uses the same column |
| Settings › Classification rules | Manage rules, import and export | Rules table, banners, import preview |
| Rule builder workspace | Create a rule from one event | Anchor strip, step rail, step content, draft panel |

The Inspector never becomes a multi-event view: cross-event scanning lives in Search and Investigation. The
**five-tab invariant is unchanged**: classification is a section of Overview, never a sixth tab (production does the
same).

### 21.2 Tag chip

| Aspect | Spec |
|---|---|
| Anatomy | Lucide `tag` icon 11–12 px in `--ink-3` + the tag text, **lowercase exactly as stored** (production stores lowercase; the Inspector currently uppercases for display, D20) |
| Sizes | 18 px in table cells and rule rows; 22 px (`.lg`) in the Inspector and token input |
| Surface | `--surface-sunken`, 1 px `--line`, `--r-xs`, 12 px/500 `--ink-1` |
| Colour | **No per-tag hue.** Tags are user data with unlimited future values; colouring them would collide with severity, lanes and the accent, and would make `middleware` look special. Every tag looks the same. |
| Overflow | In a cell: the first tag shrinks with an ellipsis only when it must; `+N` (neutral tint, never shrinks) follows. The full list is in `title`, in the visually hidden accessible name (“Tags: middleware, external-api, partner”) and in a hover/focus tooltip (state 43). |
| Disabled rule | Dashed border and `--ink-3` text, with the word Off beside the switch |

### 21.3 Results table: tag presentation decision

> **SUPERSEDED by §22.3 (PR #60).** Production made classification visible without the Inspector and formally
> amended the column invariant: the default set is **eight** columns, Tags among them (decision **D30**, CLAUDE.md
> §4, register §27 CSX-8). The evaluation below is kept as the record of how the first-pass decision was reached —
> its "Chosen" verdict is no longer the design's answer.

PR #59 deferred result-row tags to this sync. Options evaluated against CLAUDE.md §4:

| Option | Scanning | Invariants | Verdict |
|---|---|---|---|
| A. Chips inside “What happened” | Pushes the message, adds badge clutter | Breaks “What happened = message only” | Rejected |
| B. An always-visible eighth column | Good | Breaks “exactly seven columns” | Rejected without an owner decision (D19) |
| C. A marker in the signal gutter | Hidden meaning; gutter already holds severity + trigger | Overloads the trigger/severity grammar | Rejected |
| D. A marker plus hover card only | Unscannable | — | Rejected |
| **E. Optional Tags column** | First tag + `+N`, one row, no row growth, 0/1/many supported, sortable by nothing new | Keeps seven default columns; optional columns already exist (Logger, Trace ID…) | **Chosen** |

Spec: column id `tags`, header “Tags”, placed right after What happened when enabled from Columns; 156 px; `—` when
the event has no tag; never wraps. States 42 and 43 show it enabled. **While the Inspector is docked the Tags column
is hidden** (the Inspector's Classification section shows the selected event's tags) and returns when the Inspector
closes, so What happened keeps its Inspector-open width (286 px at 1440, as in state 04). States 44–46 are drawn this
way, with the seven default columns. The preference itself is unchanged by opening the Inspector.

**Width floor.** Enabling Tags adds its width to the table's minimum instead of taking it from What happened: the
results table minimum becomes 1,124 px (seven fixed columns 728 px + Tags 156 px + What happened ≥ 240 px), capture
sequence tables 1,276 px and the Live table 916 px. The Tags column is 156 px in Search, Investigation and Live alike. Narrower viewports scroll the table inside its existing wrapper
(CLAUDE.md §4 contained horizontal scroll); the page never scrolls and What happened is never crushed. **D19** asks
whether the owner wants it visible by default, which would amend the seven-column invariant.

### 21.4 Tag filter

- A **Classification tags** group in More filters (fifth column ≥ 1024 px), one checkbox per known tag with the tag
  icon; draft until Apply, like every other group. Loading, error and “No tags yet” copy are kept from production; the error is drawn in state 79 (“Could not load
  classification tags: … Other filters still work.”).
- Help copy: “Keeps events with **any** selected tag. Tags are applied by the server to the events a search reads;
  filtering does not read more history.”
- Committed: one chip per tag, `Tag <name>` (production copy), which never ellipsizes to a fragment. The active-filter
  row scrolls horizontally when chips exceed the strip, and **Clear all sits outside the scrolling row**, so every
  remove control and Clear all stay reachable at every width. Chips keep their words while the row scrolls; they never
  shrink to fragments.
- More filters stays inside the viewport at every width: only the fields scroll (wheel, touch and keyboard); the
  Reset / Cancel / Apply footer sits outside the scroll area, so it is always visible and never covers a field. Each
  tag option row (26 px, full width) is its checkbox target. On narrow screens the query preview takes its own row.
- Focus: opening More filters moves focus to the panel heading (production behaviour); Tab continues through the
  panel; the results behind the open panel are inert, so no focus lands under it. Esc or Cancel returns focus to the
  More filters trigger. When the row overflows (detected with a
  ResizeObserver) its right edge fades over 32 px, so it reads as scrollable.
- Tag list copy exactly as production: “Loading classification tags…” while loading; “No classification tags yet.”
  when no rule defines a tag (state 80); the error in state 79.
- Readout under a tag filter: “**5** tagged events · among the events this search read”, plus the table footnote
  stating that tags apply after the source returns events. No copy implies exhaustive, source-side filtering.

### 21.5 Inspector classification section

Order: section heading “Classification” with “n rules matched” → the union of tags → one block per rule (rule name,
“adds <tags>”, a **Rule** link to Settings, D29) → the rule's extracted values as a key/value list in definition order.
The grammar is identical for `middleware`, `frontend-call`, `mobile-call`, `external-api`, `database-call` or any
future tag; nothing is rule-specific.

| Value state (API) | Rendering | Copy |
|---|---|---|
| PRESENT | `--text-data` value, copy button | — |
| ABSENT | `—` in `--ink-3` + secondary line | “Not found in this event” |
| INVALID | `—` + circle-alert icon + secondary line | “Could not be read” (production copy; covers a failed type conversion and an extraction that failed) |
| `redacted`, value exactly `[REDACTED]` | `[REDACTED]` token on `--masked-tint` with a shield icon; **no copy button** | “Redacted by the server; nothing to show or copy” |
| `redacted`, any other value (partly redacted, e.g. JSON with `"token":"[REDACTED]"`, or masked by the privacy policy, e.g. `84***31`) | The value exactly as served, a shield note; **no copy button** | “Redacted by the server where required” (the server sets `redacted` whenever redaction changed the value; it does not say why) |
| Long value | Two-line clamp + **Show more** | — |
| `truncated` | Value + info line | “Shortened by the server to 2,000 characters” |
| JSON value | Disclosure “JSON · n lines · formatted for reading” (the server sends compact JSON; the UI formats it), highlighted as §14, bounded height, copy unless redacted | — |

A rule that matched but defines no extractions shows “This rule extracts no fields.” (production copy; state 46).
Sensitivity belongs to each extraction definition, not to the value: the same request body can be `[REDACTED]` in a
rule that marks it sensitive and shown as JSON in another rule that does not (state 45). Every block lists all of its
rule's definitions in definition order, with the status the engine returned. Rules and the tag union appear in the
server's evaluation order: priority, then id. The rule editor sets no priority (every rule is 100), so the order is by
id, in the Inspector, the tag cells, the rules list and every rule list derived from it (state 70).
Missing (`—`), redacted (token) and unreadable (icon + sentence) are distinguishable without colour. Footnote: values
pass the same masking and redaction as every other field. States 44–46.

### 21.6 Rule builder workspace

Opened from the Inspector action **Create tag rule** (and from New rule, Edit, Duplicate, Test in Settings).

| Region | Spec |
|---|---|
| Mode bar | “Back to event” (D18), title “Create tag rule”, Cancel |
| Anchor strip | The **trigger crosshair**, level mark + word, time, service and message of the selected event: the signature trigger carries into the builder, so the investigator always sees which event the rule came from |
| Step rail (236 px) | Source · Detect · Classification · Extraction · Test · Save. Each step shows a status line (“17 similar of 200 read”, “2 tags · 5 conditions”). Every step stays reachable in any order, as in production. |
| Step content | Panels with h3 heads; one primary action per view |
| Draft panel (340 px) | Name, tags, plain-language conditions, extraction count, tested state and sample scope, always visible, labelled “not saved” |
| Compact scope bar | The committed search scope that Detect and Test sample, with Edit search |

**Without a source event** (New rule, Edit, Duplicate; states 76 and 81): no anchor strip and no crosshair, because the
crosshair is reserved for a real trigger. An “Editing a saved rule” (or “New rule”) strip states that Detect needs a
pasted sample value; Detect then shows a Field select and an editable Sample value, and while the value is empty the
hint “Detect needs a sample value. Paste one above, or write conditions manually.” describes the disabled Detect
button (state 81); the rail starts at Detect; Back returns to the rules list. The Save step panel is titled “Review and save” (never “Ready” while issues may exist). On the Save step without a
conflict (state 74) the summary shows the untested hint (“Test first”). **Save rule stays enabled, as in production**: pressing it
re-checks the draft, writes nothing when a required field is missing, and lists “Not saved: …” issues with a link to
the step.
After Reload rules on a conflict the notice “Latest rules loaded. Your draft is kept — save again when ready.” replaces
the banner.

An invalid expression exists only while it is being typed (state 60) and counts as a draft condition until it is
fixed or removed; a saved rule never contains one, because the server rejects it on save.
Advanced condition rows stack below 1024 px (Value full width) and become one column at ≤ 767 px, so no field is
crushed.

**Why a rail and not a locked wizard or one long form.** A locked wizard hides earlier decisions and blocks
correction. One long form (the production extraction step reaches 2,100 px) buries the test result. The rail keeps
production's free navigation, reuses the mapping process grammar, and the draft panel removes the hidden-state
problem of steps. Below 1440 px the draft panel becomes a one-line summary (so the extraction table keeps its width at 1366); below
1024 px the rail becomes a horizontal step strip that scrolls the current step into view and fades the edges hiding more steps. A step that
receives keyboard focus scrolls fully into view, clear of the fades (`scroll-padding-inline: 40px`). Rules,
extraction and import tables switch to stacked rows below
1280 px, before any column would be crushed.

**Regex stays behind an explicit path.** The ordinary path is Detect → Use this suggestion → name and tags → keep
the suggested values → Test → Save, with no expression visible. Expressions appear only in “Edit conditions
(advanced)” and in an extraction's edit row.

### 21.7 Detect: observed evidence vs suggested rule

| Panel | Treatment | Content |
|---|---|---|
| **Observed in this sample** | Solid panel, neutral “Measured” tag | Stat row Read · With a message · Similar to this event; the **decode lane**; a “Changing parts” table (part, kind, example from this event: the API returns one example per changing part, taken from the redacted anchor) |
| **Suggested rule** | **Dashed** panel border, dashed “Suggestion · not saved” tag | Plain-language conditions; “On this sample it matches **17 of 17** similar events and **0 of 181** other events **with a message**” — the two add up to the 198 events that carried the field, not to the 200 read, and the panel says so; suggested values with evidence bars; warnings; Use this suggestion / Write conditions manually |

**Only API data is drawn.** The Changing parts table shows one example per part from the (redacted) anchor event, and
suggested values show counts only (“16 / 17”). Values from other sampled events are never shown, and warnings are the
server's count sentences as served. Narrow widths wrap these small tables instead of truncating them.

**Decode lane** (logic-analyzer bus decode): the anchor value is split into segments. Fixed text = solid
`--line-strong` segment on the work surface. Changing part = **dashed** `--control-border` segment with its name and
kind beneath (`url · path`). A legend states both meanings (“Fixed text across similar events”: a stable segment aligns in at least 90 % of
similar values, so the legend never says “all”); the accessible name lists both groups. No percentages, no
“confidence”, no AI wording: the copy says the sample is read through the normal search path and compared deterministically.

**Suggestions follow the detector's candidate order.** EXACT; STARTS_WITH the stable prefix; STARTS_WITH plus CONTAINS
each stable label outside the prefix (up to four); CONTAINS the longest stable segment plus labels; REGEX. The first
candidate that matches the anchor and at least 90 % of similar values without matching any other sampled value is
suggested. State 57 draws the prefix-plus-labels candidate (five conditions), because in this sample the prefix alone
also matched queued webhook events that are not similar; a design must never draw a combination the detector cannot
produce. Suggested extraction expressions are drawn exactly as the detector writes them (for example
`duration=(?P<durationMs>\d+(?:\.\d+)?)ms`).

**Segments follow server tokenization.** The server tokenizes values into typed tokens (IDs, numbers, durations,
paths), so a duration such as `5012ms` is one changing part named `duration`; a unit is never drawn as a separate
fixed segment. Part names are the detector's variable names, not extraction names.

**Decode lane derivation.** `stableSegments` and `variableSegments` carry no positions. The client rebuilds the lane
by locating each stable segment, in order, in the anchor value; the text between two located segments is the next
variable segment, labelled with the variable name and kind in order. If any stable segment cannot be located
uniquely and in order, or the number of gaps differs from the number of variables, the lane is **not drawn** and the
section falls back to the two plain lists (fixed text; changing parts), so the design never shows an invented
alignment.

**No safe pattern** (state 58): warning state panel “No safe pattern could be suggested”, the server reason quoted as
served, a stat
row with the measured counts only (the minimum needed exists only inside the server's reason text), “Log Explorer does not guess from too little evidence”, and three actions:
Write conditions manually, Widen the time range (opens Edit search, D23), Cancel.

### 21.8 Extraction editor

Table (≥ 768 px): Status · Value (label, `name · type`) · Read from (field + method) · Sensitive · Coverage · actions.

- **Suggested** = dashed status tag with a dashed-circle icon; **Confirmed** = solid tag with a check icon. A value
  stays Suggested until the user keeps or edits it (client-side draft state, D21; not persisted).
- Coverage uses the mapping evidence bar with `16 / 17`; values added manually read “Test to measure”.
- **Preview values** (production action) sits beside Add value and runs Test, opening the Test step.
- Sensitive values show a shield and “Never shown”.
- The edit row holds output name, label, from field, type, method (Pattern (RE2) / JSON pointer), the sensitive switch
  and, only there, expression and group. The Detect evidence for that value is repeated in the row.
- Below 1280 px each value is a stacked card with Keep (named per value, e.g. “Keep Method as suggested”), Edit and
  Remove; the value being edited opens its edit sheet inside the card (four columns, two below 1280 px, one at ≤ 767 px).

### 21.9 Test results

- Stat row **Read · Matched · Not matched**; the sample-limit note (“only the newest 200 events in the scope were
  read”: the sample collector reads newest first); “Non-matching events are counted, not listed”
  (the API returns no non-match previews, so none are drawn).
- Extraction coverage table among matched events, including “1 found but could not be read”.
- Sample combinations must be ones the server can produce together: examples come from services inside the sample
  scope (an excluded service never appears), and every event that would change Detect's similar count, or that matches
  at least one condition in the Test sample, appears consistently in Detect and in the borderline list.
- Every timestamp in the builder uses the display zone, like the anchor strip (no mixed UTC and local times).
- Coverage lists every extraction in the draft, including values that matched nothing (`0 / 17`).
- Examples as a segmented control: **Matched · 5 of 17** and **Borderline · 3**. A sample is one compact block
  (time, service, level, field value in data type, extracted values as small key/value chips). Borderline samples
  carry “Matched 3 of 5 conditions” on a warning tint and explain what to check. A borderline example always matched
  at least one condition (the server only returns near misses with one or more matched conditions). Borderline
  examples show **no extracted values**: the server extracts values only for matched events. Matched examples list
  every extraction in the draft, including values not found (`—`).
- Coverage and examples agree: a value the pattern does not find (for example `duration=n/a`) counts as not found
  (`—`), not as “could not be read”; a shortened field value is cut at the server's 300-character preview limit and
  labelled.
- Review footer, verbatim from production: “**Review these matches for false positives.** Counts describe this
  bounded sample only, not the whole source.”
- **Never:** “False positives = 0”, accuracy or confidence percentages.

### 21.10 Settings › Classification rules

- Lives in the unified Settings workspace (D3, D17) as a nav item beside Field mapping, with a rule count.
- Meta line: revision, “Saved on the Log Explorer server as `classification-rules.json`” (file name only, D28), and
  runtime counts “since the server started”. The meta line always states what the API would return for that state:
  an empty or invalid configuration shows zeroed runtime counts, an invalid configuration shows revision 0 (the
  server loads `RulesDocument.empty()`) and says the file could not be read, and a state reached by saving or
  importing shows the next revision and the merged rule set.
- Toolbar: filter, Import rule pack…, Export all, Export selected (n), **New rule** (the only primary).
- Table: select · Rule (name + description) · Tags · Matches when (first condition in plain language + “+n more ·
  all must match”) · Extracts · Enabled (switch with On/Off word) · Test, Edit, More (Duplicate, Export, Delete).
- Banners (full width, icon + words): Saved (success, with Re-run search, D22), Revision conflict (danger, Reload
  rules), Recovered from the last good copy (warning), Invalid configuration (danger + “Classification is off”
  state panel). Banner copy never names backup, temporary or corrupt file paths.
- More actions menu per rule (state 75): Duplicate, Export this rule, Delete… (danger item that opens the dialog). The
  trigger carries `aria-haspopup="menu"` and `aria-expanded`. The menu is drawn outside the scrolling table so it is
  never clipped, and it is anchored 4 px under its own row, right-aligned with the trigger, so it never covers the
  controls of the row it belongs to; the row and the menu are scrolled into view together.
- Delete: modal alertdialog, danger button “Delete rule”, focus on Cancel, explains shared server scope and that it
  cannot be undone (D27).
- ≤ 767 px: stacked rule rows (checkbox, name, tags, matcher, switch, actions menu) instead of the table.

### 21.11 Import rule pack

- Process strip: Choose file · Validate · Preview · Apply.
- Count tags with icon + word + number: Rules in pack, New (circle-plus), Identical (equal), Conflicts
  (triangle, warning tint), Invalid (circle-x, danger tint). A zero count is dashed and tertiary.
- Items table: status tag · rule (name + id) · tags · **What applying does** (“Will be added”, “Already present;
  stays unchanged”, “Needs your choice”, “Existing rule is kept”, “Imported version replaces the existing rule”,
  “Blocks the import”). Conflict rows expand a detail row; invalid rows show the validation path and message.
- How to apply: two choice cards, Merge and **Replace all rules** (destructive card turns danger when chosen).
- Conflicts (Merge only): one required choice for all conflicts, **Keep existing** / **Use imported** (the API takes
  one resolution per import).
- Replace all: a danger zone listing the existing rules that will be deleted (computed from the loaded rules and the
  pack ids, D24), the shared-server scope, “cannot be undone; export first”, and a required confirmation checkbox.
  The apply button becomes the danger button **Replace all rules**.
- Apply stays disabled while any blocker exists; blockers are listed beside it and referenced by
  `aria-describedby`. Invalid packs offer Choose another file. At ≤ 767 px the action bar is not sticky, so a focused
  control is never hidden under it (WCAG 2.4.11).
- A file larger than the import limit shows an inline error under the picker (state 77).
- After a successful import (state 71) the rules list is the server's merged response: the added rule is in the list
  in id order, the Settings count includes it, and the revision is the one the save produced.
- If the rules change after the preview, a danger banner says nothing was imported and offers **Reload and preview
  again**; Apply stays blocked until then (state 78).

### 21.12 Motion

See MOTION_SYSTEM §7: evidence reveal 160 ms, extraction row add 120 ms, dialog 120 ms, all reduced to opacity or
none under reduced motion.

### 21.13 Contrast of the new pairs (computed, WCAG 2.x)

| Pair | Tokens | B1 light | B1 dark | Requirement |
|---|---|---|---|---|
| Tag chip text | `ink-1` on `surface-sunken` | 16.02 | 15.03 | 4.5 |
| Tag icon | `ink-3` on `surface-sunken` | 4.85 | 6.10 | 4.5 |
| Overflow count +N | `ink-2` on `neutral-tint` | 7.21 | 7.73 | 4.5 |
| Redacted token | `masked` on `masked-tint` | 5.15 | 6.20 | 4.5 |
| Borderline tag | `warning` on `warning-tint` | 5.64 | 7.74 | 4.5 |
| Danger zone heading | `danger` on `danger-tint` | 5.70 | 7.08 | 4.5 |
| Unavailable source option | `ink-3` on `surface-raised` | 5.40 | 5.27 | 4.5 |
| Variable segment text | `ink-2` on `surface-sunken` | 7.34 | 8.94 | 4.5 |
| Variable segment dashed border | `control-border` on `surface-sunken` | 3.19 | 4.25 | 3.0 |
| Suggested tag text | `ink-2` on `surface-work` | 8.17 | 8.62 | 4.5 |
| Confirmed icon | `success` on `surface-work` | 6.09 | 8.20 | 3.0 |
| Import error on invalid row | `danger` on `danger-tint` | 5.70 | 7.08 | 4.5 |
| Disabled rule text | `ink-3` on `surface-work` | 5.40 | 5.88 | 4.5 |
| Coverage bar fill | `ink-3` on `line-subtle` | 4.43 | 4.89 | 3.0 |

Chip and fixed-segment borders are decorative; the text or icon carries the meaning.

### 21.14 Accessibility specifics

- Tags are text, never colour-only; `+N` is backed by the full list in the accessible name.
- The unavailable source is a native disabled option (not focusable, not selectable, announced as dimmed/unavailable).
- The decode lane is `role="img"` with a text alternative listing fixed and changing parts; the changing-parts table
  carries the same data.
- Step rail: `nav` with `aria-current="step"` and hidden “completed” text; step content is a labelled region.
- Suggested vs Confirmed, Conflict vs Invalid, Missing vs Redacted vs Unreadable all differ by icon and word.
- Import mode and conflict resolution are radio groups; the conflict group is `aria-required`.
- Destructive dialogs are `alertdialog` with focus on Cancel; Replace all needs a checkbox before the button enables.
- Remove controls in filter chips are 24 px targets (fixed during this sync after an axe `target-size` finding).
- Whatever a layer covers is inert: the results behind the Inspector sheet (< 1366 px) and behind the open More
  filters panel, and everything behind a modal alertdialog (delete rule), so keyboard focus never lands under a layer
  (WCAG 2.4.11). At ≥ 1366 px the docked Inspector and the results stay operable side by side.

---

## 22. Classification after PR #60 (final production sync)

Baseline: `main` `6e71af8` — PR #59 (classification, extraction, packs) **and** PR #60 (search-scope recovery,
assisted extraction, visible tags, tag colours). Where this section and §21 disagree, **this section is current
truth** and §21 stands as the record of the first pass. Every superseded item is named in §22.10.

### 22.1 What PR #60 changed for design

| Production truth | Design consequence |
|---|---|
| Detect and Test sample the **committed search itself** (text, query DSL, raw LogQL, identifiers, mapped advanced filters, protected filters, services + mode, severities, project, window) | The builder must *state its scope*, not imply the whole source — §22.6 |
| A classification **tag filter is never carried** into an authoring sample | Stated once, where the sample is described; never repeated into ordinary search UX |
| The selected event is **guaranteed** as the detection anchor | The anchor strip stays, and counts stay truthful when the anchor is added |
| Extraction is **assisted**: suggestions mined from the events the rule really matches, with measured coverage | Extraction stops being a blank technical form — §22.7 |
| A classified event can be **extended in place** ("Add extraction from this event") | A second, clearly distinct authoring entry — §22.8 |
| Classification is **visible in the results table by default** | The Tags column is part of the default column set — §22.3 |
| A rule carries a **semantic colour**, one colour per tag, conflicts refused | §22.2, §22.4, §22.9 |

### 22.2 The classification chip (final)

Three parts, and the split is the whole point:

| Part | Role | Token |
|---|---|---|
| Tinted pill | Quiet surface that groups the identity | `--tag-<hue>-tint` |
| 6 px dot | The colour identity itself | `--tag-<hue>` |
| Text | **The meaning**, always present | `--tag-ink` (= `--ink-2`) |

**Why not coloured text.** Severity already speaks with coloured ink plus a level mark and a row tint. If a tag
also spoke with coloured ink, a `RED` tag would read as an error and an `AMBER` tag as a warning. Tags therefore
use a different grammar — *tinted pill + dot + neutral text* — so the two systems never compete. Prototype state
`93-results-tag-not-severity` exists to be checked on exactly this point: a red `issuer` tag sits on the two
nearest INFO rows above the first ERROR row.

Geometry: 18 px tall in a 28 px row (a classified row is never taller than an unclassified one), 22 px in the
`.lg` variant used in panels. The base cap is 96 px and lists raise it to 160 px; **inside a results cell the cap
is removed** so the chip can use the column and shrink only when it must (a rendered cell chip measures ~131 px in
the 156 px column). The text ellipsises, the dot never shrinks.

**Palette** — the eight production names, drawn in B1's muted register. Text is `--ink-2` on every tint
(≥ 7.0:1); dots are identity only and clear the 3:1 non-text bar on their own tint and on white:

| Name | Hue | Tint | Text on tint | Dot on tint |
|---|---|---|---|---|
| GRAY | `#5f6a77` | `#eef1f4` | 7.21 | 4.86 |
| BLUE | `#2f6ec2` | `#e9f0fa` | 7.12 | 4.43 |
| CYAN | `#17788d` | `#e4f2f5` | 7.13 | 4.46 |
| GREEN | `#2f7d53` | `#e8f4ea` | 7.22 | 4.44 |
| AMBER | `#9c751b` | `#faf1dd` | 7.27 | 3.76 |
| ORANGE | `#b96322` | `#fbeee4` | 7.18 | 3.79 |
| RED | `#c0453b` | `#fbecea` | 7.11 | 4.40 |
| PURPLE | `#7959b3` | `#f1ecf8` | 7.04 | 4.65 |

The dark companion defines its own eight pairs (text ≥ 7.4:1, dots ≥ 5.0:1) — never an inversion of the light set.
Under `forced-colors` the chip keeps its text and gains a `CanvasText` border; the tint drops to `Canvas` and the
dot is redrawn in `CanvasText`, so the marker survives as shape while the colour identity is gone — which is the
correct outcome, because the tag name was always the thing carrying the meaning.

**Colour is identity only.** Never severity, success, failure, health or causality. Colour is never the only
signal: the tag text is always rendered, so the chip survives colour blindness, forced colours and print.

**Colour belongs to the rule, and therefore to every tag the rule carries.** This is production's model, not a
design choice: `ClassificationRule` stores one `TagColor`, and both the rules list and the Inspector paint every
tag of a rule in it. `TagColorPolicy.tagColors` then resolves each tag to the colour of the first rule that
claims it. Two consequences the design must honour, both verified by running the real `TagColorPolicy`:

1. **Within one rule, all tags are one colour.** A picker preview that showed two tags in two colours would be
   drawing a state the data model cannot hold.
2. **Two rules that share a tag must carry the same colour**, or the save is refused — so a *cluster* of rules
   linked by shared tags collapses to a single colour. In a real vocabulary where something like `external-api`
   is used widely, that cluster can be most of the rule set, and the palette stops distinguishing much. The
   package's own fixture had to be rewritten for this: `middleware-http-call` (blue) and the acquirer rules
   (purple) both carried `external-api`, which the real policy rejects with
   *"Tag "external-api" is already shown in PURPLE by …"*.

An **event** may still show several colours at once, because its tags come from several rules — that is the one
legitimate multi-colour case, and it is drawn in `45-inspector-multiple-classifications`, where one event's chips
measure `external-api` purple, `partner` purple and `middleware` blue, exactly as `TagColorPolicy.tagColors`
resolves them. The **results table** is not where that shows: §22.3 gives each row one chip plus a neutral `+N`, so
`92` and `93` draw a single colour per row by design. Whether colour should instead be a property of a *tag* is an
open product question, recorded as decision **D40**; this package designs the model that ships.

### 22.3 Results table: the Tags column (supersedes D19)

Visible **by default**, between *What happened* and *User / Customer*:

```
… What happened …          │ Tags                  │ User / Customer │
  Make webhook call to /p…  │ ● middleware   +2     │ User ra**07     │
  Payment authorized        │ —                     │ User ra**07     │
```

- First tag as a chip, then a **neutral** `+N` counter. The counter is deliberately *not* a second coloured chip:
  it counts identities, it is not one.
- The full list is the cell's accessible name (`Tags: middleware, external-api, partner`) and its tooltip — never
  discoverable only on hover.
- An unclassified event renders `—`, never an absent cell.
- Width: the design uses 156 px, narrowing to 132 px when the Inspector is docked (production ships a single
  150 px, with no docked variant — the narrowing is a design proposal, §22.11). The message column keeps its
  240 px floor either way.
- The column can still be hidden or moved under **Columns**, like any other.

### 22.4 Tag colour picker (rule builder, Classification step)

- Eight swatches, each a dot **and its colour name** — never colour alone, and never a free hex field. The stored
  value is the production name (`GRAY`); the word shown is the product's own spelling (*Grey*). The design never
  invents a ninth colour.

> **Production copy bug (design finding, D38).** The shipping picker hint says "A tag already used by another rule
> keeps that rule's colour." Nothing is kept: the write is *refused* (§22.5). The design's copy says so instead.
- Choosing is optional: without a choice the server derives one deterministically from the first tag, so the same
  tag looks the same on every installation. The copy says so rather than forcing a decision.
- A live preview chip shows the tag exactly as Search and the Inspector will draw it.
- Keyboard: one radio group, arrow keys move, the selected swatch carries the accent ring; focus is visible on the
  label, not only the hidden input.

### 22.5 Same-tag colour conflict

One normalized tag resolves to one colour. A rule that would give an existing tag a second colour is **refused**,
never silently resolved — and the design says so in the user's own words, not as a validation code:

> The tag **middleware** is already shown in **Blue** by "Middleware HTTP call". Choose Blue for this rule, or use
> a different tag — one tag keeps one colour everywhere.

Two resolutions are offered inline: **Use Purple**, or **Rename this tag…** — the colour named is whichever one the
tag already has, drawn in `84-rule-colour-conflict` as Purple for `external-api`. The import variant (§22.9) names
both sides and offers *Keep Purple* or *Change "external-api" to Red everywhere*.

**What ships today:** the refusal is real and server-enforced (`TagColorPolicy.conflicts`), but its error path is
`rules[i].displayColor`, which the editor's field-level lookup does not match — so the message lands in the generic
"This rule is not valid yet" list rather than under the Tag colour field. Putting it inline, in these words, with
the two resolutions, is the design's addition (§22.11).

### 22.6 Sample scope: "Sampled from this search"

Detect, Test and the suggestion pass all read one bounded sample of the committed search. The builder states that
in one component, used in one place per screen:

- **Detect** shows the full `scope-summary` panel: source · project · time · query · services · severity, a
  *Change filters* affordance, and the one honest omission — a classification tag filter is not applied, because a
  rule being written must not be evidence for itself.
- **Every other builder step** relies on the rail's own *Sample scope* block, which carries the identical facts.
  The two are generated from one list, so they cannot drift. Verified at 1920 and 1440.
- **Two measured exceptions, and the package claims neither away.** The rail itself is never hidden, but its
  draft panel — which carries the *Sample scope* block — collapses to a one-line summary below 1440 px
  (pre-existing behaviour for every builder step, not new here), so between 390 px and 1439 px only Detect's own
  panel states the scope. And the *Add extraction from this event* frame (states 87–90) carries a rail with no
  scope block at **any** width, because that flow never runs Detect: its numbers come from the chosen rule's own
  matching events, which each panel states in its own words. Measured at 1920/1440/1439/1366/1024/768/390.
  The steps that *report numbers* — Detect, the suggestion panel, Test — keep their own bounded wording at every
  width ("out of 200 sampled", "Counts describe this bounded sample only, not the whole source"), so nothing ever
  implies source-wide exhaustiveness. Giving narrow widths, and the extend frame, a collapsed scope affordance is
  an open improvement, not a claim this package makes.

Counts stay measured and bounded. Detect’s stat row is *Read 200 · With a message 198 · Similar to this event 17*
(the labels §21.7 specifies and the render draws). The Test and extend steps add "Counts describe this
bounded sample only, not the whole source." Nothing implies source-wide exhaustiveness.

> **Recommended production copy fix (design finding, not changed here).** The current Detect hint still reads
> "…from the current search scope (source, project, services, severity and time range)", which predates PR #60 and
> understates it. It should name the search itself, as the design does. Tracked as decision **D33**.

### 22.7 Assisted extraction

The step opens by saying what extraction *is* — "Extraction answers 'what values should Log Explorer pull out of
matching events?'. It is optional." — then shows one of three states:

1. **Suggestions** (`85-rule-extraction-suggestions`). A panel tagged *Suggestion · not saved* (one spelling, matching §21.7 and the render), a read-out
   ("Read from **17 matching events** in this search, out of **200 sampled**" — the create flow's own sample; the
   *extend* flow (§22.8) reads 18 of 200, and the two never borrow each other's numbers), and one row per candidate:
   checkbox · name · `Found in 17 / 17` coverage · editable output name · value type · *Never show* · preview ·
   remove. The footer adds *Add n selected values* and *Detect extractable values again*, and states what the rule
   already extracts.
   **Ships today:** checkbox, name, coverage as text, output name, *Never show*, remove, and both footer actions.
   **Design additions** (§22.11): the coverage *bar*, the value-type control (`valueType` already exists on the
   definition) and the per-row preview.
2. **Confirmed values** — the existing suggested/confirmed table (§21.8) is unchanged and remains the record of
   what will be saved. *Suggested* and *Confirmed* stay visually distinct.
3. **Nothing could be inferred** (`86-rule-extraction-no-suggestion`). Never a blank page: a titled explanation,
   why it happened, what extraction is for, and three ways forward — *Detect extractable values again*, *Add
   extraction manually*, *Skip extraction*.

Manual authoring stays first-class: Output name · From field · Method · Type · Sensitive in the normal form, with
RE2 pattern, capture group and JSON pointer behind **Advanced: how this value is read**. Regex never dominates the
ordinary path.

### 22.8 Add extraction from this event vs Create another tag rule

Two different intentions, so two different frames — the distinction is structural, not just wording:

| | Add extraction from this event | Create another tag rule |
|---|---|---|
| Changes | *What information* an existing classification pulls out | *Which identity* the event has |
| Frame title | **Add extraction to "Middleware HTTP call"** | **Create tag rule** |
| Trail | Search › Event › *the rule* | Search › Create tag rule |
| Steps | Values · Test · Save (3) | Source · Detect · Classification · Extraction · Test · Save (6) |
| Badge | *Extending a saved rule* | — |
| Result | One rule gains fields | The event gains a second tag |

Flow: event → *Add extraction from this event* → (choose the rule if several matched) → suggestions from this
rule's own matching events → review/edit → **Test** → coverage → **Save changes**, revision-protected.

- **One matching rule** → it is preselected and the editor opens directly on its values. *(Ships today.)*
- **Several** (`87-extend-choose-rule`) → a chooser lists each rule with its coloured tags, matcher summary and
  current extract count; each row's action is *Add values to this rule*. The panel also points at the other
  intention: "Looking for a new identity for this event instead? Use **Create another tag rule**."
  *(The chooser ships; the matcher summary, the extract count and that pointer are design additions.)*
- **Stale/deleted rule** (`90-extend-stale-rule`) → a truthful recovery state: nothing was created or changed,
  with *Reload rules*, *Choose another rule…* and *Create a tag rule from this event instead*. *(Production
  handles the case correctly today but says so as a plain notice on the rules list; the recovery panel is a
  design addition.)*

> **Implementation note for B4/B6 — do not fork the editor.** Production reaches this flow by opening the existing
> six-step editor in `edit` mode at `initialStep: 'extraction'`. The three-step frame is *chrome*: the same editor
> component, the same revision-protected save, the same limits and help, with its rail and title recomposed when
> the entry intent is "extend". Duplicating the save path to get a shorter rail would be a regression, not a
> restyle.

**Wording recommendation for production (D34).** The current labels are already unambiguous once the frames
differ, so no rename is required. If further clarity is wanted, the design's preferred pair is *Add fields to the
**middleware** rule* and *Create another classification* — both name the object being changed. This is recorded,
not applied, because it is production copy.

### 22.9 Import: tag-colour conflict

The import preview gains a fifth thing it can report, beside new / identical / rule conflict / invalid: a
**tag-colour conflict**. It shows the tag, the colour it has on this server and who gives it, the colour the pack
brings and who gives it, and requires an explicit choice. It is a blocker for both modes — MERGE and REPLACE ALL —
because neither may pick a winner.

**What ships today:** the server already computes the conflicts and returns them on the preview
(`ImportPreview.tagColorConflicts`), and it already refuses the write. The *frontend does not read that field*, so
today a user only meets the conflict after pressing Apply. Surfacing it before Apply is therefore new UI over an
invariant that already holds (§22.11 **A1a**), and it is the highest-value single addition in this sync.

**The second resolution cascades, and the panel says so.** Because a colour belongs to the *rule* and covers all of
its tags (D40), recolouring a tag recolours every rule linked to it by **any** shared tag. In the drawn pack the two
rules holding `external-api` also hold `partner`, which `Acquirer decline` holds in Purple — so *Change
"external-api" to Red everywhere* **reaches four rules, three of them repainted** (the imported rule arrives in Red
rather than changing) and turns `partner` Red with them. Whether `pci` turns Red depends on the *other*, still
unanswered choice on that screen: it exists only on the imported version of `Acquirer partner call`, so it joins the
Red set under *Use imported* and not under *Keep existing*. A panel whose purpose is exact disclosure of reach must
not state a consequence that holds on only one branch. Saving only
the two `external-api` rules in Red is not a smaller version of that choice: the real `TagColorPolicy` refuses it,
with the same error on `partner` that this panel exists to prevent (verified by running the policy against
`backend/target/classes`; see §22.11 A1b). The panel therefore states the reach of each answer and never calls
both of them local.

**What the drawn resolutions still need (§22.11 A1b).** Neither *Keep Purple* nor *Change "external-api" to Red
everywhere* can be carried out by the shipping API: the apply request has no tag-colour field, its
`conflictResolution` is the rule-level `KEEP_EXISTING`/`USE_IMPORTED` enum, and `applyImport` never rewrites a
`displayColor` — and the second option would rewrite saved rules that are **not in the pack**, including one that
does not carry the conflicting tag at all. A slice may
ship the panel with both options **disabled** and a single honest instruction (fix the pack, or change the colour
on this server first) and add the resolutions when A1b is decided. What must not happen is drawing two buttons
that cannot act.

### 22.10 Superseded by this section

| Was | Now | Where |
|---|---|---|
| "Exactly seven default columns" | Eight, with **Tags** among them | §22.3, CLAUDE.md §4, register §27 CSX-8 |
| D19 — tags as an optional column, hidden by default | **D30** — visible by default | IMPLEMENTATION_PLAN §3 |
| Neutral, colourless tag chips | Semantic palette, one colour per tag | §22.2 |
| Extraction step as a technical form | Assisted, with suggestions and a real empty state | §22.7 |
| "Detect samples the current search scope (source, project, services, severity, time)" | The committed search, minus the tag filter | §22.6 |
| §21.10's "≤ 767 px: stacked rule rows" | The rules list becomes cards at **≤ 1023 px**, and those cards draw every tag chip (§22.11 A11) | §22.3, A11 |

§21 is kept intact as the first-pass record. Nothing there is deleted; where it conflicts, this section governs.

### 22.11 What this design ADDS beyond current production

**Scope of this table: everything §22 specifies follows production unless it appears here.** These are proposals a
B-slice must *build*, not restyle. Each was checked against the code on `6e71af8`, and each is recorded in
`CURRENT_BASELINE_INVENTORY.md` §14.

It is not the package's only such table, and it does not claim to be: additions this sync did not introduce are
recorded where they were raised — §21.11 holds the earlier import additions (its items table's plain-language
*What applying does* column, and the Replace-all danger zone that enumerates the rules a pack would delete, where
production ships only the bare confirmation checkbox — decision **D24**), and
`CURRENT_BASELINE_INVENTORY.md` holds the Inspector's tag casing (§14 **C-19**, with the earlier half at **C-7**) (production upper-cases the
event's tag row while rendering the per-rule blocks in stored lowercase, so one panel shows both spellings; the
prototype draws one). Read §22.11 together with those, not instead of them.

| # | Addition | Why | Slice | Cost |
|---|---|---|---|---|
| A1a | **Import preview surfaces the tag-colour conflict.** The server already returns `tagColorConflicts` on the preview and already refuses the write; the frontend never reads it, so the refusal arrives after Apply | Moves a guaranteed refusal from after the commit to before it — the single highest-value addition here | B6 | Frontend only: read one existing field, render one panel, add it to the blockers |
| A1b | **Executing either resolution** drawn in `91-import-colour-conflict` (*Keep Purple* / *Change every "external-api" rule to Red*) | The panel is only honest if the choice can be carried out — otherwise it is a question with no answer | B6 | **Server work, not a restyle.** `ImportApplyRequestDto` has no tag-colour field, `ConflictResolution` is the rule-level `KEEP_EXISTING`/`USE_IMPORTED` enum, and `applyImport` never rewrites a `displayColor`. *Keep Purple* needs a new request field and a documented write rule; *Change every … to Red* additionally rewrites **saved rules that are not in the pack**, which no import mode does today and which needs an explicit owner decision before it is built |
| A2 | **Save-time colour conflict is shown under the Tag colour field**, in the words of §22.5, with two resolutions | Today the same refusal lands in the generic "not valid yet" list, addressed to nobody | B6 | Field-level error mapping for `rules[i].displayColor` |
| A3 | **The `+N` counter is neutral**, not a second chip in the first tag's colour | It counts identities; it is not one. Production tints it like the tag | B3 | CSS only |
| A4 | **Chip grammar: tinted pill + dot + neutral text** (production: coloured text on a tint) | Keeps tags from competing with severity's coloured ink — see `93-results-tag-not-severity` | B1, B3 | CSS only |
| A5 | **"Sampled from this search" scope component** on Detect, and the query line in the rail's scope block | Production still describes the pre-PR #60 scope in its Detect hint (D33) | B2, B6 | One component + a copy fix |
| A6 | **Suggestion row gains a coverage bar, a value-type control and a per-row preview** | `valueType` already exists on the definition; the bar makes coverage scannable | B6 | Three controls on an existing row |
| A7 | **Extend-a-rule chrome**: three-step rail, title naming the rule, "Extending a saved rule" badge, chooser extras (matcher summary, extract count), and a stale-rule recovery panel | Makes "add information" structurally unmistakable from "add identity" (D34, D37) | B4, B6 | Chrome only — **reuse the existing editor and its save**, see §22.8 |
| A8 | **Tags column narrows to 132 px when the Inspector is docked** (production: a flat 150 px) | Protects the message column at the width where it is most squeezed | B3 | One rule |
| A9 | **Picker hint corrected** (D38) and the tag-filter omission stated where the sample is described | Current hint claims a conflicting tag "keeps that rule's colour"; it does not — it is refused | B6 | Copy only |
| A10 | **Test-step extraction coverage as a table with a State column** ("Adding" / "Already saved") and a bar, where production renders a plain list of `label — extracted / of` | Separates what this edit adds from what the rule already extracted, at the moment the user is deciding whether to save | B6 | Frontend only; both columns are derivable client-side from the draft and the saved rule — no new data |
| A11 | **The rules *table* shows the first tag plus a neutral `+N`** where production renders a chip for every tag. Below ~1000 px the list becomes cards and draws every chip, as production does | Keeps the table scannable when a rule carries up to five tags; the full list stays in the accessible name, and the card layout has room for all of them | B6 | Frontend only |
| A12 | **Import preview draws each pack rule's tags as coloured chips** (production renders them as plain comma-separated text, `ImportPanel.tsx`), and gives every candidate row in the rule chooser the same primary action — production already does the latter, so only the chips are new | A pack is judged on what it would change; seeing the colour a rule brings is the whole point of the conflict panel above it | B6 | Frontend only; the colour is the pack rule's own |
| A13 | **Detect's evidence is drawn as tables and coverage bars** — *Stable structure*, *Changing parts* (Part · Kind · Example from this event) and *Suggested values* (name, coverage bar, `n / m`) — where production renders three plain `<ul>` lists and one coverage sentence (`RuleEditor.tsx`, "Stable structure" / "Variable parts" / "Suggested extractions", and the `Matches n of m similar events` hint) | Detect's whole job is to let someone judge a suggestion before adopting it; a bar and an aligned column are read at a glance, a bulleted sentence is not. No number changes — the same `sampledEvents`, `valuesWithField`, `similarEvents`, `coverage` and `suggestedExtractions` fields, drawn differently | B2, B6 | Frontend only; every value is already on the `DetectionResult` the endpoint returns |

**A1b is the one exception, and it is deliberate:** every other row here is presentation over behaviour that
already ships, and none of them changes an endpoint, a limit or a security guarantee. A1b does change the import
request and the write semantics, so it is called out separately rather than hidden inside a "one panel" costing.
A slice may ship **A1a alone** — surfacing the conflict before Apply is worthwhile even while both resolutions
still say *reload and fix the pack* — and treat A1b as its own decision. If a slice other than A1b finds itself
altering what the server does, it has misread this table.
