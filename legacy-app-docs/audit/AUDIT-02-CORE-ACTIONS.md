# Audit 02 — Core Actions

**Scope:** The primary user actions in the OLD app and the exact behaviour of each, with the implementation location and any caveats.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

All handlers live in `App.tsx` (frontend) unless otherwise noted. Handlers are `useCallback`-memoised.

---

## 1. Run search — `handleRun(override?, opts?)` (`App.tsx:247`)

- Builds a `LogSearchRequest`:
  - `sourceId` (selected source)
  - `start`/`end` (UTC ISO from `computeRange`; presets or validated custom)
  - `services`, `levels`, `direction` (from `tablePrefs.sort`), `limit` (`resultLimit`, default 100)
  - advanced filters applied via `applyAdvancedToRequest` (structured fields `traceId/spanId/correlationId/journeyId/eventId/errorCode/businessStep`)
  - scope-to-field mapping (errorCode / traceId / correlationId / journeyId / eventId)
  - free text composed for guided mode: `buildFreeTextQuery` ORs `message`/`errorCode`, then ANDed with the guided advanced expression in parentheses
  - **raw LogQL mode** (if active): sets `rawLogQl` + `rawLogQlMode=true`, takes precedence over guided.
- Uses an **AbortController**; a new run aborts any in-flight request.
- Sets `pendingFocusRef` for user-initiated runs (to move focus/collapse after results per `prefers-reduced-motion`).

**Caveats:**
- Raw LogQL in the frontend sets `rawLogQlMode=true`, but the **backend forces it to `false`** in `LogSearchRequest`'s constructor (`LogSearchRequest.java:70-73`). Net effect: the raw-LogQL search path cannot execute today and no source advertises `RAW_LOGQL` (see Audit 16).
- `limit` caps at 5000 on the backend; frontend starts at 100 and grows via Load more.

## 2. Cancel — `handleCancel` (`App.tsx:449`)

- Aborts the active `AbortController` and sets `cancelled=true`.
- Distinguishes a cancelled run from a finished one (frontend checks `err instanceof CancelledError`).
- Aborts are also triggered automatically on **source change** and on **unmount** (`App.tsx:525-527`).

## 3. Refresh — `handleRefresh` (`App.tsx:353`)

- Re-runs the search in place with current filters/limit (no change to state).

## 4. Search last 1 day — `handleSearchLastDay` (`App.tsx:358`)

- Sets time preset to 24h and runs. Wired to `SearchEmpty` suggestions and toolbar.

## 5. Apply custom range — `handleApplyCustomRange` (`App.tsx:368`)

- Reads draft custom start/end; validated by `validateCustomRange` (both present, valid dates, start<end, ≤30 days, no future end); commits and runs.

## 6. Load more — `handleLoadMore` (`App.tsx:375`)

- Increments `resultLimit` by 100.
- Appends results to the existing list, **deduplicated** (single shared column list).
- Backend supplies `truncated` + `nextCursor`, but **`nextCursor` is always `null`** (no cursor pagination — see Audit 16). Load-more is therefore a re-query with a larger limit, not true cursor pagination.

## 7. Table preferences

| Action | Handler | Effect |
|--------|---------|--------|
| Toggle column | `handleToggleColumn` (`App.tsx:536`) | shows/hides optional columns; required columns locked; persists via `saveTablePrefs`. |
| Density | `handleDensityChange` (`App.tsx:549`) | comfortable/compact; persists. |
| Sort | `handleSortChange` (`App.tsx:557`) | sets sort, **re-runs the search** with new direction/order; persists. |
| Reorder columns | `handleReorderColumns` (`App.tsx:574`) | drag/keys; persists. |
| Reset column order | `handleResetColumnOrder` (`App.tsx:582`) | restores default; persists. |

## 8. Row selection & inspector navigation

| Action | Handler | Detail |
|--------|---------|--------|
| Select row | `handleTableSelect` (`App.tsx:590`) | sets `selectedRow` index. |
| Copy | `handleCopy` (`App.tsx:595`) | clipboard copy for non-sensitive fields only. |
| Inspector previous/next | `handleInspectorPrevious/Next` (`App.tsx:600/608`) | bounded by `index<=0` / `>=total-1`; **search results only** (not live/context). |
| Open details | row ⋯ menu / Enter | opens `EventInspector`. |

## 9. Edit / clear

| Action | Handler | Detail |
|--------|---------|--------|
| Edit search | `handleEditSearch` (`App.tsx:520`) | returns focus to `#universal-search`; reopens form. |
| Clear all | `handleClearAll` (`App.tsx:844`) | resets filters/query to defaults. |

## 10. Live tail actions (see Audit 08)

| Action | Handler | Detail |
|--------|---------|--------|
| Open confirmation | `openLiveConfirmation` (`App.tsx:731`) | shows `LiveConfirmDialog`. |
| Confirm start | `confirmStartLive` (`App.tsx:735`) | starts SSE; **historical actions exit live mode first** (`App.tsx:755-763`). |
| Cancel confirmation | `cancelLiveConfirmation` (`App.tsx:742`) | closes dialog. |
| Exit live tail | `exitLiveTail` (`App.tsx:744`) | stops stream + closes workspace. |
| Select tail event | `handleSelectTailEvent` (`App.tsx:749`) | sets selected event for inspector. |
| Open context from live | `handleLiveOpenContext` (`App.tsx:755`) | requires exiting live mode first. |
| Find from live | `handleLiveFind` (`App.tsx:760`) | find-same-ID from live event. |

## 11. Timeline / investigation actions (see Audit 07)

| Action | Handler | Detail |
|--------|---------|--------|
| Enter timeline | `enterTimeline` (`App.tsx:617`) | switches to timeline mode with title/type/identifier. |
| Exit timeline | `exitTimeline` (`App.tsx:623`) | "Return to search"; restores prior results. |
| Search by ID | `handleSearchTraceId/CorrelationId/JourneyId/EventId` (`App.tsx:675-701`) | find-same-ID. |
| Find | `handleFind` (`App.tsx:703`) | generic find handler. |
| Show context | `handleShowContext` (`App.tsx:710`) | ±30s surrounding window; clears/sets `contextAnchor`. |

## 12. Source switching

| Action | Detail |
|--------|--------|
| Switch source | via `SourceSelector` | **aborts any in-flight request and clears results**; re-fetches health + services; resets relevant state. |
| Health retry | `handleHealthRetry` (`App.tsx:181`) | re-polls source health. |
| Docker connection changed | `handleDockerConnectionChanged` (`App.tsx:196`) | full reset + reload (source health, services). |

---

## Consolidated caveats (core actions)

1. **Raw LogQL is frontend-visible but backend-dead** (constructor force-off + no `RAW_LOGQL` capability + yml off).
2. **Load-more is not cursor-based** (`nextCursor` always null).
3. **Inspector prev/next is search-only** (not available in live/context).
4. **`last-query` restore never persisted** (`saveNonSensitive` dead) — so a reload does not reliably restore the last advanced simple query.
