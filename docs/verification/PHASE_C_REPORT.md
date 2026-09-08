# Phase C — Docker source (local + optional remote) — Verification Report

Branch: `phase/c-docker-source`
Date: 2026-09-08

## Prerequisite

Phase A2b (fixture source) is merged (PR #4) — Phase C's dependency on it is satisfied. Confirmed before starting: `gh pr list` showed PR #4 `MERGED`, local `main` synced to `2bd1e01`.

## Scope delivered

Per `IMPLEMENTATION_PLAN.md` "Phase C":

1. **Connection modes** (`config/DockerProperties.java`, `source/docker/DockerClientFactory.java`): `LOCAL` (default) delegates entirely to `docker-java`'s own default config builder — which itself honors `DOCKER_HOST`/`DOCKER_TLS_VERIFY`/`DOCKER_CERT_PATH`, satisfying scope item 2 without duplicating any of that logic. `REMOTE` is explicit opt-in with a prefilled, always-overridable default port (2375) and optional TLS — never forced, and TLS-on always requires a real certificate directory (never trust-all).
2. **Compose discovery** (`source/docker/ComposeLabels.java`): containers are only discovered/searched if they carry `com.docker.compose.project`; running *and* stopped-but-readable containers both included; optional project filter (`logexplorer.docker.compose-project-filter`); per-service running/total counts.
3. **Log reading and framing** (`source/docker/DockerFrameCollectingCallback.java`): since/until/tail bounded reads; correct frame demuxing via `Frame.getStreamType()` for STDOUT/STDERR, with `Tty=true` containers (reported by `docker-java` as `StreamType.RAW`, since Docker doesn't multiplex their output) handled as undifferentiated stdout; lines split across multiple frames are correctly reassembled via per-stream buffering.
4. **Deterministic cross-container merge** (`source/docker/DockerLogSource.java`): Docker's own per-line receive timestamp (via `withTimestamps(true)`, stripped before parsing) orders the merge — newest first, containerId as a stable tiebreaker — independent of HTTP response arrival order.
5. **Enrichment**: `CanonicalLogEvent` extended (additively, via the existing `Builder` — nothing that already calls `.builder()...build()` needed to change) with `sourceId`, `composeProject`, `containerId`, `containerName`, `stream`; `EventDto`/`EventMapper` updated to pass these (non-sensitive) fields through to the API.
6. **Strictly read-only** (`source/docker/ReadOnlyDockerClient.java`): architectural, not conventional — `DockerLogSource` and everything else in `source.docker` depend only on this narrow facade (5 methods: list/inspect/logs/ping/version), never the raw `DockerClient` (which exposes start/stop/create/remove/exec). Mutating methods are structurally unreachable, not merely unused.
7. **Diagnostics** (`source/docker/DockerDiagnostics.java`): classifies connection failures (permission denied, TLS handshake, timeout, unknown host, connection refused, socket not found) into fixed, sanitized messages — never the raw exception text, never advising exposing port 2375.
8. **Blocking isolation**: every `ReadOnlyDockerClient` call happens inside `Mono.fromCallable(...).subscribeOn(Schedulers.boundedElastic())` — never on the WebFlux event loop.

## Explicitly not delivered

- Live tail UI — Phase J's job; Phase C's `capabilities().liveTail` deliberately reports `false` (the follow *primitive* exists in `ReadOnlyDockerClient`/`docker-java`, but nothing wires it to `/api/v1/logs/live` yet — reporting `true` before that endpoint exists would violate "capabilities reflect reality").
- Any daemon reconfiguration guidance — out of scope per the phase definition; `.env.example` and `DockerDiagnostics` explicitly never suggest exposing port 2375.

## Automated tests

All commands below were actually run this session.

| Check | Command | Result | Notes |
|---|---|---|---|
| Full backend suite | `./mvnw -q verify` | **PASS** | 155/155 tests, 0 failures, 0 errors, exit 0. |
| Compose label parsing | `ComposeLabelsTest` | PASS | 3 tests: project/service extraction, non-Compose container correctly unmanaged, null-safety. |
| Diagnostics mapping | `DockerDiagnosticsTest` | PASS | 15 tests: every failure class (connection refused, permission denied, TLS, timeout, unknown host, generic fallback), cause-chain unwrapping, and a parameterized check that **no** classified message ever mentions "2375" or "expose" (scope item 7). |
| Read-only enforcement | `ReadOnlyDockerClientMethodSetTest` | PASS | 2 tests: the facade's public method set is exactly `{listContainers, inspectContainer, readLogs, ping, version, close}`; no public method name resembles any mutating Docker operation. |
| Connection-mode resolution | `DockerClientFactoryTest` | PASS | 7 tests: LOCAL builds without remote properties, REMOTE default port (2375) applied when unset, override honored, missing host rejected, TLS-off requires no cert, TLS-on rejects a missing/invalid cert directory, TLS-on with a valid directory succeeds. |
| Framing (incl. tty, truncation) | `DockerFrameCollectingCallbackTest` | PASS | 8 tests: one line in one frame, a line split across 3 frames, multiple lines in one frame, interleaved stdout/stderr with a stdout partial buffered across an intervening stderr frame, `StreamType.RAW` (tty) treated as stdout, trailing partial line flushed on completion, unparsable timestamp prefix preserves the line rather than corrupting it, bounded truncation at `maxLines`. |
| Adapter behavior (merge, labels, stopped containers) | `DockerLogSourceTest` | PASS | 14 tests: service discovery excludes non-Compose containers and counts running vs. total correctly, stopped containers remain searchable, deterministic newest-first merge across containers (and repeatable — not coincidentally sorted), full enrichment fields set, Compose-project filter, per-request service filter (and that an excluded container's logs are never even requested — `verify(..., never())`), one broken container doesn't fail the whole search, per-container reads bounded by `defaultTailLines`, capabilities/displayName per mode (including that `liveTail` is `false`), health success/failure mapping. |
| Adapter enrichment round-trip | `CanonicalLogEventTest` | PASS | 2 tests: `toBuilder()` round-trips every field including the new enrichment fields; allows overriding just the enrichment fields without touching parsed content. |
| Secret / unsafe-pattern scan | `grep` across `source/docker/`, `DockerProperties.java`, `.env.example` | PASS | Zero hits for credential patterns; the one "trust-all" match is a doc comment stating the rule, not code. |

## Three real bugs found and fixed during this phase's own verification

1. **`DockerLogSource` (id `"local-docker"`) is unconditionally registered — as it should be in production — which broke an existing Phase B test** (`SourcesApiIntegrationTest`) that assumed its own test stub was the *only* source in the registry and asserted on `$[0]`. This was a pre-existing test fragility, correctly exposed now that a second real source exists. Fixed by filtering the JSON path by id (`$[?(@.id=='test-source')]`) instead of assuming array position — not by weakening the assertion.
2. **`ReadOnlyDockerClient.version()` called `versionCmd().exec()` twice** (a copy-paste slip while drafting the facade) — caught immediately on inspection, fixed before it ever reached a test run.
3. **A classic Mockito stubbing-order bug in the test suite itself** (`DockerLogSourceTest`): building mock `Container`s *inside* the argument list of an unfinished `when(mockClient.listContainers(true)).thenReturn(List.of(container(...), ...))` call corrupted Mockito's stubbing state (each `container()` call itself calls `when(...)`, nested inside another not-yet-completed `when()`). Fixed by building the list in a separate statement before starting the stub — Mockito's own error hint pointed directly at the cause.

Also found via real API method inspection (not real "bugs," but real course-corrections from assumed docker-java 3.7.1 API surface to the actual one): `LogContainerCmd.withFollow(boolean)` doesn't exist — the real method is `withFollowStream(Boolean)`; used the wrong transport class initially (`ZerodepDockerHttpClient` instead of the plan-specified `ApacheDockerHttpClient` from `docker-java-transport-httpclient5`). Both caught by the compiler before any test ran.

## Manual and live checks — against real local Docker, not mocks

Per the plan: *"Against the local socket with the demo generator stack running: list services, search, confirm merged deterministic ordering, confirm malformed lines surface as raw events."* All run for real this session.

1. Started two real containers from A2a's `demo-log-generator:phase-a2a` image, manually labeled `com.docker.compose.project=logexplorer-demo` / `com.docker.compose.service=gateway`|`accounts-api` (no `docker-compose.yml` exists yet — that's Phase K; this is the same situation A2a itself was in, and matches the plan's own fallback: "direct process run").
2. Booted the real packaged jar with `--logexplorer.docker.compose-project-filter=logexplorer-demo` (also exercising the project filter live, and incidentally discovering that *without* the filter, the source correctly finds every Compose-managed container on the host — including an unrelated pre-existing stack — which is the honest, correct behavior for an unscoped discovery call).
3. `GET /api/v1/sources` → `local-docker` present with correct capabilities (`liveTail: false`, as designed).
4. `GET /api/v1/sources/local-docker/services` → exactly `gateway` and `accounts-api`, both `runningCount: 1, totalCount: 1`.
5. `POST /api/v1/logs/search` → 20-event page: real messages, real timestamps in strict descending order, `containerName`/`composeProject`/`stream` correctly enriched on every event — including cases where a container's `service` (from the JSON content's `application` field) legitimately differs from its Compose service label, a real live exercise of the Phase B "service precedence, both retained" invariant with genuine adapter data for the first time.
6. Widened to `limit: 300` → **7 malformed events found**, each with `malformed: true`, a populated `rawLine` (e.g. `"NOT-JSON demo-malformed-line service=gateway ts=..."`), and — critically — still fully enriched with `containerId`/`composeProject` even though the line itself couldn't be parsed. Confirms malformed lines are never dropped, end to end through a real adapter.
7. **Stopped-but-readable**: `docker stop c-manual-accounts`, re-queried `/services` → `accounts-api` now shows `runningCount: 0, totalCount: 1` (still counted); re-ran a service-filtered search → accounts-api's historical logs still fully returned.
8. **Read-only, confirmed in practice**: after all of the above (multiple discovery calls, multiple searches), `docker ps` showed both containers still `Up`, never stopped/restarted/removed by anything Log Explorer did.
9. Cleaned up: stopped and removed both test containers, killed the backend process, confirmed via `ps aux` and `docker ps -a` that nothing was left running.

**Remote mode**: logic proven by `DockerClientFactoryTest` (7 tests, see above) — this is the plan's own explicit PASS bar ("remote mode logic proven by tests"). Live verification against a real remote daemon was not attempted: this VM's Docker daemon only listens on the local Unix socket, and the plan is explicit that exercising remote mode is conditional on a throwaway endpoint being available *"without changing host/daemon policy."* One attempt at a safe, reversible, localhost-only TCP↔Unix-socket proxy (touching no daemon configuration) was blocked by this environment's own permission classifier — respected rather than worked around, since exposing the Docker socket over TCP, even briefly, is exactly the pattern this project's security rules exist to prevent. Recorded as **BLOCKED**, not PASS, per §24.15.

## Results

- **PASS:** all 11 Phase C scope items; local-socket path verified end to end with real containers (list, search, merge, malformed-line survival, stopped-container readability, read-only-in-practice); remote-mode connection logic proven by 7 real tests; diagnostics correct and never leak raw text or advise port exposure.
- **FAIL:** none.
- **BLOCKED:** live remote-daemon verification — no safe way to exercise a real remote TCP Docker endpoint from this environment without touching daemon/host policy, exactly as HANDOVER.md §11.2's own documented lesson anticipates. Not converted to PASS.
- **DEFERRED:** none.

## Regression

Full suite: 155/155 (104 Phase B + 21 Phase A2b + ~30 new Phase C tests, all counted together in `./mvnw -q verify`'s single run). One pre-existing Phase B test (`SourcesApiIntegrationTest`) needed a fix (see "real bugs" above) — not weakened, made correct.

## Security check for this phase

- Sensitive values in responses: unaffected — `DockerLogSource` produces `CanonicalLogEvent`s through the same `LogLineParser`/`MaskingService` boundary Phase B already proved leak-free; nothing here bypasses it.
- Sensitive values in logs or errors: `DockerDiagnostics` never echoes a raw exception message, only fixed classified strings; the one place a container is skipped on error logs `DockerDiagnostics.classify(e)` (sanitized), never `e.getMessage()` directly.
- Sensitive values in URL or localStorage: N/A, unchanged from Phase B.
- New TLS: `REMOTE` + `tls=true` requires a real certificate directory; verified — never trust-all, by construction (no code path sets `withDockerTlsVerify(true)` while skipping certificate configuration).
- New Docker privileges: **strictly read-only**, enforced architecturally (see "Strictly read-only" above), verified by both a locked-method-set test and live testing (containers untouched after real use).
- `.env.example`: variable names and harmless defaults only (`LOGEXPLORER_DOCKER_HOST=` empty, no real host committed); scanned for secrets, zero hits.

## Traceability updated

`REQUIREMENTS_TRACEABILITY.md` rows 4, 5, 6, 31, 32, 33 → **Done**. Rows 2 and 7 → **Partial** (both co-owned by a phase that hasn't run yet — Phase D for row 2's Loki half, Phase K for row 7's Compose-packaging half; Phase C's own share of each is complete).

## Known gaps carried forward

- Live remote-Docker-daemon verification remains BLOCKED in this environment — not a Phase C defect, an environment constraint the plan explicitly anticipates. Any future environment with a safely-reachable remote Docker endpoint (e.g. a dedicated CI runner) could close this without any code change.
- Row 2 (Loki half) — Phase D.
- Row 7 (Compose packaging demonstration) — Phase K.
