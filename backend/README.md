# Backend developer guide

Java 21, Spring Boot 3 (WebFlux — reactive end to end, no blocking servlet
stack), Maven. This is the developer-facing companion to the root
[`README.md`](../README.md) and
[`docs/development/ARCHITECTURE.md`](../docs/development/ARCHITECTURE.md) —
read those first for the product picture; this document is "I'm changing
backend code, where do I look."

## Stack and entry point

- Java 21, Spring Boot 3.x, WebFlux (Netty), Maven (wrapper-only — `mvnw`/
  `mvnw.cmd`, never a globally-installed Maven).
- Entry point: `com.logexplorer.LogExplorerApplication` (a plain
  `@SpringBootApplication`, nothing unusual — the interesting behavior is
  in the beans it wires, not the bootstrap itself).
- Default port **3434**, bound to `127.0.0.1` by default (both overridable
  — `SERVER_PORT`/`SERVER_ADDRESS`; see `src/main/resources/application.yml`
  and the root README's "Production vs. development" table for why Docker/
  OpenShift explicitly override the address).
- No application database — every request is served live from whichever
  source it targets; nothing is persisted server-side.

## Project structure

```
src/main/java/com/logexplorer/
  LogExplorerApplication.java   Entry point
  api/                          REST controllers, request/response mapping, the one exception handler
    dto/                        Request/response DTOs (what actually crosses the wire)
    live/                       The SSE (Live tail) controller + its own service
  config/                       @ConfigurationProperties classes + Spring config (CORS/SPA fallback/security)
  core/
    model/                      The canonical event model (CanonicalLogEvent) and other source-agnostic types
    parse/                      Raw log line -> CanonicalLogEvent
    mask/                       The one masking boundary (structured fields + free-text redaction)
    query/                      The query DSL: lexer, parser, AST, evaluator, plan/explain
    search/                     Cursor pagination, in-memory post-filtering
    guard/                      Concurrency/rate guardrails
  source/                       The LogSource abstraction + one package per adapter
    docker/                     Docker Engine API adapter (+ security/ - remote-host SSRF guard)
    loki/                       OpenShift Loki adapter (+ plan/ - LogQL DSL planning)
    fixture/                    In-process synthetic source (dev/test only)
src/main/resources/application.yml   All configuration, with defaults and doc comments
src/test/java/...                    Mirrors the main tree; see "Tests" below
```

## Controllers (`api/`)

| Controller | Path | Purpose |
|---|---|---|
| `SourcesController` | `GET /api/v1/sources`, `GET /api/v1/sources/{id}/health`, `GET /api/v1/sources/{id}/services` | Source discovery, capability reporting, health, service list |
| `SearchController` | `POST /api/v1/logs/search`, `POST /api/v1/logs/context`, `POST /api/v1/logs/journey` | Historical search, the bounded `±30s` context view, the journey/correlation timeline |
| `LiveTailController` (`api/live/`) | `GET /api/v1/logs/live` (SSE, `text/event-stream`) | Real-time tail |
| `DockerSettingsController` | `GET /api/v1/sources/docker/connection`, `POST /api/v1/sources/docker/test-connection` | Read the effective Docker connection config; test a *candidate* config without applying it |
| `GlobalExceptionHandler` | (not a controller — `@RestControllerAdvice`) | The one place exceptions become `ProblemDetail` responses — see "Error handling" below |

Every endpoint is under `/api/v1/**`; `/actuator/health` and
`/actuator/info` are the only other exposed paths (see
`application.yml`'s `management.endpoints.web.exposure.include`).

## Services / application layer

- `SearchService` (`api/`) — orchestrates a search: resolves the source,
  builds/validates the query, calls the adapter, applies masking, builds
  the response DTO. This is the layer almost every "add a new search
  behavior" change touches.
- `LiveTailService` (`api/live/`) — owns one SSE stream's lifecycle:
  subscribes to the source's tail, applies masking per-event, enforces the
  bounded server buffer (`logexplorer.live.server-buffer-size`) and
  heartbeat interval, and cleans up on client disconnect.
- `EventMapper` / `RequestMapper` (`api/`) — the only place
  `CanonicalLogEvent`/`SearchRequest` (internal) convert to/from
  `EventDto`/`SearchRequestDto` (wire). If you add a field to the
  canonical model that should reach the frontend, it has to be wired here.

## The `LogSource` abstraction (`source/`)

`LogSource` (`source/LogSource.java`) is the one interface every adapter
implements — search, context, journey, live tail (where supported),
service discovery, and `SourceCapabilities`/`SourceHealth` reporting.
`LogSourceRegistry` holds the configured set (`local-docker`, `fixture`,
`openshift-loki`) and is what `LogExplorerSourceController`s actually
depend on — no controller or service ever imports a concrete adapter
directly.

**Extension point**: a new source type implements `LogSource`, is
registered as a Spring bean (picked up automatically by
`LogSourceRegistry`), and must honestly report its own
`SourceCapabilities` — the frontend trusts this completely and never
infers or guesses what a source can do.

### Docker adapter (`source/docker/`)

`DockerLogSource` — talks to the Docker Engine API (local socket, or a
configured remote host) via `ReadOnlyDockerClient`, a client that
structurally cannot call anything but list/inspect/read-logs/follow-logs
(CLAUDE.md §2 rule 8 — never start/stop/create/remove/exec). Container
discovery honors `logexplorer.docker.compose-project-filter` and
`ComposeLabels.EXCLUDED` (the exact mechanism the app uses to exclude its
own container from self-discovery — see the label check in
`DockerLogSource#relevantContainers`, checked *before* project filtering).
Remote Docker host resolution goes through `source/docker/security/
HostResolver` + `RemoteHostGuard` — a default-deny SSRF/DNS-rebinding
policy for loopback/link-local/private-LAN/cloud-metadata addresses,
overridable only via an explicit CIDR/hostname allowlist
(`logexplorer.docker.remote-allowlist`). Blocking Docker client calls run
on `Schedulers.boundedElastic()`, never the WebFlux event loop (CLAUDE.md
§5).

### Loki adapter (`source/loki/`)

`LokiLogSource` — queries an OpenShift LokiStack gateway over HTTPS
(`LokiQueryClient`/`LokiWebClientFactory`), with TLS verification always
on (`CompositeX509TrustManager` only ever *adds* a trusted CA on top of
the JVM default trust store — it never disables verification). Raw LogQL
mode (`source/loki/plan/LogQlDslPlanner`) is config-gated
(`logexplorer.loki.raw-log-ql-enabled`), off by default, and still bounded
(`max-results-per-query`). `LokiTokenSupplier` reads a bearer token fresh
per request from an env var or file — never logged, never cached
insecurely.

### Fixture adapter (`source/fixture/`)

`FixtureLogSource` + `FixtureCorpusGenerator` — a fully synthetic,
deterministic in-process source, active only under the `dev`/`test`
Spring profiles. This is what every E2E spec and the Docker Compose Quick
Start actually search against; it has no external dependency at all. If
you need a new deterministic scenario for a test (a specific redaction
pattern, a malformed line, a Live-tail burst), this is almost always the
right place to add it — see `FixtureCorpusGenerator`'s own doc comment for
its corpus-slot conventions.

## Canonical event model (`core/model/CanonicalLogEvent.java`)

The one event shape every adapter parses into and every response is built
from — source-agnostic. Sensitive fields live in a nested
`RawSensitiveFields` (never on the top-level record) specifically so the
masking boundary (below) has one clear seam to intercept, and so a field
added elsewhere in the record can never accidentally bypass masking by
construction.

## Parsing / normalization (`core/parse/LogLineParser.java`)

Raw log line → `CanonicalLogEvent`. Key invariants (each came from a real
bug, see `CLAUDE.md` §4 "Parsing"):

- Correlation precedence: `mdc.X-Correlation-id`, then the **literal**
  key `mdc["event.correlationId"]` (a key containing a dot, not a nested
  path).
- Service precedence: top-level `application` field, then source metadata
  — both are kept if they differ, never silently one-or-the-other.
- Unknown JSON/MDC fields are never discarded (`unknownTopLevelFields`/
  `unknownMdcFields` on the canonical model).
- A line that fails to parse becomes a raw-fallback event (`malformed:
  true`, `rawLine` populated) — never silently dropped, and one bad field
  never discards the whole event.
- An empty `message` is preserved as empty, not invented — the frontend
  supplies a display fallback (`(empty message)`), the backend never does.

## Masking / redaction (`core/mask/`) — the security-critical layer

- `MaskingService` — the single boundary every response crosses before
  serialization. Masks the five structured sensitive fields
  (`RawSensitiveFields` → `MaskedSensitiveFields`) unconditionally,
  regardless of source or endpoint.
- `TextRedactor` — a conservative, pattern-based pass over free-text
  fields (`message`, `exception`) for a small set of high-confidence
  patterns: Luhn-valid card-like numbers, bearer/JWT tokens, `password=`-
  style key/value pairs. Deliberately narrow — it is not general DLP, and
  a plausible-but-Luhn-invalid number is left visible on purpose (see its
  own doc comment and `docs/SECURITY_NOTES.md` for the exact rule list and
  why each boundary was drawn where it was). Performance-sensitive: run
  against every event in a response, so it must stay allocation-light and
  have no unbounded-recursion/catastrophic-backtracking regex — see
  `TextRedactorPerformanceTest`.

**Non-negotiable** (CLAUDE.md §2): raw sensitive values never leave in a
response, are never logged (including via `toString()`, exception
messages, `ProblemDetail`, or request/access logs — `reactor.netty`/
`io.netty` logging is pinned to `INFO` specifically so an operator raising
root log level can't accidentally start wire-tracing raw request bodies),
and there is no reveal/unmask action anywhere in the API surface.

## Query / search (`core/query/`, `core/search/`)

- `QueryLexer`/`QueryParser`/`core/query/ast/` — a small guided-query DSL
  (field comparisons, AND/OR), parsed into an AST.
- `QueryEvaluator` — evaluates the AST against a `CanonicalLogEvent` for
  post-filtering (conditions a source can't push down).
- `QueryPlanBuilder`/`QueryPlanExplainer` — builds the `QueryPlan` the
  frontend displays (what was pushed down to the source vs. evaluated
  in-process) — see `QueryPlanLeakTest` for the guarantee that a plan
  never echoes a raw sensitive filter value back to the client.
- `EventFilters` (`core/search/`) — the in-memory post-filter path for
  conditions a source's own query language can't express.

### Pagination / cursors (`core/search/PageCursor*.java`)

Cursor-based, not offset-based. `PageCursorCodec` encodes an opaque,
**HMAC-signed** cursor (`PageCursorPayload`) — never a raw offset or raw
query text a client could inspect or tamper with; see `CursorLeakTest`
and `SearchServicePaginationTest`. A cursor from one query is rejected if
replayed against a different one (the signature covers the query
identity, not just the position).

## Context / journey

Both are `SearchController` endpoints, not separate services — `context`
re-queries the same source with a computed `±30s` window around one
event's timestamp (optionally scoped to the same container/pod); `journey`
re-queries by a specific correlation/trace/journey ID. Neither is a
special backend concept beyond "a differently-constructed `SearchRequest`"
— the investigation-specific presentation (chronological ordering, the
"not causality" disclaimer, gap-between-events detection) is entirely a
**frontend** concern (`frontend/src/features/journey/`,
`frontend/src/features/results/gapDetection.ts`) computed client-side from
the same `SearchResponseDto` shape historical search already returns —
worth knowing before searching backend code for "gap semantics": there
isn't a backend one.

## Live / SSE (`api/live/`)

`GET /api/v1/logs/live` streams `text/event-stream`, one event per SSE
message, masked exactly the same way as historical search (never a
separate, weaker code path). Bounded by design: `LiveTailGuard`/
`ConcurrencyGuard` cap concurrent tails
(`logexplorer.live.max-concurrent-tails`), `LiveTailService` caps its own
server-side buffer (`server-buffer-size`) and sends a heartbeat
(`heartbeat-interval`) so a client can detect a silently-dead connection.
See `docs/development/BACKEND_FRONTEND_INTEGRATION.md` for the full
producer→buffer→frontend-batching flow, and the frontend guide's own
"Live state machine" section for the client half.

## Source health

`SourcesController#health` calls the adapter's own health check
(connectivity + a lightweight capability probe) and returns
`SourceHealthDto` — status, a human message, warnings, latency, and the
resolved `SourceCapabilities`. Never fabricated: a source reports
`liveTailSupported`/`rawLogQlEnabled`/etc. based on real configuration and
connectivity, not a hardcoded assumption per source *type*.

## Error handling (`GlobalExceptionHandler`)

Every exception → RFC 7807 `ProblemDetail`, in one place. Never echoes a
raw sensitive value, a raw query, or a stack trace to the client — see
`QueryPlanLeakTest`/`LogLeakTest` for the automated guarantee. Guardrail
violations (`GuardrailViolationException` and its subtypes —
`TooManyConcurrentSearchesException`, `TooManyConcurrentLiveTailsException`)
map to a specific, honest status/detail rather than a generic 500.

## Configuration (`config/`, `application.yml`)

Every tunable is a `@ConfigurationProperties` class under `config/`,
bound from `application.yml` with every default documented inline there
and mirrored in `.env.example` at the repo root (same variable names,
same defaults, same explanations). `SpaWebFluxConfig` is what serves the
embedded frontend build with an SPA fallback that structurally cannot
swallow `/api/**` or `/actuator/**` (see its own routing precedence).

## Security boundaries (summary — see `docs/SECURITY_NOTES.md` for the full posture)

- Docker: read-only, never mutating (`ReadOnlyDockerClient`); remote
  Docker TLS is optional but never trust-all; `/var/run/docker.sock` is
  never mounted except behind an explicit, doubly-gated Compose profile.
- Loki: TLS verification always on; raw LogQL is config-gated and bounded.
- Masking is unconditional and source-agnostic — an adapter cannot opt
  out of it, by construction (there is no code path from an adapter's
  return value to an HTTP response that doesn't cross `MaskingService`).
- Nothing is ever logged that could contain a raw sensitive value or
  secret (search text, tokens, credentials).

## Performance invariants (summary)

- No unbounded scans, arrays, or buffers anywhere — every adapter query,
  the Live server buffer, and the display cap on the frontend are all
  explicitly bounded.
- Blocking calls (the Docker client) always run off the WebFlux event
  loop (`Schedulers.boundedElastic()`).
- `TextRedactor` and cursor encode/decode are both on the hot path for
  every search response and are covered by dedicated performance tests,
  not just correctness tests.

## Tests

`src/test/java/com/logexplorer/...` mirrors the main tree. Notable
categories beyond ordinary unit tests:

- `*ApiIntegrationTest` — real `WebTestClient` calls against a running
  application context.
- Leak tests (`LogLeakTest`, `QueryLeakTest`/`QueryPlanLeakTest`,
  `LokiTokenLeakTest`, `SerializationLeakTest`, `CursorLeakTest`) — assert
  a sensitive value/token/raw cursor payload never appears in a log line,
  response body, or serialized form, anywhere.
- `ArchitectureTest` (ArchUnit) — enforces package boundaries (e.g. no
  controller depends on a concrete adapter directly).
- `*PerformanceTest` (e.g. `TextRedactorPerformanceTest`) — bounded-time
  assertions on hot-path code, not just correctness.

Run everything: `./mvnw test` (or `./mvnw verify` for the full lifecycle,
including integration tests bound to the same `verify` phase — this
project has no separate `failsafe` binding). Windows: `.\mvnw.cmd test`.
**Never** `-DskipTests` outside of intentional packaging steps that are
already covered by CI's own Backend job (e.g. the Windows desktop
packaging workflow skips tests when building the jar it bundles, because
the Linux `Backend` CI job has already run the full suite against the
same commit).

## Where do I change X?

| I want to... | Look at |
|---|---|
| Add a new REST endpoint | `api/` (a new/existing `@RestController`) + `api/dto/` for its request/response shape + `EventMapper`/`RequestMapper` if it touches the canonical model |
| Add a new log source | Implement `source/LogSource`, register it as a Spring bean, add a `config/` properties class if it needs configuration, and honestly report `SourceCapabilities` |
| Add a new canonical field | `core/model/CanonicalLogEvent.java`, then `core/parse/LogLineParser.java` (how it's populated), then `api/EventMapper.java`/`api/dto/EventDto.java` (how it reaches the wire) |
| Change Docker behavior | `source/docker/DockerLogSource.java` (discovery/search/live), `source/docker/security/` (remote-host safety) |
| Change Loki behavior | `source/loki/LokiLogSource.java`, `source/loki/plan/LogQlDslPlanner.java` (LogQL construction) |
| Add/change a search filter | `core/query/` (DSL grammar/AST/evaluator) + `core/search/EventFilters.java` (post-filter execution) + the matching frontend field in `frontend/src/features/search/advancedFilterFields.ts` |
| Add/change a redaction rule | `core/mask/TextRedactor.java` — and its own performance test; never move redaction client-side |
| Change Live behavior | `api/live/LiveTailService.java` (server buffering/heartbeat/guardrails) — the frontend's own batching lives in `frontend/src/features/live/useLiveTail.ts` |
| Change source-health reporting | `api/SourcesController.java` + each adapter's own health-check method |
| Add backend test coverage | Mirror the package under `src/test/java` — reuse the Fixture source for deterministic data wherever the behavior doesn't need to be Docker/Loki-specific |
