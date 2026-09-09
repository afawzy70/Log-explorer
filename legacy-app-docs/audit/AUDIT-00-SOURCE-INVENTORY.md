# Audit 00 — Source Inventory

**Scope:** Complete inventory of every source file in the OLD app (this repository), its wiring status, and its disposition for migration planning.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** — the NEW app was unreachable, so nothing is asserted about NEW here.
>
> All paths are relative to the repo root. Frontend root = `frontend/src`, backend root = `backend/src/main/java/com/example/logexplorer`.
>
> Wiring status legend:
> - **WIRED** — referenced/imported by code reachable from the running production app.
> - **DEAD/ORPHANED** — never imported by app code (only its own test / dev-only UI).
> - **DEV-ONLY** — reachable only in a dev-only route, not in production bundle/navigation.
> - **CONFIG / RESOURCE / TEST** — non-code files and test-only files.

---

## 1. Frontend source inventory (`frontend/src`)

### 1.1 Application entry & orchestration

| File | Kind | Status | Notes |
|------|------|--------|-------|
| `main.tsx` | TSX | WIRED | Mounts `<App/>`; conditionally mounts `<UiLab/>` only when `import.meta.env.DEV && path === '/ui-lab'`. |
| `App.tsx` (1141 lines) | TSX | WIRED | Top-level orchestration: state, handlers, view routing (search/settings), lazy loads MoreFilters/EventTimeline/ContextView, global Ctrl+Enter. |
| `index.css` | CSS | WIRED | Design tokens, focus-ring, responsive breakpoints (≥1440 / 1024–1439 / 768–1023 / <768), `prefers-reduced-motion`, `html,body overflow-x:hidden`. |
| `vite-env.d.ts` | TS | WIRED | Vite type references. |

### 1.2 Components

| File | Status | Purpose |
|------|--------|---------|
| `components/AppHeader.tsx` | WIRED | Header: title, SourceBadge, Search/Settings nav, HealthIndicator, keyboard-shortcuts help popover. |
| `components/SourceSelector.tsx` | WIRED | Native `<select>` over `KNOWN_SOURCES` (Local / OpenShift). |
| `components/HealthIndicator.tsx` | WIRED | Unknown/ok/down tri-state dot + label, optional Retry when down. |
| `components/SourceBadge.tsx` | WIRED | "Local"/"OpenShift" pill from `def.badge`. |
| `components/OriginBadge.tsx` | WIRED | Docker container / K8s pod+namespace origin chip (used in EventTimeline). |
| `components/TimeRangeSelector.tsx` | WIRED | Presets (5m/15m/30m/60m/24h/custom) + custom local-time popover with validation + Apply/Cancel. |
| `components/SeveritySelector.tsx` | WIRED | All/Errors-only shortcuts + level chips; exports `DEFAULT_SEVERITIES`, `SEVERITY_ICONS`. |
| `components/ActiveFilterChips.tsx` | WIRED | Active-filter chips (masked labels for sensitive) with per-chip remove + Clear all. |
| `components/SearchableServiceCombo.tsx` | WIRED | Searchable multi-select listbox combobox for services (a11y; replaced native multi-select). |
| `components/ResultsToolbar.tsx` | WIRED | Count/sort/density summary; Columns dropdown (optional toggles, required locked), Reset order, Refresh, Load next page. |
| `components/RunCancelControls.tsx` | WIRED | Run Search / Cancel + disabled reason. **Dead prop `queryError` never passed by App.** |
| `components/SearchMeta.tsx` | WIRED | Events/duration/interval stats, estimate, query-plan, generated-LogQL `<details>`, warnings. |
| `components/UniversalSearch.tsx` | WIRED | Free-text input with identifier suggestions (combobox/listbox), scope chip, Enter submt/Ctrl+Enter. |
| `components/EventTable.tsx` (552 lines) | WIRED | Semantic table: reorderable/sortable columns, per-row ⋯ menu, message expand, copy correlation, malformed flag, keyboard row nav. Also reused by LiveTail. |
| `components/EventInspector.tsx` (430 lines) | WIRED | Resizable modal inspector, 5 tabs, prev/next, find/context, copy rules, focus trap + Escape. Exports unused `InspectorProps` type. |
| `components/EventTimeline.tsx` (370 lines) | WIRED (lazy) | Chronological correlation timeline: hero stats, service/severity/errors-only filters, sequence, gap/delta markers, grouped rows, context buttons. |
| `components/ContextView.tsx` | WIRED (lazy) | Wrapper rendering EventTimeline for the ±30s surrounding-context title. |
| `components/LiveTail.tsx` (609 lines) | WIRED | SSE stream: status, pause/resume/clear/stop, reconnect+retry, filters, follow-newest, counters, embedded EventTable. |
| `components/LiveConfirmDialog.tsx` | WIRED | Modal confirm for starting live tail; focus trap, inert background, Escape. |
| `components/MoreFilters.tsx` (326 lines) | WIRED (lazy) | Side-panel advanced filters (who/request/what/client sections), advanced-query disclosure (Builder/Text/Raw LogQL tabs), staged draft + Apply/Cancel/Reset. Uses AdvancedFilterField + QueryBuilder. |
| `components/AdvancedFilterField.tsx` | WIRED | Field row helper used by MoreFilters. **Dead prop `autoFocus` never passed.** |
| `components/QueryBuilder.tsx` | WIRED | Guided query builder tree UI (reached via MoreFilters). |
| `components/SearchableServiceCombo.tsx` | WIRED | see above. |
| `components/SettingsPage.tsx` | WIRED | Masking status (facts, field-level toggles), unmask toggle + confirm dialog, includes DockerConnectionPanel. |
| `components/DockerConnectionPanel.tsx` | WIRED | Local/Remote engine config: host, port (auto/custom), TLS + profile, test/save/reset, validation. |
| `components/SearchEmpty.tsx` | WIRED | Empty state with suggestions. **Dead prop `onNarrow` never passed.** |
| `components/SearchLoading.tsx` | WIRED | Skeleton loading state. |
| `components/LogList.tsx` | **DEAD/ORPHANED** | Client-side paginated list — superseded by EventTable. Imported only by its own test. |
| `components/LogRow.tsx` | **DEAD/ORPHANED** (prod) | Imported only by dead `LogList.tsx` and dev-only `UiLab.tsx`. |
| `components/GuidedFilters.tsx` | **DEAD/ORPHANED** | Older "guided filters" grid — superseded by MoreFilters/advanced system. Own test only. |
| `components/QueryInput.tsx` | **DEAD/ORPHANED** | Replaced by MoreFilters text queries. **No imports anywhere (not even a test).** |
| `components/QueryModeSelector.tsx` | **DEAD/ORPHANED** | Mode switching now inside MoreFilters' AdvancedQueryDisclosure. **No imports anywhere.** |
| `components/LevelSelector.tsx` | **DEAD/ORPHANED** | Superseded by SeveritySelector. **No imports anywhere.** |
| `components/UiLab.tsx` | **DEV-ONLY** | Component sandbox; reachable only via dev-only `/ui-lab` route (main.tsx gate). |

### 1.3 Utilities (`utils/`)

| File | Status | Purpose |
|------|--------|---------|
| `format.ts` | WIRED | Timestamp/date formatting (short/local/UTC/exact ms), `shortId`, duration parse/format, `severityClass` (HTML-safe), `SENSITIVE_FIELDS`. `formatTimestamp` is test-only. |
| `timeRange.ts` | WIRED | Preset minutes/labels, `MAX_CUSTOM_RANGE_MS=30d`, `datetime-local` helpers, `validateCustomRange`, `computeRange` → UTC ISO `{start,end}`, `formatInterval`. |
| `queryBuilder.ts` | WIRED | Guided query tree model + serialization to simple-query grammar (`=`/`!=`/`contains`, `and`/`or`, parentheses). `impliesEmpty` is dead. |
| `advancedFilters.ts` | WIRED | Advanced filter model, `maskSensitiveValue`, draft field semantics, guided expression, request building, masked chips. |
| `search.ts` | WIRED | Identifier detection heuristic (suggestions only), `escapeSimpleQueryText`, `buildFreeTextQuery`, `timezoneLabel`. |
| `eventTable.ts` | WIRED | Column model, required/optional columns, actor resolution + masking, correlation shortening, table prefs persistence. `primaryId` is dead. |
| `eventInspector.ts` | WIRED | Canonical field list (23), actor/client field extraction, combined raw+masked map, `sanitizedRawJson`, context window helpers. |
| `preferences.ts` | WIRED | `SavedPreferences` (sourceId/timePreset/levels/queryMode) — never stores query text or sensitive values. `loadNonSensitive('last-query')` used; `saveNonSensitive` is **dead (see §3.2)**. |
| `tail.ts` | WIRED | Connection status union, buffer bounds (1000 display/100 pause), reconnect backoff, deduper, sanitize, `tailEventToFull`, `formatElapsed`. |
| `dockerConnection.ts` | WIRED | Form state, effective port (AUTO 2375/2376 per TLS), validation, DTO building. **No project-filter / exclusion-label fields in the frontend.** |
| `focusTrap.ts` | WIRED | `trapTab` + `focusableElements` helper for modal dialogs. |

### 1.4 API & models

| File | Status | Purpose |
|------|--------|---------|
| `api/client.ts` (400 lines) | WIRED | `BASE='/api/v1'`; session header `X-LogExplorer-Session`; `ApiError`/`CancelledError`; fetch wrapper; all API methods incl. SSE `tail()`. `getSources()` and `getSystemInfo()` are **test-only (dead in prod)**. |
| `models/api.ts` | WIRED | `LogSourceDescriptor`, `LogSourceCapability`, `SourceHealth`, `LogSearchRequest`, `LogSearchResponse`, `QueryStatistics`, `LogEventFull`, `LogOriginMetadata`, `MaskingStatus`, Docker models, `SystemInfo`, `LOG_LEVELS`. |
| `models/sources.ts` | WIRED | Static `KNOWN_SOURCES` (docker-compose, openshift-dev) + `findSource`/`hasCapability`. **Not sourced from the live API — see §3.2.** |

### 1.5 Tests & harnesses

`A11y.integration.test.tsx`, `App*.test.tsx` (phase2/7/9/postSearch/base), per-component `*.test.tsx`, `utils/__probe__*.test.ts` (10 probe suites), `utils/*.test.ts`, `test/a11y.ts`, `test/setup.ts`, `test/globals.d.ts`, `utils/node-shims.d.ts`. The `__probe__` suites mirror the production units for regression safety.

---

## 2. Backend source inventory (`backend/src/main/java/com/example/logexplorer` and resources)

### 2.1 Entry & config

| File | Status | Notes |
|------|--------|-------|
| `LogExplorerApplication.java` | WIRED | Plain `@SpringBootApplication`; no initializers/startup jobs. |
| `api/*` (SearchController, LogTailController, SettingsController, DockerConnectionController, SystemInfoController, GlobalExceptionHandler) | WIRED | HTTP surface. |
| `api/LogSearchRequest.java`, `LogSearchResponse.java`, `LogSearchDirection.java`, `MaskingStatus.java` | WIRED | DTOs. |
| `api/LogTailRequest.java` | **DEAD** | Full safe-filter DTO; referenced nowhere (controller uses raw `@RequestParam`s). |
| `query/*` (SimpleQueryParser, Tokenizer, Token, Field, Compiler, Validator, Planner, QueryPlan, Exception) | WIRED | Simple-query language engine. |
| `log/*` (LogEvent, LogEventParser, MaskingService, SensitiveFieldMasker, MaskingPolicy, LogSeverity, ParseOutcome, TruncatingTokenizer, SearchTokenService, LogOriginMetadata) | WIRED | Event model, parser, masking. |
| `security/*` (MaskingAuditService, PerFieldMaskingService, UnmaskCapabilityService) | WIRED | Session-scoped masking/unmasking. |
| `source/*` (LogSource, LogSourceCapability, LogSourceDescriptor, LogSourceHealth, LogSourceRegistry, SourceNotFound/UnavailableException) | WIRED | Source contract + registry. |
| `docker/*` (DockerComposeLogSource, DockerGateway/Default/Resolver, DockerClientFactory, DockerConnection/Service/Mode/Properties/Request/Security/Test/View, DockerConnectivity, DockerContainerInfo, DockerHealthStatus, DockerLogFrame, DockerSourceConfiguration, IpCidr, ServerManagedSslConfig, DockerConnectionAuditService) | WIRED | Docker source + per-user connection handling. |
| `loki/*` (OpenShiftLokiLogSource, LokiGateway/Default, LokiConfig, LokiSourceConfiguration, LokiQueryResponse/Result/StreamEntry, LogQueryBuilder) | WIRED | OpenShift Loki source. `LokiStreamEntry` is unused. |
| `fixture/FixtureLogSource.java` | WIRED (dev/test only) | Synthetic source, gated by `@Profile("dev|test")` + property. |
| `config/*` (SessionContext, SessionContextFilter, SseResponseFilter, SpaFallbackController, LogTailConfiguration/Manager/Config, SourceRegistryConfiguration, FixtureSourceConfiguration, MaskingConfiguration/Properties, DockerConnectionConfiguration) | WIRED | Wiring + cross-cutting. |
| `system/SystemInfo.java`, `SystemInfoController.java` | WIRED | `GET /api/v1/system/info` → name/version/`"UP"` (no source count). |

### 2.2 Resources (`backend/src/main/resources`)

| File | Notes |
|------|-------|
| `application.yml` | Authoritative: port 5050; actuator `health` only; docker enabled + `project-filter: boubyan-platform` + `allow-insecure-remote-docker:true` + `connection-timeout-ms:5000`; openshift enabled + `base-url:${OPENSHIFT_LOKI_BASE_URL:}`; `rawLogQl.enabled:false`; `masking.enabled:true`; `unmask.enabled:false`, `ttl-seconds:300`; tail `max-concurrent:10`, `heartbeat-seconds:15`, timeout `0`. |
| `application.properties` | Subset dup (name/desc/port/actuator). |
| `application-docker.properties` | Enables docker + project filter (via profile). |
| `application-prod.properties` | Hardens remote Docker (`allow-insecure-remote-docker=false`, clears allowlists → no non-TLS remote in prod). |

No `application-dev.properties` / `application-test.properties` exist.

---

## 3. Disposition summary (gaps worth migrating / deleting)

### 3.1 Dead or orphaned code to consider removing on migration

- **Frontend orphans:** `LogList.tsx`, `LogRow.tsx`, `GuidedFilters.tsx`, `QueryInput.tsx`, `QueryModeSelector.tsx`, `LevelSelector.tsx`, `UiLab.tsx` (dev-only). `QueryInput`/`QueryModeSelector`/`LevelSelector` have **zero** production imports.
- **Dead backend DTO:** `api/LogTailRequest.java` (unreferenced).
- **Unused backend artefacts:** `SimpleQueryField.knownFieldNames()`, `LogTailManager.registerSubscription(...)`, `LogEventParser.resolveCorrelationId(Map)` overload, `SimpleQueryToken.UNKNOWN`, `MaskingService.configureExtraFieldRules` (empty), `MaskingProperties.fieldRules` (read but not applied), `LokiStreamEntry`.

### 3.2 Half-wired / incomplete features (see Audit 16 for detail)

- **"last-query" restore is one-way:** `App.tsx` loads `prefs.loadNonSensitive('last-query')` but nothing calls `saveNonSensitive` — never persisted.
- **`getSources()`/`getSystemInfo()` not integrated:** UI uses static `KNOWN_SOURCES`; capability drift risk if backend descriptors change.
- **Raw LogQL path unreachable:** `LogSearchRequest` constructor force-sets `rawLogQlMode=false`; no source advertises `RAW_LOGQL`; disabled in yml.

### 3.3 Test count note

Specs report differing frontend counts (UX_ACCEPTANCE_REPORT: 33 files/388 tests; INTEGRATION_REPORT: 184 tests/14 files) — the doc set was written at different times. This inventory reflects the current `src` tree (which includes 10 `__probe__` suites), so recalculate counts at migration time.
