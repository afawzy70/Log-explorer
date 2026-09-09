# Audit 01 — Frontend Surface

**Scope:** The complete user-facing surface of the OLD app: views, layout regions, controls, states, responsive behavior, and accessibility posture.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Top-level views & routing

The app is a single page with no URL routing (query is deliberately never placed in the URL). `App.tsx` holds a `view` state with two values:

| View | Rendered when | Contents |
|------|---------------|----------|
| `search` (default) | `view === 'search'` | Search workspace: toolbar, MoreFilters panel, results area, Live Tail workspace, EventTimeline/ContextView, persistent EventInspector. |
| `settings` | `view === 'settings'` | `SettingsPage` (masking + unmask) and `DockerConnectionPanel`. |

Navigation via `AppHeader` Search/Settings buttons (`AppView`).

An additional **dev-only** "route": `UiLab` at `/ui-lab`, gated by `import.meta.env.DEV` (`main.tsx`). Not part of production.

---

## 2. Search workspace layout (search view)

Ordered (top → bottom):

1. **AppHeader** — product title (single `<h1>Log Explorer</h1>`), SourceBadge + source name, Search/Settings nav, HealthIndicator, keyboard-shortcuts help popover.
2. **Source bar** — `SourceSelector` (Local Docker Compose / OpenShift Development) + `SearchableServiceCombo` (services multi-select).
3. **Search toolbar** (a `<form>`) —
   - `UniversalSearch` (free text + identifier scope suggestions)
   - `TimeRangeSelector` (preset select + custom popover)
   - `SeveritySelector` (All / Errors-only + level chips)
   - `RunCancelControls` (Run Search / Cancel)
4. **Active filter chips** — `ActiveFilterChips` (masked labels for sensitive) + Clear all.
5. **More Filters** — lazy side-panel (`MoreFilters`) opened from toolbar: advanced fields + advanced-query disclosure (Builder/Text/Raw LogQL).
6. **Results area** — `SearchMeta`, `ResultsToolbar`, then one of:
   - `SearchLoading` (skeleton, when loading)
   - `SearchEmpty` (empty / error state with suggestions)
   - `EventTable` (on results)
7. **Event Inspector** — persistent resizable `EventInspector` modal (see Audit 06).
8. **Investigation workspace** — when in `timeline` / `context` mode, the results area is replaced by `EventTimeline` / `ContextView` (lazy).
9. **Live Tail workspace** — `LiveTail` + `LiveConfirmDialog`, shown when `liveTailMode` is active.

---

## 3. Controls & interactive elements (surface map)

| Control | Element | Behaviour |
|---------|---------|-----------|
| Source select | native `<select>` | switches source; aborts in-flight request and clears results. |
| Service multi-select | `SearchableServiceCombo` (listbox combobox) | type-to-filter, arrows, Enter/Space toggle, Escape, clear, select-all. |
| Time preset | `<select>` | 5m/15m/30m/60m/24h/custom. |
| Custom time | popover with `datetime-local` inputs | local-time commit → UTC ISO; validation (order, ≤30d, no future end). |
| Severity | chips + All/Errors-only buttons | multi-toggle level chips; keyboard Enter/Space. |
| Free text | combobox input | Enter submits; Ctrl+Enter global run; identifier suggestions. |
| Scope chip | chip in UniversalSearch | sets/clears detected identifier scope (message/errorCode/traceId/correlationId/journeyId/eventId). |
| Run / Cancel | buttons | run builds request; cancel aborts (AbortController) + marks cancelled. |
| Columns dropdown | `ResultsToolbar` | toggle optional columns (required locked), reset order. |
| Sort/density | toolbar | sort newest/oldest; density comfortable/compact. |
| Refresh | toolbar | re-run in place. |
| Load next page | toolbar | increments limit by 100, appends deduped results. |
| Table row | `EventTable` | click/ArrowUp/ArrowDown select; Enter open inspector; Escape return. |
| ⋯ action menu | per-row | view details, show context, find-same-ID (only when IDs present). |
| Live tail | `LiveTail` | Start (via confirm dialog), Pause/Resume, Clear, Stop; Reconnect/Retry; follow-newest toggle; filters. |

---

## 4. States & empty/loading/error handling

All states share one visual language (token palette, spacing, icons, messaging):

| State | Component | Notes |
|-------|-----------|-------|
| Initial (no results yet) | — | placeholder; no jarring layout shift. |
| Loading | `SearchLoading` | skeleton, spinner under `prefers-reduced-motion`. |
| Empty (no matches) | `SearchEmpty` | suggestions (e.g. Widen filters, Search last 1 day). |
| Cancelled | handled in App | `cancelled` state; distinguishes aborted vs finished. |
| Partial / truncated | `ResultsToolbar` + `SearchMeta` | truncation warning + bounded "Load next page". |
| Source error / health down | `HealthIndicator` + App | red state + Retry button; error message. |
| Invalid custom time | `TimeRangeSelector` | inline validation message. |
| Invalid advanced query | `MoreFilters` | Apply blocked with inline error. |
| Malformed row | row indicator in `EventTable` | events with missing/invalid timestamps degrade to `'-'`; `(empty message)` fallback. |

---

## 5. Responsive behaviour (`index.css`)

| Breakpoint | Behaviour |
|-----------|-----------|
| ≥1440px | full table + inspector side by side. |
| 1024–1439px | compact toolbar/table; inspector narrower or overlay. |
| 768–1023px | toolbar wraps to rows; optional columns hidden by priority. |
| <768px | stacked search + event cards/sheet; desktop grid not squeezed; inspector as bottom sheet. |
| All | no horizontal page overflow (`html,body overflow-x:hidden`); contained `overflow-x:auto` scrollers keyboard-scrollable and labelled. |

Browser zoom 125%/200% and `prefers-reduced-motion: reduce` are handled (motion disabled; nothing essential hidden).

---

## 6. Accessibility posture

- **WCAG 2.2 AA** target: contrast ≥4.5:1 (body/UI), 3:1 (large text/UI).
- Zero `dangerouslySetInnerHTML` across `src`; all content rendered as text.
- Severity/connection state conveyed by **text+icon+colour**, never colour alone.
- Semantic structure: `<main>`, `role="search"`, real `<table>` with `<th scope="col">`, labelled dialogs.
- Keyboard-only workflows: search (Enter/Ctrl+Enter), filters (chips/checkbox), table rows (arrows/Enter/Escape), inspector (focus trap, Esc return), correlation rows (Enter/Space), live (start via dialog, pause/resume/stop).
- Focus always visible (token focus-ring); target size ≥24×24.
- Screen reader live region announces state transitions and batched counts, not per-event pings.
- `axe` automated gates: 6 active (per UX_ACCEPTANCE_REPORT); no disabled/skipped tests.

---

## 7. Settings view surface

| Region | Contents |
|--------|----------|
| Masking status | facts list (enabled/active/protected categories/remaining seconds), per-field on/off toggles. |
| Unmask | toggle + confirmation dialog (gated by `unmaskAvailable`); shows `whyUnmaskUnavailable`. |
| Docker connection | `DockerConnectionPanel`: Local/Remote mode, name, host, port (AUTO 2375 / CUSTOM), TLS + profile, Test/Save/Reset, inline validation; secret-free view. |

---

## 8. Consolidated surface gap notes

- **No `projectFilter` / `exclusionLabel` UI** in the frontend (the backend supports both via yml, but the DockerConnectionPanel exposes only mode/host/port/TLS).
- **`getSources()`/`getSystemInfo()` API methods exist but are unused** in the UI; the surface relies on static `KNOWN_SOURCES` (see Audit 00 §3.2).
- Legacy orphaned controls (`LogList`, `LogRow`, `GuidedFilters`, `QueryInput`, `QueryModeSelector`, `LevelSelector`) are **not on the surface** but remain in the codebase (see Audit 00 §1.2).
