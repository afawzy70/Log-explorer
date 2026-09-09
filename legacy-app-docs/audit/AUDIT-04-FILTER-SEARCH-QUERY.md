# Audit 04 — Filter / Search / Query

**Scope:** Every filter and search/query mechanism in the OLD app, including the full simple-query grammar, the guided query builder, advanced filters, free-text, scope detection, and raw LogQL status.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Filter surface (UI)

| Filter | Control | Semantics |
|--------|---------|-----------|
| Time range | `TimeRangeSelector` | presets **5m / 15m / 30m / 60m / 24h / custom**; custom commit is local→UTC ISO exactly once (`localToUtcIso`); validation: both present, valid, start<end, ≤**30 days** (`MAX_CUSTOM_RANGE_MS`), end not in future. |
| Severity / level | `SeveritySelector` | chips over `LOG_LEVELS` = TRACE/DEBUG/INFO/WARN/ERROR; All / Errors-only shortcuts; default `DEFAULT_SEVERITIES`. |
| Services | `SearchableServiceCombo` | searchable multi-select of discovered services; listbox combobox (a11y). |
| Advanced "who" fields | `MoreFilters` | userName, customerId, cif, deviceId, deviceIp (all **sensitive**, masked). |
| Advanced request-flow fields | `MoreFilters` | traceId, spanId, correlationId, journeyId, eventId (structured exact fields). |
| Advanced "what" fields | `MoreFilters` | errorCode, businessStep, uiIdentifier, logger, text. |
| Advanced client fields | `MoreFilters` | devicePlatform, language. |
| Advanced-query mode | `MoreFilters` | **Builder** (guided tree), **Text** (simple-query string), **Raw LogQL**. |
| Active filter chips | `ActiveFilterChips` | per-chip remove + Clear all; sensitive values shown **masked** (`"p***"` etc.). |

Field semantics: exact-match vs substring per `ADVANCED_FIELDS` metadata.

---

## 2. Free-text / universal search

- `UniversalSearch` input with **identifier scope suggestions** (`utils/search.ts` `detectIdentifier`).
- `detectIdentifier` heuristics: HEX16/32/128, UUID, known prefixes (trace/trc, corr/correlation, journey/jour, evt/event), error-code regex `^[A-Za-z][A-Za-z0-9_]*_\d+$`. Returns **candidate suggestions only — never auto-selected** (default: message+errorCode).
- Scope chip can be set/cleared to: `message`, `errorCode`, `traceId`, `correlationId`, `journeyId`, `eventId`.
- Default free text builds: `message contains "s" or errorCode contains "s"` (OR).
- Escape: `escapeSimpleQueryText` escapes `\` and `"`.
- Global shortcut: Enter submits; **Ctrl/Cmd+Enter runs** (App-level keydown).

---

## 3. Simple-query grammar (backend `SimpleQueryParser`)

```
Expression : AndExpr ( 'or' AndExpr )*
AndExpr    : Comparison ( 'and' Comparison )*
Comparison : '(' Expression ')' | field Op string
Op         : '=' | '!=' | 'contains'
field      : IDENTIFIER (dots allowed, e.g. device.platform)
string     : '"' STRING '"'   (escapes \" \\ \n \r \t)
```

- **AND binds tighter than OR.** Parentheses override.
- Keywords case-insensitive: `contains`, `and`, `or`.

### Supported fields (`SimpleQueryField`)

**Non-restricted (match by value):**
`service`, `level`, `message`, `logger`, `traceId`, `spanId`, `correlationId`, `journeyId`, `eventId`, `errorCode`, `businessStep`, `uiIdentifier`, `device.platform` (from `mdc.devicePlatformType`), `language` (from `mdc.language`).

**Restricted / sensitive (matched only via keyed HMAC tokens — `SearchTokenService`):**
`userName`, `customerId`, `cif`, `deviceId`, `deviceIp`.

### Match semantics
- Non-restricted: `=` case-insensitive equals; `!=` case-insensitive not-equals; `contains` substring. Absent field: `!=` matches, `=`/`contains` do not.
- Restricted: `=`/`!=` compared via constant-time HMAC token equality; **`contains` not supported** on restricted fields (returns false). Raw values never used for matching (`extractField` → `MASKED_VALUE`).

### Compile & push-down (`SimpleQueryCompiler`, `SimpleQueryPlanner`)
- Compiled to an in-memory `Predicate<LogEvent>` used as a **post-filter**.
- Push-down to source is limited to `service` / `level` with `=` (Loki label selector `{app="x", level="ERROR"}`). `NEQ`, high-cardinality, `contains`, and all restricted fields are post-filtered (with a warning: "N condition(s) require server-side post-filtering").
- Response exposes `generatedLogql`, `pushDownConditions`, `postFilterConditions`.

### Validation
- Maximum literal length 256 per field; `simpleQuery` max 4096 (frontend `validateAdvanced`).
- Invalid simple query → HTTP 400 with a response carrying only sourceId/timestamps + warnings/errors.
- `SimpleQueryException` sanitizes messages (strips quoted literals).

---

## 4. Guided query builder (`utils/queryBuilder.ts` + `QueryBuilder.tsx`)

- Tree model: rows (`field op value`) and groups with `and`/`or` connectors, rows/group nesting.
- `QB_FIELDS` master list: service, level, message, logger, errorCode, businessStep, uiIdentifier, traceId, spanId, correlationId, journeyId, eventId, device.platform, language + sensitive userName/customerId/cif/deviceId/deviceIp (`=`/`!=` only).
- Ops: `=` / `!=` / `contains` (per-field restricted set).
- Serialization emits `<field> <op> "escaped"` joined by ` and ` / ` or `, groups wrapped in `()`.
- Validation: value required, ≤256 chars, no control chars.

---

## 5. Request assembly (`App.tsx handleRun` + `advancedFilters.ts`)

- Structured advanced fields (`traceId, spanId, correlationId, journeyId, eventId, errorCode, businessStep`) applied as **exact request fields** (`applyAdvancedToRequest`).
- Non-structured advanced fields emitted as `<canonical> = "escaped"`; `text` → `(message contains "…" or errorCode contains "…")`.
- Guided mode combines: `simpleQuery = (builder/advanced expr) AND (free-text expr)`, both parenthesised.
- Raw LogQL mode sets `rawLogQl` + `rawLogQlMode=true` and **takes precedence** over guided.

---

## 6. Raw LogQL — status

| Layer | State |
|-------|-------|
| UI | Raw LogQL tab exists in MoreFilters; sets `rawLogQlMode=true`. |
| Request DTO | `rawLogQl` + `rawLogQlMode` fields exist. |
| Backend constructor | **force-sets `rawLogQlMode=false`** (`LogSearchRequest.java:70-73`) — the branch is unreachable. |
| Capability | `RAW_LOGQL` capability enum exists but **no source advertises it**. |
| Config | `logexplorer.query.rawLogQl.enabled=false` (yml). |

**Conclusion:** Raw LogQL is **present in the UI but non-functional end-to-end** (dead path). See Audit 16.

---

## 7. Search metadata returned

`SearchMeta` / `Response` exposes: events, execution duration, result interval, estimate (`QueryStatistics.available/totalMatching/returned`), query-plan, generated LogQL (in a `<details>`), warnings, truncated flag.

---

## Consolidated gaps (filter/search/query)

1. **Raw LogQL dead end-to-end.**
2. **Sensitive `contains` unavailable** (by design, HMAC — documented).
3. **Push-down limited** to service/level `=`; high-cardinality post-filtering only.
4. **`last-query` not persisted** (one-way restore).
5. **Max search window 30 days** (hard limit).
6. **Result limit cap 5000**.
