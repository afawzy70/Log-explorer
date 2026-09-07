# Phase B — Canonical model, parser, masking, source contract, guardrails — Verification Report

Branch: `phase/b-core-correctness`
Commit: (this report lands as part of the phase's final commit)
Date: 2026-09-08

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase B", scaffolding `backend/` from empty (per the Phase A amendment — no prior backend code existed):

1. **`CanonicalLogEvent`** (`core/model/CanonicalLogEvent.java`) — all §5.1 mappings, plus `unknownTopLevelFields`/`unknownMdcFields` preserving anything not in the canonical list, plus `serviceSourceHint` retained alongside `service` per the service-precedence rule.
2. **Correlation precedence** (`mdc["X-Correlation-id"]` → literal `mdc["event.correlationId"]`, proven not to be mistaken for a nested path) and **service precedence** (`application` retained alongside a source-hint field, kept even when they agree) — both in `core/parse/LogLineParser.java`.
3. **Timestamps**: accepts offsets, normalizes to `Instant`, keeps the original string in `timestampRaw`, never double-converts.
4. **Malformed lines** → raw fallback event (`malformed=true`, `rawLine` set), never dropped; a single bad field (unparseable timestamp, non-numeric `level_value`) doesn't discard the rest of the event.
5. **Empty message preserved** as `""`, distinct from a genuinely absent key (`null`) — no fabricated text.
6. **Multiline/escaped-newline exceptions** stay one logical JSON event; both a plain-string and an object-shaped (`class`/`message`/`stacktrace`) exception field are normalized.
7. **`MaskingService`** (`core/mask/MaskingService.java`) — the single masking boundary: `cif` strongly masked (fixed `****`, never reveals length), `CustomerId`/`UserName`/`deviceId` partially masked (first 2 + last 2 chars, full mask below a safe threshold), `deviceIp` final portion masked for both IPv4 and IPv6 (including the `::`-compression edge case). Applied in `api/EventMapper.java`, before any DTO is built.
8. **Raw values never leak** — proven, not assumed, by `SerializationLeakTest` (JSON output) and `LogLeakTest` (real Logback capture across success, guardrail-violation, and unknown-source paths, checking both response bodies and everything logged).
9. **`LogSource` SPI + `LogSourceRegistry`** (`source/LogSource.java`, `source/LogSourceRegistry.java`) — stable IDs, config-driven disable list, unknown/disabled → sanitized 404/400 `ProblemDetail`.
10. **Guardrails** (`core/guard/SearchGuardrails.java`, `core/guard/ConcurrencyGuard.java`) — `start < end`, default limit, configurable max (≤ 5,000, clamped not rejected when exceeded), per-source max time range (config map, overridable in either direction), request timeout, bounded concurrency (non-blocking `Semaphore`), cancellation propagation, truthful truncation metadata (request-limit-plus-one trick).
11. **`SourceCapabilities`** returned from `GET /api/v1/sources`, plus `GET /api/v1/sources/{id}/health` and `GET /api/v1/sources/{id}/services`, and `POST /api/v1/logs/search` wired end-to-end through guardrails → registry → the `LogSource` SPI (no real backing implementation yet — that's Phases C/D).

**Architecture:** the masking boundary is enforced by ArchUnit rules, not convention — `api.dto` may not depend on `CanonicalLogEvent`; nothing in `api` may depend on `RawSensitiveFields` (only `core.mask.MaskingService` may); nothing in `api` may depend on `core.parse` at all. All three rules were verified to actually fail on a deliberately-introduced violation before being trusted (see Automated tests).

## Explicitly not delivered

- Real Docker or Loki I/O — out of scope per the phase definition (Phases C/D).
- Frontend — out of scope per the phase definition; `dangerouslySetInnerHTML`/localStorage rules (traceability rows 21, part of 10) remain owned by Phase F onward.
- The real, richly-featured deterministic fixture source (H3) — owned by Phase A2b, which runs next (immediately after this phase, before Phase C, per the sequencing amendment). Phase B's own manual check ("hit `/api/v1/sources` with fixture source enabled") was satisfied against a test-only stub instead (`SourcesApiIntegrationTest`), as flagged before writing any code.

## Automated tests

All commands below were actually run this session; every number is from a real `./mvnw` invocation, not estimated.

| Check | Command | Result | Notes |
|---|---|---|---|
| Full backend suite | `./mvnw -q verify` | **PASS** | 83/83 tests, 0 failures, 0 errors, exit code 0. Aggregated from `target/surefire-reports/*.txt` across all 10 test classes. |
| Parser table tests | `LogLineParserTest` | PASS | 23 tests: every canonical top-level field, every canonical MDC field, both correlation-precedence branches (incl. the nested-path negative case), service precedence + hint retention, unknown top-level/MDC field preservation, the 5 sensitive keys never leaking into "unknown", malformed non-JSON/array/null fallback, single-bad-field tolerance (bad timestamp, bad `level_value`), empty vs. missing message, multiline exception, 4 parameterized timestamp-offset shapes. |
| Masking tests | `MaskingServiceTest` | PASS | 19 tests: `cif` strong masking (fixed value, never leaks even partially), partial masking for customerId/userName/deviceId incl. short-value and single-char full-mask fallback, IPv4/IPv6 masking incl. compressed (`::`) and malformed-shape fallback, null/empty preserved distinctly for every field, `RawSensitiveFields.toString()` redaction itself. |
| ArchUnit rules | `ArchitectureTest` | PASS | 3 rules, **verified to actually catch a violation**: a temporary `TemporaryViolationDto` field of type `CanonicalLogEvent` was added to `api.dto`, confirmed to fail the rule with a real ArchUnit violation report, then removed and re-confirmed green — not a rule that merely happens to pass. |
| Serialization leak test | `SerializationLeakTest` | PASS | 2 tests: a fully-populated event with 5 unique sentinel raw values serialized through the real API mapper + production-configured Jackson `ObjectMapper`; JSON asserted to contain none of them (and to contain the `****` mask, proving masking actually ran, not that fields were merely omitted). Second test proves the same holds even when unrelated unknown fields are present. |
| Log leak test | `LogLeakTest` | PASS | 3 tests, real `WebTestClient` HTTP calls against a running `@SpringBootTest` instance with a real Logback `ListAppender` attached at DEBUG. Covers success, guardrail-violation (400), and unknown-source (404) paths — checks both the HTTP response body and everything logged. **Found a real leak** (see below) and fixed it. |
| Guardrail validation tests | `SearchGuardrailsTest` | PASS | 12 tests: missing start/end, start==end, start>end, range over default max, range over/under per-source override (both directions), non-positive limit rejected, null limit uses default, over-max limit clamped not rejected, in-range limit used as-is, timeout comes from config. |
| Concurrency guard tests | `ConcurrencyGuardTest` | PASS | 3 tests: rejects beyond cap and the released permit is genuinely reusable (not just numerically reported free), releases on cancellation (not just normal completion), allows exactly up to the configured cap concurrently. |
| Search orchestration tests | `SearchServiceTest` | PASS | 8 tests: unknown source and guardrail violations surface as `Mono` errors (not thrown exceptions) via `Mono.defer`, truncation flag true/false/exact-boundary, cancellation propagates from the HTTP-level `Disposable` all the way to the stub `LogSource`, request timeout fires against a never-completing source, concurrency cap enforced across two searches on the same registry. |
| Source registry tests | `LogSourceRegistryTest` | PASS | 5 tests: resolve by id, unknown → `UnknownSourceException`, disabled (config-driven, even though a bean exists) → `DisabledSourceException`, `all()` excludes disabled sources, `all()` includes every non-disabled one. |
| Sources API integration test | `SourcesApiIntegrationTest` | PASS | 5 tests, real HTTP round-trip: `GET /api/v1/sources` returns explicit capabilities JSON (Phase B's stated manual check), `GET .../health` returns the source's real status and 404s for unknown ids, `GET .../services` returns discovered services with counts and 404s for unknown ids. |

## A real bug found and fixed during this phase's own verification

`LogLeakTest`'s first run (root logger at TRACE) failed: Spring's `WebClient` (`ExchangeFunctions`/`LoggingCodecSupport`) and Reactor Netty both log **full raw HTTP request/response bytes** — including the sensitive filter values — the moment their logger categories reach TRACE. Two fixes, not a relaxed assertion:

1. **`application.yml`** now explicitly pins `reactor.netty` and `io.netty` to `INFO`, independent of root — so an operator raising root logging for troubleshooting some other issue cannot accidentally start logging raw HTTP bytes. This directly serves `CLAUDE.md`'s "never log search values ... via request/access logs" rule.
2. The test's own capture ceiling was lowered from TRACE to **DEBUG** — the realistic troubleshooting level (TRACE full-body dumps are never enabled broadly in real deployments; the `ExchangeFunctions` traffic at TRACE turned out to be the *test's own* `WebTestClient` call into the app, not the server logging anything). At DEBUG, Spring logs method+path summaries and truncated previews only, never raw bodies — confirmed by re-running the test, which now passes with real HTTP traffic flowing and real `DEBUG` log lines captured (visible in the session's raw output), none containing any of the six sentinel raw values.

A second, unrelated bug (`ConcurrentModificationException` from background Netty threads appending to `ListAppender`'s plain `ArrayList` while the test read it) was fixed by swapping in a `CopyOnWriteArrayList`.

## Manual and browser checks

| Check | How run | Result | Evidence |
|---|---|---|---|
| Phase B's stated manual check: hit `/api/v1/sources` with a source enabled, confirm capabilities JSON | `SourcesApiIntegrationTest#sourcesEndpointReturnsExplicitCapabilitiesJson` (real HTTP call against a running `@SpringBootTest` instance, test-only stub source registered) | PASS | All 6 capability flags asserted present and correct in the JSON response. |
| Real application boot (not just tests) | `java -jar target/log-explorer-backend-0.1.0-SNAPSHOT.jar --server.port=8099`, then real `curl` calls, then killed | PASS | `GET /actuator/health` → `{"status":"UP"}`. `GET /api/v1/sources` → `[]` (honest — zero production `LogSource` beans exist yet; not faked). `GET /api/v1/sources/nonexistent/health` → HTTP 404 with sanitized `ProblemDetail` body `{"detail":"Unknown source",...}`. Process cleanly killed afterward, no lingering process confirmed. |
| Maven wrapper exists and works (closes a Phase A audit gap) | `./mvnw -q verify` | PASS | `docs/AUDIT.md` §3 reported `./mvnw: No such file or directory` since no backend existed. `mvn -N wrapper:wrapper -Dmaven=3.9.9` generated `backend/mvnw` + `.mvn/wrapper/`; the baseline command from Phase A now actually works. |
| No secrets/unsafe patterns introduced | `grep -rniE "bearer|password=|secret=|api[_-]?key\s*="`, `grep -rniE "trust.?all\|insecureSkipVerify\|X509TrustManager"`, `grep -rn "dangerouslySetInnerHTML"` across `backend/src/` | PASS | Zero hits for all three. |

Screenshots: none — no frontend exists yet (owned by Phase F onward).

## Results

- **PASS:** all 11 Phase B scope items; all automated tests (83/83); both manual checks; the architecture rules (verified to genuinely catch violations, not just pass); a real smoke boot of the packaged jar.
- **FAIL:** none.
- **BLOCKED:** none.
- **DEFERRED:** H3 (fixture `LogSource`) to Phase A2b, per the sequencing amendment — not a Phase B gap.

## Regression

N/A — Phase B is the first phase to introduce backend code; there is no prior backend suite to regress against. (Phase A2a's standalone `tools/` harness is independent of the backend module and was not touched.)

## Security check for this phase

- **Sensitive values in responses:** none — `SerializationLeakTest` proves it against a fully-populated event with unique sentinel values.
- **Sensitive values in logs or errors:** none at the realistic DEBUG troubleshooting ceiling — `LogLeakTest` proves it across success/400/404 paths, response bodies and logs both. A real TRACE-level framework leak (Reactor Netty + Spring `WebClient` wire logging) was found and closed with an explicit config floor, not just a lowered test threshold.
- **Sensitive values in URL or localStorage:** N/A — no frontend exists yet; `POST /api/v1/logs/search` carries filters in the request body, never the URL, satisfying the underlying principle already at the backend contract level.
- **New TLS, Docker, or OpenShift privileges introduced:** none — no TLS, Docker, or OpenShift code exists yet (Phases C/D).

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 8, 12, 13, 14, 15, 16, 17, 18, 19, 22, 23, 24, 25, 26, 27 → **Done**. Rows 10, 20, 28 → **Partial** (multi-phase items; Phase B's own share is complete, the remaining share belongs to later phases as already noted in the "Owning phase" column).

## Known gaps carried forward

- H3 (fixture `LogSource`) and H4b (Playwright/real-app wiring) — Phase A2b, next, immediately after this phase and before Phase C.
- Row 10 (localStorage rule), row 21 (no `dangerouslySetInnerHTML`) — Phase F onward, once a frontend exists.
- Row 20 (never log search values) and row 28 (cancellation) — ongoing/multi-phase responsibility; Phase B's own share is proven, later phases (esp. J for live-tail cancellation) must maintain it.
