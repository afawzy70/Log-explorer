# Audit 05 — Event Table

**Scope:** The OLD app's results table (`EventTable`), its column model, row semantics, selection, sorting, reordering, persistence, and keyboard/accessibility behaviour.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Structure & semantics

- A real semantic `<table>` with `<th scope="col">` named headers, sticky header row.
- Rendered in the search results area (App) and **reused inside `LiveTail`**.
- Bounded rendering: at most `PAGE_SIZE` rows per page (100); no unbounded DOM.
- Zero `dangerouslySetInnerHTML`; all cell content rendered as text (HTML injection safe).

---

## 2. Column model (`utils/eventTable.ts`)

| Key | Header | Required | Notes |
|-----|--------|----------|-------|
| `time` | Time | Yes | browser-local; exact ms via `title`/`aria-label` (`YYYY-MM-DD HH:MM:SS.mmm UTC`). |
| `level` | Level | Yes | severity icon dot + text + colour (not colour-only). |
| `service` | Service | Yes | |
| `message` | Message | Yes | "What" dominant column; truncated; expandable; `(empty message)` fallback. |
| `actor` | User / customer | Yes | **masked** protected value (hint "Masked protected value"); resolved by priority `UserName > CustomerId > cif > deviceId > deviceIp`. |
| `correlation` | Correlation | Yes | shortened visually (8-char `shortId`), full ID kept for copy/search. |
| `date` | Date | Optional | |
| `source` | Source | Optional | |
| `container` | Container | Optional | |
| `errorCode` | Error code | Optional | |
| `businessStep` | Business step | Optional | |
| `journeyId` | Journey | Optional | |
| `logger` | Logger | Optional | |

- `DEFAULT_VISIBLE_COLUMNS` = time, date, level, service, message, actor, correlation.
- Optional columns are hidden by responsive priority below 1024px.

---

## 3. Row semantics & selection

- Selection state (`selectedRow` index) lives in `App`.
- **Keyboard:** ArrowUp/ArrowDown move between rows; Enter opens inspector; Escape returns focus to originating row.
- **Click:** selects row, opens inspector.
- **⋯ action menu** per row: view details / show context / find-same-ID — **only shown when IDs/actors are present**.
- **Mirror row in live tail** shares the same EventTable.

## 4. Sorting, density, columns, reorder

| Feature | Behaviour |
|---------|-----------|
| Sort | `tablePrefs.sort` = newest/oldest; changing sort **re-runs the search** with new direction (`App handleSortChange`). |
| Density | `comfortable` / `compact`. |
| Column visibility | optional toggles; **required columns locked** (cannot be hidden). |
| Column order | drag + keyboard reorder (`reorderColumns`, `moveColumnLeft/Right`); `resetColumnOrder`. |
| Persistence | `TablePrefs{density, sort, visible}` under key `logexplorer.table`; `loadTablePrefs` validates/dedupes, always re-asserts required columns; `saveTablePrefs`. Order preserved on reload (never re-sorted to canonical). |

All mutations return new prefs objects (immutable; never mutate in place).

## 5. Data edges & malformed handling

- Missing/invalid timestamp degrades via format helpers to `'-'`.
- Empty message → `(empty message)` fallback.
- Actor resolution skips whitespace-only values.
- Correlation picks `correlationId || traceId`; shortened for display, full for copy/search.

## 6. Toolbar (acting on the table)

`ResultsToolbar` provides: count summary, sort, density, Columns dropdown (optional toggles + required-locked), Reset order, **Refresh** (re-run in place), **Load next page** (limit +100, deduped append; `nextCursor` is always null on the backend).

## 7. Accessibility

- Sticky named `<th scope="col">`.
- Severity conveyed by icon + text + colour (not colour only).
- `aria-label` for icon-only controls (e.g. Actions ✕ has sr-only label).
- Rows keyboard-activatable; selection focus management with `focusTrap`.
- Table/grid announced with meaningful headers.

## 8. State variants embedded in the table area

`SearchLoading` skeleton → `SearchEmpty` (empty w/ suggestions) → `EventTable` (data) / error state; all share one visual language (see Audit 01 §4).

---

## Gaps / notes (OLD)

1. **No true cursor pagination** — Load-more is a larger-limit re-query (backend `nextCursor` null).
2. **Actor column depends on masked MDC presence**; if events lack sensitive MDC, no actor shown.
3. **Required columns cannot be hidden** by design.
4. Legacy `LogList`/`LogRow` are dead code superseded by this table (see Audit 00).
