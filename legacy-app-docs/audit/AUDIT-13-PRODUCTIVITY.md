# Audit 13 — Productivity

**Scope:** Productivity, convenience, persistence, and performance features of the OLD app that affect daily use, and their gaps.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Preferences & persistence

### Structure
`SavedPreferences{sourceId, timePreset, levels, queryMode}` under key `logexplorer.preferences`, via `load()`/`save()`.

**Deliberately NOT persisted** (security):
- raw search text / query content
- any sensitive field value (cif, UserName, CustomerId, deviceId, deviceIp)
- `queryIsSensitive()` guard (matches sensitive patterns + `Bearer `).

Non-sensitive per-key strings may go through `loadNonSensitive`/`saveNonSensitive` (namespaced `logexplorer.<key>`). Only `last-query` is **loaded**; **nothing saves it** → see gap below.

### Table preferences
`TablePrefs{density, sort, visible}` under `logexplorer.table`: column visibility/order, density, sort; validated/deduped on load; required columns always re-asserted.

## 2. Shortcuts & convenience

| Shortcut / feature | Detail |
|--------------------|--------|
| Global **Ctrl/Cmd+Enter** | runs search from anywhere. |
| Enter | submits UniversalSearch. |
| Search last 1 day | one-click (preset 24h + run). |
| Default time preset | 30 minutes. |
| Identifier suggestions | paste an ID → confirmable scope chip (trace/correlation/journey/event/errorCode/message). |
| Row keyboard nav | arrows/Enter/Escape in table; focus return after close. |
| Inspector prev/next | search results. |
| Load next page | +100, deduped. |
| Refresh | re-run in place. |
| Reset column order | restore defaults. |
| Keyboard-shortcuts help | AppHeader popover. |
| Focus management | returns focus to search/relevant-row; honors reduced-motion. |

## 3. Performance features

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Lazy-loading | MoreFilters, EventTimeline, ContextView lazy chunks. | build: main ~233 kB raw / ~71 kB gzip + ~22 kB deferred. |
| Token consolidation | CSS tokens. | CSS ~56 kB raw / ~9.8 kB gzip. |
| Bounded rendering | 100/page table; 1000/100 live buffers; backend caps 5000/100k. | tests. |
| Abort stale searches | `AbortController` aborts prior on run/source-change/unmount. | manual + App tests. |
| Debounce only lookups | never debounce explicit Search. | UniversalSearch. |
| No unbounded DOM | bounded buffers + pagination. | grep + tests. |

## 4. Search/reporting conveniences

- `SearchMeta` shows events, duration, interval, estimate, query-plan, generated LogQL, warnings, truncated flag.
- `generatedLogQl`/`pushDownConditions`/`postFilterConditions` expose what was pushed down vs post-filtered.

## 5. Copy / sharing

- Copy buttons on non-sensitive fields (message, traceId, correlationId).
- Copy correlation full ID when a shortened one is shown.
- **No URL/persistent share links** (queries deliberately not placed in URL).

## 6. Masking convenience

- Per-field masking toggles in Settings.
- Session-scoped unmask (dev-only, gated) with TTL.
- Masked chips/labels everywhere sensitive data would appear.

---

## Productivity gaps (OLD)

1. **`last-query` restore is one-way** — `saveNonSensitive('last-query')` is never called, so the "restore last query" feature never persists (dead helper).
2. **No shareable/deep-link URLs** (by design, but limits sharing/collaboration).
3. **No saved/custom query presets** beyond the default time presets.
4. **No export** of search results or timeline (no CSV/JSON/PDF download).
5. **No alerting/watch** on results (only live tail).
6. **Prev/next inspector only on search results** (not live/context).
7. **`getSources()`/`getSystemInfo()` API unused** — capability delivery can drift from the static UI list.
