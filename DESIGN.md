---
name: Log Explorer
description: A dense, professional investigation workstation for structured application logs
colors:
  signal-blue: "#2359d1"
  signal-blue-deep: "#1a48ad"
  signal-blue-tint: "#eaf1fe"
  instrument-gray-canvas: "#f7f8fa"
  instrument-gray-surface: "#ffffff"
  instrument-gray-hover: "#f0f2f5"
  instrument-gray-selected: "#eaf1fe"
  border: "#d8dce3"
  border-strong: "#b7bdc9"
  ink-primary: "#1a1d23"
  ink-secondary: "#5b6270"
  ink-tertiary: "#868d99"
  ink-inverse: "#ffffff"
  severity-error: "#b3261e"
  severity-error-bg: "#fdecea"
  severity-warn: "#8a5a00"
  severity-warn-bg: "#fff6e0"
  severity-info: "#1a5e9a"
  severity-info-bg: "#e8f2fc"
  severity-debug: "#5b6270"
  severity-debug-bg: "#f0f2f5"
  severity-trace: "#7a5ba6"
  severity-trace-bg: "#f3edfb"
  protected: "#5b6270"
  protected-bg: "#f0f2f5"
  danger: "#b3261e"
  danger-bg: "#fdecea"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  data:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.45
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue-deep}"
  button-secondary:
    backgroundColor: "{colors.instrument-gray-surface}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: Log Explorer

## Overview

**Creative North Star: "The Instrument Panel"**

Log Explorer's current, frozen functional baseline is a precision control
surface, not a marketing surface — built for someone who reads it dozens
of times a day, under time pressure, looking for one specific answer.
Every visible element earns its place through information value, not
expression: a single restrained accent marks state (selection, focus,
active), severity is never color-only, and the interface stays flat and
quiet so the *data* — not the chrome around it — is what the eye lands
on. This is deliberately the opposite of a "generated dashboard" aesthetic:
no gradients, no card-in-card nesting, no oversized whitespace, no
decorative iconography. Density and legibility are treated as the same
goal, not a tradeoff.

The system is confirmed flat-by-default: two soft shadows exist in the
entire codebase (both under `rgba(16,24,40,0.12)`), used sparingly rather
than as an elevation language. Depth and structure come from 1px borders
and background-tint contrast, not from lifting surfaces off the canvas.
Radii are small (4–10px) and consistent; nothing is pill-shaped or
heavily rounded. Real semantic HTML carries every interactive affordance
— a `<button>` fills each clickable cell, a real `<table>` carries the
results, sortable headers are real buttons, never a styled `<div>`
standing in for one.

**Key Characteristics:**
- One accent color, used only to mark state — never as decoration
- Flat surfaces, 1px borders instead of elevation, near-zero shadow use
- Monospace reserved for timestamps, identifiers, and query/stack-trace text; everything else is the system sans stack
- Severity and state are always dual-coded (a colored dot/rail *and* text/an icon/an `aria-*` attribute), never color alone
- Dense 4/8px spacing scale used with total consistency — no ad hoc pixel values found anywhere scanned
- Confirmed visual rejection (CLAUDE.md §7, enforced): gradients, glassmorphism, card clutter, pill overload, novelty animation, huge hero areas

## Colors

The palette is almost entirely neutral, with one accent used exclusively to mean "this is selected, active, or focused" — never decoratively.

### Primary
- **Signal Blue** (`#2359d1`, hover `#1a48ad`, tint `#eaf1fe`): the one accent. Marks selection (results-table selected row, active tab, active filter chip), links/interactive IDs, focus rings, and primary-action buttons. Used sparingly — most of any given screen carries no color at all.

### Neutral
- **Instrument Gray — Canvas** (`#f7f8fa`): the page background and table header background; recedes behind content.
- **Instrument Gray — Surface** (`#ffffff`): raised surfaces — panels, the table body, dialogs.
- **Instrument Gray — Hover** (`#f0f2f5`): hover state for rows and ghost/secondary buttons.
- **Instrument Gray — Selected** (`#eaf1fe`, shared with Signal Blue tint): selected-row background.
- **Border** (`#d8dce3`) / **Border, strong** (`#b7bdc9`): the primary structural device — nearly all depth/grouping is communicated with a 1px border, not a shadow.
- **Ink — Primary** (`#1a1d23`) / **Secondary** (`#5b6270`) / **Tertiary** (`#868d99`): a genuine three-step text hierarchy — primary content, secondary/supporting labels (e.g. the calendar-date half of a timestamp), and tertiary/least-emphasized text.

### Semantic (severity)
Five severity colors, each paired with its own tint background, and each **always** shown with a matching text label and a small dot/rail — never as a color swatch alone:
- **Error** (`#b3261e` / bg `#fdecea`) — the only severity that also tints its entire table row (at 60% mix over transparent) and carries a left-edge rail.
- **Warn** (`#8a5a00` / bg `#fff6e0`) — rail only, no row tint (deliberately less visually loud than Error).
- **Info** (`#1a5e9a` / bg `#e8f2fc`), **Debug** (`#5b6270` / bg `#f0f2f5`), **Trace** (`#7a5ba6` / bg `#f3edfb`) — dot + label only, no row-level emphasis.
- **Protected** (`#5b6270` / bg `#f0f2f5`): the visual treatment for masked/protected field values — deliberately the same muted tone as Debug, not alarming, since masking is the safe default state, not an error condition.

### Named Rules
**The One Signal Rule.** Signal Blue is the only color in the system that means "you did something" or "this is active." It never appears as a background tint on a static, non-interactive, non-selected element.

**The Never-Color-Alone Rule.** Every severity, selection, or state cue pairs its color with a second signal — text, an icon, a border-shape change, or an `aria-*` attribute. Confirmed throughout `ResultsTable.module.css` (row state comments), `SeverityFilter`, and `InspectorTabs` (tab selection is border-weight + color + `aria-selected`).

## Typography

**Body Font:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` (the OS-native UI stack — deliberately not a webfont; this is a tool, not a brand surface)
**Data/Mono Font:** `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`

**Character:** Plain, OS-native, fast-rendering, zero-personality-by-design — legibility and familiarity over typographic voice. The one deliberate typographic move is functional: monospace is reserved for exactly the content where character-width alignment and unambiguous reading matter (timestamps, correlation/trace/journey/event IDs, query syntax, stack traces) — never used decoratively.

### Hierarchy
- **Title** (700, 18px, 1.45): the app shell's own title only ("Log Explorer").
- **Body** (400, 14px, 1.45): the default size for nearly everything — filters, table cells (except IDs/time), inspector prose, form labels.
- **Label** (500, 12px, 1.45, `0.02em` tracking, uppercase where used): table column headers and small structural labels — the smallest text in the system, used only for structural/navigational text, never body content.
- **Data** (400, 12px monospace, 1.45): timestamps and every identifier field (Trace/Span/Correlation/Journey/Event ID).

### Named Rules
**The Two-Font Rule.** Exactly two font families exist in the entire system: the OS sans stack for everything a human reads as prose/labels, and the mono stack for everything a human reads as exact data. No third font, no display face, no webfont load.

## Layout

Desktop-first, optimized for 1920/1440/1280px, required to remain usable down to 1024/768px (CLAUDE.md §7). The results table itself declares `min-width: 1266px` and scrolls horizontally below that width rather than crushing its own columns — the page body never scrolls horizontally; only the table's own wrapper does.

Structural rhythm is the 4/8px spacing scale (`--space-1` through `--space-8`, 4px–32px) used with total consistency — every padding/gap value found in this scan traces back to that scale, with no off-scale pixel values. The app shell is a single sticky header (source/time-range/severity/search/actions) above a filter-chip row above the results table, which fills the remaining viewport. The Inspector is a right-hand panel with its own sticky header and sticky tab bar, independently scrollable from the results table beside it — both stay reachable at once rather than one obscuring the other.

## Elevation & Depth

Flat by default. The entire scanned codebase contains exactly two shadow values (`--shadow-sm: 0 1px 2px rgba(16,24,40,0.06)`, `--shadow-md: 0 4px 12px rgba(16,24,40,0.12)`), both understated. Structure and grouping are communicated almost entirely through 1px borders and background-tint contrast (canvas vs. raised-surface vs. hover vs. selected), not through lifting elements off the page. Sticky positioning (table header, Inspector header/tabs) is used for reachability, not as a depth cue.

### Named Rules
**The Border-Over-Shadow Rule.** Depth is never the default way to separate content. A 1px border or a background-tint step does the job first; a shadow is reserved for the rare case (if any) where sticky/overlaid content needs a functional separation cue, not for routine "raised card" styling.

## Shapes

Small, consistent radii: 4px (`--radius-sm`, small controls, focus-ring corner), 6px (`--radius-md`, buttons, the table's own outer wrapper), 10px (`--radius-lg`, the largest surfaces — dialogs/panels). Nothing in the scanned system uses a fully pill/circular radius except the severity dot (8px circle, `border-radius: 999px`) and the 4px accent selection rail, both of which are single-purpose state indicators, not a general shape language. Borders are uniformly 1px (`--border-width`). No clipping, masking, or decorative geometry was found anywhere in the scan.

## Components

### Buttons
- **Shape:** 6px radius (`--radius-md`), 1px border on non-primary variants (transparent on primary/ghost).
- **Primary:** Signal Blue background (`#2359d1`) / inverse text, `8px 12px` padding (`--space-2 --space-3`), 13px/500-weight label.
- **Hover:** primary darkens to `#1a48ad`; secondary/ghost fill with Instrument Gray Hover (`#f0f2f5`).
- **Secondary:** raised-surface background, bordered, primary-ink text — the default for non-destructive, non-primary actions.
- **Ghost:** transparent background, secondary-ink text — the quietest tier, for auxiliary actions.
- **Pressed/active state:** `aria-pressed="true"` on ghost or secondary repaints as accent-tint background + accent border + accent text — the same visual language selection uses elsewhere, deliberately reused rather than inventing a second "active" language.
- **Disabled:** `opacity: 0.5` plus `cursor: not-allowed` — no separate disabled palette.

### Tables (signature component — the product's core surface)
- **Structure:** one real semantic `<table>`, `table-layout: fixed`, `border-collapse: collapse` — never a div-grid impersonating a table.
- **Header:** sticky, uppercase 12px label type, canvas-gray background, secondary-ink text.
- **Row states, in cascade-deliberate order:** default → hover (gray fill) → focus-visible (2px inset accent ring) → selected (accent-tint fill + 4px accent left rail, survives hover) → context-root (accent-tint fill + 3px accent rail + dashed accent outline, distinct pattern from "selected" so both can coexist legibly).
- **Severity emphasis:** Error rows alone get a full-row tint (60%-mixed error-bg) plus a 3px left rail; Warn gets the rail only; Info/Debug/Trace get no row-level treatment, only their cell-level dot + label.
- **Density:** a `.compact` modifier reduces padding only — font-size is explicitly never reduced by density (accessibility floor).
- **Data typography:** monospace for Time and all ID cells; secondary-ink for the date half of a timestamp, primary-ink for the clock half (the half that actually differentiates adjacent rows).

### Tabs (Inspector)
- **Style:** flat text tabs in a sticky bar, 2px bottom-border indicator, no pill/box background for the active state.
- **Selected:** accent text + accent bottom-border — border weight and color both change together, plus `aria-selected`, so the cue is never color-only.
- **Focus:** 2px accent ring, inset.

### Inputs / Fields
- **Style:** bordered, raised-surface background, 6px radius (consistent with buttons).
- **Focus:** 2px solid accent outline with 2px offset (the same `:focus-visible` treatment used globally, including on table rows and tabs — one focus language for the whole app, not a per-component variant).

## Do's and Don'ts

### Do:
- **Do** use Signal Blue only to mean "selected, active, or focused" — never as decoration or to draw attention to a static element.
- **Do** pair every severity/state color with a second, non-color signal (text label, icon, border pattern, `aria-*` attribute).
- **Do** keep the results table a real semantic `<table>` with fixed layout — never simulate a table with flex/grid rows.
- **Do** reserve monospace exclusively for timestamps, identifiers, and query/stack-trace text.
- **Do** communicate structure/grouping with borders and background-tint steps before reaching for a shadow.
- **Do** keep the 4/8px spacing scale exact — no off-scale spacing values.

### Don't:
- **Don't** add a second accent color — the system is built on the premise of exactly one.
- **Don't** introduce card-in-card nesting, gradients, glassmorphism, or decorative icon tiles (CLAUDE.md §7's explicit rejections, and confirmed absent from every file scanned).
- **Don't** reduce table font-size to achieve a denser layout — density changes padding only.
- **Don't** let a hover state visually erase a selected or context-root row; the cascade order (hover → focus → selected → context-root) is deliberate and must be preserved by anything that touches these rules.
- **Don't** use a shadow as the default way to indicate a raised/grouped surface — that's a border's job here.
