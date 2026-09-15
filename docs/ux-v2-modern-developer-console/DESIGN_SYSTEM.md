# Design System — Modern Developer Console

This is the design proposal for owner-approved Direction B. It was written by LERDESIGN-1 and has not been
implemented in production. **Owner visual approval is required before any production work.**

- Functional baseline: latest `main` `3f6b1b4bc30c282e0cd1e65510697ff128d79d73`.
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
| **Source field** | Opens the source list, each source with its health word; the health segment opens **Source health details** (status, checked, latency, declared capabilities — state 27). First source auto-selected. For OpenShift/Loki the adjacent scope field reads Namespace › workload and opens the scope selector (Project, Workload, Pod, Container). |
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
