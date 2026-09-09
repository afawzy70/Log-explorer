# Audit 10 — Backend Services & API

**Scope:** Complete backend surface of the OLD app: framework, endpoint catalogue (request/response), service/component inventory, capabilities, limits, and configuration knobs.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Framework & runtime

- **Spring WebFlux (Reactive)**, not MVC: only `spring-boot-starter-webflux`; reactive types (`Mono`/`Flux`); reactive `WebFilter`/`GlobalExceptionHandler`; `Flux<ServerSentEvent>` for live tail.
- Base path `/api/v1`. Port `5050`. App name `log-explorer`.
- **Actuator:** only `health` exposed (`show-details: never`).
- **SPA fallback:** `SpaFallbackController` serves `static/index.html` for history paths, does **not** intercept `/api` or `/actuator`.

## 2. Endpoint catalogue

### SearchController — `GET /api/v1/sources`, `/sources/{id}/health`, `/sources/{id}/services`, `POST /api/v1/logs/search`
| Method | Path | Request | Response |
|--------|------|---------|----------|
| GET | `/api/v1/sources` | — | `List<LogSourceDescriptor{id,displayName,capabilities,enabled}>` |
| GET | `/api/v1/sources/{id}/health` | path id | `LogSourceHealth` or 404 |
| GET | `/api/v1/sources/{id}/services` | path id | `List<String>` |
| POST | `/api/v1/logs/search` | `LogSearchRequest` (+ optional `X-LogExplorer-Session`) | `LogSearchResponse` or 400 |

`LogSearchRequest` fields: `sourceId`(required), `start`/`end`(Instant, required), `direction`(NEWEST_FIRST|OLDEST_FIRST, default NEWEST_FIRST), `limit`(default 100, cap 5000), `services`, `levels`, `text`, structured exacter filters `traceId/spanId/correlationId/journeyId/eventId/errorCode/businessStep`, `simpleQuery`, `rawLogQl`, `rawLogQlMode` (**force-disabled in constructor**), `uiIdentifier`.

Validation: start before end; start not older than 30 days.

`LogSearchResponse`: `sourceId, events, truncated, nextCursor (always null), executionDuration, start, end, warnings, statistics{available,totalMatching,returned}, generatedLogQl, pushDownConditions, postFilterConditions`.

Search flow: optional `simpleQuery` → tokenized → parsed → validated → compiled to in-memory predicate → planned → `searchHistorical` → predicate post-filter → truncate at limit → mask each event (`masking.toResponse(e, session)`). On simple-query validation failure → 400 with a partial response carrying warnings/errors.

### LogTailController — `GET /api/v1/logs/tail` (SSE)
Query params: `sourceId`(required), `services`, `levels`, `text`, `limit`(default 1000), `timeoutSeconds`, `sessionId`, `liveSessionId`, `afterTimestamp`(Long ms).
- `Flux<ServerSentEvent<Map>>`, `text/event-stream`.
- Event types: `event`, `dropped`, `heartbeat`, `unsupported`, `error`.
- Backpressure buffer 256 (drop+count); heartbeats merged (15s); `liveSessionId` boundary (cap 10k); concurrency cap 10 (`LogTailManager`); timeout via `.take`; errors → `error` then completion.
- See Audit 08 for full detail.

### SettingsController — `/api/v1/settings/masking*`
| Method | Path | Response |
|--------|------|----------|
| GET | `/settings/masking` | `MaskingStatus` |
| POST | `/settings/masking/unmask` `{sessionId,confirm}` | `MaskingStatus` (400 no confirm / 403 not permitted) |
| POST | `/settings/masking/mask` `{sessionId}` | `MaskingStatus` |
| GET | `/settings/masking/fields` | `MaskingStatus` |
| POST | `/settings/masking/fields` `{sessionId,field,enabled}` | `MaskingStatus` |

See Audit 09.

### DockerConnectionController — `/api/v1/docker-connection`
| Method | Path | Response |
|--------|------|----------|
| GET | `/docker-connection` | secret-free `DockerConnectionView` |
| POST | `/docker-connection` `DockerConnectionRequest` | `DockerConnectionView` |
| DELETE | `/docker-connection` | `DockerConnectionView` (reset local) |
| POST | `/docker-connection/test` `DockerConnectionRequest` | `DockerConnectionTest{success,status,transportType,message}` |

Session-scoped per-user. Security validation (SSRF/DNS-rebinding/port range/allowlist). See Audit 09.

### SystemInfoController — `GET /api/v1/system/info`
`SystemInfo{name, version, status="UP"}` — does **not** report source count.

## 3. Log source implementations

| Source | id | displayName | Capabilities | Notes |
|--------|----|-------------|--------------|-------|
| Docker Compose | `docker-compose` | Local Docker Compose | HISTORICAL_SEARCH, LIVE_TAIL, SERVICE_DISCOVERY | gated by `logexplorer.docker.enabled` (default true). |
| OpenShift Loki | `openshift-dev` | OpenShift Development | HISTORICAL_SEARCH, SERVICE_DISCOVERY, QUERY_STATISTICS | **no LIVE_TAIL**; gated by `logexplorer.openshift.enabled`. |
| Fixture | `fixture` | — | HISTORICAL_SEARCH, LIVE_TAIL, SERVICE_DISCOVERY | `@Profile("dev|test")`; 10 synthetic events; dev/test only. |

`RAW_LOGQL` and `CONTEXT_VIEW` capabilities are defined but **not implemented by any source**.

### Registry & health-gating
- `LogSourceRegistry` maps sourceId→source; `resolve` throws `SourceNotFoundException`/`SourceUnavailableException` based on `healthStatus().available()`.
- `descriptor.listDescriptors` → `enabled = healthStatus().available()`.

## 4. Docker backend

- **Resolution:** `DOCKER_HOST` env → Windows `npipe:////./pipe/dockerDesktopLinuxEngine`/`docker_engine` → `unix:///var/run/docker.sock`; REMOTE → `tcp://host:port` (AUTO 2375/2376 per TLS, or CUSTOM).
- HTTP client: `ApacheDockerHttpClient` maxConnections 100, connect 30s, **infinite response timeout** (keeps `--follow` open).
- Discovery filters by Compose project label; excludes own-app via `logexplorer.excluded` label; only surfaces containers with a `composeProject` label.
- Historical: reads most recent **200 lines per container** (`MAX_LOG_TAIL`), global `MAX_SCAN_LINES=100_000`, truncates to limit (default 100).
- Health: `DockerConnectivity` ping → `LogSourceHealth.fromConnectivity`; project-filter misconfig check → `misconfigured`.
- Per-session gateway via `DockerConnectionService`.

## 5. OpenShift Loki backend

- `searchHistorical` builds LogQL, cap `MAX_QUERY_LIMIT=5000`, ASC/DESC, `gateway.queryRange`, parse/enrich/filter.
- Query building (`LogQueryBuilder`): `{fixedLabels, app="service", level="level"} | json | traceId="…" | spanId="…" |~ regexText`; label values escaped; regex escaped via `Pattern.quote`.
- Bearer token from env `OPENSHIFT_LOKI_TOKEN`; TLS default (truststore).
- Health: `unavailable("OpenShift Loki base URL not configured")` when `baseUrl` empty; else `ok`/`unavailable` based on live `/labels` reachability.
- Service discovery via label values (default label key `app`).
- **`streamLive()` returns `Flux.empty()`** — no live tail.

## 6. System & config knobs (`application.yml`)

| Knob | Default | Notes |
|------|---------|-------|
| `server.port` | 5050 | |
| actuator exposure | health only | show-details never. |
| `logexplorer.docker.enabled` | true | |
| `logexplorer.docker.project-filter` | `boubyan-platform` | |
| `logexplorer.docker.connection.allow-insecure-remote-docker` | true | false in prod. |
| `logexplorer.docker.connection.connection-timeout-ms` | 5000 | |
| `logexplorer.openshift.enabled` | true | |
| `logexplorer.openshift.base-url` | `${OPENSHIFT_LOKI_BASE_URL:}` | empty → unconfigured. |
| `OPENSHIFT_LOKI_TOKEN` | (env) | never logged. |
| `logexplorer.query.rawLogQl.enabled` | false | |
| `logexplorer.masking.enabled` | true | |
| `logexplorer.security.unmask.enabled` | false | ttl 300s. |
| `logexplorer.tail.max-concurrent` | 10 | |
| `logexplorer.tail.heartbeat-seconds` | 15 | |
| `logexplorer.tail.default-timeout-seconds` | 0 | |

Limits: search limit cap 5000; search window ≤30 days; live display 1000 (client) / buffer 100; live backpressure 256.

## 7. Known backend dead/unfinished artefacts

- `LogTailRequest.java` — unused DTO.
- `rawLogQlMode` force-disabled (dead path).
- `nextCursor` always null.
- `SimpleQueryField.knownFieldNames()`, `LogTailManager.registerSubscription(...)`, `LogEventParser.resolveCorrelationId(Map)`, `SimpleQueryToken.UNKNOWN` — unused.
- `MaskingService.configureExtraFieldRules` empty; `MaskingProperties.fieldRules` read-not-applied.
- `LokiStreamEntry` unused.
- TEMP-VERIFY instrumentation gated by `logexplorer.verify.*` (no-op normally).
