# Audit 12 — Error & Health Handling

**Scope:** How the OLD app models health, errors, and failure/empty/loading states across the stack, and the sanitization/safety applied to error output.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Backend error model

- **RFC 7807 `ProblemDetail`** for non-OK responses (frontend `request()` synthesizes it and throws `ApiError{status, detail, message}`; falls back to `statusText`).
- **`GlobalExceptionHandler`** handles reactive `WebExchangeBindException` (validation) and maps to appropriate statuses.
- **Search validation failures** (e.g. invalid simple query) return HTTP 400 with a partial `LogSearchResponse` carrying `sourceId`, timestamps, and a warning/error list (not an HTTP-500).
- **Source errors:** `SourceNotFoundException` / `SourceUnavailableException` → 404 / source-unavailable responses.

### Sanitization
- `SimpleQueryException` strips quoted literals from messages.
- `sanitizeError()` (backend) strips `Bearer <token>`, password-like values, and other sensitive patterns from error responses.
- Health/diagnostics fields are sanitized and safe for HTTP (`DockerConnectivity`, `LogSourceHealth`).

## 2. Health model

### Source health (`LogSourceHealth`)
`available`, `statusMessage`, optional `status`, `statusDetail`, plus docker-specific `runtimeType`, `transportType`, `daemonPing`, `suggestedAction` in `SourceHealth` (frontend).

| Source | Health logic |
|--------|--------------|
| Docker | gateway connectivity ping → `LogSourceHealth.fromConnectivity`; plus project-filter misconfig check → `misconfigured` (with available projects). |
| OpenShift | `unavailable("OpenShift Loki base URL not configured")` when base URL empty; else `ok`/`unavailable` from live `/labels` reachability. |
| Fixture | always `ok()` (dev/test only). |

### Docker connectivity states (`DockerConnectivity` / `DockerHealthStatus`)
`LIBRARY_MISSING`, `UNSUPPORTED_TRANSPORT`, `PERMISSION_DENIED`, `DOWN`, `MISCONFIGURED`, `UP`.
- npipe client null is treated as DOWN (not unsupported).
- `suggestedAction` communicates precisely how to fix (e.g. socket permission for non-root uid).

## 3. Frontend health & error UI

| Element | Behaviour |
|---------|-----------|
| `HealthIndicator` | unknown/ok/down tri-state dot + label; `role=status` when down; optional **Retry** button → `handleHealthRetry`. |
| Source error | red state + message + retry. |
| API error | `ApiError` surfaced in the results area (SearchEmpty/error branch). |
| Cancelled run | `CancelledError` distinguished; `cancelled` state (not an error). |
| Empty | `SearchEmpty` suggestions (Widen filters, Search last 1 day). |
| Loading | `SearchLoading` skeleton; reduced-motion-aware. |

## 4. Failure-state catalogue (shared visual language)

From `UX_ACCEPTANCE_REPORT` §2 task 6 and Audit 01 §4:
- source unavailable, no services, no results, invalid time, invalid advanced query, truncated, malformed — all covered by tests (`TableStates.test`, `App.test`, `TimeRangeSelector.test`, `MoreFilters.test`, `ResultsToolbar.test`, `EventTable.test`).

## 5. Actuator & app health

- Only `/actuator/health` exposed, `show-details: never`.
- `GET /api/v1/system/info` → `{name, version, status="UP"}` (hardcoded UP; no source count).

## 6. Live-tail error handling

- `unsupported` SSE event when source lacks LIVE_TAIL.
- `error` SSE event → then normal completion (client reconnects rather than hangs).
- Frontend watchdog: force-abort after `DEFAULT_STALE_TIMEOUT_MS=45s` with "No data received — connection appears stalled".
- Backpressure overflow → `dropped` events + `droppedSinceLastEvent`.
- Concurrency cap reject → error flux.

---

## Gaps / notes (OLD)

1. **SystemInfo.status hardcoded "UP"** — not a real health aggregate (actuator health is authoritative).
2. **Old fixture errors are not surfaced at runtime** (fixture dev-only).
3. **Error detail localization minimal** — single-line messages via `ProblemDetail`.
4. **OpenShift health can only be verified with env configured** (deferred in this environment).
