# Multi-Source Log Explorer MVP — Specification

## 1. Purpose

Prove that developers can explore structured Spring Boot JSON logs through a clear, Seq-like web interface without manually reading raw Docker output or relying on OpenShift's difficult LogQL-only user experience.

## 2. Architecture

- **Backend:** Java 21, Spring Boot 3.x, Spring WebFlux, Bean Validation, Actuator. Single modular application. No microservices.
- **Frontend:** React, TypeScript, Vite. Strict TypeScript.
- **Persistence:** None. MVP uses no application database. UI preferences may use browser `localStorage`.
- **Delivery:** One deployable application image. During development, frontend and backend run separately.

## 3. Log Sources

1. **Local Docker Compose** — containers read through the Docker Engine API.
2. **OpenShift Development** — queried through the OpenShift Loki gateway/API.

## 4. Canonical Application Log Structure

Every structured log entry contains these top-level fields:

| Field | Type | Description |
|-------|------|-------------|
| `@timestamp` | string (ISO 8601) | Event timestamp |
| `@version` | string | Log model version |
| `message` | string | Log message |
| `logger_name` | string | Logger class name |
| `thread_name` | string | Thread identifier |
| `level` | string | Log level (DEBUG, INFO, WARN, ERROR, TRACE) |
| `level_value` | integer | Numeric log level |
| `application` | string | Application/service name |
| `mdc` | object | Mapped Diagnostic Context |
| `exception` | string (optional) | Stack trace text |

### 4.1 MDC Fields

The `mdc` object may contain:

`cif`, `UserName`, `CustomerId`, `X-Correlation-id`, `deviceId`, `deviceIp`, `devicePlatformType`, `language`, `x-journey-trace-id`, `serverIp`, `serverHost`, `stepName`, `UIIdentifier`, `traceId`, `spanId`, `event.correlationId`, `eventId`, `ERROR_CODE`

## 5. Field Mapping Rules

| UI Field | Source |
|----------|--------|
| `service` | Top-level `application`; Docker Compose or OpenShift metadata as fallback |
| `correlationId` | `mdc.X-Correlation-id` first, then `mdc.event.correlationId` |
| `journeyId` | `mdc.x-journey-trace-id` |
| `traceId` | `mdc.traceId` |
| `spanId` | `mdc.spanId` |

### 5.1 Key Handling Rules

- `event.correlationId` is a literal JSON key containing a dot — not a nested object.
- Keys containing dots or hyphens must be read using literal JSON property access or JSON Pointer.
- Unknown JSON and MDC fields must be preserved in a generic field map.
- Malformed or non-JSON log lines must be represented as raw log events and must never be silently dropped.

## 6. Security Rules

### 6.1 Sensitive Fields (Banking Data)

The following fields are classified as sensitive and must be **masked server-side** before any response reaches the browser:

- `cif`
- `UserName`
- `CustomerId`
- `deviceId`
- `deviceIp`

### 6.2 Server-Side Rules

- Never log search values, bearer tokens, raw customer identifiers, or full returned log events from this application.
- Tokens and credentials come only from environment variables or uncommitted local configuration.
- Never disable TLS verification or commit secrets.

### 6.3 Client-Side Rules

- Render all log text as **text**, never as HTML.

## 7. Query Behavior (MVP)

- Guided filters for: source, time range, service, level, free-text search, traceId, spanId, correlationId, journeyId, eventId, errorCode, business step.
- Small, source-independent query expression language.
- Optional raw LogQL mode for OpenShift Loki source only.
- Strict limits on: result count, time range, request timeout, and concurrency.
- Source capability discovery so the UI never promises unsupported behavior.

## 8. UX Requirements (MVP)

- Very visible **Local Docker** vs **OpenShift Development** source selector.
- Time-range selector, service and level filters, query bar, Run/Cancel controls.
- Efficient log list with severity-based color styling.
- Expandable event details with formatted stack traces.
- Trace timeline, correlation timeline, and journey timeline views.
- Live tail with pause/resume and bounded browser-side buffering.
- Clear empty, loading, partial, truncated, and error states.

## 9. Non-Goals (MVP)

- Production corporate SSO or per-user OpenShift OAuth.
- Long-term log storage.
- SIEM, alerting platform, or full APM system.
- Writing, modifying, or deleting source logs.
- Querying multiple sources in one request.
- Custom database.
- Cluster-wide production permissions.

## 10. Working Rules (Every Phase)

1. Inspect the repository and `docs/MVP_SPEC.md` before editing.
2. Preserve working code and unrelated user changes.
3. Implement only the requested phase; do not jump ahead.
4. Prefer clear, small modules over abstractions without immediate use.
5. Do not invent successful test results or external connectivity.
6. Do not disable TLS verification or commit secrets.
7. Run relevant tests and builds before finishing.
8. Report exactly what changed, commands run, results, and blockers.
9. If a required external dependency is unavailable, complete deterministic tests with mocks/fixtures and report the live check as blocked.

---

## Phase Acceptance Criteria

### Phase 1: Repository Scaffold and Living Specification

**Backend:**
- [x] Java 21, Maven Wrapper, Spring Boot 3.x, WebFlux, validation, actuator present.
- [x] Base package `com.example.logexplorer`.
- [x] Application entry point compiles and starts cleanly.
- [x] `GET /api/v1/system/info` returns application name, version, and status.
- [x] Actuator health exposed; no sensitive endpoints exposed.
- [x] Integration test verifies application context and system-info endpoint.
- [x] RFC 7807 / `ProblemDetail` imported as the future API error shape.

**Frontend:**
- [x] React + TypeScript + Vite project with strict TypeScript enabled.
- [x] Vitest and React Testing Library configured.
- [x] Minimal page titled "Multi-Source Log Explorer".
- [x] Fetches and displays `/api/v1/system/info`.
- [x] Vite dev proxy configured for `/api`.
- [x] Loading, success, and failure states implemented.
- [x] At least one component test passes.

**Infrastructure:**
- [x] `docs/MVP_SPEC.md` exists as the source of truth, expanded from the master contract.
- [x] `README.md` with prerequisites and separate backend/frontend dev commands.
- [x] Root `.gitignore` and `.editorconfig`.
- [x] Backend tests pass.
- [x] Frontend tests pass.
- [x] Frontend type-check passes.
- [x] Backend build succeeds.
- [x] Frontend build succeeds.

### Phase 2: Docker Engine API Integration (Local Docker Compose Log Source)

**Backend:**
- [x] `LogSource` interface defines `id()`, `displayName()`, `capabilities()`, `healthStatus()`, `discoverServices()`, `searchHistorical()`, `streamLive()`.
- [x] `LogSourceCapability` enum: `HISTORICAL_SEARCH`, `LIVE_TAIL`, `RAW_LOGQL`, `SERVICE_DISCOVERY`, `QUERY_STATISTICS`, `CONTEXT_VIEW`.
- [x] `DockerGateway` interface isolating Docker daemon communication; `DockerGatewayDefault` using docker-java library with 30-second operation timeout.
- [x] `DockerComposeLogSource` implementing `LogSource` with source ID `docker-compose`, display name `Local Docker Compose`.
- [x] Docker source advertises capabilities: `HISTORICAL_SEARCH`, `LIVE_TAIL`, `SERVICE_DISCOVERY`.
- [x] Health check verifies docker-java library on classpath and Docker daemon reachable.
- [x] Service discovery lists containers matching Compose project filter labels; extracts `composeService` fallback to container name.
- [x] Historical search: for each matched container, fetches logs within time range, parses JSON lines, enriches with `_composeProject`, `_composeService`, `_containerName`, `_source`, `_logSource` raw fields.
- [x] Service resolution: prefers JSON `application` field; falls back to `composeService` from container labels.
- [x] Applies text search, level filter, sorts by timestamp (default newest-first), truncates to limit.
- [x] `MAX_SCAN_LINES` cap of 100,000 lines per search.
- [x] Configuration: `logexplorer.docker.enabled` (boolean), `logexplorer.docker.project-filter` (optional).
- [x] Gracefully handles missing docker-java library at runtime.
- [x] `DockerContainerInfo` and `DockerLogFrame` records for container metadata and log data.

**Testing:**
- [x] `DockerComposeLogSourceTest` — 22 tests via mock gateway: identity, health (library missing, daemon unreachable), service discovery, historical search (unavailable, empty, JSON parse, service/level/text filter, truncation, newest-first, oldest-first, multi-container merge, stderr, project filter, stopped container, malformed JSON).
- [x] `DockerComposeSmokeTest` — 5 optional integration tests against real Docker; skip gracefully when Docker unavailable.

---

### Phase 3: OpenShift / Loki Log Source Integration

**Backend:**
- [x] `LokiGateway` interface with `queryRange()`, `fetchLabels()`, `fetchLabelValues()`, `isConfigured()`, `isReachable()`; defines `LokiQueryOutcome` and `LokiLabelOutcome` records.
- [x] `LokiGatewayDefault` using Spring WebFlux `WebClient`; bearer token injected at construction, never exposed in logs/exceptions; 30-second request timeout; specific handling for 401, 403, 429, 5xx errors.
- [x] `OpenShiftLokiLogSource` implementing `LogSource` with source ID `openshift-dev`, display name `OpenShift Development`.
- [x] Loki source advertises capabilities: `HISTORICAL_SEARCH`, `SERVICE_DISCOVERY`, `QUERY_STATISTICS`.
- [x] Health check verifies base URL configured and Loki endpoint reachable via labels endpoint.
- [x] Service discovery fetches label values for configured `serviceLabelKey` (default `app`).
- [x] `LogQueryBuilder` utility for safe LogQL construction: `escapeLabelValue()`, `escapeRegex()`, `buildSelector()`, `buildQuery()` with JSON filters.
- [x] Safe LogQL injection prevention tested with quotes, backslashes, curly braces, pipe characters.
- [x] LogQL query: fixed selectors + service + level label filters, optional traceId/spanId JSON filters, text regex filter.
- [x] Converts `Instant` to epoch nanoseconds for Loki API; enforces `MAX_QUERY_LIMIT` of 5,000.
- [x] Parses JSON log lines from each Loki stream; enriches with Kubernetes labels (`_namespace`, `_podName`, `_containerName`, `_k8sNode`, `_loki_*` prefix for stream labels).
- [x] High-cardinality post-filtering: exact match for correlationId (`X-Correlation-id` and `event.correlationId`), journeyId, eventId, errorCode, businessStep.
- [x] `sanitizeError()` strips Bearer tokens, passwords, and sensitive values before any exposure.
- [x] `LokiConfig` record with constructor defaults for API paths, `namespaceLabelKey`, `serviceLabelKey`.
- [x] Fixed selectors configurable via `logexplorer.openshift.fixed-selectors` (comma-separated `key=value`).
- [x] Bearer token from `OPENSHIFT_LOKI_TOKEN` env var only.
- [x] Configuration prefix: `logexplorer.openshift.*`.

**Testing:**
- [x] `OpenShiftLokiLogSourceTest` — 40+ tests via `MockLokiGateway`: identity, capabilities, health, service discovery, search (unavailable, empty, single stream, multi-stream merge/sort, oldest-first, level filter, service push-down, correlationId exact match, truncation, k8s label enrichment, malformed line, statistics, query params, configured paths, fixed selectors, service fallback), error handling (401, 403, 429, 500, timeout), token secrecy, LogQL injection prevention, query building, nested MDC parsing, sensitive MDC masking, response parsing.
- [x] `OpenShiftLokiSmokeTest` — 2 optional integration tests; skip when env vars not set.

---

### Phase 4: Search API, Source Registry, and Result Aggregation

**Backend:**
- [x] `LogSourceDescriptor` record (id, displayName, capabilities, enabled) and `LogSourceHealth` record (available, statusMessage) for API responses.
- [x] `LogSourceRegistry` — central registry injected with all `LogSource` beans; provides `descriptor()`, `resolve()` (throws on unknown/unavailable), `listDescriptors()`, `exists()`.
- [x] `SourceNotFoundException` and `SourceUnavailableException` with ID redaction (64 chars max).
- [x] `SearchController` at `/api/v1` with endpoints:
  - `GET /api/v1/sources` — returns `List<LogSourceDescriptor>`
  - `GET /api/v1/sources/{sourceId}/health` — returns `LogSourceDescriptor` with health; 404 if not found
  - `GET /api/v1/sources/{sourceId}/services` — returns discovered services; 404/503
  - `POST /api/v1/logs/search` — accepts `LogSearchRequest`, returns `LogSearchResponse`
- [x] `LogSearchRequest` with Bean Validation: `@NotBlank` sourceId, `@NotNull` start/end, compact constructor sets defaults (NEWEST_FIRST, limit 100, capped at 5000).
- [x] `LogSearchResponse` with fields: events, truncated, nextCursor, executionDuration, start/end, warnings, statistics, generatedLogQl, pushDownConditions, postFilterConditions.
- [x] `LogSearchDirection` enum: `NEWEST_FIRST`, `OLDEST_FIRST`.
- [x] `GlobalExceptionHandler` converts `WebExchangeBindException` (400), `IllegalArgumentException` (400), `SourceNotFoundException` (404), `SourceUnavailableException` (503), general `Exception` (500) into RFC 7807 `ProblemDetail` with custom `errorCode` property.
- [x] 30-day time range limit enforced in controller; limit cap of 5,000 in request.
- [x] Raw LogQL disabled by default; `rawLogQlMode` forced `false` in request; controller checks both config flag and source capability.
- [x] `FixtureLogSource` — in-memory implementation with all capabilities; supports `BlockingQueue` for live tail; comprehensive filter matching (time range, service, level, text, traceId, spanId, correlationId, journeyId, eventId, errorCode, businessStep).
- [x] `FixtureSourceConfiguration` active on `dev`/`test` profiles; creates 10 pre-built `LogEvent` fixtures across 4 services.
- [x] `SourceRegistryConfiguration` wires `LogSourceRegistry` from all discovered `LogSource` beans.
- [x] Configuration: `logexplorer.query.rawLogQl.enabled` (boolean, default `false`).

**Testing:**
- [x] `SearchControllerIntegrationTest` — 15 tests via WebTestClient: source listing, health (known 200, unknown 404), services (returns list, unknown 404), search (valid, blank source 400, unknown 404, start-after-end 400, limit enforced, limit capped at 5000, filter by service/level, defaults, masked MDC in response, missing start 400).
- [x] `LogSourceRegistryTest` — 6 tests: resolve known, reject unknown, reject disabled, list all, exists check.
- [x] `SimpleQueryApiIntegrationTest` — 16 tests: simple query parsing (service, level, and, or, contains, parentheses precedence, parentheses override), combined with structured filters, invalid syntax 400, unknown field warns, query plan, restricted field warns, empty query, mixed push-down/post-filter, error safety.

---

### Phase 5: Log Event Model, Sensitive Field Masking, and Validation

**Backend:**
- [x] `LogEvent` — immutable Java record with 19 top-level fields (timestamp, schemaVersion, service, severity/LogSeverity, severityNumber, message, logger, thread, exception, traceId, spanId, journeyId, correlationId, eventId, businessStep, uiIdentifier, errorCode) plus 3 aggregate fields (rawFields, maskedMdc, origin/LogOriginMetadata).
- [x] `LogEvent.displayMessage()` returns `(empty message)` fallback; `toString()` redacts message content.
- [x] `LogOriginMetadata` record (source, containerName, podName, namespace, adapterMetadata); `toString()` exposes only source.
- [x] `LogSeverity` enum: TRACE, DEBUG, INFO, WARN, ERROR, UNKNOWN; `fromName()` handles null/blank, case-insensitive, returns UNKNOWN for unrecognized.
- [x] `LogEventParser` — JSON log line parser using Jackson core streaming API (no databinding). Public `parseLines()` returns `List<ParseOutcome>`. Internally splits by newline, tokenizes, parses each line.
- [x] `LogEventParser.toMap()` recursively converts JSON objects to `Map<String, Object>` (handles nested objects and arrays).
- [x] `LogEventParser.extractEvent()` reads all canonical fields; resolves correlationId with precedence (`X-Correlation-id` > `event.correlationId`); calls `SensitiveFieldMasker.maskMdc()`; builds `rawFieldsSnapshot` via `flatten()` and masks sensitive fields.
- [x] `sanitizeParseError()` always returns `"parse error"`.
- [x] `ParseOutcome` — sealed interface: `ParsedEvent(LogEvent)` (isParsed=true) and `RawLine(rawLine, parseError)` (isParsed=false). `RawLine.toString()` hides raw content.
- [x] `SensitiveFieldMasker` with `MASKED_VALUE = "***"`:
  - `cif` → `***` (total mask)
  - `CustomerId` → partialMask (1/4 chars visible + `***`)
  - `UserName` → partialMask (1/4 chars visible + `***`)
  - `deviceId` → first 2 chars + `***`
  - `deviceIp` → `x.x.*.*` for valid IPv4 else partialMask
- [x] Dual masking: sensitive fields masked in both `maskedMdc` and `rawFields`.
- [x] `TruncatingTokenizer.truncateForDiagnostic()` limits error content to 1,024 chars.
- [x] Malformed JSON produces `RawLine` outcomes rather than exceptions; missing fields default to null/UNKNOWN.
- [x] No Jackson Databinding — only Jackson core streaming API to avoid reflection-based deserialization vulnerabilities.

**Testing:**
- [x] `LogEventParserTest` — 35+ tests: standard INFO parsing, field mapping, MDC extraction, display message, UTC/offset timestamps, missing/invalid timestamps, correlationId precedence, hyphenated keys, ERROR/multiline exception, errorCode, event.correlationId literal key, missing fields graceful defaults, malformed JSON (RawLine fallback, content preservation, no exception, mixed valid/malformed), sensitive field masking in rawFields and maskedMdc, unknown fields preserved, top-level fields in rawFields, edge cases (null/blank/empty, empty message fallback, origin metadata, WARN lowercase, JMS MDC), RawLine toString safety.
- [x] `SensitiveFieldMaskerTest` — 26 tests: maskMdc (null/empty, cif fully masked, customerId partial, userName partial, deviceId 2-char prefix, deviceIp last two octets, non-sensitive passthrough, null/blank values, all 5 simultaneous), partialMask, maskDeviceID, maskDeviceIP.
- [x] `LogSeverityTest` — 5 tests: null/blank → UNKNOWN, all 5 uppercase levels, all 5 lowercase, mixed case, unknown → UNKNOWN.
- [x] `ParseOutcomeTest` — 8 tests: ParsedEvent (isParsed, event, null rawLine), RawLine (isParsed, null event, rawLine, toString), of() factory.
- [x] `TruncatingTokenizerTest` — 6 tests: null, shorter/equal, longer truncation, zero/one max length.

---

### Phase 6: Simple Query Language

**Simple Query Grammar (AND binds tighter than OR):**

```
Expression   : AndExpr ( 'or' AndExpr )*
AndExpr      : Comparison ( 'and' Comparison )*
Comparison   : '(' Expression ')' | field Op string
Op           : '=' | '!=' | 'contains'
field        : IDENTIFIER (may include dots, e.g. device.platform)
string       : '"' STRING '"'
```

**Precedence rules:**
- AND binds tighter than OR. `a or b and c` parses as `a or (b and c)`.
- Parentheses override precedence: `(a or b) and c`.
- Case-insensitive operators: `AND`, `and`, `Or`, `OR` all valid.
- All comparison operators (`=`, `!=`, `contains`) are case-insensitive for the field value comparison.

**String escaping:**
- `\"` — literal quote within string
- `\\` — literal backslash
- `\n`, `\r`, `\t` — newline, carriage return, tab

**Supported field aliases (case-insensitive):**

| Alias | Canonical | MDC Key | Restricted |
|-------|-----------|---------|------------|
| `service` | service | — | no |
| `level` | level | — | no |
| `message` | message | — | no |
| `logger` | logger | — | no |
| `traceId` | traceId | traceId | no |
| `spanId` | spanId | spanId | no |
| `correlationId` | correlationId | X-Correlation-id / event.correlationId | no |
| `journeyId` | journeyId | x-journey-trace-id | no |
| `eventId` | eventId | eventId | no |
| `errorCode` | errorCode | ERROR_CODE | no |
| `businessStep` | businessStep | stepName | no |
| `uiIdentifier` | uiIdentifier | UIIdentifier | no |
| `device.platform` | devicePlatform | devicePlatformType | no |
| `language` | language | language | no |
| `userName` | userName | UserName | yes |
| `customerId` | customerId | CustomerId | yes |
| `cif` | cif | cif | yes |

Restricted fields (`userName`, `customerId`, `cif`) are allowed in queries but values are never logged or returned unmasked in results. Restricted-field queries produce a warning.

**Query planning (Loki push-down):**
- Only `service="value"` and `level="value"` (EQ operator, lowercasing) are pushed down to Loki's label selector.
- All other fields, operators (NEQ, CONTAINS), and restricted fields always become post-filters.
- Query plan explanation (`pushDownConditions`, `postFilterConditions`) is returned in the API response.

**Raw LogQL:**
- Separate `rawLogQl` field on `LogSearchRequest`, gated by `rawLogQlMode` flag.
- Requires `logexplorer.query.rawLogQl.enabled=true` configuration property (defaults to `false`).
- Requires source to advertise `RAW_LOGQL` capability (Docker does not; Loki does not currently).
- Never supported by Docker source.

**Examples:**

| Query | Parsed as | Matches |
|-------|-----------|---------|
| `level = "ERROR"` | single Condition | events with ERROR level |
| `service = "api" and level = "ERROR"` | AND of 2 Conditions | api service + ERROR |
| `service = "api" or level = "ERROR"` | OR of 2 Conditions | api service OR any ERROR |
| `service = "api" or service = "web" and level = "ERROR"` | OR(api, AND(web, ERROR)) | all api events + web+ERROR |
| `message contains "timeout" and level = "ERROR"` | AND of 2 Conditions | ERROR events mentioning timeout |
| `(service = "api" or service = "web") and level = "ERROR"` | AND(OR(api,web), ERROR) | api+ERROR or web+ERROR |

**Security:**
- Expression is hand-written recursive descent parser and in-memory predicate compiler.
- No SpEL, JavaScript evaluation, SQL, or reflection-based expression execution.
- Deterministic: same input always produces same AST and same predicate.
- Error messages include position but sanitize user values (quote stripping).

---

### Phase 7: React Application Shell, API Client, and Source-Aware Controls

**Frontend:**
- [x] Strict TypeScript with no broad `any` usage; `tsc --noEmit` passes clean.
- [x] TypeScript models in `models/api.ts` matching backend contracts: `LogSourceDescriptor`, `LogSourceCapability`, `SourceHealth`, `LogSearchRequest` (all 18+ fields), `LogSearchResponse`, `QueryStatistics`, `LogEventFull` (all 21 fields), `LogOriginMetadata`, `ProblemDetail` (RFC 7807), `SystemInfo`.
- [x] Source definitions in `models/sources.ts`: `KNOWN_SOURCES` with `docker-compose` (Local, `⬡` badge, capabilities: `HISTORICAL_SEARCH`, `LIVE_TAIL`, `SERVICE_DISCOVERY`) and `openshift-dev` (OpenShift, `◆` badge, capabilities: `HISTORICAL_SEARCH`, `SERVICE_DISCOVERY`, `RAW_LOGQL`, `QUERY_STATISTICS`, `CONTEXT_VIEW`).
- [x] `hasCapability()` helper for capability-aware UI gating.

**Typed API Client:**
- [x] `api/client.ts` with generic `request()` helper; `/api/v1` prefix.
- [x] `ApiError` (with status, detail) and `CancelledError` exception classes.
- [x] Endpoints: `getSources()` (→ `List<LogSourceDescriptor>`), `getSourceHealth()` (→ `LogSourceDescriptor` or 404), `getSourceServices()` (→ `List<String>`), `search()` with `AbortController`/`AbortSignal` support.
- [x] POST `/api/v1/logs/search` throws `ApiError` on non-2xx, `CancelledError` on abort.
- [x] API error responses display sanitized backend `ProblemDetail.detail` messages.

**Source Selector & Health:**
- [x] Prominent `<select>` source selector showing "Local Docker Compose" and "OpenShift Development".
- [x] Never silently switches selected source — explicit user action required.
- [x] Clearly differentiated badges: Local = `⬡` + "Local" text; OpenShift = `◆` + "OpenShift" text (not color-only).
- [x] Source health indicator: unknown ("Checking..."), ok (green dot + statusMessage), down (red dot + Retry button).
- [x] Changing source cancels in-flight request, clears incompatible services/results, reloads capabilities and health.

**Capability-Aware Controls:**
- [x] Raw LogQL query mode disabled with explanatory text when source lacks `RAW_LOGQL` capability.
- [x] Capability gating hides/disables unsupported features with `mode-option--disabled` CSS class.

**Time Range & Filters:**
- [x] Time presets: last 5, 15, 30, and 60 minutes plus validated custom range (both fields required, start before end, within 30-day limit).
- [x] Custom range: `datetime-local` inputs in `role="group"` labeled "Custom time range".
- [x] Field validation errors rendered in `field-error` class, associated via `aria-invalid`.

**Service & Level Selectors:**
- [x] Multi-select service selector populated from selected source; loading/disabled states; `aria-busy` during loading.
- [x] Level selector: toggleable chips for TRACE, DEBUG, INFO, WARN, ERROR with checkbox roles and visual checked state.

**Query Mode & Input:**
- [x] Query-mode radio group: Guided/Simple (default) vs Raw LogQL (capability-gated).
- [x] `<textarea>` query input with mode-specific placeholder and hint; `aria-labelledby` to field legend.

**Run & Cancel Controls:**
- [x] Run button: `data-testid="run-btn"`, disabled when source unhealthy or query has validation errors.
- [x] Cancel button: appears during loading, calls `AbortController.abort()`, clears loading state.
- [x] `aria-busy` reflects loading state; Run button disabled during in-flight search.

**Preference Persistence:**
- [x] Auto-saves `sourceId`, `timePreset`, `levels`, `queryMode` to `localStorage` key `logexplorer.preferences`.
- [x] Never stores queries containing `userName`, `customerId`, `cif`, `Bearer`, tokens, or raw log results.
- [x] `queryIsSensitive()` regex-based detection for sensitive field references.
- [x] `saveNonSensitive()` only persists query if `!queryIsSensitive()`.

**State Behavior:**
- [x] Source switch: abort in-flight request, clear services/results/errors/health, reset query mode to `guided` if `RAW_LOGQL` unavailable, load health and services.
- [x] Loading, unavailable, and retry states visible with proper ARIA roles (`aria-live="polite"`, `aria-busy`).
- [x] API errors rendered in `.api-error` element with sanitized backend messages.

**Accessibility:**
- [x] All form elements use `fieldset`/`legend`, `aria-labelledby`, `aria-describedby`.
- [x] Form marked `role="search"` with `aria-label="Log search"`.
- [x] Keyboard-accessible form controls; `tabindex` on interactive elements.
- [x] Text-only rendering — never renders HTML.

**Infrastructure:**
- [x] Responsive layout and Vite production build succeeds.

**Testing (Vitest):**
- [x] `api/client.test.ts` — 7 tests: `ApiError` carries status/detail, `CancelledError` name, `getSystemInfo`, `getSources`, `getSourceHealth`, `search` POST, non-OK throws `ApiError`.
- [x] `utils/preferences.test.ts` — 8 tests: `queryIsSensitive` detection, `load`/`save` round-trip, non-sensitive storage.
- [x] `App.test.tsx` — 20 integration tests: source selector (renders, badge label, switch updates badge), health indicator (healthy, unavailable + retry), capability gating (raw LogQL disabled), time range (presets, custom inputs, start-before-end validation, both-fields-required validation), service selector (loads from source), level selector (all 5 checkboxes), query mode (defaults Guided), Run/Cancel (run triggers search, cancel aborts in-flight with controlled resolve), keyboard accessibility (combobox label, textbox label, search role), API error handling (displays from 400 response), localStorage restrictions (sensitive field detection).
- [x] Network boundary mocked via `vi.spyOn(window, 'fetch')`.
- [x] Total: 35 frontend tests, all passing.

---

### Phase 8: Complete Historical Search Experience

**Search Form:**
- [x] Binds source, time range, services, levels, text, traceId, spanId, correlationId, journeyId, eventId, errorCode and businessStep to the common `LogSearchRequest`.
- [x] Simple query editor with placeholder hints and syntax-error display (backend `ProblemDetail.detail` rendered in `.api-error`).
- [x] Raw LogQL editor capability-gated: appears only when source advertises `RAW_LOGQL` and backend configuration allows it; otherwise disabled with `mode-option--disabled` class.
- [x] Query contents never placed in browser URL — no `window.location` or `URLSearchParams` manipulation.
- [x] POST-only searches via `AbortController` for cancellation.
- [x] No keystroke-triggered search; executes only on explicit Run button click or Ctrl+Enter keyboard shortcut.

**Results:**
- [x] `LogRow` renders timestamp, severity badge, service, short correlation/trace identifier (`shortId`), message (truncated at 140 chars), and origin badge (Docker container or OpenShift namespace/pod).
- [x] Docker origin: `⬡` badge + container name. OpenShift origin: `◆` badge + namespace/pod.
- [x] Sorts according to requested `NEWEST_FIRST` / `OLDEST_FIRST` direction (backend-sorted; frontend renders as-is).
- [x] Bounded pagination via `LogList` with `PAGE_SIZE=100`; never renders all events at once; page resets on new result sets.
- [x] `SearchMeta` displays execution duration (ms/s), result count, truncated badge, warnings list, and safe query-plan explanation (push-down vs post-filter counts).
- [x] Clear states: `SearchEmpty` (no results), `SearchLoading` (spinner + `aria-live="polite"`), `.search-cancelled` (abort), `.api-error` (`role="alert"`, sanitized backend message), `.search-meta--truncated` (partial results).
- [x] Severity highlighted accessibly via `severityClass()` producing `severity severity--ERROR` etc. (CSS class-based, not color-only).

**Event Details:**
- [x] Opens in accessible drawer/panel: `role="dialog"`, `aria-modal="true"`, keyboard Escape dismisses, focus moves to close button.
- [x] Shows canonical fields (timestamp, schema version, severity, service, logger, thread, message, IDs, error code, business step).
- [x] Shows platform metadata section: origin badge, source, container/pod/namespace.
- [x] Shows unknown raw fields section (`event.rawFields`).
- [x] Shows formatted MDC section with masked values.
- [x] Shows multiline exception in `<pre>` tag (safe text rendering).
- [x] Every value rendered as text — zero `dangerouslySetInnerHTML` calls in entire `frontend/src/`.
- [x] Masked fields display exactly as received from backend; never reconstruct raw values.
- [x] Copy buttons provided ONLY for non-sensitive identifiers (message, traceId, correlationId) — no copy on MDC or raw fields where sensitive data resides.
- [x] Query-plan explanation and generated LogQL rendered in `SearchMeta` with sensitive values redacted.

**Testing (Vitest):**
- [x] `GuidedFilters.test.tsx` — 5 tests: filter field binding, visible inputs for traceId/spanId/correlationId/journeyId/eventId/errorCode/businessStep.
- [x] `SearchMeta.test.tsx` — 11 tests: result count, duration, truncated, warnings, query plan, LogQL toggle.
- [x] `LogRow.test.tsx` — 11 tests: timestamp, severity, service, short ID, message, origin badge (Docker/OpenShift), onSelect callback, multiline exception presence, masked value rendering.
- [x] `LogList.test.tsx` — 8 tests: renders events, page size enforcement, pagination info, page reset, onSelect callback, first/last page button states, forward/back navigation.
- [x] `EventDetail.test.tsx` — 14 tests: all canonical fields, multiline exception as `<pre>`, masked MDC values, text-only rendering, safe innerHTML (no `<script>` execution), origin metadata (Docker/OpenShift), dialog accessibility (role, aria-modal, Escape), copy buttons (present for non-sensitive, absent for sensitive), raw fields preservation.
- [x] `App.test.tsx` — 37 integration tests: source selector, health, capability gating, time range, services/levels, query mode, Run/Cancel, keyboard accessibility, explicit execution (no keystroke search, Ctrl+Enter fires), abort cancellation, result rendering (count, duration, pagination), truncated state, empty state, error state, event detail (empty message fallback, multiline exception, masked values), safe text rendering (`<script>` text), capability-gated raw LogQL, bounds enforcement, large result pagination, query plan/LogQL display, localStorage restrictions.
- [x] Total: 122 frontend tests, all passing.
- [x] Backend regression: 316 tests passed (6 skipped), BUILD SUCCESS.

---

### Phase 9: Correlation Workflows

**Clickable Correlation Actions:**
- [x] EventDetail exposes clickable "Find" actions on non-sensitive identifiers: traceId, correlationId, journeyId, eventId.
- [x] Each Find button triggers a bounded search using the selected source; never silently queries another source.
- [x] No direct click-search for sensitive fields: `cif`, `CustomerId`, `UserName` have no "Find" button in the details panel.

**Timeline View:**
- [x] `EventTimeline` component renders timeline with ascending chronological sort for investigation flow.
- [x] Groups or visually distinguishes services via `data-service` attribute with per-service left-border color.
- [x] Shows timestamp, service, level, businessStep, message, trace/span identifiers and origin badge in each row.
- [x] Shows protocol-related metadata such as eventId when available (`evt=...` badge).
- [x] Displays multiple trace IDs within one journey in both meta header and footer.
- [x] States clearly: "Chronological order is timestamp-based and not a guaranteed causal order."
- [x] Offers "← Return to search" button that restores the previous search results and selected event without loss.
- [x] Handles missing identifiers: renders empty state with no-results message and still shows return button.
- [x] Shows event/error/loading states with loading spinner and error message.
- [x] Source ID displayed in meta to confirm current source.

**Context View:**
- [x] "Show surrounding context" button in EventDetail performs bounded same-source query before/after selected timestamp.
- [x] Context window scoped to service of the selected event where possible.
- [x] ±60s default window around the anchor event's timestamp.
- [x] Reuses `EventTimeline` for rendering consistent with timeline view.
- [x] Shows context window size in title: "Context around {service} ±60s".

**Testing (Vitest):**
- [x] `EventDetail.correlation.test.tsx` — 14 tests: Find buttons for traceId/correlationId/journeyId/eventId, missing identifier handling, no Find for sensitive fields, context button presence and click.
- [x] `EventTimeline.test.tsx` — 15 tests: cross-service events with data-service, multiple traces in journey, JMS correlation fallback, ascending ordering, missing identifiers, empty/loading/error states, return-to-search callback, masked MDC safe rendering, eventId protocol metadata display.
- [x] `ContextView.test.tsx` — 9 tests: context window title, window size notice, loading/error/empty states, events within window, return callback, masked field safety, select event pass-through.
- [x] `App.phase9.test.tsx` — 8 integration tests: cross-service trace events, multiple traces in journey, JMS correlation fallback, ascending ordering, missing identifiers gracefully, safe time bounds (same-source), previous-search restoration (return to search), masked fields in timeline.
- [x] Total: 168 frontend tests, all passing.
- [x] Backend regression: 316 tests passed (6 skipped), BUILD SUCCESS.
---

## Phase 10: Live Tail

Acceptance criteria:

- [x] Server-to-browser SSE endpoint `GET /api/v1/logs/tail`
- [x] Uses `sourceId` and same safe filter model (services, levels, text, limit, timeoutSeconds)
- [x] No tokens, raw query, time range, or bearer credentials in URL
- [x] Docker streams follow stdout/stderr via `DockerGatewayDefault.streamContainerLogs()`
- [x] Docker callback cancelled when subscriber disconnects
- [x] Loki reports unsupported via `unsupported` SSE event (no LIVE_TAIL capability)
- [x] Events normalized and masked before SSE emission
- [x] Heartbeat events at configurable interval (`logexplorer.tail.heartbeat-seconds`)
- [x] Subscriber cancellation on component unmount or source change
- [x] Configurable connection timeout
- [x] Max concurrent tail count configurable (`logexplorer.tail.max-concurrent`)
- [x] No unbounded backend memory buffering
- [x] Dropped/truncated notices emitted on backpressure
- [x] Bearer tokens sanitized in error messages
- [x] Start, Pause display, Resume display, and Stop controls
- [x] Pause stops rendering, maintains small bounded client buffer (100 events max)
- [x] Buffered/dropped counts clearly shown
- [x] Stop and source navigation close SSE connection
- [x] Max 1,000 displayed events (configurable, capped 5000)
- [x] Severity, service, text filter applied
- [x] Live mode visually distinct from historical search
- [x] Disclaimer that live tail lacks complete historical data

### Files Modified/Created

#### Backend
- `LogTailController.java` - Reactive SSE endpoint with heartbeats, heartbeats, filters, backpressure
- `LogTailConfig.java` - @ConfigurationProperties for tail settings
- `LogTailManager.java` - Tracks active connections, enforces concurrency limit
- `LogTailConfiguration.java` - Wires LogTailManager bean
- `LogTailRequest.java` - Safe filter request DTO
- `DockerGatewayDefault.java` - Fixed `withFollow` -> `withFollowStream` for docker-java 3.3.6
- `DockerComposeLogSource.java` - `streamLive()` via Flux.create + gateway.streamContainerLogs()

#### Frontend
- `LiveTail.tsx` - LiveTail component (start, pause, resume, stop, capped buffer, dropped events)
- `App.tsx` - Live tail mode, wired into app alongside search results
- `api/client.ts` - `tail()` method with SSE EventSource parser
- `models/api.ts` - `LogSourceDescriptor` includes `LIVE_TAIL` capability
- `models/sources.ts` - `docker-compose` source advertises `LIVE_TAIL`
- `index.css` - Live tail styles

### Test Results
- Backend: 316 tests passing (6 skipped), BUILD SUCCESS
- Frontend: 168 tests passing, `tsc --noEmit` clean, `vite build` succeeds

