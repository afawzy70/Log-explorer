# Phase D — OpenShift Loki source — Verification Report

Branch: `phase/d-loki-source`
Date: 2026-09-08

## Prerequisite

Phase C (Docker source) is merged (PR #5) — confirmed via `gh pr list` (`MERGED`) and a fresh `main` checkout with the full backend suite green (155/155) before branching.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase D":

1. **Fully configurable, nothing hardcoded** (`config/LokiProperties.java`): base URL, gateway prefix, tenant, namespace/service/pod/container label keys, namespace (fixed per deployment, not a per-request field), max results, request/connect timeouts, token env var/file path, CA cert path, `rawLogQlEnabled`, `liveTailSupported` — every one externally overridable, all defaults documented in `application.yml` and `.env.example`.
2. **`query_range` semantics** (`source/loki/LokiQueryClient.java`): nanosecond `start`/`end`, `limit`, `direction` (`forward`/`backward`), path built entirely from `LokiProperties` (`{gatewayPrefix}/{tenant}/loki/api/v1/query_range`).
3. **Safe selector escaping + pushdown/post-filter split** (`source/loki/LogQlSelectorBuilder.java`, `core/search/EventFilters.java`): only exact-match namespace (always, from config) and service (only when exactly one is requested) are ever pushed into the LogQL selector — never `=~` regex, so there is no LogQL-injection surface at all. Everything else (traceId, correlationId, text, sensitive filters, multi-service requests, etc.) is applied as an exact post-filter via the same shared `EventFilters.matches()` used by `FixtureLogSource` and `DockerLogSource`.
4. **Normalize, enrich, merge, sort** (`source/loki/LokiLogSource.java`): each Loki stream's lines parsed via the existing `LogLineParser`, enriched with `sourceId`, `namespace`, `pod`, `containerName` (reused from stream labels — pods have containers too), `stream("stdout")`; merged across every returned stream and sorted newest-first (`Comparator.nullsLast(Comparator.reverseOrder())` — malformed/unknown-timestamp events sort last regardless of direction).
5. **Error classification** (`source/loki/LokiErrorClassifier.java`, `LokiRequestException.java`): 401→UNAUTHORIZED, 403→FORBIDDEN, 429→RATE_LIMITED, 5xx→SERVER_ERROR, timeout→TIMEOUT, everything else→UNKNOWN with a fixed sanitized message — never a raw exception message or stack trace surfaced to the caller.
6. **TLS stays on; token never logged** (`source/loki/LokiWebClientFactory.java`, `CompositeX509TrustManager.java`, `LokiTokenSupplier.java`, `core/model/RawToken.java`): `caCertPath` only ever *adds* one more trusted CA on top of the JVM's default trust store — verified with a real TLS handshake against a self-signed certificate, not just a unit-tested trust manager. The bearer token is read fresh per-request (env var takes precedence over file) and wrapped in `RawToken`, which always returns a fixed redacted string from `toString()` — the same architectural (not conventional) redaction pattern as Phase B's `RawSensitiveFields`.
7. **Strictly read-only**: the adapter only ever calls `query_range` — no operator/route/RBAC/Loki-config code or docs anywhere in this phase.
8. **Capability flags reflect reality** (`LokiLogSource#capabilities()`): `liveTail` and `rawLogQL` both come straight from `LokiProperties` — `false` unless explicitly configured, never assumed true; `serviceDiscovery` is deliberately `false` (Phase D's scope never asked for a Loki equivalent of Compose's "list every service" — that would mean querying every label value for the service label, out of stated scope; `discoverServices()` returns `Flux.empty()`, honestly, not silently succeeding with nothing).

## Rule-of-Three refactor that surfaced and fixed a real Phase C bug

Building `LogQlSelectorBuilder`'s pushdown logic made this the third source (`FixtureLogSource`, `DockerLogSource`, now Loki) that needed the same event-level structured-filter matching. Extracted the shared logic into `core/search/EventFilters.matches(CanonicalLogEvent, SearchRequest)` (11 tests, `EventFiltersTest`), used by all three adapters. Extracting it surfaced a real, previously-shipped bug: **`DockerLogSource#searchBlocking()` never applied any per-event structured filter at all** — it only filtered containers by service; a request for a specific `traceId`/`correlationId`/etc. against the Docker source would have silently returned every event in the matched containers' logs, unfiltered. Fixed by calling `EventFilters.matches(enriched, request)` after building each enriched event; a new test (`DockerLogSourceTest#structuredFiltersLikeTraceIdAreActuallyAppliedToEvents`) proves it. This surfaced one downstream test-data bug (`DockerLogSourceTest#wideOpenRequest()`'s time window didn't actually cover its own mock JSON lines' timestamps — previously irrelevant since no post-filtering existed to expose it), fixed by widening the window.

## The `{`/`}` Spring WebClient URI-template bug (found and fixed this phase)

A LogQL selector is literally `{namespace="x"}`. Passing that string straight into `.queryParam("query", query)` and then calling a bare `.build()` on the `UriBuilder` failed with `IllegalArgumentException: Not enough variable values available to expand 'namespace="x"'` — Spring's `UriComponents.expand()` regex-scans **every** component of the built URI, including already-added query values, for `{...}` template-variable syntax, regardless of where the braces came from. Configuring `DefaultUriBuilderFactory` with `EncodingMode.VALUES_ONLY` did **not** fix this (confirmed by re-running the failing test after applying it — still 12/12 failures, identical stack trace) since `expand()` still runs unconditionally. The actual fix (`LokiQueryClient.java`): use **named template variables** (`.queryParam("query", "{query}")` etc.) and supply the real values via `.build(query, startNanos, endNanos, limit, direction)` — expansion then runs exactly once, and the *substituted* value's own literal braces are never rescanned. Verified with a real test run before and after: 12/12 failures → 12/12 passes.

## Automated tests

All commands below were actually run this session.

| Check | Command | Result | Notes |
|---|---|---|---|
| Full backend suite | `./mvnw -q test` | **PASS** | 222/222 tests, 0 failures, 0 errors, exit 0. |
| Shared structured-filter matching | `EventFiltersTest` | PASS | 11 tests: time range (incl. malformed/null-timestamp safety), services, levels, text, every non-sensitive ID field, sensitive-field filters — includes cases (`traceId`, `correlationId`) `DockerLogSource` had never actually exercised before this refactor. |
| Selector construction + escaping | `LogQlSelectorBuilderTest` | PASS | 9 tests: exact-match construction, multi-service non-pushdown, empty-selector fallback, quote/backslash escaping, regex-metacharacter-safe passthrough (since `=` is always literal, never `=~`), blank-service handling. |
| Error classification | `LokiErrorClassifierTest` | PASS | 10 tests: 401/403/429/5xx/unrecognized-status, timeout (both `TimeoutException` and `SocketTimeoutException`), already-classified passthrough, sanitized fallback for unrecognized throwables, no classified message ever blank or raw. |
| Token retrieval + redaction | `LokiTokenSupplierTest` | PASS | 6 tests: empty when unconfigured, real env var read, env-var precedence over file, file read, missing file falls back to empty (never throws), `RawToken.toString()` always redacted. |
| Query construction against a real mock server | `LokiQueryClientTest` | PASS | 12 tests: gateway-prefix/tenant variation (a genuinely different route shape resolves — not a hardcoded default), nanosecond start/end/limit/direction sent verbatim, selector passthrough, bearer-header presence/absence, all 5 error scenarios classified correctly, real client-side timeout. |
| Adapter behavior against a real mock server | `LokiLogSourceTest` | PASS | 13 tests: id/displayName stable; capabilities honestly reflect config both ways; `discoverServices()` empty by deliberate scope boundary; health UP/DOWN mapping; enrichment (namespace/pod/containerName/stream/sourceId) from real stream labels; merge+sort newest-first across multiple streams; structured filters (traceId) applied per-event, not just server-side; malformed lines kept as raw-fallback events, never dropped; `maxResultsPerQuery` sent as `limit`; single-service pushdown in the selector; **multi-service pushdown/post-filter equivalence** — 2 requested services, 3 streams (one non-matching), selector correctly omits the service label (can't push down >1 safely) while `EventFilters` still returns exactly the 2 correct events. |
| Real TLS handshake against a self-signed cert | `LokiWebClientFactoryTest` | PASS | 3 tests, using the JDK's own `keytool` to generate real certificates (not a mocked trust manager): self-signed cert **rejected** with no `caCertPath` configured (proves verification is genuinely on, not trust-all); **accepted** once that same cert is added as the one extra trusted CA; still **rejected** when an unrelated CA is configured instead (proves the extra-CA mechanism can't be tricked into trusting everything). |
| Token never logged | `LokiTokenLeakTest` | PASS | 2 tests, same technique as `com.logexplorer.api.LogLeakTest` (root Logback appender raised to DEBUG — the realistic troubleshooting ceiling): a real bearer token configured via a token file is confirmed present on the wire (`Authorization: Bearer <token>` actually sent) but never appears in captured log output, for both a successful query and a real 401 auth-failure path (including the resulting exception's own message). |
| Secret / unsafe-pattern scan | `grep` across `source/loki/`, `config/LokiProperties.java`, `.env.example` | PASS | Zero hits for credential patterns; every "trust-all" match is a doc comment stating the rule, not code. |

## Manual/live check

Per the plan: *"If and only if a real cluster is reachable: a tiny bounded probe... Otherwise `DEFERRED BY SCOPE`."* No real OpenShift/Loki cluster is reachable from this environment — **live-cluster verification is recorded as DEFERRED**, not PASS, per the plan's own explicit allowance.

As additional (not a substitute) verification, a real end-to-end check was run against `tools/mock-loki` (Phase A2a's standalone mock gateway, not a real cluster):

1. Started `tools/mock-loki/server.js` on `127.0.0.1:3100` with `GATEWAY_PREFIX=/api/logs/v1 TENANT=application NAMESPACE_LABEL=kubernetes_namespace_name SERVICE_LABEL=app`; confirmed it serves real fixture data via a direct `curl`.
2. Booted the real packaged backend (`dev` profile) with `LOGEXPLORER_LOKI_BASE_URL=http://127.0.0.1:3100` and matching gateway/tenant/label config — no code changes, pure env-var wiring, exactly as a real deployment would configure it.
3. `GET /api/v1/sources` → `openshift-loki` present alongside `fixture` and `local-docker`, with honest capabilities (`liveTail: false`, `rawLogQL: false`, `serviceDiscovery: false`).
4. `POST /api/v1/logs/search` with `sourceId=openshift-loki` → real events returned: strict newest-first ordering, `sourceId="openshift-loki"`, `namespace="log-explorer-demo"` (from the mock's stream label), `stream="stdout"`, real trace/span IDs, `protectedFields` correctly present (empty/null in this fixture, but structurally masked the same way every other source is) — a genuine, non-mocked exercise of the whole request→adapter→parse→enrich→mask→serialize pipeline for this source.
5. Real error path: `curl -H "X-Mock-Scenario: 401"` directly against mock-loki confirmed the scenario itself behaves as documented (already covered end-to-end at the adapter level by `LokiQueryClientTest`/`LokiLogSourceTest`, not re-driven through the full HTTP stack here to avoid duplicating that coverage).
6. Cleaned up: killed both the backend process and the mock-loki `node` process; confirmed via `ps aux` that nothing was left running; removed the scratch log files.

## Results

- **PASS:** all 8 Phase D scope items; 55 Loki-specific tests + 11 shared `EventFiltersTest` tests, all green; real TLS-handshake verification (not mocked); real token-never-logged verification; real end-to-end manual check via `tools/mock-loki`.
- **FAIL:** none.
- **BLOCKED:** none.
- **DEFERRED:** live real-OpenShift-cluster verification — no cluster reachable from this environment, exactly the plan's own anticipated and allowed outcome. Not converted to PASS, not a release blocker.

## Regression

Full suite: 222/222 (previously 155 at Phase C's completion; +11 `EventFiltersTest` +55 Loki-specific + 1 new `DockerLogSourceTest` case for the real bug this phase's refactor found). Zero pre-existing tests weakened or deleted — the one Phase C test data fix (`DockerLogSourceTest#wideOpenRequest()`'s time window) made an existing test correct against newly-real behavior, not weaker.

## Security check for this phase

- Sensitive values in responses: unaffected — Loki events flow through the same `LogLineParser`/masking boundary every other source uses; nothing here bypasses it.
- Sensitive values in logs or errors: `LokiErrorClassifier` never echoes a raw exception message, only fixed classified strings (`LokiErrorClassifierTest#unrecognizedThrowablesFallBackToUnknownWithASanitizedMessageNeverTheRawText`); the bearer token is proven never logged, in both the success and auth-failure paths (`LokiTokenLeakTest`).
- Sensitive values in URL or localStorage: N/A, unchanged from prior phases.
- TLS: verification always on; `caCertPath` only ever adds one more trusted CA, never trust-all — verified with a real handshake, not just a unit test (`LokiWebClientFactoryTest`).
- Token handling: read fresh per-request from env var or file (never held as a field, never committed); wrapped in `RawToken`, which always redacts in `toString()` — architectural, not conventional, matching Phase B's `RawSensitiveFields` pattern.
- Read-only: only `query_range` is ever called; no operator/route/RBAC/Loki-config code anywhere in this phase's diff.
- `.env.example` / `application.yml`: variable names and harmless defaults only (no base URL, no token, no CA path committed); scanned for secrets, zero hits.

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 2, 34, 35, 36 → **Done**. Rows 30, 77 → **Partial** (Phase D's own share — honest capability-flag reporting — is complete; actual raw-LogQL execution is Phase E's job, actual live-tail transport is Phase J's job). The "Live OpenShift verification is DEFERRED" superseded-decision row → **Applied**.

## Known gaps carried forward

- Live real-OpenShift-cluster verification remains DEFERRED — not a Phase D defect, the plan's own anticipated and allowed outcome in an environment with no reachable cluster.
- Row 30 (raw LogQL execution) and row 77 (live-tail transport) — Phases E and J respectively.
