# Phase 12A — Local Docker Compose Integration Report

- **Date:** 2026-08-12 (updated after Docker Desktop upgrade + engine restart)
- **Environment type:** Local Windows host; Docker engine now healthy via the Java `npipe` transport.

## Docker availability (resolved)
- Docker Desktop upgraded to **4.86.0** and engine restarted; engine **29.7.2**, API **1.55**
  (client min **1.40**), containerd v2.2.5, runc 1.3.6.
- The application's docker-java HTTP client (`npipe:////./pipe/dockerDesktopLinuxEngine`) transport
  now connects at runtime: `/version`, `/info`, `/containers/json` return **200**; gateway
  connectivity reports **UP**.
- **Environment note:** the earlier "transport unreachable / 503" behaviour was a Docker Desktop
  engine hang (the `apiproxy` component returned `500` with `context deadline exceeded (10s)` to
  every client — `docker CLI`, docker-java, and Docker Desktop alike). This was resolved by the
  Docker Desktop upgrade + engine restart; it was not an application defect. The application also
  had a log-read hang (30 s per container) that masked the fix; see "Files changed".

## Selected Compose project and services
- **Compose project:** `boubyan-platform` (single project; `com.docker.compose.project` label).
- **Containers discovered:** 35 total, ~25 running; 33 services resolved via the
  `com.docker.compose.service` label (accounts, audit-tracker, cards, config-server, contact-profile,
  content, eservices, finance, fixed-deposit, funds, iam, lookup, nginx, notification, onboarding,
  payments, savings, transactions, transfer-service, utility-hub, wamd, webhook + infra `redis-dev`,
  `artemis`, and others).

## Bounded lines inspected
- Up to **20 recent lines** read per inspected container (`docker logs --tail 20`).
- `docker_compose_log_source_integration` samples a **running container whose recent lines actually
  parse into canonical events** (deterministic choice), so parsing/masking assertions no longer depend
  on container start order (plain-text containers such as nginx yield no parsed events and are skipped).

## Detected field names (names only; no values)
Canonical parser fields detected in the bounded sample:
- `@timestamp`, `@version`, `application`, `level`, `level_value`, `logger_name`, `message`,
  `thread_name`, `stack_trace`.

Mapped into canonical `LogEvent` model:
- `@timestamp` → timestamp
- `application` → service
- `level` → severity
- `message` → message

Remaining canonical fields (`traceId`, `spanId`, correlation/journey/event IDs, `ERROR_CODE`) were not
present in the bounded recent windows of the sampled services; the parser mapping for these (top-level
and nested `mdc` variants) plus sensitive masking is covered by the dedicated unit/test suite.

## Parsing result counts
- `DockerLiveIntegrationTest`: **9 tests, 0 failures, 0 errors, 0 skipped** (all pass).
- Backend full suite: **345 tests, 0 failures, 0 errors, 1 skipped** (remote-only Loki) — BUILD SUCCESS.
- Frontend: **184 tests / 14 files pass**; `tsc` typecheck and `vite build` succeed.
- Malformed / non-JSON fallback: the parser returns a `RawLine` outcome (raw-event fallback) instead of
  dropping the line; verified by `malformed_lines_use_raw_fallback` and `stream_frames_stripped_of_docker_prefix`.

## Masking verification
- Verified via parser unit tests plus the integration assertion path for `cif` (full `****`),
  `CustomerId`, `UserName`, `deviceId` (partial mask), and `deviceIp` (last two octets masked).
- The bounded sampled lines did not contain these sensitive fields, so real-data masking could not be
  triggered in the live sample; the masking logic is exercised by the unit test suite.

## Historical-search result
- Live bounded search through `DockerComposeLogSource.searchHistorical` against the healthy engine:
  **100 real parsed events returned in ~1.19 s** (e.g. `audit-tracker` / `DEBUG` entries with real
  timestamps and messages), enriched with `_source=docker-compose`.

## Live-tail result
- `DockerComposeLogSource.streamLive` against the healthy engine: **19+ real events received in 8 s**
  across running containers; survives cleanup.
- Disconnect/cancel releases the Docker stream callback; verified by
  `stream_cancel_releases_docker_callback` (events stop after cancel) and by disposing the live-tail
  subscription.

## Performance observations
- Bounded reads are fast and bounded: a 100-event historical window completed in ~1.19 s (was ~30 s per
  container before the `executeLogCommand` fix). Parser throughput on the bounded samples is negligible.

## API-layer verification
- Standalone Log Explorer backend is not currently bound to `:8080` (that port is held by the user's
  `AccountsServiceApplication`); the docker-compose HTTP/health/search/tail endpoints are covered by the
  MockMvc integration suites: SearchController (17), SimpleQueryApi (16), LogTailController (5),
  SystemInfo (3) — all green.

## OpenShift integration
- **DEFERRED BY SCOPE — no access currently available.** No OpenShift connectivity was tested, and no
  OpenShift credentials/environment were checked. The OpenShift adapter and its tests are unchanged.

## Files changed this pass
- `backend/src/main/java/com/example/logexplorer/docker/DockerGatewayDefault.java` — `executeLogCommand`
  no longer relies on the exec wrapper's unreliable `awaitCompletion`; it waits on its own latch bounded by
  `OPERATION_TIMEOUT_MS`, eliminating the 30 s-per-container log-read hang.
- `backend/src/test/java/com/example/logexplorer/docker/DockerLiveIntegrationTest.java` — deterministic
  selection of a parseable running container (instead of first-start-order container).
- `docs/INTEGRATION_REPORT.md` — this report (status updated to resolved).

## Commands executed (sanitized)
- `docker version`, `docker ps --filter label=com.docker.compose.project=boubyan-platform`
- `docker logs --tail 20 <service>` (bounded, names/keys only reported)
- `mvn -o test -DskipFrontend` (backend full suite; `-Pdocker-smoke` for the live smoke suite)
- `mvn -o test -Dtest=DockerLiveIntegrationTest -DskipFrontend`
- `npm run test`, `npm run typecheck`, `npm run build` (frontend)

## Result
- **Docker: PASS** — verified live against the restarted, healthy engine: daemon connectivity (npipe 200),
  discovery (35 containers / 33 services), bounded historical search (100 events / 1.19 s), live-tail
  (events stream and cancel cleanly), parsing, fallback and masking logic. Not AWAITING PROJECT SELECTION —
  exactly one Compose project (`boubyan-platform`) exists and is used.
- **OpenShift: DEFERRED BY SCOPE — no access currently available.**
